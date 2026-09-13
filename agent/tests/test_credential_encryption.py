"""Credential store encryption: AES-256-GCM with a legacy Fernet migration path."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from cryptography.fernet import Fernet

from agent.credentials.store import (
    AES_GCM_PREFIX,
    CredentialStore,
    ProjectCredentials,
    _default_key_path,
    _load_key,
)

TEST_KEY = Fernet.generate_key().decode()


@pytest.fixture
def store(tmp_path: Path, monkeypatch) -> CredentialStore:
    monkeypatch.setenv("CREDENTIAL_STORE_KEY", TEST_KEY)
    return CredentialStore(path=tmp_path / "credentials.enc")


def test_round_trip_uses_aes_gcm(store: CredentialStore):
    store.set(
        ProjectCredentials(
            project="acme/app",
            test_user_email="qa@example.com",
            test_user_password="s3cret",
        )
    )

    raw = (store._path).read_bytes()
    assert raw.startswith(AES_GCM_PREFIX)
    # Fernet ciphertext (the legacy format) starts with the base64 token version
    # byte 0x80 -> "gAAAAA". The new format must not be that.
    assert not raw.startswith(b"gAAAAA")

    loaded = store.get("acme/app")
    assert loaded is not None
    assert loaded.test_user_email == "qa@example.com"
    assert loaded.test_user_password == "s3cret"


def test_roles_round_trip(store: CredentialStore):
    store.set_role("acme/app", "admin", "admin@example.com", "adminpw")
    store.set_role("acme/app", "user", "user@example.com", "userpw")

    env = store.as_env("acme/app")
    assert env["TEST_ADMIN_EMAIL"] == "admin@example.com"
    assert env["TEST_REGULAR_USER_PASSWORD"] == "userpw"


def test_legacy_fernet_store_is_still_readable_and_upgraded(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CREDENTIAL_STORE_KEY", TEST_KEY)
    path = tmp_path / "credentials.enc"
    legacy_payload = {
        "acme/app": {
            "test_user_email": "old@example.com",
            "test_user_password": "oldpw",
            "roles": {},
        }
    }
    path.write_bytes(Fernet(TEST_KEY.encode()).encrypt(json.dumps(legacy_payload).encode()))

    store = CredentialStore(path=path)
    loaded = store.get("acme/app")
    assert loaded is not None
    assert loaded.test_user_email == "old@example.com"

    # Any subsequent write re-encrypts with AES-256-GCM.
    store.set_role("acme/app", "user", "new@example.com", "newpw")
    assert path.read_bytes().startswith(AES_GCM_PREFIX)
    assert store.get("acme/app").test_user_password == "newpw"


def test_wrong_key_raises_decryption_error(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("CREDENTIAL_STORE_KEY", TEST_KEY)
    path = tmp_path / "credentials.enc"
    CredentialStore(path=path).set(
        ProjectCredentials(project="p", test_user_email="a@b.c", test_user_password="x")
    )

    monkeypatch.setenv("CREDENTIAL_STORE_KEY", Fernet.generate_key().decode())
    from agent.credentials.store import CredentialDecryptionError

    with pytest.raises(CredentialDecryptionError):
        CredentialStore(path=path).get("p")


def test_default_key_path_is_outside_the_artifacts_dir(tmp_path: Path, monkeypatch):
    monkeypatch.delenv("CREDENTIAL_KEY_PATH", raising=False)
    monkeypatch.setattr(
        "agent.credentials.store.DEFAULT_STORE_PATH",
        tmp_path / "artifacts" / "credentials.enc",
    )
    key_path = _default_key_path()
    assert key_path == tmp_path / ".credential_key"
    assert "artifacts" not in key_path.parts


def test_production_requires_the_key_env(monkeypatch):
    monkeypatch.delenv("CREDENTIAL_STORE_KEY", raising=False)
    monkeypatch.setenv("ENVIRONMENT", "production")
    with pytest.raises(RuntimeError, match="CREDENTIAL_STORE_KEY"):
        _load_key()


def test_non_fernet_passphrase_is_accepted_for_aes(tmp_path: Path, monkeypatch):
    # A secret manager may hand back an arbitrary passphrase, not a Fernet key.
    monkeypatch.setenv("CREDENTIAL_STORE_KEY", "a-plain-passphrase")
    store = CredentialStore(path=tmp_path / "credentials.enc")
    store.set(ProjectCredentials(project="p", test_user_email="a@b.c", test_user_password="pw"))
    assert store.get("p").test_user_password == "pw"
    # Key derivation is deterministic, so a second instance opens it.
    assert CredentialStore(path=tmp_path / "credentials.enc").get("p") is not None
