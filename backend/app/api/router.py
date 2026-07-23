from fastapi import APIRouter

from app.api.routes.captures import router as captures_router
from app.api.routes.health import router as health_router
from app.api.routes.tasks import router as tasks_router

api_router = APIRouter()
api_router.include_router(health_router, prefix="/health", tags=["health"])
api_router.include_router(captures_router, prefix="/captures", tags=["captures"])
api_router.include_router(tasks_router, prefix="/tasks", tags=["tasks"])
