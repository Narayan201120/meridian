"""Cancelling scheduled work must clean up everything it created.

Two bugs motivated this file, both found by unscheduling a live task against a
real Google Calendar:

  1. Unscheduling cancelled the `due_date` reminder but left the
     `scheduled_block` reminder `pending`, so a reminder would fire for work that
     was back in the inbox. `_sync_due_date_reminder` only ever looked at
     DUE_DATE rows.
  2. Nothing ever called Google's events.delete, so the event created on confirm
     stayed on the real calendar forever.

Every test here drives the public API and asserts on the database, so it fails
if the behaviour regresses regardless of how the service is refactored.
"""

from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch
from uuid import UUID

from sqlalchemy import select

from app.models import CalendarConnection, Reminder


async def _confirmed_block(client, db_session, *, title: str = "Cancel me", external_id: str = "evt_cancel_1"):
    """Create a task, a calendar connection, and a block confirmed against Google.

    Returns (task_id, block_id, user_id).
    """
    created = await client.post("/api/v1/tasks", json={"title": title, "estimated_duration_minutes": 30})
    assert created.status_code == 201, created.text
    task_id = created.json()["id"]
    user_id = UUID(created.json()["user_id"])

    conn = CalendarConnection(user_id=user_id, provider="google", provider_account_id="primary", status="active")
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)

    start = (datetime.now(timezone.utc) + timedelta(days=1, hours=3)).replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(minutes=30)
    block_resp = await client.post(
        f"/api/v1/tasks/{task_id}/blocks",
        json={"suggested_start_at": start.isoformat(), "suggested_end_at": end.isoformat()},
    )
    assert block_resp.status_code == 201, block_resp.text
    block_id = block_resp.json()["id"]

    google_event = {"id": external_id, "status": "confirmed", "summary": title}
    with patch(
        "app.services.scheduling.GoogleCalendarService.create_calendar_event",
        new_callable=AsyncMock,
        return_value=google_event,
    ):
        confirmed = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/confirm")
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["status"] == "confirmed"
    return task_id, block_id, user_id


async def _reminders(client, task_id):
    resp = await client.get(f"/api/v1/tasks/{task_id}/reminders")
    assert resp.status_code == 200, resp.text
    return {r["type"]: r["status"] for r in resp.json()}


class TestUnscheduleCancelsBlockReminder:
    async def test_unschedule_cancels_both_reminder_types(self, client, db_session):
        """The live bug: due_date was cancelled, scheduled_block stayed pending."""
        task_id, _block_id, _uid = await _confirmed_block(client, db_session)

        before = await _reminders(client, task_id)
        assert before["due_date"] == "pending"
        assert before["scheduled_block"] == "pending"

        resp = await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "inbox", "due_at": None})
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "inbox"

        after = await _reminders(client, task_id)
        assert after["due_date"] == "canceled"
        assert after["scheduled_block"] == "canceled", "orphaned block reminder would fire for inboxed work"

    async def test_complete_cancels_both_reminder_types(self, client, db_session):
        task_id, _block_id, _uid = await _confirmed_block(client, db_session)

        resp = await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "completed"})
        assert resp.status_code == 200, resp.text

        after = await _reminders(client, task_id)
        assert after["due_date"] == "canceled"
        assert after["scheduled_block"] == "canceled"

    async def test_delete_task_cancels_both_reminder_types(self, client, db_session):
        task_id, _block_id, _uid = await _confirmed_block(client, db_session)

        resp = await client.delete(f"/api/v1/tasks/{task_id}")
        assert resp.status_code in (200, 204), resp.text

        rows = await db_session.scalars(select(Reminder).where(Reminder.task_id == UUID(task_id)))
        statuses = {r.type.value: r.status.value for r in rows.all()}
        assert statuses.get("scheduled_block") == "canceled"

    async def test_unschedule_leaves_other_tasks_alone(self, client, db_session):
        """Cancelling must be scoped to the task, not sweep every block reminder."""
        keep_id, _b1, keep_uid = await _confirmed_block(client, db_session, title="Keep me", external_id="evt_keep")
        drop_id, _b2, _u2 = await _confirmed_block(client, db_session, title="Drop me", external_id="evt_drop")

        await client.patch(f"/api/v1/tasks/{drop_id}", json={"status": "inbox", "due_at": None})

        kept = await _reminders(client, keep_id)
        assert kept["scheduled_block"] == "pending", "cancelled another task's reminder"
        assert kept["due_date"] == "pending"

    async def test_unschedule_does_not_resurrect_canceled_reminders(self, client, db_session):
        """Cancelling twice must be a no-op, not create fresh pending rows."""
        task_id, _block_id, _uid = await _confirmed_block(client, db_session)
        await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "inbox", "due_at": None})
        first = await _reminders(client, task_id)

        await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "inbox", "due_at": None})
        second = await _reminders(client, task_id)
        assert second == first
        assert set(second.values()) == {"canceled"}


class TestCancelWithdrawsGoogleEvent:
    async def test_cancel_deletes_the_google_event(self, client, db_session):
        task_id, block_id, _uid = await _confirmed_block(client, db_session, external_id="evt_withdraw_me")

        with patch(
            "app.services.google_calendar.GoogleCalendarService.delete_calendar_event",
            new_callable=AsyncMock,
        ) as mock_delete:
            resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "canceled"
        assert mock_delete.await_count == 1
        # The Google event id from suggestion_reason is what must be deleted.
        assert "evt_withdraw_me" in str(mock_delete.await_args)

    async def test_cancel_marks_block_canceled_and_clears_event_link(self, client, db_session):
        task_id, block_id, _uid = await _confirmed_block(client, db_session)
        with patch("app.services.google_calendar.GoogleCalendarService.delete_calendar_event", new_callable=AsyncMock):
            resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "canceled"
        assert body["calendar_event_id"] is None, "stale link would re-adopt a deleted event on retry"

    async def test_cancel_cancels_reminders(self, client, db_session):
        task_id, block_id, _uid = await _confirmed_block(client, db_session)
        with patch("app.services.google_calendar.GoogleCalendarService.delete_calendar_event", new_callable=AsyncMock):
            await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        after = await _reminders(client, task_id)
        assert after["scheduled_block"] == "canceled"
        assert after["due_date"] == "canceled"

    async def test_cancel_is_idempotent(self, client, db_session):
        task_id, block_id, _uid = await _confirmed_block(client, db_session)
        with patch("app.services.google_calendar.GoogleCalendarService.delete_calendar_event", new_callable=AsyncMock) as mock_delete:
            first = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
            second = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        assert first.status_code == 200
        assert second.status_code == 200, second.text
        assert second.json()["status"] == "canceled"
        # Second call must not hit Google again.
        assert mock_delete.await_count == 1

    async def test_cancel_of_unconfirmed_block_makes_no_google_call(self, client, db_session):
        """A block that never reached Google has nothing to delete."""
        created = await client.post("/api/v1/tasks", json={"title": "Never confirmed"})
        task_id = created.json()["id"]
        uid = UUID(created.json()["user_id"])
        conn = CalendarConnection(user_id=uid, provider="google", provider_account_id="primary", status="active")
        db_session.add(conn)
        await db_session.commit()

        start = (datetime.now(timezone.utc) + timedelta(days=2)).replace(minute=0, second=0, microsecond=0)
        block = await client.post(
            f"/api/v1/tasks/{task_id}/blocks",
            json={"suggested_start_at": start.isoformat(), "suggested_end_at": (start + timedelta(minutes=30)).isoformat()},
        )
        block_id = block.json()["id"]

        with patch("app.services.google_calendar.GoogleCalendarService.delete_calendar_event", new_callable=AsyncMock) as mock_delete:
            resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        assert resp.status_code == 200, resp.text
        assert mock_delete.await_count == 0

    async def test_google_delete_failure_leaves_block_confirmed(self, client, db_session):
        """Google refusing the delete must not unschedule anything.

        The block stays confirmed so the task and the real calendar still
        agree, the failure reason is recorded for the UI, and a retry after
        Google recovers cancels cleanly. Cancelling locally on a failed
        delete would strand the event on the calendar with no path back:
        a canceled block short-circuits as idempotent and confirm-after-cancel
        is rejected, so the orphan could never be retried.
        """
        from fastapi import HTTPException

        task_id, block_id, _uid = await _confirmed_block(client, db_session, external_id="evt_stuck")
        with patch(
            "app.services.google_calendar.GoogleCalendarService.delete_calendar_event",
            new_callable=AsyncMock,
            side_effect=HTTPException(status_code=502, detail="Google Calendar delete failed"),
        ):
            resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        assert resp.status_code == 502, resp.text

        blocks = await client.get(f"/api/v1/tasks/{task_id}/blocks")
        assert blocks.status_code == 200, blocks.text
        body = next(b for b in blocks.json() if b["id"] == block_id)
        assert body["status"] == "confirmed", "block must stay confirmed so task and calendar still agree"
        assert body["calendar_event_id"] is not None, "keep the link so a retry deletes the right event"
        assert body["last_error_message"], "failure reason must be recorded for the UI to surface"

        task_resp = await client.get(f"/api/v1/tasks/{task_id}")
        assert task_resp.status_code == 200, task_resp.text
        assert task_resp.json()["status"] == "scheduled", "task must stay scheduled while the event still exists"

        after = await _reminders(client, task_id)
        assert after["scheduled_block"] == "pending", "reminders must survive a cancel that did not happen"
        assert after["due_date"] == "pending"

        # The retry path design (B) exists to preserve: once Google recovers,
        # the same cancel succeeds.
        with patch("app.services.google_calendar.GoogleCalendarService.delete_calendar_event", new_callable=AsyncMock):
            retry = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        assert retry.status_code == 200, retry.text
        assert retry.json()["status"] == "canceled"
        assert retry.json()["last_error_message"] is None

    async def test_cancel_unknown_block_returns_404(self, client):
        resp = await client.post(f"/api/v1/tasks/{UUID(int=0)}/blocks/{UUID(int=0)}/cancel")
        assert resp.status_code in (403, 404)

    async def test_confirm_after_cancel_is_rejected(self, client, db_session):
        task_id, block_id, _uid = await _confirmed_block(client, db_session)
        with patch("app.services.google_calendar.GoogleCalendarService.delete_calendar_event", new_callable=AsyncMock):
            await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/cancel")
        with patch("app.services.scheduling.GoogleCalendarService.create_calendar_event", new_callable=AsyncMock) as mock_create:
            resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/confirm")
        assert resp.status_code == 409
        assert mock_create.await_count == 0, "must not resurrect a cancelled block"