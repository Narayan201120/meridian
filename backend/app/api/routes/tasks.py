from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db_session
from app.models.calendar_connection import Reminder
from app.models.task import TaskPriority, TaskStatus
from app.schemas.calendar import DispatchResponse, ReminderRead, SuggestBlocksRequest, SuggestBlocksResponse, TaskCalendarBlockCreate, TaskCalendarBlockRead
from app.schemas.task import TaskCreate, TaskRead, TaskUpdate
from app.schemas.task_mutation_log import TaskMutationLogRead
from app.services.scheduling import SchedulingService
from app.services.tasks import TaskService

router = APIRouter()


def get_task_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> TaskService:
    return TaskService(session)


def get_scheduling_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> SchedulingService:
    return SchedulingService(session)


@router.get("", response_model=list[TaskRead], summary="List tasks")
async def list_tasks(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    task_service: Annotated[TaskService, Depends(get_task_service)],
    status_filter: Annotated[TaskStatus | None, Query(alias="status")] = None,
    priority: TaskPriority | None = None,
    include_archived: bool = False,
    limit: Annotated[int, Query(ge=1, le=100)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> list[TaskRead]:
    tasks = await task_service.list_tasks(
        user_id=current_user_id,
        status_filter=status_filter,
        priority=priority,
        include_archived=include_archived,
        limit=limit,
        offset=offset,
    )
    return [TaskRead.model_validate(task) for task in tasks]


@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED, summary="Create task")
async def create_task(
    payload: TaskCreate,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    task_service: Annotated[TaskService, Depends(get_task_service)],
) -> TaskRead:
    task = await task_service.create_task(user_id=current_user_id, payload=payload)
    return TaskRead.model_validate(task)


@router.get("/mutations", response_model=list[TaskMutationLogRead], summary="List task mutation log for sync (offline-first)")
async def list_mutations(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    since: str | None = Query(default=None, description="ISO datetime, return mutations created after this"),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[TaskMutationLogRead]:
    from datetime import datetime

    from app.models.task_mutation_log import TaskMutationLog

    query = select(TaskMutationLog).where(TaskMutationLog.user_id == current_user_id).order_by(TaskMutationLog.created_at.asc()).limit(limit)
    if since:
        try:
            since_dt = datetime.fromisoformat(since.replace("Z", "+00:00"))
            query = query.where(TaskMutationLog.created_at > since_dt)
        except ValueError as exc:
            from fastapi import HTTPException, status

            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid since datetime") from exc
    result = await session.scalars(query)
    return [TaskMutationLogRead.model_validate(r) for r in result.all()]


@router.get("/reminders/list", response_model=list[ReminderRead], summary="List all reminders for current user")
async def list_all_reminders(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
    status_filter: str | None = None,
) -> list[ReminderRead]:
    query = select(Reminder).where(Reminder.user_id == current_user_id).order_by(Reminder.scheduled_for.asc())
    result = await session.scalars(query)
    items = list(result.all())
    if status_filter:
        items = [r for r in items if r.status == status_filter]
    return [ReminderRead.model_validate(r) for r in items]


@router.post("/reminders/dispatch", response_model=DispatchResponse, summary="Dispatch due reminders (create deliveries, mark sent)")
async def dispatch_reminders(
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    scheduling_service: Annotated[SchedulingService, Depends(get_scheduling_service)],
) -> DispatchResponse:
    dispatched = await scheduling_service.dispatch_due_reminders(user_id=current_user_id)
    return DispatchResponse(dispatched=len(dispatched), reminders=[ReminderRead.model_validate(r) for r in dispatched])


@router.post("/reminders/{reminder_id}/ack", response_model=ReminderRead, summary="Acknowledge a reminder delivery")
async def ack_reminder(
    reminder_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    scheduling_service: Annotated[SchedulingService, Depends(get_scheduling_service)],
) -> ReminderRead:
    reminder = await scheduling_service.acknowledge_reminder(user_id=current_user_id, reminder_id=reminder_id)
    return ReminderRead.model_validate(reminder)


@router.get("/{task_id}", response_model=TaskRead, summary="Get task")
async def get_task(
    task_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    task_service: Annotated[TaskService, Depends(get_task_service)],
) -> TaskRead:
    task = await task_service.get_task(user_id=current_user_id, task_id=task_id)
    return TaskRead.model_validate(task)


@router.patch("/{task_id}", response_model=TaskRead, summary="Update task")
async def update_task(
    task_id: UUID,
    payload: TaskUpdate,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    task_service: Annotated[TaskService, Depends(get_task_service)],
) -> TaskRead:
    task = await task_service.update_task(
        user_id=current_user_id,
        task_id=task_id,
        payload=payload,
    )
    return TaskRead.model_validate(task)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT, summary="Delete task")
async def delete_task(
    task_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    task_service: Annotated[TaskService, Depends(get_task_service)],
) -> Response:
    await task_service.delete_task(user_id=current_user_id, task_id=task_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{task_id}/suggest-blocks", response_model=SuggestBlocksResponse, summary="Suggest calendar blocks for a task")
async def suggest_blocks(
    task_id: UUID,
    payload: SuggestBlocksRequest,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    scheduling_service: Annotated[SchedulingService, Depends(get_scheduling_service)],
) -> SuggestBlocksResponse:
    duration, suggestions = await scheduling_service.suggest_blocks(
        user_id=current_user_id,
        task_id=task_id,
        duration_minutes=payload.duration_minutes,
        time_min=payload.time_min,
        time_max=payload.time_max,
        max_results=payload.max_results,
    )
    return SuggestBlocksResponse(task_id=task_id, duration_minutes=duration, suggestions=suggestions)


@router.post("/{task_id}/blocks", response_model=TaskCalendarBlockRead, status_code=status.HTTP_201_CREATED, summary="Create a suggested calendar block (no calendar write yet)")
async def create_block(
    task_id: UUID,
    payload: TaskCalendarBlockCreate,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    scheduling_service: Annotated[SchedulingService, Depends(get_scheduling_service)],
) -> TaskCalendarBlockRead:
    block = await scheduling_service.create_block(
        user_id=current_user_id,
        task_id=task_id,
        suggested_start_at=payload.suggested_start_at,
        suggested_end_at=payload.suggested_end_at,
        suggestion_reason=payload.suggestion_reason,
    )
    return TaskCalendarBlockRead.model_validate(block)


@router.get("/{task_id}/blocks", response_model=list[TaskCalendarBlockRead], summary="List calendar blocks for a task")
async def list_blocks(
    task_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    scheduling_service: Annotated[SchedulingService, Depends(get_scheduling_service)],
) -> list[TaskCalendarBlockRead]:
    blocks = await scheduling_service.list_blocks(user_id=current_user_id, task_id=task_id)
    return [TaskCalendarBlockRead.model_validate(b) for b in blocks]


@router.post("/{task_id}/blocks/{block_id}/confirm", response_model=TaskCalendarBlockRead, summary="Confirm a block — explicit calendar write (user-approved)")
async def confirm_block(
    task_id: UUID,
    block_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    scheduling_service: Annotated[SchedulingService, Depends(get_scheduling_service)],
) -> TaskCalendarBlockRead:
    block = await scheduling_service.confirm_block(user_id=current_user_id, task_id=task_id, block_id=block_id)
    return TaskCalendarBlockRead.model_validate(block)


@router.get("/{task_id}/reminders", response_model=list[ReminderRead], summary="List reminders for a task")
async def list_reminders(
    task_id: UUID,
    current_user_id: Annotated[UUID, Depends(get_current_user_id)],
    session: Annotated[AsyncSession, Depends(get_db_session)],
) -> list[ReminderRead]:
    from app.models.task import Task

    task = await session.scalar(select(Task).where(Task.id == task_id, Task.user_id == current_user_id, Task.deleted_at.is_(None)))
    if task is None:
        from fastapi import HTTPException, status

        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
    result = await session.scalars(select(Reminder).where(Reminder.user_id == current_user_id, Reminder.task_id == task_id).order_by(Reminder.scheduled_for.asc()))
    return [ReminderRead.model_validate(r) for r in result.all()]
