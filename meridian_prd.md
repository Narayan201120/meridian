# Meridian — Project Summary

## What It Is
A full-stack productivity platform combining tasks, voice input, calendar sync, real-time collaboration, and AI-powered scheduling. Web + mobile, unified experience.

---

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend Web + Mobile | React Native + Expo | Single codebase, web export via Expo |
| Backend / AI endpoints | FastAPI | Async, Python-native for ML integration |
| DB + Auth + Realtime | Supabase | Collapses 3 infra concerns into one |
| Push Notifications | FCM via Supabase Edge Functions | No separate notification infra |
| Speech-to-Text | OpenAI Whisper API (capped per user) | Best quality; self-host past ~500 DAU |
| Calendar Sync | Google Calendar API + Microsoft Graph | OAuth 2.0, built as isolated integration service |
| Caching / Async Jobs | Redis + Celery | Added only when async job need is validated |
| File Storage | S3 or GCS | Audio files from voice input |
| Hosting | Railway (early) → AWS/GCP (scale) | Low ops overhead early on |

---

## Core Features
- **Task management** — create, prioritize, organize with deadlines
- **Voice input** — speak tasks, Whisper transcribes and parses them
- **Calendar sync** — two-way sync with Google Calendar and Outlook
- **Real-time collaboration** — live updates across devices via Supabase Realtime
- **Push notifications** — reminders, due dates, collaboration events
- **Meeting scheduling** — built on top of calendar APIs, no third-party dependency
- **Offline-first mobile** — architectural decision baked in from day 1, not retrofitted

---

## Architecture Decisions
- **Offline-first** must be decided before writing any data models — Supabase Realtime + local cache strategy (WatermelonDB or MMKV) defined upfront
- **Calendar OAuth** is an isolated integration service with retry logic, token refresh handling, and Workspace edge case handling — not inline in main app logic
- **Whisper usage-capped** per user with hard limits until voice feature is validated at scale
- **Celery deferred** — Supabase Edge Functions handle lightweight async until job complexity justifies adding Celery + Redis overhead

---

## Build Phases

**Phase 1 — Core**
- Supabase setup (auth, DB schema, realtime)
- FastAPI skeleton + Whisper integration
- Expo app: task CRUD, voice input, push notifications

**Phase 2 — Calendar & Sync**
- Google Calendar OAuth integration service
- Microsoft Graph (Outlook) support
- Offline sync layer finalized

**Phase 3 — Collaboration & Scale**
- Real-time multi-user features
- Celery + Redis added for notification scheduling and batch jobs
- Self-hosted Whisper if DAU threshold hit

**Phase 4 — Polish & Growth**
- Meeting scheduling (native, no Cal.com dependency)
- Analytics, admin dashboard
- Infrastructure migration to AWS/GCP if on Railway

---

## Key Risks

| Risk | Mitigation |
|---|---|
| Offline sync complexity | Decide architecture day 1, use proven local DB (WatermelonDB) |
| Calendar OAuth edge cases | Isolated service, retry logic, Workspace-specific test suite |
| Whisper cost at scale | Hard per-user caps + self-host trigger at 500 DAU |
| React Native web parity | Expo handles most; flag divergence points early in component design |
| Scope creep | Ship Phase 1 as closed beta first, validate before Phase 2 |

---

**One-line pitch:** Meridian is the productivity platform that listens to you, syncs your calendar, and keeps your team aligned — in real time, on every device.