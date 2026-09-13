"""Day 1 foundation smoke test: encrypted credentials -> sandbox spin-up ->
seeded login journey -> trace + video artifacts. Run with:

    uv run python scripts/day1_smoke.py
"""

from __future__ import annotations

import os
from pathlib import Path

from dotenv import load_dotenv

from agent.credentials.store import CredentialStore, ProjectCredentials
from agent.journeys.login import run_login_journey
from agent.sandbox.docker_sandbox import run_sandbox

REPO_ROOT = Path(__file__).resolve().parents[2]
ARTIFACTS_DIR = Path(__file__).resolve().parents[1] / "artifacts" / "day1-smoke"
PROJECT = "web"


def main() -> None:
    load_dotenv(Path(__file__).resolve().parents[1] / ".env")

    store = CredentialStore()
    if store.get(PROJECT) is None:
        store.set(
            ProjectCredentials(
                project=PROJECT,
                test_user_email="qa@example.com",
                test_user_password="changeme123",
            )
        )
    env = store.as_env(PROJECT)

    # The sandbox can only be built from a repo it clones itself, so point it at
    # this project's own origin. Override SMOKE_OWNER/SMOKE_REPO/SMOKE_SHA for
    # another target.
    owner = os.environ.get("SMOKE_OWNER", "local")
    repo = os.environ.get("SMOKE_REPO", PROJECT)
    sha = os.environ.get("SMOKE_SHA", "HEAD")
    base_ref = os.environ.get("SMOKE_BASE_REF", "main")

    print(f"[1/3] Booting sandbox container (clones {owner}/{repo}@{sha} in-container) ...")
    with run_sandbox(
        owner=owner,
        repo=repo,
        sha=sha,
        base_ref=base_ref,
        image_tag="pr-testing-sandbox-day1-smoke",
        env=env,
    ) as sandbox:
        print(f"      sandbox ready at {sandbox.base_url}")

        print("[2/3] Running seeded login journey ...")
        result = run_login_journey(
            base_url=sandbox.base_url,
            email=env["TEST_USER_EMAIL"],
            password=env["TEST_USER_PASSWORD"],
            artifacts_dir=ARTIFACTS_DIR,
        )

    print()
    print("passed:", result.passed)
    print("trace:", result.trace_path)
    print("video:", result.video_path)
    if result.error:
        print("error:", result.error)

    if not result.passed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
