"""Data-layer fields must not serialize claims the backend never earns.

1. `delivery_channel` / `local_only` are never written anywhere, so every
   reminder serializes `delivery_channel: "push"` / `local_only: false` --
   including reminders that were never delivered to any device. The only real
   provider is `"web_push"`.
2. `NotificationDelivery.provider` still defaults to `"fcm"`, a leftover of a
   removed stub. Every live insert passes `provider` explicitly; the default
   must not silently mint false provenance for a future insert that omits it.
3. `_sync_task_for_confirmation` has a dead `completed_at` backfill behind a
   branch that can never run.
"""

from __future__ import annotations

import inspect
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.models import NotificationDelivery, Reminder, ReminderStatus, ReminderType
from app.services.scheduling import SchedulingService


def _past(minutes: int = 5) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


class TestUndeliveredReminderMakesNoDeliveryClaim:
    @pytest.mark.asyncio
    async def test_pending_undelivered_reminder_serializes_no_delivery_claim(
        self, client, db_session, auth_user_id
    ):
        """A reminder no device ever received must not serialize push claims.

        Seeded PENDING with scheduled_for in the past and zero devices, so no
        delivery was possible. Before the fix the list endpoint serialized
        `delivery_channel: "push"` and `local_only: false` for it -- a fixed,
        untrue value no code path ever writes.
        """
        reminder = Reminder(
            user_id=UUID(auth_user_id),
            type=ReminderType.DUE_DATE,
            scheduled_for=_past(),
            status=ReminderStatus.PENDING,
        )
        db_session.add(reminder)
        await db_session.commit()

        resp = await client.get("/api/v1/tasks/reminders/list")
        assert resp.status_code == 200, resp.text
        body = [r for r in resp.json() if r["id"] == str(reminder.id)]
        assert len(body) == 1
        assert "delivery_channel" not in body[0], "unwritten delivery_channel must not be serialized"
        assert "local_only" not in body[0], "unwritten local_only must not be serialized"


class TestDeliveryProviderHasNoStaleDefault:
    @pytest.mark.asyncio
    async def test_omitting_provider_fails_instead_of_minting_fcm(self, db_session, auth_user_id):
        """Fail fast beats false provenance: omitting provider must not yield "fcm"."""
        delivery = NotificationDelivery(
            user_id=UUID(auth_user_id),
            reminder_id=uuid4(),
        )
        db_session.add(delivery)
        with pytest.raises(IntegrityError):
            await db_session.flush()
        await db_session.rollback()

    @pytest.mark.asyncio
    async def test_explicit_web_push_still_persists(self, db_session, auth_user_id):
        """The required-provider change must not break the one live insert shape."""
        reminder = Reminder(
            user_id=UUID(auth_user_id),
            type=ReminderType.DUE_DATE,
            scheduled_for=_past(),
            status=ReminderStatus.PENDING,
        )
        db_session.add(reminder)
        await db_session.flush()
        delivery = NotificationDelivery(
            user_id=UUID(auth_user_id),
            reminder_id=reminder.id,
            provider="web_push",
        )
        db_session.add(delivery)
        await db_session.commit()
        rows = list(
            (await db_session.scalars(select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id))).all()
        )
        assert len(rows) == 1
        assert rows[0].provider == "web_push"


class TestSyncTaskForConfirmationDeadBranch:
    def test_no_unreachable_completed_backfill(self):
        """Source-level pin: the dead `completed_at` backfill must be gone.

        White-box on purpose. The branch `if task.status == COMPLETED` sits
        inside an outer guard that already excluded COMPLETED and after inner
        branches that only ever assign DUE_NOW/SCHEDULED, so no behavioral
        test can observe it -- nothing reaches it. The only test that can fail
        before its removal inspects the method itself.
        """
        src = inspect.getsource(SchedulingService._sync_task_for_confirmation)
        assert "if task.status == TaskStatus.COMPLETED:" not in src, "dead COMPLETED re-check still present"
        assert "completed_at" not in src, "unreachable completed_at backfill still present"

    @pytest.mark.asyncio
    async def test_confirm_on_completed_task_preserves_completion(self, client, db_session):
        """Pin the intended semantics the deletion must preserve.

        Passes both before and after (the branch is dead, so behavior cannot
        change): confirming a block for an already-completed task updates
        due_at but leaves status COMPLETED and completed_at untouched.
        """
        from unittest.mock import AsyncMock, patch

        from app.models import CalendarConnection

        created = await client.post("/api/v1/tasks", json={"title": "Done long ago", "status": "completed"})
        assert created.status_code == 201, created.text
        task_id = created.json()["id"]
        user_id = UUID(created.json()["user_id"])
        completed_at_before = created.json()["completed_at"]
        assert completed_at_before is not None

        conn = CalendarConnection(user_id=user_id, provider="google", provider_account_id="primary", status="active")
        db_session.add(conn)
        await db_session.commit()

        start = datetime.now(timezone.utc) + timedelta(days=1, hours=2)
        start = start.replace(minute=0, second=0, microsecond=0)
        end = start + timedelta(minutes=30)
        block_resp = await client.post(
            f"/api/v1/tasks/{task_id}/blocks",
            json={"suggested_start_at": start.isoformat(), "suggested_end_at": end.isoformat()},
        )
        assert block_resp.status_code == 201, block_resp.text
        block_id = block_resp.json()["id"]

        with patch(
            "app.services.scheduling.GoogleCalendarService.create_calendar_event",
            new_callable=AsyncMock,
        ) as mock_create:
            mock_create.return_value = {"id": "evt_completed_1", "status": "confirmed"}
            confirm = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/confirm")
            assert confirm.status_code == 200, confirm.text

        task_resp = await client.get(f"/api/v1/tasks/{task_id}")
        assert task_resp.status_code == 200, task_resp.text
        assert task_resp.json()["status"] == "completed"
        assert task_resp.json()["completed_at"] == completed_at_before
