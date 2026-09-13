"""Secret-file support: Docker/K8s mount secrets as files, not env vars."""

from __future__ import annotations

import os
from pathlib import Path

from agent.config import SECRET_ENV_NAMES, load_secret_files

NAMES = ("AGENT_API_KEY", "CREDENTIAL_STORE_KEY", "GEMINI_API_KEY")


def test_secret_is_read_from_file(tmp_path: Path, monkeypatch):
    secret_file = tmp_path / "agent_api_key"
    secret_file.write_text("from-a-file\n")

    monkeypatch.delenv("AGENT_API_KEY", raising=False)
    monkeypatch.setenv("AGENT_API_KEY_FILE", str(secret_file))

    populated = load_secret_files(NAMES)

    assert populated == ["AGENT_API_KEY"]
    assert os.environ["AGENT_API_KEY"] == "from-a-file"


def test_explicit_env_var_wins_over_file(tmp_path: Path, monkeypatch):
    secret_file = tmp_path / "credential_key"
    secret_file.write_text("from-a-file")

    monkeypatch.setenv("CREDENTIAL_STORE_KEY", "explicit-value")
    monkeypatch.setenv("CREDENTIAL_STORE_KEY_FILE", str(secret_file))

    populated = load_secret_files(NAMES)

    assert "CREDENTIAL_STORE_KEY" not in populated
    assert os.environ["CREDENTIAL_STORE_KEY"] == "explicit-value"


def test_missing_file_is_ignored(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("AGENT_API_KEY", raising=False)
    monkeypatch.setenv("AGENT_API_KEY_FILE", str(tmp_path / "does-not-exist"))

    assert load_secret_files(NAMES) == []
    assert "AGENT_API_KEY" not in os.environ


def test_empty_file_does_not_set_an_empty_secret(tmp_path: Path, monkeypatch):
    secret_file = tmp_path / "empty"
    secret_file.write_text("   \n")

    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.setenv("GEMINI_API_KEY_FILE", str(secret_file))

    assert load_secret_files(NAMES) == []
    assert "GEMINI_API_KEY" not in os.environ


def test_no_file_variable_means_no_change(monkeypatch):
    monkeypatch.delenv("AGENT_API_KEY", raising=False)
    monkeypatch.delenv("AGENT_API_KEY_FILE", raising=False)
    assert load_secret_files(NAMES) == []


def test_multiline_pem_secret_survives_round_trip(tmp_path: Path, monkeypatch):
    pem = "-----BEGIN PRIVATE KEY-----\nABC\n-----END PRIVATE KEY-----"
    secret_file = tmp_path / "app.pem"
    secret_file.write_text(f"{pem}\n")

    monkeypatch.delenv("GITHUB_APP_PRIVATE_KEY", raising=False)
    monkeypatch.setenv("GITHUB_APP_PRIVATE_KEY_FILE", str(secret_file))

    assert load_secret_files(("GITHUB_APP_PRIVATE_KEY",)) == ["GITHUB_APP_PRIVATE_KEY"]
    assert os.environ["GITHUB_APP_PRIVATE_KEY"] == pem


def test_the_security_critical_secrets_are_covered():
    assert "CREDENTIAL_STORE_KEY" in SECRET_ENV_NAMES
    assert "AGENT_API_KEY" in SECRET_ENV_NAMES
    assert "GITHUB_WEBHOOK_SECRET" in SECRET_ENV_NAMES
