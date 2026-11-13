from typing import Annotated

from fastapi import APIRouter, Body, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.repositories import tasks
from app.planning.tasks import PlanningRequestError, validate_retry
from app.tasks.kinds import PLAN_SCRIPT
from app.schemas.task import TaskCounts, TaskFilter, TaskListResponse, TaskResponse, TaskRetry

router = APIRouter(prefix="/tasks", tags=["Tasks"])
DatabaseSession = Annotated[Session, Depends(get_session)]


def not_found() -> HTTPException:
    return HTTPException(status_code=404, detail={"code": "task_not_found", "message": "Task not found."})


def state_error(error: tasks.TaskStateError) -> HTTPException:
    return HTTPException(status_code=409, detail={"code": error.code, "message": str(error)})


def task_response(session: Session, task_id: str) -> TaskResponse:
    found = tasks.get_task(session, task_id)
    if found is None:
        raise not_found()
    return TaskResponse.from_task(*found)


@router.get("", response_model=TaskListResponse, responses={400: {"description": "Invalid cursor"}})
def list_tasks(
    session: DatabaseSession,
    status_filter: Annotated[TaskFilter, Query(alias="status")] = "all",
    project_id: Annotated[str | None, Query(alias="projectId", max_length=36)] = None,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    cursor: Annotated[str | None, Query(max_length=500)] = None,
) -> TaskListResponse:
    try:
        page = tasks.list_tasks(session, status=status_filter, project_id=project_id, limit=limit, cursor=cursor)
    except tasks.InvalidCursorError:
        raise HTTPException(400, detail={"code": "invalid_cursor", "message": "The cursor is invalid."}) from None
    return TaskListResponse(
        items=[TaskResponse.from_task(task, label) for task, label in page.items],
        total=page.total,
        next_cursor=page.next_cursor,
        counts=TaskCounts(**tasks.count_by_filter(session, project_id)),
    )


@router.get("/summary", response_model=TaskCounts)
def task_summary(session: DatabaseSession) -> TaskCounts:
    """Counts for the top-bar indicator and the sidebar badge."""
    return TaskCounts(**tasks.count_by_filter(session))


@router.get("/{task_id}", response_model=TaskResponse, responses={404: {"description": "Task not found"}})
def get_task(task_id: str, session: DatabaseSession) -> TaskResponse:
    return task_response(session, task_id)


@router.post(
    "/{task_id}/cancel", response_model=TaskResponse,
    responses={404: {"description": "Task not found"}, 409: {"description": "Task already finished"}},
)
def cancel_task(task_id: str, request: Request, session: DatabaseSession) -> TaskResponse:
    try:
        if not tasks.request_cancel(session, task_id):
            raise not_found()
    except tasks.TaskStateError as error:
        raise state_error(error) from None
    request.app.state.task_coordinator.notify_cancel(task_id)
    request.app.state.task_coordinator.wake()
    return task_response(session, task_id)


@router.post(
    "/{task_id}/retry", response_model=TaskResponse,
    responses={404: {"description": "Task not found"}, 409: {"description": "Not retryable or confirmation required"}},
)
def retry_task(
    task_id: str, request: Request, session: DatabaseSession,
    values: Annotated[TaskRetry | None, Body()] = None,
) -> TaskResponse:
    values = values or TaskRetry()
    found = tasks.get_task(session, task_id)
    if found is None:
        raise not_found()
    if found[0].kind == PLAN_SCRIPT:
        try:
            validate_retry(session, found[0])
        except PlanningRequestError as error:
            raise HTTPException(
                error.status, detail={"code": error.code, "message": "This generation cannot be retried."}
            ) from None
    session.rollback()  # End the read snapshot before retry_task writes (WAL).
    try:
        if not tasks.retry_task(
            session, task_id, switch_account=values.switch_account, confirm_duplicate=values.confirm_duplicate,
        ):
            raise not_found()
    except tasks.TaskStateError as error:
        raise state_error(error) from None
    request.app.state.task_coordinator.wake()
    return task_response(session, task_id)
