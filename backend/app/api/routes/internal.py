"""Endpoints for a scheduler that lives outside this process.

A serverless host freezes the process between requests, so the timer in
`app.main` cannot be the only thing that dispatches reminders there. An external
scheduler calls this route instead. The shared secret is the whole authorization
model: there is no user and no bearer JWT, because the caller is infrastructure.
"""

import secrets
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.session import get_db_session
from app.services.scheduling import run_due_sweep

router = APIRouter()


@router.post("/dispatch", summary="Run the due sweep once (external schedulers only)")
async def dispatch(
    request: Request,
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, int]:
    configured = settings.reminder_dispatch_secret
    if not configured:
        # Refusing is the safe half of the choice. An endpoint that answers 200
        # when the secret is unset is an open endpoint that marks reminders sent.
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Reminder dispatch is not configured. Set MERIDIAN_REMINDER_DISPATCH_SECRET.",
        )

    supplied = request.headers.get("authorization", "")
    if not secrets.compare_digest(supplied, f"Bearer {configured}"):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Bad dispatch secret.",
        )

    result = await run_due_sweep(session)
    await session.commit()
    return {
        "tasks_activated": result.tasks_activated,
        "reminders_delivered": result.reminders_delivered,
    }
