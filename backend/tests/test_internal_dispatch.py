"""The dispatch endpoint is how a scheduler outside the process drives the sweep.

Vercel functions freeze between requests, so the in-process loop cannot be
trusted on that host. The endpoint is the one caller an external scheduler needs.
It must refuse to run without a secret: an open endpoint would let anyone spend
the operator's push quota and mark reminders sent that nobody received.
"""

from datetime import datetime, timedelta, timezone
from uuid import uuid4

import pytest

from app.core.config import settings
from app.models.task import Task, TaskStatus


@pytest.mark.asyncio
async def test_dispatch_is_refused_when_no_secret_is_configured(client, monkeypatch):
    """A missing secret is a server misconfiguration, not an invitation.

    Returning 200 here would mean every deployment that forgot the variable
    exposes a public endpoint that marks reminders sent.
    """
    monkeypatch.setattr(settings, "reminder_dispatch_secret", None)

    resp = await client.post("/api/v1/internal/dispatch")

    assert resp.status_code == 503


@pytest.mark.asyncio
async def test_dispatch_rejects_a_wrong_secret(client, monkeypatch):
    monkeypatch.setattr(settings, "reminder_dispatch_secret", "right-secret")

    resp = await client.post(
        "/api/v1/internal/dispatch",
        headers={"Authorization": "Bearer wrong-secret"},
    )

    assert resp.status_code == 401


@pytest.mark.asyncio
async def test_dispatch_runs_the_same_sweep_as_the_loop(client, db_session, monkeypatch):
    """The endpoint must run the real sweep, not a subset that only delivers.

    A due task that never reaches `due_now` would look fine in the response
    counts while the user's screen stayed stale.
    """
    monkeypatch.setattr(settings, "reminder_dispatch_secret", "right-secret")
    user_id = uuid4()
    task = Task(
        user_id=user_id,
        title="came due while no process was awake",
        status=TaskStatus.SCHEDULED,
        due_at=datetime.now(timezone.utc) - timedelta(minutes=5),
    )
    db_session.add(task)
    await db_session.commit()

    resp = await client.post(
        "/api/v1/internal/dispatch",
        headers={"Authorization": "Bearer right-secret"},
    )

    assert resp.status_code == 200
    assert resp.json() == {"tasks_activated": 1, "reminders_delivered": 0}

    await db_session.refresh(task)
    assert task.status == TaskStatus.DUE_NOW
