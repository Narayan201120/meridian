"""Endpoint validation for Web Push delivery.

A real Chrome subscribed against this app's own VAPID key mints an endpoint
at `fcm.googleapis.com` -- which the old `https://push.` prefix guard rejected
with HTTP 400, so no real browser could ever receive a reminder. These tests
pin the allowlist contract: genuine push services are accepted, everything
else is refused before any network attempt.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from app.services.notifications import WebPushTransport

# The exact endpoint a real Chrome minted against this app's VAPID key.
# Host is fcm.googleapis.com: no `push.` prefix anywhere.
CHROME_FCM_ENDPOINT = (
    "https://fcm.googleapis.com/fcm/send/"
    "f92NUcBQsc8:APA91bEpmCOg4Ig1-UtKUWobpnBxdae_p0q7M3i6xmyhqpgx3D9u_k0SfPX_Bv_Zvb2tR-SR-"
    "qbXc-KvQUwe1wBefi7D1EYpb_RJTut4kILENFR37C71zKTy0CBcC0OvNojXQmflVYbe"
)


@pytest.fixture
def vapid_configured(monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "web_push_public_key", "test-public-key")
    monkeypatch.setattr(settings, "web_push_private_key", "test-private-key")
    monkeypatch.setattr(settings, "web_push_subject", "mailto:test@example.com")


class _FakePushResponse:
    status_code = 200
    is_error = False
    headers: dict = {}
    text = ""


class _FakePushClient:
    """Stands in for httpx.AsyncClient. Records whether delivery was attempted."""

    last: "_FakePushClient | None" = None

    def __init__(self, *args, **kwargs) -> None:
        self.posts: list[str] = []
        _FakePushClient.last = self

    async def __aenter__(self) -> "_FakePushClient":
        return self

    async def __aexit__(self, *exc) -> bool:
        return False

    async def post(self, url: str, **kwargs) -> _FakePushResponse:
        self.posts.append(url)
        return _FakePushResponse()


def _patch_outbound(monkeypatch) -> None:
    """Route outbound push through the fake and stub VAPID signing.

    These tests pin endpoint validation, not cryptography: signing is stubbed
    so an accepted endpoint reaches the fake client without a real keypair,
    and valid subscription keys ride along so the send path is reached.
    """
    _FakePushClient.last = None
    monkeypatch.setattr(httpx, "AsyncClient", _FakePushClient)
    monkeypatch.setattr(WebPushTransport, "_auth_headers", lambda self, endpoint: {})


def _subscription_keys() -> tuple[str, str]:
    """A fresh, well-formed subscriber keypair for reaching the send path."""
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
    return nopad(public_bytes), nopad(os.urandom(16))


async def _assert_accepted(monkeypatch, vapid_configured, endpoint: str) -> None:
    _patch_outbound(monkeypatch)
    p256dh, auth = _subscription_keys()
    result = await WebPushTransport().send(
        subscription=endpoint, payload={"title": "hi"}, p256dh=p256dh, auth=auth
    )
    assert result, "accepted endpoint should produce a provider message id"
    assert _FakePushClient.last is not None and _FakePushClient.last.posts == [endpoint]


async def _assert_rejected_400(monkeypatch, vapid_configured, endpoint: str) -> None:
    _patch_outbound(monkeypatch)
    p256dh, auth = _subscription_keys()
    with pytest.raises(HTTPException) as excinfo:
        await WebPushTransport().send(
            subscription=endpoint, payload={"title": "hi"}, p256dh=p256dh, auth=auth
        )
    assert excinfo.value.status_code == 400
    assert _FakePushClient.last is None or _FakePushClient.last.posts == [], (
        "refused endpoint must never trigger a network attempt"
    )


async def test_chrome_fcm_endpoint_is_accepted(monkeypatch, vapid_configured):
    await _assert_accepted(monkeypatch, vapid_configured, CHROME_FCM_ENDPOINT)


async def test_firefox_updates_endpoint_is_accepted(monkeypatch, vapid_configured):
    await _assert_accepted(
        monkeypatch, vapid_configured, "https://updates.push.services.mozilla.com/wpush/v2/abc"
    )


async def test_safari_endpoint_is_accepted(monkeypatch, vapid_configured):
    await _assert_accepted(monkeypatch, vapid_configured, "https://web.push.apple.com/abc")


async def test_edge_wns_endpoint_is_accepted(monkeypatch, vapid_configured):
    await _assert_accepted(
        monkeypatch, vapid_configured, "https://wns2-par02p.notify.windows.com/w/?token=x"
    )


async def test_cosmetic_push_prefix_endpoint_is_rejected(monkeypatch, vapid_configured):
    # `push.e2e.invalid` passed the old `https://push.` startswith check purely
    # on looks while belonging to no real push service; the allowlist refuses it.
    await _assert_rejected_400(
        monkeypatch, vapid_configured, "https://push.e2e.invalid/subscription/never-resolves"
    )


async def test_http_scheme_even_on_real_host_is_rejected(monkeypatch, vapid_configured):
    await _assert_rejected_400(
        monkeypatch, vapid_configured, "http://fcm.googleapis.com/fcm/send/x"
    )


async def test_lookalike_host_with_real_suffix_is_rejected(monkeypatch, vapid_configured):
    await _assert_rejected_400(
        monkeypatch, vapid_configured, "https://fcm.googleapis.com.evil.test/x"
    )


async def test_link_local_metadata_ip_is_rejected(monkeypatch, vapid_configured):
    await _assert_rejected_400(
        monkeypatch, vapid_configured, "https://169.254.169.254/latest/meta-data/"
    )


async def test_credentials_in_url_on_real_host_are_rejected(monkeypatch, vapid_configured):
    await _assert_rejected_400(
        monkeypatch, vapid_configured, "https://user:pass@fcm.googleapis.com/x"
    )


async def test_send_without_keys_is_refused_before_any_post(monkeypatch, vapid_configured):
    """Without subscription keys nothing POSTed could decrypt, so refuse."""
    _patch_outbound(monkeypatch)
    with pytest.raises(HTTPException) as excinfo:
        await WebPushTransport().send(
            subscription="https://fcm.googleapis.com/fcm/send/x", payload={"title": "hi"}
        )
    assert excinfo.value.status_code == 400
    assert _FakePushClient.last is None or _FakePushClient.last.posts == [], (
        "keyless send must never trigger a network attempt"
    )
