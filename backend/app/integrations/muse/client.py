"""Session HTTP operations and a disposable Chromium quota reader.

Protocol/usage selectors follow the reference MUSE2API implementation.
"""

import json
import shutil
import threading
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit

import requests
from playwright.sync_api import Error as BrowserError, sync_playwright

from app.core.config import Settings
from app.integrations.muse.proxy import HTTPProxyRelay, request_proxy_context
from app.integrations.muse.quota import (
    QUOTA_DIALOG_JS,
    QUOTA_MENU_JS,
    QUOTA_SETTINGS_JS,
    parse_quota,
)


class MuseError(Exception):
    def __init__(self, code: str, status: int = 502, partial=None):
        super().__init__(code)
        self.code, self.status, self.partial = code, status, partial


@dataclass
class SessionResult:
    cookies: dict[str, str]
    expiries: dict[str, int]
    vm_state: str | None
    code: str = "session_valid"
    ok: bool = True
    quota: dict | None = None


class MuseClient:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.base = settings.upstream_url
        self.browser_lock = threading.Lock()

    def _request(self, session, method, path, cookies, options, **kwargs):
        try:
            response = session.request(
                method,
                self.base + path,
                headers={
                    "Cookie": "; ".join(
                        f"{name}={value}" for name, value in cookies.items() if value
                    ),
                    "Origin": f"{urlsplit(self.base).scheme}://{urlsplit(self.base).netloc}",
                    "Referer": self.base + "/thread/new",
                    "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36",
                },
                timeout=self.settings.upstream_timeout,
                allow_redirects=False,
                **options,
                **kwargs,
            )
        except requests.Timeout:
            raise MuseError("upstream_timeout", 504) from None
        except requests.RequestException:
            raise MuseError(
                "proxy_error" if options.get("proxies") else "network_error"
            ) from None
        if response.status_code == 401:
            raise MuseError("session_invalid", 401)
        if response.status_code != 200:
            code = {403: "access_denied", 407: "proxy_error", 429: "rate_limited"}.get(
                response.status_code, "upstream_error"
            )
            raise MuseError(code)
        return response

    def _merge_cookies(self, response, cookies, expiries):
        host = urlsplit(self.base).hostname
        for cookie in response.cookies:
            domain = cookie.domain.lstrip(".")
            if (
                domain
                and domain not in (host, host + ".local")
                and not host.endswith("." + domain)
            ):
                continue
            if cookie.expires is not None and cookie.expires <= time.time():
                cookies.pop(cookie.name, None)
                expiries.pop(cookie.name, None)
            else:
                cookies[cookie.name] = cookie.value
                if cookie.expires:
                    expiries[cookie.name] = cookie.expires
                else:
                    expiries.pop(cookie.name, None)

    def session(self, cookies, expiries, proxy=None, wake=False):
        cookies, expiries = dict(cookies), dict(expiries)
        with request_proxy_context(proxy) as options, requests.Session() as session:
            session.trust_env = False
            response = self._request(session, "GET", "/api/session", cookies, options)
            try:
                body = response.json()
            except ValueError:
                raise MuseError("invalid_response") from None
            if not isinstance(body, dict) or body.get("status") != "assigned":
                raise MuseError("workspace_unavailable")
            self._merge_cookies(response, cookies, expiries)
            result = SessionResult(
                cookies,
                expiries,
                (
                    body.get("vm_state")
                    if body.get("vm_state")
                    in ("RUNNING", "STOPPED", "SLEEPING", "STARTING", "DISABLED")
                    else None
                ),
            )
            if wake:
                result.code = "keepalive_complete"
                if not body.get("vm_id") or body.get("vm_state") == "DISABLED":
                    result.ok, result.code = False, "workspace_not_running"
                else:
                    try:
                        response = self._request(
                            session,
                            "POST",
                            "/api/hatch/vm/wake",
                            cookies,
                            options,
                            json={
                                "vm_id": body["vm_id"],
                                "retry_count": 0,
                                "connect_attempt_id": str(uuid.uuid4()),
                            },
                        )
                        self._merge_cookies(response, cookies, expiries)
                        response = self._request(
                            session, "GET", "/api/session", cookies, options
                        )
                        verified = response.json()
                        self._merge_cookies(response, cookies, expiries)
                        result.vm_state = (
                            verified.get("vm_state")
                            if isinstance(verified, dict)
                            and verified.get("status") == "assigned"
                            and verified.get("vm_state")
                            in (
                                "RUNNING",
                                "STOPPED",
                                "SLEEPING",
                                "STARTING",
                                "DISABLED",
                            )
                            else None
                        )
                        if result.vm_state != "RUNNING":
                            result.ok, result.code = False, "workspace_not_running"
                    except MuseError as error:
                        error.partial = result
                        raise
                    except ValueError:
                        raise MuseError("invalid_response", partial=result) from None
            if not cookies.get("hatch_sess"):
                raise MuseError("session_invalid", 401)
            return result

    def quota(self, cookies, expiries, proxy=None):
        if not self.browser_lock.acquire(blocking=False):
            raise MuseError("browser_busy", 409)
        relay = None
        try:
            result = self.session(cookies, expiries, proxy)
            with sync_playwright() as playwright:
                candidates = [
                    self.settings.browser_path,
                    shutil.which("chromium"),
                    shutil.which("google-chrome"),
                    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                    playwright.chromium.executable_path,
                ]
                executable = next(
                    (path for path in candidates if path and Path(path).is_file()), None
                )
                if executable is None:
                    raise MuseError("browser_unavailable", 503)
                if proxy:
                    relay = HTTPProxyRelay(proxy)
                browser = playwright.chromium.launch(
                    executable_path=executable, headless=True
                )
                try:
                    context = browser.new_context(
                        proxy={"server": relay.url} if relay else None
                    )
                    context.add_cookies(
                        [
                            {"name": name, "value": value, "url": self.base + "/"}
                            for name, value in result.cookies.items()
                        ]
                    )
                    page = context.new_page()
                    page.set_default_timeout(12000)
                    page.goto(
                        self.base + "/thread/new",
                        wait_until="domcontentloaded",
                        timeout=25000,
                    )
                    for expression in (QUOTA_SETTINGS_JS, QUOTA_MENU_JS):
                        page.wait_for_function(expression, timeout=12000)
                        point = json.loads(page.evaluate(expression))
                        page.mouse.click(point["x"], point["y"])
                    deadline = time.monotonic() + 12
                    while time.monotonic() < deadline:
                        quota = parse_quota(page.evaluate(QUOTA_DIALOG_JS))
                        if quota.get("found"):
                            # Persist only allowlisted usage fields, never raw DOM.
                            result.quota = {
                                key: quota[key]
                                for key in (
                                    "plan",
                                    "weekly_used_pct",
                                    "weekly_reset",
                                    "extra_used_pct",
                                    "extra_left",
                                    "extra_expires",
                                )
                                if key in quota
                            }
                            result.code = "quota_updated"
                            return result
                        page.wait_for_timeout(200)
                    raise MuseError("quota_unavailable")
                finally:
                    browser.close()
        except BrowserError:
            raise MuseError("quota_unavailable") from None
        finally:
            if relay:
                relay.close()
            self.browser_lock.release()
