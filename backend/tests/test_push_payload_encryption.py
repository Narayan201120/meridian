"""Decryption round-trip for Web Push payloads (RFC 8291 / RFC 8188 aes128gcm).

A push service (FCM, Mozilla autopush, ...) accepts any POST with valid VAPID
credentials and reports success without inspecting the body. The old transport
POSTed plaintext JSON while claiming `Content-Encoding: aes128gcm`, so every
delivery row said `sent` while no browser could decrypt anything and no push
event ever surfaced. These tests pin the property that would have caught that:
bytes produced by WebPushTransport.send must decrypt back to the original JSON
with the subscription's own keys.
"""

from __future__ import annotations

import base64
import json
import os
from datetime import datetime, timedelta, timezone
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

FCM_ENDPOINT = "https://fcm.googleapis.com/fcm/send/test-subscription-id"


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _make_subscription_keypair() -> tuple[str, str, object, bytes]:
    """A fresh subscriber keypair plus auth secret, as a browser would hold them.

    Returns (p256dh_b64, auth_b64, private_key, auth_raw): the base64url forms
    travel to the server at registration, the raw forms stay in the test to
    play the browser decrypting what the server sent.
    """
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    auth_raw = os.urandom(16)
    return _b64url_nopad(public_bytes), _b64url_nopad(auth_raw), private_key, auth_raw


class _CapturingResponse:
    status_code = 201
    is_error = False
    headers: dict = {}
    text = "created"


class _CapturingClient:
    """Stands in for httpx.AsyncClient. Keeps the exact bytes POSTed.

    send() builds one client per message, so every instance registers itself
    and tests aggregate across all of them.
    """

    last: "_CapturingClient | None" = None
    instances: list["_CapturingClient"] = []

    def __init__(self, *args, **kwargs) -> None:
        self.posts: list[tuple[str, bytes, dict]] = []
        _CapturingClient.last = self
        _CapturingClient.instances.append(self)

    async def __aenter__(self) -> "_CapturingClient":
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def post(self, url: str, **kwargs) -> _CapturingResponse:
        self.posts.append((url, kwargs["content"], dict(kwargs.get("headers") or {})))
        return _CapturingResponse()


def _patch_outbound(monkeypatch) -> None:
    """Route outbound push to the capturing client and stub VAPID signing.

    These tests pin payload encryption, not VAPID: signing is stubbed so the
    only thing under test is what bytes reach the push service.
    """
    import httpx

    from app.services.notifications import WebPushTransport

    _CapturingClient.last = None
    _CapturingClient.instances = []
    monkeypatch.setattr(httpx, "AsyncClient", _CapturingClient)
    monkeypatch.setattr(WebPushTransport, "_auth_headers", lambda self, endpoint: {})


@pytest.fixture
def vapid_configured(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "web_push_public_key", "test-public-key")
    monkeypatch.setattr(settings, "web_push_private_key", "test-private-key")
    monkeypatch.setattr(settings, "web_push_subject", "mailto:test@example.com")


def _past(minutes: int = 5) -> datetime:
    return datetime.now(timezone.utc) - timedelta(minutes=minutes)


async def _seed_reminder(db_session, auth_user_id: str) -> Reminder:
    reminder = Reminder(
        user_id=UUID(auth_user_id),
        type=ReminderType.DUE_DATE,
        scheduled_for=_past(),
        status=ReminderStatus.PENDING,
    )
    db_session.add(reminder)
    await db_session.commit()
    await db_session.refresh(reminder)
    return reminder


async def _seed_device(db_session, auth_user_id: str, *, endpoint: str, p256dh=None, auth=None) -> Device:
    device = Device(
        user_id=UUID(auth_user_id),
        platform="web",
        device_name="Test browser",
        push_token=endpoint,
        last_seen_at=datetime.now(timezone.utc),
    )
    # Pre-fix the model has no key columns; only attach keys once they exist
    # so the gone-subscription pin below holds on both sides of the change.
    if hasattr(Device, "push_p256dh"):
        device.push_p256dh = p256dh
        device.push_auth = auth
    db_session.add(device)
    await db_session.commit()
    await db_session.refresh(device)
    return device


class TestPushPayloadEncryption:
    @pytest.mark.asyncio
    async def test_send_body_decrypts_with_subscription_keys(self, monkeypatch, vapid_configured):
        """The decisive property: the server's bytes must decrypt with the sub's keys.

        On the old code this fails: the body is plaintext JSON, so decrypting
        it as aes128gcm raises and the assertion never even runs.
        """
        import http_ece

        from app.services.notifications import WebPushTransport

        _patch_outbound(monkeypatch)
        p256dh, auth, private_key, auth_raw = _make_subscription_keypair()
        payload = {"title": "Meridian", "body": "A task is due in 10 minutes."}

        await WebPushTransport().send(
            subscription=FCM_ENDPOINT, payload=payload, p256dh=p256dh, auth=auth
        )

        assert _CapturingClient.last is not None and len(_CapturingClient.last.posts) == 1
        _url, body, _headers = _CapturingClient.last.posts[0]
        assert body != json.dumps(payload).encode(), "ciphertext must not be the plaintext payload"
        decrypted = http_ece.decrypt(body, private_key=private_key, auth_secret=auth_raw)
        assert json.loads(decrypted.decode()) == payload

    @pytest.mark.asyncio
    async def test_two_messages_produce_different_ciphertext(self, monkeypatch, vapid_configured):
        """A fresh salt and ephemeral key per message: identical payloads differ."""
        from app.services.notifications import WebPushTransport

        _patch_outbound(monkeypatch)
        p256dh, auth, _priv, _auth_raw = _make_subscription_keypair()
        payload = {"title": "Meridian", "body": "same payload twice"}

        transport = WebPushTransport()
        await transport.send(subscription=FCM_ENDPOINT, payload=payload, p256dh=p256dh, auth=auth)
        await transport.send(subscription=FCM_ENDPOINT, payload=payload, p256dh=p256dh, auth=auth)

        bodies = [post[1] for client in _CapturingClient.instances for post in client.posts]
        assert len(bodies) == 2
        assert bodies[0] != bodies[1], "reused salt/ephemeral key would repeat ciphertext"


class TestDeviceWithoutKeysCannotBeSent:
    @pytest.mark.asyncio
    async def test_keyless_device_records_failed_and_never_sends(self, db_session, auth_user_id):
        """A device that registered before payload encryption holds no keys.

        Sending to it would POST undecryptable bytes while recording success,
        so delivery must refuse: FAILED with a re-register explanation, and
        the transport must never be asked to send.
        """
        from app.services.notifications import deliver_reminder

        device = await _seed_device(db_session, auth_user_id, endpoint="https://push.example/legacy")
        reminder = await _seed_reminder(db_session, auth_user_id)

        class _RecordingTransport:
            def __init__(self) -> None:
                self.calls: list = []

            async def send(self, *, subscription: str, payload: dict, **kwargs) -> str:
                self.calls.append(subscription)
                return "msg-never"

        transport = _RecordingTransport()
        sent = await deliver_reminder(
            db_session, user_id=UUID(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert transport.calls == [], "transport must not be asked to send undecryptable bytes"
        rows = list(
            (
                await db_session.scalars(
                    select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
                )
            ).all()
        )
        assert len(rows) == 1
        assert rows[0].status == NotificationDeliveryStatus.FAILED
        assert rows[0].error_message and "re-register" in rows[0].error_message.lower()
        assert await db_session.scalar(select(Device).where(Device.id == device.id)) is not None


class TestGoneSubscriptionStillHolds:
    @pytest.mark.asyncio
    async def test_gone_subscription_still_deletes_device(self, db_session, auth_user_id):
        """Encrypting the payload must not change dead-subscription handling."""
        from app.services.notifications import deliver_reminder

        p256dh, auth, _priv, _auth_raw = _make_subscription_keypair()
        device = await _seed_device(
            db_session, auth_user_id, endpoint="https://push.example/dead", p256dh=p256dh, auth=auth
        )
        reminder = await _seed_reminder(db_session, auth_user_id)

        class _GoneTransport:
            def __init__(self) -> None:
                self.calls: list = []

            async def send(self, *, subscription: str, payload: dict, **kwargs) -> str:
                self.calls.append(subscription)
                raise HTTPException(status_code=410, detail="gone")

        transport = _GoneTransport()
        sent = await deliver_reminder(
            db_session, user_id=UUID(auth_user_id), reminder=reminder, transport=transport
        )

        assert sent == 0
        assert transport.calls == [device.push_token]
        assert await db_session.scalar(select(Device).where(Device.id == device.id)) is None
        rows = list(
            (
                await db_session.scalars(
                    select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder.id)
                )
            ).all()
        )
        assert rows and rows[0].status == NotificationDeliveryStatus.FAILED
