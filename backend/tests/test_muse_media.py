"""Video generation against a local page that mimics the Muse composer.

Runs a real Chromium, so it is skipped when no browser is installed. The page
reproduces the structure the reference client relies on: the composer, agent
bubbles, attachment presentations, approval cards.
"""

import json
import os
import shutil
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from app.core.config import Settings
from app.integrations.muse.client import MuseClient, MuseError
from app.integrations.muse.media import generate_video, pick_video_link, video_prompt

CLIP = b"\x00\x00\x00\x18ftypmp42 fake clip bytes"

PAGE = """<!doctype html><html><body><main>
<div id="chat" style="height:300px;overflow-y:auto"></div>
<form onsubmit="return false">
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
document.querySelector('button').onclick = () => {
  sent += 1;
  fetch('/__sent', { method: 'POST', body: textarea.value });
  textarea.value = '';
  setTimeout(() => {
    if (MODE === 'video') { bubble("Here's your video."); setTimeout(attach, 300); }
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
                else:
                    self.reply(
                        (PAGE % json.dumps(fake.mode)).encode(), "text/html; charset=utf-8"
                    )

            def do_POST(self):
                body = self.rfile.read(int(self.headers.get("Content-Length") or 0))
                if self.path == "/__sent":
                    fake.sent.append(body.decode())
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
    assert muse.sent == [
        "Generate a video (aspect ratio 9:16, 5 seconds long): A cat in a garden"
    ]


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
