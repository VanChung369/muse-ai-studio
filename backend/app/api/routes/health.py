from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.api.dependencies import get_session

router = APIRouter(tags=["Health"])


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    database: Literal["ok"] = "ok"


@router.get("/health", response_model=HealthResponse, responses={503: {"description": "Database unavailable"}})
def health(session: Annotated[Session, Depends(get_session)]) -> HealthResponse:
    try:
        session.execute(text("SELECT 1"))
    except SQLAlchemyError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from exc
    return HealthResponse()
