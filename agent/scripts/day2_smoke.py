"""Day 2 Coding Agent Bridge smoke test.

Validates the full Day 2 pipeline:
1. WebSocket intent streaming to backend platform.
2. Per-branch intent log persistence and retrieval.
3. Tool-use event capture (file touched, prompt summary, reasoning).
4. On-demand verification trigger from inside coding agent session.
5. SHA-based freshness checking and deduplication (cached vs. fresh runs).

Run with:
    uv run python scripts/day2_smoke.py
"""

from __future__ import annotations

import asyncio
import json
import threading
import time

import httpx
import uvicorn
import websockets

from agent.api.bridge import intent_store
from agent.api.runs import run_store
from agent.main import app

HOST = "127.0.0.1"
PORT = 8999
BASE_URL = f"http://{HOST}:{PORT}"
WS_URL = f"ws://{HOST}:{PORT}"
TEST_BRANCH = "feature/payment-validation"
COMMIT_SHA_1 = "4f8a7e3b91c0d2e5f6a8b7c9d0e1f2a3b4c5d6e7"
COMMIT_SHA_2 = "9a8b7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b"


class ServerThread(threading.Thread):
    def __init__(self) -> None:
        super().__init__(daemon=True)
        config = uvicorn.Config(app, host=HOST, port=PORT, log_level="warning")
        self.server = uvicorn.Server(config)

    def run(self) -> None:
        self.server.run()

    def stop(self) -> None:
        self.server.should_exit = True


def wait_for_server(url: str, timeout_s: float = 5.0) -> None:
    deadline = time.monotonic() + timeout_s
    while time.monotonic() < deadline:
        try:
            r = httpx.get(f"{url}/health", timeout=1.0)
            if r.status_code == 200:
                return
        except (httpx.HTTPError, OSError):
            time.sleep(0.1)
    raise TimeoutError(f"Server at {url} failed to start within {timeout_s}s")



async def async_smoke_flow() -> None:
    print(f"[1/5] Connecting to platform WebSocket at {WS_URL}/bridge/ws/{TEST_BRANCH} ...")
    ws_endpoint = f"{WS_URL}/bridge/ws/{TEST_BRANCH}"

    async with websockets.connect(ws_endpoint) as ws:
        print("[2/5] Streaming simulated Claude Code tool-use intent events ...")
        events = [
            {
                "files": ["components/payment-form.tsx"],
                "action": "edit",
                "prompt_summary": "Add credit card CVV field validation",
                "reasoning": "Form was submitting empty CVV strings to payment gateway",
                "branch": TEST_BRANCH,
                "sha": COMMIT_SHA_1,
            },
            {
                "files": ["lib/validation.ts"],
                "action": "create",
                "prompt_summary": "Extract Luhn algorithm and CVV regex checker",
                "reasoning": "Keep form component clean and testable in isolation",
                "branch": TEST_BRANCH,
                "sha": COMMIT_SHA_1,
            },
        ]

        for idx, event in enumerate(events, start=1):
            await ws.send(json.dumps(event))
            raw_ack = await ws.recv()
            ack = json.loads(raw_ack)
            assert ack.get("received") is True
            print(f"      Event {idx} acked: {ack.get('count')} total intent logs stored for branch '{TEST_BRANCH}'")

    print(f"[3/5] Querying per-branch intent log from {BASE_URL}/bridge/intents/{TEST_BRANCH} ...")
    async with httpx.AsyncClient() as client:
        res = await client.get(f"{BASE_URL}/bridge/intents/{TEST_BRANCH}")
        assert res.status_code == 200
        intents = res.json()
        assert len(intents) >= 2
        print(f"      Successfully retrieved {len(intents)} intent records:")
        for record in intents:
            print(f"      - [{record.get('action')}] {record.get('files')}: {record.get('prompt_summary')}")

        print(f"[4/5] Triggering on-demand check for SHA {COMMIT_SHA_1[:8]} (first time) ...")
        check1_res = await client.post(
            f"{BASE_URL}/runs",
            json={
                "branch": TEST_BRANCH,
                "sha": COMMIT_SHA_1,
                "scope": "changed",
                "test_type": "functional",
            },
        )
        assert check1_res.status_code == 200
        check1 = check1_res.json()
        print(f"      Status: {check1.get('status')}, Fresh: {check1.get('fresh')}, Run ID: {check1.get('run_id')}")
        assert check1["status"] == "queued"
        assert check1["fresh"] is True
        run_id = check1["run_id"]

        # Simulate engine completing the run
        print(f"      Simulating test execution completion for {run_id} ...")
        run_store.update(
            run_id=run_id,
            status="completed",
            result={"passed": True, "tested_surfaces": ["/login", "/dashboard", "/checkout"]},
            completed=True,
        )

        print(f"[5/5] Testing freshness check with identical SHA {COMMIT_SHA_1[:8]} (should dedup/cache) ...")
        check2_res = await client.post(
            f"{BASE_URL}/runs",
            json={
                "branch": TEST_BRANCH,
                "sha": COMMIT_SHA_1,
                "scope": "changed",
                "test_type": "functional",
            },
        )
        assert check2_res.status_code == 200
        check2 = check2_res.json()
        print(f"      Status: {check2.get('status')}, Fresh: {check2.get('fresh')}")
        print(f"      Message: {check2.get('message')}")
        assert check2["status"] == "cached"
        assert check2["fresh"] is False
        assert check2["run_id"] == run_id

        # Verify a new SHA triggers fresh run
        print(f"      Testing new SHA {COMMIT_SHA_2[:8]} (should enqueue fresh run) ...")
        check3_res = await client.post(
            f"{BASE_URL}/runs",
            json={
                "branch": TEST_BRANCH,
                "sha": COMMIT_SHA_2,
                "scope": "changed",
                "test_type": "functional",
            },
        )
        assert check3_res.status_code == 200
        check3 = check3_res.json()
        print(f"      Status: {check3.get('status')}, Fresh: {check3.get('fresh')}, New Run ID: {check3.get('run_id')}")
        assert check3["status"] == "queued"
        assert check3["fresh"] is True
        assert check3["run_id"] != run_id


def main() -> None:
    print("==================================================")
    print("      DAY 2 SMOKE TEST: CODING AGENT BRIDGE       ")
    print("==================================================")

    # Clean test branch state
    intent_store.clear(TEST_BRANCH)
    run_store.clear()

    server = ServerThread()
    server.start()
    try:
        wait_for_server(BASE_URL)
        asyncio.run(async_smoke_flow())
        print()
        print(">>> Day 2 smoke test passed successfully! <<<")
    finally:
        server.stop()


if __name__ == "__main__":
    main()
