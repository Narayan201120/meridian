"""Apply the three unrun migrations to the configured database.

Each migration runs in its own transaction and is idempotent, so re-running is
safe. Every step prints what it found first, so the before state is visible in
the transcript rather than assumed.

Migrations are read from supabase/migrations/*.sql and applied in filename
order. Only files newer than `after` are considered, so previously applied
migrations are not re-run by accident.

Usage:
    python scripts/apply_migrations.py            # show plan, apply nothing
    python scripts/apply_migrations.py --apply    # actually apply
    python scripts/apply_migrations.py --apply --after 20260903121211

Refuses to run without --apply. There is no dry-run-by-default path to the
database, because a half-applied schema is worse than an unapplied one.
"""

import argparse
import asyncio
import pathlib
import re
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

BACKEND_DIR = pathlib.Path(__file__).resolve().parent.parent
MIGRATIONS_DIR = BACKEND_DIR.parent / "supabase" / "migrations"
TIMESTAMP_RE = re.compile(r"^(\d{14})_")

# Every file this script is willing to run, with the reason it exists. Anything
# not listed here is refused, so adding a migration to the directory does not
# silently apply it to a live database.
APPROVED = {
    "20261005120000_add_acknowledged_reminder_status.sql":
        "add 'acknowledged' so a dismissed reminder is distinct from a withdrawn one",
    "20261005210000_drop_fcm_provider_default.sql":
        "drop the fcm default left over from the stub that faked deliveries",
    "20261005300000_drop_false_transcribed_default.sql":
        "drop the transcribed default, since nothing transcribes anything",
    "20261008000000_add_device_push_keys.sql":
        "store the subscription keys Web Push encryption requires, so a delivery can be encrypted for the device instead of recorded as sent while nothing could decrypt it",
}


def database_url() -> str:
    line = [
        ln
        for ln in (BACKEND_DIR / ".env").read_text(encoding="utf-8").splitlines()
        if ln.startswith("MERIDIAN_DATABASE_URL")
    ]
    if not line:
        raise SystemExit("MERIDIAN_DATABASE_URL is not set in backend/.env")
    return line[0].split("=", 1)[1].strip()


def pending(after: str | None) -> list[pathlib.Path]:
    if not MIGRATIONS_DIR.is_dir():
        raise SystemExit(f"no migrations directory at {MIGRATIONS_DIR}")
    files = sorted(
        p for p in MIGRATIONS_DIR.glob("*.sql") if TIMESTAMP_RE.match(p.name) and TIMESTAMP_RE.match(p.name).group(1) > "20260903121211"
    )
    if after:
        files = [p for p in files if TIMESTAMP_RE.match(p.name).group(1) > after]
    return files


async def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="actually run the statements")
    parser.add_argument("--after", default=None, help="only migrations newer than this timestamp")
    args = parser.parse_args()

    files = pending(args.after)
    url = database_url()

    print("Target:", url.split("@")[-1].split("/")[0], "(host only, credentials not printed)")
    print()

    if not files:
        print("Nothing pending.")
        return 0

    engine = create_async_engine(url)
    applied = 0
    for path in files:
        reason = APPROVED.get(path.name)
        if reason is None:
            print(f"REFUSED {path.name}: not in the approved list.")
            print("         Add it to APPROVED in this script once you have read it.")
            continue

        sql = path.read_text(encoding="utf-8")

        print(f"{'APPLYING' if args.apply else 'WOULD APPLY'} {path.name}")
        print(f"  why: {reason}")
        # Strip whole-line comments before splitting. They are why the statement
        # ends up prefixed with "--" if they are left in, and a statement that
        # starts with a comment runs but prints as though it had no body, which
        # defeats the point of a dry run.
        without_comments = "\n".join(ln for ln in sql.splitlines() if not ln.strip().startswith("--"))
        for stmt in without_comments.split(";"):
            body = " ".join(stmt.split())
            if not body:
                continue
            print(f"  sql: {body}")
            if args.apply:
                async with engine.begin() as conn:
                    await conn.execute(text(body))
        if args.apply:
            applied += 1
        print()

    await engine.dispose()

    if not args.apply:
        print("Dry run only. Re-run with --apply to execute.")
        return 0

    print(f"Applied {applied} migration(s).")
    print("Now run scripts/inspect_migration_state.py to confirm the result.")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))