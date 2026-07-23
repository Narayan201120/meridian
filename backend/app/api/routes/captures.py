from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user_id
from app.schemas.capture import TaskCaptureRequest, TaskCaptureSuggestion
from app.services.capture import TaskCaptureService

router = APIRouter()


@router.post("/structure", response_model=TaskCaptureSuggestion, summary="Structure a text capture")
async def structure_capture(
    payload: TaskCaptureRequest,
    _: Annotated[UUID, Depends(get_current_user_id)],
) -> TaskCaptureSuggestion:
    return TaskCaptureService().structure(payload.text)