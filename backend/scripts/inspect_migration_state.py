"""Read the live state of everything the unrun migrations touch.

Read-only. Safe to run against the hosted project: no DDL, no writes.
"""

import asyncio
import pathlib
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

URL = [
    line
    for line in pathlib.Path(".env").read_text(encoding="utf-8").splitlines()
    if line.startswith("MERIDIAN_DATABASE_URL")
][0].split("=", 1)[1].strip()

QUERIES = [
    (
        "reminder_status enum",
        """
        select e.enumlabel as label
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'reminder_status'
        order by e.enumsortorder
        """,
    ),
    (
        "voice_capture_status enum",
        """
        select e.enumlabel as label
        from pg_type t join pg_enum e on e.enumtypid = t.oid
        where t.typname = 'voice_capture_status'
        order by e.enumsortorder
        """,
    ),
    (
        "notification_deliveries.provider default",
        """
        select column_default from information_schema.columns
        where table_name = 'notification_deliveries' and column_name = 'provider'
        """,
    ),
    (
        "voice_captures.status default",
        """
        select column_default from information_schema.columns
        where table_name = 'voice_captures' and column_name = 'status'
        """,
    ),
    (
        "live row counts (nothing here is rewritten by any migration)",
        """
        select
          (select count(*) from reminders) as reminders,
          (select count(*) from voice_captures) as captures,
          (select count(*) from devices) as devices,
          (select count(*) from notification_deliveries) as deliveries,
          (select count(*) from tasks) as tasks
        """,
    ),
]


async def main() -> int:
    engine = create_async_engine(URL)
    for label, sql in QUERIES:
        # One connection per query. A failed statement aborts the transaction, so
        # sharing a connection turns one bad query into every query reporting an
        # error, which is exactly the confusion this script exists to avoid.
        async with engine.connect() as conn:
            try:
                rows = (await conn.execute(text(sql))).fetchall()
                values = ", ".join(str(r[0]) for r in rows)
                print(f"  {label}: {values or '(none)'}")
            except Exception as exc:  # noqa: BLE001 - a diagnostic probe reports, it does not raise
                print(f"  {label}: ERROR {type(exc).__name__}: {str(exc).splitlines()[0][:100]}")
            finally:
                await conn.rollback()
    await engine.dispose()
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))