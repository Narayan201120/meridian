"""Pins for Google OAuth token refresh in GoogleCalendarService.get_valid_access_token.

Background: a Supabase access token was once stored with a refresh token that
nothing ever used, so an hour after sign-in every call 401'd while the UI still
claimed to be signed in. These tests prove the Google path does not repeat that:
an expired access token is exchanged via grant_type=refresh_token, the new
token is used and persisted, and failures are recorded honestly.
"""

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.config import settings
from app.models import CalendarConnection
from app.services.google_calendar import (
    GOOGLE_CALENDAR_EVENTS_URL,
    GOOGLE_TOKEN_URL,
    GoogleCalendarService,
)


def _freshenv(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setattr(settings, "token_encryption_key", Fernet.generate_key().decode())
    monkeypatch.setattr(settings, "google_calendar_client_id", "test-client-id")
    monkeypatch.setattr(settings, "google_calendar_client_secret", "test-client-secret")


class _FakeResponse:
    def __init__(self, *, status_code=200, payload=None, text=""):
        self.status_code = status_code
        self._payload = payload or {}
        self.text = text or ""
        self.is_error = status_code >= 400

    def json(self):
        return self._payload


class _GoogleFakeClient:
    """Stands in for httpx.AsyncClient. Routes by URL and records everything."""

    instances: list["_GoogleFakeClient"] = []
    token_status: int = 200
    token_payload: dict = {}
    events_payload: dict = {"id": "evt_new", "status": "confirmed"}

    def __init__(self, *args, **kwargs):
        self.posts: list[dict] = []
        self.gets: list[dict] = []
        _GoogleFakeClient.instances.append(self)

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, **kwargs):
        self.posts.append({"url": url, "kwargs": kwargs})
        if url == GOOGLE_TOKEN_URL:
            if _GoogleFakeClient.token_status >= 400:
                return _FakeResponse(status_code=_GoogleFakeClient.token_status, text="invalid_grant")
            return _FakeResponse(status_code=200, payload=dict(_GoogleFakeClient.token_payload))
        if url == GOOGLE_CALENDAR_EVENTS_URL:
            return _FakeResponse(status_code=200, payload=dict(_GoogleFakeClient.events_payload))
        # freebusy and anything else: generic success
        return _FakeResponse(status_code=200, payload={"calendars": {"primary": {"busy": []}}})

    async def get(self, url, **kwargs):
        self.gets.append({"url": url, "kwargs": kwargs})
        return _FakeResponse(status_code=200, payload={"items": []})

    async def delete(self, url, **kwargs):
        return _FakeResponse(status_code=204, payload={})


def _install(monkeypatch, *, token_status=200, token_payload=None):
    import httpx

    _GoogleFakeClient.instances = []
    _GoogleFakeClient.token_status = token_status
    _GoogleFakeClient.token_payload = dict(token_payload) if token_payload else {}
    monkeypatch.setattr(httpx, "AsyncClient", _GoogleFakeClient)


def _token_posts():
    return [p for c in _GoogleFakeClient.instances for p in c.posts if p["url"] == GOOGLE_TOKEN_URL]


def _event_posts():
    return [p for c in _GoogleFakeClient.instances for p in c.posts if p["url"] == GOOGLE_CALENDAR_EVENTS_URL]


async def _seed(db_session, user_id, *, access="old-access", refresh="stored-refresh", expires_at, status="active"):
    cipher = settings.get_fernet()
    assert cipher is not None
    conn = CalendarConnection(
        user_id=UUID(user_id) if isinstance(user_id, str) else user_id,
        provider="google",
        provider_account_id="primary",
        status=status,
        access_token_ciphertext=cipher.encrypt(access.encode()).decode() if access else None,
        refresh_token_ciphertext=cipher.encrypt(refresh.encode()).decode() if refresh else None,
        token_expires_at=expires_at,
    )
    db_session.add(conn)
    await db_session.commit()
    await db_session.refresh(conn)
    return conn


@pytest.mark.asyncio
async def test_expired_token_is_refreshed_persisted_and_used(db_session, auth_user_id, monkeypatch):
    """The test that would have caught the original class of bug."""
    _freshenv(monkeypatch)
    old_expires = datetime.now(timezone.utc) - timedelta(hours=1)
    conn = await _seed(db_session, auth_user_id, expires_at=old_expires)
    _install(monkeypatch, token_payload={"access_token": "brand-new-token", "expires_in": 3600})

    svc = GoogleCalendarService(db_session)
    # Go through a real caller so the refreshed token is proven on the wire,
    # not just returned from the helper.
    event = await svc.create_calendar_event(
        UUID(auth_user_id),
        "Refreshed meeting",
        datetime.now(timezone.utc) + timedelta(days=1),
        datetime.now(timezone.utc) + timedelta(days=1, minutes=30),
    )
    assert event["id"] == "evt_new"

    token_calls = _token_posts()
    assert len(token_calls) == 1, "expired token must hit the token endpoint exactly once"
    sent = token_calls[0]["kwargs"]["data"]
    assert sent["grant_type"] == "refresh_token"
    assert sent["refresh_token"] == "stored-refresh"

    google_calls = _event_posts()
    assert len(google_calls) == 1
    auth_header = google_calls[0]["kwargs"]["headers"]["Authorization"]
    assert auth_header == "Bearer brand-new-token", "Google call must use the NEW token, not the expired one"

    await db_session.refresh(conn)
    assert settings.get_fernet().decrypt(conn.access_token_ciphertext.encode()).decode() == "brand-new-token"
    new_expires = conn.token_expires_at
    assert new_expires is not None
    if new_expires.tzinfo is None:
        new_expires = new_expires.replace(tzinfo=timezone.utc)
    assert new_expires > old_expires


@pytest.mark.asyncio
async def test_fresh_token_makes_no_token_call(db_session, auth_user_id, monkeypatch):
    _freshenv(monkeypatch)
    conn = await _seed(
        db_session, auth_user_id, expires_at=datetime.now(timezone.utc) + timedelta(hours=1)
    )
    _install(monkeypatch, token_payload={"access_token": "should-never-appear", "expires_in": 3600})

    svc = GoogleCalendarService(db_session)
    token = await svc.get_valid_access_token(conn)

    assert token == "old-access"
    assert _token_posts() == [], "a fresh token must not contact the token endpoint"


@pytest.mark.asyncio
async def test_skew_buffer_refreshes_token_expiring_in_30_seconds(db_session, auth_user_id, monkeypatch):
    """Pins the 60-second skew: 30s left counts as expired."""
    _freshenv(monkeypatch)
    conn = await _seed(
        db_session, auth_user_id, expires_at=datetime.now(timezone.utc) + timedelta(seconds=30)
    )
    _install(monkeypatch, token_payload={"access_token": "skew-refreshed", "expires_in": 3600})

    svc = GoogleCalendarService(db_session)
    token = await svc.get_valid_access_token(conn)

    assert token == "skew-refreshed"
    assert len(_token_posts()) == 1, "30s of life left must be treated as expired (60s skew)"


@pytest.mark.asyncio
async def test_rejected_refresh_marks_error_and_raises_401(db_session, auth_user_id, monkeypatch):
    _freshenv(monkeypatch)
    conn = await _seed(
        db_session, auth_user_id, expires_at=datetime.now(timezone.utc) - timedelta(minutes=5)
    )
    _install(monkeypatch, token_status=400)

    svc = GoogleCalendarService(db_session)
    with pytest.raises(HTTPException) as excinfo:
        await svc.get_valid_access_token(conn)
    assert excinfo.value.status_code == 401

    # The status change must be committed, not just assigned in memory.
    conn_id = conn.id
    db_session.expire_all()
    reread = await db_session.scalar(
        select(CalendarConnection).where(CalendarConnection.id == conn_id)
    )
    assert reread is not None
    assert reread.status == "error"
    assert reread.last_error_message


@pytest.mark.asyncio
async def test_no_refresh_token_is_refused_without_token_call(db_session, auth_user_id, monkeypatch):
    _freshenv(monkeypatch)
    conn = await _seed(
        db_session,
        auth_user_id,
        refresh=None,
        expires_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    _install(monkeypatch, token_payload={"access_token": "must-not-be-fetched", "expires_in": 3600})

    svc = GoogleCalendarService(db_session)
    with pytest.raises(HTTPException) as excinfo:
        await svc.get_valid_access_token(conn)
    assert excinfo.value.status_code == 401
    assert _token_posts() == [], "without a stored refresh token nothing must be sent to Google"


@pytest.mark.asyncio
async def test_refresh_failure_during_confirm_leaves_no_duplicate(db_session, auth_user_id, monkeypatch):
    """find_matching_event returns None when refresh fails, and confirm_block
    turns that None into WRITE_FAILED, not into a second Google event.

    Call chain: SchedulingService.confirm_block (scheduling.py:527) calls
    create_calendar_event, which raises 401 from get_valid_access_token
    (google_calendar.py:251). The except branch then calls
    find_matching_event, which catches that same HTTPException and returns
    None (google_calendar.py:140-142). None means no orphan to adopt, so the
    block is marked WRITE_FAILED and the error is re-raised. No Google write
    happens on either path because both need a valid token first.
    """
    _freshenv(monkeypatch)
    from app.services.scheduling import SchedulingService

    user_id = UUID(auth_user_id)
    conn = await _seed(
        db_session, auth_user_id, expires_at=datetime.now(timezone.utc) - timedelta(minutes=5)
    )
    # Token endpoint rejects the refresh: every Google call is unreachable.
    _install(monkeypatch, token_status=400)

    svc = SchedulingService(db_session)
    start = datetime.now(timezone.utc) + timedelta(days=1, hours=3)
    start = start.replace(minute=0, second=0, microsecond=0)
    end = start + timedelta(minutes=30)
    from app.models.task import Task

    task = Task(user_id=user_id, title="No duplicate on refresh failure")
    db_session.add(task)
    await db_session.commit()
    await db_session.refresh(task)
    task_resp = task
    block = await svc.create_block(
        user_id=user_id, task_id=task.id, suggested_start_at=start, suggested_end_at=end
    )

    # find_matching_event itself must be honest about the refresh failure.
    finder = GoogleCalendarService(db_session)
    assert await finder.find_matching_event(user_id, task_resp.title, start, end) is None

    # The probe above flips the connection to error (the refresh was rejected
    # and committed). Reset it so confirm_block exercises the real path:
    # create raises 401, reconcile finds no orphan, block goes WRITE_FAILED.
    await db_session.refresh(conn)
    conn.status = "active"
    conn.token_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
    await db_session.commit()

    with pytest.raises(HTTPException):
        await svc.confirm_block(user_id=user_id, task_id=task_resp.id, block_id=block.id)

    await db_session.refresh(block)
    assert block.status == "write_failed", "a failed refresh must not confirm a block that was never written"

    from app.models import CalendarEvent

    rows = list(
        (
            await db_session.scalars(
                select(CalendarEvent).where(CalendarEvent.calendar_connection_id == conn.id)
            )
        ).all()
    )
    assert rows == [], "no Google event was created, so no local mirror may exist either"
    assert _event_posts() == [], "no event write may reach Google without a valid token"
