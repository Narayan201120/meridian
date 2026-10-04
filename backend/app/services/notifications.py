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
import json
import logging
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
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


def get_push_transport() -> "WebPushTransport":
    """The single seam for outbound push.

    Patched in tests. Everything else in this module goes through it so the
    transport can be swapped without touching delivery logic.
    """
    transport = WebPushTransport()
    transport.require_config()
    return transport


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

    async def send(self, *, subscription: str, payload: dict) -> str:
        """POST payload to the push endpoint. Returns the provider message id.

        Raises HTTPException on failure so the caller records it as a failed
        delivery rather than losing it.
        """
        import httpx

        self.require_config()
        endpoint = subscription
        if not endpoint.startswith("https://push."):
            # Refuse anything that is not a genuine push service, so a stored
            # value can never be used to make the server call an arbitrary host.
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Unsupported push endpoint.")

        headers = self._auth_headers(endpoint)
        body = json.dumps(payload).encode()
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(endpoint, content=body, headers=headers)
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
) -> Device:
    """Insert or refresh the device for this push endpoint.

    The endpoint is the natural key: a browser re-subscribing after a token
    refresh should update the existing row, not accumulate duplicates.
    """
    existing = await session.scalar(
        select(Device).where(Device.user_id == user_id, Device.push_token == push_endpoint)
    )
    now = datetime.now(timezone.utc)
    if existing is not None:
        existing.device_name = device_name
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
            message_id = await transport.send(subscription=device.push_token, payload=payload)
        except Exception as exc:  # noqa: BLE001 - any transport failure must be recorded
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
