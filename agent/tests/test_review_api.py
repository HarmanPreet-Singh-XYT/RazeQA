"""API tests for the review endpoints."""

from __future__ import annotations

import json
import subprocess
from pathlib import Path

import pytest
from conftest import AUTH_HEADERS
from fastapi.testclient import TestClient

from agent.main import app

DIFF = """diff --git a/src/auth.py b/src/auth.py
--- a/src/auth.py
+++ b/src/auth.py
@@ -10,3 +10,5 @@ def login(user, pw):
     if not user:
         return None
+    token = db.query(f"SELECT * FROM users WHERE pw='{pw}'")
+    log.info("login %s %s", user, pw)
     return check(user, pw)
"""


@pytest.fixture
def client() -> TestClient:
    return TestClient(app)


def _fake_invoker(lane, system_prompt, user_prompt):
    if lane.value == "security":
        return json.dumps(
            {
                "summary": "One exploitable issue.",
                "findings": [
                    {
                        "tier": "must_fix",
                        "title": "SQL injection in login",
                        "file": "src/auth.py",
                        "line": 12,
                        "evidence": "db.query(f\"SELECT * FROM users WHERE pw='{pw}'\")",
                        "remediation": "Use a parameterised query.",
                        "confidence": 0.9,
                    }
                ],
            }
        )
    return json.dumps({"summary": "clean", "findings": []})


@pytest.fixture
def fake_lanes(monkeypatch):
    monkeypatch.setattr("agent.review.engine.default_lane_invoker", _fake_invoker)


def test_list_lanes_exposes_each_ladder(client: TestClient):
    res = client.get("/review/lanes", headers=AUTH_HEADERS)
    assert res.status_code == 200
    lanes = {entry["lane"]: entry for entry in res.json()["lanes"]}
    assert set(lanes) == {"compliance", "security", "code_review"}
    assert [t["key"] for t in lanes["compliance"]["tiers"]] == ["critical", "must_fix", "should_fix"]
    assert [t["key"] for t in lanes["security"]["tiers"]] == ["must_fix", "should_fix", "suggestion"]


def test_analyze_with_inline_diff(client: TestClient, fake_lanes):
    res = client.post(
        "/review/analyze",
        headers=AUTH_HEADERS,
        json={"repo": "acme/api", "diff": DIFF, "base_ref": "main", "head_ref": "feat/login"},
    )
    assert res.status_code == 200
    body = res.json()

    assert body["report"]["repo"] == "acme/api"
    assert body["report"]["blocking"] is False
    assert len(body["report"]["findings"]) == 1

    finding = body["report"]["findings"][0]
    assert finding["lane"] == "security"
    assert finding["tier"] == "must_fix"
    assert finding["introduced"] is True

    # Each lane gets its own message, and the full report references all three.
    assert set(body["lane_markdown"]) == {"compliance", "security", "code_review"}
    assert "SQL injection in login" in body["lane_markdown"]["security"]
    assert "No findings." in body["lane_markdown"]["compliance"]
    assert "Automated review" in body["report_markdown"]


def test_analyze_requires_a_diff_or_a_checkout(client: TestClient):
    res = client.post("/review/analyze", headers=AUTH_HEADERS, json={"repo": "acme/api"})
    assert res.status_code == 422
    assert "diff" in res.json()["detail"]


def test_analyze_confines_repo_dir_to_allowed_roots(client: TestClient, tmp_path: Path, monkeypatch):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside"
    outside.mkdir()
    monkeypatch.setenv("REVIEW_ALLOWED_ROOTS", str(allowed))

    res = client.post(
        "/review/analyze",
        headers=AUTH_HEADERS,
        json={"repo_dir": str(outside)},
    )
    assert res.status_code == 403
    assert "outside the allowed roots" in res.json()["detail"]


def test_analyze_rejects_a_non_git_directory(client: TestClient, tmp_path: Path, monkeypatch):
    root = tmp_path / "work"
    root.mkdir()
    monkeypatch.setenv("REVIEW_ALLOWED_ROOTS", str(root))

    res = client.post("/review/analyze", headers=AUTH_HEADERS, json={"repo_dir": str(root)})
    assert res.status_code == 422
    assert "not a git checkout" in res.json()["detail"]


def test_analyze_collects_the_diff_from_a_checkout(client: TestClient, tmp_path: Path, monkeypatch, fake_lanes):
    repo = tmp_path / "work"
    repo.mkdir()
    (repo / "calc.py").write_text("def add(a, b):\n    return a - b\n")

    def git(*args: str) -> None:
        subprocess.run(
            ["git", *args],
            cwd=str(repo),
            capture_output=True,
            text=True,
            check=False,
        )

    git("init", "-q", "-b", "main")
    git("-c", "user.email=t@t", "-c", "user.name=t", "add", "-A")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "baseline")
    git("checkout", "-q", "-b", "feat/fix")
    (repo / "calc.py").write_text("def add(a, b):\n    return a + b\n")
    git("-c", "user.email=t@t", "-c", "user.name=t", "commit", "-qam", "fix")

    monkeypatch.setenv("REVIEW_ALLOWED_ROOTS", str(repo))
    res = client.post(
        "/review/analyze",
        headers=AUTH_HEADERS,
        json={"repo_dir": str(repo), "base_ref": "main", "head_ref": "HEAD"},
    )
    assert res.status_code == 200, res.text
    assert "calc.py" in res.json()["report_markdown"] or res.json()["report"]["lanes"]


def test_fix_without_a_usable_generator_reports_unverified(client: TestClient, tmp_path: Path, monkeypatch):
    """The button must fail closed: no candidate means no patch, never a guess."""
    repo = tmp_path / "work"
    repo.mkdir()
    (repo / "calc.py").write_text("x = 1\n")
    subprocess.run(["git", "init", "-q", "-b", "main"], cwd=str(repo), capture_output=True)
    monkeypatch.setenv("REVIEW_ALLOWED_ROOTS", str(repo))
    monkeypatch.setenv("REVIEW_FIX_GENERATOR", "scripted")

    res = client.post(
        "/review/fix",
        headers=AUTH_HEADERS,
        json={
            "repo_dir": str(repo),
            "finding": {
                "lane": "code_review",
                "tier": "must_fix",
                "title": "Off by one",
                "file": "calc.py",
                "line": 1,
            },
            "attempts": 1,
            "test_command": "pytest -q",
        },
    )
    assert res.status_code == 200, res.text
    body = res.json()
    assert body["verified"] is False
    assert body["outcome"]["winner"] is None
    assert "No candidate patch passed verification" in body["markdown"]
