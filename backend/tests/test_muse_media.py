"""Video generation against a local page that mimics the Muse composer.

Runs a real Chromium, so it is skipped when no browser is installed. The page
reproduces the structure the reference client relies on: the composer, agent
bubbles, attachment presentations, approval cards.
"""

import json
import os
import re
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from app.core.config import Settings
from app.integrations.muse.chat import generate_script_text
from app.integrations.muse.client import MuseClient, MuseError
from app.integrations.muse.media import (
    generate_video,
    pick_video_link,
    thread_path_of,
    video_prompt,
)

CLIP = b"\x00\x00\x00\x18ftypmp42 fake clip bytes"

PAGE = """<!doctype html><html><body><main>
<div id="chat" style="height:300px;overflow-y:auto"></div>
<form onsubmit="return false">
  <input type="file" style="display:none">
  <textarea></textarea>
  <button type="button" data-testid="hatch-composer-send-button" aria-label="Send message">Send</button>
</form>
</main><script>
const MODE = %s;
const chat = document.getElementById('chat');
const textarea = document.querySelector('textarea');
let sent = 0;
function bubble(text) {
  const node = document.createElement('div');
  node.className = 'hatch-chat-groupable-bubble hatch-agent-bubble-bg';
  node.innerText = text;
  chat.appendChild(node);
}
async function attach() {
  const bytes = await (await fetch('/media/clip.mp4')).arrayBuffer();
  const holder = document.createElement('div');
  holder.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video-1');
  const video = document.createElement('video');
  video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
  holder.appendChild(video);
  chat.appendChild(holder);
}
function approval() {
  const card = document.createElement('div');
  card.setAttribute('data-testid', 'hatch-inline-approval-card');
  const deny = document.createElement('button');
  deny.innerText = 'Deny';
  deny.onclick = () => { card.remove(); bubble('Okay, keeping it private.'); attach(); };
  card.appendChild(deny);
  chat.appendChild(card);
}
if (location.pathname === '/thread/gone') location.replace('/thread/new');
function oldClip() {
  const holder = document.createElement('div');
  holder.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video-0');
  const video = document.createElement('video');
  video.src = '/media/old.mp4';
  holder.appendChild(video);
  chat.prepend(holder);
  const reply = document.createElement('div');
  reply.className = 'hatch-chat-groupable-bubble hatch-agent-bubble-bg';
  reply.innerText = 'An earlier reply in this conversation.';
  chat.prepend(reply);
}
document.querySelector('button').onclick = () => {
  sent += 1;
  const mine = document.createElement('div');
  mine.className = 'user-bubble';
  mine.innerText = textarea.value;
  // 'hidden': a page that does not show our message as findable text.
  if (MODE !== 'hidden') chat.appendChild(mine);
  if (location.pathname === '/thread/new') history.pushState({}, '', '/thread/t-001');
  // An earlier scene of this conversation, rendered lazily after we sent.
  else setTimeout(oldClip, 100);
  const file = document.querySelector('input[type=file]').files[0];
  fetch('/__sent', { method: 'POST', body: textarea.value });
  if (file) file.arrayBuffer().then(bytes => fetch('/__file?name=' + file.name + '&type=' + file.type, { method: 'POST', body: bytes }));
  textarea.value = '';
  setTimeout(() => {
    if (MODE === 'video' || MODE === 'hidden') { bubble("Here's your video."); setTimeout(attach, 300); }
    if (MODE === 'script') bubble('{"scenes": []}');
    if (MODE === 'approval') approval();
    if (MODE === 'quota') bubble("You've reached your usage limit for this week.");
    if (MODE === 'refuse') bubble("I can't create that.");
    if (MODE === 'late') { bubble('The file is in my workspace.'); if (sent > 1) attach(); }
  }, 200);
};
</script></body></html>"""


class FakeMuse:
    def __init__(self):
        self.mode = "video"
        self.sent = []
        self.files = []  # (request path, bytes) of every uploaded attachment.
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass

            def reply(self, body, content_type="application/json"):
                self.send_response(200)
                self.send_header("Content-Type", content_type)
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_GET(self):
                if self.path == "/api/session":
                    self.reply(
                        json.dumps(
                            {"status": "assigned", "vm_id": "vm", "vm_state": "RUNNING"}
                        ).encode()
                    )
                elif self.path == "/media/clip.mp4":
                    self.reply(CLIP, "video/mp4")
                elif self.path == "/media/old.mp4":
                    self.reply(b"an earlier scene", "video/mp4")
                else:
                    self.reply(
                        (PAGE % json.dumps(fake.mode)).encode(),
                        "text/html; charset=utf-8",
                    )

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if self.path == "/__sent":
                    fake.sent.append(body.decode())
                if self.path.startswith("/__file"):
                    fake.files.append((self.path, body))
                self.reply(b"{}")

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.origin = f"http://127.0.0.1:{self.server.server_port}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def close(self):
        self.server.shutdown()
        self.server.server_close()


def find_browser():
    candidates = [
        os.environ.get("MUSE_BROWSER_PATH"),
        shutil.which("chromium"),
        shutil.which("google-chrome"),
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        r"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
        r"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    ]
    return next((path for path in candidates if path and Path(path).is_file()), None)


BROWSER = find_browser()
needs_browser = pytest.mark.skipif(BROWSER is None, reason="No Chromium browser found.")


@pytest.fixture
def muse():
    fake = FakeMuse()
    yield fake
    fake.close()


def generate(muse, **overrides):
    client = MuseClient(
        Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER)
    )
    events = []
    options = dict(
        on_session=lambda result: events.append("session"),
        before_send=lambda result: events.append("send"),
        check_cancelled=lambda: None,
        timeout=20,
        grace=1.0,
    )
    options.update(overrides)
    prompt = video_prompt("A cat in a garden", "9:16", 5)
    video = generate_video(
        client, {"hatch_sess": "media-fixture"}, {}, None, prompt, **options
    )
    return video, events


@needs_browser
def test_video_attachment_is_downloaded_from_the_page(muse):
    video, events = generate(muse)
    assert video.data == CLIP and video.mime == "video/mp4"
    assert events == ["session", "send"]
    # The message starts with the label it is later recognised by.
    assert len(muse.sent) == 1 and re.fullmatch(
        r"\[shot-[0-9a-f]{8}\] Generate a video \(aspect ratio 9:16, 5 seconds long\): "
        r"A cat in a garden",
        muse.sent[0],
    )
    assert video.thread_path == "/thread/t-001"


@needs_browser
def test_saved_conversation_is_continued_and_its_older_clips_ignored(muse):
    video, _ = generate(muse, thread_path="/thread/old-1")
    # The earlier scene's clip shows up on the page too, but it sits above
    # our message, so only the new one counts.
    assert video.data == CLIP
    assert video.thread_path == "/thread/old-1"


@needs_browser
def test_conversation_that_is_gone_falls_back_to_a_new_one(muse):
    video, _ = generate(muse, thread_path="/thread/gone")
    assert video.data == CLIP
    assert video.thread_path == "/thread/t-001"
    assert len(muse.sent) == 1


@needs_browser
def test_page_that_hides_our_message_still_works_in_a_new_conversation(muse):
    # Nothing but this request is on the page, so everything on it is ours.
    muse.mode = "hidden"
    video, _ = generate(muse)
    assert video.data == CLIP


def write_script(muse, **options):
    client = MuseClient(
        Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER)
    )
    threads = []
    text = generate_script_text(
        client,
        {"hatch_sess": "media-fixture"},
        {},
        None,
        "Write the script",
        on_session=lambda result: None,
        before_send=lambda result: None,
        check_cancelled=lambda: None,
        timeout=20,
        on_thread=threads.append,
        **options,
    )
    return text, threads


@needs_browser
def test_script_reply_is_read_and_its_conversation_reported(muse):
    muse.mode = "script"
    text, threads = write_script(muse)
    assert text == '{"scenes": []}'
    assert threads == ["/thread/t-001"]
    assert re.fullmatch(r"\[plan-[0-9a-f]{8}\] Write the script", muse.sent[0])


@needs_browser
def test_script_in_a_continued_conversation_ignores_earlier_replies(muse):
    muse.mode = "script"
    text, threads = write_script(muse, thread_path="/thread/old-1")
    assert text == '{"scenes": []}'
    assert threads == ["/thread/old-1"]


def test_only_real_conversations_are_remembered():
    assert thread_path_of("https://muse.ai/thread/abc_123-X?x=1") == "/thread/abc_123-X"
    assert thread_path_of("https://muse.ai/thread/new") is None
    assert thread_path_of("https://muse.ai/settings") is None
    assert thread_path_of("https://muse.ai/thread/a/b") is None


@needs_browser
def test_reference_frame_is_attached_to_the_message(muse):
    frame = b"\xff\xd8\xff\xe0 fake jpeg"
    video, _ = generate(muse, reference=frame)
    assert video.data == CLIP
    assert muse.files == [("/__file?name=previous-shot.jpg&type=image/jpeg", frame)]
    assert len(muse.sent) == 1


@needs_browser
def test_missing_upload_control_stops_before_sending(muse, monkeypatch):
    monkeypatch.setattr(
        "app.integrations.muse.chat.FILE_INPUT", "input.no-such-control"
    )
    with pytest.raises(MuseError) as failed:
        generate(muse, reference=b"frame")
    assert failed.value.code == "reference_upload_failed"
    assert muse.sent == []


@needs_browser
def test_approval_request_is_declined_and_the_video_still_arrives(muse):
    muse.mode = "approval"
    video, _ = generate(muse)
    assert video.data == CLIP
    assert len(muse.sent) == 1


@needs_browser
def test_text_only_reply_is_asked_once_for_the_file(muse):
    muse.mode = "late"
    video, _ = generate(muse)
    assert video.data == CLIP
    # The follow-up asks for the existing file; it is not a second generation.
    assert len(muse.sent) == 2
    assert muse.sent[1].startswith("Please attach the final video file")


@needs_browser
def test_refusal_and_quota_are_reported_without_resending(muse):
    muse.mode = "refuse"
    with pytest.raises(MuseError) as refused:
        generate(muse)
    assert refused.value.code == "generation_refused"
    assert refused.value.partial is not None
    assert len(muse.sent) == 2  # The prompt and one request to attach the file.

    muse.sent.clear()
    muse.mode = "quota"
    with pytest.raises(MuseError) as quota:
        generate(muse)
    assert quota.value.code == "quota_exhausted"
    assert len(muse.sent) == 1


@needs_browser
def test_cancel_stops_waiting(muse):
    muse.mode = "refuse"

    class Cancelled(Exception):
        pass

    calls = {"count": 0}

    def check_cancelled():
        calls["count"] += 1
        if muse.sent and calls["count"] > 5:
            raise Cancelled

    with pytest.raises(Cancelled):
        generate(muse, check_cancelled=check_cancelled, grace=30.0)
    assert len(muse.sent) == 1


def test_video_link_is_only_taken_from_real_media_urls():
    assert pick_video_link(["https://muse.ai/help", "blob:https://muse.ai/1"]) == (
        "blob:https://muse.ai/1"
    )
    assert pick_video_link(["https://cdn.example/a/clip.MP4?sig=1"]) == (
        "https://cdn.example/a/clip.MP4?sig=1"
    )
    assert pick_video_link(["https://muse.ai/thread/1", "mailto:a@b.c"]) is None
