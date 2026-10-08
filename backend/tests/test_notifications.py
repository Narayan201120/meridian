"""Tests for Web Push delivery of reminders.

Reminders used to flip to SENT without anything reaching the user: a
NotificationDelivery row was written, marked delivered, and nothing was ever
sent. These tests pin the contract for a real transport.

A fake transport is injected so routing and failure handling can be verified
without a network or a real browser subscription.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from uuid import UUID

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models import (
    Device,
    NotificationDelivery,
    NotificationDeliveryStatus,
    Reminder,
    ReminderStatus,
    ReminderType,
)


def _user_id(auth_user_id: str) -> UUID:
    """Seed rows for the user the API client authenticates as.

    The conftest auth mock issues TEST_USER_ID, so rows must belong to that user
    or dispatch will not see them.
    """
    return UUID(auth_user_id)


def _past(minutes: int = 5) -> datetime:
    """Already due. Dispatch only picks up reminders with scheduled_for <= now."""
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


class FakeTransport:
    """Stands in for the real Web Push sender.

    Records every send and can be told to fail, so error handling is testable
    without waiting on a push service.
    """

    def __init__(self, *, fail: bool = False, error: Exception | None = None) -> None:
        self.fail = fail
        self.error = error or HTTPException(status_code=502, detail="push endpoint rejected")
        self.sent: list[str] = []

    async def send(
        self, *, subscription: str, payload: dict, p256dh: str | None = None, auth: str | None = None
    ) -> str:
        if self.fail:
            raise self.error
        self.sent.append(subscription)
        return f"msg-{len(self.sent)}"


async def _seed_reminder(db_session, auth_user_id: str, *, minutes: int = 5) -> Reminder:
    reminder = Reminder(
        user_id=_user_id(auth_user_id),
        type=ReminderType.DUE_DATE,
        scheduled_for=_past(minutes),
        status=ReminderStatus.PENDING,
    )
    db_session.add(reminder)
    await db_session.commit()
    await db_session.refresh(reminder)
    return reminder


async def _seed_device(db_session, auth_user_id: str, *, endpoint: str = "https://push.example/one") -> Device:
    """A real device row, since dispatch fans out to whatever is registered.

    Carries well-formed subscription keys: deliver_reminder refuses keyless
    devices before calling the transport, so a keyless seed would pin the
    refusal instead of the dispatch behaviour under test.
    """
    import base64
    import os

    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    nopad = lambda raw: base64.urlsafe_b64encode(raw).rstrip(b"=").decode()  # noqa: E731
    device = Device(
        user_id=_user_id(auth_user_id),
        platform="web",
        device_name="Test browser",
        push_token=endpoint,
        push_p256dh=nopad(public_bytes),
        push_auth=nopad(os.urandom(16)),
        last_seen_at=datetime.now(timezone.utc),
    )
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


class TestPushRegistration:
    @pytest.mark.asyncio
    async def test_register_creates_device_row(self, client, db_session, auth_user_id):
        resp = await client.post(
            "/api/v1/devices",
            json={
                "platform": "web",
                "device_name": "Chrome on Windows",
                "push_subscription": {
                    "endpoint": "https://push.example/abc",
                    "keys": {"p256dh": "k", "auth": "a"},
                },
            },
        )
        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body["platform"] == "web"
        assert body["device_name"] == "Chrome on Windows"
        assert body["has_push_token"] is True
        assert body["user_id"] == auth_user_id
        # The raw endpoint identifies a specific browser install; never echo it.
        assert "endpoint" not in body

        rows = await db_session.scalars(select(Device).where(Device.user_id == UUID(auth_user_id)))
        assert len(list(rows.all())) == 1

    @pytest.mark.asyncio
    async def test_register_requires_auth(self, unauthenticated_client):
        resp = await unauthenticated_client.post(
            "/api/v1/devices",
            json={
                "platform": "web",
                "push_subscription": {"endpoint": "https://push.example/abc", "keys": {"p256dh": "k", "auth": "a"}},
            },
        )
        assert resp.status_code in (401, 403)

    @pytest.mark.asyncio
    async def test_register_rejects_subscription_without_keys(self, client):
        resp = await client.post(
            "/api/v1/devices",
            json={"platform": "web", "push_subscription": {"endpoint": "https://push.example/abc"}},
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_register_rejects_non_https_endpoint(self, client):
        """A stored endpoint must never let the server POST to an arbitrary host."""
        resp = await client.post(
            "/api/v1/devices",
            json={
                "platform": "web",
                "push_subscription": {"endpoint": "http://evil.example/x", "keys": {"p256dh": "k", "auth": "a"}},
            },
        )
        assert resp.status_code == 422, resp.text

    @pytest.mark.asyncio
    async def test_re_register_same_endpoint_is_idempotent(self, client):
        payload = {
            "platform": "web",
            "device_name": "Chrome",
            "push_subscription": {"endpoint": "https://push.example/same", "keys": {"p256dh": "k", "auth": "a"}},
        }
        first = await client.post("/api/v1/devices", json=payload)
        second = await client.post("/api/v1/devices", json=payload)
        assert first.status_code == 201
        assert second.status_code in (200, 201), second.text
        assert first.json()["id"] == second.json()["id"], "duplicate device row for one endpoint"

    @pytest.mark.asyncio
    async def test_list_and_delete_devices(self, client):
        created = await client.post(
            "/api/v1/devices",
            json={
                "platform": "web",
                "device_name": "To delete",
                "push_subscription": {"endpoint": "https://push.example/gone", "keys": {"p256dh": "k", "auth": "a"}},
            },
        )
        device_id = created.json()["id"]

        listed = await client.get("/api/v1/devices")
        assert listed.status_code == 200
        assert any(d["id"] == device_id for d in listed.json())

        deleted = await client.delete(f"/api/v1/devices/{device_id}")
        assert deleted.status_code in (200, 204)

        after = await client.get("/api/v1/devices")
        assert not any(d["id"] == device_id for d in after.json())

    @pytest.mark.asyncio
    async def test_push_config_reports_enabled_state(self, client, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "web_push_public_key", None)
        monkeypatch.setattr(settings, "web_push_private_key", None)
        monkeypatch.setattr(settings, "web_push_subject", None)
        resp = await client.get("/api/v1/push/config")
        assert resp.status_code == 200
        assert resp.json() == {"enabled": False, "public_key": None}

    @pytest.mark.asyncio
    async def test_push_config_returns_base64url_point(self, client, monkeypatch):
        """The browser needs the raw EC point, not a PEM."""
        import base64

        from cryptography.hazmat.primitives import serialization
        from cryptography.hazmat.primitives.asymmetric import ec

        from app.core.config import settings

        key = ec.generate_private_key(ec.SECP256R1())
        public_pem = key.public_key().public_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        ).decode()

        monkeypatch.setattr(settings, "web_push_public_key", public_pem)
        monkeypatch.setattr(settings, "web_push_private_key", "priv")
        monkeypatch.setattr(settings, "web_push_subject", "mailto:a@b.c")

        resp = await client.get("/api/v1/push/config")
        assert resp.status_code == 200
        body = resp.json()
        assert body["enabled"] is True
        raw = body["public_key"]
        assert "BEGIN PUBLIC KEY" not in raw, "must not hand the client a PEM"
        decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4))
        assert len(decoded) == 65, "uncompressed P-256 point should be 65 bytes"
        assert decoded[0] == 0x04, "should start with the uncompressed-point marker"

    @pytest.mark.asyncio
    async def test_push_config_disabled_when_key_unparseable(self, client, monkeypatch):
        from app.core.config import settings

        monkeypatch.setattr(settings, "web_push_public_key", "not-a-pem")
        monkeypatch.setattr(settings, "web_push_private_key", "priv")
        monkeypatch.setattr(settings, "web_push_subject", "mailto:a@b.c")
        resp = await client.get("/api/v1/push/config")
        assert resp.json()["enabled"] is False, "a broken key must not advertise push"


@pytest.fixture
def vapid_configured(monkeypatch):
    """Pretend VAPID is configured.

    dispatch checks web_push_public_key before building a transport, so tests
    that expect a send must make the server look configured.
    """
    from app.core.config import settings

    monkeypatch.setattr(settings, "web_push_public_key", "test-public-key")
    monkeypatch.setattr(settings, "web_push_private_key", "test-private-key")
    monkeypatch.setattr(settings, "web_push_subject", "mailto:test@example.com")


class TestDelivery:
    @pytest.mark.asyncio
    async def test_dispatch_sends_through_transport(self, client, db_session, auth_user_id, vapid_configured):
        await _seed_device(db_session, auth_user_id)
        await _seed_reminder(db_session, auth_user_id)
        transport = FakeTransport()
        with patch("app.services.scheduling.get_push_transport", return_value=transport):
            resp = await client.post("/api/v1/tasks/reminders/dispatch")

        assert resp.status_code == 200, resp.text
        assert transport.sent, "no push was actually sent"
        assert resp.json()["dispatched"] == 1

    @pytest.mark.asyncio
    async def test_failed_send_marks_delivery_failed_not_sent(self, client, db_session, auth_user_id, vapid_configured):
        await _seed_device(db_session, auth_user_id)
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = FakeTransport(fail=True)
        with patch("app.services.scheduling.get_push_transport", return_value=transport):
            await client.post("/api/v1/tasks/reminders/dispatch")

        rows = await db_session.scalars(
            select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
        )
        deliveries = list(rows.all())
        assert deliveries, "expected a delivery row"
        for d in deliveries:
            assert d.status == NotificationDeliveryStatus.FAILED
            assert d.error_message, "failure reason must be recorded"

        # The reminder must not claim success when every send failed.
        await db_session.refresh(reminder)
        assert reminder.status == ReminderStatus.PENDING

    @pytest.mark.asyncio
    async def test_no_devices_leaves_reminder_pending(self, client, db_session, auth_user_id, vapid_configured):
        """Nothing to deliver to must not mark the reminder sent."""
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = FakeTransport()
        with patch("app.services.scheduling.get_push_transport", return_value=transport):
            resp = await client.post("/api/v1/tasks/reminders/dispatch")

        assert not transport.sent
        assert resp.json()["dispatched"] == 0
        rows = await db_session.scalars(
            select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
        )
        assert list(rows.all()) == []
        await db_session.refresh(reminder)
        assert reminder.status == ReminderStatus.PENDING, "reminder lost with no device registered"

    @pytest.mark.asyncio
    async def test_successful_delivery_records_provider_message_id(self, client, db_session, auth_user_id, vapid_configured):
        await _seed_device(db_session, auth_user_id)
        reminder = await _seed_reminder(db_session, auth_user_id)
        transport = FakeTransport()
        with patch("app.services.scheduling.get_push_transport", return_value=transport):
            await client.post("/api/v1/tasks/reminders/dispatch")

        rows = await db_session.scalars(
            select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
        )
        deliveries = list(rows.all())
        assert deliveries
        for d in deliveries:
            assert d.status == NotificationDeliveryStatus.SENT
            assert d.provider_message_id, "provider message id must be kept for debugging"
            assert d.delivered_at is not None
            assert d.provider == "web_push"

        await db_session.refresh(reminder)
        assert reminder.status == ReminderStatus.SENT

    @pytest.mark.asyncio
    async def test_fans_out_to_every_device(self, client, db_session, auth_user_id, vapid_configured):
        await _seed_device(db_session, auth_user_id, endpoint="https://push.example/one")
        await _seed_device(db_session, auth_user_id, endpoint="https://push.example/two")
        await _seed_reminder(db_session, auth_user_id)
        transport = FakeTransport()
        with patch("app.services.scheduling.get_push_transport", return_value=transport):
            await client.post("/api/v1/tasks/reminders/dispatch")

        assert len(transport.sent) == 2, "every registered device should receive the reminder"

    @pytest.mark.asyncio
    async def test_unconfigured_push_leaves_reminder_pending(self, client, db_session, auth_user_id, monkeypatch):
        """With no VAPID keys the reminder must stay pending, not vanish."""
        from app.core.config import settings

        await _seed_device(db_session, auth_user_id)
        reminder = await _seed_reminder(db_session, auth_user_id)
        monkeypatch.setattr(settings, "web_push_public_key", None)

        resp = await client.post("/api/v1/tasks/reminders/dispatch")
        assert resp.status_code == 200
        assert resp.json()["dispatched"] == 0
        await db_session.refresh(reminder)
        assert reminder.status == ReminderStatus.PENDING


class TestTransportSeam:
    @pytest.mark.asyncio
    async def test_transport_refuses_non_push_endpoint(self, monkeypatch):
        """The transport must not be usable to make the server call any host."""
        from app.core.config import settings
        from app.services.notifications import WebPushTransport

        monkeypatch.setattr(settings, "web_push_public_key", "pub")
        monkeypatch.setattr(settings, "web_push_private_key", "priv")
        monkeypatch.setattr(settings, "web_push_subject", "mailto:a@b.c")

        transport = WebPushTransport()
        with pytest.raises(HTTPException) as excinfo:
            await transport.send(subscription="https://evil.example/x", payload={"title": "hi"})
        assert excinfo.value.status_code == 400

