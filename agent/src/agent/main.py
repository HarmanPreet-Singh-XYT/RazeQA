from fastapi import FastAPI

from agent.api.bridge import router as bridge_router
from agent.api.dashboard import router as dashboard_router
from agent.api.runs import router as runs_router
from agent.api.webhooks import router as webhooks_router

app = FastAPI(title="Autonomous PR Testing Engine")

app.include_router(dashboard_router)
app.include_router(bridge_router)
app.include_router(runs_router)
app.include_router(webhooks_router)




@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}
