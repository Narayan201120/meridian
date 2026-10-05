from uuid import uuid4

import pytest
from sqlalchemy import select

from app.models import CalendarConnection

pytestmark = pytest.mark.asyncio


async def test_calendar_connection_scopes_list_round_trip(db_session) -> None:
    scopes = [
        "https://www.googleapis.com/auth/calendar.events",
        "https://www.googleapis.com/auth/calendar.events.freebusy",
    ]
    conn = CalendarConnection(
        user_id=uuid4(),
        provider="google",
        provider_account_id="primary",
        status="active",
        scopes=scopes,
    )
    db_session.add(conn)
    await db_session.commit()
    conn_id = conn.id

    db_session.expire_all()
    fetched = await db_session.scalar(select(CalendarConnection).where(CalendarConnection.id == conn_id))
    assert fetched is not None
    assert fetched.scopes == scopes

    # Google OAuth persistence overwrites scopes on re-authorization.
    updated_scopes = ["https://www.googleapis.com/auth/calendar.events"]
    fetched.scopes = updated_scopes
    await db_session.commit()

    db_session.expire_all()
    refetched = await db_session.scalar(select(CalendarConnection).where(CalendarConnection.id == conn_id))
    assert refetched is not None
    assert refetched.scopes == updated_scopes


async def test_calendar_connection_scopes_default_empty_list(db_session) -> None:
    conn = CalendarConnection(
        user_id=uuid4(),
        provider="google",
        provider_account_id="primary",
        status="active",
    )
    db_session.add(conn)
    await db_session.commit()
    conn_id = conn.id

    db_session.expire_all()
    fetched = await db_session.scalar(select(CalendarConnection).where(CalendarConnection.id == conn_id))
    assert fetched is not None
    assert fetched.scopes == []
