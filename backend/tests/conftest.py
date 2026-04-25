from collections.abc import AsyncIterator
from uuid import uuid4

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

from app.db.base import Base
from app.db.session import get_db_session
from app.main import app as fastapi_app
from app.models import Task, TaskMutationLog  # noqa: F401 - needed to register models


TEST_USER_ID = uuid4()


@pytest.fixture
def auth_user_id() -> str:
    return str(TEST_USER_ID)


@pytest.fixture
def mock_auth() -> None:
    from unittest.mock import patch

    def mock_verify(token: str) -> dict:
        return {"sub": str(TEST_USER_ID)}

    with patch("app.api.deps.verify_supabase_jwt", side_effect=mock_verify):
        yield


@pytest_asyncio.fixture
async def db_engine():
    engine = create_async_engine(
        "sqlite+aiosqlite:///:memory:",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield engine
    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(db_engine) -> AsyncIterator[AsyncSession]:
    factory = async_sessionmaker(db_engine, expire_on_commit=False)
    async with factory() as session:
        yield session


@pytest_asyncio.fixture
async def app_with_db(db_session: AsyncSession, mock_auth: None) -> AsyncIterator:
    async def override():
        yield db_session

    fastapi_app.dependency_overrides[get_db_session] = override
    yield fastapi_app
    fastapi_app.dependency_overrides.clear()


@pytest_asyncio.fixture
async def client(app_with_db) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app_with_db)
    async with AsyncClient(
        transport=transport,
        base_url="http://test",
        headers={"Authorization": "Bearer test-token"},
    ) as ac:
        yield ac


@pytest_asyncio.fixture
async def unauthenticated_client(app_with_db) -> AsyncIterator[AsyncClient]:
    transport = ASGITransport(app=app_with_db)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
