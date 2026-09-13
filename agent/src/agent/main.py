import asyncio
import contextlib
import logging
import os
import sys
from typing import Any

from agent.config import load_env

# Ensure environment variables are loaded from .env if present
load_env()

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from agent.api.analytics import router as analytics_router
from agent.api.artifacts import router as artifacts_router
from agent.api.auth import BearerAuthMiddleware
from agent.api.bridge import router as bridge_router
from agent.api.copilot import router as copilot_router
from agent.api.dashboard import router as dashboard_router
from agent.api.github import router as github_router
from agent.api.review import router as review_router
from agent.api.runs import router as runs_router
from agent.api.webhooks import router as webhooks_router

logger = logging.getLogger("agent.main")


async def _retention_loop() -> None:
    """Periodically purge expired forensic artifacts.

    Retention was previously manual-only (`POST /internal/cleanup`), so the
    documented 7-day window was never actually enforced and artifacts
    accumulated indefinitely. Interval and max age are configurable; set
    RETENTION_CLEANUP_INTERVAL_SECONDS=0 to disable.
    """
    from agent.runner.retention import (
        cleanup_local_artifacts,
        cleanup_run_history,
        cleanup_supabase_artifacts,
    )

    try:
        interval = float(os.environ.get("RETENTION_CLEANUP_INTERVAL_SECONDS", 6 * 3600))
    except ValueError:
        interval = 6 * 3600
    try:
        max_age = float(os.environ.get("ARTIFACT_RETENTION_SECONDS", 7 * 86400))
    except ValueError:
        max_age = 7 * 86400
    try:
        run_history_age = float(os.environ.get("RUN_HISTORY_RETENTION_SECONDS", 0))
    except ValueError:
        run_history_age = 0.0

    if interval <= 0 or max_age <= 0:
        logger.info("Retention cleanup disabled (interval=%s, max_age=%s)", interval, max_age)
        return

    logger.info(
        "Retention cleanup active: purging artifacts older than %.0fs every %.0fs "
        "(run_history=%s)",
        max_age,
        interval,
        f"{run_history_age:.0f}s" if run_history_age > 0 else "kept",
    )
    while True:
        try:
            purged = await asyncio.to_thread(cleanup_local_artifacts, max_age)
            if purged:
                logger.info("Retention cleanup purged %d expired run director(ies)", purged)
            deleted = await asyncio.to_thread(cleanup_supabase_artifacts, max_age)
            if deleted:
                logger.info("Retention cleanup deleted %d expired artifact object(s)", deleted)
            if run_history_age > 0:
                removed = await asyncio.to_thread(cleanup_run_history, run_history_age)
                if removed:
                    logger.info("Retention cleanup purged %d run row(s)", removed)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            logger.exception("Retention cleanup pass failed")
        await asyncio.sleep(interval)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    task: asyncio.Task[None] | None = None
    # Never start the background loop under pytest: the suite constructs many
    # app instances, and an always-on sleeping task would add noise and
    # cross-test filesystem writes.
    if "pytest" not in sys.modules:
        task = asyncio.create_task(_retention_loop())
    try:
        yield
    finally:
        if task is not None:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task


app = FastAPI(title="Autonomous PR Testing Engine", lifespan=lifespan)

# Restrict cross-origin requests to explicitly configured origins (e.g. the
# Next.js dashboard's own origin). Empty by default — same-origin/server-side
# callers (the dashboard's server proxy, the CLI, GitHub) don't need CORS at all.
_allowed_origins = [o.strip() for o in os.environ.get("ALLOWED_ORIGINS", "").split(",") if o.strip()]
if _allowed_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_allowed_origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "DELETE"],
        allow_headers=["Authorization", "Content-Type"],
    )

app.add_middleware(BearerAuthMiddleware)

app.include_router(dashboard_router)
app.include_router(bridge_router)
app.include_router(runs_router)
app.include_router(webhooks_router)
app.include_router(artifacts_router)
app.include_router(analytics_router)
app.include_router(github_router)
app.include_router(copilot_router)
app.include_router(review_router)




@app.get("/ping")
@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "Healthy"}


@app.post("/invocations")
async def invocations(request: Request) -> dict[str, Any]:
    """Amazon Bedrock AgentCore invocation endpoint.

    Accepts structured task payloads from Bedrock AgentCore, dispatching
    diff analysis, journey runs, or fix synthesis accordingly.
    """
    try:
        body = await request.json()
    except Exception:
        body = {}

    action = body.get("action") or body.get("task") or "status"
    if action == "analyze_diff":
        from agent.analyzer.diff_analyzer import DiffAnalyzer
        diff = body.get("diff", "")
        analyzer = DiffAnalyzer()
        res = analyzer.analyze(diff, [])
        return {"status": "ok", "result": res.__dict__}

    return {"status": "ok", "message": "AgentCore invocation received", "received_action": action}


@app.post("/internal/cleanup")
async def internal_cleanup(
    max_age_seconds: float = 7 * 86400.0,
    include_storage: bool = True,
    run_history_max_age_seconds: float = 0.0,
) -> dict[str, Any]:
    from agent.runner.retention import (
        cleanup_local_artifacts,
        cleanup_run_history,
        cleanup_supabase_artifacts,
    )

    purged = cleanup_local_artifacts(max_age_seconds=max_age_seconds)
    deleted = (
        cleanup_supabase_artifacts(max_age_seconds=max_age_seconds)
        if include_storage
        else 0
    )
    # Opt-in: 0 (the default) leaves dashboard run history untouched.
    runs_purged = cleanup_run_history(max_age_seconds=run_history_max_age_seconds)
    return {
        "status": "ok",
        "purged_directories": purged,
        "deleted_objects": deleted,
        "purged_run_rows": runs_purged,
    }


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", 8000))
    host = os.environ.get("HOST", "0.0.0.0")
    uvicorn.run(
        "agent.main:app",
        host=host,
        port=port,
        reload=True,
        reload_dirs=["src"],
        reload_excludes=["artifacts/*", "*/artifacts/*", "**/artifacts/**"],
    )


