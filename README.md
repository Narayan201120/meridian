# Meridian

Capture a task in seconds, give it a real time on your calendar, and get the reminder even after the tab is closed.

## What works

- Capture by text or by pasted transcript. The structurer pulls out a title, notes, priority, duration, and whether the text reads like a scheduling request. It is a local heuristic, not a model call, and it never writes to your calendar on its own.
- Suggest slots from real Google Calendar free/busy data, then confirm one. Confirming the same block twice does not create two events.
- Reminders the server dispatches on its own timer through Web Push. The browser does not have to be open, and the client does not drive delivery.
- Push payloads are encrypted per RFC 8291 with each device's own subscription keys. The server stores what the push service actually said, including the provider message id when the service returns one.
- Failure states stay honest. A failed reminder read is not a delivery promise. A failed device delete is not "reminders off". A calendar write Google refused says so on screen.

## Stack

| Part | What it uses |
| --- | --- |
| Frontend | Expo 55, Expo Router, React Native Web, NativeWind, TypeScript |
| Backend | FastAPI, async SQLAlchemy, Pydantic v2, Python 3.12 |
| Database | Postgres 17 through Supabase, with RLS on every table |
| Auth | Supabase GoTrue. FastAPI verifies the JWT against the project JWKS |
| Calendar | Google Calendar OAuth, Fernet-encrypted tokens, free/busy, event writes |
| Push | Web Push with VAPID, RFC 8291 payload encryption, `http-ece` |

The backend talks to Postgres directly. Supabase REST is not in the request path.

## Run it locally

You need Python 3.12, Bun, and a Postgres 17 database. The database can come from a local Supabase stack or a hosted Supabase project.

### 1. Database

For a fresh local Supabase stack, apply all seven migrations:

```bash
supabase start
supabase db reset
```

`supabase db reset` replays every file in `supabase/migrations/` in order.

If the database already has the initial schema and you only need the newer migrations, use the script. It shows a plan and refuses to write without `--apply`:

```bash
cd backend
python scripts/apply_migrations.py
python scripts/apply_migrations.py --apply
```

### 2. Backend

```bash
cd backend
python -m venv .venv
# Windows: .venv\Scripts\activate
# macOS and Linux: source .venv/bin/activate
pip install -e ".[dev]"

cp .env.example .env
```

Fill in `backend/.env`:

- `MERIDIAN_DATABASE_URL`, for example `postgresql+asyncpg://postgres:postgres@localhost:54322/postgres`
- `MERIDIAN_SUPABASE_URL`, for example `http://127.0.0.1:54321`
- `MERIDIAN_TOKEN_ENCRYPTION_KEY`, generated with the command in `.env.example`
- The Google OAuth values if you want calendar features
- The VAPID values from `python scripts/generate_vapid.py` if you want push

Start the API:

```bash
uvicorn app.main:app --reload
```

Health check: `GET http://127.0.0.1:8000/api/v1/health`

### 3. Frontend

```bash
cd frontend
bun install
cp .env.example .env
```

Point the frontend at the backend and the same Supabase project:

```text
EXPO_PUBLIC_API_BASE_URL=http://localhost:8000/api/v1
EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
```

Run the web app:

```bash
bun run web
```

Native builds use the same code:

```bash
bun run android
bun run ios
```

## Demo mode and API mode

The app decides its mode from the environment at bundle time. If `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` are both set, it runs in API mode and requires sign-in. If either is empty, it runs in demo mode with local data and no network.

Demo mode exists so the styling and navigation can be exercised with no backend. It is not a substitute for the live suite: every polling hook returns early when `isApiMode` is false, so a broken reminder path cannot fail in demo mode.

## Reminders and Web Push

A background task in the API sweeps for due reminders. The interval is configurable:

```text
MERIDIAN_REMINDER_DISPATCH_INTERVAL_SECONDS=30
```

For each due reminder it fans out to every registered device, encrypts the payload with that device's `p256dh` and `auth` keys, signs the request with VAPID, and records the outcome. A reminder is marked `sent` only when at least one device accepted it. With no devices, no VAPID keys, or every send failed, it stays `pending` and is retried.

The frontend registers a service worker and subscribes from the Enable reminders button. Browsers only allow a permission prompt from a user gesture, so it cannot happen on page load.

Generate the three VAPID values once:

```bash
cd backend
python scripts/generate_vapid.py
```

The keys must be base64 on one line. A PEM spans several lines, dotenv cannot represent that, and the app will fail to start.

## Verification

Backend:

```bash
cd backend
python -m pytest -q          # 168 tests
python -m ruff check app tests e2e_server.py scripts
```

Frontend:

```bash
cd frontend
bun run typecheck            # tsc
bun run typecheck:tsrs       # optional Rust checker, same diagnostics
bun run e2e                  # demo suite, then live suite
```

`bun run e2e` runs two suites on purpose.

- `bun run e2e:demo` has no backend. It proves the Tailwind and NativeWind pipeline compiled, the tabs navigate, and the screens render real content rather than empty chrome.
- `bun run e2e:live` starts `backend/e2e_server.py`, which is the real FastAPI application with a file-backed SQLite database and a local GoTrue-compatible auth stub. It proves the data path, reminder dispatch, push registration, calendar failures, and session expiry without needing a Supabase project.

The suites use ports 8098, 8099, and 8097. Override them with `MERIDIAN_E2E_BACKEND_PORT`, `MERIDIAN_E2E_FRONTEND_PORT`, and `MERIDIAN_E2E_DEMO_PORT`.

On a machine without a Playwright browser download, set `E2E_BROWSER_CHANNEL=chrome` to use the installed Chrome. CI installs the bundled Chromium and leaves the variable empty.

To prove a real push delivery against a real push service, run the headed probe and then read the server's record:

```bash
cd frontend
node scripts/verify-real-push.mjs

cd ../backend
python scripts/check_last_delivery.py
```

The probe signs in, mints a real subscription, creates a reminder due now, and waits for the server sweep. It passes only when the browser reports a `push` event with a matching `showNotification`. The defaults point at the hosted stack; `PROBE_APP`, `PROBE_API`, `PROBE_SUPABASE_URL`, `PROBE_BROWSER`, `PROBE_EMAIL`, and `PROBE_PASSWORD` override them.

## Repository layout

```text
backend/
  app/              FastAPI application, models, schemas, services
  scripts/          migration, VAPID, consent-link, delivery-check tools
  tests/            pytest suite
  e2e_server.py     real app plus auth stub for the live E2E suite
frontend/
  app/              Expo Router routes, five tabs
  src/components/   design system and task UI
  src/context/      tasks, auth, theme state
  src/lib/          API client, auth, push, cache, formatting
  e2e/              Playwright specs
  public/           service worker
supabase/
  migrations/       schema, RLS, enums, triggers
  config.toml       local Supabase CLI configuration
```

## Limits

- Voice capture takes a pasted transcript. It does not record or transcribe audio.
- The reminder sweep assumes one API process. Two workers would deliver twice until a Postgres advisory lock is added.
- Google Calendar needs a real OAuth consent. Rotating `MERIDIAN_TOKEN_ENCRYPTION_KEY` invalidates stored tokens, so the user has to reconnect.
- Real sign-in needs a Supabase project. Demo mode is the only path that works without one.
