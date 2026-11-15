"""Which Muse conversation a request goes into, and what it must say there.

A film lives in ONE conversation: its script, every scene (and every scene
made again) and its music. Quick Create keeps one conversation per account
for all its requests. The agent then has the whole context.

A new conversation is started only when the current one already holds
`thread_scene_limit` requests (it would grow too long), when the work moves
to another account (a conversation belongs to one), or when the saved one
can no longer be opened. The first message of the new conversation carries a
summary of what the earlier one settled, so no context is lost.

Reference files go to a film's conversation once. Files added later are
sent into the same conversation with the next message, and files removed
are named there so the agent stops using them.
"""

import json
from dataclasses import dataclass

from sqlalchemy import select, update
from sqlalchemy.dialects.sqlite import insert

from app.models import AppSetting, Project, Task
from app.rendering.prompt import LANGUAGES, LOOKS
from app.tasks.coordinator import TaskDeferred
from app.tasks.kinds import GENERATE_MUSIC, PLAN_SCRIPT, RENDER_SCENE

# A summary has to fit in one message next to the request itself.
SUMMARY_LIMIT = 4000
QUICK_KEY = "quickConversations"
# Quick Create requests a new conversation is told about.
QUICK_RECENT = 6


def _clip(text: str, limit: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


# Films -------------------------------------------------------------------

# Requests that go into a film's conversation (the merge does not).
FILM_KINDS = (PLAN_SCRIPT, RENDER_SCENE, GENERATE_MUSIC)


def film_thread(project: Project, account_id: str | None, settings) -> str | None:
    """The film's conversation when this account can carry on in it, else
    None (a new one is started)."""
    if (
        project.muse_thread_path
        and project.muse_thread_account_id == account_id
        and project.muse_thread_scenes < settings.thread_scene_limit
    ):
        return project.muse_thread_path
    return None


def take_turn(session, context, *, follow: bool) -> None:
    """Requests about one film reach its conversation one at a time. Raises
    TaskDeferred (nothing sent yet) while another request of the film runs.
    `follow`: this task's account was not chosen by the user (a scene or
    music, not a script), so it is moved to the running request's account
    and continues the conversation that request opens instead of starting a
    second one on its own account."""
    mine = session.scalar(select(Task.started_at).where(Task.id == context.task_id))
    earlier = [
        row
        for row in session.execute(
            select(Task.id, Task.account_id, Task.started_at).where(
                Task.project_id == context.project_id,
                Task.kind.in_(FILM_KINDS),
                Task.status == "running",
                Task.id != context.task_id,
            )
        )
        # The one that started first goes first; the others wait for it.
        if mine is None
        or row.started_at is None
        or (row.started_at, row.id) < (mine, context.task_id)
    ]
    if not earlier:
        session.rollback()
        return
    owner = earlier[0].account_id
    if follow and owner and owner != context.account_id:
        session.execute(
            update(Task).where(Task.id == context.task_id).values(account_id=owner)
        )
        session.commit()
    else:
        session.rollback()
    raise TaskDeferred("film_busy", delay=10)


def _seen(project: Project) -> dict[str, str]:
    try:
        seen = json.loads(project.muse_thread_references or "{}")
    except ValueError:
        return {}
    return seen if isinstance(seen, dict) else {}


@dataclass
class ReferencePlan:
    # Every reference file the film has now: file -> the user's file name.
    current: dict[str, str]
    # What the conversation has already been sent (empty for a new one).
    seen: dict[str, str]
    # Files to attach to this message: all of them in a new conversation,
    # those the conversation has not seen when it carries on.
    attach: list[str]
    # Files the conversation saw that the film no longer has, as Muse knows
    # them (the uploaded file name) with the user's name for them.
    dropped: list[str]


def reference_plan(project: Project, thread: str | None) -> ReferencePlan:
    current = {reference.file: reference.name for reference in project.references}
    if thread is None:
        return ReferencePlan(current, {}, list(current), [])
    seen = _seen(project)
    return ReferencePlan(
        current,
        seen,
        [file for file in current if file not in seen],
        [f'{file} ("{name}")' for file, name in seen.items() if file not in current],
    )


def film_summary(project: Project) -> str:
    """What the film's earlier conversation settled, for the first message
    of a new one: the brief, the look and the script with the shots made."""
    lines = [
        f'Film "{_clip(project.name, 100)}": {project.aspect_ratio}, '
        f"{project.duration_seconds} seconds."
    ]
    if project.idea.strip():
        lines.append("Idea: " + _clip(project.idea, 800))
    if project.character_bible.strip():
        lines.append("Recurring characters: " + _clip(project.character_bible, 1000))
    if project.visual_style.strip():
        lines.append("Visual style: " + _clip(project.visual_style, 600))
    if LOOKS.get(project.look):
        lines.append("Look: " + _clip(LOOKS[project.look], 200))
    if LANGUAGES.get(project.language):
        lines.append("Language: " + LANGUAGES[project.language])
    if project.mute:
        lines.append("Sound: a silent film.")
    elif project.music.strip():
        lines.append("Music: " + _clip(project.music, 300))
    scenes = list(project.scenes)
    if scenes:
        made = sum(1 for scene in scenes if scene.video_file)
        lines.append(
            f"Script: {len(scenes)} shots, {made} of them already made "
            "(each listed as number, title, length, state and what it shows):"
        )
        used = sum(len(line) + 1 for line in lines)
        for index, scene in enumerate(scenes):
            line = (
                f"{scene.number}. {_clip(scene.title, 80)} ({scene.duration_seconds}s, "
                f"{'made' if scene.video_file else 'not made yet'}): "
                f"{_clip(scene.prompt, 160)}"
            )
            if used + len(line) > SUMMARY_LIMIT:
                lines.append(f"... and {len(scenes) - index} more shots.")
                break
            lines.append(line)
            used += len(line) + 1
    return "\n".join(lines)


def film_history(project: Project) -> str:
    """The summary for a message that may open a new conversation: empty
    when the film never had one (there is nothing to carry over)."""
    return film_summary(project) if project.muse_thread_path else ""


class FilmRequest:
    """The bookkeeping of one request (script, scene or music) in a film's
    conversation. Built while the project is loaded; pass `on_thread` to the
    generator, call `sending()` from before_send and `answered()` once Muse
    answered.

    A new conversation becomes the film's only once our message was sent
    into it: a page can get an id before anything is sent, and an empty
    conversation must not replace the film's real one."""

    def __init__(self, database, settings, context, project: Project):
        self.database = database
        self.project_id = context.project_id
        self.account_id = context.account_id
        self.thread = film_thread(project, context.account_id, settings)
        self.plan = reference_plan(project, self.thread)
        self.history = film_history(project)
        # The conversation the page is on: the saved one once it opened, a
        # new one once its id is known, None until then.
        self.current = None
        self.sent = self.counted = False
        self.adopted = None

    @property
    def kept_materials(self) -> bool:
        """The conversation already holds reference files the film still has."""
        return any(file in self.plan.seen for file in self.plan.current)

    def on_thread(self, path) -> None:
        self.current = path
        if self.sent:
            self._adopt(path)

    def sending(self) -> None:
        """Before each send. A request into the saved conversation counts
        towards its length at once, also if no answer comes back."""
        self.sent = True
        if self.current and self.current != self.thread:
            self._adopt(self.current)
        if self.counted or not self.thread or self.current != self.thread:
            return
        self.counted = True
        with self.database.sessions() as session:
            session.execute(
                update(Project)
                .where(
                    Project.id == self.project_id,
                    Project.muse_thread_path == self.thread,
                )
                .values(muse_thread_scenes=Project.muse_thread_scenes + 1)
                .execution_options(synchronize_session=False)
            )
            session.commit()

    def _adopt(self, path) -> None:
        """Our message went into the new conversation `path`: it is now the
        film's, with nothing in it answered or seen yet."""
        if not path or path == self.thread or path == self.adopted:
            return
        self.adopted = path
        with self.database.sessions() as session:
            session.execute(
                update(Project)
                .where(Project.id == self.project_id)
                .values(
                    muse_thread_path=path,
                    muse_thread_account_id=self.account_id,
                    muse_thread_scenes=0,
                    muse_thread_references=None,
                )
                .execution_options(synchronize_session=False)
            )
            session.commit()

    def answered(
        self, session, used, *, fresh_files=None, continued_files=None
    ) -> None:
        """Muse answered in conversation `used`. `fresh_files` /
        `continued_files`: the reference files (Paths) attached in a new
        conversation / in the saved one; None for a request that sends
        none and leaves the record of seen files as it is (music)."""
        if not used:
            return
        continued = used == self.thread
        values = {
            "muse_thread_path": used,
            "muse_thread_account_id": self.account_id,
            "muse_thread_scenes": (
                Project.muse_thread_scenes + (0 if self.counted else 1)
                if continued
                else 1
            ),
        }
        files = continued_files if continued else fresh_files
        if files is not None:
            sent = {path.name for path in files}
            known = self.plan.seen if continued else {}
            values["muse_thread_references"] = json.dumps(
                {
                    file: name
                    for file, name in self.plan.current.items()
                    if file in known or file in sent
                },
                ensure_ascii=False,
            )
        elif not continued:
            values["muse_thread_references"] = None
        session.execute(
            update(Project)
            .where(Project.id == self.project_id)
            .values(**values)
            .execution_options(synchronize_session=False)
        )


# Quick Create --------------------------------------------------------------


def _quick_all(session) -> dict:
    # A write first: it takes SQLite's write lock before the read, so two
    # requests finishing together cannot overwrite each other's update.
    session.execute(
        insert(AppSetting)
        .values(key=QUICK_KEY, value_json="{}")
        .on_conflict_do_nothing(index_elements=[AppSetting.key])
    )
    row = session.scalar(
        select(AppSetting.value_json).where(AppSetting.key == QUICK_KEY)
    )
    try:
        stored = json.loads(row or "{}")
    except ValueError:
        stored = {}
    return stored if isinstance(stored, dict) else {}


def _quick_save(session, stored: dict) -> None:
    session.execute(
        update(AppSetting)
        .where(AppSetting.key == QUICK_KEY)
        .values(value_json=json.dumps(stored, ensure_ascii=False))
    )


def quick_conversation(session, account_id: str) -> dict:
    """This account's Quick Create conversation: its path (None before the
    first request), how many requests it holds and the latest requests."""
    entry = _quick_all(session).get(account_id)
    entry = entry if isinstance(entry, dict) else {}
    session.commit()
    return {
        "path": entry.get("path") or None,
        "requests": int(entry.get("requests") or 0),
        "recent": [
            item for item in entry.get("recent") or [] if isinstance(item, dict)
        ],
    }


def quick_started(session, account_id: str, path: str) -> None:
    """A new Quick Create conversation was opened for the account."""
    stored = _quick_all(session)
    entry = stored.get(account_id) if isinstance(stored.get(account_id), dict) else {}
    if entry.get("path") != path:
        stored[account_id] = {**entry, "path": path, "requests": 0}
        _quick_save(session, stored)
    session.commit()


def quick_answered(
    session, account_id: str, path: str | None, request: dict, *, adopt: bool
) -> None:
    """A Quick Create request was answered in conversation `path`. `adopt`:
    a first attempt, whose conversation becomes the account's one. A retry
    in an older conversation leaves the account's current one in place."""
    if not path:
        return
    stored = _quick_all(session)
    entry = stored.get(account_id) if isinstance(stored.get(account_id), dict) else {}
    recent = [*(entry.get("recent") or []), request][-QUICK_RECENT:]
    if entry.get("path") == path:
        entry = {**entry, "requests": int(entry.get("requests") or 0) + 1}
    elif adopt:
        entry = {**entry, "path": path, "requests": 1}
    stored[account_id] = {**entry, "recent": recent}
    _quick_save(session, stored)
    session.commit()


def quick_summary(recent: list[dict]) -> str:
    """The latest requests of an earlier Quick Create conversation."""
    lines = []
    for item in recent[-QUICK_RECENT:]:
        what = (
            f"{item.get('count', 1)} image(s)"
            if item.get("kind") == "image"
            else "a video"
        )
        lines.append(
            f"- {what}, {item.get('aspectRatio', '')}: {_clip(str(item.get('prompt', '')), 300)}"
        )
    return "\n".join(lines)
