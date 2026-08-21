from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db_session
from app.models.task import TaskPriority, TaskStatus
from app.schemas.calendar import SuggestBlocksRequest, SuggestBlocksResponse, TaskCalendarBlockCreate, TaskCalendarBlockRead
from app.schemas.task import TaskCreate, TaskRead, TaskUpdate
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
    # Enforce path task_id matches body task_id if provided; body is optional alias – we treat path as source of truth
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

