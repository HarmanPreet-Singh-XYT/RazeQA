"""Encrypted-at-rest test credential storage, scoped per project (idea.md Section 3.3).

Supports multiple role-based test credentials (e.g. 'admin' vs 'user') per repository.
Values are never logged, never included in an LLM prompt, and only ever decrypted
at the point of injecting them into a sandbox container as environment variables.

Encryption
----------
Payloads are encrypted with **AES-256-GCM** (authenticated encryption) and the
file is tagged with a ``v2:`` marker. Files written before the upgrade are
legacy Fernet (AES-128-CBC + HMAC-SHA256); they remain readable so an existing
store survives, and are transparently re-encrypted as AES-256-GCM on the next
write.

Key management
--------------
The key comes from ``CREDENTIAL_STORE_KEY`` (any secret — a 32-byte urlsafe
base64 Fernet key is used directly, anything else is SHA-256 derived). In
production that variable is mandatory and there is no file fallback. Outside
production the key may live in ``CREDENTIAL_KEY_PATH`` (default
``<store dir>/../.credential_key``) — deliberately *not* beside the ciphertext
and not inside the retained artifacts volume.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
from typing import Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from pydantic import BaseModel, Field

DEFAULT_STORE_PATH = Path(
    os.environ.get("CREDENTIAL_STORE_PATH", Path(__file__).resolve().parents[3] / "artifacts" / "credentials.enc")
)

#: Marker identifying an AES-256-GCM payload written by this version.
AES_GCM_PREFIX = b"v2:"
_NONCE_BYTES = 12


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


def _is_production() -> bool:
    return (os.environ.get("ENVIRONMENT") or os.environ.get("APP_ENV") or "").lower() in ("production", "prod")


def _default_key_path() -> Path:
    """Local-development key file location.

    Deliberately outside the artifacts directory: that directory is the
    bind-mounted, retained forensic volume, so a key stored beside
    ``credentials.enc`` would defeat encryption-at-rest for anyone who obtains
    the volume. Production never reaches this path — it must supply
    ``CREDENTIAL_STORE_KEY``.
    """
    explicit = os.environ.get("CREDENTIAL_KEY_PATH")
    if explicit:
        return Path(explicit)
    return DEFAULT_STORE_PATH.parent.parent / ".credential_key"


def _legacy_key_path() -> Path:
    """Pre-upgrade key location, still honoured so an existing local key works."""
    return DEFAULT_STORE_PATH.parent / ".credential_key"


def _load_key() -> bytes:
    key = os.environ.get("CREDENTIAL_STORE_KEY")
    if key:
        return key.encode()
    if _is_production():
        raise RuntimeError(
            "CREDENTIAL_STORE_KEY environment variable is required in production environment; "
            "refusing to fall back to an ephemeral local key file."
        )
    for candidate in (_default_key_path(), _legacy_key_path()):
        if candidate.exists():
            return candidate.read_bytes().strip()
    # Generate and persist a local development key.
    key_file = _default_key_path()
    key_file.parent.mkdir(parents=True, exist_ok=True)
    new_key = Fernet.generate_key()
    key_file.write_bytes(new_key)
    try:
        key_file.chmod(0o600)
    except OSError:
        pass
    return new_key


def _aes256_key(configured: bytes) -> bytes:
    """Derive the 32-byte AES-256 key from the configured secret.

    A Fernet key already encodes 32 random bytes, so it is used directly to
    avoid a needless re-hash. Any other secret (e.g. a passphrase from a secret
    manager) is hashed with SHA-256.
    """
    try:
        decoded = base64.urlsafe_b64decode(configured)
        if len(decoded) == 32:
            return decoded
    except Exception:  # noqa: BLE001 - any malformed value falls back to hashing
        pass
    return hashlib.sha256(configured).digest()


class CredentialStore:
    def __init__(self, path: Path = DEFAULT_STORE_PATH) -> None:
        self._path = path
        self._configured_key = _load_key()
        self._aesgcm = AESGCM(_aes256_key(self._configured_key))
        # Built lazily: a non-Fernet secret (arbitrary passphrase) must not make
        # startup fail when there is no legacy data to read anyway.
        self._fernet: Fernet | None = None

    def _legacy_fernet(self) -> Fernet:
        if self._fernet is None:
            self._fernet = Fernet(self._configured_key)
        return self._fernet

    def _decrypt(self, ciphertext: bytes) -> dict[str, Any]:
        if ciphertext.startswith(AES_GCM_PREFIX):
            payload = base64.b64decode(ciphertext[len(AES_GCM_PREFIX) :])
            nonce, blob = payload[:_NONCE_BYTES], payload[_NONCE_BYTES:]
            plaintext = self._aesgcm.decrypt(nonce, blob, None)
        else:
            plaintext = self._legacy_fernet().decrypt(ciphertext)
        return json.loads(plaintext)

    def _read_all(self) -> dict[str, dict[str, Any]]:
        if not self._path.exists():
            return {}
        ciphertext = self._path.read_bytes()
        if not ciphertext.strip():
            return {}
        try:
            return self._decrypt(ciphertext)
        except Exception as exc:
            raise CredentialDecryptionError(
                f"Failed to decrypt credentials from {self._path}. "
                "Ensure CREDENTIAL_STORE_KEY is configured correctly and matches the key used to encrypt the store."
            ) from exc

    def _write_all(self, data: dict[str, dict[str, Any]]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        nonce = os.urandom(_NONCE_BYTES)
        blob = self._aesgcm.encrypt(nonce, json.dumps(data).encode(), None)
        self._path.write_bytes(AES_GCM_PREFIX + base64.b64encode(nonce + blob))
        try:
            self._path.chmod(0o600)
        except OSError:
            pass

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
        """Return env vars to inject into the sandbox container at boot. Never logged."""
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
