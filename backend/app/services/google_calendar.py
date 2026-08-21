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

    @staticmethod
    def _require_config() -> None:
        if (
            not settings.google_calendar_client_id
            or not settings.google_calendar_client_secret
            or not settings.oauth_state_secret
            or not settings.token_encryption_key
        ):
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Google Calendar OAuth is not configured.")