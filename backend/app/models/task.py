from datetime import datetime
from decimal import Decimal
from enum import StrEnum
from uuid import UUID

from sqlalchemy import DateTime, Enum as SqlEnum, Integer, Numeric, String, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base


def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_cls]


class TaskStatus(StrEnum):
    INBOX = "inbox"
    SCHEDULED = "scheduled"
    COMPLETED = "completed"
    ARCHIVED = "archived"


class TaskPriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class TaskSource(StrEnum):
    MANUAL_TEXT = "manual_text"
    VOICE = "voice"
    CALENDAR_SUGGESTION = "calendar_suggestion"


class ScheduleIntent(StrEnum):
    NONE = "none"
    SUGGEST_TIME = "suggest_time"
    USER_REQUESTED_BLOCK = "user_requested_block"


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[UUID] = mapped_column(
        PG_UUID(as_uuid=True),
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(280), nullable=False)
    notes: Mapped[str | None] = mapped_column(Text())
    status: Mapped[TaskStatus] = mapped_column(
        SqlEnum(
            TaskStatus,
            name="task_status",
            native_enum=True,
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=TaskStatus.INBOX,
        server_default=TaskStatus.INBOX.value,
    )
    priority: Mapped[TaskPriority] = mapped_column(
        SqlEnum(
            TaskPriority,
            name="task_priority",
            native_enum=True,
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=TaskPriority.MEDIUM,
        server_default=TaskPriority.MEDIUM.value,
    )
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    estimated_duration_minutes: Mapped[int | None] = mapped_column(Integer())
    source: Mapped[TaskSource] = mapped_column(
        SqlEnum(
            TaskSource,
            name="task_source",
            native_enum=True,
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=TaskSource.MANUAL_TEXT,
        server_default=TaskSource.MANUAL_TEXT.value,
    )
    schedule_intent: Mapped[ScheduleIntent] = mapped_column(
        SqlEnum(
            ScheduleIntent,
            name="schedule_intent",
            native_enum=True,
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=ScheduleIntent.NONE,
        server_default=ScheduleIntent.NONE.value,
    )
    parsing_confidence: Mapped[Decimal | None] = mapped_column(Numeric(5, 4))
    ai_metadata: Mapped[dict] = mapped_column(
        JSONB,
        nullable=False,
        default=dict,
        server_default=text("'{}'::jsonb"),
    )
    client_created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=text("now()"),
    )
