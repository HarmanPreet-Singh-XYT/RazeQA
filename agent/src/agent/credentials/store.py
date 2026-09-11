"""Encrypted-at-rest test credential storage, scoped per project (idea.md Section 3.3).

Supports multiple role-based test credentials (e.g. 'admin' vs 'user') per repository.
Values are never logged, never included in an LLM prompt, and only ever decrypted
at the point of injecting them into a sandbox container as environment variables.
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from pydantic import BaseModel, Field

DEFAULT_STORE_PATH = Path(
    os.environ.get("CREDENTIAL_STORE_PATH", Path(__file__).resolve().parents[3] / "artifacts" / "credentials.enc")
)


class RoleCredential(BaseModel):
    role: str  # e.g. "admin", "user", "editor", "guest"
    email: str
    password: str


class ProjectCredentials(BaseModel):
    project: str
    test_user_email: str
    test_user_password: str
    roles: dict[str, RoleCredential] = Field(default_factory=dict)


class CredentialDecryptionError(RuntimeError):
    """Raised when existing credentials file cannot be decrypted (e.g. wrong or rotated key)."""


def _load_key() -> bytes:
    key = os.environ.get("CREDENTIAL_STORE_KEY")
    if key:
        return key.encode()
    env = (os.environ.get("ENVIRONMENT") or os.environ.get("APP_ENV") or "").lower()
    if env in ("production", "prod"):
        raise RuntimeError(
            "CREDENTIAL_STORE_KEY environment variable is required in production environment; "
            "refusing to fall back to ephemeral local key file."
        )
    # Fallback for local development and testing: derive from local key file or use deterministic dev key
    key_file = DEFAULT_STORE_PATH.parent / ".credential_key"
    if key_file.exists():
        return key_file.read_bytes().strip()
    # Generate and persist local development key
    key_file.parent.mkdir(parents=True, exist_ok=True)
    new_key = Fernet.generate_key()
    key_file.write_bytes(new_key)
    return new_key


class CredentialStore:
    def __init__(self, path: Path = DEFAULT_STORE_PATH) -> None:
        self._path = path
        self._fernet = Fernet(_load_key())

    def _read_all(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        ciphertext = self._path.read_bytes()
        if not ciphertext.strip():
            return {}
        try:
            plaintext = self._fernet.decrypt(ciphertext)
            return json.loads(plaintext)
        except Exception as exc:
            raise CredentialDecryptionError(
                f"Failed to decrypt credentials from {self._path}. "
                "Ensure CREDENTIAL_STORE_KEY is configured correctly and matches the key used to encrypt the store."
            ) from exc

    def _write_all(self, data: dict[str, dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        plaintext = json.dumps(data).encode()
        ciphertext = self._fernet.encrypt(plaintext)
        self._path.write_bytes(ciphertext)

    def set(self, creds: ProjectCredentials) -> None:
        data = self._read_all()
        roles_payload = {
            r_name: {"role": r.role, "email": r.email, "password": r.password}
            for r_name, r in creds.roles.items()
        }
        data[creds.project] = {
            "test_user_email": creds.test_user_email,
            "test_user_password": creds.test_user_password,
            "roles": roles_payload,
        }
        self._write_all(data)

    def set_role(self, project: str, role: str, email: str, password: str) -> None:
        """Add or update a specific role credential for a project."""
        creds = self.get(project)
        if creds is None:
            creds = ProjectCredentials(
                project=project,
                test_user_email=email,
                test_user_password=password,
                roles={role: RoleCredential(role=role, email=email, password=password)},
            )
        else:
            creds.roles[role] = RoleCredential(role=role, email=email, password=password)
            if role in ("user", "default") or not creds.test_user_email:
                creds.test_user_email = email
                creds.test_user_password = password
        self.set(creds)

    def get(self, project: str) -> ProjectCredentials | None:
        data = self._read_all()
        entry = data.get(project)
        if entry is None:
            return None

        # Parse roles if present
        raw_roles = entry.get("roles", {})
        roles = {}
        for r_name, r_data in raw_roles.items():
            if isinstance(r_data, dict):
                roles[r_name] = RoleCredential(
                    role=r_data.get("role", r_name),
                    email=r_data.get("email", ""),
                    password=r_data.get("password", ""),
                )

        return ProjectCredentials(
            project=project,
            test_user_email=entry.get("test_user_email", ""),
            test_user_password=entry.get("test_user_password", ""),
            roles=roles,
        )

    def get_role(self, project: str, role: str | None = None) -> RoleCredential | None:
        """Retrieve credentials for a specific role (e.g. 'admin'), falling back to default test user."""
        creds = self.get(project)
        if not creds:
            return None
        if role and role in creds.roles:
            return creds.roles[role]
        # Default fallback
        return RoleCredential(
            role=role or "user",
            email=creds.test_user_email,
            password=creds.test_user_password,
        )

    def as_env(self, project: str, role: str | None = None) -> dict[str, str]:
        """Env vars to inject into the sandbox container at boot. Never logged."""
        role_cred = self.get_role(project, role=role)
        if not role_cred or not role_cred.email:
            return {}

        env = {
            "TEST_USER_EMAIL": role_cred.email,
            "TEST_USER_PASSWORD": role_cred.password,
            "TEST_USER_ROLE": role_cred.role,
        }

        # Also provide secondary role variables if available
        creds = self.get(project)
        if creds:
            if "admin" in creds.roles:
                env["TEST_ADMIN_EMAIL"] = creds.roles["admin"].email
                env["TEST_ADMIN_PASSWORD"] = creds.roles["admin"].password
            if "user" in creds.roles:
                env["TEST_REGULAR_USER_EMAIL"] = creds.roles["user"].email
                env["TEST_REGULAR_USER_PASSWORD"] = creds.roles["user"].password

        return env


default_credential_store = CredentialStore()
