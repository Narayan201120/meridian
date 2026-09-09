# Meridian

AI-assisted productivity app for fast task capture, calendar-aware planning, and reminders.

## Current Repo State

- `backend/`
  - FastAPI service with versioned routes under `/api/v1`
  - async SQLAlchemy with direct Postgres access (not Supabase REST)
  - task CRUD with soft delete, mutation-log audit trail, and due-date reminders
  - Supabase JWT verification for protected routes
  - text + voice capture structuring (heuristic title/priority/duration/schedule-intent)
  - Google Calendar OAuth (Fernet-encrypted tokens), free/busy, event sync cache, suggest-blocks, and user-approved block confirm with idempotent writes
  - reminder dispatch + acknowledge flow (`pending` → `sent` → `acknowledged`)
  - offline-first sync via task mutation log (`GET /api/v1/tasks/mutations?since=`)
- `supabase/`
  - Postgres schema migrations (initial schema, `due_now` status, scopes `text[]` fix)
  - local Supabase CLI config, RLS policies throughout
- `frontend/`
  - real Expo app using Bun, Expo Router tab flow (`Home`, `Inbox`, `Scheduled`, `Due now`, `Completed`)
  - NativeWind design system (ivory canvas, forest-green primary, 8pt grid, floating cards)
  - task capture/voice forms, suggest-times UI, reminders with dispatch + ack, calendar sync
  - WatermelonDB on-device task cache with offline create + auto-push on reconnect
  - SecureStore session persistence on native, `localStorage` on web
  - demo mode (local data) vs API mode (Supabase sign-in + bearer token)

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

Task endpoints now expect a Supabase bearer token:

```text
Authorization: Bearer <access-token>
```

Set `MERIDIAN_SUPABASE_URL` in `backend/.env` so FastAPI can verify tokens against Supabase JWKS.

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
2. Set `EXPO_PUBLIC_SUPABASE_URL` to the local or hosted Supabase URL
3. Set `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the matching publishable key
4. Keep `EXPO_PUBLIC_API_BASE_URL` pointed at the FastAPI server
5. Sign in through the app with a real Supabase user

## Database Foundation
Migrations live in `supabase/migrations/`:

```text
20260409193000_initial_schema.sql   (tables, enums, RLS, triggers)
20260425101500_add_due_now_task_status.sql
20260903121211_scopes_text_array.sql (calendar scopes text[] fix)
```

They create the Meridian tables, enums, RLS policies, and helper triggers for:
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

The migrations assume Supabase Auth is enabled and `auth.users` exists.

## Verification
From `backend/` (venv active):

```bash
python -m pytest -q          # 59 tests
python -m ruff check app tests
```

From `frontend/`:

```bash
bun run typecheck
```

## Data Access Choice
The backend uses direct Postgres access with async SQLAlchemy rather than calling Supabase over REST. That keeps business logic, transactions, and future multi-step workflows inside the FastAPI service.
