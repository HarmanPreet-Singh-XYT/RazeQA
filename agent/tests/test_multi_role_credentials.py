"""Tests for multi-role test credentials (admin vs user) storage and resolution."""

from __future__ import annotations

from pathlib import Path

from agent.credentials.store import CredentialStore, ProjectCredentials, RoleCredential


def test_multi_role_credential_set_and_get(tmp_path: Path) -> None:
    store_file = tmp_path / "creds.enc"
    store = CredentialStore(path=store_file)

    # 1. Set default test user
    store.set(
        ProjectCredentials(
            project="acme/ecommerce",
            test_user_email="user@example.com",
            test_user_password="userpass123",
        )
    )

    # 2. Add an admin role
    store.set_role(
        project="acme/ecommerce",
        role="admin",
        email="admin@example.com",
        password="adminpass456",
    )

    # 3. Verify retrieval by role
    user_cred = store.get_role("acme/ecommerce", role="user")
    assert user_cred is not None
    assert user_cred.email == "user@example.com"
    assert user_cred.password == "userpass123"

    admin_cred = store.get_role("acme/ecommerce", role="admin")
    assert admin_cred is not None
    assert admin_cred.email == "admin@example.com"
    assert admin_cred.password == "adminpass456"

    # 4. Verify fallback for unknown role returns default user
    unknown_cred = store.get_role("acme/ecommerce", role="finance")
    assert unknown_cred is not None
    assert unknown_cred.email == "user@example.com"


def test_as_env_injects_roles(tmp_path: Path) -> None:
    store = CredentialStore(path=tmp_path / "creds.enc")
    store.set_role("acme/repo", "user", "regular@test.com", "pass1")
    store.set_role("acme/repo", "admin", "superadmin@test.com", "pass2")

    env_user = store.as_env("acme/repo", role="user")
    assert env_user["TEST_USER_EMAIL"] == "regular@test.com"
    assert env_user["TEST_ADMIN_EMAIL"] == "superadmin@test.com"
    assert env_user["TEST_USER_ROLE"] == "user"

    env_admin = store.as_env("acme/repo", role="admin")
    assert env_admin["TEST_USER_EMAIL"] == "superadmin@test.com"
    assert env_admin["TEST_USER_ROLE"] == "admin"
