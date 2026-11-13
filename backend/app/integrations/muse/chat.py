"""Isolated Muse composer client, using the reference UI selectors (see LICENSE)."""

import json
import shutil
import time
from contextlib import contextmanager
from pathlib import Path
from urllib.parse import urlsplit

from playwright.sync_api import Error as BrowserError, sync_playwright

from app.integrations.muse.client import MuseError
from app.integrations.muse.proxy import HTTPProxyRelay, ProxyConfigError

POLL_CHAT_JS = "(function(){var els=[...document.querySelectorAll('*')].filter(function(e){var s=getComputedStyle(e);return (s.overflowY==='auto'||s.overflowY==='scroll')&&e.scrollHeight>e.clientHeight+100;});els.sort(function(a,b){return b.scrollHeight-a.scrollHeight;});if(els[0])els[0].scrollTop=els[0].scrollHeight;var scope=document.querySelector('main,[class*=\"chat-scroll\"],[class*=\"hatch-chat-scroll\"]')||document.body;var bs=[].slice.call(scope.querySelectorAll('div[class*=\"hatch-chat-groupable-bubble\"]')).filter(function(b){return /hatch-agent-bubble-bg/.test(b.className||'');});var nonEmpty=bs.filter(function(b){return ((b.innerText||'').trim().length)>0;});var txt=nonEmpty.length?(nonEmpty[nonEmpty.length-1].innerText||'').trim():'';var stop=!!(document.querySelector('[data-testid=\"hatch-composer-stop-button\"]')||document.querySelector('button[aria-label*=\"Stop\" i]')||document.querySelector('button[aria-label*=\"停止\"]'));return JSON.stringify({cnt:nonEmpty.length,total:bs.length,txt:txt,stop:stop});})()"


SEND_BUTTON_JS = """() => {
    const textarea = document.querySelector('textarea');
    if (!textarea) return null;
    const visible = node => node.getClientRects().length > 0;
    for (let parent = textarea.parentElement; parent && parent !== document.body; parent = parent.parentElement) {
        const button = [...parent.querySelectorAll('button')].find(button => visible(button) && !button.disabled && button.getAttribute('aria-disabled') !== 'true' && (
            /^(hatch-composer-send-button|composer-send-button|send-button)$/.test(button.getAttribute('data-testid') || '') ||
            /^(send(?: message)?|发送(?:消息)?|發送(?:訊息)?|傳送(?:訊息)?|送出)$/i.test((button.getAttribute('aria-label') || button.innerText || '').trim())
        ));
        if (button) { const box=button.getBoundingClientRect(); return {x:box.x+box.width/2,y:box.y+box.height/2}; }
        if (parent.matches('form,main,[role=main]')) break;
    }
    return null;
}"""


GENERATING_JS = """() => !!(document.querySelector('[data-testid="hatch-composer-stop-button"]')
    || document.querySelector('button[aria-label*="Stop" i]')
    || document.querySelector('button[aria-label*="停止"]'))"""


def _open_thread(page, client, thread_path) -> bool:
    """Open a saved conversation. False when it cannot take a new message:
    it no longer exists, Muse sent us elsewhere, or it is still busy."""
    try:
        page.goto(
            client.base + thread_path, wait_until="domcontentloaded", timeout=30000
        )
        page.locator("textarea:visible").first.wait_for(state="visible", timeout=30000)
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            if urlsplit(page.url).path.rstrip("/") != thread_path:
                return False
            if not page.evaluate(GENERATING_JS):
                return True
            page.wait_for_timeout(500)
    except BrowserError:
        pass
    return False


@contextmanager
def open_composer(client, result, proxy, thread_path=None):
    """Yield a Muse thread page in a private browser context: the saved
    conversation at `thread_path` when it can be continued, otherwise a
    new one.

    Holds one browser slot for as long as the page is open. `result` is the
    confirmed session; it rides along on every error as `partial` so cookies
    Muse rotated are still saved.
    """
    if not client.browser_lock.acquire(blocking=False):
        raise MuseError("browser_busy", 409, partial=result)
    relay = None
    try:
        with sync_playwright() as playwright:
            candidates = [
                client.settings.browser_path,
                shutil.which("chromium"),
                shutil.which("google-chrome"),
                "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
                playwright.chromium.executable_path,
            ]
            executable = next(
                (path for path in candidates if path and Path(path).is_file()), None
            )
            if executable is None:
                raise MuseError("browser_unavailable", 503, partial=result)
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
                        {"name": name, "value": value, "url": client.base + "/"}
                        for name, value in result.cookies.items()
                    ]
                )
                page = context.new_page()
                if not (thread_path and _open_thread(page, client, thread_path)):
                    page.goto(
                        client.base + "/thread/new",
                        wait_until="domcontentloaded",
                        timeout=30000,
                    )
                    page.locator("textarea:visible").first.wait_for(
                        state="visible", timeout=30000
                    )
                yield page
            finally:
                browser.close()
    except ProxyConfigError:
        raise MuseError("proxy_error", 422, partial=result) from None
    except BrowserError:
        raise MuseError("generation_browser_error", partial=result) from None
    finally:
        if relay:
            relay.close()
        client.browser_lock.release()


def fill_composer(page, prompt, check_cancelled, result, wait=15):
    """Type `prompt` and return the send button's click point (not clicked yet).

    The button stays disabled while an attachment uploads; `wait` is how
    long to give it."""
    page.locator("textarea:visible").first.fill(prompt)
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        check_cancelled()
        point = page.evaluate(SEND_BUTTON_JS)
        if point:
            return point
        page.wait_for_timeout(200)
    raise MuseError("composer_unavailable", partial=result)


def confirmed_session(client, cookies, expiries, proxy, on_session, check_cancelled):
    """Refresh and confirm the session before a browser is opened."""
    result = client.session(cookies, expiries, proxy, wake=True)
    on_session(result)
    if not result.verified:
        raise MuseError(result.code, partial=result, detail=result.detail)
    # A failed or unconfirmed wake is not fatal: the chat page connects the
    # workspace itself (reference behavior). Composer/reply errors below
    # still report a workspace that really cannot be used.
    check_cancelled()
    return result


def generate_script_text(
    client,
    cookies,
    expiries,
    proxy,
    prompt,
    *,
    on_session,
    before_send,
    check_cancelled,
    timeout=300
):
    """Send once in a new browser context. Never resend on timeout."""
    result = confirmed_session(
        client, cookies, expiries, proxy, on_session, check_cancelled
    )
    with open_composer(client, result, proxy) as page:
        point = fill_composer(page, prompt, check_cancelled, result)
        baseline = json.loads(page.evaluate(POLL_CHAT_JS))
        check_cancelled()
        # Record submission BEFORE the click; refreshed cookies are already saved.
        before_send(result)
        page.mouse.click(point["x"], point["y"])
        deadline, first_deadline = (
            time.monotonic() + timeout,
            time.monotonic() + 45,
        )
        previous, stable, busy = "", 0, False
        while time.monotonic() < deadline:
            check_cancelled()
            state = json.loads(page.evaluate(POLL_CHAT_JS))
            busy = busy or state["stop"]
            text = state["txt"]
            if text and (state["cnt"] > baseline["cnt"] or text != baseline["txt"]):
                if text == previous and not state["stop"]:
                    stable += 1
                    if stable >= 5:
                        return text
                else:
                    previous, stable = text, 0
            elif not busy and time.monotonic() > first_deadline:
                raise MuseError("reply_timeout", 504, partial=result)
            page.wait_for_timeout(200)
        raise MuseError("reply_timeout", 504, partial=result)
