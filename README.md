# Meridian

AI-assisted productivity app for fast task capture, calendar-aware planning, and reminders.

## Current Repo State

- `backend/`
  - FastAPI scaffold
  - async SQLAlchemy database session wiring
  - task CRUD API skeleton
- `supabase/`
  - initial Postgres schema migration
  - local Supabase CLI config
- `frontend/`
  - real Expo app scaffold using Bun
  - first task-oriented screen with demo mode and API mode wiring

## Backend Run
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

For web-based frontend development, the backend now allows local CORS origins for Expo on:

```text
http://localhost:8081
http://127.0.0.1:8081
http://localhost:19006
http://127.0.0.1:19006
```

Override them with `MERIDIAN_CORS_ORIGINS` in `backend/.env` if needed.

## Frontend Run
From `frontend/`:

```bash
bun install
bun run typecheck
bun run start -- --localhost
```

To put the frontend into API mode instead of demo mode:

1. Copy `frontend/.env.example` to `frontend/.env`
2. Set `EXPO_PUBLIC_DEV_USER_ID` to a real backend user UUID
3. Keep `EXPO_PUBLIC_API_BASE_URL` pointed at the FastAPI server

## Database Foundation
The initial SQL migration lives at:

```text
supabase/migrations/20260409193000_initial_schema.sql
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
