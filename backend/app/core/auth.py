from functools import lru_cache
from typing import Any

import jwt
from fastapi import HTTPException, status
from jwt import InvalidTokenError, PyJWKClient

from app.core.config import settings


@lru_cache
def get_jwks_client() -> PyJWKClient:
    if settings.supabase_jwks_url is None:
        raise RuntimeError("MERIDIAN_SUPABASE_URL must be configured for JWT verification.")

    return PyJWKClient(settings.supabase_jwks_url)


def verify_supabase_jwt(token: str) -> dict[str, Any]:
    if settings.supabase_jwt_issuer is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase auth is not configured. Set MERIDIAN_SUPABASE_URL.",
        )

    try:
        signing_key = get_jwks_client().get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=["ES256", "RS256"],
            audience=settings.supabase_jwt_audience,
            issuer=settings.supabase_jwt_issuer,
        )
    except InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token.",
        ) from exc
