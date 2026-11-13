"""Regression tests for findings from the agy review (2026-11-13)."""

import base64
import json
import socket
import socketserver
import threading
import time

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient
from playwright.sync_api import Error as BrowserError

from app.core.account_cookies import CookieImportError, parse_cookie_bundle
from app.core.account_vault import AccountVault
from app.core.config import Settings
from app.integrations.muse.client import MuseClient, MuseError, SessionResult
from app.integrations.muse.proxy import HTTPProxyRelay
from app.main import create_app
from app.models import Account

SECRET = "agy-fixture-session"


@pytest.fixture
def settings(tmp_path):
    return Settings(_env_file=None, data_dir=tmp_path)


@pytest.fixture
def client(settings):
    with TestClient(create_app(settings)) as client:
        yield client


def create_account(client, cookie_text=f"hatch_sess={SECRET}"):
    return client.post(
        "/api/accounts", json={"label": "A", "cookieText": cookie_text}
    ).json()


class Provider:
    def __init__(self, error=None, result=None):
        self.error, self.result = error, result

    def session(self, cookies, expiries, proxy, wake=False):
        if self.error:
            raise self.error
        return self.result


# 1. A partial result from a failed /api/session must not mark the account valid.
@pytest.mark.parametrize("code", ["invalid_response", "workspace_unavailable"])
def test_unconfirmed_partial_keeps_cookies_but_not_validity(client, code):
    account = create_account(client)
    partial = SessionResult(
        {"hatch_sess": SECRET, "rotated": "1"}, {}, None, verified=False
    )
    client.app.state.muse_client = Provider(error=MuseError(code, partial=partial))
    response = client.post(f"/api/accounts/{account['id']}/test")
    assert response.status_code == 502
    stored = client.get(f"/api/accounts/{account['id']}").json()
    assert stored["sessionStatus"] == "unverified" and stored["lastError"] == code
    assert stored["cookieCount"] == 2  # Rotated cookies were still saved.


# 2. Muse can grow the jar past 100 cookies; keep the session instead of a false 409.
def test_operation_caps_cookie_jar_at_stored_limit(client):
    account = create_account(client)
    jar = {f"c{index}": "v" for index in range(150)} | {"hatch_sess": SECRET}
    client.app.state.muse_client = Provider(result=SessionResult(jar, {}, "RUNNING"))
    response = client.post(f"/api/accounts/{account['id']}/test")
    assert response.status_code == 200, response.text
    assert response.json()["account"]["cookieCount"] == 100


# 3. Exclusive-create fallback: a reader must wait for the complete key.
def test_vault_waits_for_a_key_still_being_written(tmp_path):
    path = tmp_path / "account-secret.key"
    path.write_bytes(b"")
    key = Fernet.generate_key()

    def finish_writing():
        time.sleep(0.2)
        path.write_bytes(key)

    writer = threading.Thread(target=finish_writing)
    writer.start()
    vault = AccountVault(path)
    vault.prepare()
    writer.join()
    assert vault.decrypt(Fernet(key).encrypt(b'{"hatch_sess": "x"}').decode()) == {
        "hatch_sess": "x"
    }


# 4. Lenient parsing: empty/expired duplicates lose; more paste formats work.
@pytest.mark.parametrize(
    "text",
    [
        json.dumps(
            [
                {"name": "hatch_sess", "value": "", "domain": ".muse.ai"},
                {"name": "hatch_sess", "value": SECRET, "domain": "app.muse.ai"},
            ]
        ),
        json.dumps(
            [
                {
                    "name": "hatch_sess",
                    "value": "old",
                    "domain": ".muse.ai",
                    "expirationDate": 1000,
                },
                {
                    "name": "hatch_sess",
                    "value": SECRET,
                    "domain": "www.muse.ai",
                    "expirationDate": 2000000000,
                },
            ]
        ),
        f"  #HttpOnly_.muse.ai\tTRUE\t/\tTRUE\t2000000000\thatch_sess\t{SECRET}",
        f"HTTP/2 200\nset-cookie: hatch_sess={SECRET}; Path=/; HttpOnly\nset-cookie: _ga=1; Max-Age=10",
        f'curl ^"https://muse.ai/api/session^" ^\n  -H ^"accept: */*^" ^\n  -b ^"hatch_sess={SECRET}; _ga=x^"',
        f'$s.Cookies.Add((New-Object System.Net.Cookie("hatch_sess", "{SECRET}", "/", "muse.ai")))',
        f'Invoke-WebRequest -Uri "https://muse.ai/" -Headers @{{"cookie"="hatch_sess={SECRET}; a=b"}}',
    ],
)
def test_parser_accepts_more_pastes(text):
    cookies, _ = parse_cookie_bundle(text)
    assert cookies["hatch_sess"] == SECRET


def test_parser_still_requires_a_session():
    with pytest.raises(CookieImportError) as raised:
        parse_cookie_bundle(
            json.dumps([{"name": "hatch_sess", "value": "", "domain": ".muse.ai"}])
        )
    assert raised.value.code == "missing_session"


# 5. The loopback relay requires its own credentials and survives half-close.
class FakeUpstreamProxy(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


class FakeUpstreamHandler(socketserver.BaseRequestHandler):
    def handle(self):
        data = b""
        while b"\r\n\r\n" not in data:
            chunk = self.request.recv(4096)
            if not chunk:
                return
            data += chunk
        self.server.seen.append(data)
        self.request.sendall(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok"
        )


@pytest.fixture
def upstream():
    server = FakeUpstreamProxy(("127.0.0.1", 0), FakeUpstreamHandler)
    server.seen = []
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield server
    server.shutdown()


def relay_request(port, authorization=None, half_close=False):
    sock = socket.create_connection(("127.0.0.1", port), timeout=5)
    headers = ["GET http://muse.ai/ HTTP/1.1", "Host: muse.ai"]
    if authorization:
        headers.append(f"Proxy-Authorization: {authorization}")
    sock.sendall(("\r\n".join(headers) + "\r\n\r\n").encode())
    if half_close:
        sock.shutdown(socket.SHUT_WR)
    response = b""
    while chunk := sock.recv(4096):
        response += chunk
    sock.close()
    return response


def test_relay_rejects_unauthenticated_local_clients(upstream):
    relay = HTTPProxyRelay(
        {
            "server": f"http://127.0.0.1:{upstream.server_address[1]}",
            "username": "u",
            "password": "p",
        }
    )
    try:
        port = relay.server.server_address[1]
        assert relay_request(port).startswith(b"HTTP/1.1 407")
        assert relay_request(
            port, "Basic " + base64.b64encode(b"wrong:creds").decode()
        ).startswith(b"HTTP/1.1 407")
        assert upstream.seen == []  # Nothing reached the paid proxy.
        token = (
            "Basic "
            + base64.b64encode(
                f"{relay.client_username}:{relay.client_password}".encode()
            ).decode()
        )
        response = relay_request(port, token, half_close=True)
        assert response.endswith(b"ok")  # Response arrives despite the half-close.
        forwarded = upstream.seen[0]
        assert b"Proxy-Authorization: Basic " + base64.b64encode(b"u:p") in forwarded
        assert token.encode() not in forwarded  # Local credentials stay local.
        assert relay.browser_proxy()["username"] == relay.client_username
    finally:
        relay.close()


# 6. A destroyed execution context mid-poll is retried, not fatal.
def test_click_until_survives_navigation_errors():
    class Page:
        calls = 0
        clicks = 0

        def evaluate(self, expression):
            Page.calls += 1
            if Page.calls == 1:
                raise BrowserError("Execution context was destroyed")
            return '{"x": 1, "y": 2}'

        class mouse:
            @staticmethod
            def click(x, y):
                Page.clicks += 1

        def wait_for_timeout(self, _ms):
            pass

    assert (
        MuseClient._click_until(
            Page(), "target", lambda: "ready" if Page.clicks else None, timeout=5
        )
        == "ready"
    )


# 7a/b/c. Proxy password survives user@host; SOCKS limits at save; failed keep-alive time.
def test_proxy_url_without_password_keeps_the_saved_one(client):
    account = create_account(client)
    path = f"/api/accounts/{account['id']}/proxy"
    client.put(
        path,
        json={
            "proxy": {
                "server": "http://proxy.example.com:8080",
                "username": "alice",
                "password": "pw",
            }
        },
    )
    response = client.put(
        path, json={"proxy": {"server": "http://alice@proxy.example.com:8080"}}
    )
    assert (
        response.status_code == 200 and response.json()["proxy"]["hasPassword"] is True
    )
    cleared = client.put(
        path,
        json={
            "proxy": {
                "server": "http://proxy.example.com:8080",
                "username": "alice",
                "password": "",
            }
        },
    )
    assert cleared.json()["proxy"]["hasPassword"] is False


def test_socks_credentials_over_255_bytes_are_rejected_when_saved(client):
    account = create_account(client)
    response = client.put(
        f"/api/accounts/{account['id']}/proxy",
        json={
            "proxy": {
                "server": "socks5://proxy.example.com:1080",
                "username": "u",
                "password": "x" * 256,
            },
        },
    )
    assert response.status_code == 422


def test_failed_keepalive_does_not_record_a_keepalive_time(client):
    account = create_account(client)
    client.app.state.muse_client = Provider(error=MuseError("network_error"))
    assert client.post(f"/api/accounts/{account['id']}/keep-alive").status_code == 502
    stored = client.get(f"/api/accounts/{account['id']}").json()
    assert stored["lastKeepaliveAt"] is None and stored["lastError"] == "network_error"


# Cleanups: browser lock after the session request; clear startup error.
def test_busy_browser_still_returns_refreshed_session(settings, monkeypatch):
    muse = MuseClient(settings)
    refreshed = SessionResult({"hatch_sess": "rotated"}, {}, "RUNNING")
    monkeypatch.setattr(muse, "session", lambda *args, **kwargs: refreshed)
    slots = 0
    while muse.browser_lock.acquire(blocking=False):  # Take every Chromium slot.
        slots += 1
    try:
        with pytest.raises(MuseError) as raised:
            muse.quota({"hatch_sess": "old"}, {})
    finally:
        for _ in range(slots):
            muse.browser_lock.release()
    assert slots == settings.browser_slots
    assert raised.value.code == "browser_busy" and raised.value.partial is refreshed


def test_set_cookie_beats_the_stale_request_cookie():
    # DevTools request + response headers: the response rotated hatch_sess.
    text = "cookie: hatch_sess=OLD; _ga=1\nset-cookie: hatch_sess=NEW; Domain=muse.ai; Path=/"
    assert parse_cookie_bundle(text)[0] == {"hatch_sess": "NEW", "_ga": "1"}


def test_startup_names_an_account_the_key_cannot_decrypt(settings):
    with TestClient(create_app(settings)) as client:
        create_account(client)
        other = create_account(client, f"hatch_sess={SECRET}-2")
        with client.app.state.database.sessions() as session:
            row = session.get(Account, other["id"])
            row.encrypted_cookies = (
                Fernet(Fernet.generate_key()).encrypt(b'{"hatch_sess":"x"}').decode()
            )
            session.commit()
    with pytest.raises(RuntimeError, match="cannot be decrypted|does not match"):
        with TestClient(create_app(settings)):
            pass


# agy verification follow-ups.
@pytest.mark.parametrize(
    "text,expected",
    [
        (
            "set-cookie: hatch_sess=expired-token; Expires=Thu, 01 Jan 1970 00:00:00 GMT\nset-cookie: hatch_sess=live-token; Path=/",
            "live-token",
        ),
        (
            "set-cookie: hatch_sess=other; Domain=.other.com\nset-cookie: hatch_sess=live-token; Path=/",
            "live-token",
        ),
        (
            "set-cookie: hatch_sess=gone; Max-Age=0\nset-cookie: hatch_sess=live-token; Max-Age=3600",
            "live-token",
        ),
        # A Unix cURL with ^" in its body must not lose carets from cookie values.
        (
            "curl 'https://muse.ai/' -d '{\"x\":\"^\"}' -b 'hatch_sess=live^token'",
            "live^token",
        ),
    ],
)
def test_set_cookie_attributes_and_caret_scope(text, expected):
    assert parse_cookie_bundle(text)[0]["hatch_sess"] == expected


def test_keepalive_without_running_workspace_records_no_keepalive(client):
    account = create_account(client)
    not_running = SessionResult(
        {"hatch_sess": SECRET}, {}, "STOPPED", code="workspace_not_running", ok=False
    )
    client.app.state.muse_client = Provider(result=not_running)
    response = client.post(f"/api/accounts/{account['id']}/keep-alive")
    assert response.status_code == 200 and response.json()["ok"] is False
    stored = client.get(f"/api/accounts/{account['id']}").json()
    assert (
        stored["lastKeepaliveAt"] is None
        and stored["lastError"] == "workspace_not_running"
    )
