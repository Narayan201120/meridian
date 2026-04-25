import pytest
from httpx import AsyncClient
from sqlalchemy import select
from uuid import UUID

from app.models.task_mutation_log import MutationKind, TaskMutationLog


pytestmark = pytest.mark.asyncio


async def test_create_task(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/tasks",
        json={
            "title": "Review design mockups",
            "notes": "Check the Figma link",
            "priority": "high",
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Review design mockups"
    assert data["status"] == "inbox"
    assert data["priority"] == "high"
    assert "id" in data
    assert "user_id" in data


async def test_tasks_require_bearer_token(unauthenticated_client: AsyncClient) -> None:
    response = await unauthenticated_client.get("/api/v1/tasks")

    assert response.status_code == 401
    assert response.json()["detail"] == "Missing bearer token."


async def test_create_task_with_mutation_id(client: AsyncClient) -> None:
    mutation_id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
    response = await client.post(
        "/api/v1/tasks",
        json={
            "title": "Schedule kickoff call",
            "client_mutation_id": mutation_id,
        },
    )
    assert response.status_code == 201
    data = response.json()
    assert data["title"] == "Schedule kickoff call"


async def test_create_task_rejects_blank_title(client: AsyncClient) -> None:
    response = await client.post(
        "/api/v1/tasks",
        json={"title": "   "},
    )
    assert response.status_code == 422


async def test_list_tasks_empty(client: AsyncClient) -> None:
    response = await client.get("/api/v1/tasks")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


async def test_list_tasks(client: AsyncClient) -> None:
    await client.post("/api/v1/tasks", json={"title": "Task one"})
    await client.post("/api/v1/tasks", json={"title": "Task two"})

    response = await client.get("/api/v1/tasks")
    assert response.status_code == 200
    data = response.json()
    assert len(data) == 2


async def test_list_tasks_by_status(client: AsyncClient) -> None:
    await client.post("/api/v1/tasks", json={"title": "Inbox task", "status": "inbox"})
    r = await client.post("/api/v1/tasks", json={"title": "Completed task"})
    task_id = r.json()["id"]
    await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "completed"})

    response = await client.get("/api/v1/tasks", params={"status": "inbox"})
    data = response.json()
    assert all(t["status"] == "inbox" for t in data)


async def test_get_task(client: AsyncClient) -> None:
    create_r = await client.post("/api/v1/tasks", json={"title": "Find me"})
    task_id = create_r.json()["id"]

    response = await client.get(f"/api/v1/tasks/{task_id}")
    assert response.status_code == 200
    assert response.json()["title"] == "Find me"


async def test_get_task_not_found(client: AsyncClient) -> None:
    response = await client.get("/api/v1/tasks/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


async def test_update_task(client: AsyncClient) -> None:
    create_r = await client.post("/api/v1/tasks", json={"title": "Old title"})
    task_id = create_r.json()["id"]

    response = await client.patch(f"/api/v1/tasks/{task_id}", json={"title": "New title"})
    assert response.status_code == 200
    assert response.json()["title"] == "New title"


async def test_update_task_status_completed(client: AsyncClient) -> None:
    create_r = await client.post("/api/v1/tasks", json={"title": "Do this"})
    task_id = create_r.json()["id"]

    response = await client.patch(f"/api/v1/tasks/{task_id}", json={"status": "completed"})
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "completed"
    assert data["completed_at"] is not None


async def test_delete_task(client: AsyncClient) -> None:
    create_r = await client.post("/api/v1/tasks", json={"title": "Remove me"})
    task_id = create_r.json()["id"]

    response = await client.delete(f"/api/v1/tasks/{task_id}")
    assert response.status_code == 204

    get_r = await client.get(f"/api/v1/tasks/{task_id}")
    assert get_r.status_code == 404


async def test_delete_task_not_found(client: AsyncClient) -> None:
    response = await client.delete("/api/v1/tasks/00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


async def test_create_task_writes_mutation_log(client: AsyncClient, db_session) -> None:
    response = await client.post(
        "/api/v1/tasks",
        json={"title": "Persist audit trail"},
    )

    task_id = UUID(response.json()["id"])
    logs = (
        await db_session.scalars(
            select(TaskMutationLog).where(TaskMutationLog.task_id == task_id),
        )
    ).all()

    assert len(logs) == 1
    assert logs[0].mutation_kind == MutationKind.CREATE
    assert logs[0].mutation_payload["title"] == "Persist audit trail"


async def test_update_task_writes_mutation_log(client: AsyncClient, db_session) -> None:
    create_r = await client.post("/api/v1/tasks", json={"title": "Old name"})
    task_id = UUID(create_r.json()["id"])

    await client.patch(
        f"/api/v1/tasks/{task_id}",
        json={"title": "New name", "status": "completed"},
    )

    logs = (
        await db_session.scalars(
            select(TaskMutationLog)
            .where(TaskMutationLog.task_id == task_id)
            .order_by(TaskMutationLog.created_at.asc()),
        )
    ).all()

    assert len(logs) == 2
    assert logs[-1].mutation_kind == MutationKind.UPDATE
    assert logs[-1].mutation_payload["title"] == {"old": "Old name", "new": "New name"}
    assert logs[-1].mutation_payload["status"] == {"old": "inbox", "new": "completed"}


async def test_delete_task_writes_mutation_log(client: AsyncClient, db_session) -> None:
    create_r = await client.post("/api/v1/tasks", json={"title": "Delete with audit"})
    task_id = UUID(create_r.json()["id"])

    response = await client.delete(f"/api/v1/tasks/{task_id}")

    logs = (
        await db_session.scalars(
            select(TaskMutationLog)
            .where(TaskMutationLog.task_id == task_id)
            .order_by(TaskMutationLog.created_at.asc()),
        )
    ).all()

    assert response.status_code == 204
    assert len(logs) == 2
    assert logs[-1].mutation_kind == MutationKind.DELETE
    assert logs[-1].mutation_payload["deleted_at"] is not None
