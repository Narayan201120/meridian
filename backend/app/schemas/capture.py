from pydantic import BaseModel, Field, field_validator

from app.models.task import ScheduleIntent, TaskPriority


class TaskCaptureRequest(BaseModel):
    text: str = Field(min_length=1, max_length=4_000)

    @field_validator("text")
    @classmethod
    def normalize_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Capture text cannot be blank.")
        return normalized


class TaskCaptureSuggestion(BaseModel):
    title: str
    notes: str | None
    priority: TaskPriority
    estimated_duration_minutes: int | None
    schedule_intent: ScheduleIntent
    parser: str = "heuristic_v1"


class VoiceCaptureRequest(BaseModel):
    transcript: str = Field(min_length=1, max_length=4_000)
    transcript_provider: str | None = Field(default="manual", max_length=64)
    create_task: bool = Field(default=True, description="If true, creates a Task from the transcript")
    storage_path: str | None = Field(default=None, max_length=512)

    @field_validator("transcript")
    @classmethod
    def normalize_transcript(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("Transcript cannot be blank.")
        return normalized


class VoiceCaptureResponse(BaseModel):
    voice_capture_id: str
    transcript: str
    suggestion: TaskCaptureSuggestion
    task_id: str | None = None

    model_config = {"from_attributes": True}