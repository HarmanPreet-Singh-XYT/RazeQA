"""Cancellation of running jobs/runs, vision-call retry, and trace capture flags."""

from __future__ import annotations

import asyncio
from unittest.mock import MagicMock

import pytest
from conftest import AUTH_HEADERS
from fastapi.testclient import TestClient

from agent.api.runs import run_store
from agent.journeys import element_vision
from agent.journeys.element_vision import ElementVisionResult, inspect_element_visually
from agent.journeys.trace_config import start_trace, trace_screenshots, trace_sources
from agent.main import app
from agent.runner.queue import JobQueue


@pytest.fixture
def client():
    return TestClient(app)


@pytest.mark.asyncio
async def test_cancel_job_stops_a_running_job():
    queue = JobQueue(max_concurrent=2)
    started = asyncio.Event()

    async def long_pipeline(job):
        started.set()
        await asyncio.sleep(30)
        return {"status": "success"}

    job = await queue.submit_job("owner/repo", "feat/cancel", "sha1", long_pipeline)
    await asyncio.wait_for(started.wait(), timeout=2)

    assert queue.cancel_job(job.id, reason="Cancelled by user") is True
    assert job.status == "cancelled"
    assert job.error == "Cancelled by user"

    # The worker task must actually unwind, not linger until the pipeline ends.
    for _ in range(50):
        if job.id not in queue._running_tasks:
            break
        await asyncio.sleep(0.01)
    assert job.id not in queue._running_tasks

    # Cancelling again is a no-op, not a second cancellation.
    assert queue.cancel_job(job.id) is False


@pytest.mark.asyncio
async def test_cancel_job_by_run_resolves_push_style_run_id():
    queue = JobQueue(max_concurrent=2)
    started = asyncio.Event()

    async def long_pipeline(job):
        started.set()
        await asyncio.sleep(30)
        return {"status": "success"}

    job = await queue.submit_job(
        "owner/repo", "feat/push", "sha2", long_pipeline, run_id="run_abc123"
    )
    await asyncio.wait_for(started.wait(), timeout=2)

    assert queue.find_job_for_run("run_abc123") is job
    assert queue.cancel_job_by_run("run_abc123", reason="user") is True
    assert job.status == "cancelled"
    assert queue.cancel_job_by_run("unknown-run") is False


def test_cancel_run_endpoint_marks_run_cancelled(client):
    record = run_store.create(branch="feat/api-cancel", sha="cafe123")
    run_store.update(record.run_id, status="running")

    res = client.post(f"/runs/{record.run_id}/cancel", headers=AUTH_HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "cancelled"
    assert body["run_id"] == record.run_id
    assert run_store.get(record.run_id).status == "cancelled"


def test_cancel_run_endpoint_rejects_settled_run(client):
    record = run_store.create(branch="feat/api-done", sha="done123")
    run_store.update(record.run_id, status="completed", result={"status": "success"})

    res = client.post(f"/runs/{record.run_id}/cancel", headers=AUTH_HEADERS)
    assert res.status_code == 409


def test_cancel_run_endpoint_not_found(client):
    res = client.post("/runs/does-not-exist/cancel", headers=AUTH_HEADERS)
    assert res.status_code == 404


class _FlakyAgent:
    def __init__(self, failures: int, error: Exception) -> None:
        self.calls = 0
        self.failures = failures
        self.error = error

    def structured_output(self, schema, messages):
        self.calls += 1
        if self.calls <= self.failures:
            raise self.error
        return ElementVisionResult(looks_broken=True, confidence=0.91, reason="clipped")


def _vision_with(agent, monkeypatch):
    monkeypatch.setattr(element_vision, "has_api_key_for_role", lambda role: True)
    monkeypatch.setattr(element_vision, "create_strands_agent", lambda **kwargs: agent)
    monkeypatch.setattr(element_vision, "_crop_to_element", lambda page, locator, padding=8: b"png")
    monkeypatch.setattr(element_vision, "VISION_RETRY_BASE_DELAY_S", 0.0)


def test_element_vision_retries_transient_503(monkeypatch):
    agent = _FlakyAgent(
        failures=2,
        error=RuntimeError("503 UNAVAILABLE. {'code': 503, 'status': 'UNAVAILABLE'}"),
    )
    _vision_with(agent, monkeypatch)

    result = inspect_element_visually(MagicMock(), "[data-pr-testing-key=x]")
    assert result is not None
    assert result.looks_broken is True
    assert agent.calls == 3


def test_element_vision_does_not_retry_permanent_error(monkeypatch):
    agent = _FlakyAgent(failures=99, error=ValueError("schema mismatch"))
    _vision_with(agent, monkeypatch)

    result = inspect_element_visually(MagicMock(), "[data-pr-testing-key=y]")
    assert result is None
    assert agent.calls == 1


def test_trace_flags_are_configurable(monkeypatch):
    monkeypatch.setenv("PLAYWRIGHT_TRACE_SCREENSHOTS", "false")
    monkeypatch.setenv("PLAYWRIGHT_TRACE_SOURCES", "0")
    assert trace_screenshots() is False
    assert trace_sources() is False

    tracing = MagicMock()
    start_trace(tracing)
    tracing.start.assert_called_once_with(screenshots=False, snapshots=True, sources=False)
