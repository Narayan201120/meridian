from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.task_mutation_log import MutationKind


class TaskMutationLogPayload(BaseModel):
    client_mutation_id: UUID
    source_device_id: UUID | None = None


class TaskMutationLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    user_id: UUID
    task_id: UUID
    source_device_id: UUID | None
    client_mutation_id: UUID
    mutation_kind: MutationKind
    mutation_payload: dict[str, Any]
    applied_at: datetime | None
    created_at: datetime
