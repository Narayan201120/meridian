from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db_session
from app.schemas.calendar import FreeBusyInterval, FreeBusyRequest, FreeBusyResponse
from app.services.google_calendar import GoogleCalendarService

router = APIRouter()


@router.get("/google/authorize")
async def google_authorize(current_user_id: Annotated[UUID, Depends(get_current_user_id)], session: Annotated[AsyncSession, Depends(get_db_session)]) -> dict[str, str]:
    return {"authorization_url": GoogleCalendarService(session).authorization_url(current_user_id)}


@router.get("/google/callback")
async def google_callback(code: str = Query(), state: str = Query(), session: AsyncSession = Depends(get_db_session)) -> dict[str, str]:
    connection = await GoogleCalendarService(session).complete_authorization(code=code, state=state)
    return {"status": "connected", "provider": connection.provider}


@router.get("/google/status")
async def google_status(current_user_id: Annotated[UUID, Depends(get_current_user_id)], session: Annotated[AsyncSession, Depends(get_db_session)]) -> dict[str, str]:
    connection = await GoogleCalendarService(session).get_connection(current_user_id)
    return {"status": connection.status if connection else "not_connected"}


@router.post("/google/freebusy", response_model=FreeBusyResponse, summary="Query Google free/busy")
async def google_freebusy(
    payload: FreeBusyRequest,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> FreeBusyResponse:
    raw_busy = await GoogleCalendarService(session).fetch_freebusy(current_user_id, payload.time_min, payload.time_max)
    busy = []
    for entry in raw_busy:
        try:
            from datetime import datetime

            start = datetime.fromisoformat(entry["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(entry["end"].replace("Z", "+00:00"))
            busy.append(FreeBusyInterval(start=start, end=end))
        except (KeyError, ValueError):
            continue
    return FreeBusyResponse(busy=busy, time_min=payload.time_min, time_max=payload.time_max)