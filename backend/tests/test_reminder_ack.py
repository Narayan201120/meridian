"""Ack must persist: pressing Ack on a pending reminder has to stick.

Regression: `acknowledge_reminder` flipped only NotificationDelivery rows and
left the Reminder PENDING, so the next poll re-listed it and the row came
back. These tests drive the public API and assert on the database, so they
fail if ack stops persisting regardless of how the service is refactored.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select

from app.models import NotificationDelivery, NotificationDeliveryStatus, Reminder, ReminderStatus, ReminderType


def _past(minutes: int = 5) -> datetime:
    """Already due. Dispatch only picks up reminders with scheduled_for <= now."""
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


async def _seed_reminder(db_session, user_id: UUID, *, status: ReminderStatus = ReminderStatus.PENDING) -> Reminder:
    reminder = Reminder(
        user_id=user_id,
        type=ReminderType.DUE_DATE,
        scheduled_for=_past(),
        status=status,
    )
    db_session.add(reminder)
    await db_session.commit()
    await db_session.refresh(reminder)
    return reminder


async def _pending_ids(client, **params) -> list[str]:
    resp = await client.get("/api/v1/tasks/reminders/list", params={"status_filter": "pending", **params})
    assert resp.status_code == 200, resp.text
    return [r["id"] for r in resp.json()]


class TestAckPersists:
    @pytest.mark.asyncio
    async def test_ack_pending_reminder_leaves_it_no_longer_pending(self, client, db_session, auth_user_id):
        """The live bug: ack vanished the row locally, the next poll brought it back."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id))

        resp = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] != ReminderStatus.PENDING.value

        # A re-read must agree: not pending in the DB and not in the pending list.
        await db_session.refresh(reminder)
        assert reminder.status != ReminderStatus.PENDING
        assert str(reminder.id) not in await _pending_ids(client)

    @pytest.mark.asyncio
    async def test_acked_pending_reminder_is_not_redispatched(self, client, db_session, auth_user_id):
        """Ack must stop retries: the due sweep only looks at PENDING rows."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id))

        ack = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert ack.status_code == 200, ack.text

        disp = await client.post("/api/v1/tasks/reminders/dispatch")
        assert disp.status_code == 200, disp.text
        assert disp.json()["dispatched"] == 0

        await db_session.refresh(reminder)
        assert reminder.status != ReminderStatus.PENDING

    @pytest.mark.asyncio
    async def test_ack_sent_reminder_stays_sent(self, client, db_session, auth_user_id):
        """Acking something already delivered must not rewrite history to canceled."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id), status=ReminderStatus.SENT)

        resp = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == ReminderStatus.SENT.value

        await db_session.refresh(reminder)
        assert reminder.status == ReminderStatus.SENT

    @pytest.mark.asyncio
    async def test_ack_reminder_without_deliveries_does_not_raise(self, client, db_session, auth_user_id):
        """The common case: no device means no delivery rows exist at all."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id))
        rows = await db_session.scalars(
            select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
        )
        assert list(rows.all()) == []

        resp = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert resp.status_code == 200, resp.text

        await db_session.refresh(reminder)
        assert reminder.status != ReminderStatus.PENDING

    @pytest.mark.asyncio
    async def test_ack_someone_elses_reminder_404s(self, client, db_session, auth_user_id):
        """Ack must be scoped to the caller; other users' reminders must not leak."""
        other = await _seed_reminder(db_session, uuid4())

        resp = await client.post(f"/api/v1/tasks/reminders/{other.id}/ack")
        assert resp.status_code == 404, resp.text

        # And the other user's row must be untouched.
        await db_session.refresh(other)
        assert other.status == ReminderStatus.PENDING

    @pytest.mark.asyncio
    async def test_acked_undelivered_reminder_is_distinguishable_from_delivered(self, client, db_session, auth_user_id):
        """'Seen and dismissed' and 'pushed to a device' are different facts."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id))

        resp = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] != ReminderStatus.SENT.value, "ack must not claim delivery"

        await db_session.refresh(reminder)
        assert reminder.status != ReminderStatus.SENT
        assert reminder.sent_at is None, "nothing was delivered, so sent_at must stay empty"


class TestAckSettlesDeliveries:
    @pytest.mark.asyncio
    async def test_ack_marks_pending_deliveries_acknowledged(self, client, db_session, auth_user_id):
        """Leaving delivery rows PENDING under an acknowledged reminder is wrong;
        the delivery enum already has ACKNOWLEDGED, so use it."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id))
        for _ in range(2):
            db_session.add(
                NotificationDelivery(
                    user_id=UUID(auth_user_id),
                    reminder_id=reminder.id,
                    provider="web_push",
                    status=NotificationDeliveryStatus.PENDING,
                )
            )
        await db_session.commit()

        resp = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert resp.status_code == 200, resp.text

        rows = await db_session.scalars(
            select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
        )
        deliveries = list(rows.all())
        assert deliveries
        assert all(d.status == NotificationDeliveryStatus.ACKNOWLEDGED for d in deliveries)

    @pytest.mark.asyncio
    async def test_ack_is_idempotent(self, client, db_session, auth_user_id):
        """Acking twice must be a no-op, not an error and not a resurrection."""
        reminder = await _seed_reminder(db_session, UUID(auth_user_id))

        first = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert first.status_code == 200, first.text
        second = await client.post(f"/api/v1/tasks/reminders/{reminder.id}/ack")
        assert second.status_code == 200, second.text
        assert second.json()["status"] == first.json()["status"]

        await db_session.refresh(reminder)
        assert reminder.status != ReminderStatus.PENDING
