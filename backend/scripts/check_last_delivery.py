"""Read back what the server recorded for the most recent push delivery.

The browser side of this proof lives in frontend/scripts/verify-real-push.mjs.
This is the half that says what the *server* did: whether the transport was
allowed to send, whether the push service accepted, and what it called the
message. A FAILED row here is as informative as a SENT one, because the
`error_message` column carries the actual refusal.

Read-only.

MERIDIAN_DATABASE_URL in the process environment takes precedence; backend/.env
is the fallback. Point it at the harness to read a local SQLite run:

    $env:MERIDIAN_DATABASE_URL="sqlite+aiosqlite:///./e2e-wns.db"
"""

from __future__ import annotations

import asyncio
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))

from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import create_async_engine  # noqa: E402

from app.models.calendar_connection import (  # noqa: E402
    Device,
    NotificationDelivery,
    Reminder,
)


def database_url() -> str:
    """Where to read, process environment first, then backend/.env.

    The process environment wins so this can read whatever database the server
    under test is actually using, rather than the one .env happens to name. That
    matters for the E2E harness, which runs on a local SQLite file passed
    through MERIDIAN_DATABASE_URL, and it matters generally: a reader that always
    opened .env's database would happily report rows from a different run than
    the one being investigated.
    """
    from_env = os.environ.get("MERIDIAN_DATABASE_URL")
    if from_env:
        return from_env

    line = [
        ln
        for ln in (pathlib.Path(__file__).resolve().parent.parent / ".env")
        .read_text(encoding="utf-8")
        .splitlines()
        if ln.startswith("MERIDIAN_DATABASE_URL")
    ]
    if not line:
        raise SystemExit(
            "MERIDIAN_DATABASE_URL is not set in the environment or in backend/.env"
        )
    return line[0].split("=", 1)[1].strip()


async def main() -> int:
    engine = create_async_engine(database_url())
    async with engine.connect() as conn:
        rows = (
            await conn.execute(
                select(
                    NotificationDelivery.status,
                    NotificationDelivery.provider,
                    NotificationDelivery.provider_message_id,
                    NotificationDelivery.error_message,
                    NotificationDelivery.attempted_at,
                    NotificationDelivery.delivered_at,
                    Reminder.status.label("reminder_status"),
                    Device.device_name,
                    Device.push_token,
                )
                .join(Reminder, Reminder.id == NotificationDelivery.reminder_id)
                .outerjoin(Device, Device.id == NotificationDelivery.device_id)
                .order_by(NotificationDelivery.attempted_at.desc())
                .limit(5)
            )
        ).all()
    await engine.dispose()

    if not rows:
        print("No NotificationDelivery rows at all. Nothing was attempted.")
        return 1

    print("Most recent delivery attempts, newest first:\n")
    for r in rows:
        status = r.status.value if hasattr(r.status, "value") else str(r.status)
        print(f"  status               : {status}")
        print(f"  provider             : {r.provider}")
        # NULL means the service accepted the message without identifying it.
        # Printing that as an empty value looks like a missing field; printing
        # a local word would invent a provider id, which is the bug this column
        # used to have.
        print(f"  provider_message_id  : {r.provider_message_id or '(none - accepted without an id)'}")
        print(f"  error_message        : {r.error_message}")
        print(f"  reminder status      : {r.reminder_status.value if hasattr(r.reminder_status, 'value') else r.reminder_status}")
        print(f"  device               : {r.device_name}")
        if r.push_token:
            print(f"  endpoint host        : {r.push_token.split('/')[2]}")
        print(f"  attempted_at         : {r.attempted_at}")
        print(f"  delivered_at         : {r.delivered_at}")
        print()

    newest = rows[0]
    status = newest.status.value if hasattr(newest.status, "value") else str(newest.status)
    print("VERDICT:", end=" ")
    if status == "sent":
        if newest.provider_message_id:
            print("the push service ACCEPTED the message and issued an id for it.")
        else:
            print("the push service ACCEPTED the message but issued no id; the row is still sent.")
    elif status == "failed":
        print(f"refused — {newest.error_message}")
    else:
        print(status)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
