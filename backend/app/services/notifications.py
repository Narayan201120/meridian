"""Reminder delivery over Web Push.

The reminder state machine already computed when something was due and wrote
NotificationDelivery rows, but nothing ever sent them: dispatch flipped a
reminder to SENT and the UI reported success while no message reached the user.

This module owns the transport seam. `get_push_transport` returns the real
sender in production and is the single place a test substitutes a fake, so
routing and failure handling can be verified without a network.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.calendar_connection import (
    Device,
    NotificationDelivery,
    NotificationDeliveryStatus,
    Reminder,
    ReminderType,
)
from app.models.task import Task

logger = logging.getLogger(__name__)

WEB_PUSH_PROVIDER = "web_push"

#: Push-service statuses that mean the subscription is permanently gone: the
#: browser was uninstalled, the subscription expired, or site data was cleared.
#: Retrying these can never succeed.
GONE_STATUSES = frozenset({404, 410})

#: Hosts WebPushTransport is willing to POST push payloads to.
#:
#: This is a security control, not a formality: the push endpoint is a stored
#: URL the server POSTs to on its own, so without this list a stored value
#: could turn the server into a client for an arbitrary host (SSRF). The old
#: `https://push.` prefix check looked like protection but rejected every real
#: browser: an actual Chrome subscribed against this app's VAPID key mints its
#: endpoint at fcm.googleapis.com, which has no `push.` prefix. Admitting a new
#: push service means adding its host here, never loosening the check itself.
ALLOWED_PUSH_HOSTS = frozenset(
    {
        "fcm.googleapis.com",  # Chrome / Chromium
        "updates.push.services.mozilla.com",  # Firefox
        "push.services.mozilla.com",  # Firefox (alternate)
        "web.push.apple.com",  # Safari
    }
)

#: Suffix for Edge push (Windows Notification Service): hosts vary by region
#: (e.g. wns2-par02p.notify.windows.com), so the exact names cannot be listed.
WNS_HOST_SUFFIX = ".notify.windows.com"


class SubscriptionGoneError(Exception):
    """The push service no longer holds this subscription (HTTP 404 or 410).

    Typed so callers can distinguish a dead subscription from a transient
    failure without string-matching an error message. Carries the upstream
    status code for logging.
    """

    def __init__(self, *, status_code: int, detail: str = "") -> None:
        super().__init__(f"Push subscription gone (HTTP {status_code}): {detail}"[:500])
        self.status_code = status_code
        self.detail = detail


def get_push_transport() -> "WebPushTransport":
    """The single seam for outbound push.

    Patched in tests. Everything else in this module goes through it so the
    transport can be swapped without touching delivery logic.
    """
    transport = WebPushTransport()
    transport.require_config()
    return transport


def _b64url_decode(value: str | None, *, name: str) -> bytes:
    """Decode a base64url subscription key, tolerating the missing padding.

    Browsers emit unpadded base64url; padding is restored before decoding.
    Raises ValueError on anything that cannot be a key.
    """
    if not value or not isinstance(value, str):
        raise ValueError(f"push subscription key '{name}' is missing")
    padded = value + "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(padded)
    except (binascii.Error, ValueError) as exc:
        raise ValueError(f"push subscription key '{name}' is not valid base64url") from exc


def _decode_subscription_keys(p256dh: str | None, auth: str | None) -> tuple[bytes, bytes]:
    """Decode and sanity-check a stored subscription's keys.

    p256dh must be the 65-byte uncompressed P-256 point, auth the 16-byte
    secret. Anything else can never decrypt, so it is rejected before any
    POST rather than recorded as a phantom success.
    """
    from cryptography.hazmat.primitives.asymmetric import ec

    receiver_key = _b64url_decode(p256dh, name="p256dh")
    auth_secret = _b64url_decode(auth, name="auth")
    if len(receiver_key) != 65 or receiver_key[0] != 0x04:
        raise ValueError("push subscription key 'p256dh' is not a 65-byte uncompressed P-256 point")
    if len(auth_secret) != 16:
        raise ValueError("push subscription key 'auth' is not 16 bytes")
    try:
        ec.EllipticCurvePublicKey.from_encoded_point(ec.SECP256R1(), receiver_key)
    except ValueError as exc:
        raise ValueError("push subscription key 'p256dh' is not a valid P-256 point") from exc
    return receiver_key, auth_secret


def _encrypt_push_payload(*, plaintext: bytes, p256dh: str | None, auth: str | None) -> bytes:
    """Encrypt a push body per RFC 8291 (aes128gcm) with the subscription's own keys.

    http_ece mints a fresh ephemeral keypair and salt per call, so identical
    payloads produce different ciphertext. Under aes128gcm the salt and the
    sender's public key travel in the RFC 8188 header block inside the body
    itself, so no extra headers beyond Content-Encoding are needed.
    """
    from cryptography.hazmat.primitives.asymmetric import ec

    import http_ece

    receiver_key, auth_secret = _decode_subscription_keys(p256dh, auth)
    ephemeral_private_key = ec.generate_private_key(ec.SECP256R1())
    return http_ece.encrypt(
        plaintext,
        private_key=ephemeral_private_key,
        dh=receiver_key,
        auth_secret=auth_secret,
        version="aes128gcm",
    )


class WebPushTransport:
    """Sends via the Web Push HTTP API using VAPID."""

    def __init__(self) -> None:
        self._keys: dict[str, Any] | None = None

    def require_config(self) -> None:
        if not settings.web_push_public_key or not settings.web_push_private_key or not settings.web_push_subject:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail="Web Push is not configured. Set the VAPID keys and subject.",
            )

    async def send(
        self,
        *,
        subscription: str,
        payload: dict,
        p256dh: str | None = None,
        auth: str | None = None,
    ) -> str:
        """POST an RFC 8291-encrypted payload to the push endpoint.

        The payload is encrypted with the subscription's own keys before
        POSTing: the `Content-Encoding: aes128gcm` header is only true when
        the body really is aes128gcm ciphertext, otherwise the push service
        accepts the message while no browser can decrypt it.

        Raises HTTPException on failure so the caller records it as a failed
        delivery rather than losing it.
        """
        import httpx

        self.require_config()
        endpoint = subscription
        parsed = urlparse(endpoint)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https":
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Refused push endpoint: scheme must be https.",
            )
        if not host or parsed.username or parsed.password:
            # No host, or credentials embedded in the URL: never a genuine
            # push subscription, and credentials in a stored URL would leak
            # them to logs and the delivery row.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Refused push endpoint: URL must have a host and no credentials.",
            )
        if host not in ALLOWED_PUSH_HOSTS and not host.endswith(WNS_HOST_SUFFIX):
            # Unknown host: the server must not POST a stored URL anywhere
            # that is not a known push service. Exact-match the listed hosts so
            # a lookalike such as fcm.googleapis.com.evil.test cannot pass.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Refused push endpoint: host '{host}' is not a known push service.",
            )

        headers = self._auth_headers(endpoint)
        try:
            body = _encrypt_push_payload(
                plaintext=json.dumps(payload).encode(), p256dh=p256dh, auth=auth
            )
        except ValueError as exc:
            # Missing or malformed keys: nothing POSTed here could decrypt.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Cannot encrypt for this subscription ({exc}); the device must re-register.",
            ) from exc
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(endpoint, content=body, headers=headers)
        if response.status_code in GONE_STATUSES:
            raise SubscriptionGoneError(status_code=response.status_code, detail=response.text[:200])
        if response.is_error:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=f"Push service rejected the message: {response.text[:200]}",
            )
        location = response.headers.get("location", "")
        return location.rsplit("/", 1)[-1] if location else "delivered"

    def _auth_headers(self, endpoint: str) -> dict[str, str]:
        """Build the VAPID Authorization header for a push endpoint.

        py_vapid's sign() wants `aud` as scheme://host[:port] with no path,
        otherwise it raises VapidException. It returns a ready-to-send header
        dict containing the `vapid t=...` token.
        """
        from py_vapid import Vapid

        private_pem = settings.web_push_private_key_pem
        if not private_pem:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Web Push private key is not configured.")
        vapid = Vapid.from_pem(private_pem.encode())
        parsed = urlparse(endpoint)
        audience = f"{parsed.scheme}://{parsed.netloc}"
        signed = vapid.sign({"aud": audience, "sub": settings.web_push_subject, "exp": int(time.time()) + 12 * 3600})
        return {
            **signed,
            "Content-Encoding": "aes128gcm",
            "TTL": "86400",
        }


async def register_device(
    session: AsyncSession,
    *,
    user_id: UUID,
    platform: str,
    push_endpoint: str,
    device_name: str | None,
    push_p256dh: str | None = None,
    push_auth: str | None = None,
) -> Device:
    """Insert or refresh the device for this push endpoint.

    The endpoint is the natural key: a browser re-subscribing after a token
    refresh should update the existing row, not accumulate duplicates. The
    subscription keys are stored alongside it -- and overwritten on refresh,
    because the browser rotates them on re-subscribe and a stale key encrypts
    for a point the browser no longer holds.
    """
    existing = await session.scalar(
        select(Device).where(Device.user_id == user_id, Device.push_token == push_endpoint)
    )
    now = datetime.now(timezone.utc)
    if existing is not None:
        existing.device_name = device_name
        existing.push_p256dh = push_p256dh
        existing.push_auth = push_auth
        existing.last_seen_at = now
        existing.updated_at = now
        await session.commit()
        await session.refresh(existing)
        return existing

    device = Device(
        user_id=user_id,
        platform=platform,
        device_name=device_name,
        push_token=push_endpoint,
        push_p256dh=push_p256dh,
        push_auth=push_auth,
        last_seen_at=now,
    )
    session.add(device)
    await session.commit()
    await session.refresh(device)
    return device


async def list_devices_for_user(session: AsyncSession, *, user_id: UUID) -> list[Device]:
    return list(
        (
            await session.scalars(
                select(Device).where(Device.user_id == user_id, Device.push_token.is_not(None))
            )
        ).all()
    )


async def deliver_reminder(
    session: AsyncSession,
    *,
    user_id: UUID,
    reminder: Reminder,
    transport: Any,
) -> int:
    """Fan a reminder out to every registered device.

    Returns the number of successful deliveries. A reminder is only marked SENT
    when at least one device accepted it, so a user with no devices keeps a
    pending reminder rather than silently losing it.
    """
    devices = await list_devices_for_user(session, user_id=user_id)
    if not devices:
        logger.info("no devices registered for user %s; reminder %s left pending", user_id, reminder.id)
        return 0

    task_title = None
    if reminder.task_id is not None:
        task = await session.get(Task, reminder.task_id)
        task_title = task.title if task is not None else None

    payload = {
        "title": task_title or "Meridian",
        "body": _body_for(reminder, task_title),
        "reminder_id": str(reminder.id),
        "task_id": str(reminder.task_id) if reminder.task_id else None,
        "type": reminder.type.value if hasattr(reminder.type, "value") else str(reminder.type),
    }

    sent = 0
    for device in devices:
        delivery = NotificationDelivery(
            user_id=user_id,
            reminder_id=reminder.id,
            device_id=device.id,
            provider=WEB_PUSH_PROVIDER,
            status=NotificationDeliveryStatus.PENDING,
            attempted_at=datetime.now(timezone.utc),
        )
        session.add(delivery)
        try:
            _decode_subscription_keys(device.push_p256dh, device.push_auth)
        except ValueError as exc:
            # Registered before payload encryption, or holding corrupt keys:
            # nothing POSTed here could decrypt, and the old code recorded
            # such sends as success. Refuse loudly so the device re-registers
            # instead of the user silently missing reminders.
            delivery.status = NotificationDeliveryStatus.FAILED
            delivery.error_message = (
                "Device registered before payload encryption and holds no usable "
                f"subscription keys ({exc}); the browser must re-register its push "
                "subscription."
            )[:500]
            logger.warning("push delivery refused for device %s: %s", device.id, exc)
            continue
        try:
            message_id = await transport.send(
                subscription=device.push_token,
                payload=payload,
                p256dh=device.push_p256dh,
                auth=device.push_auth,
            )
        except SubscriptionGoneError as exc:
            delivery.status = NotificationDeliveryStatus.FAILED
            delivery.error_message = str(exc)[:500]
            logger.info("push subscription gone for device %s (HTTP %s); deleting device", device.id, exc.status_code)
            await _delete_device(session, device)
            continue
        except HTTPException as exc:
            delivery.status = NotificationDeliveryStatus.FAILED
            delivery.error_message = str(exc)[:500]
            if exc.status_code in GONE_STATUSES:
                # A transport that reports the upstream status as HTTPException
                # rather than SubscriptionGoneError: still a dead subscription.
                logger.info("push subscription gone for device %s (HTTP %s); deleting device", device.id, exc.status_code)
                await _delete_device(session, device)
            else:
                logger.warning("push delivery failed for device %s: %s", device.id, exc)
            continue
        except Exception as exc:  # noqa: BLE001 - any other transport failure must be recorded
            delivery.status = NotificationDeliveryStatus.FAILED
            delivery.error_message = str(exc)[:500]
            logger.warning("push delivery failed for device %s: %s", device.id, exc)
            continue
        delivery.status = NotificationDeliveryStatus.SENT
        delivery.provider_message_id = message_id
        delivery.delivered_at = datetime.now(timezone.utc)
        sent += 1

    await session.commit()
    return sent


async def _delete_device(session: AsyncSession, device: Device) -> None:
    """Delete a dead subscription. Idempotent by construction.

    A set-based DELETE matches zero rows instead of raising when a concurrent
    sweep already removed the row, so a losing race stays silent.
    """
    await session.execute(delete(Device).where(Device.id == device.id))


def _body_for(reminder: Reminder, task_title: str | None) -> str:
    kind = reminder.type.value if hasattr(reminder.type, "value") else str(reminder.type)
    if kind == ReminderType.SCHEDULED_BLOCK.value:
        return f"{task_title or 'Your block'} starts soon."
    return f"{task_title or 'A task'} is due in 10 minutes."


def encode_vapid_public_key(public_pem: str) -> str:
    """Base64url the uncompressed EC point so the browser can use it.

    PushManager.subscribe wants the raw 65-byte point, not a PEM, so the SPKI
    wrapper has to be stripped.
    """
    from cryptography.hazmat.primitives import serialization

    key = serialization.load_pem_public_key(public_pem.encode())
    point = key.public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return base64.urlsafe_b64encode(point).rstrip(b"=").decode()
