"""Encrypted-at-rest test credential storage, scoped per project (idea.md Section 3.3).

v1 storage is a single Fernet-encrypted JSON file. Values are never logged, never
included in an LLM prompt, and only ever decrypted at the point of injecting them
into a sandbox container as environment variables.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import BaseModel

DEFAULT_STORE_PATH = Path(
    os.environ.get("CREDENTIAL_STORE_PATH", Path(__file__).resolve().parents[3] / "artifacts" / "credentials.enc")
)


class ProjectCredentials(BaseModel):
    project: str
    test_user_email: str
    test_user_password: str


def _load_key() -> bytes:
    key = os.environ.get("CREDENTIAL_STORE_KEY")
    if not key:
        raise RuntimeError(
            "CREDENTIAL_STORE_KEY is not set. Generate one with "
            "`python -c \"from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())\"`"
        )
    return key.encode()


class CredentialStore:
    def __init__(self, path: Path = DEFAULT_STORE_PATH) -> None:
        self._path = path
        self._fernet = Fernet(_load_key())

    def _read_all(self) -> dict[str, dict[str, str]]:
        if not self._path.exists():
            return {}
        ciphertext = self._path.read_bytes()
        plaintext = self._fernet.decrypt(ciphertext)
        return json.loads(plaintext)

    def _write_all(self, data: dict[str, dict[str, str]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps(data).encode()
        ciphertext = self._fernet.encrypt(plaintext)
        self._path.write_bytes(ciphertext)

    def set(self, creds: ProjectCredentials) -> None:
        data = self._read_all()
        data[creds.project] = {
            "test_user_email": creds.test_user_email,
            "test_user_password": creds.test_user_password,
        }
        self._write_all(data)

    def get(self, project: str) -> ProjectCredentials | None:
        data = self._read_all()
        entry = data.get(project)
        if entry is None:
            return None
        return ProjectCredentials(project=project, **entry)

    def as_env(self, project: str) -> dict[str, str]:
        """Env vars to inject into the sandbox container at boot. Never logged."""
        creds = self.get(project)
        if creds is None:
            return {}
        return {
            "TEST_USER_EMAIL": creds.test_user_email,
            "TEST_USER_PASSWORD": creds.test_user_password,
        }
