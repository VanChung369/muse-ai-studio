"""Per-account HTTP proxies and a loopback authentication relay for Chromium."""

from __future__ import annotations

import base64
from contextlib import contextmanager
import hmac
import ipaddress
import secrets
import select
import socket
import socketserver
import threading
from urllib.parse import quote, unquote, urlsplit


class ProxyConfigError(ValueError):
    """A saved proxy cannot be used, e.g. credentials outside Latin-1."""


def encode_credential(value: str) -> bytes:
    # HTTP Basic proxy auth (also inside requests/urllib3) and SOCKS5
    # username/password are sent as Latin-1 bytes.
    try:
        return value.encode("latin-1")
    except UnicodeEncodeError:
        raise ProxyConfigError(
            "Proxy credentials must use Latin-1 characters."
        ) from None


def normalize_server(value: str) -> str:
    """Accept HTTP or SOCKS5 proxy origins; credentials use separate fields."""
    try:
        parsed = urlsplit(value.strip())
        port = (
            parsed.port
            if parsed.port is not None
            else (1080 if parsed.scheme in ("socks5", "socks5h") else 80)
        )
        host = parsed.hostname
        if (
            parsed.scheme not in ("http", "socks5", "socks5h")
            or not host
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or not 1 <= port <= 65535
            or any(c.isspace() or ord(c) < 32 for c in value)
            or any(c in host for c in "/\\@%")
        ):
            raise ValueError
        host = f"[{host}]" if ":" in host else host.encode("idna").decode("ascii")
        return f"{parsed.scheme}://{host}:{port}"
    except (ValueError, UnicodeError):
        raise ValueError(
            "Use http://host:port, socks5://host:port or socks5h://host:port"
        ) from None


def split_proxy_url(value: dict) -> dict:
    """Normalize a pasted proxy URL before field validation; URL credentials take precedence."""
    raw = value.get("server")
    if not isinstance(raw, str):
        return value
    try:
        parsed = urlsplit(raw.strip())
        if parsed.username is None and parsed.password is None:
            return value
        origin = parsed._replace(netloc=parsed.netloc.rsplit("@", 1)[-1]).geturl()
        result = {
            **value,
            "server": normalize_server(origin),
            "username": unquote(parsed.username or "", errors="strict"),
        }
        # `user@host` without a password must not erase the saved password:
        # only a password actually present in the URL replaces the field.
        if parsed.password is not None:
            result["password"] = unquote(parsed.password, errors="strict")
        return result
    except (ValueError, UnicodeError):
        raise ValueError(
            "Invalid proxy URL; use http://user:password@host:port or socks5://user:password@host:port"
        ) from None


def public_proxy(proxy: dict | None) -> dict | None:
    if not proxy:
        return None
    return {
        "server": proxy["server"],
        "username": proxy.get("username", ""),
        "has_password": bool(proxy.get("password")),
    }


def request_proxies(proxy: dict | None) -> dict:
    if not proxy:
        return {}
    parsed = urlsplit(proxy["server"])
    auth = ""
    # requests encodes proxy credentials as Latin-1 at send time; fail early
    # with a typed error instead of an unhandled UnicodeEncodeError.
    encode_credential(proxy.get("username", ""))
    encode_credential(proxy.get("password", ""))
    if proxy.get("username") or proxy.get("password"):
        auth = (
            quote(proxy.get("username", ""), safe="")
            + ":"
            + quote(proxy.get("password", ""), safe="")
            + "@"
        )
    url = f"http://{auth}{parsed.netloc}"
    return {"proxies": {"http": url, "https": url}}


@contextmanager
def request_proxy_context(proxy: dict | None):
    """requests uses its native HTTP path or a short-lived local SOCKS adapter."""
    if proxy and urlsplit(proxy["server"]).scheme in ("socks5", "socks5h"):
        relay = HTTPProxyRelay(proxy)
        try:
            yield {"proxies": {"http": relay.client_url, "https": relay.client_url}}
        finally:
            relay.close()
    else:
        yield request_proxies(proxy)


class _RelayServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    block_on_close = False

    def handle_error(self, request, client_address):
        # Socket errors must never print headers or credentials.
        pass


class _RelayHandler(socketserver.BaseRequestHandler):
    def handle(self):
        relay = self.server.relay
        client = self.request
        upstream = None
        try:
            if not relay.track(client):
                return
            client.settimeout(15)
            # Read exactly through the header boundary: TLS bytes after CONNECT
            # must remain available for the bidirectional tunnel.
            head = bytearray()
            while not head.endswith(b"\r\n\r\n"):
                byte = client.recv(1)
                if not byte:
                    return
                head.extend(byte)
                if len(head) > 65536:
                    return
            lines = bytes(head[:-4]).split(b"\r\n")
            if not relay.authorized(lines[1:]):
                # The relay listens on loopback with the upstream proxy's
                # credentials attached; other local processes must not use it.
                client.sendall(
                    b"HTTP/1.1 407 Proxy Authentication Required\r\n"
                    b'Proxy-Authenticate: Basic realm="muse-relay"\r\n'
                    b"Connection: close\r\nContent-Length: 0\r\n\r\n"
                )
                return
            method, target, version = lines[0].split(b" ", 2)
            if (
                method != b"CONNECT"
                and urlsplit(target.decode("ascii")).scheme != "http"
            ):
                return
            headers = [
                line
                for line in lines[1:]
                if line.split(b":", 1)[0].lower()
                not in (b"proxy-authorization", b"proxy-connection", b"connection")
            ]
            if relay.scheme in ("socks5", "socks5h"):
                parsed = urlsplit(
                    ("//" if method == b"CONNECT" else "") + target.decode("ascii")
                )
                host = parsed.hostname
                port = parsed.port or (443 if method == b"CONNECT" else 80)
                if not host or parsed.username is not None or not 1 <= port <= 65535:
                    return
                upstream = relay.connect_socks(host, port)
                if not relay.track(upstream):
                    return
                if method == b"CONNECT":
                    client.sendall(b"HTTP/1.1 200 Connection Established\r\n\r\n")
                else:
                    path = parsed.path or "/"
                    if parsed.query:
                        path += "?" + parsed.query
                    request_line = b" ".join((method, path.encode("ascii"), version))
                    headers.append(b"Connection: close")
                    upstream.sendall(
                        b"\r\n".join([request_line, *headers]) + b"\r\n\r\n"
                    )
            else:
                upstream = socket.create_connection(relay.address, timeout=15)
                if not relay.track(upstream):
                    return
                if relay.authorization:
                    headers.append(b"Proxy-Authorization: " + relay.authorization)
                if method != b"CONNECT":
                    headers.append(b"Connection: close")
                upstream.sendall(b"\r\n".join([lines[0], *headers]) + b"\r\n\r\n")
            client.settimeout(30)
            upstream.settimeout(30)
            open_sources = [client, upstream]
            while open_sources and not relay.closed:
                readable, _, _ = select.select(open_sources, [], [], 1)
                for source in readable:
                    target = upstream if source is client else client
                    data = source.recv(65536)
                    if data:
                        target.sendall(data)
                        continue
                    # EOF on one side (possibly a half-close): pass it on and
                    # keep relaying the other direction until it ends too.
                    open_sources.remove(source)
                    try:
                        target.shutdown(socket.SHUT_WR)
                    except OSError:
                        open_sources.clear()
        except (OSError, ValueError, UnicodeError):
            # A failed proxy must never trigger a direct connection.
            try:
                client.sendall(
                    b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"
                )
            except OSError:
                pass
        finally:
            for sock in (client, upstream):
                if sock:
                    relay.untrack(sock)
                    sock.close()


class HTTPProxyRelay:
    """Forward Chrome's requests to one authenticated HTTP proxy, never direct."""

    def __init__(self, proxy: dict):
        parsed = urlsplit(normalize_server(proxy["server"]))
        self.address = (parsed.hostname, parsed.port)
        self.scheme = parsed.scheme
        self.username = encode_credential(proxy.get("username", ""))
        self.password = encode_credential(proxy.get("password", ""))
        if self.scheme in ("socks5", "socks5h") and (
            len(self.username) > 255 or len(self.password) > 255
        ):
            raise ProxyConfigError("SOCKS5 credentials must not exceed 255 bytes")
        self.authorization = None
        if proxy.get("username") or proxy.get("password"):
            credentials = self.username + b":" + self.password
            self.authorization = b"Basic " + base64.b64encode(credentials)
        self.closed = False
        self._sockets = set()
        self._lock = threading.Lock()
        self.server = _RelayServer(("127.0.0.1", 0), _RelayHandler)
        self.server.relay = self
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        # Random per-relay credentials for local clients (Chromium via
        # Playwright's proxy auth, requests via the proxy URL).
        self.client_username = secrets.token_hex(8)
        self.client_password = secrets.token_hex(16)
        self.client_url = (
            f"http://{self.client_username}:{self.client_password}"
            f"@127.0.0.1:{self.server.server_address[1]}"
        )
        self._expected_authorization = b"Basic " + base64.b64encode(
            f"{self.client_username}:{self.client_password}".encode("ascii")
        )
        self.thread = threading.Thread(
            target=self.server.serve_forever, kwargs={"poll_interval": 0.1}, daemon=True
        )
        self.thread.start()

    def authorized(self, header_lines) -> bool:
        for line in header_lines:
            name, _, value = line.partition(b":")
            if name.strip().lower() == b"proxy-authorization":
                return hmac.compare_digest(value.strip(), self._expected_authorization)
        return False

    def browser_proxy(self) -> dict:
        return {
            "server": self.url,
            "username": self.client_username,
            "password": self.client_password,
        }

    @staticmethod
    def _read_exact(sock, size):
        data = bytearray()
        while len(data) < size:
            chunk = sock.recv(size - len(data))
            if not chunk:
                raise OSError("SOCKS5 proxy closed the connection")
            data.extend(chunk)
        return bytes(data)

    def connect_socks(self, host, port):
        sock = socket.create_connection(self.address, timeout=15)
        try:
            method = 2 if self.username or self.password else 0
            sock.sendall(bytes((5, 1, method)))
            if self._read_exact(sock, 2) != bytes((5, method)):
                raise OSError("SOCKS5 authentication method rejected")
            if method == 2:
                sock.sendall(
                    bytes((1, len(self.username)))
                    + self.username
                    + bytes((len(self.password),))
                    + self.password
                )
                if self._read_exact(sock, 2) != bytes((1, 0)):
                    raise OSError("SOCKS5 authentication failed")
            try:
                address = ipaddress.ip_address(host)
            except ValueError:
                domain = host.encode("idna")
                if not 1 <= len(domain) <= 255:
                    raise OSError("SOCKS5 hostname is invalid")
                destination = bytes((3, len(domain))) + domain
            else:
                destination = (
                    bytes((1 if address.version == 4 else 4,)) + address.packed
                )
            sock.sendall(bytes((5, 1, 0)) + destination + int(port).to_bytes(2, "big"))
            reply = self._read_exact(sock, 4)
            if reply[:3] != bytes((5, 0, 0)):
                raise OSError("SOCKS5 connection rejected")
            length = {1: 4, 4: 16}.get(reply[3])
            if reply[3] == 3:
                length = self._read_exact(sock, 1)[0]
            if length is None:
                raise OSError("SOCKS5 response is invalid")
            self._read_exact(sock, length + 2)
            return sock
        except Exception:
            sock.close()
            raise

    def track(self, sock):
        with self._lock:
            if self.closed:
                sock.close()
                return False
            self._sockets.add(sock)
            return True

    def untrack(self, sock):
        with self._lock:
            self._sockets.discard(sock)

    def close(self):
        with self._lock:
            if self.closed:
                return
            self.closed = True
            for sock in self._sockets:
                try:
                    sock.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass
                sock.close()
            self._sockets.clear()
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=2)
