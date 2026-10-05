"""E2E backend harness: real app + local GoTrue-compatible auth, no Supabase.

Run:  python e2e_server.py --host 127.0.0.1 --port 8098
Env:  MERIDIAN_SUPABASE_URL=http://127.0.0.1:8098
      MERIDIAN_DATABASE_URL=sqlite+aiosqlite:///./e2e.db
      MERIDIAN_TOKEN_ENCRYPTION_KEY=<Fernet key>
      MERIDIAN_CORS_ORIGINS=http://localhost:8099

Keypair strategy: generated once per process at import (in-process cache).
No key file is written, so there is nothing to clean up or gitignore.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import hmac
import os
import pathlib
import secrets
import threading
import time
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from uuid import UUID

import jwt as pyjwt
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from fastapi import APIRouter, FastAPI, HTTPException, Query, Request, Response, status
from sqlalchemy.ext.asyncio import create_async_engine


def _ensure_vapid_keys() -> None:
    """Give the harness a working VAPID keypair when the environment has none.

    Without keys, `dispatch_due_reminders` skips delivery entirely and leaves
    reminders PENDING. That is the correct behaviour for a server with no push
    configuration, but it makes the scheduler impossible to observe: nothing
    happens, so a test cannot tell "the scheduler did not run" from "the
    scheduler ran and had nothing to do".

    Generated here rather than in playwright.config.ts so the knowledge lives in
    one place, and via py_vapid directly so the PEM format is the one the
    transport actually accepts rather than a hand-rolled approximation. Runs
    before app.core.config is imported, because Settings snapshots the
    environment at construction.
    """
    if os.environ.get("MERIDIAN_WEB_PUSH_PUBLIC_KEY"):
        return
    from py_vapid import Vapid

    vapid = Vapid()
    vapid.generate_keys()
    os.environ["MERIDIAN_WEB_PUSH_PUBLIC_KEY"] = base64.b64encode(vapid.public_pem()).decode()
    os.environ["MERIDIAN_WEB_PUSH_PRIVATE_KEY"] = base64.b64encode(vapid.private_pem()).decode()
    os.environ["MERIDIAN_WEB_PUSH_SUBJECT"] = "mailto:e2e@meridian.test"


_ensure_vapid_keys()

from app.core.config import settings  # noqa: E402

# Import models for side effects so Base.metadata covers every table,
# exactly like backend/tests/conftest.py does.
from app.db.base import Base  # noqa: E402
from app.models import (  # noqa: F401,E402 - needed to register models
    CalendarConnection,
    CalendarEvent,
    Device,
    DevicePlatform,
    NotificationDelivery,
    Reminder,
    Task,
    TaskCalendarBlock,
    TaskMutationLog,
    VoiceCapture,
)
from app.main import create_application  # noqa: E402
from app.models.calendar_connection import ReminderStatus, ReminderType  # noqa: E402
from app.models.task import TaskStatus  # noqa: E402


SEED_EMAIL = "e2e@meridian.test"
SEED_PASSWORD = "E2eTest1234!Test1234!"
# Fixed UUID that MUST contain hex letters (a-f): PG_UUID compiles to a bare
# `UUID` column type on SQLite, which gets NUMERIC affinity, so an all-digit
# UUID like 11111111-... is stored as a REAL float and can never round-trip.
# The `e`s below keep SQLite storing it as TEXT. Do not "simplify" this UUID.
SEED_USER_ID = "e2e1e2e1-1111-4111-8111-1111111111e1"
TOKEN_TTL_SECONDS = 3600


def _b64url_uint(value: int, length: int) -> str:
    raw = value.to_bytes(length, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


def _new_keypair() -> tuple[ec.EllipticCurvePrivateKey, str]:
    key = ec.generate_private_key(ec.SECP256R1())
    kid = secrets.token_hex(8)
    return key, kid


_PRIVATE_KEY, _KID = _new_keypair()


def _private_pem() -> str:
    return _PRIVATE_KEY.private_bytes(
        serialization.Encoding.PEM,
        serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption(),
    ).decode()


def _public_jwk() -> dict[str, str]:
    numbers = _PRIVATE_KEY.public_key().public_numbers()
    return {
        "kty": "EC",
        "crv": "P-256",
        "x": _b64url_uint(numbers.x, 32),
        "y": _b64url_uint(numbers.y, 32),
        "kid": _KID,
        "use": "sig",
        "alg": "ES256",
    }


def _mint_access_token() -> tuple[str, int]:
    if settings.supabase_jwt_issuer is None:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Supabase auth is not configured. Set MERIDIAN_SUPABASE_URL.",
        )
    now = int(time.time())
    payload = {
        "sub": SEED_USER_ID,
        "email": SEED_EMAIL,
        "iss": settings.supabase_jwt_issuer,
        "aud": settings.supabase_jwt_audience,
        "iat": now,
        "exp": now + TOKEN_TTL_SECONDS,
    }
    token = pyjwt.encode(payload, _private_pem(), algorithm="ES256", headers={"kid": _KID})
    return token, now + TOKEN_TTL_SECONDS


def _warm_jwks_cache() -> None:
    """Populate the production PyJWKClient cache without touching its code.

    verify_supabase_jwt fetches the JWKS over HTTP with blocking urllib.
    Against this same single-worker process that deadlocks the event loop
    (fetch times out -> 500). Warming from a worker thread keeps the loop
    free to answer, and once cached no request ever fetches again.
    """
    try:
        from app.core.auth import get_jwks_client

        get_jwks_client().get_signing_key(_KID)
    except Exception:
        pass


def _jwks_warmer(stop: threading.Event) -> None:
    interval = 5.0
    while not stop.wait(interval):
        _warm_jwks_cache()
        interval = 60.0  # first success switches to a keep-warm cadence


_warmer_stop = threading.Event()


def _check_credentials(email: str, password: str) -> bool:
    email_ok = hmac.compare_digest(email.strip().lower(), SEED_EMAIL)
    password_ok = hmac.compare_digest(
        hashlib.sha256(password.encode()).hexdigest(),
        hashlib.sha256(SEED_PASSWORD.encode()).hexdigest(),
    )
    return email_ok and password_ok


auth_router = APIRouter(tags=["e2e-auth"])


@auth_router.post("/auth/v1/token")
async def password_grant(
    request: Request,
    grant_type: str | None = Query(default=None),
) -> dict:
    if grant_type is not None and grant_type != "password":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unsupported grant_type: {grant_type!r}.",
        )
    try:
        body = await request.json()
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Request body must be JSON."
        ) from exc
    email = body.get("email", "")
    password = body.get("password", "")
    if not isinstance(email, str) or not isinstance(password, str):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="email and password are required."
        )
    if not _check_credentials(email, password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid login credentials."
        )
    access_token, expires_at = _mint_access_token()
    # Guarantee the JWKS cache is warm before any protected call can trigger
    # an in-request fetch (which would deadlock: blocking urllib on the loop
    # while the loop must serve the JWKS request itself).
    await asyncio.to_thread(_warm_jwks_cache)
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "refresh_token": secrets.token_urlsafe(32),
        "expires_in": TOKEN_TTL_SECONDS,
        "expires_at": expires_at,
        "user": {"id": SEED_USER_ID, "email": SEED_EMAIL},
    }


@auth_router.get("/auth/v1/.well-known/jwks.json")
async def jwks() -> dict:
    return {"keys": [_public_jwk()]}


@auth_router.post("/auth/v1/logout", status_code=status.HTTP_204_NO_CONTENT)
async def logout() -> Response:
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# Test-fixture endpoints.
#
# These exist so a browser test can set up a reminder that is already overdue
# and then inspect what the server did about it. Nothing in app/ knows they
# exist; they are scaffolding, not a backdoor. The alternative is for the test
# to drive the whole schedule-a-block-and-confirm-it flow, which needs a Google
# Calendar connection and so would test mocking rather than dispatch.
#
# The push endpoint below passes WebPushTransport's `https://push.` prefix guard
# and then fails DNS, so delivery is genuinely attempted and genuinely fails.
# That failure is the evidence: a NotificationDelivery row exists, which can
# only happen if the server reached a device on its own.
# ---------------------------------------------------------------------------


@auth_router.post("/_e2e/seed-due-reminder")
async def seed_due_reminder() -> dict:
    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        task = Task(
            user_id=UUID(SEED_USER_ID),
            title="e2e overdue reminder",
            status=TaskStatus.INBOX,
        )
        session.add(task)
        await session.flush()

        # A minute in the past, so it is due on the very next sweep.
        reminder = Reminder(
            user_id=UUID(SEED_USER_ID),
            task_id=task.id,
            type=ReminderType.DUE_DATE,
            scheduled_for=datetime.now(timezone.utc) - timedelta(minutes=1),
            status=ReminderStatus.PENDING,
        )
        device = Device(
            user_id=UUID(SEED_USER_ID),
            platform=DevicePlatform.WEB,
            push_token="https://push.e2e.invalid/subscription/never-resolves",
        )
        session.add_all([reminder, device])
        await session.commit()
        return {"task_id": str(task.id), "reminder_id": str(reminder.id)}


@auth_router.get("/_e2e/deliveries")
async def list_deliveries() -> dict:
    """What the server actually attempted, for assertions and for eyeballing."""
    from sqlalchemy import select

    from app.db.session import get_session_factory

    factory = get_session_factory()
    async with factory() as session:
        rows = list(
            (
                await session.scalars(
                    select(NotificationDelivery)
                    .where(NotificationDelivery.user_id == UUID(SEED_USER_ID))
                    .order_by(NotificationDelivery.attempted_at.desc())
                )
            ).all()
        )
        return {
            "count": len(rows),
            "deliveries": [
                {
                    "reminder_id": str(r.reminder_id),
                    "provider": r.provider,
                    "status": r.status.value if hasattr(r.status, "value") else str(r.status),
                    "error_message": r.error_message,
                }
                for r in rows
            ],
        }


async def _init_file_db() -> None:
    if settings.database_url is None:
        raise RuntimeError("MERIDIAN_DATABASE_URL must be set (e.g. sqlite+aiosqlite:///./e2e.db).")

    # Start from an empty database every run.
    #
    # Tests seed devices with deliberately unresolvable push endpoints, so every
    # one of them is retried by the due sweep on every pass forever. Nothing ever
    # removed them, so a dirty e2e.db accumulated dead devices and delivery rows
    # until the sweep spent its whole budget re-attempting sends for reminders no
    # test cared about, and sign-ins stalled. Observed at 10 devices and 877
    # delivery rows after a handful of runs.
    #
    # Dropped rather than truncated because this file is a scratch database by
    # definition. Refusing to start when the URL is anything other than a local
    # SQLite path, so this can never delete a real database.
    url = settings.database_url
    if url.startswith("sqlite") and ":memory:" not in url:
        path = url.split("///", 1)[-1]
        if path and path != ":memory:":
            for suffix in ("", "-journal", "-wal", "-shm"):
                candidate = pathlib.Path(path + suffix)
                if candidate.exists():
                    candidate.unlink()
                    print(f"[e2e-server] removed stale {candidate.name}", flush=True)

    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await engine.dispose()


@asynccontextmanager
async def _lifespan(app: FastAPI):
    await _init_file_db()
    print(f"[e2e-server] file DB ready: {settings.database_url}", flush=True)
    warmer = threading.Thread(target=_jwks_warmer, args=(_warmer_stop,), daemon=True)
    warmer.start()
    try:
        yield
    finally:
        _warmer_stop.set()


def build_application() -> FastAPI:
    app = create_application()
    app.include_router(auth_router)
    # Attach DB init without clobbering the production lifespan (create_application
    # defines none, but this stays additive either way).
    original_lifespan = app.router.lifespan_context

    @asynccontextmanager
    async def combined_lifespan(app: FastAPI):
        if original_lifespan is not None:
            async with original_lifespan(app):
                async with _lifespan(app):
                    yield
        else:
            async with _lifespan(app):
                yield

    app.router.lifespan_context = combined_lifespan
    return app


app = build_application()


def main() -> None:
    import uvicorn

    parser = argparse.ArgumentParser(description="Meridian E2E backend harness.")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8098)
    args = parser.parse_args()

    print(
        f"[e2e-server] harness up on http://{args.host}:{args.port} "
        f"(issuer={settings.supabase_jwt_issuer}) seeded user {SEED_EMAIL} "
        f"id={SEED_USER_ID}",
        flush=True,
    )
    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
