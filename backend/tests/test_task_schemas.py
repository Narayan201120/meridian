import pytest
from pydantic import ValidationError

from app.models.task import TaskPriority
from app.schemas.task import TaskCreate, TaskUpdate


def test_task_create_normalizes_strings() -> None:
    payload = TaskCreate(
        title="  Follow up with design partner  ",
        notes="  Ask about launch timing.  ",
        priority=TaskPriority.HIGH,
    )

    assert payload.title == "Follow up with design partner"
    assert payload.notes == "Ask about launch timing."


def test_task_create_rejects_blank_title() -> None:
    with pytest.raises(ValidationError):
        TaskCreate(title="   ")


def test_task_update_allows_clearing_notes() -> None:
    payload = TaskUpdate(notes="   ")

    assert payload.notes is None
