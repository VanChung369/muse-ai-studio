import base64
import binascii
import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import ColumnElement, and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.core.text import normalize_search_text
from app.models import Project
from app.schemas.project import ProjectCreate, ProjectFilter, ProjectSort

FINISHED_STATUSES = ("completed", "cancelled")


class InvalidCursorError(ValueError):
    """The cursor is malformed or was issued for a different sort order."""


@dataclass(frozen=True)
class ProjectPage:
    items: list[Project]
    total: int
    next_cursor: str | None


def _status_condition(status: ProjectFilter) -> ColumnElement[bool] | None:
    if status == "all":
        return None
    if status == "inProgress":
        # Everything still needing work, including failed projects (design board 41).
        return Project.status.not_in(FINISHED_STATUSES)
    return Project.status == status


def _search_condition(q: str) -> ColumnElement[bool] | None:
    key = normalize_search_text(q.strip())
    if not key:
        return None
    escaped = key.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return Project.name_key.like(f"%{escaped}%", escape="\\")


# Each sort is a total order ending in `id`, so keyset pagination never skips
# or repeats rows when projects are added between page requests.
def _order_by(sort: ProjectSort):
    if sort == "name":
        return (Project.name_key.asc(), Project.id.asc())
    if sort == "duration":
        return (Project.duration_seconds.desc(), Project.updated_at.desc(), Project.id.asc())
    return (Project.updated_at.desc(), Project.id.asc())


def _cursor_values(project: Project, sort: ProjectSort) -> list:
    if sort == "name":
        return [project.name_key, project.id]
    if sort == "duration":
        return [project.duration_seconds, project.updated_at.isoformat(), project.id]
    return [project.updated_at.isoformat(), project.id]


def _encode_cursor(project: Project, sort: ProjectSort) -> str:
    payload = json.dumps({"sort": sort, "after": _cursor_values(project, sort)}, separators=(",", ":"))
    return base64.urlsafe_b64encode(payload.encode()).decode().rstrip("=")


def _after_condition(cursor: str, sort: ProjectSort) -> ColumnElement[bool]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        payload = json.loads(base64.urlsafe_b64decode(padded.encode()))
        if payload["sort"] != sort:
            raise InvalidCursorError
        after = payload["after"]
        if sort == "name":
            name_key, project_id = str(after[0]), str(after[1])
            return or_(Project.name_key > name_key, and_(Project.name_key == name_key, Project.id > project_id))
        if sort == "duration":
            duration, updated, project_id = int(after[0]), datetime.fromisoformat(after[1]), str(after[2])
            return or_(
                Project.duration_seconds < duration,
                and_(
                    Project.duration_seconds == duration,
                    or_(Project.updated_at < updated, and_(Project.updated_at == updated, Project.id > project_id)),
                ),
            )
        updated, project_id = datetime.fromisoformat(after[0]), str(after[1])
        return or_(Project.updated_at < updated, and_(Project.updated_at == updated, Project.id > project_id))
    except InvalidCursorError:
        raise
    except (binascii.Error, UnicodeDecodeError, json.JSONDecodeError, KeyError, IndexError, TypeError, ValueError) as error:
        raise InvalidCursorError from error


def list_projects(
    session: Session,
    *,
    q: str = "",
    status: ProjectFilter = "all",
    sort: ProjectSort = "updated",
    limit: int = 24,
    cursor: str | None = None,
) -> ProjectPage:
    filters = [condition for condition in (_status_condition(status), _search_condition(q)) if condition is not None]
    total = session.scalar(select(func.count()).select_from(Project).where(*filters)) or 0

    page_filters = [*filters, _after_condition(cursor, sort)] if cursor else filters
    # Fetch one extra row to know whether another page exists.
    rows = list(session.scalars(select(Project).where(*page_filters).order_by(*_order_by(sort)).limit(limit + 1)))
    has_more = len(rows) > limit
    items = rows[:limit]
    next_cursor = _encode_cursor(items[-1], sort) if has_more else None
    return ProjectPage(items=items, total=total, next_cursor=next_cursor)


def count_projects_by_filter(session: Session) -> dict[str, int]:
    row = session.execute(
        select(
            func.count(),
            func.coalesce(func.sum(case((Project.status.not_in(FINISHED_STATUSES), 1), else_=0)), 0),
            func.coalesce(func.sum(case((Project.status == "completed", 1), else_=0)), 0),
            func.coalesce(func.sum(case((Project.status == "cancelled", 1), else_=0)), 0),
        ).select_from(Project)
    ).one()
    return {"all": row[0], "in_progress": row[1], "completed": row[2], "cancelled": row[3]}


def get_featured_project(session: Session) -> Project | None:
    recent = (Project.updated_at.desc(), Project.id.asc())
    ready = session.scalars(select(Project).where(Project.status == "ready").order_by(*recent).limit(1)).first()
    if ready is not None:
        return ready
    return session.scalars(select(Project).where(Project.status.not_in(FINISHED_STATUSES)).order_by(*recent).limit(1)).first()


def get_project(session: Session, project_id: str) -> Project | None:
    return session.get(Project, project_id)


def create_project(session: Session, values: ProjectCreate) -> Project:
    project = Project(**values.model_dump())
    session.add(project)
    try:
        session.commit()
        session.refresh(project)
    except Exception:
        session.rollback()
        raise
    return project
