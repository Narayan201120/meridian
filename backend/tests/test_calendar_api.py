from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, patch

import pytest


@pytest.mark.asyncio
async def test_calendar_status_not_connected(client):
    resp = await client.get("/api/v1/calendar/google/status")
    assert resp.status_code == 200
    assert resp.json()["status"] == "not_connected"


@pytest.mark.asyncio
async def test_calendar_authorize_requires_auth(unauthenticated_client):
    resp = await unauthenticated_client.get("/api/v1/calendar/google/authorize")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_freebusy_requires_auth(unauthenticated_client):
    payload = {"time_min": "2026-08-24T09:00:00Z", "time_max": "2026-08-24T18:00:00Z"}
    resp = await unauthenticated_client.post("/api/v1/calendar/google/freebusy", json=payload)
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_freebusy_returns_busy(client):
    mock_busy = [{"start": "2026-08-24T10:00:00Z", "end": "2026-08-24T11:00:00Z"}]
    with patch("app.api.routes.calendar.GoogleCalendarService.fetch_freebusy", new_callable=AsyncMock) as mock_fb:
        mock_fb.return_value = mock_busy
        payload = {"time_min": "2026-08-24T09:00:00Z", "time_max": "2026-08-24T18:00:00Z"}
        resp = await client.post("/api/v1/calendar/google/freebusy", json=payload)
        assert resp.status_code == 200
        body = resp.json()
        assert body["time_min"] == "2026-08-24T09:00:00+00:00" or "2026-08-24T09:00:00Z" in str(body["time_min"])
        assert len(body["busy"]) == 1


@pytest.mark.asyncio
async def test_suggest_blocks_uses_task_duration(client):
    # create task with 60 min estimate
    create_resp = await client.post("/api/v1/tasks", json={"title": "Plan sprint", "estimated_duration_minutes": 60})
    assert create_resp.status_code == 201
    task_id = create_resp.json()["id"]

    # Mock calendar freebusy to return empty (free all day)
    with patch("app.services.scheduling.GoogleCalendarService.fetch_freebusy", new_callable=AsyncMock) as mock_fb:
        mock_fb.return_value = []
        now = datetime.now(timezone.utc) + timedelta(hours=1)
        now = now.replace(minute=0, second=0, microsecond=0)
        time_min = now.isoformat().replace("+00:00", "Z")
        time_max = (now + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        resp = await client.post(
            f"/api/v1/tasks/{task_id}/suggest-blocks",
            json={"time_min": time_min, "time_max": time_max, "max_results": 2},
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["task_id"] == task_id
        assert body["duration_minutes"] == 60
        assert len(body["suggestions"]) == 2
        # suggestions should be 60 min long
        for s in body["suggestions"]:
            start = datetime.fromisoformat(s["suggested_start_at"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(s["suggested_end_at"].replace("Z", "+00:00"))
            assert (end - start) == timedelta(minutes=60)


@pytest.mark.asyncio
async def test_suggest_blocks_override_duration(client):
    create_resp = await client.post("/api/v1/tasks", json={"title": "Quick task", "estimated_duration_minutes": 15})
    task_id = create_resp.json()["id"]
    with patch("app.services.scheduling.GoogleCalendarService.fetch_freebusy", new_callable=AsyncMock) as mock_fb:
        mock_fb.return_value = []
        now = datetime.now(timezone.utc) + timedelta(hours=2)
        now = now.replace(minute=0, second=0, microsecond=0)
        time_min = now.isoformat().replace("+00:00", "Z")
        time_max = (now + timedelta(days=1)).isoformat().replace("+00:00", "Z")
        resp = await client.post(
            f"/api/v1/tasks/{task_id}/suggest-blocks",
            json={"duration_minutes": 45, "time_min": time_min, "time_max": time_max},
        )
        assert resp.status_code == 200
        assert resp.json()["duration_minutes"] == 45
        for s in resp.json()["suggestions"]:
            start = datetime.fromisoformat(s["suggested_start_at"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(s["suggested_end_at"].replace("Z", "+00:00"))
            assert (end - start) == timedelta(minutes=45)


@pytest.mark.asyncio
async def test_suggest_blocks_not_found(client):
    import uuid

    fake_id = str(uuid.uuid4())
    with patch("app.services.scheduling.GoogleCalendarService.fetch_freebusy", new_callable=AsyncMock) as mock_fb:
        mock_fb.return_value = []
        resp = await client.post(f"/api/v1/tasks/{fake_id}/suggest-blocks", json={})
        assert resp.status_code == 404


@pytest.mark.asyncio
async def test_create_block_requires_calendar_connection(client):
    create_resp = await client.post("/api/v1/tasks", json={"title": "Block me"})
    task_id = create_resp.json()["id"]
    payload = {
        "suggested_start_at": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat(),
        "suggested_end_at": (datetime.now(timezone.utc) + timedelta(days=1, minutes=30)).isoformat(),
    }
    resp = await client.post(f"/api/v1/tasks/{task_id}/blocks", json=payload)
    assert resp.status_code == 404
    assert "calendar" in resp.text.lower()


@pytest.mark.asyncio
async def test_create_and_list_blocks(client, db_session):
    from uuid import UUID

    from app.models import CalendarConnection

    create_resp = await client.post("/api/v1/tasks", json={"title": "Schedule me"})
    assert create_resp.status_code == 201
    task_user_id = UUID(create_resp.json()["user_id"])
    # seed connection matching the authenticated user (derived from created task)
    conn = CalendarConnection(user_id=task_user_id, provider="google", provider_account_id="primary", status="active")
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)

    task_id = create_resp.json()["id"]
    start = datetime.now(timezone.utc) + timedelta(days=1, hours=2)
    start = start.replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(minutes=45)
    payload = {"suggested_start_at": start.isoformat(), "suggested_end_at": end.isoformat(), "suggestion_reason": {"kind": "test"}}
    resp = await client.post(f"/api/v1/tasks/{task_id}/blocks", json=payload)
    assert resp.status_code == 201, resp.text
    block_id = resp.json()["id"]
    assert resp.json()["status"] == "suggested"
    # list
    list_resp = await client.get(f"/api/v1/tasks/{task_id}/blocks")
    assert list_resp.status_code == 200
    assert any(b["id"] == block_id for b in list_resp.json())


@pytest.mark.asyncio
async def test_confirm_block_writes_and_updates_task(client, db_session):
    from uuid import UUID

    from app.models import CalendarConnection

    create_resp = await client.post("/api/v1/tasks", json={"title": "Confirm me", "estimated_duration_minutes": 30})
    task_id = create_resp.json()["id"]
    task_user_id = UUID(create_resp.json()["user_id"])
    conn = CalendarConnection(user_id=task_user_id, provider="google", provider_account_id="primary", status="active")
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)

    start = datetime.now(timezone.utc) + timedelta(days=1, hours=3)
    start = start.replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(minutes=30)
    block_resp = await client.post(f"/api/v1/tasks/{task_id}/blocks", json={"suggested_start_at": start.isoformat(), "suggested_end_at": end.isoformat()})
    block_id = block_resp.json()["id"]
    with patch("app.services.scheduling.GoogleCalendarService.create_calendar_event", new_callable=AsyncMock) as mock_create:
        mock_create.return_value = {"id": "evt_123", "status": "confirmed"}
        resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/confirm")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["status"] == "confirmed"
        assert body["id"] == block_id
        assert body["suggestion_reason"]["external_event_id"] == "evt_123"
    # task should now be scheduled with due_at = start (if future)
    task_resp = await client.get(f"/api/v1/tasks/{task_id}")
    assert task_resp.status_code == 200
    assert task_resp.json()["due_at"] is not None
    assert task_resp.json()["status"] in ("scheduled", "due_now")


@pytest.mark.asyncio
async def test_confirm_block_not_found(client, db_session):
    from uuid import UUID

    from app.models import CalendarConnection

    create_resp = await client.post("/api/v1/tasks", json={"title": "Task"})
    task_user_id = UUID(create_resp.json()["user_id"])
    conn = CalendarConnection(user_id=task_user_id, provider="google", provider_account_id="primary", status="active")
    db_session.add(conn)
    await db_session.commit()
    task_id = create_resp.json()["id"]
    import uuid

    fake_block = str(uuid.uuid4())
    resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{fake_block}/confirm")
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_scheduled_task_creates_due_date_reminder(client, db_session):
    from uuid import UUID

    from sqlalchemy import select

    from app.models import Reminder

    future = datetime.now(timezone.utc) + timedelta(days=2)
    future = future.replace(minute=0, second=0, microsecond=0)
    resp = await client.post("/api/v1/tasks", json={"title": "Remind me", "status": "scheduled", "due_at": future.isoformat()})
    assert resp.status_code == 201, resp.text
    task_id = UUID(resp.json()["id"])
    # reminder should exist
    reminders = await db_session.scalars(select(Reminder).where(Reminder.task_id == task_id))
    items = list(reminders.all())
    assert len(items) == 1
    assert items[0].type == "due_date"
    assert items[0].status in ("pending", "scheduled")


@pytest.mark.asyncio
async def test_confirm_block_creates_scheduled_block_reminder(client, db_session):
    from uuid import UUID

    from sqlalchemy import select

    from app.models import CalendarConnection, Reminder

    create_resp = await client.post("/api/v1/tasks", json={"title": "Block remind"})
    task_id = create_resp.json()["id"]
    task_user_id = UUID(create_resp.json()["user_id"])
    conn = CalendarConnection(user_id=task_user_id, provider="google", provider_account_id="primary", status="active")
    db_session.add(conn)
    await db_session.commit()
    start = datetime.now(timezone.utc) + timedelta(days=1, hours=4)
    start = start.replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(minutes=30)
    block_resp = await client.post(f"/api/v1/tasks/{task_id}/blocks", json={"suggested_start_at": start.isoformat(), "suggested_end_at": end.isoformat()})
    block_id = block_resp.json()["id"]
    with patch("app.services.scheduling.GoogleCalendarService.create_calendar_event", new_callable=AsyncMock) as mock_create:
        mock_create.return_value = {"id": "evt_remind", "status": "confirmed"}
        resp = await client.post(f"/api/v1/tasks/{task_id}/blocks/{block_id}/confirm")
        assert resp.status_code == 200
    # should have both due_date and scheduled_block reminders
    rems = await db_session.scalars(select(Reminder).where(Reminder.task_id == UUID(task_id)))
    items = list(rems.all())
    types = {r.type for r in items}
    assert "due_date" in types
    assert "scheduled_block" in types
    assert any(r.task_calendar_block_id is not None for r in items)


@pytest.mark.asyncio
async def test_unschedule_cancels_reminder(client, db_session):
    from uuid import UUID

    from sqlalchemy import select

    from app.models import Reminder

    future = datetime.now(timezone.utc) + timedelta(days=2)
    future = future.replace(minute=0, second=0, microsecond=0)
    resp = await client.post("/api/v1/tasks", json={"title": "Cancel remind", "status": "scheduled", "due_at": future.isoformat()})
    task_id = UUID(resp.json()["id"])
    # unschedule
    resp2 = await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "inbox", "due_at": None})
    assert resp2.status_code == 200
    rems = await db_session.scalars(select(Reminder).where(Reminder.task_id == task_id, Reminder.status == "pending"))
    assert len(list(rems.all())) == 0
    # should have canceled
    all_rems = await db_session.scalars(select(Reminder).where(Reminder.task_id == task_id))
    assert any(r.status == "canceled" for r in all_rems.all())


@pytest.mark.asyncio
async def test_list_reminders_via_api(client, db_session):
    from sqlalchemy import select

    from app.models import Reminder

    future = datetime.now(timezone.utc) + timedelta(days=2, hours=1)
    future = future.replace(minute=0, second=0, microsecond=0)
    resp = await client.post("/api/v1/tasks", json={"title": "API remind", "status": "scheduled", "due_at": future.isoformat()})
    task_id = resp.json()["id"]
    # via API
    api_resp = await client.get(f"/api/v1/tasks/{task_id}/reminders")
    assert api_resp.status_code == 200, api_resp.text
    body = api_resp.json()
    assert len(body) == 1
    assert body[0]["type"] == "due_date"
    assert body[0]["task_id"] == task_id
    # also verify via DB still 1
    from uuid import UUID

    rems = await db_session.scalars(select(Reminder).where(Reminder.task_id == UUID(task_id)))
    assert len(list(rems.all())) == 1


@pytest.mark.asyncio
async def test_list_reminders_requires_auth(unauthenticated_client):
    import uuid

    fake_id = str(uuid.uuid4())
    resp = await unauthenticated_client.get(f"/api/v1/tasks/{fake_id}/reminders")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_dispatch_and_ack_reminder(client, db_session):
    from datetime import datetime, timedelta, timezone
    from uuid import UUID

    from sqlalchemy import select

    from app.models import NotificationDelivery, Reminder

    # create task scheduled 1 hour ahead
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    future = future.replace(minute=0, second=0, microsecond=0)
    resp = await client.post("/api/v1/tasks", json={"title": "Dispatch me", "status": "scheduled", "due_at": future.isoformat()})
    task_id = UUID(resp.json()["id"])
    # force reminder to be due (scheduled_for in past)
    rems = await db_session.scalars(select(Reminder).where(Reminder.task_id == task_id))
    items = list(rems.all())
    assert len(items) == 1
    r = items[0]
    r.scheduled_for = datetime.now(timezone.utc) - timedelta(minutes=1)
    await db_session.commit()
    # dispatch
    disp = await client.post("/api/v1/tasks/reminders/dispatch")
    assert disp.status_code == 200, disp.text
    body = disp.json()
    assert body["dispatched"] == 1
    assert len(body["reminders"]) == 1
    # reminder should now be sent
    await db_session.refresh(r)
    assert r.status == "sent"
    assert r.sent_at is not None
    # delivery should exist
    dels = await db_session.scalars(select(NotificationDelivery).where(NotificationDelivery.reminder_id == r.id))
    assert len(list(dels.all())) == 1
    # ack
    ack = await client.post(f"/api/v1/tasks/reminders/{r.id}/ack")
    assert ack.status_code == 200
    # delivery should be acknowledged
    dels2 = await db_session.scalars(select(NotificationDelivery).where(NotificationDelivery.reminder_id == r.id))
    assert any(d.status == "acknowledged" for d in dels2.all())
    # list all reminders
    lst = await client.get("/api/v1/tasks/reminders/list")
    assert lst.status_code == 200
    assert any(x["id"] == str(r.id) for x in lst.json())


@pytest.mark.asyncio
async def test_dispatch_requires_auth(unauthenticated_client):
    resp = await unauthenticated_client.post("/api/v1/tasks/reminders/dispatch")
    assert resp.status_code in (401, 403)


@pytest.mark.asyncio
async def test_calendar_sync_and_cached_suggest(client, db_session):
    from unittest.mock import AsyncMock, patch
    from uuid import UUID

    from sqlalchemy import select

    from app.models import CalendarConnection, CalendarEvent

    # create task
    create_resp = await client.post("/api/v1/tasks", json={"title": "Cached suggest"})
    task_id = create_resp.json()["id"]
    task_user_id = UUID(create_resp.json()["user_id"])
    conn = CalendarConnection(user_id=task_user_id, provider="google", provider_account_id="primary", status="active")
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)
    # mock Google events list for sync
    mock_events = {
        "items": [
            {
                "id": "evt1",
                "summary": "Busy block",
                "status": "confirmed",
                "start": {"dateTime": (datetime.now(timezone.utc) + timedelta(hours=2)).isoformat().replace("+00:00", "Z")},
                "end": {"dateTime": (datetime.now(timezone.utc) + timedelta(hours=3)).isoformat().replace("+00:00", "Z")},
            }
        ]
    }
    from unittest.mock import Mock

    with patch("httpx.AsyncClient.get", new_callable=AsyncMock) as mock_get:
        mock_resp = Mock()
        mock_resp.is_error = False
        mock_resp.json.return_value = mock_events
        mock_get.return_value = mock_resp
        # need to mock get_valid_access_token to avoid decrypt
        with patch("app.services.google_calendar.GoogleCalendarService.get_valid_access_token", new_callable=AsyncMock) as mock_token:
            mock_token.return_value = "fake-token"
            payload = {"time_min": (datetime.now(timezone.utc)).isoformat(), "time_max": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
            sync_resp = await client.post("/api/v1/calendar/google/sync", json=payload)
            assert sync_resp.status_code == 200, sync_resp.text
            assert sync_resp.json()["synced"] == 1
    # verify cached
    evs = await db_session.scalars(select(CalendarEvent).where(CalendarEvent.calendar_connection_id == conn.id))
    assert len(list(evs.all())) == 1
    # now suggest should use cached (mock freebusy should not be called)
    with patch("app.services.google_calendar.GoogleCalendarService.fetch_freebusy", new_callable=AsyncMock) as mock_fb:
        mock_fb.side_effect = AssertionError("should use cache, not live freebusy")
        with patch("app.services.google_calendar.GoogleCalendarService.list_cached_events", new_callable=AsyncMock) as mock_cached:
            busy_start = datetime.now(timezone.utc) + timedelta(hours=2)
            busy_end = busy_start + timedelta(hours=1)
            mock_cached.return_value = [{"start": busy_start.isoformat().replace("+00:00", "Z"), "end": busy_end.isoformat().replace("+00:00", "Z")}]
            resp = await client.post(f"/api/v1/tasks/{task_id}/suggest-blocks", json={})
            assert resp.status_code == 200
            # ensure suggestions avoid busy window
            for s in resp.json()["suggestions"]:
                s_start = datetime.fromisoformat(s["suggested_start_at"].replace("Z", "+00:00"))
                # should not overlap busy
                assert not (busy_start <= s_start < busy_end)
