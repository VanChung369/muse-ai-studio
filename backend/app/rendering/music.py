"""Background music made by Muse.

Muse makes videos with sound, not audio files. So a short clip is asked for
whose soundtrack is the music described, and that soundtrack is kept as an
audio file among the project's media. The picture is thrown away.

It is asked for in the film's one Muse conversation, like the script and the
scenes (app/rendering/conversation.py).
"""

import json
from uuid import uuid4

from sqlalchemy import func, select, text, update

from app.accounts.task_session import TaskAccountSession
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import generate_video, video_prompt
from app.models import Account, Media, Project, Task
from app.rendering import conversation, storage
from app.rendering.ffmpeg import MergeError, extract_audio, find_ffmpeg, inspect
from app.repositories import tasks
from app.tasks.coordinator import TaskFailure
from app.tasks.kinds import ACTIVE_STATUSES, GENERATE_MUSIC

# Muse clips are 5 or 10 seconds long; the editor can repeat the music.
CLIP_SECONDS = 10
MAX_FILES = 30


class MusicRequestError(ValueError):
    def __init__(self, code, status):
        super().__init__(code)
        self.code, self.status = code, status


def music_prompt(
    description: str, aspect_ratio: str, *, in_thread: bool = False, summary: str = ""
) -> str:
    """`in_thread`: the film's conversation carries on. `summary`: what an
    earlier conversation about the film settled, when this request opens a
    new one (later scenes continue there)."""
    text = (
        "A calm abstract background of soft, slowly drifting light; no people, "
        "no text, no cuts. The soundtrack is what matters: instrumental "
        f"background music, {description.strip().rstrip('.')}. Music only, steady "
        "from the first second to the last: no speech, no singing, no sound "
        "effects, and no silence at the start or the end."
    )
    if in_thread:
        text += (
            "\nContext: background music for the film this conversation is about, "
            "not one of its shots: ignore the film's characters and picture for this "
            "clip. Make a new clip now; do not reuse, re-send or link an earlier one."
        )
    elif summary:
        text += (
            "\nContext: background music for a film begun in an earlier "
            "conversation; its shots will follow in this one. What was settled "
            "there, for later:\n" + summary
        )
    return video_prompt(text, aspect_ratio, CLIP_SECONDS)


def enqueue_music(session, project_id: str, description: str):
    """Queue one piece of music for the project. Returns (task, account label)."""
    try:
        session.execute(
            text("UPDATE projects SET status = status WHERE id = :id"),
            {"id": project_id},
        )
        project = session.get(Project, project_id)
        if project is None:
            raise MusicRequestError("project_not_found", 404)
        active = session.scalar(
            select(Task.id)
            .where(
                Task.project_id == project_id,
                Task.kind == GENERATE_MUSIC,
                Task.status.in_(ACTIVE_STATUSES),
            )
            .limit(1)
        )
        if active:
            raise MusicRequestError("generation_active", 409)
        usable = session.scalar(
            select(func.count())
            .select_from(Account)
            .where(Account.enabled.is_(True), Account.session_status == "valid")
        )
        if not usable:
            raise MusicRequestError("account_unavailable", 409)
        count = session.scalar(
            select(func.count())
            .select_from(Media)
            .where(Media.project_id == project_id)
        )
        if count >= MAX_FILES:
            raise MusicRequestError("too_many_files", 409)
        # In the film's conversation: on the account that owns it while that
        # account is usable.
        owner = (
            session.execute(
                select(Account.id, Account.label).where(
                    Account.id == project.muse_thread_account_id,
                    Account.enabled.is_(True),
                    Account.session_status == "valid",
                )
            ).first()
            if project.muse_thread_account_id
            else None
        )
        pinned, label = owner if owner else (None, None)
        task = tasks.create_task(
            session,
            kind=GENERATE_MUSIC,
            title=f"Music: {project.name}",
            project_id=project_id,
            account_id=pinned,
            requires_account=True,
            max_attempts=1,
            payload={
                "description": description,
                "aspectRatio": project.aspect_ratio,
            },
        )
        session.commit()
        return task, label
    except Exception:
        session.rollback()
        raise


def latest_music_task(session, project_id: str):
    row = session.execute(
        select(Task, Account.label)
        .outerjoin(Account, Account.id == Task.account_id)
        .where(Task.project_id == project_id, Task.kind == GENERATE_MUSIC)
        .order_by(Task.created_at.desc(), Task.id.desc())
        .limit(1)
    ).first()
    return tuple(row) if row else None


def make_music_handler(app):
    def handler(context):
        context.raise_if_cancelled()
        database, settings = app.state.database, app.state.settings
        # Checked before any quota is spent: without FFmpeg the clip's sound
        # could not be taken out of it.
        ffmpeg = find_ffmpeg(settings)
        if ffmpeg is None:
            raise TaskFailure("ffmpeg_unavailable", suggested_action="retry")
        with database.sessions() as session:
            project = session.get(Project, context.project_id)
            if project is None:
                raise TaskFailure("project_not_found")
            conversation.take_turn(session, context, follow=True)
            request = conversation.FilmRequest(database, settings, context, project)
            saved_id = context.checkpoint.get("mediaId")
            if saved_id and session.get(Media, saved_id) is not None:
                return {"projectId": context.project_id, "mediaId": saved_id}
            stored = session.scalar(
                select(func.count())
                .select_from(Media)
                .where(Media.project_id == context.project_id)
            )
            reserved = session.scalar(
                select(func.count())
                .select_from(Task)
                .where(
                    Task.project_id == context.project_id,
                    Task.kind == GENERATE_MUSIC,
                    Task.status.in_(ACTIVE_STATUSES),
                    ~func.coalesce(
                        func.json_extract(Task.checkpoint_json, "$.mediaId"), ""
                    ).in_(select(Media.id)),
                )
            )
            if stored + reserved > MAX_FILES:
                raise TaskFailure("too_many_files", suggested_action="retry")
        description = context.payload["description"]
        ratio = context.payload["aspectRatio"]
        fresh_prompt = music_prompt(description, ratio, summary=request.history)
        account = TaskAccountSession(app, context.account_id)

        def before_send(result):
            context.raise_if_cancelled()
            context.mark_submitted()
            request.sending()

        try:
            video = generate_video(
                app.state.muse_client,
                account.cookies,
                account.expiries,
                account.proxy,
                (
                    music_prompt(description, ratio, in_thread=True)
                    if request.thread
                    else fresh_prompt
                ),
                on_session=account.persist,
                before_send=before_send,
                check_cancelled=context.raise_if_cancelled,
                timeout=settings.render_timeout,
                thread_path=request.thread,
                on_thread=request.on_thread,
                fresh=(fresh_prompt, ()) if request.thread else None,
            )
        except MuseError as error:
            raise account.failure(error) from None
        with database.sessions() as session:
            # No reference file goes with music: a new conversation has seen
            # none, and the record of a continued one stays as it is.
            request.answered(session, video.thread_path)
            session.commit()
        if not video.data:
            raise TaskFailure("media_download_failed", suggested_action="retry")

        folder = storage.media_dir(settings, context.project_id)
        media_id = str(uuid4())
        file = f"{uuid4().hex}.m4a"
        clip, target = folder / (file + ".source.mp4"), folder / file
        try:
            storage.write(clip, video.data)
            try:
                extract_audio(ffmpeg, clip, target)
                info = inspect(ffmpeg, target)
            except MergeError:
                # The clip came without a soundtrack.
                raise TaskFailure("music_missing", suggested_action="retry") from None
            if not info.has_audio or not info.seconds:
                raise TaskFailure("music_missing", suggested_action="retry")
            with database.sessions() as session:
                session.execute(
                    text("UPDATE projects SET status = status WHERE id = :id"),
                    {"id": context.project_id},
                )
                if session.get(Project, context.project_id) is None:
                    # The project was deleted while its music was generating.
                    raise TaskFailure("project_not_found")
                session.add(
                    Media(
                        id=media_id,
                        project_id=context.project_id,
                        kind="audio",
                        name=f"Muse - {description[:80]}.m4a",
                        file=file,
                        mime="audio/mp4",
                        size=target.stat().st_size,
                        seconds=round(info.seconds, 3),
                        source="muse",
                    )
                )
                session.flush()
                session.execute(
                    update(Task)
                    .where(Task.id == context.task_id)
                    .values(checkpoint_json=json.dumps({"mediaId": media_id}))
                )
                session.commit()
        except BaseException:
            target.unlink(missing_ok=True)
            raise
        finally:
            clip.unlink(missing_ok=True)
        return {"projectId": context.project_id, "mediaId": media_id}

    return handler
