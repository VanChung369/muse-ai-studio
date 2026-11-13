from fastapi import APIRouter

from app.api.routes.accounts import router as accounts_router
from app.api.routes.health import router as health_router
from app.api.routes.projects import router as projects_router
from app.api.routes.tasks import router as tasks_router

from app.api.routes.planning import router as planning_router
from app.api.routes.render import router as render_router

api_router = APIRouter()
api_router.include_router(health_router)
api_router.include_router(accounts_router)
api_router.include_router(projects_router)
api_router.include_router(planning_router)
api_router.include_router(render_router)
api_router.include_router(tasks_router)
