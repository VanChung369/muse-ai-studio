"""OpenAI-shaped access to the normal Quick Create task queue."""

import base64
import json
import re
import time
from datetime import UTC, timedelta
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.exception_handlers import http_exception_handler, request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import func, or_, select, update
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.api.routes.api_keys import key_hash
from app.api.routes.quick_create import QuickRequest
from app.models import ApiKey, LibraryAsset, Task
from app.rendering import storage
from app.rendering.quick_create import QuickCreateError, enqueue
from app.repositories.tasks import FINISHED
from app.tasks.coordinator import utcnow
from app.tasks.kinds import GENERATE_VIDEO

POLL_INTERVAL = 0.25
KEEPALIVE_INTERVAL = 10
MODEL_CREATED = 1763078400
Ratio = Literal["1:1", "16:9", "9:16"]
SIZES = {"1024x1024": "1:1", "1792x1024": "16:9", "1536x1024": "16:9",
    "1024x1792": "9:16", "1024x1536": "9:16"}
FAILURES = {
    "quota_exhausted": (429, "rate_limit_error", "rate_limit_exceeded"),
    "rate_limited": (429, "rate_limit_error", "rate_limit_exceeded"),
    "generation_refused": (400, "invalid_request_error", "content_policy_violation"),
    "generation_timeout": (504, "api_error", "timeout"),
    "account_unavailable": (503, "api_error", "no_account_available"),
    "account_deleted": (503, "api_error", "no_account_available"),
    "ffmpeg_unavailable": (503, "api_error", "no_account_available"),
    "too_many_files": (409, "invalid_request_error", "library_full"),
}
MESSAGES = {
    "rate_limit_exceeded": "Muse quota is exhausted or Muse is rate limiting. Try again later.",
    "content_policy_violation": "Muse refused to generate this content.",
    "timeout": "The result did not arrive in time. The task may still finish.",
    "no_account_available": "No usable Muse account is available, or FFmpeg is missing.",
    "library_full": "The media library has no room for this result.",
    "upstream_error": "Muse could not complete this generation.",
}


class PublicError(HTTPException):
    def __init__(self, status, type, code, message, task_id=None):
        super().__init__(status, detail={"message": message, "type": type, "code": code},
            headers={"X-Muse-Task-Id": task_id} if task_id else None)


def failure(code, message=None, task_id=None):
    status, type, public_code = FAILURES.get(code, (502, "api_error", "upstream_error"))
    return PublicError(status, type, public_code, message or MESSAGES[public_code], task_id)


def is_public(request):
    return request.url.path == "/v1" or request.url.path.startswith("/v1/")


def install_error_handlers(app):
    # Leave the internal API's error and validation responses unchanged.
    @app.exception_handler(StarletteHTTPException)
    async def http_error(request, error):
        if not is_public(request):
            return await http_exception_handler(request, error)
        if isinstance(error, PublicError):
            body = error.detail
        else:
            body = {"message": str(error.detail), "type": "invalid_request_error",
                "code": "not_found" if error.status_code == 404 else "invalid_request"}
        return JSONResponse({"error": body}, status_code=error.status_code, headers=error.headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        if not is_public(request):
            return await request_validation_exception_handler(request, error)
        return JSONResponse({"error": {"message": "The request body is invalid.",
            "type": "invalid_request_error", "code": "invalid_request"}}, status_code=400)

    @app.middleware("http")
    async def public_errors(request, call_next):
        if not is_public(request):
            return await call_next(request)
        try:
            return await call_next(request)
        except Exception:
            error = failure("upstream_error")
            return JSONResponse({"error": error.detail}, status_code=error.status_code)


bearer = HTTPBearer(auto_error=False)


def authenticate(request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)]):
    secret = credentials.credentials if credentials else ""
    invalid = PublicError(401, "invalid_request_error", "invalid_api_key",
        "Provide a valid Muse API key as a Bearer token.")
    if not re.fullmatch(r"sk-muse-[0-9a-f]{48}", secret):
        raise invalid
    with request.app.state.database.sessions() as session:
        key = session.scalar(select(ApiKey).where(
            ApiKey.key_hash == key_hash(secret), ApiKey.revoked_at.is_(None)
        ))
        if key is None:
            raise invalid
        key_id, last_used = key.id, key.last_used_at
        session.rollback()  # Never upgrade a read snapshot to a SQLite write lock.
        now = utcnow()
        cutoff = now - timedelta(minutes=1)
        if last_used is None or last_used <= cutoff:
            session.execute(update(ApiKey).where(
                ApiKey.id == key_id, ApiKey.revoked_at.is_(None),
                or_(ApiKey.last_used_at.is_(None), ApiKey.last_used_at <= cutoff),
            ).values(last_used_at=now))
            session.commit()
    return key_id


KeyId = Annotated[str, Depends(authenticate)]
router = APIRouter(tags=["Public API"], dependencies=[Depends(authenticate)])


class PromptRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=4000)

    @field_validator("prompt", mode="before")
    @classmethod
    def trim_prompt(cls, value):
        return value.strip() if isinstance(value, str) else value


class ImageRequest(PromptRequest):
    model: Literal["muse-image"] = "muse-image"
    n: int = Field(default=1, ge=1, le=4, strict=True)
    size: Literal["1024x1024", "1792x1024", "1536x1024", "1024x1792", "1024x1536"] = "1024x1024"
    aspect_ratio: Ratio | None = None
    response_format: Literal["url", "b64_json"] = "url"


class VideoRequest(PromptRequest):
    model: Literal["muse-video"] = "muse-video"
    aspect_ratio: Ratio = "16:9"


class Message(BaseModel):
    role: str
    content: str | list[dict] | None = None


class ChatRequest(BaseModel):
    model: Literal["muse-image", "muse-video"]
    messages: list[Message]
    stream: bool = False

    def prompt(self):
        for message in reversed(self.messages):
            if message.role == "user":
                content = message.content
                if isinstance(content, list):
                    content = "\n".join(part["text"] for part in content
                        if part.get("type") == "text" and isinstance(part.get("text"), str))
                content = content.strip() if isinstance(content, str) else ""
                if 1 <= len(content) <= 4000:
                    return content
                break
        raise PublicError(400, "invalid_request_error", "invalid_request",
            "The last user message must contain between 1 and 4000 characters of text.")


def created(task):
    return int(task.created_at.replace(tzinfo=UTC).timestamp())


def queue(request, key_id, kind, prompt, ratio, count=1):
    values = QuickRequest(kind=kind, prompt=prompt, aspect_ratio=ratio, count=count)
    with request.app.state.database.sessions() as session:
        try:
            batch_id = enqueue(session, values, request.app.state.settings, api_key_id=key_id)
        except QuickCreateError as error:
            raise failure(error.code) from None
        task = session.scalar(select(Task).where(
            # enqueue returns the batch id; public generation ids are task ids.
            func.json_extract(Task.payload_json, "$.batchId") == batch_id
        ))
    request.app.state.task_coordinator.wake()
    return task


def read_task(request, task_id):
    with request.app.state.database.sessions() as session:
        return session.get(Task, task_id)


def poll(request, task_id):
    """Yield pending ticks with no session or transaction held during sleep."""
    deadline = time.monotonic() + request.app.state.settings.render_timeout + 120
    while True:
        task = read_task(request, task_id)
        if task is None:
            raise failure("upstream_error", "The generation task was removed.", task_id)
        if task.status in FINISHED:
            if task.status != "succeeded":
                message = (f"The generation was {task.status}."
                    if task.status in ("cancelled", "interrupted") else None)
                raise failure(task.error_code, message, task_id)
            yield task
            return
        if time.monotonic() >= deadline:
            raise failure("generation_timeout", task_id=task_id)
        yield None
        time.sleep(POLL_INTERVAL)


def wait(request, task_id):
    for task in poll(request, task_id):
        if task is not None:
            return task


FORWARDED_HOST = re.compile(r"[A-Za-z0-9.\-_:\[\]]{1,255}")


def public_base(request) -> str:
    """The address the caller reached the app at, ending in "/". Behind a
    proxy that passes it on (the development server does), that is the
    forwarded host: this server's own address would be no use to a caller
    on another machine. The header only shapes the URLs in the caller's own
    response."""
    host = request.headers.get("x-forwarded-host", "").split(",")[0].strip()
    if not FORWARDED_HOST.fullmatch(host):
        return str(request.base_url)
    scheme = request.headers.get("x-forwarded-proto", "").split(",")[0].strip()
    return f"{scheme if scheme in ('http', 'https') else request.url.scheme}://{host}/"


def result_data(request, task, response_format="url"):
    ids = json.loads(task.result_json or "{}").get("assetIds", [])
    if not ids:
        raise failure("upstream_error", "The generation returned no files.", task.id)
    if response_format == "url":
        base = public_base(request)
        return [{"url": f"{base}api/library/assets/{asset_id}/file"} for asset_id in ids]
    with request.app.state.database.sessions() as session:
        files = [session.get(LibraryAsset, asset_id) for asset_id in ids]
        paths = [storage.library_dir(request.app.state.settings) / asset.file
            for asset in files if asset is not None]
    try:
        if len(paths) != len(ids):
            raise FileNotFoundError
        return [{"b64_json": base64.b64encode(path.read_bytes()).decode()} for path in paths]
    except OSError:
        raise failure("upstream_error", "A generated file is no longer available.", task.id) from None


@router.get("/models")
def models():
    return {"object": "list", "data": [{"id": model, "object": "model",
        "created": MODEL_CREATED, "owned_by": "muse"} for model in ("muse-image", "muse-video")]}


@router.post("/images/generations")
def images(values: ImageRequest, request: Request, response: Response, key_id: KeyId):
    task = queue(request, key_id, "image", values.prompt,
        values.aspect_ratio or SIZES[values.size], values.n)
    response.headers["X-Muse-Task-Id"] = task.id
    task = wait(request, task.id)
    return {"created": created(task), "data": result_data(request, task, values.response_format)}


def video_object(task):
    return {"id": task.id, "object": "video.generation", "status": "queued",
        "created": created(task), "model": "muse-video"}


@router.post("/videos/generations", status_code=202)
def videos(values: VideoRequest, request: Request, key_id: KeyId):
    return video_object(queue(request, key_id, "video", values.prompt, values.aspect_ratio))


@router.get("/videos/generations/{generation_id}")
def video_status(generation_id: str, request: Request):
    task = read_task(request, generation_id)
    if task is None or task.kind != GENERATE_VIDEO or json.loads(task.payload_json).get("source") != "api":
        raise PublicError(404, "invalid_request_error", "not_found", "This video generation does not exist.")
    result = video_object(task)
    result["status"] = {"running": "in_progress", "interrupted": "failed"}.get(task.status, task.status)
    if task.status == "succeeded":
        result["data"] = result_data(request, task)
    elif task.status in ("failed", "interrupted"):
        result["error"] = failure(task.error_code,
            "The generation was interrupted." if task.status == "interrupted" else None).detail
    return result


def chat_content(request, task, model):
    label = "image" if model == "muse-image" else "video"
    prefix = "!" if label == "image" else ""
    return "\n".join(f"{prefix}[{label}]({item['url']})" for item in result_data(request, task))


def stream_chat(request, task, model):
    def chunk(delta, finish=None):
        body = {"id": f"chatcmpl-{task.id}", "object": "chat.completion.chunk",
            "created": created(task), "model": model,
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]}
        return "data: " + json.dumps(body) + "\n\n"

    yield chunk({"role": "assistant"})
    last_ping = time.monotonic()
    try:
        for finished in poll(request, task.id):
            if finished is not None:
                content = chat_content(request, finished, model)
                break
            if time.monotonic() - last_ping >= KEEPALIVE_INTERVAL:
                yield ": waiting\n\n"
                last_ping = time.monotonic()
    except PublicError as error:
        content = error.detail["message"]
    except Exception:
        content = MESSAGES["upstream_error"]
    yield chunk({"content": content})
    yield chunk({}, "stop")
    yield "data: [DONE]\n\n"


@router.post("/chat/completions")
def chat(values: ChatRequest, request: Request, response: Response, key_id: KeyId):
    kind = "image" if values.model == "muse-image" else "video"
    task = queue(request, key_id, kind, values.prompt(), "1:1" if kind == "image" else "16:9")
    headers = {"X-Muse-Task-Id": task.id}
    if values.stream:
        return StreamingResponse(stream_chat(request, task, values.model),
            media_type="text/event-stream", headers={**headers, "Cache-Control": "no-cache"})
    response.headers.update(headers)
    task = wait(request, task.id)
    return {"id": f"chatcmpl-{task.id}", "object": "chat.completion", "created": created(task),
        "model": values.model, "choices": [{"index": 0, "message": {"role": "assistant",
            "content": chat_content(request, task, values.model)}, "finish_reason": "stop"}],
        "usage": {"prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0}}
