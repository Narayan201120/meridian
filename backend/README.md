# Meridian Backend

Minimal FastAPI scaffold for Meridian's backend services.

## What Exists
- FastAPI app entrypoint
- versioned API router
- health endpoint
- environment-based settings
- async SQLAlchemy database session wiring
- task CRUD API skeleton
- initial Supabase/Postgres schema migration

## Local Run
From `backend/`:

```bash
python -m venv .venv
.venv\Scripts\activate
pip install -e .[dev]
uvicorn app.main:app --reload
```

The API health endpoint will be available at:

```text
GET /api/v1/health
```

Task endpoints are available under:

```text
/api/v1/tasks
```

Until Supabase JWT auth is wired into FastAPI, task endpoints use a temporary header-based identity:

```text
X-User-Id: <uuid>
```

The API rejects task requests without that header.

## Database Foundation
The initial SQL migration lives at:

```text
..\supabase\migrations\20260409193000_initial_schema.sql
```

It creates the first set of Meridian tables, enums, RLS policies, and helper triggers for:
- profiles
- devices
- tasks
- task mutation log
- voice captures
- calendar connections
- calendar events
- task calendar blocks
- reminders
- notification deliveries

The migration assumes Supabase Auth is enabled and `auth.users` exists.

## Data Access Choice
The backend uses direct Postgres access with async SQLAlchemy rather than calling Supabase over REST. That keeps business logic, transactions, and future multi-step workflows inside the FastAPI service.
