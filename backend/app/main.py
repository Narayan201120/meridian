import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.router import api_router
from app.core.config import settings
from app.db.session import get_session_factory
from app.services.scheduling import run_due_sweep

logger = logging.getLogger(__name__)


async def _due_work_loop() -> None:
    """Deliver due reminders and activate due tasks on a timer.

    This used to be a 30-second `setInterval` inside a React hook, which meant
    reminders were sent only while somebody happened to have the app open in a
    tab. The route it called had no other caller. Closing the tab stopped
    delivery entirely, so a reminder for a 9am task did not arrive at 9am.

    The first pass runs immediately rather than after one interval, so anything
    that came due while the process was down is picked up on restart instead of
    waiting out the delay.

    Swallowing every exception is deliberate. An unhandled error here would kill
    the task, and a silently dead scheduler looks exactly like a healthy one
    that has nothing to do.
    """
    interval = max(1, settings.reminder_dispatch_interval_seconds)
    while True:
        try:
            session_factory = get_session_factory()
            async with session_factory() as session:
                result = await run_due_sweep(session)
            if result.reminders_delivered or result.tasks_activated:
                logger.info(
                    "due sweep delivered %s reminder(s) and activated tasks for %s user(s)",
                    result.reminders_delivered,
                    result.tasks_activated,
                )
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("due sweep failed; will retry on the next interval")

        await asyncio.sleep(interval)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Run the due-work loop for as long as the app is serving.

    One loop per process is assumed. There is no deploy configuration in this
    repository, so a single process is the working assumption, but running two
    workers would deliver every reminder twice. Serialize this with a Postgres
    advisory lock before scaling out.
    """
    task = asyncio.create_task(_due_work_loop())
    try:
        yield
    finally:
        task.cancel()
        # Shielded so a slow sweep still gets its chance to unwind rather than
        # being torn down mid-delivery.
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=5)
        except (asyncio.CancelledError, asyncio.TimeoutError):
            pass


def create_application() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version=settings.app_version,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/", tags=["meta"])
    def read_root() -> dict[str, str]:
        return {
            "name": settings.app_name,
            "status": "ok",
            "version": settings.app_version,
        }

    app.include_router(api_router, prefix=settings.api_v1_prefix)
    return app


app = create_application()
