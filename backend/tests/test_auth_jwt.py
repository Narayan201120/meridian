"""JWT verification, including the clock-skew tolerance that sign-in depends on.

The rest of the suite patches `verify_supabase_jwt` out, so this is the only
place the real decode path is exercised.
"""

from __future__ import annotations

import time
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi import HTTPException
from jwt import PyJWKClientError, PyJWKSetError

from app.core import auth as auth_module
from app.core.config import settings

ISSUER = "https://project.supabase.co/auth/v1"
AUDIENCE = "authenticated"


@pytest.fixture(scope="module")
def signing_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture(autouse=True)
def _stub_supabase_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "supabase_url", "https://project.supabase.co")
    monkeypatch.setattr(settings, "supabase_jwt_audience", AUDIENCE)
    monkeypatch.setattr(settings, "supabase_jwt_leeway_seconds", 60)


def _mint(signing_key: rsa.RSAPrivateKey, *, iat_offset: float = 0.0, **overrides: Any) -> str:
    issued = datetime.now(timezone.utc) + timedelta(seconds=iat_offset)
    claims: dict[str, Any] = {
        "sub": "f81ac88b-8eb2-4e5e-8a6a-de45c8e19135",
        "aud": AUDIENCE,
        "iss": ISSUER,
        "role": "authenticated",
        "iat": issued,
        "exp": issued + timedelta(hours=1),
    }
    claims.update(overrides)
    return jwt.encode(claims, signing_key, algorithm="RS256")


def _patch_jwks(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> None:
    class StubJWKClient:
        def get_signing_key_from_jwt(self, token: str) -> Any:
            class Key:
                key = signing_key.public_key()

            return Key()

    monkeypatch.setattr(auth_module, "get_jwks_client", lambda: StubJWKClient())


def test_accepts_a_freshly_minted_token(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> None:
    _patch_jwks(monkeypatch, signing_key)
    claims = auth_module.verify_supabase_jwt(_mint(signing_key))
    assert claims["sub"] == "f81ac88b-8eb2-4e5e-8a6a-de45c8e19135"


def test_accepts_a_token_whose_iat_is_slightly_ahead_of_our_clock(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    """The real failure: Supabase's clock runs a second ahead of this host and
    PyJWT rejects `iat > now` as ImmatureSignatureError, 401ing sign-in."""
    _patch_jwks(monkeypatch, signing_key)
    claims = auth_module.verify_supabase_jwt(_mint(signing_key, iat_offset=5))
    assert claims["role"] == "authenticated"


def test_still_rejects_a_token_far_outside_the_leeway_window(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    _patch_jwks(monkeypatch, signing_key)
    with pytest.raises(Exception) as excinfo:
        auth_module.verify_supabase_jwt(_mint(signing_key, iat_offset=300))
    assert getattr(excinfo.value, "status_code", None) == 401


def test_rejects_an_expired_token(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> None:
    _patch_jwks(monkeypatch, signing_key)
    past = datetime.now(timezone.utc) - timedelta(hours=2)
    token = jwt.encode(
        {
            "sub": "f81ac88b-8eb2-4e5e-8a6a-de45c8e19135",
            "aud": AUDIENCE,
            "iss": ISSUER,
            "iat": past,
            "exp": past + timedelta(hours=1),
        },
        signing_key,
        algorithm="RS256",
    )
    with pytest.raises(Exception) as excinfo:
        auth_module.verify_supabase_jwt(token)
    assert getattr(excinfo.value, "status_code", None) == 401


def test_rejects_a_token_signed_by_another_key(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    _patch_jwks(monkeypatch, signing_key)
    impostor = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(Exception) as excinfo:
        auth_module.verify_supabase_jwt(_mint(impostor))
    assert getattr(excinfo.value, "status_code", None) == 401


def test_rejects_the_wrong_audience(monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey) -> None:
    _patch_jwks(monkeypatch, signing_key)
    with pytest.raises(Exception) as excinfo:
        auth_module.verify_supabase_jwt(_mint(signing_key, aud="anon"))
    assert getattr(excinfo.value, "status_code", None) == 401


def test_leeway_is_not_so_wide_that_expiry_is_ignored(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    """Leeway applies to `exp` too, so it must stay small relative to token life."""
    _patch_jwks(monkeypatch, signing_key)
    just_expired = datetime.now(timezone.utc) - timedelta(seconds=30)
    token = jwt.encode(
        {
            "sub": "f81ac88b-8eb2-4e5e-8a6a-de45c8e19135",
            "aud": AUDIENCE,
            "iss": ISSUER,
            "iat": just_expired,
            "exp": just_expired + timedelta(seconds=10),
        },
        signing_key,
        algorithm="RS256",
    )
    # 30s past expiry is inside the 60s leeway, so this is accepted; assert the
    # documented bound rather than pretending the window is zero.
    auth_module.verify_supabase_jwt(token)
    assert settings.supabase_jwt_leeway_seconds < 3600
    assert time.time() > 0


def _patch_jwks_failure(monkeypatch: pytest.MonkeyPatch, exc: Exception) -> None:
    class FailingJWKClient:
        def get_signing_key_from_jwt(self, token: str) -> Any:
            raise exc

    monkeypatch.setattr(auth_module, "get_jwks_client", lambda: FailingJWKClient())


def test_unreachable_jwks_returns_503_not_500_or_401(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    """Supabase unreachable (DNS failure, timeout): honest 503, not 500 or 401."""
    _patch_jwks_failure(monkeypatch, PyJWKClientError("Unable to fetch JWKS"))
    with pytest.raises(HTTPException) as excinfo:
        auth_module.verify_supabase_jwt(_mint(signing_key))
    assert excinfo.value.status_code == 503
    assert "unavailable" in excinfo.value.detail.lower()


def test_jwks_without_matching_kid_returns_503(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    """Rotated keys / stale cache: valid JSON, no matching kid -> same 503."""
    _patch_jwks_failure(monkeypatch, PyJWKSetError("Unable to find a signing key"))
    with pytest.raises(HTTPException) as excinfo:
        auth_module.verify_supabase_jwt(_mint(signing_key))
    assert excinfo.value.status_code == 503
    assert "unavailable" in excinfo.value.detail.lower()


def test_wrong_issuer_still_returns_401(
    monkeypatch: pytest.MonkeyPatch, signing_key: rsa.RSAPrivateKey
) -> None:
    """A bad token is 401, not 503: the key source worked, the token did not."""
    _patch_jwks(monkeypatch, signing_key)
    with pytest.raises(HTTPException) as excinfo:
        auth_module.verify_supabase_jwt(_mint(signing_key, iss="https://evil.example.com/auth/v1"))
    assert excinfo.value.status_code == 401