"""Video generation through the Muse composer, using the reference UI selectors (see LICENSE)."""

import base64
import json
import re
import time
from dataclasses import dataclass
from urllib.parse import urlsplit
from uuid import uuid4

from playwright.sync_api import Error as BrowserError

from app.integrations.muse.chat import (
    confirmed_session,
    fill_composer,
    open_composer,
)
from app.integrations.muse.client import MuseError

AGENT_BUBBLE = 'div[class*="hatch-agent-bubble-bg"]'
ATTACHMENT = '[data-testid^="hatch-chat-attachment-presentation-"]'
# The agent asks before acting on the user's behalf (for example publishing
# the result as a public link). Nobody answers it here, so it would block.
APPROVAL_CARD = '[data-testid="hatch-inline-approval-card"]'
# The composer's upload control (reference: images are attached like a chat upload).
FILE_INPUT = 'input[type="file"]'
QUOTA_HINTS = ("out of credits", "usage limit", "limit reached", "token limit")
# A real conversation, not the empty "new thread" page.
THREAD_PATH = re.compile(r"^/thread/(?!new$)[A-Za-z0-9_-]{1,100}$")

# Everything is read relative to our own message, found by the marker it
# starts with. A conversation that already holds earlier scenes renders them
# lazily, so "what was on the page before sending" is not a safe baseline:
# only what follows our message in the document belongs to this request.
_ANCHOR_JS = """
  let anchor = null;
  if (marker) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.nodeValue.includes(marker)) anchor = node;
    }
  }
  const after = node => !!anchor
    && !!(anchor.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING);
"""

MEDIA_STATE_JS = f"""marker => {{
  const scrollers = [...document.querySelectorAll('*')].filter(e => {{
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50;
  }});
  scrollers.forEach(e => {{ e.scrollTop = e.scrollHeight; }});
  {_ANCHOR_JS}
  const bubbles = [...document.querySelectorAll({json.dumps(AGENT_BUBBLE)})].filter(after);
  const last = bubbles.length ? (bubbles[bubbles.length - 1].innerText || '').trim() : '';
  const attachments = [...document.querySelectorAll({json.dumps(ATTACHMENT)})].filter(after).map(a => {{
    const v = a.querySelector('video'), i = a.querySelector('img');
    const m = v || i;
    return {{
      tid: a.getAttribute('data-testid') || '',
      kind: v ? 'video' : (i ? 'image' : 'unknown'),
      src: m ? (m.currentSrc || m.src || '') : '',
      w: m ? (m.videoWidth || m.naturalWidth || 0) : 0,
      h: m ? (m.videoHeight || m.naturalHeight || 0) : 0,
    }};
  }});
  return {{
    sent: !!anchor,
    agentCount: bubbles.length,
    lastText: last,
    generating: !!(document.querySelector('[data-testid="hatch-composer-stop-button"]')
      || document.querySelector('button[aria-label*="Stop" i]')
      || document.querySelector('button[aria-label*="停止"]')),
    approval: !!document.querySelector({json.dumps(APPROVAL_CARD)}),
    attachments,
  }};
}}"""

# Decline every pending approval card; the agent then carries on without the
# action and the result stays private instead of becoming a public link.
DENY_APPROVALS_JS = f"""() => {{
  let denied = 0;
  for (const card of document.querySelectorAll({json.dumps(APPROVAL_CARD)})) {{
    const button = [...card.querySelectorAll('button,[role=button]')]
      .find(b => /^(deny|decline|reject|don.t allow)$/i.test((b.innerText || '').trim()));
    if (button && !button.disabled) {{ button.click(); denied += 1; }}
  }}
  return denied;
}}"""

# Media delivered as a link or bare <video> in the reply instead of an attachment.
LAST_BUBBLE_LINKS_JS = f"""marker => {{
  {_ANCHOR_JS}
  const bubbles = [...document.querySelectorAll({json.dumps(AGENT_BUBBLE)})].filter(after);
  const bubble = bubbles.length ? bubbles[bubbles.length - 1] : null;
  if (!bubble) return [];
  const urls = [];
  const push = url => {{ if (url && !urls.includes(url)) urls.push(url); }};
  bubble.querySelectorAll('video, source').forEach(m => push(m.currentSrc || m.src || ''));
  bubble.querySelectorAll('a[href]').forEach(a => push(a.href || ''));
  const pattern = /https?:\\/\\/[^\\s)<>"']+/g;
  let match;
  while ((match = pattern.exec(bubble.innerText || ''))) push(match[0]);
  return urls;
}}"""

# Runs inside the page so blob: URLs and the session's cookies both work.
FETCH_MEDIA_JS = """async url => {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return { ok: response.ok, mime: blob.type || '', b64: btoa(text) };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}"""

VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".m4v")
POLL_MS = 600
# Muse posts its closing sentence a while before the attachment's source is
# ready, so a reply that is text-only right now may still be finalising.
ATTACHMENT_GRACE = 90.0
# The timeout is soft while Muse is visibly still working: giving up then
# would throw away a video that lands a minute later.
OVERRUN_FACTOR = 2.5


@dataclass
class GeneratedVideo:
    data: bytes
    mime: str
    width: int | None = None
    height: int | None = None
    # The conversation the video was made in ("/thread/<id>"), so the next
    # scene of the same film can continue there. None when it is unknown.
    thread_path: str | None = None


def video_prompt(prompt: str, aspect_ratio: str, duration_seconds: int) -> str:
    return (
        f"Generate a video (aspect ratio {aspect_ratio}, "
        f"{duration_seconds} seconds long): {prompt}"
    )


def pick_video_link(links: list[str]) -> str | None:
    for link in links:
        path = link.lower().split("?", 1)[0].split("#", 1)[0]
        if link.startswith("blob:") or path.endswith(VIDEO_EXTENSIONS):
            return link
    return None


def thread_path_of(url: str) -> str | None:
    path = urlsplit(url).path.rstrip("/")
    return path if THREAD_PATH.fullmatch(path) else None


def generate_video(
    client,
    cookies,
    expiries,
    proxy,
    prompt,
    *,
    on_session,
    before_send,
    check_cancelled,
    timeout=600,
    grace=ATTACHMENT_GRACE,
    reference: bytes | None = None,
    thread_path: str | None = None,
) -> GeneratedVideo:
    """Ask Muse for one video and download the result.

    `thread_path` continues an existing conversation, so every scene of a
    film shares one chat and the agent keeps its context. If that
    conversation cannot be opened, a new one is started instead.

    `reference` is a JPEG attached to the message (a frame of the previous
    scene); the prompt says how to use it. If it cannot be attached the
    request is not sent, so no generation is spent on a scene that would
    ignore it.

    The request is sent once. A timeout or an unknown outcome is reported,
    never resent: the caller decides whether to spend another generation.
    """
    result = confirmed_session(
        client, cookies, expiries, proxy, on_session, check_cancelled
    )
    # Our message is recognised on the page by this label (see _ANCHOR_JS).
    marker = f"shot-{uuid4().hex[:8]}"
    with open_composer(client, result, proxy, thread_path) as page:
        if reference:
            _attach_reference(page, reference, result)
        point = fill_composer(
            page,
            f"[{marker}] {prompt}",
            check_cancelled,
            result,
            wait=60 if reference else 15,
        )
        check_cancelled()
        # Record submission BEFORE the click; refreshed cookies are already saved.
        before_send(result)
        page.mouse.click(point["x"], point["y"])
        attachment = _wait_for_video(
            page, marker, check_cancelled, result, timeout, grace
        )
        fetched = page.evaluate(FETCH_MEDIA_JS, attachment["src"])
        if not fetched.get("ok") or not fetched.get("b64"):
            raise MuseError("media_download_failed", partial=result)
        return GeneratedVideo(
            data=base64.b64decode(fetched["b64"]),
            mime=fetched.get("mime") or "video/mp4",
            width=attachment.get("w") or None,
            height=attachment.get("h") or None,
            thread_path=thread_path_of(page.url),
        )


def _attach_reference(page, image: bytes, result) -> None:
    control = page.locator(FILE_INPUT).first
    try:
        control.wait_for(state="attached", timeout=10000)
        control.set_input_files(
            {"name": "previous-shot.jpg", "mimeType": "image/jpeg", "buffer": image}
        )
    except BrowserError:
        raise MuseError("reference_upload_failed", partial=result) from None
    # Let the composer register the file before the prompt is typed.
    page.wait_for_timeout(1000)


def _wait_for_video(page, marker, check_cancelled, result, timeout, grace):
    agent_count = 0
    started = time.monotonic()
    text_done_at = None
    asked_to_attach = denied = busy = False
    while True:
        elapsed = time.monotonic() - started
        if elapsed >= timeout and not (busy and elapsed < timeout * OVERRUN_FACTOR):
            raise MuseError("generation_timeout", 504, partial=result)
        check_cancelled()
        page.wait_for_timeout(POLL_MS)
        state = page.evaluate(MEDIA_STATE_JS, marker)
        if state["approval"]:
            page.evaluate(DENY_APPROVALS_JS)
            denied, text_done_at = True, None
            continue
        busy = state["generating"]
        if not state["sent"]:
            # Our message is not on the page yet.
            continue
        fresh = state["attachments"]
        ready = [a for a in fresh if a["kind"] == "video" and a["src"]]
        if ready:
            return ready[-1]
        loading = any("video" in a["tid"] for a in fresh)
        busy = busy or loading
        if loading:
            # The attachment is on the page but its source has not loaded yet.
            text_done_at = None
            continue
        text = state["lastText"]
        if not (state["agentCount"] > agent_count and text and not state["generating"]):
            text_done_at = None
            continue
        # A finished reply without a video: a refusal, or the attachment lags.
        lowered = text.lower()
        if any(hint in lowered for hint in QUOTA_HINTS):
            raise MuseError("quota_exhausted", 429, partial=result)
        if text_done_at is None:
            text_done_at = time.monotonic()
            continue
        if time.monotonic() - text_done_at < grace:
            continue
        if not asked_to_attach:
            # The agent often finishes with the file only in its workspace
            # (after a declined upload, or when it shows a gallery instead).
            # Asking once gets the final file attached; it does not start
            # another generation.
            request = "Please attach the final video file here in the chat" + (
                " instead of uploading it." if denied else ", as a single attachment."
            )
            point = fill_composer(page, request, check_cancelled, result)
            page.mouse.click(point["x"], point["y"])
            asked_to_attach, text_done_at = True, None
            agent_count = state["agentCount"]
            continue
        link = pick_video_link(page.evaluate(LAST_BUBBLE_LINKS_JS, marker))
        if link:
            return {"src": link, "kind": "video"}
        raise MuseError(
            "generation_refused", partial=result, detail="Muse replied without a video"
        )
