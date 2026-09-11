"""Shared test configuration: sets a fixed AGENT_API_KEY for the whole test
session so the bearer-auth middleware (agent.api.auth) doesn't reject every
TestClient request — must be set before `agent.main` (and its middleware) is
imported by any test module."""

from __future__ import annotations

import os

TEST_API_KEY = "test-agent-api-key"
os.environ.setdefault("AGENT_API_KEY", TEST_API_KEY)

# Unit/integration tests exercise pipeline *logic*, not real Docker-in-Docker
# sandbox isolation (that's covered separately by sandbox-specific tests that
# require an actual Docker daemon). Disable real sandboxing so the suite
# doesn't need Docker available to run.
os.environ.setdefault("SANDBOX_MODE", "disabled")

TEST_GITHUB_WEBHOOK_SECRET = "test-webhook-secret"
os.environ.setdefault("GITHUB_WEBHOOK_SECRET", TEST_GITHUB_WEBHOOK_SECRET)

AUTH_HEADERS = {"Authorization": f"Bearer {TEST_API_KEY}"}
