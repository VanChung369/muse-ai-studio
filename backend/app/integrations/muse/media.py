"""Video generation through the Muse composer, using the reference UI selectors (see LICENSE)."""

import base64
import json
import time
from dataclasses import dataclass

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
QUOTA_HINTS = ("out of credits", "usage limit", "limit reached", "token limit")

MEDIA_STATE_JS = f"""() => {{
  const scrollers = [...document.querySelectorAll('*')].filter(e => {{
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50;
  }});
  scrollers.forEach(e => {{ e.scrollTop = e.scrollHeight; }});
  const bubbles = [...document.querySelectorAll({json.dumps(AGENT_BUBBLE)})];
  const last = bubbles.length ? (bubbles[bubbles.length - 1].innerText || '').trim() : '';
  const attachments = [...document.querySelectorAll({json.dumps(ATTACHMENT)})].map(a => {{
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
LAST_BUBBLE_LINKS_JS = f"""() => {{
  const bubbles = [...document.querySelectorAll({json.dumps(AGENT_BUBBLE)})];
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
) -> GeneratedVideo:
    """Ask Muse for one video in a new thread and download the result.

    The request is sent once. A timeout or an unknown outcome is reported,
    never resent: the caller decides whether to spend another generation.
    """
    result = confirmed_session(
        client, cookies, expiries, proxy, on_session, check_cancelled
    )
    with open_composer(client, result, proxy) as page:
        point = fill_composer(page, prompt, check_cancelled, result)
        baseline = page.evaluate(MEDIA_STATE_JS)
        check_cancelled()
        # Record submission BEFORE the click; refreshed cookies are already saved.
        before_send(result)
        page.mouse.click(point["x"], point["y"])
        attachment = _wait_for_video(
            page, baseline, check_cancelled, result, timeout, grace
        )
        fetched = page.evaluate(FETCH_MEDIA_JS, attachment["src"])
        if not fetched.get("ok") or not fetched.get("b64"):
            raise MuseError("media_download_failed", partial=result)
        return GeneratedVideo(
            data=base64.b64decode(fetched["b64"]),
            mime=fetched.get("mime") or "video/mp4",
            width=attachment.get("w") or None,
            height=attachment.get("h") or None,
        )


def _wait_for_video(page, baseline, check_cancelled, result, timeout, grace):
    known = len(baseline["attachments"])
    agent_count = baseline["agentCount"]
    started = time.monotonic()
    text_done_at = None
    asked_to_attach = denied = busy = False
    while True:
        elapsed = time.monotonic() - started
        if elapsed >= timeout and not (busy and elapsed < timeout * OVERRUN_FACTOR):
            raise MuseError("generation_timeout", 504, partial=result)
        check_cancelled()
        page.wait_for_timeout(POLL_MS)
        state = page.evaluate(MEDIA_STATE_JS)
        if state["approval"]:
            page.evaluate(DENY_APPROVALS_JS)
            denied, text_done_at = True, None
            continue
        fresh = state["attachments"][known:]
        ready = [a for a in fresh if a["kind"] == "video" and a["src"]]
        if ready:
            return ready[-1]
        loading = any("video" in a["tid"] for a in fresh)
        busy = state["generating"] or loading
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
        link = pick_video_link(page.evaluate(LAST_BUBBLE_LINKS_JS))
        if link:
            return {"src": link, "kind": "video"}
        raise MuseError(
            "generation_refused", partial=result, detail="Muse replied without a video"
        )
