"""Isolated Muse composer client, using the reference UI selectors (see LICENSE)."""

import json
import os
import re
import shutil
import time
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

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


# A conversation's messages are found relative to our own message, which
# starts with a short label (`marker`). A conversation that already holds
# earlier messages renders them lazily, so "what was on the page before
# sending" is not a safe baseline there: only what follows our message in the
# document belongs to this request. With `all`, everything counts (callers
# then compare against a baseline themselves).
ANCHOR_JS = """
  let anchor = null;
  if (marker) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.includes(marker)) anchor = node;
    }
  }
  const after = node => all || (!!anchor
    && !!(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING));
"""

# Our message is on the page but Muse flags it as not delivered (an alert
# under it, "Delivery not confirmed"): the agent never received it, nothing
# was generated, and Muse does not keep it. Seen when a request is sent into
# a conversation whose earlier job (the script) is waiting for input.
UNDELIVERED_JS = """(marker) => {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let anchor = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.nodeValue.includes(marker)) anchor = node;
  }
  const group = anchor && anchor.parentElement
    && anchor.parentElement.closest('div[class*="group/msg"]');
  return !!(group && group.querySelector('[role="alert"]'));
}"""
# How long a message may stay flagged as not delivered before giving up.
UNDELIVERED_WAIT = 15.0


def undelivered_since(page, marker, since):
    """When our message was first seen flagged as not delivered (None while
    it is not), so callers fail once it has stayed so for UNDELIVERED_WAIT."""
    if not page.evaluate(UNDELIVERED_JS, marker):
        return None
    return since if since is not None else time.monotonic()


# A request Muse did not take is sent again in the same conversation, this
# many times in all, after a pause that grows with each try.
DELIVERY_ATTEMPTS = 3
DELIVERY_RETRY_PAUSE = 20.0


def reopen_conversation(page, client, thread_path, attempt, check_cancelled, result):
    """Load the conversation again before resending a request Muse flagged as
    not delivered. Loading it reconnects the page to the agent; the earlier
    copy was never stored, so the resend cannot arrive twice. A conversation
    that was still new opens as a new one again."""
    deadline = time.monotonic() + DELIVERY_RETRY_PAUSE * attempt
    while time.monotonic() < deadline:
        check_cancelled()
        page.wait_for_timeout(1000)
    if thread_path:
        if not _open_thread(page, client, thread_path):
            raise MuseError("message_not_delivered", partial=result)
        return
    page.goto(client.base + "/thread/new", wait_until="domcontentloaded", timeout=30000)
    page.locator("textarea:visible").first.wait_for(state="visible", timeout=30000)


# The agent's reply to our message: {sent, cnt, txt, stop}.
REPLY_STATE_JS = f"""([marker, all]) => {{
  const scrollers = [...document.querySelectorAll('*')].filter(e => {{
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 100;
  }});
  scrollers.forEach(e => {{ e.scrollTop = e.scrollHeight; }});
  {ANCHOR_JS}
  const bubbles = [...document.querySelectorAll('div[class*="hatch-chat-groupable-bubble"]')]
    .filter(b => /hatch-agent-bubble-bg/.test(b.className || ''))
    .filter(after)
    .filter(b => (b.innerText || '').trim().length > 0);
  return {{
    sent: !!anchor,
    cnt: bubbles.length,
    txt: bubbles.length ? (bubbles[bubbles.length - 1].innerText || '').trim() : '',
    stop: !!(document.querySelector('[data-testid="hatch-composer-stop-button"]')
      || document.querySelector('button[aria-label*="Stop" i]')
      || document.querySelector('button[aria-label*="停止"]')),
  }};
}}"""

CONVERSATION_SIZE_JS = """() => {
  const scrollers = [...document.querySelectorAll('*')].filter(e => {
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 100;
  });
  scrollers.forEach(e => { e.scrollTop = e.scrollHeight; });
  return document.querySelectorAll(
    'div[class*="hatch-chat-groupable-bubble"], [data-testid^="hatch-chat-attachment-presentation-"]'
  ).length;
}"""
# A real conversation, not the empty "new thread" page.
THREAD_PATH = re.compile(r"^/thread/(?!new$)[A-Za-z0-9_-]{1,100}$")
# How long to look for our own message in a continued conversation before
# falling back to comparing with what was on the page before sending.
ANCHOR_WAIT = 20.0


def thread_path_of(url: str) -> str | None:
    path = urlsplit(url).path.rstrip("/")
    return path if THREAD_PATH.fullmatch(path) else None


def settle_conversation(page) -> None:
    """Wait until a reopened conversation stops growing, so the baseline
    taken before sending includes its older messages."""
    previous, stable = None, 0
    deadline = time.monotonic() + 10
    while stable < 3 and time.monotonic() < deadline:
        size = page.evaluate(CONVERSATION_SIZE_JS)
        stable = stable + 1 if size == previous else 0
        previous = size
        page.wait_for_timeout(400)


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


def _installed(*parts: str) -> list[str]:
    """Where Windows installs a browser: under each program folder."""
    roots = (os.environ.get(name) for name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"))
    return [str(Path(root, *parts)) for root in roots if root]


def _first_browser(configured: str | None, bundled: str | None) -> str | None:
    """The Chromium to drive: the configured one, Chrome or Chromium installed
    on the machine, the one Playwright downloaded, or (on Windows, where it
    is always there) Edge."""
    candidates = [
        configured,
        shutil.which("chromium"),
        shutil.which("google-chrome"),
        shutil.which("chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        *_installed("Google", "Chrome", "Application", "chrome.exe"),
        bundled,
        *_installed("Microsoft", "Edge", "Application", "msedge.exe"),
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


@lru_cache(maxsize=4)
def find_browser(configured: str | None) -> str | None:
    """The browser `open_composer` would use, or None when there is none
    (for the status page; asked once per configured path)."""
    found = _first_browser(configured, None)
    if found:
        return found
    try:
        with sync_playwright() as playwright:
            return _first_browser(None, playwright.chromium.executable_path)
    except Exception:  # noqa: BLE001 - a missing driver is an answer here
        return None


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
            executable = _first_browser(
                client.settings.browser_path, playwright.chromium.executable_path
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


# The composer's upload control (reference: files are attached like a chat upload).
FILE_INPUT = 'input[type="file"]'


# What the composer holds: `shown` is how many attachments it displays (each
# has a preview and a remove button above the message box), `pending` how
# many files still sit in the upload control (the composer empties it once it
# has taken a file).
ATTACHED_JS = """(selector) => {
    const textarea = [...document.querySelectorAll('textarea')].find(node => node.getClientRects().length > 0);
    const control = document.querySelector(selector);
    const pending = control && control.files ? control.files.length : 0;
    if (!textarea) return {shown: 0, pending};
    let composer = textarea.parentElement;
    for (let parent = composer; parent && parent !== document.body; parent = parent.parentElement) {
        composer = parent;
        if (parent.querySelectorAll('button').length >= 2 || parent.matches('form,main,[role=main]')) break;
    }
    const removers = [...composer.querySelectorAll('button')].filter(button =>
        /remove|delete|移除|删除|刪除|削除/i.test(button.getAttribute('aria-label') || button.title || ''));
    const previews = [...composer.querySelectorAll('img,video')].filter(media =>
        /^(blob|data):/.test(media.currentSrc || media.src || ''));
    return {shown: Math.max(removers.length, previews.length), pending};
}"""
# How long one file may take to appear in the composer, and how long to
# watch after handing it over before handing it over again.
ATTACH_WAIT = 30.0
ATTACH_TRY = 2.5


def attach_files(page, files, result) -> int:
    """Attach files to the message being written, one at a time (the
    control takes a single file per change, as the reference client does),
    and return how many attachments the composer then shows.
    `files` are paths or Playwright file payloads.

    A file only counts once the composer displays it. Right after the page
    opens the upload control exists but nothing listens to it yet, so a file
    given then is silently dropped: it is given again until it appears. If
    one cannot be attached nothing is sent, so no generation is spent
    without it."""
    control = page.locator(FILE_INPUT).first
    try:
        control.wait_for(state="attached", timeout=10000)
        shown = page.evaluate(ATTACHED_JS, FILE_INPUT)["shown"]
        for file in files:
            deadline = time.monotonic() + ATTACH_WAIT
            state = {"shown": shown, "pending": 1}
            while state["shown"] <= shown:
                if time.monotonic() >= deadline:
                    raise MuseError("reference_upload_failed", partial=result)
                # Still in the control: the composer never took it. Taken
                # but not displayed yet: keep watching, a second copy would
                # be attached twice.
                if state["pending"]:
                    control.set_input_files(file)
                watch = min(deadline, time.monotonic() + ATTACH_TRY)
                while True:
                    page.wait_for_timeout(200)
                    state = page.evaluate(ATTACHED_JS, FILE_INPUT)
                    if state["shown"] > shown or time.monotonic() >= watch:
                        break
            shown = state["shown"]
        return shown
    except BrowserError:
        raise MuseError("reference_upload_failed", partial=result) from None


def fill_composer(page, prompt, check_cancelled, result, wait=15, attached=0):
    """Type `prompt` and return the send button's click point (not clicked yet).

    The button stays disabled while an attachment uploads; `wait` is how
    long to give it. `attached` is how many attachments the message must
    carry (what `attach_files` returned): if the composer lost one in the
    meantime the message is not sent."""
    page.locator("textarea:visible").first.fill(prompt)
    deadline = time.monotonic() + wait
    while time.monotonic() < deadline:
        check_cancelled()
        point = page.evaluate(SEND_BUTTON_JS)
        if point:
            if attached and page.evaluate(ATTACHED_JS, FILE_INPUT)["shown"] < attached:
                raise MuseError("reference_upload_failed", partial=result)
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
    timeout=300,
    thread_path=None,
    on_thread=None,
    attachments=(),
):
    """Send once and return the agent's reply. Never resend on timeout.

    `thread_path` continues the film's conversation, so the script is
    written in the same chat its scenes are later rendered in; `on_thread`
    is told which conversation the reply came from.
    """
    result = confirmed_session(
        client, cookies, expiries, proxy, on_session, check_cancelled
    )
    with open_composer(client, result, proxy, thread_path) as page:
        continued = bool(thread_path and thread_path_of(page.url) == thread_path)
        for attempt in range(DELIVERY_ATTEMPTS):
            if attempt:
                reopen_conversation(
                    page, client, thread_path if continued else None,
                    attempt, check_cancelled, result,
                )
            # Our message is recognised on the page by this label (see ANCHOR_JS).
            marker = f"plan-{uuid4().hex[:8]}"
            attached = 0
            if continued:
                settle_conversation(page)
            elif attachments:
                # Reference material opens the conversation; later messages
                # in it rely on the agent having seen it.
                attached = attach_files(page, [str(path) for path in attachments], result)
            point = fill_composer(
                page,
                f"[{marker}] {prompt}",
                check_cancelled,
                result,
                wait=120 if attachments and not continued else 15,
                attached=attached,
            )
            baseline = page.evaluate(REPLY_STATE_JS, [None, True])
            check_cancelled()
            # Record submission BEFORE the click; refreshed cookies are already saved.
            before_send(result)
            page.mouse.click(point["x"], point["y"])
            sent_at = time.monotonic()
            deadline, first_deadline = sent_at + timeout, sent_at + 45
            previous, stable, busy = "", 0, False
            undelivered = None
            while time.monotonic() < deadline:
                check_cancelled()
                state = page.evaluate(REPLY_STATE_JS, [marker, False])
                busy = busy or state["stop"]
                undelivered = undelivered_since(page, marker, undelivered)
                if undelivered and time.monotonic() - undelivered > UNDELIVERED_WAIT:
                    break
                text = state["txt"]
                if not state["sent"]:
                    # Our message is not found as text on the page. In a new
                    # conversation everything is ours; in a continued one, wait
                    # before trusting a comparison with the baseline.
                    text = ""
                    if not continued or time.monotonic() - sent_at > ANCHOR_WAIT:
                        state = page.evaluate(REPLY_STATE_JS, [None, True])
                        busy = busy or state["stop"]
                        if (
                            state["cnt"] > baseline["cnt"]
                            or state["txt"] != baseline["txt"]
                        ):
                            text = state["txt"]
                if text:
                    if text == previous and not state["stop"]:
                        stable += 1
                        if stable >= 5:
                            if on_thread is not None:
                                on_thread(thread_path_of(page.url))
                            return text
                    else:
                        previous, stable = text, 0
                elif not busy and time.monotonic() > first_deadline:
                    raise MuseError("reply_timeout", 504, partial=result)
                page.wait_for_timeout(200)
            else:
                raise MuseError("reply_timeout", 504, partial=result)
        raise MuseError("message_not_delivered", partial=result)
