"""High-level notification orchestration.

This module is the single entry point the rest of the engine calls. It answers,
in order: *should this event produce an email? to whom? what does it say?* — and
then hands the result to the outbox and attempts delivery.

Everything it does is best-effort. Each public ``notify_*`` function catches its
own failures and returns a small result dict; none of them raise. That is the
contract that lets a pipeline call ``notify_run_completed`` on the critical path
without SMTP ever being able to fail a verification run.
"""

from __future__ import annotations

import logging
from typing import Any

from agent.analyzer.severity import highest_severity
from agent.email import templates
from agent.email.client import EmailResult, send_email
from agent.email.config import EmailSettings, load_email_settings
from agent.email.recipients import (
    RecipientTarget,
    find_project,
    resolve_recipient_targets,
)
from agent.email.settings_store import (
    NotificationSettingsStore,
    default_notification_settings_store,
)
from agent.email.store import EmailOutboxStore, default_email_outbox
from agent.projects.notifications import (
    NotificationSettings,
    effective_notifications,
    filter_findings,
    parse_personal_settings,
)

logger = logging.getLogger("agent.email.notifications")


def _skipped(reason: str, **extra: Any) -> dict[str, Any]:
    return {"sent": False, "reason": reason, **extra}


def _apply_personal_preferences(
    targets: list[RecipientTarget],
    *,
    kind: str,
    findings: list[dict[str, Any]],
    settings_store: NotificationSettingsStore,
) -> list[RecipientTarget]:
    """Drop recipients who have opted out of this event for themselves.

    Only targets with a known Supabase ``user_id`` can have a personal
    preference; explicit and ``NOTIFY_EMAIL_TO`` addresses are always kept,
    because a project deliberately listed them. For a findings alert, the
    recipient's own severity floor is compared against the most severe finding in
    the message: if nothing clears their floor, they are not woken up for it.
    """
    highest = highest_severity([f.get("severity") for f in findings]) if findings else None
    kept: list[RecipientTarget] = []
    for target in targets:
        if target.user_id:
            personal = parse_personal_settings(
                settings_store.get_personal_for_user(target.user_id)
            )
            if not personal.wants(kind):
                logger.debug("Recipient %s opted out of %s", target.email, kind)
                continue
            if highest is not None and not personal.allows_severity(highest):
                logger.debug(
                    "Recipient %s has a severity floor above %s", target.email, highest
                )
                continue
        kept.append(target)
    return kept


async def _deliver(
    message: dict[str, Any],
    *,
    settings: EmailSettings,
    store: EmailOutboxStore,
) -> dict[str, Any]:
    """Attempt delivery of one enqueued message and record the outcome."""
    message_id = message["id"]
    store.mark_sending(message_id)
    result: EmailResult = await send_email(
        settings,
        to=list(message.get("recipients") or []),
        cc=list(message.get("cc") or []),
        subject=message.get("subject") or "AutoQA notification",
        text=message.get("body_text") or "",
        html=message.get("body_html"),
    )
    if result.ok:
        store.mark_sent(message_id, result.message_id)
        return {"sent": True, "id": message_id, "messageId": result.message_id}

    attempts = int(message.get("attempts") or 0) + 1
    store.mark_failed(message_id, result.error or "send failed", attempts)
    logger.warning(
        "Email delivery failed (attempt %d) for %s: %s",
        attempts,
        message_id,
        result.error,
    )
    return {
        "sent": False,
        "id": message_id,
        "reason": result.error or "send failed",
        "attempts": attempts,
    }


async def _dispatch(
    kind: str,
    *,
    repo_full_name: str | None,
    context: dict[str, Any],
    dedupe_key: str | None = None,
    run_id: str | None = None,
    pr_number: int | None = None,
    findings: list[dict[str, Any]] | None = None,
    store: EmailOutboxStore | None = None,
    settings: EmailSettings | None = None,
    settings_store: NotificationSettingsStore | None = None,
) -> dict[str, Any]:
    """Render, enqueue and deliver one notification (or explain why not)."""
    outbox = store or default_email_outbox
    preferences = settings_store or default_notification_settings_store
    email_settings = settings or load_email_settings()
    if not email_settings.active:
        reason = (
            "email disabled" if not email_settings.enabled else "SMTP not configured"
        )
        logger.debug("Not sending %s email for %s: %s", kind, repo_full_name, reason)
        return _skipped(reason)

    client = getattr(outbox, "client", None)
    project = find_project(client, repo_full_name or "")
    # Workspace defaults under the project's own overrides.
    defaults = preferences.get_defaults_for_user((project or {}).get("user_id"))
    policy = effective_notifications(defaults, (project or {}).get("settings"))

    if not policy.wants(kind):
        return _skipped("disabled for this project")

    selected_findings = (
        filter_findings(findings or [], policy) if findings is not None else []
    )
    if kind == "findings_alert" and not selected_findings:
        return _skipped("no findings at or above the configured severity")

    targets = resolve_recipient_targets(
        repo_full_name=repo_full_name,
        explicit=list(policy.recipients),
        settings=email_settings,
        project=project,
    )
    targets = _apply_personal_preferences(
        targets, kind=kind, findings=selected_findings, settings_store=preferences
    )
    recipients = [target.email for target in targets]
    if not recipients:
        return _skipped("no recipients resolved")

    enriched = dict(context)
    enriched.setdefault("dashboard_url", email_settings.dashboard_url)
    enriched["findings"] = selected_findings

    try:
        rendered = templates.render(kind, enriched)
    except KeyError:
        logger.warning("No email template for kind %r", kind)
        return _skipped(f"unknown template: {kind}")

    row = outbox.enqueue(
        kind=kind,
        subject=rendered.subject,
        body_text=rendered.text,
        body_html=rendered.html,
        recipients=recipients,
        repo_full_name=repo_full_name,
        project_id=(project or {}).get("id"),
        run_id=run_id,
        pr_number=pr_number,
        dedupe_key=dedupe_key,
        metadata={"event": kind},
    )
    if row is None:
        return _skipped("already sent for this event", deduplicated=True)

    return await _deliver(row, settings=email_settings, store=outbox)


async def notify_run_completed(
    *,
    repo_full_name: str | None,
    run_id: str,
    branch: str,
    sha: str | None = None,
    status: str,
    risk_tag: str | None = None,
    journeys_executed: int | None = None,
    passed: int = 0,
    failed: int = 0,
    findings: list[dict[str, Any]] | None = None,
    pr_number: int | None = None,
    summary: str | None = None,
    store: EmailOutboxStore | None = None,
    settings: EmailSettings | None = None,
    settings_store: NotificationSettingsStore | None = None,
) -> dict[str, Any]:
    """Tell the watchers a verification finished.

    Also raises a ``findings_alert`` when the run produced a finding severe
    enough for the project's floor, so a red run and its cause arrive together
    instead of as two unrelated emails.
    """
    context = {
        "repo_full_name": repo_full_name,
        "run_id": run_id,
        "branch": branch,
        "sha": sha,
        "status": status,
        "risk_tag": risk_tag,
        "journeys_executed": journeys_executed,
        "passed": passed,
        "failed": failed,
        "pr_number": pr_number,
        "summary": summary,
    }
    results: dict[str, Any] = {}
    try:
        results["run_completed"] = await _dispatch(
            "run_completed",
            repo_full_name=repo_full_name,
            context=context,
            dedupe_key=f"run_completed:{run_id}",
            run_id=run_id,
            pr_number=pr_number,
            store=store,
            settings=settings,
            settings_store=settings_store,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("run_completed notification failed for %s: %s", run_id, exc)
        results["run_completed"] = _skipped(f"error: {exc}")

    if findings:
        try:
            results["findings_alert"] = await _dispatch(
                "findings_alert",
                repo_full_name=repo_full_name,
                context=context,
                dedupe_key=f"findings_alert:{run_id}",
                run_id=run_id,
                pr_number=pr_number,
                findings=findings,
                store=store,
                settings=settings,
                settings_store=settings_store,
            )
        except Exception as exc:  # noqa: BLE001
            logger.warning("findings_alert notification failed for %s: %s", run_id, exc)
            results["findings_alert"] = _skipped(f"error: {exc}")

    return results


async def notify_review_completed(
    *,
    repo: str | None,
    report: dict[str, Any],
    head_ref: str | None = None,
    store: EmailOutboxStore | None = None,
    settings: EmailSettings | None = None,
    settings_store: NotificationSettingsStore | None = None,
) -> dict[str, Any]:
    """Tell a repository's watchers that a three-lane review finished."""
    findings = report.get("findings") if isinstance(report, dict) else None
    total = len(findings or [])
    critical = sum(
        1
        for f in findings or []
        if str((f or {}).get("severity") or "").lower() == "critical"
    )
    lanes: list[dict[str, Any]] = []
    for lane in (report or {}).get("lanes") or []:
        if not isinstance(lane, dict):
            continue
        lanes.append(
            {
                "lane": lane.get("lane"),
                "label": lane.get("label"),
                "findings_count": len(lane.get("findings") or []),
                "headline": lane.get("summary"),
            }
        )
    context = {
        "repo": repo,
        "lanes": lanes,
        "total_findings": total,
        "critical_findings": critical,
    }
    dedupe = f"review_completed:{repo}:{head_ref or ''}:{total}:{critical}"
    try:
        return await _dispatch(
            "review_completed",
            repo_full_name=repo,
            context=context,
            dedupe_key=dedupe,
            store=store,
            settings=settings,
            settings_store=settings_store,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning("review_completed notification failed for %s: %s", repo, exc)
        return _skipped(f"error: {exc}")


async def notify_fix_published(
    *,
    repo_full_name: str | None,
    branch: str,
    pr_url: str | None,
    finding_title: str | None,
    store: EmailOutboxStore | None = None,
    settings: EmailSettings | None = None,
    settings_store: NotificationSettingsStore | None = None,
) -> dict[str, Any]:
    """Tell the watchers a verified fix became a branch/pull request."""
    context = {
        "repo_full_name": repo_full_name,
        "branch": branch,
        "pr_url": pr_url,
        "finding_title": finding_title,
    }
    dedupe = f"fix_published:{repo_full_name}:{branch}:{pr_url or ''}"
    try:
        return await _dispatch(
            "fix_published",
            repo_full_name=repo_full_name,
            context=context,
            dedupe_key=dedupe,
            store=store,
            settings=settings,
            settings_store=settings_store,
        )
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "fix_published notification failed for %s: %s", repo_full_name, exc
        )
        return _skipped(f"error: {exc}")


async def send_test_email(
    to: str | None = None,
    *,
    store: EmailOutboxStore | None = None,
    settings: EmailSettings | None = None,
) -> dict[str, Any]:
    """Send a diagnostic message, bypassing project preferences.

    ``to`` is validated by the transport; when omitted, the deployment-wide
    recipients are used (and the caller gets a clear error if there are none).
    """
    email_settings = settings or load_email_settings()
    if not email_settings.configured:
        return _skipped("SMTP is not configured")

    recipients = [to] if to else list(email_settings.global_recipients)
    if not recipients:
        return _skipped("no recipient given and NOTIFY_EMAIL_TO is unset")

    rendered = templates.render("test", {"settings": email_settings.public_dict()})
    result = await send_email(
        email_settings,
        to=recipients,
        subject=rendered.subject,
        text=rendered.text,
        html=rendered.html,
    )
    # A test send bypasses the outbox (it has no project to attach to), so the
    # outcome is returned directly. The caller surfaces the reason on failure.
    if result.ok:
        return {"sent": True, "messageId": result.message_id, "recipients": recipients}
    return _skipped(result.error or "send failed", recipients=recipients)


async def flush_outbox(
    *, limit: int = 20, store: EmailOutboxStore | None = None
) -> dict[str, Any]:
    """Attempt every due message. Used by the worker and by ``POST /email/flush``.

    Returns counts so a caller (or a test) can assert what happened rather than
    infer it from logs.
    """
    email_settings = load_email_settings()
    if not email_settings.configured:
        return {
            "delivered": 0,
            "failed": 0,
            "skipped": True,
            "reason": "SMTP is not configured",
        }

    outbox = store or default_email_outbox
    due = outbox.due_messages(limit=limit, max_attempts=email_settings.max_attempts)
    delivered = failed = 0
    for message in due:
        try:
            outcome = await _deliver(message, settings=email_settings, store=outbox)
        except Exception as exc:  # noqa: BLE001
            logger.warning("Outbox delivery crashed for %s: %s", message.get("id"), exc)
            outcome = {"sent": False}
        if outcome.get("sent"):
            delivered += 1
        else:
            failed += 1
    return {"delivered": delivered, "failed": failed, "skipped": False}


def notification_policy(repo_full_name: str | None) -> dict[str, Any]:
    """The effective policy for a repository, for display in the dashboard."""
    client = default_email_outbox.client
    project = find_project(client, repo_full_name or "")
    owner_id = (project or {}).get("user_id")
    defaults = default_notification_settings_store.get_defaults_for_user(owner_id)
    policy: NotificationSettings = effective_notifications(
        defaults, (project or {}).get("settings")
    )
    return {
        "repo_full_name": repo_full_name,
        "project_found": project is not None,
        "policy": policy.to_dict(),
        "workspace_defaults": defaults,
    }


def user_notification_settings(user_id: str | None) -> dict[str, Any]:
    """A user's workspace defaults and personal subscription, for the dashboard."""
    if not user_id:
        return {"defaults": {}, "personal": {}}
    return default_notification_settings_store.get_for_user(user_id)
