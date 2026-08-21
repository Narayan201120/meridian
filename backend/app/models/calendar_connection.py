from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import DateTime, Enum as SqlEnum, String, Text, text
from sqlalchemy.dialects.postgresql import UUID as PG_UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base import Base, JSONB_or_JSON


def _enum_values(enum_cls: type[StrEnum]) -> list[str]:
    return [member.value for member in enum_cls]


class TaskCalendarBlockStatus(StrEnum):
    SUGGESTED = "suggested"
    PENDING_WRITE = "pending_write"
    CONFIRMED = "confirmed"
    WRITE_FAILED = "write_failed"
    CANCELED = "canceled"


class ReminderType(StrEnum):
    DUE_DATE = "due_date"
    SCHEDULED_BLOCK = "scheduled_block"


class ReminderStatus(StrEnum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    SENT = "sent"
    FAILED = "failed"
    CANCELED = "canceled"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    provider: Mapped[str] = mapped_column(String(32), nullable=False, default="google")
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="active")
    provider_account_id: Mapped[str] = mapped_column(Text, nullable=False, default="primary")
    provider_email: Mapped[str | None] = mapped_column(Text)
    access_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[list[str]] = mapped_column(JSONB_or_JSON, nullable=False, default=list)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))


class TaskCalendarBlock(Base):
    __tablename__ = "task_calendar_blocks"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    task_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    calendar_connection_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    calendar_event_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    status: Mapped[TaskCalendarBlockStatus] = mapped_column(
        SqlEnum(
            TaskCalendarBlockStatus,
            name="task_calendar_block_status",
            native_enum=True,
            create_type=False,
            values_callable=_enum_values,
        ),
        nullable=False,
        default=TaskCalendarBlockStatus.SUGGESTED,
        server_default=TaskCalendarBlockStatus.SUGGESTED.value,
    )
    suggested_start_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    suggested_end_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    suggestion_reason: Mapped[dict] = mapped_column(JSONB_or_JSON, nullable=False, default=dict)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    write_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    write_completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))


class Reminder(Base):
    __tablename__ = "reminders"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    task_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    task_calendar_block_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    type: Mapped[ReminderType] = mapped_column(
        SqlEnum(ReminderType, name="reminder_type", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
    )
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[ReminderStatus] = mapped_column(
        SqlEnum(ReminderStatus, name="reminder_status", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
        default=ReminderStatus.PENDING,
        server_default=ReminderStatus.PENDING.value,
    )
    delivery_channel: Mapped[str] = mapped_column(Text, nullable=False, default="push")
    local_only: Mapped[bool] = mapped_column(nullable=False, default=False)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))