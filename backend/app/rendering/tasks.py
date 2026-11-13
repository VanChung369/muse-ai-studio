"""Render tasks: one per scene, chained in order, then one merge.

The chain uses the coordinator's dependency rule: scene N starts only after
scene N-1 succeeded, so a failed or cancelled scene holds back everything
after it until the user retries. The project's status is derived from the
chain (`sync_project`) wherever a task changes.
"""

from datetime import UTC, datetime

from sqlalchemy import func, or_, select, text, update

from app.accounts.task_session import TaskAccountSession
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import generate_video
from app.models import Account, Project, Scene, Task
from app.rendering import storage, timeline
from app.rendering.ffmpeg import (
    MergeError,
    find_ffmpeg,
    last_frame,
    merge,
    thumbnail,
)
from app.rendering.prompt import build_scene_prompt
from app.repositories import tasks
from app.tasks.coordinator import TaskFailure, utcnow
from app.tasks.kinds import MERGE_VIDEO, RENDER_KINDS, RENDER_SCENE

# Failures that call for another account rather than another try.
ACCOUNT_ACTIONS = ("switch_account", "relogin", "check_proxy")
# Statuses `sync_project` may move a project between.
RENDER_STATUSES = ("rendering", "cancelling", "cancelled", "failed", "completed")


class RenderRequestError(ValueError):
    def __init__(self, code: str, status: int):
        super().__init__(code)
        self.code, self.status = code, status


def _render_tasks(project_id: str):
    return (Task.project_id == project_id, Task.kind.in_(RENDER_KINDS))


def usable_accounts(session) -> int:
    return (
        session.scalar(
            select(func.count())
            .select_from(Account)
            .where(Account.enabled.is_(True), Account.session_status == "valid")
        )
        or 0
    )


def start_render(session, project_id: str) -> None:
    """Queue the whole chain for a project whose script is ready."""
    try:
        # Write before reading (SQLite WAL): this claim also stops a second
        # start and locks the script, which only `ready` projects can edit.
        claimed = session.execute(
            update(Project)
            .where(
                Project.id == project_id,
                Project.status == "ready",
                Project.scene_count > 0,
            )
            .values(status="rendering", updated_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        ).rowcount
        if not claimed:
            session.rollback()
            missing = session.get(Project, project_id) is None
            raise RenderRequestError(
                "project_not_found" if missing else "render_not_ready",
                404 if missing else 409,
            )
        if not usable_accounts(session):
            raise RenderRequestError("account_unavailable", 409)
        project = session.get(Project, project_id)
        # If the script was written in a conversation, render there: pin
        # the scenes to the account that owns it while it is usable.
        pinned = (
            session.scalar(
                select(Account.id).where(
                    Account.id == project.muse_thread_account_id,
                    Account.enabled.is_(True),
                    Account.session_status == "valid",
                )
            )
            if project.muse_thread_account_id
            else None
        )
        previous = None
        for scene in project.scenes:
            previous = tasks.create_task(
                session,
                kind=RENDER_SCENE,
                title=f"Scene {scene.number}: {project.name}",
                project_id=project_id,
                scene_number=scene.number,
                account_id=pinned,
                requires_account=True,
                depends_on_id=previous,
            ).id
        tasks.create_task(
            session,
            kind=MERGE_VIDEO,
            title=f"Final video: {project.name}",
            project_id=project_id,
            depends_on_id=previous,
        )
        session.commit()
    except Exception:
        session.rollback()
        raise


def cancel_render(session, project_id: str) -> list[str]:
    """Stop the chain: waiting tasks now, the running one after its current
    step. Finished scenes are kept. Returns the running task IDs to notify."""
    now = utcnow()
    try:
        stopped = session.execute(
            update(Task)
            .where(*_render_tasks(project_id), Task.status == "queued")
            .values(
                status="cancelled",
                cancel_requested=True,
                finished_at=now,
                updated_at=now,
            )
        ).rowcount
        stopped += session.execute(
            update(Task)
            .where(*_render_tasks(project_id), Task.status == "running")
            .values(cancel_requested=True, updated_at=now)
        ).rowcount
        if not stopped:
            session.rollback()
            missing = session.get(Project, project_id) is None
            session.rollback()
            raise RenderRequestError(
                "project_not_found" if missing else "render_not_active",
                404 if missing else 409,
            )
        running = list(
            session.scalars(
                select(Task.id).where(
                    *_render_tasks(project_id), Task.status == "running"
                )
            )
        )
        session.commit()
        return running
    except Exception:
        session.rollback()
        raise


def resume_render(session, project_id: str, confirm_duplicate: bool = False) -> None:
    """Queue every failed, cancelled or interrupted task of the chain again.

    Finished scenes are not touched.
    """
    retryable = ["failed", "cancelled"]
    if confirm_duplicate:
        retryable.append("interrupted")
    else:
        interrupted = session.scalar(
            select(Task.id)
            .where(*_render_tasks(project_id), Task.status == "interrupted")
            .limit(1)
        )
        session.rollback()  # End the read snapshot before writing (WAL).
        if interrupted:
            # That request may have reached Muse; sending it again could
            # spend a second generation. The user must confirm.
            raise RenderRequestError("confirm_required", 409)
    # Stay on the same account, where the film's conversation lives, unless
    # a failure says the account itself is the problem.
    switch = (
        session.scalar(
            select(Task.id)
            .where(
                *_render_tasks(project_id),
                Task.status.in_(retryable),
                Task.suggested_action.in_(ACCOUNT_ACTIONS),
            )
            .limit(1)
        )
        is not None
    )
    session.rollback()  # End the read snapshot before writing (WAL).
    try:
        resumed = session.execute(
            update(Task)
            .where(*_render_tasks(project_id), Task.status.in_(retryable))
            .values(**tasks.requeue_values(switch_account=switch))
        ).rowcount
        if resumed and switch:
            # Scenes still waiting were pinned to that account too.
            session.execute(
                update(Task)
                .where(
                    *_render_tasks(project_id),
                    Task.status == "queued",
                    Task.requires_account.is_(True),
                )
                .values(account_id=None)
            )
        if not resumed:
            session.rollback()
            missing = session.get(Project, project_id) is None
            session.rollback()
            raise RenderRequestError(
                "project_not_found" if missing else "render_not_resumable",
                404 if missing else 409,
            )
        session.commit()
    except Exception:
        session.rollback()
        raise


def restart_render(session, project_id: str, from_scene: int) -> list[str]:
    """Render scene `from_scene` and every later one again, then merge again.

    Earlier scenes are kept. Later ones are redone too because each scene is
    generated to follow the one before it. Returns the clip files that are no
    longer referenced, for the caller to delete once this is committed.
    """
    try:
        # Write before reading (SQLite WAL); also stops a second restart.
        claimed = session.execute(
            update(Project)
            .where(
                Project.id == project_id,
                Project.status.in_(("completed", "failed", "cancelled")),
                Project.scene_count >= from_scene,
            )
            .values(
                status="rendering",
                video_file=None,
                rendered_at=None,
                # A new conversation: in the old one the agent would
                # recognise the request and point at the clip it already made.
                muse_thread_path=None,
                muse_thread_account_id=None,
                muse_thread_scenes=0,
                updated_at=datetime.now(UTC),
            )
            .execution_options(synchronize_session=False)
        ).rowcount
        if not claimed:
            session.rollback()
            missing = session.get(Project, project_id) is None
            raise RenderRequestError(
                "project_not_found" if missing else "render_not_restartable",
                404 if missing else 409,
            )
        if not usable_accounts(session):
            raise RenderRequestError("account_unavailable", 409)
        kept = session.scalar(
            select(func.count())
            .select_from(Scene)
            .where(
                Scene.project_id == project_id,
                Scene.number < from_scene,
                Scene.video_file.is_not(None),
            )
        )
        if kept != from_scene - 1:
            # The chain runs in order: a scene cannot be redone while an
            # earlier one has no clip to follow.
            raise RenderRequestError("render_not_restartable", 409)
        redone = Scene.project_id == project_id, Scene.number >= from_scene
        stale = [
            name
            for name in session.scalars(select(Scene.video_file).where(*redone))
            if name
        ]
        session.execute(
            update(Scene).where(*redone).values(video_file=None, rendered_at=None)
        )
        session.execute(
            update(Project)
            .where(Project.id == project_id)
            .values(completed_scenes=from_scene - 1)
            .execution_options(synchronize_session=False)
        )
        session.execute(
            update(Task)
            .where(
                *_render_tasks(project_id),
                or_(Task.kind == MERGE_VIDEO, Task.scene_number >= from_scene),
            )
            .values(**tasks.requeue_values())
        )
        session.commit()
        return [
            *stale,
            *(storage.thumbnail_file(name) for name in stale),
            storage.FINAL_FILE,
        ]
    except Exception:
        session.rollback()
        raise


def remerge(session, project_id: str, **changes) -> bool:
    """Merge a finished film again from the clips it already has (for a
    change that only affects the merge, such as muting). No scene is
    rendered again. `changes` are project columns saved in the same
    transaction, so they are stored only if the merge is queued. False
    (and nothing saved) when the project is not a finished film."""
    try:
        claimed = session.execute(
            update(Project)
            .where(Project.id == project_id, Project.status == "completed")
            .values(status="rendering", updated_at=datetime.now(UTC), **changes)
            .execution_options(synchronize_session=False)
        ).rowcount
        if not claimed:
            session.rollback()
            return False
        session.execute(
            update(Task)
            .where(Task.project_id == project_id, Task.kind == MERGE_VIDEO)
            .values(**tasks.requeue_values())
        )
        session.commit()
        return True
    except Exception:
        session.rollback()
        raise


def derive_status(rows: list[tuple[str, bool]]) -> str:
    """Project status for a chain's (task status, cancel requested) pairs."""
    statuses = [status for status, _ in rows]
    if all(status == "succeeded" for status in statuses):
        return "completed"
    if any(status == "running" and cancelling for status, cancelling in rows):
        return "cancelling"
    if "running" in statuses:
        return "rendering"
    if "failed" in statuses or "interrupted" in statuses:
        return "failed"
    if "cancelled" in statuses:
        return "cancelled"
    return "rendering"


def sync_project(session, project_id: str) -> None:
    """Bring the project's status in line with its render tasks.

    Several callers can sync at once (a cancel request and the task it stops).
    Each takes SQLite's write lock before reading the tasks, so the one that
    writes last has also read last and a stale status never wins.
    """
    session.rollback()  # A fresh transaction, so the lock precedes the read.
    try:
        # A write that changes nothing: it only takes the lock. Raw SQL keeps
        # `updated_at` out of it.
        session.execute(
            text("UPDATE projects SET status = status WHERE id = :id"),
            {"id": project_id},
        )
        rows = [
            tuple(row)
            for row in session.execute(
                select(Task.status, Task.cancel_requested).where(
                    *_render_tasks(project_id)
                )
            )
        ]
        if not rows:
            session.rollback()
            return
        status = derive_status(rows)
        session.execute(
            update(Project)
            .where(
                Project.id == project_id,
                Project.status != status,
                Project.status.in_(RENDER_STATUSES),
            )
            .values(status=status, updated_at=datetime.now(UTC))
            .execution_options(synchronize_session=False)
        )
        session.commit()
    except Exception:
        session.rollback()
        raise


def sync_active_projects(database) -> None:
    """After a restart the coordinator requeues or interrupts running tasks;
    projects that were mid-render must reflect that."""
    with database.sessions() as session:
        project_ids = list(
            session.scalars(
                select(Project.id).where(
                    Project.status.in_(("rendering", "cancelling"))
                )
            )
        )
        session.rollback()
        for project_id in project_ids:
            sync_project(session, project_id)


def make_listener(app):
    def settled(context) -> None:
        if context.project_id:
            with app.state.database.sessions() as session:
                sync_project(session, context.project_id)

    return settled


def make_scene_handler(app):
    def handler(context):
        context.raise_if_cancelled()
        settings, database = app.state.settings, app.state.database
        with database.sessions() as session:
            project = session.get(Project, context.project_id)
            scene = (
                session.get(Scene, (context.project_id, context.scene_number))
                if project
                else None
            )
            if scene is None:
                raise TaskFailure("project_not_found")
            # Continuity: attach the last frame of the previous scene.
            previous = (
                session.get(Scene, (context.project_id, scene.number - 1))
                if project.continuity != "off" and scene.number > 1
                else None
            )
            previous_clip = previous.video_file if previous else None
            # One conversation per film: continue it while it belongs to
            # this account and is not too long.
            thread = (
                project.muse_thread_path
                if project.muse_thread_account_id == context.account_id
                and project.muse_thread_scenes < settings.thread_scene_limit
                else None
            )
            materials = storage.reference_files(
                settings,
                context.project_id,
                [reference.file for reference in project.references],
            )
            prompt = build_scene_prompt(
                project,
                scene,
                previous,
                has_reference=bool(previous_clip),
                in_thread=bool(thread),
                # Reference files open a conversation; they are not sent again in it.
                materials=bool(materials) and thread is None,
            )
        folder = storage.project_dir(settings, context.project_id)
        reference = None
        if previous_clip:
            # Before anything is sent: a scene that cannot get its
            # reference frame must not spend a generation.
            ffmpeg = find_ffmpeg(settings)
            if ffmpeg is None:
                raise TaskFailure("ffmpeg_unavailable", suggested_action="retry")
            try:
                reference = last_frame(ffmpeg, folder / previous_clip)
            except MergeError:
                raise TaskFailure(
                    "reference_frame_failed", suggested_action="retry"
                ) from None
        account = TaskAccountSession(app, context.account_id)

        def before_send(result):
            context.raise_if_cancelled()
            context.mark_submitted()

        try:
            video = generate_video(
                app.state.muse_client,
                account.cookies,
                account.expiries,
                account.proxy,
                prompt,
                on_session=account.persist,
                before_send=before_send,
                check_cancelled=context.raise_if_cancelled,
                timeout=settings.render_timeout,
                reference=reference,
                thread_path=thread,
                attachments=materials,
            )
        except MuseError as error:
            raise account.failure(error) from None
        if not video.data:
            raise TaskFailure("media_download_failed", suggested_action="retry")
        name = storage.scene_file(context.scene_number, video.mime)
        folder = storage.project_dir(settings, context.project_id)
        storage.write(folder / name, video.data)
        # A still for covers and players. Best effort: the clip routes make
        # it on demand if this did not.
        ffmpeg = find_ffmpeg(settings)
        if ffmpeg:
            thumbnail(ffmpeg, folder / name, folder / storage.thumbnail_file(name))
        with database.sessions() as session:
            saved = session.execute(
                update(Scene)
                .where(
                    Scene.project_id == context.project_id,
                    Scene.number == context.scene_number,
                )
                .values(video_file=name, rendered_at=utcnow())
            ).rowcount
            if not saved:
                # The project was deleted while its scene was generating.
                session.rollback()
                (folder / name).unlink(missing_ok=True)
                raise TaskFailure("project_not_found")
            session.execute(
                update(Project)
                .where(Project.id == context.project_id)
                .values(
                    completed_scenes=select(func.count())
                    .select_from(Scene)
                    .where(
                        Scene.project_id == context.project_id,
                        Scene.video_file.is_not(None),
                    )
                    .scalar_subquery(),
                    updated_at=datetime.now(UTC),
                )
                .execution_options(synchronize_session=False)
            )
            if video.thread_path:
                # Where the next scene continues. A new conversation was
                # started if the saved one was full, gone, or another account's.
                continued = video.thread_path == thread
                session.execute(
                    update(Project)
                    .where(Project.id == context.project_id)
                    .values(
                        muse_thread_path=video.thread_path,
                        muse_thread_account_id=context.account_id,
                        muse_thread_scenes=(
                            Project.muse_thread_scenes + 1 if continued else 1
                        ),
                    )
                    .execution_options(synchronize_session=False)
                )
            # Keep the rest of the film on this account, where its
            # conversation lives.
            session.execute(
                update(Task)
                .where(
                    Task.project_id == context.project_id,
                    Task.kind == RENDER_SCENE,
                    Task.status == "queued",
                    Task.account_id.is_(None),
                )
                .values(account_id=context.account_id)
            )
            session.commit()
        return {
            "projectId": context.project_id,
            "sceneNumber": context.scene_number,
            "bytes": len(video.data),
            "width": video.width,
            "height": video.height,
        }

    return handler


def make_merge_handler(app):
    def handler(context):
        context.raise_if_cancelled()
        settings, database = app.state.settings, app.state.database
        with database.sessions() as session:
            project = session.get(Project, context.project_id)
            if project is None:
                raise TaskFailure("project_not_found")
            files = [scene.video_file for scene in project.scenes]
            mute = project.mute
            by_scene = {scene.number: scene.video_file for scene in project.scenes}
            # The film's edit: order, trims, and scenes left out.
            kept = [cut for cut in timeline.load(project) if cut.enabled]
        folder = storage.project_dir(settings, context.project_id)
        clips = [folder / name for name in files if name]
        if len(clips) != len(files) or not all(clip.is_file() for clip in clips):
            raise TaskFailure("scene_missing", suggested_action="retry")
        if not kept:
            raise TaskFailure("timeline_empty", suggested_action="retry")
        clips = [folder / by_scene[cut.scene] for cut in kept]
        ffmpeg = find_ffmpeg(settings)
        if ffmpeg is None:
            raise TaskFailure("ffmpeg_unavailable", suggested_action="retry")
        try:
            merge(
                ffmpeg,
                clips,
                folder / storage.FINAL_FILE,
                context.raise_if_cancelled,
                mute=mute,
                cuts=[(cut.start, cut.end) for cut in kept],
            )
        except MergeError:
            raise TaskFailure("merge_failed", suggested_action="retry") from None
        with database.sessions() as session:
            session.execute(
                update(Project)
                .where(Project.id == context.project_id)
                .values(
                    video_file=storage.FINAL_FILE,
                    rendered_at=utcnow(),
                    updated_at=datetime.now(UTC),
                )
                .execution_options(synchronize_session=False)
            )
            session.commit()
        return {"projectId": context.project_id, "scenes": len(clips)}

    return handler
