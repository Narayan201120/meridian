# Meridian PRD v2

## Document Purpose
This document replaces the high-level summary with an implementation-oriented PRD for a closed beta release. The original `meridian_prd.md` remains unchanged for comparison.

## Product Summary
Meridian is a mobile-first task capture and planning app for people who think in conversation but still need structured execution. Its core promise is simple: capture tasks quickly, understand them with AI, and help users plan them around the calendar they already live in.

For the first release, Meridian is not trying to be a full project-management suite. It is a fast capture and personal planning product with a clear workflow:
1. Capture a task by voice or text.
2. Convert that input into a structured task.
3. Use calendar context to suggest when to do it.
4. Remind the user before it slips.

## Target User

### Primary User
Busy individual professionals who:
- capture work while walking, commuting, or switching contexts
- already live in Google Calendar
- currently lose tasks across notes, chats, voice memos, and mental overhead

Examples:
- founder or operator juggling meetings and follow-ups
- manager capturing tasks between calls
- freelancer or consultant managing client work independently

### Secondary User
Small teams that may eventually share tasks, but collaboration is not the launch wedge.

### Not the Launch User
- enterprise PMO teams
- users needing full Jira/Asana-style workflow management
- users expecting a general-purpose AI assistant

## Problem Statement
Existing tools are good at storing tasks, but weak at fast capture and calendar-aware follow-through. Users often know what they need to do, but not when they will actually do it. Voice capture is fast but unstructured. Task apps are structured but slow to feed. Calendars show time constraints but do not convert spoken intent into scheduled action.

## MVP Value Proposition
In under 30 seconds, a user can speak a task, have Meridian turn it into a structured item, save it even when offline, and receive a safe scheduling suggestion based on their current calendar availability.

## Product Goals
- Make task capture materially faster than typing in a traditional task app.
- Increase the percentage of captured tasks that become scheduled or completed.
- Reduce loss of intent between "I need to do this" and "I actually did this."

## Success Metrics
Closed beta targets:
- median time from opening capture to saved task under 10 seconds for text input
- median time from completed voice recording to saved structured task under 20 seconds
- at least 70% of voice captures parsed into usable structured tasks without full manual rewrite
- at least 40% of active users schedule or complete a captured task within 48 hours
- calendar sync success rate above 99% for connected accounts
- push reminder delivery success above 95% for scheduled reminders

## Non-Goals for Closed Beta
- full real-time collaboration workspaces
- multi-user task assignment and permissions
- native meeting scheduling across multiple attendees
- Outlook / Microsoft Graph support at launch
- self-hosted speech-to-text infrastructure
- desktop-first experience parity

## Product Scope

### In Scope for Closed Beta
- account creation and sign-in
- task CRUD
- voice capture and transcription
- AI parsing from transcript to structured task fields
- Google Calendar connection
- calendar read sync for free/busy awareness
- explicit user-approved calendar write for time blocking
- reminders and push notifications
- offline-first mobile task workflows
- basic web app for viewing and editing tasks

### Out of Scope for Closed Beta
- team collaboration
- shared workspaces
- live co-editing
- Outlook integration
- recurring task engine beyond simple reminders
- meeting scheduling flow with invite handling

## Core User Stories
- As a user, I can quickly add a task by typing a title and optional details.
- As a user, I can record a short voice note and have Meridian create a draft task from it.
- As a user, I can review and correct AI-parsed fields before saving if needed.
- As a user, I can connect Google Calendar and let Meridian read my schedule.
- As a user, I can ask Meridian to suggest a time for a task based on my calendar.
- As a user, I can approve a suggested time block before anything is written to my calendar.
- As a user, I can create, edit, complete, and delete tasks while offline on mobile.
- As a user, I can receive reminders for due tasks or scheduled work blocks.

## MVP Functional Requirements

### 1. Task Management
Each task must support:
- `title` required
- `notes` optional
- `status`: inbox, scheduled, completed, archived
- `priority`: low, medium, high
- `due_at` optional
- `estimated_duration_minutes` optional
- `source`: manual_text, voice, calendar_suggestion
- `schedule_intent`: none, suggest_time, user_requested_block

The app must provide:
- create, edit, complete, reopen, archive, delete
- inbox and upcoming views
- task detail screen with edit history for AI-generated fields

### 2. Voice Capture and AI Parsing
Voice capture must:
- support recordings up to 60 seconds for v1
- upload audio when online and queue upload when offline
- store audio temporarily for processing, then delete raw audio after retention window

AI pipeline:
1. Speech-to-text transcribes the recording.
2. A parser extracts structured fields:
   - title
   - due date or time references
   - priority cues
   - estimated duration when stated
   - schedule intent such as "tomorrow afternoon" or "find time this week"
3. The client presents a draft task for confirmation when confidence is low or when a calendar write is implied.

AI safety rules:
- Meridian must never silently create a calendar event from voice input alone.
- Low-confidence date or time extraction must be shown as a suggestion, not auto-committed.
- If parsing fails, the transcript must still be saved as a draft task or note so capture is never lost.

### 3. Calendar Integration
Launch integration is Google Calendar only.

Meridian must support:
- OAuth connection to Google Calendar
- token refresh and revoked-token recovery
- calendar read sync for free/busy and event metadata needed for planning
- optional calendar write to create a time block for a task after explicit user approval

Calendar safety rules:
- Meridian must not edit or delete third-party events it did not create.
- Meridian-created events must include stable external IDs for reconciliation.
- Calendar writes must be user-initiated or user-approved, never background guesses.
- If a calendar write fails, the task remains intact and the user sees retry status.

### 4. Notifications and Reminders
The system must support:
- due-date reminders
- scheduled-block reminders
- push token registration per device
- user controls for reminder timing and quiet hours

Reminder behavior:
- if the device is offline, reminders already scheduled locally should still fire when possible
- server-scheduled reminders must deduplicate against client state to avoid double delivery

### 5. Offline-First Mobile
Offline-first is a launch requirement, not a later enhancement.

The mobile app must:
- allow task create/edit/complete/archive while offline
- queue mutations locally with client-generated IDs
- reconcile changes when connectivity returns
- preserve unsynced voice captures until upload succeeds or the user discards them

The web app is not required to have full offline parity for closed beta.

## Sync and Conflict Model
Use `WatermelonDB` as the mobile local database. Do not defer this choice.

Sync rules:
- Supabase Postgres is the server system of record.
- Mobile clients keep a local task store plus an outbound mutation queue.
- All client-created records use UUIDs generated on device.
- Deletes use tombstones, not hard deletes, until sync is confirmed.
- Scalar task field conflicts resolve by `updated_at` last-write-wins.
- Completion state wins over stale non-completed state if timestamps are close and conflict is ambiguous.
- Calendar link state is server-owned and cannot be overwritten by stale client data.

This model must be reflected in schema design before implementation begins.

## Backend Ownership and System Boundaries

### Expo App
Owns:
- UI and local state
- offline queue
- optimistic task interactions
- voice recording UX
- reminder preferences

### Supabase
Owns:
- authentication
- Postgres database
- row-level security
- realtime subscriptions for task updates
- storage metadata and app data persistence

### FastAPI Service
Owns:
- AI orchestration
- voice upload processing workflow
- transcript-to-task parsing
- calendar sync orchestration and reconciliation
- business rules that span app, AI, and calendar writes

### Supabase Edge Functions
Own only lightweight jobs:
- push delivery fanout
- cron-triggered reminder dispatch
- webhook entry points when low-complexity handling is sufficient

Important boundary:
Business logic must not be split arbitrarily across FastAPI and Edge Functions. If a workflow involves multi-step decision-making, retries, AI interpretation, or cross-system reconciliation, FastAPI owns it.

## Data Model: Core Entities
- `users`
- `devices`
- `tasks`
- `task_mutation_log`
- `voice_captures`
- `calendar_connections`
- `calendar_events`
- `task_calendar_blocks`
- `reminders`
- `notification_deliveries`

Minimum schema requirements:
- every syncable table has `id`, `created_at`, `updated_at`
- user-owned records enforce RLS
- external integration tables store provider, external ID, sync status, and last sync timestamp

## Privacy and Security Requirements
- raw audio must have a retention policy and should be deleted after processing unless the user explicitly opts to keep it
- transcripts and parsed task content are user data and must be protected under authenticated access controls
- OAuth tokens must be encrypted at rest
- the product must clearly disclose that voice recordings are sent to a third-party transcription provider during beta
- calendar scope requests must be minimal and specific to the needed permissions

## Reliability and Operational Requirements
- no task capture should be lost if AI parsing, upload, or sync fails
- all asynchronous workflows need idempotency keys
- calendar sync jobs need retry logic with backoff
- reminder delivery must be observable with success and failure events
- the system must expose basic admin visibility into failed syncs, failed reminders, and revoked calendar connections

## UX Requirements
- capture flow should default to the fastest path, with optional detail editing after save
- voice capture must end in a visible draft state, not a hidden background action
- schedule suggestions must explain why a time was suggested when practical
- destructive actions like delete or disconnect calendar must be reversible or confirmed

## Phased Delivery Plan

### Phase 0: Foundations
- finalize schema with sync model
- choose WatermelonDB and queue strategy
- define FastAPI versus Supabase responsibilities
- implement auth and RLS baseline

### Phase 1: Closed Beta MVP
- mobile app with task CRUD and inbox/upcoming views
- voice capture and transcript-to-task parsing
- Google Calendar connection
- schedule suggestion UI
- explicit calendar time-block creation
- push reminders

### Phase 2: Reliability and Expansion
- improved parsing quality and fallback handling
- admin tools for sync and reminder failures
- web editing experience improved
- usage caps and billing guardrails for voice

### Phase 3: Post-MVP
- Outlook integration
- collaboration primitives
- meeting scheduling flows
- self-hosted transcription if economics justify it

## Key Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Offline sync becomes ambiguous late in development | Lock sync model, local DB choice, and conflict rules before schema implementation |
| Calendar writes damage user trust | Require explicit approval, never edit third-party events, make all write failures visible |
| Voice parsing quality is uneven | Save transcript even on parser failure, use confidence thresholds, keep manual correction simple |
| Backend logic fragments across platforms | Make FastAPI the owner of cross-system workflows and keep Edge Functions lightweight |
| Scope creep pulls team into PM suite territory | Keep MVP centered on capture, structure, schedule, remind |

## Open Questions
- Should the closed beta include a lightweight "Today" planning view or just inbox plus upcoming?
- Should schedule suggestions use deterministic heuristics first, or an LLM-assisted planner after enough task data exists?
- What exact retention window should apply to raw audio in beta?
- Does web need voice capture at launch, or is mobile-only voice acceptable for the first release?

## One-Line Positioning
Meridian helps busy people turn spoken intent into scheduled action without losing control of their calendar.
