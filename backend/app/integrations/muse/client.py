"""Session HTTP operations and a disposable Chromium quota reader.

Protocol/usage selectors follow the reference MUSE2API implementation.
"""

import json
import logging
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
from app.integrations.muse.proxy import (
    HTTPProxyRelay,
    ProxyConfigError,
    request_proxy_context,
)
from app.integrations.muse.quota import (
    QUOTA_DIALOG_JS,
    QUOTA_MENU_JS,
    QUOTA_SETTINGS_JS,
    parse_quota,
)

logger = logging.getLogger(__name__)

VM_STATES = ("RUNNING", "STOPPED", "SLEEPING", "STARTING", "DISABLED")
QUOTA_FIELDS = (
    "plan",
    "weekly_used_pct",
    "weekly_reset",
    "extra_used_pct",
    "extra_left",
    "extra_expires",
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
    # True once /api/session confirmed an assigned workspace. Partial results
    # attached to earlier failures carry rotated cookies but prove nothing.
    verified: bool = True


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
        try:
            with request_proxy_context(proxy) as options, requests.Session() as session:
                session.trust_env = False
                return self._session(
                    session, options, dict(cookies), dict(expiries), wake
                )
        except ProxyConfigError:
            raise MuseError("proxy_error", 422) from None

    def _session(self, session, options, cookies, expiries, wake):
        response = self._request(session, "GET", "/api/session", cookies, options)
        # Muse may rotate cookies on any 200 response. Merge them first and
        # attach them to every later failure (`partial`) so they are saved.
        self._merge_cookies(response, cookies, expiries)
        result = SessionResult(cookies, expiries, None, verified=False)
        try:
            body = response.json()
        except ValueError:
            raise MuseError("invalid_response", partial=result) from None
        if not isinstance(body, dict) or body.get("status") != "assigned":
            raise MuseError("workspace_unavailable", partial=result)
        result.verified = True
        result.vm_state = (
            body.get("vm_state") if body.get("vm_state") in VM_STATES else None
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
                    self._merge_cookies(response, cookies, expiries)
                    verified = response.json()
                    result.vm_state = (
                        verified.get("vm_state")
                        if isinstance(verified, dict)
                        and verified.get("status") == "assigned"
                        and verified.get("vm_state") in VM_STATES
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
        result = self.session(cookies, expiries, proxy)
        # One Chromium at a time. Taken after the session request so other
        # accounts are not refused while it waits on the network; a refusal
        # still returns the refreshed session cookies.
        if not self.browser_lock.acquire(blocking=False):
            raise MuseError("browser_busy", 409, partial=result)
        try:
            try:
                result.quota = self._read_quota(result.cookies, proxy)
            except MuseError as error:
                error.partial = error.partial or result
                raise
            except ProxyConfigError:
                raise MuseError("proxy_error", 422, partial=result) from None
            except (BrowserError, ValueError, TypeError, KeyError) as error:
                # The session refresh above still counts. Log the cause (never
                # page text or cookies): a CSP block once hid behind this code.
                first_line = str(error).splitlines()[0][:200] if str(error) else ""
                logger.warning("Quota reader failed: %s: %s", type(error).__name__, first_line)
                raise MuseError("quota_unavailable", partial=result) from None
            result.code = "quota_updated"
            return result
        finally:
            self.browser_lock.release()

    @staticmethod
    def _dialog_quota(page):
        quota = parse_quota(page.evaluate(QUOTA_DIALOG_JS))
        return quota if quota.get("found") else None

    @staticmethod
    def _click_until(page, target_js, ready, timeout=12.0, settle=3.0):
        """Click the element `target_js` locates until `ready()` is truthy.

        Polls with page.evaluate from Python. page.wait_for_function cannot be
        used: Playwright compiles string predicates inside the page, which
        muse.ai's Content Security Policy blocks (no 'unsafe-eval'). The click
        is retried after `settle` seconds in case it landed before the app
        was ready to react.
        """
        deadline = time.monotonic() + timeout
        clicked_at = None
        while time.monotonic() < deadline:
            try:
                if clicked_at is not None:
                    value = ready()
                    if value:
                        return value
                if clicked_at is None or time.monotonic() - clicked_at >= settle:
                    target = page.evaluate(target_js)
                    if target:
                        point = json.loads(target)
                        page.mouse.click(point["x"], point["y"])
                        clicked_at = time.monotonic()
            except BrowserError:
                # A client-side navigation destroyed the execution context
                # mid-evaluate; the page is still usable, keep polling.
                pass
            page.wait_for_timeout(200)
        raise MuseError("quota_unavailable")

    def _read_quota(self, cookies, proxy) -> dict:
        relay = None
        try:
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
                        proxy=relay.browser_proxy() if relay else None
                    )
                    context.add_cookies(
                        [
                            {"name": name, "value": value, "url": self.base + "/"}
                            for name, value in cookies.items()
                        ]
                    )
                    page = context.new_page()
                    page.set_default_timeout(12000)
                    page.goto(
                        self.base + "/thread/new",
                        wait_until="domcontentloaded",
                        timeout=25000,
                    )
                    # Settings button -> "Settings" menu item -> usage dialog.
                    self._click_until(
                        page, QUOTA_SETTINGS_JS, lambda: page.evaluate(QUOTA_MENU_JS)
                    )
                    quota = self._click_until(
                        page, QUOTA_MENU_JS, lambda: self._dialog_quota(page)
                    )
                    # Persist only allowlisted usage fields, never raw DOM.
                    return {key: quota[key] for key in QUOTA_FIELDS if key in quota}
                finally:
                    browser.close()
        finally:
            if relay:
                relay.close()
