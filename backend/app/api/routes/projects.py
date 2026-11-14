from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.rendering import storage
from app.rendering.tasks import remerge
from app.repositories import app_settings, projects
from app.schemas.project import (
    FeaturedProject,
    ProjectCounts,
    ProjectCreate,
    ProjectFilter,
    ProjectListResponse,
    ProjectResponse,
    ProjectSort,
    ProjectSummary,
    ProjectScriptUpdate,
    ProjectUpdate,
)

router = APIRouter(prefix="/projects", tags=["Projects"])
DatabaseSession = Annotated[Session, Depends(get_session)]


@router.get(
    "",
    response_model=ProjectListResponse,
    responses={400: {"description": "Invalid cursor"}},
)
def list_projects(
    session: DatabaseSession,
    q: Annotated[
        str,
        Query(max_length=100, description="Case- and accent-insensitive name search."),
    ] = "",
    status_filter: Annotated[ProjectFilter, Query(alias="status")] = "all",
    sort: ProjectSort = "updated",
    limit: Annotated[int, Query(ge=1, le=100)] = 24,
    cursor: Annotated[
        str | None,
        Query(max_length=1000, description="`nextCursor` from the previous page."),
    ] = None,
) -> ProjectListResponse:
    try:
        page = projects.list_projects(
            session, q=q, status=status_filter, sort=sort, limit=limit, cursor=cursor
        )
    except projects.InvalidCursorError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "invalid_cursor",
                "message": "The cursor is invalid or belongs to a different sort order.",
            },
        ) from None
    featured = projects.get_featured_project(session)
    return ProjectListResponse(
        items=[ProjectSummary.model_validate(project) for project in page.items],
        total=page.total,
        next_cursor=page.next_cursor,
        counts=ProjectCounts(**projects.count_projects_by_filter(session)),
        featured=FeaturedProject.model_validate(featured) if featured else None,
    )


# Fields of a new project that have a default in the Settings page.
DEFAULT_FIELDS = {
    "duration_seconds": "durationSeconds",
    "aspect_ratio": "aspectRatio",
    "language": "language",
    "look": "look",
    "continuity": "continuity",
}


@router.post("", response_model=ProjectResponse, status_code=status.HTTP_201_CREATED)
def create_project(
    values: ProjectCreate,
    request: Request,
    response: Response,
    session: DatabaseSession,
) -> ProjectResponse:
    # What the request leaves out comes from the Settings page.
    defaults = app_settings.read(session)["projectDefaults"]
    session.rollback()  # End the read snapshot before the insert (WAL).
    omitted = {
        field: defaults[name]
        for field, name in DEFAULT_FIELDS.items()
        if field not in values.model_fields_set
    }
    if omitted:
        values = values.model_copy(update=omitted)
    project = projects.create_project(session, values)
    response.headers["Location"] = str(
        request.url_for("get_project", project_id=project.id)
    )
    return ProjectResponse.model_validate(project)


@router.get(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={404: {"description": "Project not found"}},
)
def get_project(project_id: str, session: DatabaseSession) -> ProjectResponse:
    project = projects.get_project(session, project_id)
    if project is None:
        raise HTTPException(
            status_code=404,
            detail={"code": "project_not_found", "message": "Project not found."},
        )
    return ProjectResponse.model_validate(project)


@router.patch(
    "/{project_id}",
    response_model=ProjectResponse,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Locked by a render, or duration fixed by the script"},
    },
)
def update_project(
    project_id: str, values: ProjectUpdate, request: Request, session: DatabaseSession
) -> ProjectResponse:
    before = projects.get_project(session, project_id)
    was_muted = before.mute if before else None
    session.rollback()  # End the read snapshot before writing (WAL).
    try:
        project = projects.update_project(session, project_id, values)
    except projects.ProjectUpdateError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from None
    if project.mute != was_muted:
        # Sound is decided when the scenes are merged: a finished film is
        # merged again from its clips, without rendering anything.
        session.rollback()
        if remerge(session, project_id):
            request.app.state.task_coordinator.wake()
            session.expire_all()
            project = projects.get_project(session, project_id)
    return ProjectResponse.model_validate(project)


@router.put(
    "/{project_id}/script",
    response_model=ProjectResponse,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Script revision conflict or project locked"},
    },
)
def save_project_script(
    project_id: str, values: ProjectScriptUpdate, session: DatabaseSession
) -> ProjectResponse:
    try:
        project = projects.save_script(session, project_id, values)
    except projects.ScriptUpdateError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from None
    return ProjectResponse.model_validate(project)


@router.delete(
    "/{project_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    response_class=Response,
    responses={
        404: {"description": "Project not found"},
        409: {"description": "Project has a running operation"},
    },
)
def delete_project(
    project_id: str, request: Request, session: DatabaseSession
) -> Response:
    try:
        projects.delete_project(session, project_id)
    except projects.ProjectDeleteError as error:
        raise HTTPException(
            status_code=error.status_code,
            detail={"code": error.code, "message": str(error)},
        ) from None
    storage.remove_project(request.app.state.settings, project_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
