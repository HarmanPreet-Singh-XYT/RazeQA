import os
from typing import Any

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from agent.api.analytics import router as analytics_router
from agent.api.artifacts import router as artifacts_router
from agent.api.auth import BearerAuthMiddleware
from agent.api.bridge import router as bridge_router
from agent.api.dashboard import router as dashboard_router
from agent.api.runs import router as runs_router
from agent.api.webhooks import router as webhooks_router

app = FastAPI(title="Autonomous PR Testing Engine")

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
async def internal_cleanup(max_age_seconds: float = 7 * 86400.0) -> dict[str, Any]:
    from agent.runner.retention import cleanup_local_artifacts
    purged = cleanup_local_artifacts(max_age_seconds=max_age_seconds)
    return {"status": "ok", "purged_directories": purged}

