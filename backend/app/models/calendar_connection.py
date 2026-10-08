from datetime import datetime, timezone
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, DateTime, Enum as SqlEnum, JSON, Text, text
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
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


class CalendarProvider(StrEnum):
    GOOGLE = "google"
    OUTLOOK = "outlook"


class CalendarConnectionStatus(StrEnum):
    ACTIVE = "active"
    REVOKED = "revoked"
    ERROR = "error"


class ReminderType(StrEnum):
    DUE_DATE = "due_date"
    SCHEDULED_BLOCK = "scheduled_block"


class ReminderStatus(StrEnum):
    PENDING = "pending"
    SCHEDULED = "scheduled"
    SENT = "sent"
    FAILED = "failed"
    CANCELED = "canceled"
    ACKNOWLEDGED = "acknowledged"


class NotificationDeliveryStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
    ACKNOWLEDGED = "acknowledged"


class VoiceCaptureStatus(StrEnum):
    PENDING_UPLOAD = "pending_upload"
    UPLOADED = "uploaded"
    TRANSCRIBED = "transcribed"
    FAILED = "failed"
    DISCARDED = "discarded"


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CalendarConnection(Base):
    __tablename__ = "calendar_connections"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    provider: Mapped[CalendarProvider] = mapped_column(
        SqlEnum(CalendarProvider, name="calendar_provider", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
        default=CalendarProvider.GOOGLE,
        server_default=CalendarProvider.GOOGLE.value,
    )
    status: Mapped[CalendarConnectionStatus] = mapped_column(
        SqlEnum(CalendarConnectionStatus, name="calendar_connection_status", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
        default=CalendarConnectionStatus.ACTIVE,
        server_default=CalendarConnectionStatus.ACTIVE.value,
    )
    provider_account_id: Mapped[str] = mapped_column(Text, nullable=False, default="primary")
    provider_email: Mapped[str | None] = mapped_column(Text)
    access_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    refresh_token_ciphertext: Mapped[str | None] = mapped_column(Text)
    token_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    scopes: Mapped[list[str]] = mapped_column(PG_ARRAY(Text).with_variant(JSON(), "sqlite"), nullable=False, default=list)
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


class NotificationDelivery(Base):
    __tablename__ = "notification_deliveries"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    reminder_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    device_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    # No default on purpose: provenance must be passed explicitly at every
    # insert site (currently WEB_PUSH_PROVIDER in notifications.deliver_reminder).
    # A default here silently minted false provenance once before ("fcm"), and
    # any default would do it again the moment a second provider appears.
    provider: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[NotificationDeliveryStatus] = mapped_column(
        SqlEnum(NotificationDeliveryStatus, name="notification_delivery_status", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
        default=NotificationDeliveryStatus.PENDING,
        server_default=NotificationDeliveryStatus.PENDING.value,
    )
    provider_message_id: Mapped[str | None] = mapped_column(Text)
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    delivered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))


class DevicePlatform(StrEnum):
    IOS = "ios"
    ANDROID = "android"
    WEB = "web"


class Device(Base):
    """A push target for a user.

    The push endpoint is the natural key: a browser re-subscribing after a token
    refresh should update this row rather than accumulate duplicates.
    """

    __tablename__ = "devices"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    platform: Mapped[DevicePlatform] = mapped_column(
        SqlEnum(DevicePlatform, name="device_platform", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
    )
    device_name: Mapped[str | None] = mapped_column(Text)
    push_token: Mapped[str | None] = mapped_column(Text)
    # Web Push payload-encryption keys (RFC 8291), base64url as the browser
    # sent them. Without these the server can only POST plaintext the browser
    # cannot decrypt, so they must be stored alongside the endpoint -- and
    # refreshed on re-subscribe, since the browser rotates them.
    push_p256dh: Mapped[str | None] = mapped_column(Text)
    push_auth: Mapped[str | None] = mapped_column(Text)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))


class VoiceCapture(Base):
    __tablename__ = "voice_captures"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    task_id: Mapped[UUID | None] = mapped_column(PG_UUID(as_uuid=True))
    status: Mapped[VoiceCaptureStatus] = mapped_column(
        SqlEnum(VoiceCaptureStatus, name="voice_capture_status", native_enum=True, create_type=False, values_callable=_enum_values),
        nullable=False,
        # No default, deliberately. This defaulted to TRANSCRIBED, which claims a
        # transcription service ran, and nothing in this codebase transcribes
        # anything: the client pastes text. A default that asserts a fact no code
        # produced is the same trap as the old NotificationDelivery fcm default,
        # so omission now has to be explicit rather than silently claiming
        # success. Every current insert sets it.
        default=None,
        server_default=None,
    )
    storage_path: Mapped[str | None] = mapped_column(Text)
    transcript: Mapped[str | None] = mapped_column(Text)
    transcript_provider: Mapped[str | None] = mapped_column(Text)
    retention_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))


class CalendarEvent(Base):
    __tablename__ = "calendar_events"

    id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4, server_default=text("gen_random_uuid()"))
    user_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    calendar_connection_id: Mapped[UUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    external_event_id: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str | None] = mapped_column(Text)
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ends_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_all_day: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="confirmed")
    raw_payload: Mapped[dict] = mapped_column(JSONB_or_JSON, nullable=False, default=dict)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=_utcnow, server_default=text("CURRENT_TIMESTAMP"))