"""Shared test configuration: sets a fixed AGENT_API_KEY for the whole test
session so the bearer-auth middleware (agent.api.auth) doesn't reject every
TestClient request — must be set before `agent.main` (and its middleware) is
imported by any test module."""

from __future__ import annotations

import os

# These use plain assignment, NOT setdefault. An inherited shell variable must
# never silently change what the suite tests: SANDBOX_MODE is exported by the
# docker-compose/development environment, and with setdefault that ambient value
# won over the test intent — so "unit" tests ran real `git worktree` checkouts
# and Docker boots against fake SHAs and failed with CheckoutError. Tests must
# be hermetic; make these authoritative for the process.
TEST_API_KEY = "test-agent-api-key"
os.environ["AGENT_API_KEY"] = TEST_API_KEY

# Unit/integration tests exercise pipeline *logic*, not real Docker-in-Docker
# sandbox isolation (that's covered separately by sandbox-specific tests that
# require an actual Docker daemon). Disable real sandboxing so the suite
# doesn't need Docker available to run.
os.environ["SANDBOX_MODE"] = "disabled"

# The agentic exploration session drives a real headless Chromium and spends
# LLM tokens per step. Tests mock the deterministic journey boundary instead, so
# leaving it on would make the suite depend on a browser plus live API keys (and
# bill for it). Its own logic is covered directly in
# tests/test_agent_navigation.py with a fake page and a fake model. Same
# rationale as SANDBOX_MODE above: authoritative for the process, not a default.
os.environ["AGENTIC_EXPLORATION"] = "disabled"

TEST_GITHUB_WEBHOOK_SECRET = "test-webhook-secret"
os.environ["GITHUB_WEBHOOK_SECRET"] = TEST_GITHUB_WEBHOOK_SECRET

AUTH_HEADERS = {"Authorization": f"Bearer {TEST_API_KEY}"}

# NOTE on database isolation
# --------------------------
# This suite must never read or write a real Supabase project. Dropping the
# SUPABASE_* variables here does NOT achieve that: `agent.config.load_env()` runs
# on import and repopulates them from `agent/.env`, which is exactly how the
# suite used to insert fixture runs into a live `runs` table.
#
# The enforced guard therefore lives at the single chokepoint every store goes
# through: `agent.db.supabase.get_supabase_client()` returns None whenever
# `_is_pytest()` is true, so all stores fall back to in-memory implementations.
# A test that genuinely needs a client must opt in explicitly with
# ALLOW_SUPABASE_WRITES_IN_TESTS=1 and its own throwaway project — see
# tests/test_db_test_isolation.py for both directions.
