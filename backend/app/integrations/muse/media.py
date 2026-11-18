"""Image and video generation through the Muse composer (see LICENSE)."""

import base64
import json
import time
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from app.integrations.muse.chat import (
    SENT_JS,
    SHOW_JS,
    UNDELIVERED_JS,
    DELIVERY_ATTEMPTS,
    UNDELIVERED_WAIT,
    reopen_conversation,
    undelivered_since,
    ANCHOR_JS,
    ANCHOR_WAIT,
    attach_files,
    attach_request,
    confirmed_session,
    fill_composer,
    open_composer,
    settle_conversation,
    thread_path_of,
)
from app.integrations.muse.client import MuseError

AGENT_BUBBLE = 'div[class*="hatch-agent-bubble-bg"]'
ATTACHMENT = '[data-testid^="hatch-chat-attachment-presentation-"]'
# The agent asks before acting on the user's behalf (for example publishing
# the result as a public link). Nobody answers it here, so it would block.
APPROVAL_CARD = '[data-testid="hatch-inline-approval-card"]'
QUOTA_HINTS = ("out of credits", "usage limit", "limit reached", "token limit")
READ_LINKS_JS = """bubble => {
  const urls = [];
  const push = url => { if (url && !urls.includes(url)) urls.push(url); };
  bubble.querySelectorAll('video, source, img').forEach(m => push(m.currentSrc || m.src || ''));
  bubble.querySelectorAll('a[href]').forEach(a => push(a.href || ''));
  const pattern = /https?:\\/\\/[^\\s)<>"']+/g;
  let match;
  while ((match = pattern.exec(bubble.innerText || ''))) push(match[0]);
  return urls;
}"""

MEDIA_STATE_JS = f"""([marker, all, stay, includeLinks]) => {{
  // `stay`: keep the view where it is (on a message taken back), instead of
  // following the conversation's end.
  const scrollers = stay ? [] : [...document.querySelectorAll('*')].filter(e => {{
    const s = getComputedStyle(e);
    return (s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50;
  }});
  scrollers.forEach(e => {{ e.scrollTop = e.scrollHeight; }});
  {ANCHOR_JS}
  const bubbles = [...document.querySelectorAll({json.dumps(AGENT_BUBBLE)})].filter(after);
  const last = bubbles.length ? (bubbles[bubbles.length - 1].innerText || '').trim() : '';
  // A file we attached is shown with our own message: before the agent's
  // first reply and lined up with our bubble. It is not a result.
  const mine = anchor && anchor.parentElement
    ? anchor.parentElement.closest('div[class*="hatch-chat-groupable-bubble"]') : null;
  const ownEdge = mine ? mine.getBoundingClientRect().right : null;
  const own = a => ownEdge !== null && Math.abs(a.getBoundingClientRect().right - ownEdge) <= 2
    && (!bubbles.length || !!(bubbles[0].compareDocumentPosition(a) & Node.DOCUMENT_POSITION_PRECEDING));
  let followUpIndex = 0;
  let titles = Object.create(null);
  const attachments = [...document.querySelectorAll({json.dumps(ATTACHMENT)})].filter(after)
  .filter(a => !a.closest('form, [data-testid*="composer"], [class*="user-bubble"], [class*="hatch-user-bubble"]'))
  .filter(a => !own(a))
  .flatMap(a => {{
    const tid = a.getAttribute('data-testid') || '';
    const item = (m, name) => ({{
      tid,
      kind: m ? (m.tagName === 'VIDEO' ? 'video' : 'image') : 'unknown',
      src: m ? (m.currentSrc || m.src || '') : '',
      w: m ? (m.videoWidth || m.naturalWidth || 0) : 0,
      h: m ? (m.videoHeight || m.naturalHeight || 0) : 0,
      name,
    }});
    // Count repeated titles across the whole reply, including separate
    // attachments. A request to attach the same files again starts the
    // same numbering so their copies can be skipped by title and order.
    while (followUpIndex < followUps.length &&
        (followUps[followUpIndex].compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING)) {{
      titles = Object.create(null);
      followUpIndex += 1;
    }}
    // Muse can show several files in one grid, one per Open button.
    const openers = [...a.querySelectorAll('button[aria-label^="Open"]')];
    const named = b => {{
      const title = (b.getAttribute('title') || b.getAttribute('aria-label') || '').trim();
      if (!title) return '';
      const n = titles[title] = (titles[title] || 0) + 1;
      return n > 1 || / #[0-9]+$/.test(title) ? title + ' #' + n : title;
    }};
    // A picture still being finished (its button busy) may show a preview
    // meanwhile: it is not ready yet.
    const ready = (b, m) => m && m.tagName === 'IMG' && b && b.getAttribute('aria-busy') === 'true' ? null : m;
    if (openers.length > 1) return openers.map(b => item(
      ready(b, b.querySelector('video') || b.querySelector('img')), named(b)));
    const b = openers[0];
    return [item(ready(b, a.querySelector('video') || a.querySelector('img')), b ? named(b) : '')];
  }});
  return {{
    sent: !!anchor,
    // Another of this app's messages follows ours.
    bounded: !!next,
    agentCount: bubbles.length,
    lastText: last,
    generating: !!(document.querySelector('[data-testid="hatch-composer-stop-button"]')
      || document.querySelector('button[aria-label*="Stop" i]')
      || document.querySelector('button[aria-label*="停止"]')),
    approval: !!document.querySelector({json.dumps(APPROVAL_CARD)}),
    attachments,
    links: includeLinks ? bubbles.flatMap({READ_LINKS_JS}) : [],
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
LAST_BUBBLE_LINKS_JS = f"""([marker, all]) => {{
  {ANCHOR_JS}
  const bubbles = [...document.querySelectorAll({json.dumps(AGENT_BUBBLE)})].filter(after);
  const bubble = bubbles.length ? bubbles[bubbles.length - 1] : null;
  return bubble ? ({READ_LINKS_JS})(bubble) : [];
}}"""

# Runs inside the page so blob: URLs and the session's cookies both work.
# A download that never finishes must not hold the page (and the task).
FETCH_SECONDS = 180
FETCH_MEDIA_JS = """async url => {
  try {
    // Given up after FETCH_SECONDS: a download that never ends must not
    // hold the page, and the task with it.
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), 180000);
    const response = await fetch(url, { signal: stop.signal });
    const blob = await response.blob();
    clearTimeout(timer);
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
IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp")
POLL_MS = 600
# Muse posts its closing sentence a while before the attachment's source is
# ready, so a reply that is text-only right now may still be finalising.
ATTACHMENT_GRACE = 90.0
# The timeout is soft while Muse is visibly still working: giving up then
# would throw away a video that lands a minute later.
OVERRUN_FACTOR = 2.5
# How long an attachment may stay without its file once Muse has finished
# before the file is asked for again.
STALLED_ATTACHMENT = 60.0


@dataclass
class GeneratedMedia:
    data: bytes
    mime: str
    width: int | None = None
    height: int | None = None
    # The conversation the video was made in ("/thread/<id>"), so the next
    # scene of the same film can continue there. None when it is unknown.
    thread_path: str | None = None
    # The file's name on the page ("dragon 1"). A copy Muse attaches again
    # has the same name. None when the page shows none.
    name: str | None = None


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


def _linked_images(links, seen):
    for url in links:
        if url in seen:
            continue
        try:
            path = urlsplit(url)
        except ValueError:
            continue
        if path.path.lower().endswith(IMAGE_EXTENSIONS):
            name = "link:" + path._replace(fragment="").geturl()
            yield {"src": url, "kind": "image", "name": name}


def _linked_media(links, media_kind, seen):
    if media_kind == "image":
        return next(_linked_images(links, seen), None)
    link = pick_video_link(links)
    return {"src": link, "kind": media_kind} if link and link not in seen else None


GeneratedVideo = GeneratedMedia


def generate_video(*args, **kwargs) -> GeneratedMedia:
    return _generate_media(*args, media_kind="video", **kwargs)


def generate_image(*args, **kwargs) -> GeneratedMedia:
    return _generate_media(*args, media_kind="image", **kwargs)


def generate_images(*args, count: int, **kwargs) -> list[GeneratedMedia]:
    """Send one request for a set of images, in one conversation."""
    return _generate_media(*args, media_kind="image", count=count, many=True, **kwargs)


def _generate_media(
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
    attachments=(),
    media_kind="video",
    count=1,
    many=False,
    on_thread=None,
    on_media=None,
    attach_on_continue=False,
    require_thread=False,
    fresh=None,
    on_marker=None,
) -> GeneratedMedia | list[GeneratedMedia]:
    """Ask Muse for one image or video and download the result.

    `thread_path` continues an existing conversation, so every scene of a
    film shares one chat and the agent keeps its context. If that
    conversation cannot be opened, a new one is started instead.

    `reference` is a JPEG attached to the message (a frame of the previous
    scene); the prompt says how to use it. If it cannot be attached the
    request is not sent, so no generation is spent on a scene that would
    ignore it.

    The request is sent once. A timeout or an unknown outcome is reported,
    never resent: the caller decides whether to spend another generation.
    Only a copy Muse flagged as not delivered (never stored, nothing made)
    is sent again, in the same conversation.

    `fresh` is the (prompt, attachments) to send instead when `thread_path`
    cannot be continued and a new conversation is opened: a first message
    must stand on its own (see app/rendering/conversation.py).

    `on_marker` is told the label of each message just before it is sent,
    so a request whose outcome is lost can be taken back (`recover_media`).
    """
    result = confirmed_session(
        client, cookies, expiries, proxy, on_session, check_cancelled
    )
    with open_composer(client, result, proxy, thread_path) as page:
        # A fresh composer can receive its thread id before the first send.
        # Only the requested saved conversation counts as a continuation.
        continued = bool(thread_path and thread_path_of(page.url) == thread_path)
        if require_thread and thread_path and not continued:
            raise MuseError("conversation_unavailable", partial=result)
        if thread_path and not continued:
            if on_thread:
                # The saved conversation was not used: until the new one
                # shows its id, a retry must not take the old path for it.
                on_thread(None)
            if fresh is not None:
                prompt, attachments = fresh
        downloaded = []
        saved_thread = None
        retry_thread = thread_path_of(page.url)

        def remember_thread():
            nonlocal saved_thread, retry_thread
            current = thread_path_of(page.url)
            if current and current != saved_thread:
                saved_thread = current
                retry_thread = current
                if on_thread:
                    on_thread(current)

        def receive(attachment):
            remember_thread()
            media = _download(page, attachment, media_kind, result)
            if on_media:
                on_media(media)
            downloaded.append(media)

        remember_thread()
        for attempt in range(DELIVERY_ATTEMPTS):
            if attempt:
                # Muse did not take the last copy and did not keep it: the
                # same conversation, loaded again, gets it once more.
                reopen_conversation(
                    page,
                    client,
                    retry_thread,
                    attempt,
                    check_cancelled,
                    result,
                    started=retry_thread != thread_path,
                )
            # Our message is recognised on the page by this label (see ANCHOR_JS).
            marker = f"shot-{uuid4().hex[:8]}"
            if continued:
                settle_conversation(page)
            files = []
            if attachments and (not continued or attach_on_continue):
                # Films attach references once; Quick Create explicitly attaches
                # its selected reference even when resuming the same conversation.
                files += [
                    str(file) if isinstance(file, (str, Path)) else file
                    for file in attachments
                ]
            if reference:
                files.append(
                    {
                        "name": "previous-shot.jpg",
                        "mimeType": "image/jpeg",
                        "buffer": reference,
                    }
                )
            attached = attach_files(page, files, result) if files else 0
            point = fill_composer(
                page,
                f"[{marker}] {prompt}",
                check_cancelled,
                result,
                wait=120 if files else 15,
                attached=attached,
            )
            baseline = page.evaluate(MEDIA_STATE_JS, [None, True])
            check_cancelled()
            if on_marker:
                # With the conversation the page is on (None: a new one,
                # whose id is learned after sending).
                on_marker(marker, thread_path_of(page.url))
            # Record submission BEFORE the click; refreshed cookies are already saved.
            before_send(result)
            page.mouse.click(point["x"], point["y"])
            try:
                _wait_for_media(
                    page,
                    marker,
                    baseline,
                    continued,
                    check_cancelled,
                    result,
                    timeout,
                    grace,
                    media_kind=media_kind,
                    count=count,
                    on_ready=receive,
                    on_poll=remember_thread,
                )
            except MuseError as error:
                if (
                    error.code == "message_not_delivered"
                    and not downloaded
                    and attempt + 1 < DELIVERY_ATTEMPTS
                ):
                    continue
                raise
            return downloaded if many else downloaded[0]


def _download(page, attachment, media_kind, result) -> GeneratedMedia:
    """The bytes behind an attachment on the page."""
    fetched = page.evaluate(FETCH_MEDIA_JS, attachment["src"])
    if not fetched.get("ok") or not fetched.get("b64"):
        raise MuseError("media_download_failed", partial=result)
    return GeneratedMedia(
        data=base64.b64decode(fetched["b64"]),
        mime=fetched.get("mime")
        or ("image/png" if media_kind == "image" else "video/mp4"),
        width=attachment.get("w") or None,
        height=attachment.get("h") or None,
        thread_path=thread_path_of(page.url),
        name=attachment.get("name") or None,
    )


def _new_file(attachment, names) -> bool:
    """False for a file already taken, by its name (see MEDIA_STATE_JS): a
    copy Muse attached again, smaller, under the same name (2026-11-17), or
    the same picture shown from another source. One without a name counts
    by its source alone."""
    name = attachment.get("name")
    if not name:
        return True
    if name in names:
        return False
    names.add(name)
    return True


# Looking further up a conversation for an older message.
HISTORY_CLIMBS = 30
CLIMB_JS = """() => document.querySelectorAll('*').forEach(e => {
  const s = getComputedStyle(e);
  if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50)
    e.scrollTop = Math.max(0, e.scrollTop - e.clientHeight);
})"""
TOP_JS = """() => [...document.querySelectorAll('*')].every(e => {
  const s = getComputedStyle(e);
  return !((s.overflowY === 'auto' || s.overflowY === 'scroll') && e.scrollHeight > e.clientHeight + 50)
    || e.scrollTop === 0;
})"""


def recover_media(
    client,
    cookies,
    expiries,
    proxy,
    *,
    thread_path: str,
    marker: str,
    on_session,
    check_cancelled,
    timeout=600,
    grace=ATTACHMENT_GRACE,
    media_kind="video",
    count=1,
    skip=(),
    many=False,
) -> GeneratedMedia | list[GeneratedMedia] | None:
    """Take back what Muse made for a message this app already sent, found
    in `thread_path` by its `marker`, without sending it again (at most the
    usual request to attach a file Muse kept in its workspace).

    None when the message is not in that conversation: it never arrived and
    nothing was made, so the caller sends a new one. Only what follows that
    message counts; nothing else on the page is ever taken for it. A reply
    still being written is waited for (`conversation_busy`, nothing sent).

    `many`: the answer is a set of pictures (also when one is still
    missing): every file in it counts, a list is returned, and nothing is
    asked for. `skip`: names of files already saved from it; they are not
    taken again.
    """
    result = confirmed_session(
        client, cookies, expiries, proxy, on_session, check_cancelled
    )
    with open_composer(client, result, proxy, thread_path) as page:
        if thread_path_of(page.url) != thread_path:
            # It could not be opened just now: that is no sign our message
            # never arrived. Keep it for a later try.
            raise MuseError("conversation_unavailable", partial=result)
        settle_conversation(page)
        deadline = time.monotonic() + ANCHOR_WAIT
        climbs = 0
        while not page.evaluate(SENT_JS, marker):
            check_cancelled()
            if time.monotonic() >= deadline:
                # Older messages may only load further up: look there before
                # concluding it is not in the conversation.
                if page.evaluate(TOP_JS):
                    return None
                if climbs >= HISTORY_CLIMBS:
                    # Not found, but not everything was looked at: unknown.
                    raise MuseError("conversation_unavailable", partial=result)
                climbs += 1
                page.evaluate(CLIMB_JS)
            page.wait_for_timeout(500)
        if page.evaluate(UNDELIVERED_JS, marker):
            return None
        page.evaluate(SHOW_JS, marker)
        if many or count > 1:
            return _collect_answered(
                page, marker, media_kind, count, result, check_cancelled, timeout, skip
            )
        found = []
        _wait_for_media(
            page,
            marker,
            {"attachments": [], "agentCount": 0},
            True,
            check_cancelled,
            result,
            timeout,
            grace,
            media_kind=media_kind,
            on_ready=lambda attachment: found.append(
                _download(page, attachment, media_kind, result)
            ),
            anchored_only=True,
        )
        return found[0]


# A batch taken back is settled once Muse has been idle this long.
BATCH_SETTLE = 10.0


def _collect_answered(
    page, marker, media_kind, count, result, check_cancelled, timeout, skip=()
):
    """Every file (up to `count`) that answers our message, as many as Muse
    made: a batch taken back may hold fewer than asked, and the rest is then
    asked for again. Nothing is sent from here: asking for "all" files again
    would bring back ones already counted (an approval the agent waits for
    is declined, as when sending). Files named in `skip` were saved before
    and are passed over, as are copies of one already taken.

    Fewer files than asked are only reported once Muse has been quiet for
    BATCH_SETTLE: not answering, no new file, none loading. Until then the
    outcome is unknown, and at the deadline that is a timeout (the request
    is kept), never a count. A file that stays without its source once Muse
    is done (as "Video not found" did on 2026-11-16) counts as not made
    STALLED_ATTACHMENT after it showed up."""
    collected, seen, names = [], set(), set(skip)
    loading_since = {}
    quiet_since = None
    deadline = time.monotonic() + timeout
    while len(collected) < count:
        if time.monotonic() >= deadline:
            raise MuseError("generation_timeout", 504, partial=result)
        check_cancelled()
        page.wait_for_timeout(POLL_MS)
        state = page.evaluate(
            MEDIA_STATE_JS, [marker, False, True, media_kind == "image"]
        )
        if not state["sent"]:
            quiet_since = None
            continue
        if state["approval"]:
            # The agent waits for an answer (as when sending): declined, it
            # carries on; until then the answer is not complete.
            page.evaluate(DENY_APPROVALS_JS)
            quiet_since = None
            continue
        grew = False
        for attachment in state["attachments"]:
            if (
                attachment["kind"] != media_kind
                or not attachment["src"]
                or attachment["src"] in seen
                or len(collected) >= count
            ):
                continue
            seen.add(attachment["src"])
            if _new_file(attachment, names):
                collected.append(_download(page, attachment, media_kind, result))
                grew = True
        now = time.monotonic()
        # Each file's time to load counts from when it showed up, and only
        # once Muse has stopped answering.
        loading_since = {
            key: now if state["generating"] else loading_since.get(key, now)
            for key in (
                a.get("name") or index
                for index, a in enumerate(state["attachments"])
                if media_kind in a["tid"] and not a["src"]
            )
        }
        loading = any(
            now - since <= STALLED_ATTACHMENT for since in loading_since.values()
        )
        if len(collected) < count and not state["generating"] and not loading:
            for image in _linked_images(state.get("links", ()), seen):
                seen.add(image["src"])
                if _new_file(image, names):
                    collected.append(_download(page, image, media_kind, result))
                    grew = True
                    if len(collected) >= count:
                        break
        if state["generating"] or loading or grew:
            quiet_since = None
            continue
        quiet_since = quiet_since or now
        if now - quiet_since > BATCH_SETTLE:
            break
    return collected


def _read_state(page, marker, baseline, anchor_wait, sent_at, anchored_only=False):
    """The page relative to our message: by its label when the page shows
    it, otherwise by comparing with what was there before sending."""
    state = page.evaluate(MEDIA_STATE_JS, [marker, False, anchored_only])
    if state["sent"]:
        known_sources = {a["src"] for a in baseline["attachments"] if a["src"]}
        state["attachments"] = [
            a for a in state["attachments"] if a["src"] not in known_sources
        ]
        return state
    if anchored_only or time.monotonic() - sent_at < anchor_wait:
        return state  # Not sent yet, as far as we can tell.
    known = {(a["tid"], a["src"]) for a in baseline["attachments"]}
    state = page.evaluate(MEDIA_STATE_JS, [None, True])
    state["attachments"] = [
        a for a in state["attachments"] if (a["tid"], a["src"]) not in known
    ]
    state["agentCount"] = max(0, state["agentCount"] - baseline["agentCount"])
    if not state["agentCount"]:
        state["lastText"] = ""
    state["sent"], state["anchored"] = True, False
    return state


def _wait_for_media(
    page,
    marker,
    baseline,
    continued,
    check_cancelled,
    result,
    timeout,
    grace,
    media_kind="video",
    count=1,
    on_ready=None,
    on_poll=None,
    anchored_only=False,
):
    # `anchored_only`: only what follows our message counts, never a guess
    # from comparing with the page as it was (taking a sent request back).
    # A new conversation holds nothing but this request, so the baseline
    # comparison is safe at once; a continued one gets time to show our
    # message first.
    anchor_wait = ANCHOR_WAIT if continued else 0.0
    agent_count = 0
    started = time.monotonic()
    text_done_at = None
    asked_to_attach = denied = busy = False
    stalled_since = None
    seen = set()
    # Names of the files taken (see _new_file).
    names = set()
    collected = []
    undelivered = None
    received = False
    while True:
        elapsed = time.monotonic() - started
        if elapsed >= timeout and not (busy and elapsed < timeout * OVERRUN_FACTOR):
            raise MuseError("generation_timeout", 504, partial=result)
        check_cancelled()
        page.wait_for_timeout(POLL_MS)
        if on_poll:
            on_poll()
        state = _read_state(page, marker, baseline, anchor_wait, started, anchored_only)
        if state["approval"]:
            page.evaluate(DENY_APPROVALS_JS)
            denied, text_done_at = True, None
            continue
        busy = state["generating"]
        received = received or bool(state["agentCount"] or state["attachments"])
        undelivered = None if received else undelivered_since(page, marker, undelivered)
        if undelivered and time.monotonic() - undelivered > UNDELIVERED_WAIT:
            raise MuseError("message_not_delivered", partial=result)
        if not state["sent"]:
            # Our message is not on the page yet.
            continue
        fresh = state["attachments"]
        for attachment in fresh:
            if (
                attachment["kind"] != media_kind
                or not attachment["src"]
                or attachment["src"] in seen
            ):
                continue
            seen.add(attachment["src"])
            if not _new_file(attachment, names):
                continue
            if on_ready:
                on_ready(attachment)
            collected.append(attachment)
            text_done_at = None
            if len(collected) >= count:
                return collected
        loading = any(media_kind in a["tid"] and not a["src"] for a in fresh)
        if loading and count == 1 and not state["generating"]:
            # Muse has finished, yet the attachment never gets its file (it
            # showed "Video not found" on 2026-11-16): after a while, ask for
            # the file again (below) instead of waiting for it to load.
            stalled_since = stalled_since or time.monotonic()
            if time.monotonic() - stalled_since > STALLED_ATTACHMENT:
                loading = False
        else:
            stalled_since = None
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
        if state.get("bounded"):
            # Our message is not the latest: a file asked for again would be
            # attached after the later ones, out of our reach. Take a link
            # that answers it, if there is one; otherwise wait (timeout).
            links = page.evaluate(LAST_BUBBLE_LINKS_JS, [marker, False])
            media = _linked_media(links, media_kind, seen)
            if media and on_ready:
                on_ready(media)
                return [media]
            text_done_at = None
            continue
        if not asked_to_attach:
            # The agent often finishes with the file only in its workspace
            # (after a declined upload, or when it shows a gallery instead).
            # Asking once gets the final file attached; it does not start
            # another generation.
            request = attach_request(media_kind, count, denied)
            point = fill_composer(page, request, check_cancelled, result)
            page.mouse.click(point["x"], point["y"])
            asked_to_attach, text_done_at = True, None
            agent_count = state["agentCount"]
            continue
        links = page.evaluate(
            LAST_BUBBLE_LINKS_JS, [marker, not state.get("anchored", True)]
        )
        attachment = _linked_media(links, media_kind, seen)
        if attachment:
            if on_ready:
                on_ready(attachment)
            collected.append(attachment)
            if len(collected) >= count:
                return collected
        raise MuseError(
            "image_count_mismatch" if collected else "generation_refused",
            partial=result,
            detail=f"Muse replied without a {media_kind}",
        )
