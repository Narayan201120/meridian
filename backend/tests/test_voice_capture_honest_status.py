"""Honest-status test for POST /captures/voice.

The endpoint receives text the user pasted. No transcription service runs
anywhere in this codebase, so storing the row as TRANSCRIBED asserts a
terminal success state no code produced. UPLOADED (the input landed) is the
truthful status.
"""

from uuid import UUID

import pytest
from httpx import AsyncClient
from sqlalchemy import select

from app.models import VoiceCapture
from app.models.calendar_connection import VoiceCaptureStatus

pytestmark = pytest.mark.asyncio


async def test_pasted_transcript_is_not_marked_transcribed(client: AsyncClient, db_session) -> None:
    response = await client.post(
        "/api/v1/captures/voice",
        json={"transcript": "Buy milk\nNeeds 10 minutes", "create_task": True},
    )
    assert response.status_code == 200, response.text
    data = response.json()

    vc = await db_session.scalar(select(VoiceCapture).where(VoiceCapture.id == UUID(data["voice_capture_id"])))
    assert vc is not None
    assert vc.status != VoiceCaptureStatus.TRANSCRIBED
    assert vc.status == VoiceCaptureStatus.UPLOADED
    assert vc.transcript_provider == "manual"
    assert data["task_id"] is not None


async def test_pasted_transcript_without_task_is_not_marked_transcribed(
    client: AsyncClient, db_session
) -> None:
    response = await client.post(
        "/api/v1/captures/voice",
        json={"transcript": "Someday clean the garage", "create_task": False},
    )
    assert response.status_code == 200, response.text
    data = response.json()

    vc = await db_session.scalar(select(VoiceCapture).where(VoiceCapture.id == UUID(data["voice_capture_id"])))
    assert vc is not None
    assert vc.status != VoiceCaptureStatus.TRANSCRIBED
    assert vc.status == VoiceCaptureStatus.UPLOADED
