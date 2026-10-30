# Meridian : Interview Questions

## Project Facts

- Purpose: A task-capture and planning app that accepts text or supplied voice transcripts, structures tasks, syncs task state, and proposes calendar blocks.
- Primary technologies: Expo/React Native, FastAPI, Python, async SQLAlchemy, PostgreSQL, Supabase JWT, WatermelonDB, and Google Calendar APIs.
- Architecture: Mobile client uses local task storage and talks to a FastAPI backend. Backend services manage tasks, scheduling, auth, and Google Calendar integration.
- Main components: Capture form and heuristics, task API and mutation log, offline local store and sync hook, schedule proposal/confirmation, reminders, and Google Calendar service.
- Database: PostgreSQL with migrations and row-level security policies; WatermelonDB stores local task data. Calendar access tokens are encrypted.
- APIs: FastAPI routes cover captures, tasks, scheduling, reminders, auth, and calendar integration.
- Authentication/authorization: Supabase JWT verification with user-scoped task writes.
- Async/background processing: The mobile sync hook polls in the foreground every 30 seconds; background push is not implemented. Reminder delivery is local-only.
- External services: Supabase authentication and Google Calendar. The inspected capture path accepts transcript text; microphone recording and speech transcription were not found.
- Deployment/infrastructure: Local backend and Expo run paths are documented; no Docker deployment was found.
- Testing: Backend tests cover tasks, scheduling, auth scope, calendar, and health. No frontend test files were evident.
- Important design decisions: Task writes append mutation-log entries. Calendar confirmation handles concurrent requests and ambiguous Google writes.
- Known limitations: Voice capture starts from supplied transcript text; foreground polling is used instead of background push; local notifications are not server-delivered.
- Important implementation details: Calendar event creation can succeed remotely even when the response is ambiguous, so confirmation reconciles the external result.

## Must-Know Questions

### Q. How would you explain Meridian's end-to-end task flow?

**Suggested answer:** A user submits task text, or a transcript they already have, and the capture service turns it into a title, notes, and a few inferred fields. The client keeps task data locally with WatermelonDB and sends changes to the FastAPI API, where user-scoped task services store them in PostgreSQL and append mutation-log entries. Scheduling can then propose a calendar block, and the user explicitly confirms it before Meridian writes to Google Calendar.

**Key points to prepare:**
- A user enters text or transcript content, the capture service applies deterministic heuristics, and the client syncs task data to the FastAPI backend.
- Explain what is stored locally and what is stored in PostgreSQL.

**Likely follow-ups:**
- What happens while offline?
  - **Suggested answer:** When a task create fails because the network is unavailable, the client stores it locally with an `offline-` ID. The foreground sync hook retries those pending creates and records the returned server ID; edits and deletes should be described separately because this retry path targets offline creates. The implementation does not provide background sync while the app is suspended.
- How are changes reconciled after reconnect?
  - **Suggested answer:** The client retries locally cached offline creates when the app is active or the browser reports an online event, then reloads task data after a successful push. The backend also exposes mutation history using a `since` cursor, but the inspected client path does not establish automatic merging for simultaneous edits.
- Which fields are inferred versus entered by the user?
  - **Suggested answer:** The user supplies the text or transcript. The capture heuristic can derive a title from the first nonempty line, retain remaining lines as notes, and infer priority, duration, or scheduling intent from keywords; it does not perform general natural-language date understanding.

### Q. Is speech recognition implemented?

**Suggested answer:** Not in the inspected capture path. The voice endpoint accepts transcript text and applies the same deterministic structuring heuristics, while the frontend flow lets the user provide that transcript. There is no microphone recording or speech-to-text integration in this implementation.

**Key points to prepare:**
- The capture API receives a transcript string and structures it with heuristics.
- The inspected path does not record microphone audio or transcribe speech.

**Likely follow-ups:**
- Where would speech recognition fit?
  - **Suggested answer:** I would add recording and transcription before the existing transcript capture endpoint, keeping task structuring as a separate step. That preserves the current API boundary and lets the user review the recognized words before they become task data.
- How would you preserve uncertainty in a transcript?
  - **Suggested answer:** I would store transcription confidence and mark uncertain spans or inferred fields as suggestions. The client could show those fields for confirmation instead of treating a low-confidence date or task phrase as fact.
- What should happen when a transcript is incomplete?
  - **Suggested answer:** The app should preserve the raw transcript and ask for clarification when required information is missing. It should avoid silently inventing dates or owners; the current implementation only applies simple text heuristics.

### Q. How does offline task storage work?

**Suggested answer:** The React Native client uses WatermelonDB to keep task records locally, so the UI can work with local data without waiting for every server request. The FastAPI backend remains the shared persistence layer in PostgreSQL. The sync hook currently runs in the foreground, so background sync is a known gap.

**Key points to prepare:**
- The mobile app uses WatermelonDB for local tasks.
- The backend hook documents foreground polling; background push is not implemented.

**Likely follow-ups:**
- How are local creates represented before server acknowledgement?
  - **Suggested answer:** A failed offline create is cached with a temporary `offline-` ID. The sync routine retries it with a POST and writes the returned backend ID into the local model's `serverId` field, while retaining the local record. I would also mention that the retry path does not show a client idempotency key, so an ambiguous successful POST deserves additional protection.
- What happens when the same task changes on two devices?
  - **Suggested answer:** The inspected code establishes user-scoped writes and mutation history, but I did not find a clearly documented multi-device merge policy. I would treat this as an area to define, for example with version checks and a visible conflict resolution rule.
- How would you add background sync?
  - **Suggested answer:** I would use the platform's background task mechanism to schedule bounded sync work, while keeping foreground sync as the immediate path. It would need retry and idempotency rules, plus tests for suspension, network loss, and operating-system scheduling limits.

### Q. What is the task mutation log for?

**Suggested answer:** Task service writes append user-scoped mutation records alongside the current task state. The API exposes mutations from a `since` point, which gives clients a way to fetch changes and makes task updates easier to inspect. I would distinguish that history from the task table, which holds the current state.

**Key points to prepare:**
- Task writes are user-scoped and append mutation-log entries.
- Explain which changes are recorded and how they help reconcile or inspect updates.

**Likely follow-ups:**
- Is the mutation log the system of record?
  - **Suggested answer:** The current task record is the current state; the mutation log is an accompanying history of changes. I would not call the log the authoritative event-sourced store unless the persistence and replay paths actually reconstruct tasks from it.
- How would you handle duplicate mutations?
  - **Suggested answer:** I would use a stable client mutation identifier with a uniqueness constraint or idempotency record, then return the prior result when the same mutation is retried. The API should make that contract explicit so an offline retry cannot create duplicate changes.
- How would you prune old entries?
  - **Suggested answer:** I would first define how long clients may remain offline and retain changes long enough to cover that window. A safe pruning job would preserve a cursor or snapshot boundary so clients that fall behind can fetch a fresh task snapshot rather than silently miss updates.

### Q. How are users authenticated?

**Suggested answer:** The API requires a Bearer token and verifies Supabase JWTs using the configured signing keys, issuer, audience, and supported algorithms. It extracts the subject as the user identity and scopes task access to that user. Database row-level security policies provide an additional boundary for data access.

**Key points to prepare:**
- The backend verifies Supabase JWTs.
- Task writes are scoped to the authenticated user; database migrations define RLS policies.

**Likely follow-ups:**
- Where is the token verified?
  - **Suggested answer:** The shared auth dependency calls the verifier in `backend/core/auth.py`; route dependencies in `backend/api/deps.py` require the Bearer token and turn the verified subject into the application user ID.
- What happens if the JWT is expired?
  - **Suggested answer:** JWT verification rejects a token that fails its validity checks, and the request receives an unauthorized response. A user would need to obtain a valid token through the auth client before retrying.
- How do application checks and database RLS complement each other?
  - **Suggested answer:** The API dependency establishes who is making the request and service queries scope work to that user. RLS applies the ownership boundary at the database as well, which helps protect rows if a query path misses an application-level check.

### Q. How does a calendar proposal become a Google event?

**Suggested answer:** The scheduling service generates candidate blocks and stores a pending proposal. When the user confirms one, the backend calls the Google Calendar service using the user's stored, encrypted OAuth tokens and records the resulting calendar linkage. The explicit confirmation step keeps a suggestion from becoming an external event automatically.

**Key points to prepare:**
- The scheduling service proposes blocks; a confirmation action writes through the Google Calendar service.
- Calendar tokens are encrypted before storage.

**Likely follow-ups:**
- How does the app handle a conflict with an existing event?
  - **Suggested answer:** The scheduler selects candidate blocks against the configured working window and calendar availability, and confirmation checks its pending state. I would verify the exact conflict response for an event added externally between proposal and confirmation before describing stronger guarantees.
- What happens if Google accepts a write but the response is lost?
  - **Suggested answer:** The confirmation path reconciles an ambiguous write by checking for an already-created event that matches the expected title and start time. That lets a retry link the existing event instead of blindly creating another one.
- How are token refresh and revocation handled?
  - **Suggested answer:** Tokens are encrypted at rest and the Google service handles OAuth exchange and refresh. If refresh fails because consent was revoked or the refresh token is invalid, the integration needs to surface a reconnect-required state; I would confirm the exact client-facing behavior before claiming it is fully handled.

### Q. How does confirmation handle concurrent requests?

**Suggested answer:** On PostgreSQL, confirmation locks the pending block row so concurrent requests serialize before changing its state. The service also searches Google Calendar after an ambiguous write and can link a single matching event. These steps reduce duplicate-event risk, though reconciliation can be ambiguous when multiple events match.

**Key points to prepare:**
- The scheduling code serializes concurrent confirmations and reconciles ambiguous Google writes.
- A row lock protects the relevant confirmation state.

**Likely follow-ups:**
- Which race does the row lock prevent?
  - **Suggested answer:** On PostgreSQL, it prevents two concurrent confirmations from both observing the block as pending and independently creating calendar events. One transaction proceeds while the other sees the updated state after the lock is released; the code notes that this row lock is a no-op on SQLite.
- How does the service know whether the remote event already exists?
  - **Suggested answer:** The service searches the target time window for a Google event with the same title and adopts it only when it finds one unambiguous match. Google event creation has no idempotency key in this path, so matching can fail if multiple events qualify; it is a recovery attempt rather than an absolute duplicate-prevention guarantee.
- What makes a retry idempotent?
  - **Suggested answer:** The row lock serializes confirmations on PostgreSQL, and the service tries to adopt a uniquely matching event after an ambiguous Google write. That handles common retries, but it is not a provider-level idempotency guarantee; multiple matching events or a failed reconciliation can still leave uncertainty.

### Q. What does the frontend sync hook do today?

**Suggested answer:** It syncs pending task changes while the app is in the foreground and polls on a 30-second interval. The inspected hook explicitly leaves background push unimplemented. That favors a straightforward first version, but changes may not reach the server promptly while the app is suspended.

**Key points to prepare:**
- It syncs in the foreground and polls every 30 seconds.
- The hook says background push is not implemented.

**Likely follow-ups:**
- How would you avoid unnecessary polling?
  - **Suggested answer:** I would poll only while the app is active and there are pending changes or a freshness requirement, and use backoff after failures. A server push or platform background task could complement that, but should not keep polling continuously when there is no work.
- What happens when the app is suspended?
  - **Suggested answer:** The foreground interval stops running, so sync can wait until the app resumes. That is why the current design should not be described as background synchronization.
- How would push notifications change the design?
  - **Suggested answer:** Push could tell a device that new server changes are available, after which the app would fetch them through the existing API. I would use push as a wake-up signal, not as the source of task data, and retain retry logic for missed notifications.

### Q. How are reminders delivered?

**Suggested answer:** The current reminder path is local-only; it does not run a server-side scheduled delivery service. That keeps the initial implementation simpler, but reminders are tied to a device and need additional sync behavior to stay consistent across devices.

**Key points to prepare:**
- Reminder delivery is local-only in the inspected implementation.
- Do not describe it as a server-side scheduled notification system.

**Likely follow-ups:**
- How would a local reminder behave across device changes?
  - **Suggested answer:** A local notification scheduled on one device may not exist on another device until that device syncs the task and schedules its own reminder. The product should make that limitation clear or move delivery to a shared server-side scheduler.
- What would change for server-side reminders?
  - **Suggested answer:** I would add durable scheduled jobs keyed by user and reminder, make dispatch idempotent, and track delivery or retry state. The service would also need push tokens and a policy for invalid or expired tokens.
- How would time zones and daylight-saving changes affect scheduling?
  - **Suggested answer:** Store the intended local time zone along with the scheduled instant or recurrence rule, then define whether a reminder follows wall-clock time or a fixed UTC instant. Tests should cover daylight-saving transitions because a local time can be skipped or occur twice.

### Q. What does the test suite cover?

**Suggested answer:** The backend tests cover task behavior, scheduling, auth scoping, calendar integration, and health checks. I did not find frontend test files in the inspected tree. I would call out the missing UI and offline-sync coverage as a limitation rather than imply end-to-end coverage.

**Key points to prepare:**
- Backend tests cover task behavior, scheduling, auth scopes, calendar integration, and health.
- No frontend test files were evident.

**Likely follow-ups:**
- Which Google Calendar responses should be mocked?
  - **Suggested answer:** I would mock successful event creation, authorization failure, rate limiting, transient server errors, timeout after a successful write, and token refresh failure. The ambiguous-timeout case is especially important because it exercises event reconciliation.
- How would you test offline reconciliation?
  - **Suggested answer:** I would create a task offline, restore connectivity, and assert that the foreground pusher sends it and records the server ID locally. I would also simulate a server accepting the POST while the response is lost; because the current retry has no idempotency key, that test should expose the risk of creating a duplicate.
- Which UI flows need automated tests?
  - **Suggested answer:** I would cover text capture and review, offline task creation and reconnect, calendar proposal and explicit confirmation, and auth-expired handling. The calendar flow should verify that a suggestion does not write an event until the user confirms.

### Q. What changes are visible in Git history?

**Suggested answer:** Recent commits focus on calendar correctness: one makes confirmation idempotent by linking a calendar event, and another serializes concurrent confirms and reconciles ambiguous Google writes. Those changes address duplicate-event risk when requests overlap or a remote write succeeds without a clear response. The history does not establish who authored or implemented the work, so I would describe only my verified contribution.

**Key points to prepare:**
- Recent commits serialize concurrent calendar confirmations and reconcile ambiguous Google writes.
- Another change makes calendar confirmation idempotent.

**Likely follow-ups:**
- What failure case motivated the behavior, if you know from your work?
  - **Suggested answer:** I would answer this from my own records: [describe the actual failure or report that motivated the change]. The code and commit titles show the target cases were concurrent confirmation and an uncertain response after a Google write, but they do not establish my personal role.
- What invariant does the implementation protect?
  - **Suggested answer:** The intended invariant is that a confirmed block links to one stored calendar event and only one confirmation proceeds at a time on PostgreSQL. Reconciliation reduces duplicate creation after an ambiguous response, but it cannot guarantee recovery when the remote event search is unavailable or returns ambiguous matches.
- How would you test a lost response after a successful Google write?
  - **Suggested answer:** I would have a fake Google client create the event and then raise a timeout before returning its response. The retry should find the matching event, link it to the block, and make no second create call.

### Q. What would you improve before broadening the voice feature?

**Suggested answer:** I would add a real recording and transcription path, but keep transcript review explicit before creating a task. The current capture service has simple title, note, keyword, and duration heuristics, so I would add confidence and uncertainty handling before relying on richer voice input.

**Key points to prepare:**
- The current capture logic starts from text or a transcript and applies deterministic heuristics.
- A real audio path would need capture, transcription, confidence handling, and correction by the user.

**Likely follow-ups:**
- How would you represent an ambiguous date?
  - **Suggested answer:** I would preserve the original phrase and store a parsed date as a proposal with confidence and time-zone context. The UI should ask the user to choose when a phrase such as "next Friday" cannot be resolved safely.
- How would you avoid creating a task from a low-confidence phrase?
  - **Suggested answer:** I would require a user review step when transcription or field extraction confidence is low, and avoid writing an external calendar event until the user confirms it. The current implementation does not provide confidence scoring, so that would be new behavior.
- What privacy choices would audio storage require?
  - **Suggested answer:** I would define whether audio is processed on device or sent to a provider, retain it only as long as needed, and give users clear deletion controls. If only transcript text is needed after processing, I would avoid keeping raw recordings by default.

## Comprehensive Project-Specific Question Bank

## Capture and task modeling

- How does the capture service extract task details from supplied text?
  - **Suggested answer:** It takes the first nonempty line as a title, caps that title, and uses remaining lines as notes. It applies keyword rules for priority, duration, and scheduling intent; it is a deterministic parser rather than a general language model.
- Which date and reminder assumptions are deterministic?
  - **Suggested answer:** Duration is inferred from a simple pattern and scheduling intent from a keyword list. The inspected capture path does not parse arbitrary calendar dates, so I would not claim it understands every natural-language date phrase.
- How would you represent an uncertain owner, date, or priority?
  - **Suggested answer:** I would keep the original text and store extracted values as suggestions with confidence and provenance. The user could confirm or correct uncertain fields before they affect reminders or calendar events.
- What data is stored in the task mutation log?
  - **Suggested answer:** The task service appends mutation history when task data changes, while the task row holds current state. I would inspect the mutation schema for the full field set before enumerating it and would not describe the log as event sourcing without replay support.
- How do the task schema and API preserve user ownership?
  - **Suggested answer:** The authentication dependency derives the user ID from the verified Supabase JWT, and task service operations scope reads and writes to that ID. Database RLS provides another ownership check at the persistence boundary.

## Offline sync and database

- Which task operations are available offline?
  - **Suggested answer:** The client has an explicit offline fallback for task creates: it stores a task with a temporary ID and retries it through the foreground sync hook. I would not claim the same path covers edits or deletes; those need separate verification and tests.
- How does the foreground polling interval affect battery and freshness?
  - **Suggested answer:** A 30-second interval can keep data reasonably fresh while the app is active, at the cost of periodic network and battery use. It stops being useful when the operating system suspends the app, so the current design has a freshness gap in the background.
- How are pending local creates mapped to server IDs?
  - **Suggested answer:** An offline create is stored with an `offline-` temporary ID. When the foreground pusher succeeds, it stores the server's ID separately in `serverId` and updates returned task fields on the local record. The current retry does not send a client mutation key, so a timeout after server creation could risk a duplicate.
- What conflict policy applies when two clients edit the same task?
  - **Suggested answer:** The inspected materials do not establish a clearly documented multi-client merge policy. I would define whether the system uses version checks, last-write-wins, or user resolution, and expose conflicts instead of silently overwriting meaningful edits.
- How do migrations and RLS policies protect user data?
  - **Suggested answer:** Migrations define the PostgreSQL schema and its row-level security rules, while the API also scopes service queries to the authenticated user. Both layers matter: application checks shape behavior, and RLS helps contain mistakes in query paths.
- What would be required to support background sync?
  - **Suggested answer:** I would add a platform background task with bounded execution, retry and idempotency behavior, and persisted pending state. I would test OS suspension and network interruption because background scheduling is controlled by the mobile platform.

## Calendar integration

- How are candidate calendar blocks selected?
  - **Suggested answer:** Meridian proposes blocks within a configured 9 a.m. to 6 p.m. working window using 15-minute granularity and checks calendar availability. The user confirms a proposal before the integration writes an event.
- How does confirmation serialize concurrent requests?
  - **Suggested answer:** The scheduling service locks the relevant pending block row while it processes confirmation. This prevents overlapping requests from both acting on the same pending state.
- What does the service do when a Google write times out ambiguously?
  - **Suggested answer:** It tries to reconcile the remote result by matching an event with the expected title and start time. If it finds that event, it links the existing result rather than issuing another create.
- How are encrypted tokens loaded and refreshed?
  - **Suggested answer:** The Google Calendar service decrypts stored OAuth tokens with the configured Fernet key and uses the refresh flow when an access token needs renewal. Token encryption protects stored credentials, but it does not remove the need to handle expired or revoked consent.
- What should happen when an event is moved or deleted outside Meridian?
  - **Suggested answer:** Meridian should detect the mismatch during a calendar refresh or before confirmation and update or invalidate its local link. I did not find a complete external-edit reconciliation path, so I would frame this as a follow-up design area.

## Security, reliability, and testing

- How does Supabase JWT verification establish the user identity?
  - **Suggested answer:** The backend checks the JWT signature through the configured JWK source, validates issuer and audience, and accepts configured signing algorithms. It reads the subject claim and uses that verified identity to scope the request.
- What should never be logged from a calendar request?
  - **Suggested answer:** Access tokens, refresh tokens, authorization headers, and raw credential material should never be logged. Logs should use request IDs and safe error details without exposing calendar contents or personal data unnecessarily.
- Which Google Calendar failures are retried?
  - **Suggested answer:** The confirmation code catches a Google write error and attempts to reconcile the event by searching Google Calendar before marking the block failed. I did not find a general bounded-backoff retry policy in this path; authorization errors and repeated transient failures need explicit handling and a clear reconnect or retry state.
- How would you test concurrent confirmation without a live Google account?
  - **Suggested answer:** I would run two confirmation requests against the same pending block with a PostgreSQL test database and a fake Google client. The assertions would verify that the row lock serializes them and the client creates or links only one event; SQLite alone would not prove this because the code notes that its row lock is a no-op there.
- How would you test the offline-to-online transition?
  - **Suggested answer:** I would create a task offline, restore connectivity, and assert that the foreground pusher sends it and records the server ID locally. I would also simulate the server accepting the POST while the response is lost; because the current retry has no idempotency key, that test should expose the risk of a duplicate create.
- What is missing from frontend test coverage?
  - **Suggested answer:** I did not find frontend test files in the inspected tree. UI tests for capture, local persistence, sync after reconnect, auth expiry, and calendar confirmation would cover the highest-risk client behavior.

## Trade-offs and difficult questions

- What would break first if task count grew substantially?
  - **Suggested answer:** I would first measure local query performance, API pagination, and mutation-history growth. The task list and mutation endpoint need bounded reads and indexes as data grows; I would validate the actual bottleneck with representative workloads.
- Is 30-second foreground polling appropriate for every device state?
  - **Suggested answer:** It is a simple freshness mechanism while the app is active, but it is wasteful when there are no changes and ineffective while suspended. I would make polling conditional or use push as a wake-up signal, while retaining fetch-based reconciliation.
- Where should microphone capture and transcription live?
  - **Suggested answer:** I would choose based on privacy, latency, and provider requirements. On-device transcription reduces data sent externally, while a server/provider path may support more models; either way the transcript should pass through the existing review and capture boundary.
- How would you make reminders reliable across multiple devices?
  - **Suggested answer:** I would move scheduling to a shared backend job system with durable delivery state and per-device push tokens, while deduplicating by reminder ID. The current local-only reminder behavior does not provide cross-device delivery guarantees.
- Which recent calendar correctness change was most important, and what would you add next?
  - **Suggested answer:** The recent changes address concurrent confirmation and ambiguous Google writes, which can otherwise create duplicate events. Next I would add stronger provider identifiers or reconciliation metadata and automated tests for a successful remote write followed by a lost response.

## API questions

- How does FastAPI validate capture, task, and schedule request bodies?
  - **Suggested answer:** Request bodies are modeled with typed API schemas, so FastAPI validates their shape before route logic runs. Route and service code then applies ownership and business rules such as allowed schedule state transitions.
- Which authentication dependency scopes a request to the Supabase user?
  - **Suggested answer:** The shared API dependency requires a Bearer token, calls the Supabase JWT verifier, and turns the verified subject into the user ID passed to routes and services.
- What status does the API return for a stale task update or invalid schedule?
  - **Suggested answer:** The update path does not implement version-based stale-write detection, so it does not return a conflict just because a task changed elsewhere. A missing task returns 404; an invalid scheduled state, such as a scheduled task without a due time, returns 422. Confirming a cancelled calendar block returns 409.
- How does calendar confirmation stay idempotent when a client retries?
  - **Suggested answer:** On PostgreSQL the backend serializes confirmation with a row lock and attempts to reconcile an event that may already have been created remotely. That can link a uniquely matching event on retry, but there is no provider idempotency key and ambiguous matches can still fail.
- How are Google Calendar timeouts and ambiguous writes represented to the client?
  - **Suggested answer:** The backend attempts to resolve an ambiguous write before deciding the outcome by checking for a matching event. I would verify the exact response schema and status mapping before naming them; the important behavior is that uncertainty is reconciled server-side.
- Which task or history routes need pagination as data grows?
  - **Suggested answer:** Task listing and mutation history are the likely candidates because both can grow with a user's activity. The task API already bounds list size, and the mutation endpoint accepts a `since` cursor; I would add stable cursor pagination if either response can become large.

## Technology choices

- Why use WatermelonDB for local task data alongside PostgreSQL on the backend?
  - **Suggested answer:** WatermelonDB gives the mobile client a local data layer for responsive and offline-capable task views, while PostgreSQL remains the shared server store. The trade-off is that sync and conflict rules must keep the two copies consistent.
- What does Supabase JWT verification provide, and what remains the API's responsibility?
  - **Suggested answer:** JWT verification establishes that the token was signed by the configured issuer and identifies its subject. The API still has to authorize that user for each resource, validate business rules, and protect data at the database boundary.
- Why use FastAPI and async SQLAlchemy for the backend?
  - **Suggested answer:** FastAPI provides typed request handling and async route support, while async SQLAlchemy lets database operations fit the asynchronous API flow. The trade-off is that blocking work and transaction boundaries still need careful handling.
- What are the trade-offs of calling Google Calendar directly from the scheduling service?
  - **Suggested answer:** A direct integration keeps the confirmation flow understandable and returns a concrete provider result, but it couples request latency and availability to Google. Idempotency, timeouts, token refresh, and ambiguous writes therefore need explicit handling.
- What would change if background sync replaced foreground polling?
  - **Suggested answer:** The app would need a background task scheduler and a durable pending queue that can resume after process suspension. Foreground refresh would still be useful for immediate updates, while background work would need platform-aware retry limits.

## Git history

- What changed in the idempotent confirmation work?
  - **Suggested answer:** The September 3 commit changed the scheduling service to link a confirmed block to a `CalendarEvent` row and reconcile a possibly created Google event. It also added calendar API tests. The commit itself does not establish my personal contribution.
- How does the concurrent-confirmation change handle an uncertain external response?
  - **Suggested answer:** The September 9 change adds a row lock around confirmation on PostgreSQL and a Google Calendar lookup for a uniquely matching event after an ambiguous write. The lookup helps adopt an event when Google accepted the create but the response was lost; it cannot guarantee reconciliation if the search is ambiguous or unavailable.
- Which migration or service contract changed alongside that work?
  - **Suggested answer:** Neither of those commits includes a migration. The service behavior changed instead: confirmation links a `CalendarEvent` row to the task block, while `GoogleCalendarService` gained a lookup that reconciles an ambiguous event create. The commits also add tests for calendar confirmation.
- Describe your own contribution from personal records; commit history alone does not establish authorship.
  - **Suggested answer:** I would use my own records to fill this in: [describe your actual contribution, decisions, and review or implementation work]. The repository history can identify code changes, but it does not by itself prove who did each part.
