"""Coding Agent Bridge: receives real-time intent events over WebSocket, keyed by branch."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from agent.bridge.models import FileIntentStore, IntentEvent

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/bridge", tags=["bridge"])
intent_store = FileIntentStore()


def get_intent_store() -> FileIntentStore:
    return intent_store


@router.websocket("/ws/{branch:path}")
async def intent_stream(websocket: WebSocket, branch: str) -> None:
    """Persistent WebSocket stream for real-time intent logging, keyed by branch."""
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

            intent_store.append(branch, event)
            events = intent_store.get(branch)
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
    events = intent_store.get(branch)
    return [e.model_dump() for e in events]


@router.delete("/intents/{branch:path}")
async def clear_intents(branch: str) -> dict[str, str]:
    """Clear intent timeline for a branch."""
    intent_store.clear(branch)
    return {"status": "cleared", "branch": branch}



@router.post("/events")
async def post_event(event: IntentEvent) -> dict[str, Any]:
    """HTTP endpoint to submit an intent event directly."""
    intent_store.append(event.branch, event)
    events = intent_store.get(event.branch)
    return {
        "received": True,
        "branch": event.branch,
        "count": len(events),
        "event": event.model_dump(),
    }
