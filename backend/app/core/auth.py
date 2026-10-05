from functools import lru_cache
from typing import Any

import jwt
from fastapi import HTTPException, status
from jwt import InvalidTokenError, PyJWKClient, PyJWKClientError, PyJWKError, PyJWKSetError

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
            # PyJWT validates `iat` strictly, so a token minted even one second
            # ahead of this host's clock raises ImmatureSignatureError and the
            # request 401s. Leeway absorbs that drift.
            leeway=settings.supabase_jwt_leeway_seconds,
        )
    except (PyJWKClientError, PyJWKSetError, PyJWKError) as exc:
        # The key source failed, so the token was never actually evaluated. That
        # is different from the token being bad and must not be reported as 401,
        # which would sign the user out over a Supabase outage.
        #
        # Order matters and is not currently load-bearing: these three are
        # siblings under PyJWTError, not a hierarchy, and none is a subclass of
        # InvalidTokenError (verified against pyjwt 2.12.1). Catching the broad
        # PyJWTError instead would also swallow InvalidTokenError and turn every
        # bad token into a 503.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Auth service unavailable. Please retry.",
        ) from exc
    except InvalidTokenError as exc:
        # Key retrieval succeeded and the token itself failed validation.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid bearer token.",
        ) from exc
