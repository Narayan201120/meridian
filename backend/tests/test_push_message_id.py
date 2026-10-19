"""What the transport reports about the push service's answer.

`NotificationDelivery.provider_message_id` promises an identifier issued by the
push service. The transport used to fall back to the literal string
`"delivered"` whenever the service accepted a message without a `Location`
header, so a row could carry a provider id that no provider ever issued.

RFC 8030 makes `Location` optional on `201 Created`, so that fallback was
reachable with a conforming service. The honest value when the service does not
identify the message is NULL: the message was accepted, its provider id is
unknown. A made-up word is worse than no value, because it makes a later check
believe the provider confirmed something it never said.

These tests were written before the fix: the first and third fail on the old
code, which returns "delivered" and the bare host respectively.
"""

from __future__ import annotations

import base64
import os

import pytest


def _b64url_nopad(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _subscription_keys() -> tuple[str, str]:
    """A real subscriber keypair, because send() refuses to encrypt without one."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import ec

    private_key = ec.generate_private_key(ec.SECP256R1())
    public_bytes = private_key.public_key().public_bytes(
        encoding=serialization.Encoding.X962,
        format=serialization.PublicFormat.UncompressedPoint,
    )
    return _b64url_nopad(public_bytes), _b64url_nopad(os.urandom(16))


class _Response:
    def __init__(self, headers: dict[str, str] | None = None) -> None:
        self.status_code = 201
        self.is_error = False
        self.headers = headers or {}
        self.text = "created"


class _Client:
    """Stands in for httpx.AsyncClient and returns one scripted response."""

    response = _Response()

    def __init__(self, *args, **kwargs) -> None:
        pass

    async def __aenter__(self) -> "_Client":
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def post(self, url: str, **kwargs) -> _Response:
        return type(self).response


@pytest.fixture
def vapid_configured(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "web_push_public_key", "test-public-key")
    monkeypatch.setattr(settings, "web_push_private_key", "test-private-key")
    monkeypatch.setattr(settings, "web_push_subject", "mailto:test@example.com")


def _patch(monkeypatch, response: _Response) -> None:
    import httpx

    from app.services.notifications import WebPushTransport

    _Client.response = response
    monkeypatch.setattr(httpx, "AsyncClient", _Client)
    # Google's key parsing is not under test here.
    monkeypatch.setattr(WebPushTransport, "_auth_headers", lambda self, endpoint: {})


async def _send() -> str | None:
    from app.services.notifications import WebPushTransport

    p256dh, auth = _subscription_keys()
    return await WebPushTransport().send(
        subscription="https://fcm.googleapis.com/fcm/send/sub",
        payload={"title": "Meridian", "body": "due"},
        p256dh=p256dh,
        auth=auth,
    )


class TestProviderMessageId:
    @pytest.mark.asyncio
    async def test_accepted_without_location_reports_no_id(self, monkeypatch, vapid_configured):
        """No Location header means the service identified nothing.

        Old behaviour returned "delivered", which is a local word stored in a
        column that claims to hold the provider's own id.
        """
        _patch(monkeypatch, _Response(headers={}))

        assert await _send() is None

    @pytest.mark.asyncio
    async def test_accepted_with_location_reports_the_providers_id(self, monkeypatch, vapid_configured):
        """FCM and WNS both put their id in the last path segment."""
        _patch(
            monkeypatch,
            _Response(headers={"location": "https://wns2-pn1p.notify.windows.com/781955292738798962"}),
        )

        assert await _send() == "781955292738798962"

    @pytest.mark.asyncio
    async def test_location_without_a_segment_reports_no_id(self, monkeypatch, vapid_configured):
        """A bare origin identifies no message; neither "" nor the host is an id."""
        _patch(monkeypatch, _Response(headers={"location": "https://wns2-pn1p.notify.windows.com/"}))

        assert await _send() is None
