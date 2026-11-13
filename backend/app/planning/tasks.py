import json

from sqlalchemy import select, update

from app.accounts.task_session import TaskAccountSession
from app.integrations.muse.chat import generate_script_text
from app.integrations.muse.client import MuseError
from app.models import Account, Project, Task
from app.planning.script import build_script_prompt, parse_script_reply
from app.rendering import storage
from app.repositories import tasks
from app.tasks.coordinator import TaskFailure
from app.tasks.kinds import ACTIVE_STATUSES, PLAN_SCRIPT

PLANNING_KIND = PLAN_SCRIPT


class PlanningRequestError(ValueError):
    def __init__(self, code, status):
        super().__init__(code)
        self.code, self.status = code, status


def enqueue_script(session, project_id, values):
    try:
        claimed = session.execute(
            update(Project)
            .where(
                Project.id == project_id,
                Project.script_revision == values.expected_revision,
                Project.status.in_(("draft", "ready")),
            )
            .values(
                idea=values.idea,
                # The dialog's language and look become the project's.
                **{
                    name: getattr(values, name)
                    for name in ("language", "look")
                    if getattr(values, name, None) is not None
                },
            )
            .execution_options(synchronize_session=False)
        ).rowcount
        if not claimed:
            session.rollback()
            project = session.get(Project, project_id)
            raise PlanningRequestError(
                "project_not_found" if project is None else "script_conflict",
                404 if project is None else 409,
            )
        active = session.scalar(
            select(Task.id)
            .where(
                Task.project_id == project_id,
                Task.kind == PLANNING_KIND,
                Task.status.in_(ACTIVE_STATUSES),
            )
            .limit(1)
        )
        if active:
            raise PlanningRequestError("generation_active", 409)
        account = session.get(Account, values.account_id)
        if account is None or not account.enabled or account.session_status != "valid":
            raise PlanningRequestError("account_unavailable", 409)
        project = session.get(Project, project_id)
        task = tasks.create_task(
            session,
            kind=PLANNING_KIND,
            title=f"Script: {project.name}",
            project_id=project_id,
            account_id=account.id,
            requires_account=True,
            max_attempts=1,
            payload={
                "expectedRevision": values.expected_revision,
                "brief": {
                    "name": project.name,
                    "idea": values.idea,
                    "durationSeconds": project.duration_seconds,
                    "aspectRatio": project.aspect_ratio,
                    "language": project.language,
                    "look": project.look,
                    "mute": project.mute,
                    # What the user already decided about the film.
                    "characters": project.character_bible,
                    "visualStyle": project.visual_style,
                    "music": project.music,
                    "references": len(project.references),
                    "narration": bool(getattr(values, "narration", False)),
                    "direction": getattr(values, "direction", ""),
                },
            },
        )
        label = account.label
        session.commit()
        return task, label
    except Exception:
        session.rollback()
        raise


def validate_retry(session, task) -> None:
    """Retrying a generation must pass the same checks as starting one."""
    project = session.get(Project, task.project_id) if task.project_id else None
    if project is None:
        raise PlanningRequestError("project_not_found", 404)
    payload = json.loads(task.payload_json)
    if project.status not in (
        "draft",
        "ready",
    ) or project.script_revision != payload.get("expectedRevision"):
        # The script changed or the project moved on (e.g. rendering).
        raise PlanningRequestError("script_conflict", 409)
    other = session.scalar(
        select(Task.id)
        .where(
            Task.project_id == task.project_id,
            Task.kind == PLANNING_KIND,
            Task.status.in_(ACTIVE_STATUSES),
            Task.id != task.id,
        )
        .limit(1)
    )
    if other:
        raise PlanningRequestError("generation_active", 409)


def latest_script_task(session, project_id):
    row = session.execute(
        select(Task, Account.label)
        .outerjoin(Account, Account.id == Task.account_id)
        .where(Task.project_id == project_id, Task.kind == PLANNING_KIND)
        .order_by(Task.created_at.desc(), Task.id.desc())
        .limit(1)
    ).first()
    return tuple(row) if row else None


def make_script_handler(app):
    def handler(context):
        context.raise_if_cancelled()
        database, settings = app.state.database, app.state.settings
        with database.sessions() as session:
            project = session.get(Project, context.project_id)
            if project is None:
                raise TaskFailure("project_not_found")
            # Write the script in the film's own conversation, where its
            # scenes are rendered later.
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
        account = TaskAccountSession(app, context.account_id)

        def remember_thread(path):
            if not path or path == thread:
                return
            with database.sessions() as session:
                session.execute(
                    update(Project)
                    .where(Project.id == context.project_id)
                    .values(
                        muse_thread_path=path,
                        muse_thread_account_id=context.account_id,
                        muse_thread_scenes=0,
                    )
                    .execution_options(synchronize_session=False)
                )
                session.commit()

        def before_send(result):
            context.raise_if_cancelled()
            context.mark_submitted()

        try:
            text = generate_script_text(
                app.state.muse_client,
                account.cookies,
                account.expiries,
                account.proxy,
                build_script_prompt(context.payload["brief"]),
                on_session=account.persist,
                before_send=before_send,
                check_cancelled=context.raise_if_cancelled,
                timeout=settings.planning_timeout,
                thread_path=thread,
                on_thread=remember_thread,
                attachments=materials,
            )
        except MuseError as error:
            raise account.failure(error) from None
        try:
            script = parse_script_reply(
                text,
                context.payload["brief"]["durationSeconds"],
                context.payload["expectedRevision"],
            )
        except (ValueError, TypeError, KeyError, RecursionError):
            raise TaskFailure("invalid_script", suggested_action="retry") from None
        return {
            "projectId": context.project_id,
            "script": script.model_dump(by_alias=True),
        }

    return handler
