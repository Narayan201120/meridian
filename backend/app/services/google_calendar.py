from datetime import datetime, timedelta, timezone
from urllib.parse import urlencode
from uuid import UUID

import httpx
import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.calendar_connection import CalendarConnection

GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GOOGLE_FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy"
GOOGLE_CALENDAR_EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events"
GOOGLE_FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.events.freebusy"
GOOGLE_CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events"
GOOGLE_CALENDAR_SCOPES = f"{GOOGLE_FREEBUSY_SCOPE} {GOOGLE_CALENDAR_SCOPE}"


class GoogleCalendarService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def authorization_url(self, user_id: UUID) -> str:
        self._require_config()
        state = jwt.encode(
            {"sub": str(user_id), "exp": datetime.now(timezone.utc) + timedelta(minutes=10)},
            settings.oauth_state_secret,
            algorithm="HS256",
        )
        query = urlencode(
            {
                "client_id": settings.google_calendar_client_id,
                "redirect_uri": settings.google_calendar_redirect_uri,
                "response_type": "code",
                "scope": GOOGLE_CALENDAR_SCOPES,
                "access_type": "offline",
                "prompt": "consent",
                "state": state,
            }
        )
        return f"{GOOGLE_AUTH_URL}?{query}"

    async def complete_authorization(self, *, code: str, state: str) -> CalendarConnection:
        self._require_config()
        try:
            claims = jwt.decode(state, settings.oauth_state_secret, algorithms=["HS256"])
            user_id = UUID(claims["sub"])
        except (jwt.PyJWTError, KeyError, ValueError) as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid or expired OAuth state.") from exc
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(GOOGLE_TOKEN_URL, data={"code": code, "client_id": settings.google_calendar_client_id, "client_secret": settings.google_calendar_client_secret, "redirect_uri": settings.google_calendar_redirect_uri, "grant_type": "authorization_code"})
        if response.is_error:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Google token exchange failed.")
        payload = response.json()
        expires_at = datetime.now(timezone.utc) + timedelta(seconds=int(payload.get("expires_in", 3600)))
        existing = await self.session.scalar(
            select(CalendarConnection).where(
                CalendarConnection.user_id == user_id,
                CalendarConnection.provider == "google",
                CalendarConnection.provider_account_id == "primary",
            )
        )
        connection = existing or CalendarConnection(user_id=user_id, provider="google", provider_account_id="primary")
        try:
            cipher = settings.get_fernet()
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        if cipher is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Token encryption is not configured.")
        connection.access_token_ciphertext = cipher.encrypt(payload["access_token"].encode()).decode()
        if payload.get("refresh_token"):
            connection.refresh_token_ciphertext = cipher.encrypt(payload["refresh_token"].encode()).decode()
        connection.token_expires_at = expires_at
        connection.scopes = payload.get("scope", GOOGLE_CALENDAR_SCOPES).split()
        connection.status = "active"
        if existing is None:
            self.session.add(connection)
        await self.session.commit()
        await self.session.refresh(connection)
        return connection

    async def create_calendar_event(self, user_id: UUID, summary: str, start_at: datetime, end_at: datetime) -> dict:
        connection = await self.get_connection(user_id)
        if not connection or connection.status != "active":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active calendar connection. Connect Google Calendar first.")
        access_token = await self.get_valid_access_token(connection)
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                GOOGLE_CALENDAR_EVENTS_URL,
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={
                    "summary": summary,
                    "start": {"dateTime": start_at.isoformat().replace("+00:00", "Z")},
                    "end": {"dateTime": end_at.isoformat().replace("+00:00", "Z")},
                },
            )
        if response.is_error:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Google Calendar event creation failed: {response.text[:200]}")
        return response.json()

    async def get_connection(self, user_id: UUID) -> CalendarConnection | None:
        return await self.session.scalar(
            select(CalendarConnection).where(
                CalendarConnection.user_id == user_id,
                CalendarConnection.provider == "google",
                CalendarConnection.provider_account_id == "primary",
            )
        )

    def _decrypt(self, ciphertext: str | None) -> str | None:
        if not ciphertext:
            return None
        try:
            cipher = settings.get_fernet()
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        if cipher is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Token encryption is not configured.")
        try:
            return cipher.decrypt(ciphertext.encode()).decode()
        except Exception as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to decrypt calendar token.") from exc

    async def get_valid_access_token(self, connection: CalendarConnection) -> str:
        now = datetime.now(timezone.utc)
        is_expired = connection.token_expires_at is None or connection.token_expires_at <= now + timedelta(seconds=60)
        if not is_expired:
            token = self._decrypt(connection.access_token_ciphertext)
            if token:
                return token

        refresh_token = self._decrypt(connection.refresh_token_ciphertext)
        if not refresh_token:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Calendar connection needs re-authorization (no refresh token).")

        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                GOOGLE_TOKEN_URL,
                data={
                    "client_id": settings.google_calendar_client_id,
                    "client_secret": settings.google_calendar_client_secret,
                    "refresh_token": refresh_token,
                    "grant_type": "refresh_token",
                },
            )
        if response.is_error:
            connection.status = "error"
            connection.last_error_message = "Google refresh token exchange failed."
            connection.last_error_at = now
            await self.session.commit()
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Google token refresh failed. Please reconnect.")

        payload = response.json()
        try:
            cipher = settings.get_fernet()
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc
        if cipher is None:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Token encryption is not configured.")
        connection.access_token_ciphertext = cipher.encrypt(payload["access_token"].encode()).decode()
        connection.token_expires_at = now + timedelta(seconds=int(payload.get("expires_in", 3600)))
        connection.status = "active"
        connection.last_error_message = None
        connection.last_error_at = None
        await self.session.commit()
        await self.session.refresh(connection)
        return payload["access_token"]

    async def fetch_freebusy(self, user_id: UUID, time_min: datetime, time_max: datetime) -> list[dict[str, str]]:
        connection = await self.get_connection(user_id)
        if not connection or connection.status != "active":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active calendar connection. Connect Google Calendar first.")
        access_token = await self.get_valid_access_token(connection)
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.post(
                GOOGLE_FREEBUSY_URL,
                headers={"Authorization": f"Bearer {access_token}", "Content-Type": "application/json"},
                json={
                    "timeMin": time_min.isoformat().replace("+00:00", "Z"),
                    "timeMax": time_max.isoformat().replace("+00:00", "Z"),
                    "items": [{"id": "primary"}],
                },
            )
        if response.is_error:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google Calendar freeBusy query failed.")
        data = response.json()
        calendars = data.get("calendars", {})
        primary = calendars.get("primary", {})
        return primary.get("busy", [])

    async def sync_events(self, user_id: UUID, time_min: datetime, time_max: datetime) -> int:
        from app.models.calendar_connection import CalendarEvent

        connection = await self.get_connection(user_id)
        if not connection or connection.status != "active":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active calendar connection. Connect Google Calendar first.")
        access_token = await self.get_valid_access_token(connection)
        params = {
            "timeMin": time_min.isoformat().replace("+00:00", "Z"),
            "timeMax": time_max.isoformat().replace("+00:00", "Z"),
            "singleEvents": "true",
            "orderBy": "startTime",
            "maxResults": "50",
        }
        async with httpx.AsyncClient(timeout=15) as client:
            response = await client.get(
                GOOGLE_CALENDAR_EVENTS_URL,
                headers={"Authorization": f"Bearer {access_token}"},
                params=params,
            )
        if response.is_error:
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Google Calendar events sync failed.")
        data = response.json()
        items = data.get("items", [])
        now = datetime.now(timezone.utc)
        synced = 0
        for item in items:
            ext_id = item.get("id")
            if not ext_id:
                continue
            start_raw = (item.get("start") or {}).get("dateTime") or (item.get("start") or {}).get("date")
            end_raw = (item.get("end") or {}).get("dateTime") or (item.get("end") or {}).get("date")
            if not start_raw or not end_raw:
                continue
            try:
                starts_at = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
                ends_at = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
            except ValueError:
                continue
            if ends_at <= starts_at:
                continue
            is_all_day = "date" in (item.get("start") or {})
            existing = await self.session.scalar(
                select(CalendarEvent).where(CalendarEvent.calendar_connection_id == connection.id, CalendarEvent.external_event_id == ext_id)
            )
            if existing:
                existing.title = item.get("summary")
                existing.starts_at = starts_at
                existing.ends_at = ends_at
                existing.is_all_day = is_all_day
                existing.status = item.get("status", "confirmed")
                existing.raw_payload = item
                existing.last_synced_at = now
                existing.updated_at = now
            else:
                ev = CalendarEvent(
                    user_id=user_id,
                    calendar_connection_id=connection.id,
                    external_event_id=ext_id,
                    title=item.get("summary"),
                    starts_at=starts_at,
                    ends_at=ends_at,
                    is_all_day=is_all_day,
                    status=item.get("status", "confirmed"),
                    raw_payload=item,
                    last_synced_at=now,
                )
                self.session.add(ev)
            synced += 1
        connection.last_synced_at = now
        connection.last_error_message = None
        connection.last_error_at = None
        await self.session.commit()
        return synced

    async def list_cached_events(self, user_id: UUID, time_min: datetime, time_max: datetime) -> list[dict[str, str]]:
        from app.models.calendar_connection import CalendarEvent

        connection = await self.get_connection(user_id)
        if not connection:
            return []
        # Return busy intervals from cached events overlapping window
        result = await self.session.scalars(
            select(CalendarEvent).where(
                CalendarEvent.calendar_connection_id == connection.id,
                CalendarEvent.starts_at < time_max,
                CalendarEvent.ends_at > time_min,
            ).order_by(CalendarEvent.starts_at.asc())
        )
        busy: list[dict[str, str]] = []
        for ev in result.all():
            s = ev.starts_at
            e = ev.ends_at
            if s.tzinfo is None:
                s = s.replace(tzinfo=timezone.utc)
            if e.tzinfo is None:
                e = e.replace(tzinfo=timezone.utc)
            busy.append({"start": s.isoformat().replace("+00:00", "Z"), "end": e.isoformat().replace("+00:00", "Z")})
        return busy

    @staticmethod
    def _require_config() -> None:
        if (
            not settings.google_calendar_client_id
            or not settings.google_calendar_client_secret
            or not settings.oauth_state_secret
            or not settings.token_encryption_key
        ):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google Calendar OAuth is not configured.")