from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from sqlalchemy import select

from app.models.calendar_connection import CalendarEvent, NotificationDelivery, NotificationDeliveryStatus, Reminder, ReminderStatus, ReminderType, TaskCalendarBlock, TaskCalendarBlockStatus
from app.models.task import TaskStatus
from app.repositories.tasks import TaskRepository
from app.schemas.calendar import SuggestedBlock
from app.services.google_calendar import GoogleCalendarService


WORK_START_HOUR = 9
WORK_END_HOUR = 18
SLOT_GRANULARITY_MINUTES = 15
# PENDING_WRITE newer than this is treated as an in-flight Google write.
PENDING_WRITE_IN_FLIGHT_WINDOW = timedelta(minutes=5)


def _parse_busy_intervals(raw_busy: list[dict[str, str]]) -> list[tuple[datetime, datetime]]:
    intervals: list[tuple[datetime, datetime]] = []
    for entry in raw_busy:
        start_raw = entry.get("start")
        end_raw = entry.get("end")
        if not start_raw or not end_raw:
            continue
        try:
            start = datetime.fromisoformat(start_raw.replace("Z", "+00:00"))
            end = datetime.fromisoformat(end_raw.replace("Z", "+00:00"))
        except ValueError:
            continue
        if end <= start:
            continue
        intervals.append((start, end))
    intervals.sort(key=lambda x: x[0])
    return intervals


def find_free_slots(
    *,
    busy: list[tuple[datetime, datetime]],
    time_min: datetime,
    time_max: datetime,
    duration: timedelta,
    max_results: int = 3,
) -> list[tuple[datetime, datetime]]:
    if duration <= timedelta(0):
        return []
    if time_max <= time_min:
        return []

    # Merge overlapping busy intervals within window
    merged: list[tuple[datetime, datetime]] = []
    for start, end in busy:
        clipped_start = max(start, time_min)
        clipped_end = min(end, time_max)
        if clipped_end <= clipped_start:
            continue
        if not merged or clipped_start > merged[-1][1]:
            merged.append((clipped_start, clipped_end))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], clipped_end))

    candidates: list[tuple[datetime, datetime]] = []
    cursor = time_min

    def align_to_granularity(dt: datetime) -> datetime:
        # Round up to next 15-min boundary
        minute = dt.minute
        remainder = minute % SLOT_GRANULARITY_MINUTES
        if remainder == 0 and dt.second == 0 and dt.microsecond == 0:
            return dt.replace(second=0, microsecond=0)
        delta = SLOT_GRANULARITY_MINUTES - remainder
        aligned = (dt.replace(second=0, microsecond=0) + timedelta(minutes=delta))
        return aligned

    cursor = align_to_granularity(cursor)

    for busy_start, busy_end in merged:
        while cursor + duration <= busy_start and len(candidates) < max_results:
            # Enforce work hours on each candidate day
            day_start = cursor.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
            day_end = cursor.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
            if cursor < day_start:
                cursor = day_start
                continue
            if cursor + duration > day_end:
                # Jump to next work day
                cursor = (cursor + timedelta(days=1)).replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
                cursor = align_to_granularity(cursor)
                if cursor + duration > time_max:
                    return candidates
                continue
            if cursor + duration <= busy_start:
                candidates.append((cursor, cursor + duration))
            cursor += timedelta(minutes=SLOT_GRANULARITY_MINUTES)
            cursor = align_to_granularity(cursor)
            if cursor + duration > busy_start:
                break
        if len(candidates) >= max_results:
            break
        if cursor < busy_end:
            cursor = align_to_granularity(busy_end)
        if cursor + duration > time_max:
            break

    # Tail window after last busy interval
    while cursor + duration <= time_max and len(candidates) < max_results:
        day_start = cursor.replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
        day_end = cursor.replace(hour=WORK_END_HOUR, minute=0, second=0, microsecond=0)
        if cursor < day_start:
            cursor = day_start
            continue
        if cursor + duration > day_end:
            cursor = (cursor + timedelta(days=1)).replace(hour=WORK_START_HOUR, minute=0, second=0, microsecond=0)
            cursor = align_to_granularity(cursor)
            continue
        candidates.append((cursor, cursor + duration))
        cursor += timedelta(minutes=SLOT_GRANULARITY_MINUTES)
        cursor = align_to_granularity(cursor)

    return candidates


class SchedulingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.tasks = TaskRepository(session)
        self.calendar = GoogleCalendarService(session)

    async def suggest_blocks(
        self,
        *,
        user_id: UUID,
        task_id: UUID,
        duration_minutes: int | None = None,
        time_min: datetime | None = None,
        time_max: datetime | None = None,
        max_results: int = 3,
    ) -> tuple[int, list[SuggestedBlock]]:
        task = await self.tasks.get_for_user(task_id=task_id, user_id=user_id)
        if task is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
        if task.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")

        duration = duration_minutes or task.estimated_duration_minutes or 30
        if not 1 <= duration <= 1440:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid duration.")

        now = datetime.now(timezone.utc)
        window_start = time_min or now
        window_end = time_max or (now + timedelta(days=7))
        if window_end <= window_start:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="time_max must be after time_min.")
        if (window_end - window_start) > timedelta(days=30):
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Window too large (max 30 days).")

        # Normalize to UTC
        if window_start.tzinfo is None:
            window_start = window_start.replace(tzinfo=timezone.utc)
        if window_end.tzinfo is None:
            window_end = window_end.replace(tzinfo=timezone.utc)

        # Use cached events first, fallback to live freebusy
        raw_busy: list[dict[str, str]] = []
        try:
            raw_busy = await self.calendar.list_cached_events(user_id, window_start, window_end)
            # If cache is empty and connection never synced, try live
            connection = await self.calendar.get_connection(user_id)
            is_stale = True
            if connection and connection.last_synced_at:
                last = connection.last_synced_at
                if last.tzinfo is None:
                    last = last.replace(tzinfo=timezone.utc)
                is_stale = (datetime.now(timezone.utc) - last) > timedelta(minutes=15)
            if (not raw_busy and is_stale) or (connection and is_stale and not raw_busy):
                # Try live, fallback to cache on failure
                try:
                    raw_busy = await self.calendar.fetch_freebusy(user_id, window_start, window_end)
                except HTTPException:
                    pass
            elif not raw_busy and connection is None:
                raw_busy = await self.calendar.fetch_freebusy(user_id, window_start, window_end)
        except HTTPException:
            # If cache path fails, try live
            raw_busy = await self.calendar.fetch_freebusy(user_id, window_start, window_end)
        busy_intervals = _parse_busy_intervals(raw_busy)
        slots = find_free_slots(
            busy=busy_intervals,
            time_min=window_start,
            time_max=window_end,
            duration=timedelta(minutes=duration),
            max_results=max_results,
        )

        blocks = [
            SuggestedBlock(
                suggested_start_at=start,
                suggested_end_at=end,
                reason={"kind": "freebusy_gap", "duration_minutes": duration},
            )
            for start, end in slots
        ]
        return duration, blocks

    async def create_block(
        self,
        *,
        user_id: UUID,
        task_id: UUID,
        suggested_start_at: datetime,
        suggested_end_at: datetime,
        suggestion_reason: dict | None = None,
    ) -> TaskCalendarBlock:
        task = await self.tasks.get_for_user(task_id=task_id, user_id=user_id)
        if task is None or task.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
        if suggested_end_at <= suggested_start_at:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="suggested_end_at must be after suggested_start_at.")
        connection = await self.calendar.get_connection(user_id)
        if not connection or connection.status != "active":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active calendar connection. Connect Google Calendar first.")
        block = TaskCalendarBlock(
            user_id=user_id,
            task_id=task_id,
            calendar_connection_id=connection.id,
            status=TaskCalendarBlockStatus.SUGGESTED,
            suggested_start_at=suggested_start_at,
            suggested_end_at=suggested_end_at,
            suggestion_reason=suggestion_reason or {"kind": "manual_suggest", "duration_minutes": int((suggested_end_at - suggested_start_at).total_seconds() // 60)},
        )
        self.session.add(block)
        await self.session.commit()
        await self.session.refresh(block)
        return block

    async def list_blocks(self, *, user_id: UUID, task_id: UUID) -> list[TaskCalendarBlock]:
        task = await self.tasks.get_for_user(task_id=task_id, user_id=user_id)
        if task is None or task.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
        result = await self.session.scalars(select(TaskCalendarBlock).where(TaskCalendarBlock.user_id == user_id, TaskCalendarBlock.task_id == task_id).order_by(TaskCalendarBlock.created_at.desc()))
        return list(result.all())

    @staticmethod
    def _extract_external_event_id(block: TaskCalendarBlock) -> str | None:
        reason = block.suggestion_reason or {}
        if isinstance(reason, dict):
            ext = reason.get("external_event_id")
            if isinstance(ext, str) and ext:
                return ext
        return None

    @staticmethod
    def _is_recent_write(write_requested_at: datetime | None, now: datetime) -> bool:
        if write_requested_at is None:
            return False
        ts = write_requested_at
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return (now - ts) < PENDING_WRITE_IN_FLIGHT_WINDOW

    async def _find_existing_event(self, *, block: TaskCalendarBlock, connection_id) -> CalendarEvent | None:
        if block.calendar_event_id is not None:
            existing = await self.session.scalar(select(CalendarEvent).where(CalendarEvent.id == block.calendar_event_id))
            if existing is not None:
                return existing
        ext_id = self._extract_external_event_id(block)
        if ext_id:
            existing = await self.session.scalar(
                select(CalendarEvent).where(
                    CalendarEvent.calendar_connection_id == connection_id,
                    CalendarEvent.external_event_id == ext_id,
                )
            )
            if existing is not None:
                return existing
        return None

    async def _upsert_event_from_google(
        self,
        *,
        user_id: UUID,
        connection_id,
        task_title: str,
        block: TaskCalendarBlock,
        event: dict,
    ) -> CalendarEvent | None:
        ext_id = event.get("id") if isinstance(event, dict) else None
        if not isinstance(ext_id, str) or not ext_id:
            return None
        now = datetime.now(timezone.utc)
        existing = await self.session.scalar(
            select(CalendarEvent).where(
                CalendarEvent.calendar_connection_id == connection_id,
                CalendarEvent.external_event_id == ext_id,
            )
        )
        status_value = event.get("status", "confirmed") if isinstance(event, dict) else "confirmed"
        if existing is not None:
            existing.title = task_title
            existing.starts_at = block.suggested_start_at
            existing.ends_at = block.suggested_end_at
            existing.status = status_value
            existing.raw_payload = event
            existing.last_synced_at = now
            existing.updated_at = now
            await self.session.commit()
            await self.session.refresh(existing)
            return existing
        row = CalendarEvent(
            user_id=user_id,
            calendar_connection_id=connection_id,
            external_event_id=ext_id,
            title=task_title,
            starts_at=block.suggested_start_at,
            ends_at=block.suggested_end_at,
            is_all_day=False,
            status=status_value,
            raw_payload=event,
            last_synced_at=now,
        )
        self.session.add(row)
        await self.session.commit()
        await self.session.refresh(row)
        return row

    async def _finalize_with_existing_event(self, *, task, block: TaskCalendarBlock, event: CalendarEvent, connection_id) -> TaskCalendarBlock:
        now = datetime.now(timezone.utc)
        block.calendar_event_id = event.id
        block.calendar_connection_id = connection_id
        block.status = TaskCalendarBlockStatus.CONFIRMED
        block.write_completed_at = now
        block.last_error_message = None
        reason = block.suggestion_reason or {}
        if not isinstance(reason, dict):
            reason = {}
        if reason.get("external_event_id") != event.external_event_id:
            block.suggestion_reason = {**reason, "external_event_id": event.external_event_id}
        await self.session.commit()
        await self.session.refresh(block)
        await self._sync_task_for_confirmation(task, block)
        await self._ensure_block_reminder(task, block)
        return block

    async def _sync_task_for_confirmation(self, task, block: TaskCalendarBlock) -> None:
        suggested_start = block.suggested_start_at
        if suggested_start.tzinfo is None:
            suggested_start = suggested_start.replace(tzinfo=timezone.utc)
        task.due_at = suggested_start
        if task.status not in (TaskStatus.COMPLETED, TaskStatus.ARCHIVED):
            if suggested_start <= datetime.now(timezone.utc):
                task.status = TaskStatus.DUE_NOW
            else:
                task.status = TaskStatus.SCHEDULED
            if task.status == TaskStatus.COMPLETED:
                task.completed_at = task.completed_at or datetime.now(timezone.utc)
        await self.session.commit()
        await self.session.refresh(task)

    async def confirm_block(self, *, user_id: UUID, task_id: UUID, block_id: UUID) -> TaskCalendarBlock:
        task = await self.tasks.get_for_user(task_id=task_id, user_id=user_id)
        if task is None or task.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
        block = await self.session.scalar(select(TaskCalendarBlock).where(TaskCalendarBlock.id == block_id, TaskCalendarBlock.user_id == user_id, TaskCalendarBlock.task_id == task_id))
        if block is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Calendar block not found.")
        if block.status == TaskCalendarBlockStatus.CONFIRMED:
            # Idempotent: already confirmed — link legacy rows, never call Google.
            if block.calendar_event_id is None:
                linked = await self._find_existing_event(block=block, connection_id=block.calendar_connection_id)
                if linked is not None:
                    block.calendar_event_id = linked.id
                    reason = block.suggestion_reason or {}
                    if isinstance(reason, dict) and reason.get("external_event_id") != linked.external_event_id:
                        block.suggestion_reason = {**reason, "external_event_id": linked.external_event_id}
                    await self.session.commit()
                    await self.session.refresh(block)
            return block
        if block.status == TaskCalendarBlockStatus.CANCELED:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Block was canceled.")
        connection = await self.calendar.get_connection(user_id)
        if not connection or connection.status != "active":
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No active calendar connection. Connect Google Calendar first.")
        # Idempotent: a CalendarEvent row already exists for this block — link and return, no Google call.
        existing = await self._find_existing_event(block=block, connection_id=connection.id)
        if existing is not None:
            return await self._finalize_with_existing_event(task=task, block=block, event=existing, connection_id=connection.id)
        # Guard concurrent retry: recent PENDING_WRITE is in-flight — re-check done above, avoid second Google write.
        if block.status == TaskCalendarBlockStatus.PENDING_WRITE and self._is_recent_write(
            block.write_requested_at, datetime.now(timezone.utc)
        ):
            return block
        # Mark intent before external call
        block.status = TaskCalendarBlockStatus.PENDING_WRITE
        block.write_requested_at = datetime.now(timezone.utc)
        block.approved_at = datetime.now(timezone.utc)
        block.calendar_connection_id = connection.id
        await self.session.commit()
        await self.session.refresh(block)
        # Race guard: re-check for an existing event before creating a second Google event.
        existing = await self._find_existing_event(block=block, connection_id=connection.id)
        if existing is not None:
            return await self._finalize_with_existing_event(task=task, block=block, event=existing, connection_id=connection.id)
        try:
            event = await self.calendar.create_calendar_event(user_id, task.title, block.suggested_start_at, block.suggested_end_at)
        except HTTPException as exc:
            block.status = TaskCalendarBlockStatus.WRITE_FAILED
            block.last_error_message = str(exc.detail)[:500]
            await self.session.commit()
            await self.session.refresh(block)
            raise
        calendar_event_row = None
        if isinstance(event, dict) and event.get("id"):
            calendar_event_row = await self._upsert_event_from_google(
                user_id=user_id,
                connection_id=connection.id,
                task_title=task.title,
                block=block,
                event=event,
            )
        block.status = TaskCalendarBlockStatus.CONFIRMED
        block.write_completed_at = datetime.now(timezone.utc)
        block.last_error_message = None
        if calendar_event_row is not None:
            block.calendar_event_id = calendar_event_row.id
        # Persist external event id; keep suggestion_reason JSON as mirror.
        if isinstance(event, dict) and event.get("id"):
            block.suggestion_reason = {**(block.suggestion_reason or {}), "external_event_id": event["id"]}
        await self.session.commit()
        await self.session.refresh(block)
        # Update task to scheduled with block start time (explicit user approval path)
        await self._sync_task_for_confirmation(task, block)
        # Create scheduled_block reminder + ensure due_date reminder via task sync
        await self._ensure_block_reminder(task, block)
        return block

    async def _ensure_block_reminder(self, task, block: TaskCalendarBlock) -> None:
        # Cancel existing scheduled_block pending for this block
        existing = await self.session.scalars(
            select(Reminder).where(
                Reminder.user_id == task.user_id,
                Reminder.task_calendar_block_id == block.id,
                Reminder.type == ReminderType.SCHEDULED_BLOCK,
                Reminder.status.in_([ReminderStatus.PENDING, ReminderStatus.SCHEDULED]),
            )
        )
        for r in existing.all():
            r.status = ReminderStatus.CANCELED
        # Create new reminder at block start (or 10 min before if future)
        suggested_start = block.suggested_start_at
        if suggested_start.tzinfo is None:
            suggested_start = suggested_start.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        scheduled_for = suggested_start - timedelta(minutes=10) if suggested_start > now + timedelta(minutes=15) else suggested_start
        reminder = Reminder(
            user_id=task.user_id,
            task_id=task.id,
            task_calendar_block_id=block.id,
            type=ReminderType.SCHEDULED_BLOCK,
            scheduled_for=scheduled_for,
            status=ReminderStatus.PENDING,
        )
        self.session.add(reminder)
        # Also ensure due_date reminder exists for task
        existing_due = await self.session.scalars(
            select(Reminder).where(
                Reminder.user_id == task.user_id,
                Reminder.task_id == task.id,
                Reminder.task_calendar_block_id.is_(None),
                Reminder.type == ReminderType.DUE_DATE,
                Reminder.status.in_([ReminderStatus.PENDING, ReminderStatus.SCHEDULED]),
            )
        )
        # Cancel stale due_date and recreate at same time as block
        for r in existing_due.all():
            r.status = ReminderStatus.CANCELED
        due_reminder = Reminder(
            user_id=task.user_id,
            task_id=task.id,
            type=ReminderType.DUE_DATE,
            scheduled_for=scheduled_for,
            status=ReminderStatus.PENDING,
        )
        self.session.add(due_reminder)
        await self.session.commit()

    async def dispatch_due_reminders(self, *, user_id: UUID) -> list[Reminder]:
        now = datetime.now(timezone.utc)
        result = await self.session.scalars(
            select(Reminder).where(
                Reminder.user_id == user_id,
                Reminder.scheduled_for <= now,
                Reminder.status == ReminderStatus.PENDING,
            )
        )
        due = list(result.all())
        dispatched: list[Reminder] = []
        for reminder in due:
            # Create delivery (fcm mock as sent)
            delivery = NotificationDelivery(
                user_id=user_id,
                reminder_id=reminder.id,
                provider="fcm",
                status=NotificationDeliveryStatus.SENT,
                attempted_at=now,
                delivered_at=now,
            )
            self.session.add(delivery)
            reminder.status = ReminderStatus.SENT
            reminder.sent_at = now
            dispatched.append(reminder)
        if dispatched:
            await self.session.commit()
            for r in dispatched:
                await self.session.refresh(r)
        return dispatched

    async def acknowledge_reminder(self, *, user_id: UUID, reminder_id: UUID) -> Reminder:
        reminder = await self.session.scalar(select(Reminder).where(Reminder.id == reminder_id, Reminder.user_id == user_id))
        if reminder is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Reminder not found.")
        # Mark deliveries as acknowledged
        deliveries = await self.session.scalars(select(NotificationDelivery).where(NotificationDelivery.reminder_id == reminder_id, NotificationDelivery.user_id == user_id))
        for d in deliveries.all():
            d.status = NotificationDeliveryStatus.ACKNOWLEDGED
        if reminder.status == ReminderStatus.SENT:
            # keep sent, but acknowledge delivery suffices; we keep reminder as SENT
            pass
        await self.session.commit()
        await self.session.refresh(reminder)
        return reminder
