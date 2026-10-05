"""Dead-subscription handling in Web Push delivery.

The push service answers 404/410 when it no longer holds a subscription
(uninstalled browser, expired subscription, cleared site data). Those are
PERMANENT: the device row must go and retrying must stop. Anything else
(5xx, DNS/connection errors) is transient: the device row stays and the
delivery is recorded FAILED.

These tests were written BEFORE the fix (TDD): on the old code every
"deletes the device" test fails because deliver_reminder treated all
failures alike and never deleted anything.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, select

from app.models import (
    Device,
    NotificationDelivery,
    NotificationDeliveryStatus,
    Reminder,
    ReminderStatus,
    ReminderType,
)
from app.services.notifications import deliver_reminder

try:
    from app.services.notifications import SubscriptionGoneError
except ImportError:  # pragma: no cover - missing until the fix lands
    SubscriptionGoneError = None  # type: ignore[assignment]


def _user_id(auth_user_id: str) -> UUID:
    return UUID(auth_user_id)


def _past(minutes: int = 5) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


async def _seed_reminder(db_session, auth_user_id: str) -> Reminder:
    reminder = Reminder(
        user_id=_user_id(auth_user_id),
        type=ReminderType.DUE_DATE,
        scheduled_for=_past(),
        status=ReminderStatus.PENDING,
    )
    db_session.add(reminder)
    await db_session.commit()
    await db_session.refresh(reminder)
    return reminder


async def _seed_device(db_session, auth_user_id: str, *, endpoint: str) -> Device:
    device = Device(
        user_id=_user_id(auth_user_id),
        platform="web",
        device_name="Test browser",
        push_token=endpoint,
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


async def _deliveries_for(db_session, reminder: Reminder) -> list[NotificationDelivery]:
    rows = await db_session.scalars(
        select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
    )
    return list(rows.all())


async def _device_exists(db_session, device_id) -> bool:
    return await db_session.scalar(select(Device).where(Device.id == device_id)) is not None


class _ScriptedTransport:
    """Fails or succeeds per endpoint so mixed outcomes are testable."""

    def __init__(self, behavior: dict[str, Exception | str]) -> None:
        self.behavior = behavior
        self.calls: list[str] = []

    async def send(self, *, subscription: str, payload: dict) -> str:
        self.calls.append(subscription)
        outcome = self.behavior.get(subscription, "ok")
        if isinstance(outcome, Exception):
            raise outcome
        return outcome if isinstance(outcome, str) else "msg-ok"


class TestGoneSubscriptionDeletesDevice:
    @pytest.mark.asyncio
    async def test_410_deletes_device_and_records_failed(self, db_session, auth_user_id):
        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/dead410")
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = _ScriptedTransport({device.push_token: HTTPException(status_code=410, detail="gone")})

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert not await _device_exists(db_session, device.id), "410 means the subscription is gone; device must go"
        deliveries = await _deliveries_for(db_session, reminder)
        assert len(deliveries) == 1
        assert deliveries[0].status == NotificationDeliveryStatus.FAILED
        assert deliveries[0].error_message

    @pytest.mark.asyncio
    async def test_404_deletes_device(self, db_session, auth_user_id):
        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/dead404")
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = _ScriptedTransport({device.push_token: HTTPException(status_code=404, detail="not found")})

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert not await _device_exists(db_session, device.id)
        deliveries = await _deliveries_for(db_session, reminder)
        assert deliveries and deliveries[0].status == NotificationDeliveryStatus.FAILED

    @pytest.mark.asyncio
    async def test_typed_gone_error_deletes_device(self, db_session, auth_user_id):
        assert SubscriptionGoneError is not None, "typed gone-error does not exist yet"
        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/typed-gone")
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = _ScriptedTransport(
            {device.push_token: SubscriptionGoneError(status_code=410, detail="subscription expired")}
        )

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert not await _device_exists(db_session, device.id)
        deliveries = await _deliveries_for(db_session, reminder)
        assert deliveries and deliveries[0].status == NotificationDeliveryStatus.FAILED


class TestTransientFailureKeepsDevice:
    @pytest.mark.asyncio
    async def test_500_keeps_device(self, db_session, auth_user_id):
        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/flaky")
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = _ScriptedTransport(
            {device.push_token: HTTPException(status_code=502, detail="push service blew up")}
        )

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert await _device_exists(db_session, device.id), "5xx is transient; device must stay"
        deliveries = await _deliveries_for(db_session, reminder)
        assert deliveries and deliveries[0].status == NotificationDeliveryStatus.FAILED
        assert deliveries[0].error_message

    @pytest.mark.asyncio
    async def test_network_error_keeps_device(self, db_session, auth_user_id):
        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/dns-fail")
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = _ScriptedTransport({device.push_token: ConnectionError("DNS lookup failed")})

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert await _device_exists(db_session, device.id), "DNS failure is transient; device must stay"
        deliveries = await _deliveries_for(db_session, reminder)
        assert deliveries and deliveries[0].status == NotificationDeliveryStatus.FAILED


class TestSendCountContract:
    @pytest.mark.asyncio
    async def test_mixed_gone_and_live_returns_one(self, db_session, auth_user_id):
        dead = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/dead")
        live = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/live")
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = _ScriptedTransport(
            {
                dead.push_token: HTTPException(status_code=410, detail="gone"),
                live.push_token: "msg-ok",
            }
        )

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 1, "only the live device accepted the message"
        assert len(transport.calls) == 2
        assert not await _device_exists(db_session, dead.id)
        assert await _device_exists(db_session, live.id)
        by_device = {d.device_id: d for d in await _deliveries_for(db_session, reminder)}
        assert by_device[dead.id].status == NotificationDeliveryStatus.FAILED
        assert by_device[live.id].status == NotificationDeliveryStatus.SENT


class TestGoneRaceIsIdempotent:
    @pytest.mark.asyncio
    async def test_gone_for_already_deleted_device_does_not_raise(self, db_session, auth_user_id):
        """A concurrent sweep may win the race and delete the row first."""
        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/racy")
        reminder = await _seed_reminder(db_session, auth_user_id)
        device_id = device.id
        endpoint = device.push_token

        async def racy_send(*, subscription: str, payload: dict) -> str:
            # Someone else deletes the row between our list and our delete.
            await db_session.execute(delete(Device).where(Device.id == device_id))
            raise HTTPException(status_code=410, detail="gone")

        class RacyTransport:
            async def send(self, *, subscription: str, payload: dict) -> str:
                assert subscription == endpoint
                return await racy_send(subscription=subscription, payload=payload)

        sent = await deliver_reminder(
            db_session, user_id=_user_id(auth_user_id), reminder=reminder, transport=RacyTransport()
        )

        assert sent == 0
        assert not await _device_exists(db_session, device_id)
        deliveries = await _deliveries_for(db_session, reminder)
        assert deliveries and deliveries[0].status == NotificationDeliveryStatus.FAILED


class TestTransportSurfacesGone:
    @pytest.mark.asyncio
    @pytest.mark.parametrize("status", [404, 410])
    async def test_transport_does_not_flatten_gone_to_502(self, monkeypatch, status: int):
        """WebPushTransport must let the caller see 404/410 distinctly."""
        from app.services.notifications import WebPushTransport

        assert SubscriptionGoneError is not None, "typed gone-error does not exist yet"
        monkeypatch.setattr("app.services.notifications.settings.web_push_public_key", "pub")
        monkeypatch.setattr("app.services.notifications.settings.web_push_private_key", "priv")
        monkeypatch.setattr("app.services.notifications.settings.web_push_subject", "mailto:a@b.c")

        transport = WebPushTransport()
        monkeypatch.setattr(transport, "_auth_headers", lambda endpoint: {})

        class _FakeResponse:
            status_code = status
            is_error = True
            text = "subscription is gone"
            headers: dict = {}

        class _FakeClient:
            def __init__(self, *args, **kwargs) -> None:
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return False

            async def post(self, *args, **kwargs):
                return _FakeResponse()

        import httpx

        monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)

        with pytest.raises(SubscriptionGoneError) as excinfo:
            await transport.send(subscription="https://push.example/x", payload={"title": "hi"})
        assert excinfo.value.status_code == status
