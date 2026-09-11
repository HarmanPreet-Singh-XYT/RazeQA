"""Coding Agent Bridge: receives real-time intent events over WebSocket, keyed by branch."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from agent.api.auth import authorize_websocket
from agent.bridge.models import IntentEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bridge", tags=["bridge"])


def get_intent_store() -> Any:
    # Resolved lazily (not at import time) so this always reflects the current
    # Supabase-or-file-fallback backend from agent.db.supabase, matching what
    # webhooks.py and pipeline.py read from. A previous version of this module
    # held its own separate FileIntentStore() instance, so intent events
    # captured here never reached Supabase even when it was configured, and
    # the pipeline/webhook code read from an entirely different, always-empty
    # store — a silent split-brain between intent capture and intent use.
    from agent.db.supabase import default_intent_store

    return default_intent_store


@router.websocket("/ws/{branch:path}")
async def intent_stream(websocket: WebSocket, branch: str) -> None:
    """Persistent WebSocket stream for real-time intent logging, keyed by branch."""
    if not await authorize_websocket(websocket):
        await websocket.close(code=4401, reason="Unauthorized")
        return
    await websocket.accept()
    logger.info("WebSocket connected for branch: %s", branch)
    try:
        while True:
            raw_event = await websocket.receive_json()
            if not isinstance(raw_event, dict):
                await websocket.send_json({"error": "Payload must be a JSON object"})
                continue

            if "branch" not in raw_event or not raw_event["branch"]:
                raw_event["branch"] = branch

            try:
                event = IntentEvent(**raw_event)
            except ValidationError as exc:
                await websocket.send_json({"error": "Invalid IntentEvent schema", "details": exc.errors()})
                continue

            get_intent_store().append(branch, event)
            events = get_intent_store().get(branch)
            await websocket.send_json(
                {
                    "received": True,
                    "branch": branch,
                    "count": len(events),
                    "event": event.model_dump(),
                }
            )
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for branch: %s", branch)
    except Exception:
        logger.exception("Unexpected error in websocket stream")



@router.get("/intents/{branch:path}")
async def get_intents(branch: str) -> list[dict[str, Any]]:
    """Retrieve full intent timeline for a branch."""
    events = get_intent_store().get(branch)
    return [e.model_dump() for e in events]


@router.delete("/intents/{branch:path}")
async def clear_intents(branch: str) -> dict[str, str]:
    """Clear intent timeline for a branch."""
    get_intent_store().clear(branch)
    return {"status": "cleared", "branch": branch}



@router.post("/events")
async def post_event(event: IntentEvent) -> dict[str, Any]:
    """HTTP endpoint to submit an intent event directly."""
    store = get_intent_store()
    store.append(event.branch, event)
    events = store.get(event.branch)
    return {
        "received": True,
        "branch": event.branch,
        "count": len(events),
        "event": event.model_dump(),
    }
