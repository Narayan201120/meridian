from datetime import datetime, timezone
from uuid import UUID, uuid4

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskPriority, TaskSource, TaskStatus, ScheduleIntent
from app.models.task_mutation_log import MutationKind, TaskMutationLog
from app.repositories.tasks import TaskRepository
from app.repositories.task_mutation_log import TaskMutationLogRepository
from app.schemas.task import TaskCreate, TaskUpdate


class TaskService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.repository = TaskRepository(session)
        self.mutation_log_repo = TaskMutationLogRepository(session)

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
        await self.repository.flush()

        await self._write_mutation_log(
            user_id=user_id,
            task_id=task.id,
            mutation_kind=MutationKind.CREATE,
            client_mutation_id=payload.client_mutation_id or uuid4(),
            source_device_id=payload.source_device_id,
            mutation_payload={
                "title": task.title,
                "notes": task.notes,
                "status": task.status.value,
                "priority": task.priority.value,
                "due_at": task.due_at.isoformat() if task.due_at else None,
                "estimated_duration_minutes": task.estimated_duration_minutes,
                "source": task.source.value,
                "schedule_intent": task.schedule_intent.value,
                "ai_metadata": task.ai_metadata,
            },
        )

        await self.session.commit()
        return await self.repository.refresh(task)

    async def get_task(self, *, user_id: UUID, task_id: UUID) -> Task:
        task = await self.repository.get_for_user(user_id=user_id, task_id=task_id)
        if task is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found.")
        return task

    async def update_task(self, *, user_id: UUID, task_id: UUID, payload: TaskUpdate) -> Task:
        task = await self.get_task(user_id=user_id, task_id=task_id)
        updates = payload.model_dump(exclude_unset=True)

        client_mutation_id = updates.pop("client_mutation_id", None) or uuid4()
        source_device_id = updates.pop("source_device_id", None)

        mutation_payload_fields = {}
        for field_name, value in updates.items():
            if field_name == "ai_metadata" and value is None:
                value = {}
            old_value = getattr(task, field_name)
            mutation_payload_fields[field_name] = {"old": self._serialize_value(old_value), "new": self._serialize_value(value)}
            setattr(task, field_name, value)

        if "status" in updates and task.status is not None:
            self._apply_status_side_effects(task, task.status)

        await self.repository.flush()

        await self._write_mutation_log(
            user_id=user_id,
            task_id=task.id,
            mutation_kind=MutationKind.UPDATE,
            client_mutation_id=client_mutation_id,
            source_device_id=source_device_id,
            mutation_payload=mutation_payload_fields,
        )

        await self.session.commit()
        return await self.repository.refresh(task)

    async def delete_task(
        self,
        *,
        user_id: UUID,
        task_id: UUID,
        client_mutation_id: UUID | None = None,
        source_device_id: UUID | None = None,
    ) -> None:
        task = await self.get_task(user_id=user_id, task_id=task_id)
        task.deleted_at = self._utcnow()

        await self._write_mutation_log(
            user_id=user_id,
            task_id=task_id,
            mutation_kind=MutationKind.DELETE,
            client_mutation_id=client_mutation_id or uuid4(),
            source_device_id=source_device_id,
            mutation_payload={"deleted_at": task.deleted_at.isoformat()},
        )

        await self.session.commit()

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

    async def _write_mutation_log(
        self,
        *,
        user_id: UUID,
        task_id: UUID,
        mutation_kind: MutationKind,
        client_mutation_id: UUID,
        source_device_id: UUID | None,
        mutation_payload: dict,
    ) -> None:
        log = TaskMutationLog(
            user_id=user_id,
            task_id=task_id,
            client_mutation_id=client_mutation_id,
            source_device_id=source_device_id,
            mutation_kind=mutation_kind,
            mutation_payload=mutation_payload,
        )
        await self.mutation_log_repo.add(log)
        await self.session.flush()

    def _serialize_value(self, value: datetime | TaskStatus | TaskPriority | TaskSource | ScheduleIntent | None) -> str | float | int | bool | None | dict:
        if isinstance(value, datetime):
            return value.isoformat()
        if isinstance(value, (TaskStatus, TaskPriority, TaskSource, ScheduleIntent)):
            return value.value
        if isinstance(value, dict):
            return value
        return value

    @staticmethod
    def _utcnow() -> datetime:
        return datetime.now(timezone.utc)
