"""Video generation against a local page that mimics the Muse composer.

Runs a real Chromium, so it is skipped when no browser is installed. The page
reproduces the structure the reference client relies on: the composer, agent
bubbles, attachment presentations, approval cards.
"""

import base64
import json
import os
import re
import shutil
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest
from playwright.sync_api import Error as BrowserError, sync_playwright
from types import SimpleNamespace

from app.core.config import Settings
from app.integrations.muse import chat
from app.integrations.muse.chat import generate_script_text
from app.integrations.muse.client import MuseClient, MuseError
from app.integrations.muse import media
from app.integrations.muse.media import (
    recover_media,
    generate_image,
    generate_images,
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
function attachImage(index = 0) {
  const holder = document.createElement('div');
  holder.setAttribute('data-testid', 'hatch-chat-attachment-presentation-image-' + index);
  const image = document.createElement('img');
  image.src = URL.createObjectURL(new Blob([index ? 'test image bytes ' + index : 'test image bytes'], { type: 'image/png' }));
  holder.appendChild(image);
  chat.appendChild(holder);
}
// As muse.ai shows a set of pictures (2026-11-17): ONE attachment holding a
// grid, each picture behind its own "Open generated image <name>" button.
// `busy`: pictures still loading.
function grid(names, prefix, busy = []) {
  const holder = document.createElement('div');
  holder.setAttribute('data-testid', 'hatch-chat-attachment-presentation-image');
  for (const name of names) {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = name;
    button.setAttribute('aria-label', 'Open generated image ' + name);
    button.setAttribute('aria-busy', busy.includes(name) ? 'true' : 'false');
    if (!busy.includes(name)) {
      const image = document.createElement('img');
      image.src = URL.createObjectURL(new Blob([prefix + ' ' + name], { type: 'image/png' }));
      button.appendChild(image);
    }
    holder.appendChild(button);
  }
  chat.appendChild(holder);
}
// A user message as muse.ai renders one: a screen-reader "You:" label.
function typed(text) {
  const node = document.createElement('div');
  const you = document.createElement('span');
  you.className = 'sr-only';
  you.textContent = 'You:';
  const words = document.createElement('p');
  words.textContent = text;
  node.append(you, words);
  chat.appendChild(node);
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
if (location.pathname === '/thread/new' && MODE === 'image-auto-thread') history.replaceState({}, '', '/thread/auto-created');
// Like the real composer: a file it has taken is shown inside the composer
// with a thumbnail and a remove button, and the upload control is emptied.
function preview(file, bytes) {
  const holder = document.createElement('div');
  holder.setAttribute('data-testid', 'hatch-composer-attachment');
  const image = document.createElement('img');
  image.src = URL.createObjectURL(new Blob([bytes], {type: file.type}));
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.setAttribute('aria-label', 'Remove attachment');
  holder.append(image, remove);
  document.querySelector('form').appendChild(holder);
}
const held = [];
if (MODE === 'image-auto-thread' || MODE === 'image-reference') {
  document.querySelector('input[type=file]').onchange = async event => {
    const file = event.target.files[0];
    const send = document.querySelector('form button');
    send.disabled = true;
    const bytes = await file.arrayBuffer();
    await fetch('/__file?name=' + file.name + '&type=' + file.type, {method: 'POST', body: bytes});
    preview(file, bytes);
    event.target.value = '';
    setTimeout(() => { send.disabled = false; }, 1200);
  };
} else if (MODE !== 'deaf-composer') {
  // 'slow-composer': as on the real page, nothing listens to the upload
  // control for a moment after loading, and a file given then is dropped.
  setTimeout(() => {
    document.querySelector('input[type=file]').onchange = async event => {
      const file = event.target.files[0];
      const bytes = await file.arrayBuffer();
      held.push([file, bytes]);
      preview(file, bytes);
      event.target.value = '';
    };
  }, MODE === 'slow-composer' ? 1500 : 0);
}
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
// A saved conversation shows its earlier messages. 'slow-history': like
// muse.ai on a cold workspace, a loading placeholder comes up a moment after
// the composer and stays a while; 'never-loads': it stays.
const saved = location.pathname.startsWith('/thread/') && !['/thread/new', '/thread/gone'].includes(location.pathname);
let historyShown = !saved;
if (saved && (MODE === 'slow-history' || MODE === 'never-loads')) {
  setTimeout(() => {
    const loading = document.createElement('div');
    loading.setAttribute('data-hatch-loading-state', 'chat_history');
    loading.innerHTML = '<div data-testid="chat-empty-loading">Loading</div>';
    chat.appendChild(loading);
    if (MODE === 'slow-history') setTimeout(() => { loading.remove(); oldClip(); historyShown = true; }, 2500);
  }, 300);
} else if (saved) {
  bubble('The script is ready.');
  if (MODE.startsWith('answered')) {
    // An earlier scene of this conversation, then a request this app sent
    // whose outcome it lost: Muse answered it (now, later, or with a clip
    // whose file never shows).
    oldClip();
    const mine = document.createElement('div');
    mine.className = 'user-bubble';
    mine.innerText = '[shot-cafe0001] Generate a video (aspect ratio 16:9, 10 seconds long): a cat';
    chat.appendChild(mine);
    bubble("Here's your video.");
    if (MODE === 'answered') attach();
    if (MODE === 'answered-then-typed' || MODE === 'answered-then-link') {
      // Ours, then a request someone typed in Muse by hand (no label, shown
      // with Muse's "You:" label), whose clip is ready while ours is not;
      // or ours answered with a link to the file instead of an attachment,
      // followed by a later request of this app.
      if (MODE === 'answered-then-link') {
        const reply = document.createElement('div');
        reply.className = 'hatch-chat-groupable-bubble hatch-agent-bubble-bg';
        reply.innerHTML = 'Done: <a href="/media/clip.mp4">clip.mp4</a>';
        chat.appendChild(reply);
        const later = document.createElement('div');
        later.className = 'user-bubble';
        later.innerText = '[' + 'shot-beef0002' + '] Generate a video: a dog';
        chat.appendChild(later);
        bubble("Here's the dog.");
      } else {
        const ours = document.createElement('div');
        ours.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
        chat.appendChild(ours);
        const typed = document.createElement('div');
        const you = document.createElement('span');
        you.className = 'sr-only';
        you.textContent = 'You:';
        const words = document.createElement('p');
        words.textContent = 'Generate a dog video';
        typed.append(you, words);
        chat.appendChild(typed);
        const theirs = document.createElement('div');
        theirs.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
        const clip = document.createElement('video');
        clip.src = '/media/old.mp4';
        theirs.appendChild(clip);
        chat.appendChild(theirs);
        setTimeout(async () => {
          const bytes = await (await fetch('/media/clip.mp4')).arrayBuffer();
          const video = document.createElement('video');
          video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
          ours.appendChild(video);
        }, 4000);
      }
    }
    if (MODE === 'answered-collapsed') {
      // As muse.ai keeps messages out of view (2026-11-17): our clip loads
      // slowly; a reply quoting our label and a later request are collapsed
      // to screen-reader text; the later request's clip is ready.
      const ours = document.createElement('div');
      ours.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
      chat.appendChild(ours);
      const reader = (text) => {
        const span = document.createElement('span');
        span.className = 'sr-only';
        span.textContent = text;
        chat.appendChild(span);
      };
      reader('Assistant message: Here is shot 1 [' + 'shot-cafe0001' + '], as asked.');
      reader('Assistant message: [' + 'shot-cafe0001' + '] done.');
      reader('User message: [' + 'shot-beef0002' + '] Generate a video: a dog');
      const theirs = document.createElement('div');
      theirs.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
      const clip = document.createElement('video');
      clip.src = '/media/old.mp4';
      theirs.appendChild(clip);
      chat.appendChild(theirs);
      setTimeout(async () => {
        const bytes = await (await fetch('/media/clip.mp4')).arrayBuffer();
        const video = document.createElement('video');
        video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        ours.appendChild(video);
      }, 4000);
    }
    if (MODE === 'answered-then-more') {
      // Ours is answered but its clip loads slowly, and the conversation went
      // on: a later request's clip is on the page, ready, below it.
      const ours = document.createElement('div');
      ours.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
      chat.appendChild(ours);
      const later = document.createElement('div');
      later.className = 'user-bubble';
      later.innerText = '[' + 'shot-beef0002' + '] Generate a video: a dog';
      chat.appendChild(later);
      bubble("Here's the dog.");
      const theirs = document.createElement('div');
      theirs.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
      const clip = document.createElement('video');
      clip.src = '/media/old.mp4';
      theirs.appendChild(clip);
      chat.appendChild(theirs);
      setTimeout(async () => {
        const bytes = await (await fetch('/media/clip.mp4')).arrayBuffer();
        const video = document.createElement('video');
        video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        ours.appendChild(video);
      }, 4000);
    }
    if (MODE === 'answered-late') setTimeout(attach, 1500);
    if (MODE === 'answered-stalled') {
      const holder = document.createElement('div');
      holder.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
      holder.innerText = 'Video not found';
      chat.appendChild(holder);
    }
  }
  if (MODE.startsWith('taken-')) {
    // A set of pictures this app asked for, answered as muse.ai does
    // (2026-11-17): one attachment holding a grid of them.
    const mine = document.createElement('div');
    mine.className = 'user-bubble';
    mine.innerText = '[' + 'shot-cafe0003' + '] Generate exactly 2 separate images (aspect ratio 1:1): a turtle';
    chat.appendChild(mine);
    bubble('Done: 2 separate turtle images.');
    if (MODE === 'taken-grid') grid(['turtle 1', 'turtle 2'], 'full');
    if (MODE === 'taken-loading') grid(['turtle 1', 'turtle 2'], 'full', ['turtle 2']);
    if (MODE === 'taken-reattached') {
      // One picture attached; this app's follow-up; Muse attaching the files
      // again, smaller, under the same names.
      grid(['turtle 1'], 'full');
      typed('Please attach all 2 final image files from this request here in the chat, as separate attachments. Do not generate more images or upload them elsewhere.');
      bubble('Here are the 2 final images, re-attached separately.');
      grid(['turtle 1', 'turtle 2'], 'copy');
    }
    if (MODE === 'taken-typed') {
      // One picture, then a request typed in Muse by hand that only starts
      // like this app's follow-up, answered with another picture.
      grid(['turtle 1'], 'full');
      typed('Please attach a newly generated dog image');
      bubble('Here is a dog.');
      grid(['dog 1'], 'dog');
    }
    // Two pictures of one attachment under the same title.
    // Two pictures of one attachment under the same title, and one whose
    // title looks like a numbered one.
    if (MODE === 'taken-twins') {
      grid(['turtle', 'turtle', 'turtle #2'], 'full');
      chat.querySelectorAll('button[title="turtle"] img')[1].src =
        URL.createObjectURL(new Blob(['second turtle'], { type: 'image/png' }));
    }
    // The same, under a title that is also a property of every JS object.
    if (MODE === 'taken-proto') {
      grid(['constructor', 'constructor'], 'full');
      chat.querySelectorAll('button[title="constructor"] img')[1].src =
        URL.createObjectURL(new Blob(['second constructor'], { type: 'image/png' }));
    }
    if (MODE === 'taken-busy') {
      // A picture still being finished: a preview behind a busy button, the
      // final file a few seconds later (after the page is read).
      grid(['turtle 1'], 'preview');
      const button = chat.querySelector('button[title="turtle 1"]');
      button.setAttribute('aria-busy', 'true');
      setTimeout(() => {
        button.querySelector('img').src = URL.createObjectURL(new Blob(['final turtle 1'], { type: 'image/png' }));
        button.setAttribute('aria-busy', 'false');
      }, 6000);
    }
  }
  historyShown = true;
}
document.querySelector('form button').onclick = () => {
  sent += 1;
  if (!historyShown) fetch('/__early', { method: 'POST' });
  const label = (textarea.value.match(/shot-[0-9a-f]{8}/) || [''])[0];
  const asked = textarea.value;
  const mine = document.createElement('div');
  mine.className = 'user-bubble';
  mine.innerText = textarea.value;
  // 'hidden': a page that does not show our message as findable text.
  if (MODE !== 'hidden') chat.appendChild(mine);
  if (location.pathname === '/thread/new') history.pushState({}, '', '/thread/t-001');
  // An earlier scene of this conversation, rendered lazily after we sent.
  else if (MODE !== 'slow-history') setTimeout(oldClip, 100);
  fetch('/__sent', { method: 'POST', body: textarea.value });
  held.splice(0).forEach(([file, bytes]) => fetch('/__file?name=' + file.name + '&type=' + file.type, { method: 'POST', body: bytes }));
  document.querySelectorAll('[data-testid="hatch-composer-attachment"]').forEach(node => node.remove());
  textarea.value = '';
  setTimeout(() => {
    if (MODE === 'video' || MODE === 'hidden' || MODE === 'slow-composer' || MODE === 'slow-history') { bubble("Here's your video."); setTimeout(attach, 300); }
    if (MODE === 'answered-stalled' && /Please attach/.test(asked)) {
      bubble("Here it is again.");
      setTimeout(attach, 300);
    }
    if (MODE === 'named-file' || MODE === 'file-card' || MODE === 'echo-label') {
      // As on muse.ai (2026-11-16): the clip's box shows before its video has
      // loaded, and the closing reply names the file after our label
      // ('named-file'). Variants: the name outside a reply bubble
      // ('file-card'), and a reply quoting the label as sent ('echo-label').
      bubble('Generating the video now.');
      const holder = document.createElement('div');
      holder.setAttribute('data-testid', 'hatch-chat-attachment-presentation-video');
      chat.appendChild(holder);
      const file = 'media-generation-' + label + '-a-cat-in-a-garden-0.mp4';
      setTimeout(() => {
        if (MODE === 'named-file') bubble('File: imagine_media/' + file);
        if (MODE === 'echo-label') bubble('Done with [' + label + '].');
        if (MODE === 'file-card') {
          const card = document.createElement('div');
          card.innerText = file;
          chat.appendChild(card);
        }
      }, 300);
      setTimeout(async () => {
        const bytes = await (await fetch('/media/clip.mp4')).arrayBuffer();
        const video = document.createElement('video');
        video.src = URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' }));
        holder.appendChild(video);
      }, 900);
    }
    if (MODE === 'images-grid' || MODE === 'images-grid-short') {
      // All four in one grid; or three, and all four again (smaller) once
      // this app asks for the files.
      const all = ['garden 1', 'garden 2', 'garden 3', 'garden 4'];
      if (/^Please attach all/.test(asked)) {
        bubble('Here are the 4 final images, re-attached separately.');
        setTimeout(() => grid(all, 'copy'), 300);
      } else {
        bubble('Here are your four images.');
        setTimeout(() => grid(MODE === 'images-grid' ? all : all.slice(0, 3), 'full'), 300);
      }
    }
    if (MODE === 'image') { bubble("Here's your image."); setTimeout(attachImage, 300); }
    if (MODE === 'images') {
      bubble("Here are your four images.");
      for (let i = 0; i < 4; i++) setTimeout(() => attachImage(i), 150 + i * 200);
    }
    if (MODE === 'image-auto-thread' || MODE === 'image-reference') { bubble("Here's your image."); setTimeout(attachImage, 300); }
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
        self.events = []
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
                    fake.events.append("send")
                    fake.sent.append(body.decode())
                if self.path == "/__early":
                    fake.events.append("sent-while-loading")
                if self.path.startswith("/__file"):
                    fake.events.append("upload")
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
def test_image_attachment_is_downloaded_from_the_page(muse):
    muse.mode = "image"
    events = []
    client = MuseClient(Settings(
        _env_file=None, upstream_url=muse.origin, browser_path=BROWSER
    ))
    image = generate_image(
        client, {"hatch_sess": "media-fixture"}, {}, None,
        "Generate exactly one image of a garden, aspect ratio 1:1.",
        on_session=lambda result: events.append("session"),
        before_send=lambda result: events.append("send"),
        check_cancelled=lambda: None, timeout=20, grace=1.0,
    )
    assert image.data == b"test image bytes"
    assert image.mime == "image/png"
    assert events == ["session", "send"]
    assert len(muse.sent) == 1


@needs_browser
def test_four_images_are_downloaded_after_one_message_in_one_thread(muse):
    muse.mode = "images"
    client = MuseClient(Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER))
    outputs, threads = [], []
    images = generate_images(
        client, {"hatch_sess": "media-fixture"}, {}, None,
        "Generate exactly 4 separate images of a garden.", count=4,
        on_session=lambda result: None, before_send=lambda result: None,
        check_cancelled=lambda: None, on_media=outputs.append, on_thread=threads.append,
        timeout=20, grace=1.0,
    )
    assert len(images) == len(outputs) == 4
    assert len({image.data for image in images}) == 4
    assert {image.thread_path for image in images} == {"/thread/t-001"}
    assert threads == ["/thread/t-001"]
    assert len(muse.sent) == 1


@needs_browser
@pytest.mark.parametrize("thread", [None, "/thread/old-1"])
def test_reference_upload_finishes_before_image_prompt_even_when_new_page_has_thread_id(muse, thread):
    muse.mode = "image-auto-thread" if thread is None else "image-reference"
    client = MuseClient(Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER))
    image = generate_image(
        client, {"hatch_sess": "media-fixture"}, {}, None,
        "Create one image using the attached visual reference.",
        on_session=lambda result: None, before_send=lambda result: None,
        check_cancelled=lambda: None, thread_path=thread,
        attach_on_continue=True,
        attachments=[{"name": "reference.png", "mimeType": "image/png", "buffer": b"reference bytes"}],
        timeout=20, grace=1.0,
    )
    assert image.data == b"test image bytes"  # The output, not the composer's reference preview.
    assert muse.events == ["upload", "send"]
    assert muse.files == [("/__file?name=reference.png&type=image/png", b"reference bytes")]
    assert len(muse.sent) == 1


@needs_browser
def test_required_batch_conversation_never_sends_into_a_replacement_thread(muse):
    client = MuseClient(Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER))
    with pytest.raises(MuseError) as failed:
        generate_images(
            client, {"hatch_sess": "media-fixture"}, {}, None, "Generate 4 images.", count=4,
            on_session=lambda result: None, before_send=lambda result: None,
            check_cancelled=lambda: None, thread_path="/thread/gone", require_thread=True,
            timeout=20, grace=1.0,
        )
    assert failed.value.code == "conversation_unavailable"
    assert muse.sent == []


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
@pytest.mark.parametrize("thread", [None, "/thread/old-1"])
@pytest.mark.parametrize("mode", ["named-file", "file-card", "echo-label"])
def test_reply_that_names_the_file_after_our_label_does_not_hide_the_clip(muse, mode, thread):
    # muse.ai, 2026-11-16: the agent ends with "File: …media-generation-shot-…mp4"
    # below the clip. That mention is not our message; taking it for one put
    # the clip "before" our message and the scene timed out. 'file-card' needs
    # the label as sent ("[shot-…]"), 'echo-label' needs replies left out.
    muse.mode = mode
    video, events = generate(muse, thread_path=thread)
    assert video.data == CLIP
    assert events == ["session", "send"]
    assert len(muse.sent) == 1  # No "Please attach…" follow-up was needed.


@needs_browser
def test_saved_conversation_is_not_written_to_while_it_is_still_loading(muse):
    # Sent before the earlier messages are on the page, the baseline is empty
    # and an earlier scene's clip could pass for the new one.
    muse.mode = "slow-history"
    video, _ = generate(muse, thread_path="/thread/old-1")
    assert "sent-while-loading" not in muse.events
    assert video.data == CLIP
    assert video.thread_path == "/thread/old-1"
    assert len(muse.sent) == 1


@needs_browser
def test_saved_conversation_that_never_loads_is_waited_for_not_replaced(muse, monkeypatch):
    monkeypatch.setattr(chat, "HISTORY_LOAD_WAIT", 3.0)
    muse.mode = "never-loads"
    with pytest.raises(MuseError) as failed:
        generate(muse, thread_path="/thread/old-1")
    # Nothing sent, so the task waits and tries again (TaskDeferred).
    assert failed.value.code == "conversation_busy"
    assert getattr(failed.value, "unsent", False) is True
    assert muse.sent == []


# The real page while the workspace connects (muse.ai, 2026-11-16): the
# composer shows one button only, so a climb that stops at two buttons ends at
# the whole app, conversation included, where every clip is a blob too.
LOOSE_COMPOSER = """<!doctype html><html><body>
<div class="app">
  <button aria-label="Search">s</button><button aria-label="Settings">o</button>
  <div class="feed">
    <div class="hatch-chat-groupable-bubble hatch-agent-bubble-bg">Shot 2 of 6 is done.</div>
    <div data-testid="hatch-chat-attachment-presentation-video">
      <video src="blob:https://muse.test/clip-1"></video><img src="blob:https://muse.test/poster-1">
    </div>
  </div>
  <div class="dock"><div class="pill">
    %s
    <button aria-label="Attach file">+</button>
    <div><input type="file"><textarea aria-label="Message"></textarea></div>
  </div></div>
</div></body></html>"""
PREVIEW = '<img src="blob:https://muse.test/reference"><button aria-label="Remove attachment">x</button>'


@needs_browser
def test_attachment_count_never_takes_the_conversations_clips():
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path=BROWSER, headless=True)
        try:
            page = browser.new_page()
            page.set_content(LOOSE_COMPOSER % "")
            assert page.evaluate(chat.ATTACHED_JS, chat.FILE_INPUT)["shown"] == 0
            page.set_content(LOOSE_COMPOSER % PREVIEW)
            assert page.evaluate(chat.ATTACHED_JS, chat.FILE_INPUT)["shown"] == 1
        finally:
            browser.close()


class PageStub:
    """Just enough of a page for _open_thread. `states` are what the history
    probe returns in turn (the last one repeats); an exception is raised."""

    def __init__(self, states, *, redirect=None, generating=False):
        self.states = list(states)
        self.redirect = redirect
        self.generating = generating
        self.url = ""
        self.waits = 0

    def goto(self, url, **_):
        self.url = self.redirect or url

    def locator(self, _):
        return SimpleNamespace(first=SimpleNamespace(wait_for=lambda **_: None))

    def evaluate(self, script, *args):
        if script == chat.GENERATING_JS:
            return self.generating
        assert script == chat.HISTORY_STATE_JS
        state = self.states.pop(0) if len(self.states) > 1 else self.states[0]
        if isinstance(state, Exception):
            raise state
        return state

    def wait_for_timeout(self, _):
        self.waits += 1


SITE = SimpleNamespace(base="https://muse.test")
LOADING = {"loading": True, "size": 0}
LOADED = {"loading": False, "size": 3}
EMPTY = {"loading": False, "size": 0}


def test_page_error_while_the_history_loads_does_not_open_a_new_conversation():
    gone = BrowserError("Execution context was destroyed, most likely because of a navigation")
    page = PageStub([LOADING, gone, gone, LOADING, LOADED])
    assert chat._open_thread(page, SITE, "/thread/old-1") is True


def test_composer_shown_before_the_placeholder_still_waits_for_the_history():
    page = PageStub([EMPTY, LOADING, LOADING, LOADED])
    assert chat._open_thread(page, SITE, "/thread/old-1") is True
    assert page.waits >= 3


def test_history_still_loading_at_the_limit_is_busy_not_gone(monkeypatch):
    monkeypatch.setattr(chat, "HISTORY_LOAD_WAIT", 0.05)
    with pytest.raises(chat.ConversationBusy):
        chat._open_thread(PageStub([LOADING]), SITE, "/thread/old-1")
    with pytest.raises(chat.ConversationBusy):
        chat._open_thread(PageStub([BrowserError("unreadable")]), SITE, "/thread/old-1")


def test_saved_conversation_showing_no_messages_is_used_at_the_limit(monkeypatch):
    monkeypatch.setattr(chat, "HISTORY_LOAD_WAIT", 0.05)
    assert chat._open_thread(PageStub([EMPTY]), SITE, "/thread/old-1") is True


def test_conversation_muse_redirects_away_from_counts_as_gone():
    page = PageStub([LOADING], redirect="https://muse.test/thread/new")
    assert chat._open_thread(page, SITE, "/thread/old-1") is False


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
def test_a_file_the_composer_dropped_at_first_is_given_again(muse):
    # Right after the page loads the real composer ignores the upload
    # control; the message used to go out without its file.
    muse.mode = "slow-composer"
    frame = b"\xff\xd8\xff\xe0 fake jpeg"
    video, _ = generate(muse, reference=frame)
    assert video.data == CLIP
    # Attached once, not once per try.
    assert muse.files == [("/__file?name=previous-shot.jpg&type=image/jpeg", frame)]
    assert len(muse.sent) == 1


@needs_browser
def test_a_file_the_composer_never_shows_stops_before_sending(muse, monkeypatch):
    monkeypatch.setattr("app.integrations.muse.chat.ATTACH_WAIT", 3.0)
    muse.mode = "deaf-composer"
    with pytest.raises(MuseError) as failed:
        generate(muse, reference=b"frame")
    assert failed.value.code == "reference_upload_failed"
    assert muse.sent == [] and muse.files == []


@needs_browser
def test_reference_material_reaches_the_script_request(muse, tmp_path):
    muse.mode = "script"
    brief, sketch = tmp_path / "brief.txt", tmp_path / "sketch.png"
    brief.write_bytes(b"the brief")
    sketch.write_bytes(b"the sketch")
    client = MuseClient(Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER))
    generate_script_text(
        client, {"hatch_sess": "media-fixture"}, {}, None, "Write the script",
        on_session=lambda result: None, before_send=lambda result: None,
        check_cancelled=lambda: None, timeout=20, attachments=[brief, sketch],
    )
    assert sorted(body for _, body in muse.files) == [b"the brief", b"the sketch"]
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


def test_a_snap_chromium_is_passed_over_for_the_one_playwright_downloaded(
    tmp_path, monkeypatch
):
    from app.integrations.muse import chat

    wrapper = tmp_path / "chromium-browser"
    wrapper.write_text('#!/bin/sh\nexec /snap/bin/chromium "$@"\n')
    bundled = tmp_path / "chrome"
    bundled.write_bytes(b"\x7fELF")
    monkeypatch.setattr(
        chat.shutil, "which", lambda name: str(wrapper) if "chromium" in name else None
    )
    monkeypatch.setattr(chat, "_installed", lambda *parts: [])

    assert chat._first_browser(None, str(bundled)) == str(bundled)
    assert chat._first_browser(str(wrapper), str(bundled)) == str(wrapper)


def recover(muse, marker, **overrides):
    client = MuseClient(
        Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER)
    )
    options = dict(
        thread_path="/thread/old-1",
        marker=marker,
        on_session=lambda result: None,
        check_cancelled=lambda: None,
        timeout=20,
        grace=1.0,
    )
    options.update(overrides)
    return recover_media(client, {"hatch_sess": "media-fixture"}, {}, None, **options)


@needs_browser
@pytest.mark.parametrize("mode", ["answered", "answered-late"])
def test_a_sent_scene_is_taken_back_without_sending_it_again(muse, mode):
    muse.mode = mode
    video = recover(muse, "shot-cafe0001")
    assert video.data == CLIP and video.thread_path == "/thread/old-1"
    assert muse.sent == []


@needs_browser
def test_a_request_that_never_arrived_takes_nothing_from_the_page(muse):
    # The page holds clips (an earlier scene's, another request's): none of
    # them is taken for a message that is not there.
    muse.mode = "answered"
    assert recover(muse, "shot-0000dead") is None
    assert muse.sent == []


@needs_browser
def test_a_clip_whose_file_never_shows_is_asked_for_once(muse, monkeypatch):
    monkeypatch.setattr(media, "STALLED_ATTACHMENT", 1.0)
    muse.mode = "answered-stalled"
    video = recover(muse, "shot-cafe0001")
    assert video.data == CLIP
    assert len(muse.sent) == 1 and "Do not generate a new video." in muse.sent[0]


@needs_browser
def test_only_what_answers_our_message_is_taken_back(muse):
    # Live, 2026-11-16: scene 3 taken back from a conversation that went on
    # to scene 6 came back as scene 5's clip, loaded while its own was not.
    muse.mode = "answered-then-more"
    video = recover(muse, "shot-cafe0001")
    assert video.data == CLIP
    assert muse.sent == []


@needs_browser
def test_a_conversation_that_cannot_be_opened_is_not_taken_for_a_lost_message(muse):
    muse.mode = "answered"
    with pytest.raises(MuseError) as failed:
        recover(muse, "shot-cafe0001", thread_path="/thread/gone")
    assert failed.value.code == "conversation_unavailable"
    assert muse.sent == []


@needs_browser
def test_collapsed_messages_still_bound_what_is_taken_back(muse):
    # Live, 2026-11-17: scene 4's request, collapsed to "User message: [...]",
    # was not seen as a later request, and scene 3 came back as scene 4's clip.
    muse.mode = "answered-collapsed"
    video = recover(muse, "shot-cafe0001")
    assert video.data == CLIP
    assert muse.sent == []


@needs_browser
def test_a_request_typed_in_muse_by_hand_also_bounds_what_is_taken_back(muse):
    muse.mode = "answered-then-typed"
    video = recover(muse, "shot-cafe0001")
    assert video.data == CLIP and muse.sent == []


@needs_browser
def test_a_link_that_answers_an_older_message_is_taken_back(muse):
    muse.mode = "answered-then-link"
    video = recover(muse, "shot-cafe0001", grace=0.5)
    assert video.data == CLIP and muse.sent == []


def images(muse, count, **overrides):
    client = MuseClient(Settings(_env_file=None, upstream_url=muse.origin, browser_path=BROWSER))
    saved = []
    options = dict(
        on_session=lambda result: None, before_send=lambda result: None,
        check_cancelled=lambda: None, on_media=saved.append, timeout=20, grace=1.0,
    )
    options.update(overrides)
    made = generate_images(
        client, {"hatch_sess": "media-fixture"}, {}, None,
        "Generate exactly 4 separate images of a garden.", count=count, **options,
    )
    return made, saved


@needs_browser
def test_every_picture_of_a_grid_is_a_file(muse):
    # Live, 2026-11-17: muse.ai answered "4 dragon images" with ONE
    # attachment holding all four; only the first was taken, the files were
    # asked for again, and a smaller copy of it was saved as another image.
    muse.mode = "images-grid"
    made, saved = images(muse, 4)
    assert [image.data for image in saved] == [f"full garden {i}".encode() for i in range(1, 5)]
    assert [image.name for image in made] == [f"garden {i}" for i in range(1, 5)]
    assert len(muse.sent) == 1


@needs_browser
def test_files_attached_again_are_not_taken_twice(muse):
    muse.mode = "images-grid-short"
    made, saved = images(muse, 4)
    assert [image.data for image in saved] == [
        b"full garden 1", b"full garden 2", b"full garden 3", b"copy garden 4"
    ]
    assert len(muse.sent) == 2 and muse.sent[1] == chat.attach_request("image", 4, False)


@needs_browser
def test_a_set_of_pictures_is_taken_back_from_its_grid(muse, monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 1.0)
    muse.mode = "taken-grid"
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=2)
    assert [image.data for image in taken] == [b"full turtle 1", b"full turtle 2"]
    # A picture saved before is passed over, also when one is still missing.
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=1, skip=["turtle 1"], many=True)
    assert [image.data for image in taken] == [b"full turtle 2"]
    assert muse.sent == []


@needs_browser
def test_this_apps_follow_up_does_not_end_the_answer_and_copies_are_passed_over(muse, monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 1.0)
    muse.mode = "taken-reattached"
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=2)
    assert [image.data for image in taken] == [b"full turtle 1", b"copy turtle 2"]
    assert muse.sent == []
    # The page holds the follow-up exactly as this app sends it.
    assert chat.attach_request("image", 2, False) in PAGE


@needs_browser
def test_a_message_only_starting_like_the_follow_up_ends_the_answer(muse, monkeypatch):
    # Codex review, 2026-11-17: any "Please attach..." was let through, so a
    # dog picture asked for by hand would have been saved for the turtles.
    monkeypatch.setattr(media, "BATCH_SETTLE", 1.0)
    muse.mode = "taken-typed"
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=2)
    assert [image.data for image in taken] == [b"full turtle 1"]


@needs_browser
def test_a_picture_still_loading_at_the_deadline_is_not_reported_missing(muse, monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.5)
    muse.mode = "taken-loading"
    with pytest.raises(MuseError) as failed:
        recover(muse, "shot-cafe0003", media_kind="image", count=2, timeout=3)
    assert failed.value.code == "generation_timeout"
    # One that never loads once Muse is done counts as not made.
    monkeypatch.setattr(media, "STALLED_ATTACHMENT", 0.5)
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=2, timeout=10)
    assert [image.data for image in taken] == [b"full turtle 1"]
    assert muse.sent == []


def test_every_follow_up_this_app_sends_or_sent_is_recognised():
    for kind in ("image", "video"):
        for count in (1, 2, 4, 12):
            for denied in (True, False):
                assert re.fullmatch(chat.ATTACH_REQUEST_RE, chat.attach_request(kind, count, denied))
    for older in (
        "Please attach the final video file here in the chat, as a single attachment.",
        "Please attach the final video file here in the chat instead of uploading it.",
        "Please attach the final image file here in the chat, as a single attachment.",
    ):
        assert re.fullmatch(chat.ATTACH_REQUEST_RE, older)
    for other in (
        "Please attach a newly generated dog image",
        "Please attach the final video file here in the chat, as a single attachment. Then make a dog video.",
    ):
        assert not re.fullmatch(chat.ATTACH_REQUEST_RE, other)


@needs_browser
def test_pictures_of_one_attachment_sharing_a_title_are_two_files(muse, monkeypatch):
    # Codex review, 2026-11-17: told apart by title alone, the second was
    # taken for a copy of the first.
    monkeypatch.setattr(media, "BATCH_SETTLE", 1.0)
    muse.mode = "taken-twins"
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=3)
    assert [image.data for image in taken] == [b"full turtle", b"second turtle", b"full turtle #2"]
    assert len({image.name for image in taken}) == 3
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=2, skip=["turtle"], many=True)
    assert [image.data for image in taken] == [b"second turtle", b"full turtle #2"]
    muse.mode = "taken-proto"
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=2)
    assert [image.data for image in taken] == [b"full constructor", b"second constructor"]


@needs_browser
def test_a_picture_still_being_finished_is_not_taken_from_its_preview(muse):
    muse.mode = "taken-busy"
    taken = recover(muse, "shot-cafe0003", media_kind="image", count=1, many=True)
    assert [image.data for image in taken] == [b"final turtle 1"]


class TimedAnswer:
    """A page whose answer changes over time: (seconds after the first look,
    state from then on), in order."""

    url = "https://muse.ai/thread/t-1"

    def __init__(self, *timeline):
        self.timeline, self.start, self.declined = timeline, None, 0

    def wait_for_timeout(self, ms):
        time.sleep(0.01)

    def evaluate(self, script, argument=None):
        if script == media.MEDIA_STATE_JS:
            self.start = self.start or time.monotonic()
            elapsed = time.monotonic() - self.start
            return [state for at, state in self.timeline if at <= elapsed][-1]
        if script == media.DENY_APPROVALS_JS:
            self.declined += 1
            return 1
        return {"ok": True, "b64": base64.b64encode(argument.encode()).decode(), "mime": "image/png"}


def picture(name, src):
    return {"tid": "hatch-chat-attachment-presentation-image",
            "kind": "image" if src else "unknown", "src": src, "w": 1, "h": 1, "name": name}


def answer(*pictures, generating=False, approval=False):
    return {"sent": True, "bounded": False, "agentCount": 1, "lastText": "",
            "generating": generating, "approval": approval, "attachments": list(pictures)}


def collect(page, count=2, timeout=5):
    taken = media._collect_answered(page, "shot-x", "image", count, None, lambda: None, timeout)
    return [image.data for image in taken]


def test_an_answer_still_being_written_at_the_deadline_is_a_timeout_not_a_count():
    page = TimedAnswer((0, answer(picture("cat 1", "blob:1"), generating=True)))
    with pytest.raises(MuseError) as failed:
        collect(page, timeout=0.2)
    assert failed.value.code == "generation_timeout"


def test_quiet_only_just_begun_at_the_deadline_is_still_a_timeout(monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 1.0)
    page = TimedAnswer(
        (0, answer(picture("cat 1", "blob:1"), generating=True)),
        (0.25, answer(picture("cat 1", "blob:1"))),
    )
    with pytest.raises(MuseError) as failed:
        collect(page, timeout=0.4)
    assert failed.value.code == "generation_timeout"


def test_a_settled_answer_reports_what_it_holds(monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.1)
    page = TimedAnswer(
        (0, answer(picture("cat 1", "blob:1"), picture("cat 2", ""))),
        (0.1, answer(picture("cat 1", "blob:1"))),
    )
    assert collect(page) == [b"blob:1"]


def test_a_new_file_restarts_the_quiet_wait(monkeypatch):
    # Codex review, 2026-11-17: files arriving a while apart, with Muse
    # already idle, were cut off after the first quiet stretch.
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.3)
    one, two, three = (picture(f"cat {i}", f"blob:{i}") for i in (1, 2, 3))
    page = TimedAnswer((0, answer(one)), (0.2, answer(one, two)), (0.4, answer(one, two, three)))
    assert collect(page, count=4) == [b"blob:1", b"blob:2", b"blob:3"]


def test_each_loading_picture_gets_its_own_time_to_load(monkeypatch):
    monkeypatch.setattr(media, "STALLED_ATTACHMENT", 0.4)
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.1)
    page = TimedAnswer(
        (0, answer(picture("cat 1", ""))),
        (0.3, answer(picture("cat 1", ""), picture("cat 2", ""))),
        (0.6, answer(picture("cat 1", ""), picture("cat 2", "blob:2"))),
    )
    started = time.monotonic()
    assert collect(page) == [b"blob:2"]
    # Settled once cat 1 had its time, not at the deadline.
    assert time.monotonic() - started < 3


def test_no_file_runs_out_of_time_while_muse_is_still_answering(monkeypatch):
    # Codex review, 2026-11-17: a picture loading through a long answer was
    # counted as never made a moment after Muse finished.
    monkeypatch.setattr(media, "STALLED_ATTACHMENT", 0.3)
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.05)
    page = TimedAnswer(
        (0, answer(picture("cat 1", "blob:1"), picture("cat 2", ""), generating=True)),
        (0.6, answer(picture("cat 1", "blob:1"), picture("cat 2", ""))),
        (0.75, answer(picture("cat 1", "blob:1"), picture("cat 2", "blob:2"))),
    )
    assert collect(page) == [b"blob:1", b"blob:2"]


def test_an_approval_the_agent_waits_for_is_declined_not_taken_for_an_empty_answer(monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.1)
    page = TimedAnswer((0, answer(approval=True)), (0.3, answer(picture("cat 1", "blob:1"))))
    assert collect(page, count=1) == [b"blob:1"]
    assert page.declined >= 1


def test_a_picture_shown_from_another_source_is_taken_once(monkeypatch):
    monkeypatch.setattr(media, "BATCH_SETTLE", 0.2)
    page = TimedAnswer(
        (0, answer(picture("cat 1", "blob:a"))),
        (0.1, answer(picture("cat 1", "blob:b"), picture("cat 2", "blob:c"))),
    )
    assert collect(page) == [b"blob:a", b"blob:c"]
