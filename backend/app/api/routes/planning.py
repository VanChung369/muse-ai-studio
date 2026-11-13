from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session
from app.models import Project
from app.planning.tasks import PlanningRequestError, enqueue_script, latest_script_task
from app.schemas.project import ProjectLanguage, ProjectLook
from app.schemas.task import TaskResponse

router = APIRouter(prefix="/projects", tags=["Script generation"])
DatabaseSession = Annotated[Session, Depends(get_session)]


class ScriptGenerationRequest(BaseModel):
    model_config = ConfigDict(
        alias_generator=to_camel, extra="forbid", str_strip_whitespace=True
    )
    account_id: str = Field(min_length=1, max_length=36)
    expected_revision: int = Field(strict=True, ge=0)
    idea: str = Field(min_length=1, max_length=12000)
    # Saved on the project and used for this script; omitted = keep the project's.
    language: ProjectLanguage | None = None
    look: ProjectLook | None = None
    # Write a voice-over line for every scene.
    narration: bool = Field(default=False, strict=True)
    # Free-form direction for the writer: tone, audience, pacing, must-haves.
    direction: str = Field(default="", max_length=2000)


@router.post(
    "/{project_id}/script-generation", response_model=TaskResponse, status_code=202
)
def start_script_generation(
    project_id: str,
    values: ScriptGenerationRequest,
    request: Request,
    session: DatabaseSession,
):
    try:
        task, label = enqueue_script(session, project_id, values)
    except PlanningRequestError as error:
        raise HTTPException(
            error.status,
            detail={
                "code": error.code,
                "message": "Script generation could not be started.",
            },
        ) from None
    request.app.state.task_coordinator.wake()
    return TaskResponse.from_task(task, label)


@router.get("/{project_id}/script-generation", response_model=TaskResponse | None)
def get_script_generation(project_id: str, session: DatabaseSession):
    if session.get(Project, project_id) is None:
        raise HTTPException(
            404, detail={"code": "project_not_found", "message": "Project not found."}
        )
    latest = latest_script_task(session, project_id)
    return TaskResponse.from_task(*latest) if latest else None
