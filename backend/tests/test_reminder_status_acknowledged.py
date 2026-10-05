"""Pin the Python side of ReminderStatus.ACKNOWLEDGED.

How this can fail (written before the fix):
1. `ReminderStatus` has no ACKNOWLEDGED member at all -> AttributeError, and
   `acknowledge_reminder` cannot settle an undelivered reminder to anything
   but CANCELED, conflating "user dismissed" with "withdrawn".
2. ACKNOWLEDGED exists but with a different string (e.g. "acked",
   "acknowledge") -> the API returns a spelling the other agent's code does
   not expect, and the Postgres enum value added by the migration mismatches.
3. ACKNOWLEDGED aliases an existing value (e.g. `= "canceled"`) -> StrEnum
   aliasing makes `ReminderStatus.ACKNOWLEDGED is ReminderStatus.CANCELED`
   true and the two facts indistinguishable again.
4. ACKNOWLEDGED collides with the sweep set (PENDING) -> an acked reminder
   would be redispatched; it must be a terminal state the sweep never reads.

NOTE: the backend test suite runs on SQLite with tables created from
`Base.metadata.create_all`, so SQLite never sees the Postgres enum and cannot
test the migration. These tests pin the Python side only; the migration SQL
itself is unverified here because there is no Postgres in this environment.
"""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from app.models.calendar_connection import ReminderStatus
from app.schemas.calendar import ReminderRead


def test_acknowledged_exists_with_exact_value() -> None:
    assert ReminderStatus.ACKNOWLEDGED.value == "acknowledged"


def test_acknowledged_is_distinct_from_canceled_and_sent() -> None:
    assert ReminderStatus.ACKNOWLEDGED is not ReminderStatus.CANCELED
    assert ReminderStatus.ACKNOWLEDGED is not ReminderStatus.SENT
    assert ReminderStatus.ACKNOWLEDGED.value != ReminderStatus.CANCELED.value
    assert ReminderStatus.ACKNOWLEDGED.value != ReminderStatus.SENT.value


def test_acknowledged_is_terminal_for_the_sweep() -> None:
    """The dispatch sweep only reads PENDING rows; ACKNOWLEDGED must not be one."""
    assert ReminderStatus.ACKNOWLEDGED is not ReminderStatus.PENDING
    assert ReminderStatus.ACKNOWLEDGED not in (ReminderStatus.PENDING, ReminderStatus.SCHEDULED)


def test_acknowledged_round_trips_through_reminder_read() -> None:
    """ReminderRead.status is a plain str, so the new value must serialise as-is."""
    now = datetime.now(timezone.utc)
    payload = ReminderRead(
        id=uuid4(),
        user_id=uuid4(),
        task_id=None,
        task_calendar_block_id=None,
        type="due_date",
        scheduled_for=now,
        status=ReminderStatus.ACKNOWLEDGED.value,
        delivery_channel="push",
        local_only=False,
        sent_at=None,
        last_error_message=None,
        created_at=now,
        updated_at=now,
    )
    assert payload.status == "acknowledged"
    assert payload.model_dump()["status"] == "acknowledged"
