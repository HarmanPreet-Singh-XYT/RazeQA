"""Bearer-token authentication for the agent API and WebSocket bridge.

The agent backend is a service-to-service API (called by the Next.js dashboard's
server-side proxy, the CLI daemon, and GitHub webhook delivery) — not a
user-facing API — so a single shared bearer token (AGENT_API_KEY) gates every
route rather than per-user sessions. GitHub webhook requests authenticate via
HMAC signature instead (see webhooks.py) and are exempted here.
"""

from __future__ import annotations

import hmac
import logging
import os

from fastapi import Request, WebSocket
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("agent.api.auth")

# Routes that authenticate themselves via a different mechanism (GitHub HMAC
# signature, AWS SigV4 gateway) or must be reachable for infra/AgentCore health checks.
EXEMPT_PATHS = {"/health", "/ping", "/invocations", "/webhooks/github"}


def _required_api_key() -> str | None:
    return os.environ.get("AGENT_API_KEY") or None


def is_authorized(header_value: str | None) -> bool:
    """Constant-time comparison of a provided `Authorization: Bearer <token>` value."""
    expected = _required_api_key()
    if not expected:
        # Fail closed: refuse to run without an API key configured, rather than
        # silently allowing unauthenticated access.
        return False
    if not header_value or not header_value.startswith("Bearer "):
        return False
    provided = header_value[len("Bearer ") :]
    return hmac.compare_digest(provided, expected)


class BearerAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if request.url.path in EXEMPT_PATHS:
            return await call_next(request)

        if not _required_api_key():
            logger.error(
                "AGENT_API_KEY is not configured; refusing request to %s. "
                "Set AGENT_API_KEY in the environment to enable the API.",
                request.url.path,
            )
            return JSONResponse(
                status_code=503,
                content={"detail": "Server misconfigured: AGENT_API_KEY is not set."},
            )

        if not is_authorized(request.headers.get("authorization")):
            return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

        return await call_next(request)


async def authorize_websocket(websocket: WebSocket) -> bool:
    """Authorize a WebSocket handshake via Authorization header or `token` query param.

    Browsers/simple WS clients can't always set custom headers, so a `?token=`
    query param is accepted as a fallback — same shared secret either way.
    """
    if not _required_api_key():
        logger.error("AGENT_API_KEY is not configured; refusing WebSocket connection.")
        return False

    header_value = websocket.headers.get("authorization")
    if is_authorized(header_value):
        return True

    token = websocket.query_params.get("token")
    if token:
        return hmac.compare_digest(token, _required_api_key() or "")

    return False
