"""Local CLI daemon for Coding Agent Bridge.

Maintains a persistent WebSocket connection to the PR Testing Engine platform,
captures intent events from coding agent tool hooks, and exposes on-demand
platform verification triggers.
"""

from __future__ import annotations

import asyncio
import json
import logging
import subprocess
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import quote_plus

import httpx
import uvicorn
import websockets
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("agent.bridge.daemon")


def get_git_branch(cwd: Path) -> str:
    """Resolve current git branch name with safe fallback."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "--abbrev-ref", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
        branch = res.stdout.strip()
        if branch and branch != "HEAD":
            return branch
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return "main"


def get_git_sha(cwd: Path) -> str:
    """Resolve current git commit SHA with safe fallback."""
    try:
        res = subprocess.run(
            ["git", "rev-parse", "HEAD"],
            cwd=cwd,
            capture_output=True,
            text=True,
            check=True,
        )
        sha = res.stdout.strip()
        if sha:
            return sha
    except (subprocess.SubprocessError, FileNotFoundError, OSError):
        pass
    return "0" * 40



class EmitEventRequest(BaseModel):
    files: list[str] = Field(default_factory=list)
    action: str = "edit"
    prompt_summary: str
    reasoning: str
    branch: str | None = None
    working_dir: str | None = None
    sha: str | None = None


class CheckRequest(BaseModel):
    branch: str | None = None
    sha: str | None = None
    scope: str = "changed"
    test_type: str = "functional"


class BridgeDaemon:
    def __init__(
        self,
        project_dir: Path,
        platform_url: str = "http://localhost:8000",
        local_host: str = "127.0.0.1",
        local_port: int = 8765,
    ) -> None:
        self.project_dir = project_dir.resolve()
        self.platform_url = platform_url.rstrip("/")
        self.local_host = local_host
        self.local_port = local_port

        # Derive ws base url
        if self.platform_url.startswith("https://"):
            self.ws_base_url = "wss://" + self.platform_url[8:]
        elif self.platform_url.startswith("http://"):
            self.ws_base_url = "ws://" + self.platform_url[7:]
        else:
            self.ws_base_url = self.platform_url

        self._running = False
        self._is_connected = False
        self._active_ws: Any = None
        self._ws_task: asyncio.Task[None] | None = None
        self._event_queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
        self._events_forwarded = 0
        self._events_dropped = 0

    @property
    def is_connected(self) -> bool:
        return self._is_connected

    async def _ws_client_loop(self) -> None:
        """Maintains persistent WebSocket connection to backend."""
        while self._running:
            branch = get_git_branch(self.project_dir)
            ws_url = f"{self.ws_base_url}/bridge/ws/{quote_plus(branch)}"
            try:
                logger.info("Connecting to platform bridge: %s", ws_url)
                async with websockets.connect(ws_url) as ws:
                    self._active_ws = ws
                    self._is_connected = True
                    logger.info("Connected to platform bridge on branch '%s'", branch)

                    # Drain queue
                    while self._running:
                        try:
                            # Wait for event to send, with timeout to keep alive
                            event_data = await asyncio.wait_for(self._event_queue.get(), timeout=2.0)
                            await ws.send(json.dumps(event_data))
                            ack = await asyncio.wait_for(ws.recv(), timeout=5.0)
                            logger.debug("Received ack from platform: %s", ack)
                            self._events_forwarded += 1
                        except TimeoutError:
                            # Ping/keepalive check
                            current_branch = get_git_branch(self.project_dir)
                            if current_branch != branch:
                                logger.info("Branch changed from '%s' to '%s', reconnecting...", branch, current_branch)
                                break
                            continue
            except Exception as exc:  # noqa: BLE001
                self._is_connected = False
                self._active_ws = None
                if self._running:
                    logger.warning("Bridge WebSocket disconnected (%s). Retrying in 2s...", exc)
                    await asyncio.sleep(2.0)


    async def emit_event(self, req: EmitEventRequest) -> dict[str, Any]:
        """Handles intent event: pushes via WebSocket or logs warning and drops if offline."""
        branch = req.branch or get_git_branch(self.project_dir)
        sha = req.sha or get_git_sha(self.project_dir)
        working_dir = req.working_dir or str(self.project_dir)

        payload = {
            "files": req.files,
            "action": req.action,
            "prompt_summary": req.prompt_summary,
            "reasoning": req.reasoning,
            "branch": branch,
            "working_dir": working_dir,
            "sha": sha,
            "timestamp": datetime.now(UTC).isoformat(),
        }

        if not self._is_connected:
            self._events_dropped += 1
            logger.warning(
                "Platform bridge unreachable. Intent event dropped for branch '%s' (always-online v1): %s",
                branch,
                req.prompt_summary,
            )
            return {
                "sent": False,
                "dropped": True,
                "warning": "Platform unreachable. Event dropped per always-online specification.",
                "branch": branch,
            }

        await self._event_queue.put(payload)
        return {
            "sent": True,
            "dropped": False,
            "branch": branch,
            "files": req.files,
            "prompt_summary": req.prompt_summary,
        }

    async def trigger_check(self, req: CheckRequest) -> dict[str, Any]:
        """Calls platform /runs API with current branch and SHA to trigger or return cached run."""
        branch = req.branch or get_git_branch(self.project_dir)
        sha = req.sha or get_git_sha(self.project_dir)

        payload = {
            "branch": branch,
            "sha": sha,
            "scope": req.scope,
            "test_type": req.test_type,
        }

        async with httpx.AsyncClient(timeout=10.0) as client:
            try:
                res = await client.post(f"{self.platform_url}/runs", json=payload)
                res.raise_for_status()
                return res.json()
            except httpx.HTTPError as exc:
                raise HTTPException(status_code=502, detail=f"Failed to reach platform at {self.platform_url}: {exc}")

    def create_api(self) -> FastAPI:
        @asynccontextmanager
        async def lifespan(app: FastAPI):
            self._running = True
            self._ws_task = asyncio.create_task(self._ws_client_loop())
            try:
                yield
            finally:
                self._running = False
                if self._ws_task:
                    self._ws_task.cancel()
                    try:
                        await self._ws_task
                    except asyncio.CancelledError:
                        pass

        app = FastAPI(title="Local Coding Agent Bridge Daemon", lifespan=lifespan)

        @app.get("/status")
        async def status() -> dict[str, Any]:
            branch = get_git_branch(self.project_dir)
            sha = get_git_sha(self.project_dir)
            return {
                "running": self._running,
                "connected": self._is_connected,
                "platform_url": self.platform_url,
                "branch": branch,
                "sha": sha,
                "project_dir": str(self.project_dir),
                "events_forwarded": self._events_forwarded,
                "events_dropped": self._events_dropped,
            }

        @app.post("/event")
        async def post_event(req: EmitEventRequest) -> dict[str, Any]:
            return await self.emit_event(req)

        @app.post("/check")
        async def post_check(req: CheckRequest) -> dict[str, Any]:
            return await self.trigger_check(req)

        return app

    def run(self) -> None:
        """Runs the daemon synchronously using uvicorn."""
        app = self.create_api()
        uvicorn.run(app, host=self.local_host, port=self.local_port, log_level="info")
