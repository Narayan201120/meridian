from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.task import ScheduleIntent, TaskPriority, TaskSource, TaskStatus


def _normalize_text(value: str | None) -> str | None:
    if value is None:
        return None

    normalized = value.strip()
    return normalized or None


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=280)
    notes: str | None = None
    status: TaskStatus = TaskStatus.INBOX
    priority: TaskPriority = TaskPriority.MEDIUM
    due_at: datetime | None = None
    estimated_duration_minutes: int | None = Field(default=None, gt=0)
    source: TaskSource = TaskSource.MANUAL_TEXT
    schedule_intent: ScheduleIntent = ScheduleIntent.NONE
    ai_metadata: dict[str, Any] = Field(default_factory=dict)
    client_created_at: datetime | None = None
    client_mutation_id: UUID | None = None
    source_device_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        normalized = _normalize_text(value)
        if normalized is None:
            raise ValueError("Title cannot be blank.")
        return normalized

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        return _normalize_text(value)


class TaskUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=280)
    notes: str | None = None
    status: TaskStatus | None = None
    priority: TaskPriority | None = None
    due_at: datetime | None = None
    estimated_duration_minutes: int | None = Field(default=None, gt=0)
    schedule_intent: ScheduleIntent | None = None
    ai_metadata: dict[str, Any] | None = None
    client_mutation_id: UUID | None = None
    source_device_id: UUID | None = None

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str | None) -> str | None:
        if value is None:
            return None

        normalized = _normalize_text(value)
        if normalized is None:
            raise ValueError("Title cannot be blank.")
        return normalized

    @field_validator("notes")
    @classmethod
    def normalize_notes(cls, value: str | None) -> str | None:
        return _normalize_text(value)


class TaskRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    title: str
    notes: str | None
    status: TaskStatus
    priority: TaskPriority
    due_at: datetime | None
    estimated_duration_minutes: int | None
    source: TaskSource
    schedule_intent: ScheduleIntent
    parsing_confidence: float | None
    ai_metadata: dict[str, Any]
    client_created_at: datetime | None
    completed_at: datetime | None
    archived_at: datetime | None
    created_at: datetime
    updated_at: datetime
