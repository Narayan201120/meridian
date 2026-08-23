from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db_session
from app.models.calendar_connection import VoiceCapture, VoiceCaptureStatus
from app.models.task import TaskSource
from app.schemas.capture import TaskCaptureRequest, TaskCaptureSuggestion, VoiceCaptureRequest, VoiceCaptureResponse
from app.schemas.task import TaskCreate
from app.services.capture import TaskCaptureService
from app.services.tasks import TaskService

router = APIRouter()


@router.post("/structure", response_model=TaskCaptureSuggestion, summary="Structure a text capture")
async def structure_capture(
    payload: TaskCaptureRequest,
    _: Annotated[UUID, Depends(get_current_user_id)],
) -> TaskCaptureSuggestion:
    return TaskCaptureService().structure(payload.text)


@router.post("/voice", response_model=VoiceCaptureResponse, summary="Capture voice transcript → structure → optional task")
async def voice_capture(
    payload: VoiceCaptureRequest,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> VoiceCaptureResponse:
    # Store voice capture (lean: transcript already provided, mark transcribed)
    capture = VoiceCapture(
        user_id=current_user_id,
        transcript=payload.transcript,
        transcript_provider=payload.transcript_provider or "manual",
        status=VoiceCaptureStatus.TRANSCRIBED,
        storage_path=payload.storage_path,
    )
    session.add(capture)
    await session.flush()

    suggestion = TaskCaptureService().structure(payload.transcript)

    task_id: str | None = None
    if payload.create_task:
        # Use suggestion to create task with source voice, never auto-schedule calendar
        task_payload = TaskCreate(
            title=suggestion.title,
            notes=suggestion.notes,
            priority=suggestion.priority,
            estimated_duration_minutes=suggestion.estimated_duration_minutes,
            source=TaskSource.VOICE,
            schedule_intent=suggestion.schedule_intent,
        )
        task_service = TaskService(session)
        task = await task_service.create_task(user_id=current_user_id, payload=task_payload)
        capture.task_id = task.id
        await session.commit()
        await session.refresh(capture)
        task_id = str(task.id)
    else:
        await session.commit()
        await session.refresh(capture)

    return VoiceCaptureResponse(
        voice_capture_id=str(capture.id),
        transcript=capture.transcript or payload.transcript,
        suggestion=suggestion,
        task_id=task_id,
    )