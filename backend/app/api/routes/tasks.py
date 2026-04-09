from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user_id
from app.db.session import get_db_session
from app.models.task import TaskPriority, TaskStatus
from app.schemas.task import TaskCreate, TaskRead, TaskUpdate
from app.services.tasks import TaskService

router = APIRouter()


def get_task_service(session: Annotated[AsyncSession, Depends(get_db_session)]) -> TaskService:
    return TaskService(session)


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

