# Muse AI Studio

**Turn an idea into a finished AI film, on your own machine.**

Muse AI Studio is a self-hosted video studio that runs on your own [Muse](https://muse.ai) account. You bring the idea; the app writes the script, renders each scene, merges them into a film, and lets you cut, add music and add captions in the browser. No editing software to install, nothing to upload to another service.

![A finished project: the merged film and its nine scenes](assets/screenshots/editor.jpg)

## Why use it

- **One path from idea to film.** No copying prompts between tools: idea → script → scenes → film all live in one project.
- **You stay in charge.** The AI writes the script, but you review and edit every scene before any quota is spent on rendering.
- **Edit without rendering again.** Reordering, trimming, adding music or captions only merges the scenes you already have.
- **Your data stays with you.** Films, pictures, scripts and your (encrypted) sign-in session all sit in one folder on your machine.
- **Open to other apps.** An OpenAI-compatible API lets scripts and automation tools generate through it.

## From idea to film

Every project goes through four steps: **Idea → Script & scenes → Render → Finished video**.

1. **Idea.** A name, the story, the length (up to 60 minutes), the aspect ratio, the visual look and the language; you can attach reference pictures or videos.
2. **Script & scenes.** Muse splits the story into scenes of 5–10 seconds with narration. Edit, add, remove and reorder them as you like.
3. **Render.** Each scene becomes a video, and scenes can carry on seamlessly from one another. Not happy with one? Render again from that scene.
4. **Finished video.** The film is merged automatically and opens in the editor.

![The Render step: scene by scene, with progress and re-rendering](assets/screenshots/render.jpg)

## An editor in the browser

![The timeline: video, audio, subtitles and titles](assets/screenshots/timeline.jpg)

- Drag to reorder, drag an edge to trim, cut a clip in two, change the speed of one clip or of the whole film.
- Colour looks, slow zoom, mirroring, fades between clips.
- Add your own videos, pictures and audio; ask Muse for background music; lower the music automatically under speech.
- Captions (prefilled from the narration), titles and a logo; export an `.srt` file as well.
- Choose the aspect ratio, resolution and quality of the export; pick the cover image.
- Preview before merging, undo and redo, and a draft that survives leaving the page.

## Quick Create and the Media Library

Need a single picture or a short video without setting up a project? **Quick Create** takes one description (and a reference picture if you want) and puts the result in the **Media Library**, which collects every video, picture and audio file you have made or uploaded. Anything in the library can be reused in any project.

![The Media Library: everything made or uploaded, filtered by kind and source](assets/screenshots/library.jpg)

## Always know where things stand

The **Overview** shows the project you were working on, what is running, what needs your attention and the state of your Muse accounts. **Tasks** follows every background job, which you can cancel, retry or delete.

![Overview](assets/screenshots/overview.jpg)

## Several Muse accounts

Import one or more accounts using the sign-in session of your browser (the app walks you through it). Work is shared between the accounts, sessions are kept alive, quota is tracked, and each account can have its own proxy.

## An API for your own apps

Muse AI Studio speaks the OpenAI protocol: use the OpenAI SDK you already have and change only the Base URL and the key. Create a key on **Connection & API**, try it in the **Playground**, look things up in **Documentation**.

![Connection & API](assets/screenshots/api.jpg)

```python
import os
from openai import OpenAI

client = OpenAI(base_url="http://localhost:5173/v1", api_key=os.environ["MUSE_API_KEY"])
image = client.images.generate(model="muse-image", prompt="A glass of iced coffee on a window sill, morning light")
print(image.data[0].url)
```

## Getting started

You need Python 3.12+ with [uv](https://docs.astral.sh/uv/getting-started/installation/), Node.js 22.12+, FFmpeg, Chrome (or Chromium/Edge) and a Muse account.

```bash
# Terminal 1: the server
cd backend
uv sync --locked
uv run uvicorn app.main:app --host 127.0.0.1 --port 18610

# Terminal 2: the interface
cd frontend
npm ci
npm run dev
```

Open `http://localhost:5173`, then:

1. Go to **Muse Accounts** → **How to get the token** and follow the steps to copy your sign-in session.
2. Press **Import account**, paste it, then press **Test**.
3. Create your first project in **Video Studio**, or try a picture in **Quick Create**.

The **Settings** page tells you whether the app has found FFmpeg and a browser. The interface is available in English and Vietnamese.

Configuration, backing up your data and the technical details are in [backend/README.md](backend/README.md) and [frontend/README.md](frontend/README.md).

## Before you use it

- This is **not** an official Muse product. The app drives the Muse website with your own sign-in session; every generation uses your account's quota and is subject to Muse's terms. When Muse changes its website, generation may break for a while.
- The app has **no login**: anyone who can open its address can use everything in it. Run it on your own machine or a network you trust.
- Long films take a lot of quota and time: each scene is one generation on Muse.

## License

[MIT](LICENSE)
