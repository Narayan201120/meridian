from sqlalchemy.ext.asyncio import AsyncSession

from app.models.task_mutation_log import TaskMutationLog


class TaskMutationLogRepository:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def add(self, log: TaskMutationLog) -> TaskMutationLog:
        self.session.add(log)
        await self.session.flush()
        return log
