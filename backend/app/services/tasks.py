from datetime import datetime, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskPriority, TaskStatus
from app.repositories.tasks import TaskRepository
from app.schemas.task import TaskCreate, TaskUpdate


class TaskService:
    def __init__(self, session: AsyncSession) -> None:
        self.repository = TaskRepository(session)

    async def list_tasks(
        self,
        *,
        user_id: UUID,
        status_filter: TaskStatus | None,
        priority: TaskPriority | None,
        include_archived: bool,
        limit: int,
        offset: int,
    ) -> list[Task]:
        return await self.repository.list_for_user(
            user_id=user_id,
            status_filter=status_filter,
            priority=priority,
            include_archived=include_archived,
            limit=limit,
            offset=offset,
        )

    async def create_task(self, *, user_id: UUID, payload: TaskCreate) -> Task:
        task = Task(
            user_id=user_id,
            title=payload.title,
            notes=payload.notes,
            status=payload.status,
            priority=payload.priority,
            due_at=payload.due_at,
            estimated_duration_minutes=payload.estimated_duration_minutes,
            source=payload.source,
            schedule_intent=payload.schedule_intent,
            ai_metadata=payload.ai_metadata,
            client_created_at=payload.client_created_at,
        )
        self._apply_status_side_effects(task, payload.status)
        await self.repository.add(task)
        await self.repository.save()
        return await self.repository.refresh(task)

    async def get_task(self, *, user_id: UUID, task_id: UUID) -> Task:
        task = await self.repository.get_for_user(user_id=user_id, task_id=task_id)
        if task is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
        return task

    async def update_task(self, *, user_id: UUID, task_id: UUID, payload: TaskUpdate) -> Task:
        task = await self.get_task(user_id=user_id, task_id=task_id)
        updates = payload.model_dump(exclude_unset=True)

        for field_name, value in updates.items():
            if field_name == "ai_metadata" and value is None:
                value = {}
            setattr(task, field_name, value)

        if "status" in updates and task.status is not None:
            self._apply_status_side_effects(task, task.status)

        await self.repository.save()
        return await self.repository.refresh(task)

    async def delete_task(self, *, user_id: UUID, task_id: UUID) -> None:
        task = await self.get_task(user_id=user_id, task_id=task_id)
        task.deleted_at = self._utcnow()
        await self.repository.save()

    def _apply_status_side_effects(self, task: Task, status_value: TaskStatus) -> None:
        now = self._utcnow()

        if status_value == TaskStatus.COMPLETED:
            task.completed_at = task.completed_at or now
            task.archived_at = None
            return

        if status_value == TaskStatus.ARCHIVED:
            task.archived_at = task.archived_at or now
            if task.completed_at is None:
                task.completed_at = None
            return

        task.archived_at = None
        if status_value != TaskStatus.COMPLETED:
            task.completed_at = None

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.now(timezone.utc)

