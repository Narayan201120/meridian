from uuid import UUID

from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task import Task, TaskPriority, TaskStatus


class TaskRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    def _base_query(self, user_id: UUID) -> Select[tuple[Task]]:
        return select(Task).where(Task.user_id == user_id, Task.deleted_at.is_(None))

    async def list_for_user(
        self,
        *,
        user_id: UUID,
        status_filter: TaskStatus | None,
        priority: TaskPriority | None,
        include_archived: bool,
        limit: int,
        offset: int,
    ) -> list[Task]:
        stmt = self._base_query(user_id).order_by(Task.created_at.desc()).limit(limit).offset(offset)

        if status_filter is not None:
            stmt = stmt.where(Task.status == status_filter)
        elif not include_archived:
            stmt = stmt.where(Task.status != TaskStatus.ARCHIVED)

        if priority is not None:
            stmt = stmt.where(Task.priority == priority)

        result = await self.session.scalars(stmt)
        return list(result.all())

    async def get_for_user(self, *, user_id: UUID, task_id: UUID) -> Task | None:
        stmt = self._base_query(user_id).where(Task.id == task_id)
        result = await self.session.scalars(stmt)
        return result.one_or_none()

    async def add(self, task: Task) -> Task:
        self.session.add(task)
        await self.session.flush()
        return task

    async def save(self) -> None:
        await self.session.commit()

    async def flush(self) -> None:
        await self.session.flush()

    async def refresh(self, task: Task) -> Task:
        await self.session.refresh(task)
        return task

