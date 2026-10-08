"""Mint a Google Calendar consent URL for a user, for out-of-band consent.

`/api/v1/calendar/google/authorize` normally hands this URL to a browser that
already holds a bearer token. That is the problem when the consenting browser is
not the machine running the backend: `127.0.0.1` on a phone is the phone, so the
redirect lands nowhere.

The callback route takes no bearer token on purpose. It identifies the user from
the signed `state` JWT, which carries `sub` and nothing that needs a browser
session. So the consent step can happen on any device; only the final code
exchange has to happen here. This script builds the URL with the app's own
`authorization_url`, so it cannot drift from what the endpoint returns.

Prints the URL. It contains `client_id` (public) and a signed `state` that
expires in 10 minutes. No secret is printed.
"""

from __future__ import annotations

import asyncio
import pathlib
import sys
from uuid import UUID

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.models.calendar_connection import CalendarConnection  # noqa: E402


def database_url() -> str:
    line = [
        ln
        for ln in (pathlib.Path(__file__).resolve().parent.parent / ".env")
        .read_text(encoding="utf-8")
        .splitlines()
        if ln.startswith("MERIDIAN_DATABASE_URL")
    ]
    if not line:
        raise SystemExit("MERIDIAN_DATABASE_URL is not set in backend/.env")
    return line[0].split("=", 1)[1].strip()


async def main() -> int:
    target = sys.argv[1] if len(sys.argv) > 1 else None

    engine = create_async_engine(database_url())
    found: list[tuple[str, str | None]] = []
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                select(
                    CalendarConnection.user_id,
                    CalendarConnection.status,
                ).where(CalendarConnection.provider == "google")
            )
        ).all()
        for user_id, status in rows:
            found.append((str(user_id), str(status)))
    await engine.dispose()

    if not found:
        print("No google calendar_connections rows. Nothing to reconnect.")
        return 1

    print("Stored connections (user_id, status):")
    for user_id, status in found:
        print(f"  {user_id}  {status}")

    user_id = UUID(target) if target else UUID(found[0][0])
    print(f"\nMinting consent URL for {user_id}")

    # Imported after the engine so Settings is constructed with .env loaded.
    from app.services.google_calendar import GoogleCalendarService

    url = GoogleCalendarService(None).authorization_url(user_id, return_to=None)
    print("\n--- open this on the phone ---\n")
    print(url)
    print("\n--- state expires in 10 minutes ---")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
