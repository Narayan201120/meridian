"""Read back what the server recorded for the most recent push delivery.

The browser side of this proof lives in frontend/scripts/verify-real-push.mjs.
This is the half that says what the *server* did: whether the transport was
allowed to send, whether the push service accepted, and what it called the
message. A FAILED row here is as informative as a SENT one, because the
`error_message` column carries the actual refusal.

Read-only.
"""

from __future__ import annotations

import asyncio
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
        print(f"  provider_message_id  : {r.provider_message_id}")
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
        print("the push service ACCEPTED the message for a real browser subscription.")
    elif status == "failed":
        print(f"refused — {newest.error_message}")
    else:
        print(status)
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
