from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class FreeBusyRequest(BaseModel):
    time_min: datetime = Field(description="Start of window in RFC3339")
    time_max: datetime = Field(description="End of window in RFC3339")


class FreeBusyInterval(BaseModel):
    start: datetime
    end: datetime


class FreeBusyResponse(BaseModel):
    busy: list[FreeBusyInterval] = Field(default_factory=list)
    time_min: datetime
    time_max: datetime


class SuggestBlocksRequest(BaseModel):
    duration_minutes: int | None = Field(default=None, ge=1, le=1440, description="Override estimated duration")
    time_min: datetime | None = None
    time_max: datetime | None = None
    max_results: int = Field(default=3, ge=1, le=10)


class SuggestedBlock(BaseModel):
    suggested_start_at: datetime
    suggested_end_at: datetime
    reason: dict = Field(default_factory=dict)


class SuggestBlocksResponse(BaseModel):
    task_id: UUID
    duration_minutes: int
    suggestions: list[SuggestedBlock]


class TaskCalendarBlockCreate(BaseModel):
    suggested_start_at: datetime
    suggested_end_at: datetime
    suggestion_reason: dict = Field(default_factory=dict)


class TaskCalendarBlockRead(BaseModel):
    id: UUID
    user_id: UUID
    task_id: UUID
    calendar_connection_id: UUID
    calendar_event_id: UUID | None
    status: str
    suggested_start_at: datetime
    suggested_end_at: datetime
    suggestion_reason: dict
    approved_at: datetime | None
    write_requested_at: datetime | None
    write_completed_at: datetime | None
    last_error_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
