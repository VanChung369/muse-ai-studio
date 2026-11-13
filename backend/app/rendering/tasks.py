"""Render tasks: one per scene, chained in order, then one merge.

The chain uses the coordinator's dependency rule: scene N starts only after
scene N-1 succeeded, so a failed or cancelled scene holds back everything
after it until the user retries. The project's status is derived from the
chain (`sync_project`) wherever a task changes.
"""

from datetime import UTC, datetime

from sqlalchemy import func, select, update

from app.accounts.task_session import TaskAccountSession
from app.integrations.muse.client import MuseError
from app.integrations.muse.media import generate_video, video_prompt
from app.models import Account, Project, Scene, Task
from app.rendering import storage
from app.rendering.ffmpeg import MergeError, find_ffmpeg, merge
from app.repositories import tasks
from app.tasks.coordinator import TaskFailure, utcnow
from app.tasks.kinds import MERGE_VIDEO, RENDER_KINDS, RENDER_SCENE

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


def build_scene_prompt(project: Project, scene: Scene) -> str:
    parts = [scene.prompt.strip()]
    if project.visual_style.strip():
        parts.append("Visual style: " + project.visual_style.strip())
    if project.character_bible.strip():
        parts.append("Recurring characters: " + project.character_bible.strip())
    return video_prompt("\n".join(parts), project.aspect_ratio, scene.duration_seconds)


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
        previous = None
        for scene in project.scenes:
            previous = tasks.create_task(
                session,
                kind=RENDER_SCENE,
                title=f"Scene {scene.number}: {project.name}",
                project_id=project_id,
                scene_number=scene.number,
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

    Finished scenes are not touched. Pinned accounts are released so the
    coordinator can pick another healthy one.
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
    try:
        resumed = session.execute(
            update(Task)
            .where(*_render_tasks(project_id), Task.status.in_(retryable))
            .values(**tasks.requeue_values(switch_account=True))
        ).rowcount
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
    """Bring the project's status in line with its render tasks."""
    rows = [
        tuple(row)
        for row in session.execute(
            select(Task.status, Task.cancel_requested).where(*_render_tasks(project_id))
        )
    ]
    session.rollback()  # End the read snapshot before writing (WAL).
    if not rows:
        return
    status = derive_status(rows)
    try:
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
            prompt = build_scene_prompt(project, scene)
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
            )
        except MuseError as error:
            raise account.failure(error) from None
        if not video.data:
            raise TaskFailure("media_download_failed", suggested_action="retry")
        name = storage.scene_file(context.scene_number, video.mime)
        folder = storage.project_dir(settings, context.project_id)
        storage.write(folder / name, video.data)
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
        folder = storage.project_dir(settings, context.project_id)
        clips = [folder / name for name in files if name]
        if len(clips) != len(files) or not all(clip.is_file() for clip in clips):
            raise TaskFailure("scene_missing", suggested_action="retry")
        ffmpeg = find_ffmpeg(settings)
        if ffmpeg is None:
            raise TaskFailure("ffmpeg_unavailable", suggested_action="retry")
        try:
            merge(
                ffmpeg, clips, folder / storage.FINAL_FILE, context.raise_if_cancelled
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
