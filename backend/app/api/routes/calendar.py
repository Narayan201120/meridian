from datetime import datetime, timezone
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db_session
from app.schemas.calendar import FreeBusyInterval, FreeBusyRequest, FreeBusyResponse
from app.services.google_calendar import GoogleCalendarService

router = APIRouter()


@router.get("/google/authorize")
async def google_authorize(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    return_to: str | None = Query(default=None, description="Absolute URL to 302 back to after consent"),
) -> dict[str, str]:
    return {"authorization_url": GoogleCalendarService(session).authorization_url(current_user_id, return_to)}


@router.get("/google/callback", response_model=None)
async def google_callback(
    code: str = Query(),
    state: str = Query(),
    session: AsyncSession = Depends(get_db_session),
) -> dict[str, str] | RedirectResponse:
    connection, return_to = await GoogleCalendarService(session).complete_authorization(code=code, state=state)
    if return_to:
        # 303 so the browser follows with GET and lands back in the app.
        return RedirectResponse(url=return_to, status_code=303)
    return {"status": "connected", "provider": connection.provider}


@router.get("/google/status")
async def google_status(current_user_id: Annotated[UUID, Depends(get_current_user_id)], session: Annotated[AsyncSession, Depends(get_db_session)]) -> dict[str, str]:
    """Report whether the calendar is actually usable, not just marked active.

    The stored status column can read `active` while the access token can no
    longer be decrypted, for example after the Fernet key is rotated. Reporting
    that as connected offers a Sync button which then fails, so verify the token
    is readable and downgrade to `error` when it is not.
    """
    service = GoogleCalendarService(session)
    connection = await service.get_connection(current_user_id)
    if connection is None:
        return {"status": "not_connected"}
    if connection.status != "active":
        return {"status": connection.status}
    try:
        service._decrypt(connection.access_token_ciphertext)
    except HTTPException:
        connection.status = "error"
        connection.last_error_message = "Stored calendar token could not be decrypted. Reconnect Google Calendar."
        connection.last_error_at = datetime.now(timezone.utc)
        await session.commit()
        return {"status": "error"}
    return {"status": "active"}


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


@router.post("/google/sync", summary="Sync Google calendar events to DB cache")
async def google_sync(
    payload: FreeBusyRequest,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> dict[str, int]:
    count = await GoogleCalendarService(session).sync_events(current_user_id, payload.time_min, payload.time_max)
    return {"synced": count}


@router.get("/google/events", response_model=FreeBusyResponse, summary="List cached calendar events as busy intervals")
async def google_cached_events(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    time_min: str = Query(..., description="RFC3339 start"),
    time_max: str = Query(..., description="RFC3339 end"),
) -> FreeBusyResponse:
    from datetime import datetime

    try:
        t_min = datetime.fromisoformat(time_min.replace("Z", "+00:00"))
        t_max = datetime.fromisoformat(time_max.replace("Z", "+00:00"))
    except ValueError as exc:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid time_min/time_max") from exc
    raw_busy = await GoogleCalendarService(session).list_cached_events(current_user_id, t_min, t_max)
    busy = []
    for entry in raw_busy:
        try:
            start = datetime.fromisoformat(entry["start"].replace("Z", "+00:00"))
            end = datetime.fromisoformat(entry["end"].replace("Z", "+00:00"))
            busy.append(FreeBusyInterval(start=start, end=end))
        except (KeyError, ValueError):
            continue
    return FreeBusyResponse(busy=busy, time_min=t_min, time_max=t_max)