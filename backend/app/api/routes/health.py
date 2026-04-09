from fastapi import APIRouter

from app.core.config import settings
from app.schemas.health import HealthResponse

router = APIRouter()


@router.get("", response_model=HealthResponse, summary="Health check")
def health_check() -> HealthResponse:
    return HealthResponse(
        status="ok",
        service="backend",
        environment=settings.environment,
        version=settings.app_version,
    )

