"""Email notification tests: config, transport, templates, outbox and gating."""

from __future__ import annotations

from email.message import EmailMessage
from typing import ClassVar

import pytest

from agent.email import templates
from agent.email.client import send_email_sync
from agent.email.config import (
    EmailSettings,
    is_valid_address,
    load_email_settings,
    parse_address_list,
)
from agent.email.notifications import (
    _dispatch,
    notify_run_completed,
    send_test_email,
)
from agent.email.recipients import RecipientTarget, resolve_recipients
from agent.email.settings_store import NotificationSettingsStore
from agent.email.store import (
    STATUS_FAILED,
    STATUS_QUEUED,
    STATUS_SENT,
    EmailOutboxStore,
)
from agent.projects.notifications import (
    effective_notifications,
    filter_findings,
    merge_notification_dicts,
    parse_notifications,
    parse_personal_settings,
)


def make_settings(**overrides) -> EmailSettings:
    base = {
        "host": "smtp.example.com",
        "port": 587,
        "username": "",
        "password": "",
        "sender": "razeqa@example.com",
        "sender_name": "RazeQA",
        "reply_to": "",
        "use_tls": False,
        "starttls": True,
        "timeout": 5.0,
        "enabled": True,
        "global_recipients": (),
        "global_recipients_only": False,
        "max_attempts": 3,
        "retry_interval_s": 60.0,
        "dashboard_url": "https://razeqa.example.com",
    }
    base.update(overrides)
    return EmailSettings(**base)


# --- config -----------------------------------------------------------------


def test_parse_address_list_dedupes_and_splits():
    assert parse_address_list("a@x.com, b@x.com;c@x.com\na@x.com") == [
        "a@x.com",
        "b@x.com",
        "c@x.com",
    ]


@pytest.mark.parametrize(
    "address,expected",
    [
        ("qa@example.com", True),
        ("qa@localhost", False),
        ("no-at-sign", False),
        ("a@b", False),
        ("bad\n@example.com", False),
        ("two@at@example.com", False),
        ("", False),
    ],
)
def test_is_valid_address(address, expected):
    assert is_valid_address(address) is expected


def test_load_email_settings_from_env(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.test")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.setenv("SMTP_FROM", "notify@test.dev")
    monkeypatch.setenv("SMTP_USE_TLS", "true")
    monkeypatch.setenv("NOTIFY_EMAIL_TO", "a@test.dev,b@test.dev")
    settings = load_email_settings()
    assert settings.configured
    assert settings.active
    assert settings.port == 465
    assert settings.use_tls is True
    # Implicit TLS turns STARTTLS off by default (doing both is an error).
    assert settings.starttls is False
    assert settings.global_recipients == ("a@test.dev", "b@test.dev")
    # The password is never exposed in the public description.
    assert "password" not in settings.public_dict()


def test_email_not_configured_without_host(monkeypatch):
    for name in ("SMTP_HOST", "SMTP_FROM", "SMTP_USERNAME"):
        monkeypatch.delenv(name, raising=False)
    settings = load_email_settings()
    assert settings.configured is False
    assert settings.active is False


# --- templates --------------------------------------------------------------


def test_templates_escape_html():
    rendered = templates.render(
        "run_completed",
        {
            "repo_full_name": "acme/<script>alert(1)</script>",
            "branch": "main",
            "status": "failure",
            "findings": [
                {"severity": "critical", "title": "<img src=x onerror=alert(1)>"}
            ],
            "dashboard_url": "https://razeqa.example.com",
        },
    )
    assert "<script>" not in rendered.html
    assert "&lt;script&gt;" in rendered.html
    assert "<img" not in rendered.html
    # The plain-text twin is not escaped.
    assert "<img src=x onerror=alert(1)>" in rendered.text


@pytest.mark.parametrize("kind", sorted(templates.RENDERERS))
def test_every_template_renders(kind):
    rendered = templates.render(
        kind,
        {
            "repo_full_name": "acme/web",
            "repo": "acme/web",
            "run_id": "run-1",
            "branch": "main",
            "status": "failure",
            "settings": {"host": "smtp"},
        },
    )
    assert rendered.subject
    assert rendered.text
    assert rendered.html.startswith("<!doctype html>")


def test_unknown_template_raises():
    with pytest.raises(KeyError):
        templates.render("nope", {})


# --- preferences ------------------------------------------------------------


def test_parse_notifications_defaults_and_overrides():
    default = parse_notifications({"automation": {"mode": "active"}})
    assert default.enabled is True
    assert default.wants("run_completed")
    assert default.min_severity == "high"

    parsed = parse_notifications(
        {
            "notifications": {
                "enabled": False,
                "recipients": "a@b.com, bad",
                "events": {"run_completed": False},
                "min_severity": "not-a-level",
            }
        }
    )
    assert parsed.enabled is False
    assert parsed.recipients == ("a@b.com",)
    assert parsed.events["run_completed"] is False
    # An unrecognised severity falls back rather than disabling alerts.
    assert parsed.min_severity == "high"


def test_filter_findings_respects_floor_and_dedupes():
    policy = parse_notifications({"notifications": {"min_severity": "high"}})
    findings = [
        {"severity": "low", "title": "cosmetic", "fingerprint": "a"},
        {"severity": "critical", "title": "auth bypass", "fingerprint": "b"},
        {"severity": "critical", "title": "auth bypass dup", "fingerprint": "b"},
        {"severity": "medium", "title": "wobble", "fingerprint": "c"},
    ]
    selected = filter_findings(findings, policy)
    assert [f["fingerprint"] for f in selected] == ["b"]


# --- transport --------------------------------------------------------------


class _FakeSMTP:
    instances: ClassVar[list[_FakeSMTP]] = []

    def __init__(self, host, port, timeout=None, context=None):
        self.host = host
        self.port = port
        self.started_tls = False
        self.logged_in = None
        self.sent: list[tuple[EmailMessage, str, list[str]]] = []
        _FakeSMTP.instances.append(self)

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def ehlo(self):
        return (250, b"ok")

    def starttls(self, context=None):
        self.started_tls = True

    def login(self, username, password):
        self.logged_in = (username, password)

    def send_message(self, message, from_addr=None, to_addrs=None):
        self.sent.append((message, from_addr, list(to_addrs or [])))


def test_send_email_sync_uses_starttls_and_skips_login_without_username(monkeypatch):
    _FakeSMTP.instances.clear()
    monkeypatch.setattr("agent.email.client.smtplib.SMTP", _FakeSMTP)

    result = send_email_sync(
        make_settings(),
        to=["qa@example.com"],
        subject="hi",
        text="body",
    )

    assert result.ok is True
    server = _FakeSMTP.instances[-1]
    assert server.started_tls is True
    assert server.logged_in is None
    assert server.sent and server.sent[0][1] == "razeqa@example.com"


def test_send_email_sync_rejects_malformed_recipients(monkeypatch):
    _FakeSMTP.instances.clear()
    monkeypatch.setattr("agent.email.client.smtplib.SMTP", _FakeSMTP)

    result = send_email_sync(
        make_settings(),
        to=["bad\n@example.com"],
        subject="hi",
        text="body",
    )

    assert result.ok is False
    assert "no valid recipients" in (result.error or "")


def test_send_email_sync_unconfigured_does_not_raise():
    result = send_email_sync(
        make_settings(host=""),
        to=["qa@example.com"],
        subject="hi",
        text="body",
    )
    assert result.ok is False
    assert "not configured" in (result.error or "")


# --- outbox -----------------------------------------------------------------


def test_outbox_enqueue_deduplicates_and_tracks_status():
    store = EmailOutboxStore(client=None)
    row = store.enqueue(
        kind="run_completed",
        subject="s",
        body_text="t",
        body_html="<p>t</p>",
        recipients=["a@b.com"],
        dedupe_key="run-1",
    )
    assert row is not None
    assert row["status"] == STATUS_QUEUED

    duplicate = store.enqueue(
        kind="run_completed",
        subject="s",
        body_text="t",
        body_html="<p>t</p>",
        recipients=["a@b.com"],
        dedupe_key="run-1",
    )
    assert duplicate is None
    assert len(store.list_messages()) == 1

    store.mark_sent(row["id"], "<msg@id>")
    sent = store.list_messages(status=STATUS_SENT)
    assert len(sent) == 1
    assert sent[0]["provider_message_id"] == "<msg@id>"


def test_outbox_retry_resets_a_failed_message():
    store = EmailOutboxStore(client=None)
    row = store.enqueue(
        kind="test",
        subject="s",
        body_text="t",
        body_html=None,
        recipients=["a@b.com"],
    )
    assert row is not None
    store.mark_failed(row["id"], "relay down", attempts=1)
    assert store.list_messages(status=STATUS_FAILED)
    # A failed message with attempts left is eligible after its backoff; backoff
    # for attempt 1 is 30s, so force it due by rewinding updated_at.
    from datetime import UTC, datetime, timedelta

    store._memory[0]["updated_at"] = (
        datetime.now(UTC) - timedelta(hours=1)
    ).isoformat()
    assert store.due_messages(max_attempts=3)
    assert store.retry(row["id"]) is True
    assert store.list_messages(status=STATUS_QUEUED)


# --- recipient resolution ---------------------------------------------------


class _FakeQuery:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        class _Res:
            data = self._rows

        return _Res()


class _FakeAuthAdmin:
    def get_user_by_id(self, uid):
        class _User:
            email = f"owner-{uid}@example.com"

        class _Res:
            user = _User()

        return _Res()


class _FakeClient:
    def __init__(self, project, team):
        self._project = project
        self._team = team
        self.auth = type("Auth", (), {"admin": _FakeAuthAdmin()})()

    def table(self, name):
        if name == "projects":
            return _FakeQuery([self._project] if self._project else [])
        if name == "installations":
            return _FakeQuery([{"account_login": "acme"}] if self._project else [])
        if name == "team_members":
            return _FakeQuery(self._team)
        return _FakeQuery([])


def test_resolve_recipients_uses_team_owner_and_global(monkeypatch):
    project = {
        "id": "p1",
        "user_id": "u1",
        "installation_id": 42,
        "repo_full_name": "acme/web",
        "settings": {},
    }
    client = _FakeClient(project, [{"email": "dev@acme.com"}])
    monkeypatch.setattr("agent.email.recipients._admin_client", lambda: client)
    settings = make_settings(global_recipients=("inbox@acme.com",))

    recipients = resolve_recipients(
        repo_full_name="acme/web",
        explicit=["lead@acme.com", "dev@acme.com"],
        settings=settings,
    )

    assert recipients == [
        "lead@acme.com",
        "dev@acme.com",
        "owner-u1@example.com",
        "inbox@acme.com",
    ]


def test_resolve_recipients_global_only_replaces_project_recipients(monkeypatch):
    client = _FakeClient(
        {"id": "p1", "user_id": "u1", "installation_id": 42, "settings": {}},
        [{"email": "dev@acme.com"}],
    )
    monkeypatch.setattr("agent.email.recipients._admin_client", lambda: client)
    settings = make_settings(
        global_recipients=("staging@acme.com",), global_recipients_only=True
    )
    recipients = resolve_recipients(
        repo_full_name="acme/web",
        explicit=["lead@acme.com"],
        settings=settings,
    )
    assert recipients == ["staging@acme.com", "lead@acme.com"]


# --- orchestration ----------------------------------------------------------


@pytest.mark.asyncio
async def test_dispatch_skips_when_email_disabled():
    result = await _dispatch(
        "run_completed",
        repo_full_name="acme/web",
        context={"repo_full_name": "acme/web"},
        settings=make_settings(enabled=False),
        store=EmailOutboxStore(client=None),
    )
    assert result["sent"] is False
    assert result["reason"] == "email disabled"


@pytest.mark.asyncio
async def test_dispatch_skips_when_no_recipients(monkeypatch):
    store = EmailOutboxStore(client=None)
    monkeypatch.setattr("agent.email.notifications.find_project", lambda *a, **k: None)
    monkeypatch.setattr(
        "agent.email.notifications.resolve_recipient_targets", lambda **kwargs: []
    )
    result = await _dispatch(
        "run_completed",
        repo_full_name="acme/web",
        context={"repo_full_name": "acme/web"},
        settings=make_settings(),
        store=store,
    )
    assert result["sent"] is False
    assert result["reason"] == "no recipients resolved"


@pytest.mark.asyncio
async def test_notify_run_completed_emails_and_deduplicates(monkeypatch):
    store = EmailOutboxStore(client=None)
    monkeypatch.setattr("agent.email.notifications.find_project", lambda *a, **k: None)
    monkeypatch.setattr(
        "agent.email.notifications.resolve_recipient_targets",
        lambda **kwargs: [RecipientTarget(email="qa@example.com")],
    )
    sent: list[dict] = []

    async def fake_send(settings, **kwargs):
        sent.append(kwargs)

        class _Result:
            ok = True
            message_id = "<id@test>"
            error = None

        return _Result()

    monkeypatch.setattr("agent.email.notifications.send_email", fake_send)

    first = await notify_run_completed(
        repo_full_name="acme/web",
        run_id="run-9",
        branch="main",
        status="failure",
        findings=[{"severity": "critical", "title": "boom", "fingerprint": "f1"}],
        store=store,
        settings=make_settings(),
    )
    assert first["run_completed"]["sent"] is True
    assert first["findings_alert"]["sent"] is True
    assert len(sent) == 2

    # Re-running the same run must not mail anyone twice.
    second = await notify_run_completed(
        repo_full_name="acme/web",
        run_id="run-9",
        branch="main",
        status="failure",
        findings=[{"severity": "critical", "title": "boom", "fingerprint": "f1"}],
        store=store,
        settings=make_settings(),
    )
    assert second["run_completed"].get("deduplicated") is True
    assert len(sent) == 2


@pytest.mark.asyncio
async def test_send_test_email_requires_configuration():
    result = await send_test_email("qa@example.com", settings=make_settings(host=""))
    assert result["sent"] is False
    assert "not configured" in result["reason"]


# --- API --------------------------------------------------------------------


@pytest.fixture
def client():
    from fastapi.testclient import TestClient

    from agent.main import app

    return TestClient(app)


def test_email_status_endpoint_requires_bearer(client):
    assert client.get("/email/status").status_code == 401


def test_email_status_endpoint_reports_configuration(client, monkeypatch):
    from conftest import AUTH_HEADERS

    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_FROM", "razeqa@example.com")
    res = client.get("/email/status?repo=acme/web", headers=AUTH_HEADERS)
    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is True
    assert "password" not in body
    assert "run_completed" in body["templates"]


def test_email_test_endpoint_is_503_without_smtp(client, monkeypatch):
    from conftest import AUTH_HEADERS

    for name in ("SMTP_HOST", "SMTP_FROM", "SMTP_USERNAME"):
        monkeypatch.delenv(name, raising=False)
    res = client.post("/email/test", headers=AUTH_HEADERS, json={})
    assert res.status_code == 503


def test_email_test_endpoint_rejects_bad_address(client, monkeypatch):
    from conftest import AUTH_HEADERS

    monkeypatch.setenv("SMTP_HOST", "smtp.example.com")
    monkeypatch.setenv("SMTP_FROM", "razeqa@example.com")
    res = client.post(
        "/email/test", headers=AUTH_HEADERS, json={"to": "not-an-address"}
    )
    assert res.status_code == 422


# --- workspace defaults & personal preferences ------------------------------


def test_merge_notification_dicts_is_field_level():
    base = {"enabled": True, "events": {"run_completed": True, "fix_published": True}}
    override = {"events": {"run_completed": False}}
    merged = merge_notification_dicts(base, override)
    assert merged["enabled"] is True
    assert merged["events"]["run_completed"] is False
    # A field the override did not mention survives, so adding defaults later
    # still reaches projects that already saved a partial blob.
    assert merged["events"]["fix_published"] is True


def test_effective_notifications_project_overrides_workspace_default():
    defaults = {"notifications": {"enabled": True, "min_severity": "critical"}}
    project = {"notifications": {"min_severity": "low"}}
    policy = effective_notifications(defaults, project)
    assert policy.min_severity == "low"
    assert policy.enabled is True

    # A project that saved nothing inherits the workspace default entirely.
    inherited = effective_notifications(defaults, {})
    assert inherited.min_severity == "critical"


def test_parse_personal_settings_defaults_to_everything_on():
    default = parse_personal_settings(None)
    assert default.enabled is True
    assert default.wants("findings_alert")

    opted_out = parse_personal_settings(
        {"enabled": True, "events": {"findings_alert": False}, "min_severity": "critical"}
    )
    assert opted_out.wants("findings_alert") is False
    assert opted_out.wants("run_completed") is True


def test_settings_store_round_trips_in_memory():
    store = NotificationSettingsStore(client=None)
    store.upsert_for_user("u1", defaults={"notifications": {"enabled": False}})
    assert store.get_defaults_for_user("u1") == {"notifications": {"enabled": False}}
    assert store.get_for_user("u1")["personal"] == {}

    store.upsert_for_user("u1", personal={"events": {"run_completed": False}})
    # The defaults blob was not resent, so it must be left untouched.
    assert store.get_defaults_for_user("u1") == {"notifications": {"enabled": False}}
    assert store.get_personal_for_user("u1") == {"events": {"run_completed": False}}


@pytest.mark.asyncio
async def test_dispatch_applies_workspace_defaults(monkeypatch):
    """A project with no settings inherits the owner's workspace default."""
    store = EmailOutboxStore(client=None)
    prefs = NotificationSettingsStore(client=None)
    prefs.upsert_for_user("u1", defaults={"notifications": {"enabled": False}})
    monkeypatch.setattr(
        "agent.email.notifications.find_project",
        lambda *a, **k: {"id": "p1", "user_id": "u1", "settings": {}},
    )
    monkeypatch.setattr(
        "agent.email.notifications.resolve_recipient_targets",
        lambda **kwargs: [RecipientTarget(email="qa@example.com")],
    )
    result = await _dispatch(
        "run_completed",
        repo_full_name="acme/web",
        context={"repo_full_name": "acme/web"},
        settings=make_settings(),
        store=store,
        settings_store=prefs,
    )
    assert result["sent"] is False
    assert result["reason"] == "disabled for this project"


@pytest.mark.asyncio
async def test_dispatch_honours_personal_opt_out(monkeypatch):
    """A recipient who turned the event off is dropped; others still receive it."""
    store = EmailOutboxStore(client=None)
    prefs = NotificationSettingsStore(client=None)
    prefs.upsert_for_user("u1", personal={"events": {"run_completed": False}})
    monkeypatch.setattr("agent.email.notifications.find_project", lambda *a, **k: None)
    monkeypatch.setattr(
        "agent.email.notifications.resolve_recipient_targets",
        lambda **kwargs: [
            RecipientTarget(email="opted-out@example.com", user_id="u1"),
            RecipientTarget(email="kept@example.com", user_id="u2"),
            RecipientTarget(email="explicit@example.com"),
        ],
    )
    delivered: list[str] = []

    async def fake_send(settings, **kwargs):
        delivered.extend(kwargs["to"])

        class _Result:
            ok = True
            message_id = "<id@test>"
            error = None

        return _Result()

    monkeypatch.setattr("agent.email.notifications.send_email", fake_send)

    result = await _dispatch(
        "run_completed",
        repo_full_name="acme/web",
        context={"repo_full_name": "acme/web"},
        settings=make_settings(),
        store=store,
        settings_store=prefs,
    )
    assert result["sent"] is True
    assert delivered == ["kept@example.com", "explicit@example.com"]


@pytest.mark.asyncio
async def test_dispatch_drops_everyone_when_all_opt_out(monkeypatch):
    store = EmailOutboxStore(client=None)
    prefs = NotificationSettingsStore(client=None)
    prefs.upsert_for_user("u1", personal={"enabled": False})
    monkeypatch.setattr("agent.email.notifications.find_project", lambda *a, **k: None)
    monkeypatch.setattr(
        "agent.email.notifications.resolve_recipient_targets",
        lambda **kwargs: [RecipientTarget(email="opted-out@example.com", user_id="u1")],
    )
    result = await _dispatch(
        "run_completed",
        repo_full_name="acme/web",
        context={"repo_full_name": "acme/web"},
        settings=make_settings(),
        store=store,
        settings_store=prefs,
    )
    assert result["sent"] is False
    assert result["reason"] == "no recipients resolved"


@pytest.mark.asyncio
async def test_personal_severity_floor_filters_alert_recipient(monkeypatch):
    """A user whose floor is critical is not woken for a high finding."""
    store = EmailOutboxStore(client=None)
    prefs = NotificationSettingsStore(client=None)
    prefs.upsert_for_user("u1", personal={"min_severity": "critical"})
    monkeypatch.setattr("agent.email.notifications.find_project", lambda *a, **k: None)
    monkeypatch.setattr(
        "agent.email.notifications.resolve_recipient_targets",
        lambda **kwargs: [RecipientTarget(email="strict@example.com", user_id="u1")],
    )
    result = await _dispatch(
        "findings_alert",
        repo_full_name="acme/web",
        context={"repo_full_name": "acme/web"},
        findings=[{"severity": "high", "title": "wobble", "fingerprint": "f1"}],
        settings=make_settings(),
        store=store,
        settings_store=prefs,
    )
    assert result["sent"] is False
    assert result["reason"] == "no recipients resolved"
