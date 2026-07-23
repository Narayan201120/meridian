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