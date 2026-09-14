"""Notification email templates.

Kept as plain functions over a context dict, in one module, because the
templates and the triggers must stay in step: a field added to a run summary is
visible here immediately rather than buried in a half-dozen call sites.

Two rules are enforced here and nowhere else:

* **Everything interpolated is escaped.** Repository names, finding titles and
  remediation prose all originate from a model or a user, so an HTML part is
  built only through :func:`html.escape`. Plain text is never escaped.
* **Every HTML part has a plain-text twin.** A notification channel that renders
  as invisible markup in a terminal or a text-only client is not a notification.
"""

from __future__ import annotations

import html
from dataclasses import dataclass
from datetime import UTC, datetime

SEVERITY_ORDER = ("critical", "high", "medium", "low")

_SEVERITY_COLORS = {
    "critical": "#b91c1c",
    "high": "#c2410c",
    "medium": "#a16207",
    "low": "#475569",
}


@dataclass
class RenderedEmail:
    subject: str
    text: str
    html: str


def _esc(value: object) -> str:
    return html.escape(str(value if value is not None else ""))


def _link(url: str, label: str) -> str:
    if not url:
        return _esc(label)
    return f'<a href="{_esc(url)}" style="color:#1d4ed8;">{_esc(label)}</a>'


def _wrap(title: str, intro: str, body_rows: str, footer_url: str) -> str:
    cta = (
        f'<p style="margin:24px 0 0;"><a href="{_esc(footer_url)}" '
        'style="background:#0f172a;color:#ffffff;padding:10px 16px;border-radius:6px;'
        'text-decoration:none;font-weight:600;">Open in AutoQA</a></p>'
        if footer_url
        else ""
    )
    return (
        '<!doctype html><html><body style="margin:0;background:#f1f5f9;padding:24px;'
        'font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">'
        '<div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;'
        'border-radius:12px;padding:24px;">'
        f'<h1 style="margin:0 0 4px;font-size:18px;">{_esc(title)}</h1>'
        f'<p style="margin:0 0 16px;color:#475569;font-size:13px;">{intro}</p>'
        f"{body_rows}{cta}"
        '<p style="margin:24px 0 0;color:#94a3b8;font-size:11px;">'
        "Sent by AutoQA. Manage these notifications in Dashboard → Notifications."
        "</p></div></body></html>"
    )


def _summary_table(rows: list[tuple[str, str]]) -> str:
    cells = "".join(
        f'<tr><td style="padding:4px 12px 4px 0;color:#64748b;font-size:12px;">{_esc(k)}</td>'
        f'<td style="padding:4px 0;font-size:13px;font-weight:600;">{v}</td></tr>'
        for k, v in rows
    )
    return f'<table style="border-collapse:collapse;margin:8px 0 16px;">{cells}</table>'


def _findings_list(findings: list[dict]) -> str:
    if not findings:
        return ""
    items = []
    for finding in findings:
        severity = str(finding.get("severity") or "medium").lower()
        color = _SEVERITY_COLORS.get(severity, "#475569")
        route = finding.get("route") or ""
        route_html = (
            f' <span style="color:#94a3b8;">· {_esc(route)}</span>' if route else ""
        )
        items.append(
            '<li style="margin:0 0 8px;">'
            f'<span style="color:{color};font-weight:700;text-transform:uppercase;'
            f'font-size:11px;">{_esc(severity)}</span> '
            f'<span style="font-size:13px;">{_esc(finding.get("title") or "Finding")}</span>'
            f"{route_html}</li>"
        )
    return (
        '<p style="margin:16px 0 8px;font-size:13px;font-weight:700;">Findings</p>'
        f'<ul style="margin:0;padding-left:18px;">{"".join(items)}</ul>'
    )


def _status_color(status: str) -> str:
    return {"failure": "#b91c1c", "success": "#15803d", "inconclusive": "#a16207"}.get(
        status, "#334155"
    )


def _run_url(dashboard_url: str, run_id: str | None) -> str:
    if not dashboard_url or not run_id:
        return dashboard_url
    return f"{dashboard_url.rstrip('/')}/dashboard/runs/{run_id}"


def render_run_completed(ctx: dict) -> RenderedEmail:
    repo = ctx.get("repo_full_name") or "repository"
    branch = ctx.get("branch") or "main"
    status = str(ctx.get("status") or "unknown").lower()
    dashboard_url = ctx.get("dashboard_url") or ""
    run_url = _run_url(dashboard_url, ctx.get("run_id"))
    findings = ctx.get("findings") or []

    status_label = {
        "failure": "failed",
        "success": "passed",
        "inconclusive": "was inconclusive",
    }.get(status, status)
    subject = f"[AutoQA] Verification {status_label} — {repo} ({branch})"

    rows: list[tuple[str, str]] = [
        ("Repository", _esc(repo)),
        ("Branch", _esc(branch)),
        (
            "Status",
            f'<span style="color:{_status_color(status)};">{_esc(status_label.upper())}</span>',
        ),
    ]
    if ctx.get("sha"):
        rows.append(
            (
                "Commit",
                f'<code style="font-size:12px;">{_esc(str(ctx["sha"])[:12])}</code>',
            )
        )
    if ctx.get("pr_number"):
        rows.append(("Pull request", f"#{_esc(ctx['pr_number'])}"))
    if ctx.get("risk_tag"):
        rows.append(("Risk", _esc(ctx["risk_tag"])))
    if ctx.get("journeys_executed") is not None:
        rows.append(
            (
                "Journeys",
                "{} run · {} passed · {} failed".format(
                    _esc(ctx.get("journeys_executed", 0)),
                    _esc(ctx.get("passed", 0)),
                    _esc(ctx.get("failed", 0)),
                ),
            )
        )

    text_lines = [
        f"AutoQA verification {status_label} for {repo} ({branch}).",
        "",
    ]
    text_lines += [
        f"{k}: {v}"
        for k, v in (
            ("Commit", str(ctx.get("sha") or "")[:12]),
            ("Risk", ctx.get("risk_tag")),
            ("Journeys", ctx.get("journeys_executed")),
            ("Passed", ctx.get("passed")),
            ("Failed", ctx.get("failed")),
        )
        if v not in (None, "", 0)
    ]
    if findings:
        text_lines.append("")
        text_lines.append("Findings:")
        for finding in findings:
            text_lines.append(
                f"- [{str(finding.get('severity') or 'medium').upper()}] "
                f"{finding.get('title') or 'Finding'}"
            )
    if run_url:
        text_lines += ["", f"Open: {run_url}"]

    summary = ctx.get("summary")
    if summary:
        text_lines += ["", str(summary)]

    html = _wrap(
        f"Verification {status_label}",
        _esc(f"{repo} · {branch}"),
        _summary_table(rows) + _findings_list(findings),
        run_url,
    )
    return RenderedEmail(subject=subject, text="\n".join(text_lines), html=html)


def render_findings_alert(ctx: dict) -> RenderedEmail:
    repo = ctx.get("repo_full_name") or "repository"
    findings = ctx.get("findings") or []
    dashboard_url = ctx.get("dashboard_url") or ""
    run_url = _run_url(dashboard_url, ctx.get("run_id"))
    count = len(findings)
    noun = "finding" if count == 1 else "findings"
    highest = str((findings[0] if findings else {}).get("severity") or "high").lower()
    subject = f"[AutoQA] {count} new {highest} {noun} — {repo}"

    text_lines = [
        f"AutoQA recorded {count} new {noun} on {repo}.",
        "",
    ]
    for finding in findings:
        text_lines.append(
            f"- [{str(finding.get('severity') or 'high').upper()}] "
            f"{finding.get('title') or 'Finding'}"
            + (f" ({finding['route']})" if finding.get("route") else "")
        )
    if run_url:
        text_lines += ["", f"Open: {run_url}"]

    html = _wrap(
        f"{count} new {noun}",
        _esc(f"{repo} needs attention"),
        _findings_list(findings),
        run_url,
    )
    return RenderedEmail(subject=subject, text="\n".join(text_lines), html=html)


def render_review_completed(ctx: dict) -> RenderedEmail:
    repo = ctx.get("repo") or "repository"
    lanes = ctx.get("lanes") or []
    total = int(ctx.get("total_findings") or 0)
    critical = int(ctx.get("critical_findings") or 0)
    dashboard_url = ctx.get("dashboard_url") or ""
    noun = "finding" if total == 1 else "findings"
    subject = f"[AutoQA] Code review finished — {repo} ({total} {noun})"

    rows = [("Repository", _esc(repo))]
    for lane in lanes:
        rows.append(
            (
                lane.get("label") or lane.get("lane") or "Lane",
                f"{_esc(lane.get('findings_count', 0))} finding(s)"
                + (f" · {_esc(lane.get('headline'))}" if lane.get("headline") else ""),
            )
        )
    if critical:
        rows.append(
            (
                "Critical",
                f'<span style="color:{_SEVERITY_COLORS["critical"]};">{_esc(critical)}</span>',
            )
        )

    text_lines = [
        f"AutoQA finished a three-lane review of {repo}.",
        f"Total findings: {total} (critical: {critical})",
    ]
    for lane in lanes:
        text_lines.append(
            f"- {lane.get('label') or lane.get('lane')}: {lane.get('findings_count', 0)}"
        )
    if dashboard_url:
        text_lines += ["", f"Open: {dashboard_url}"]

    html = _wrap(
        "Code review finished",
        _esc(f"{repo} · {total} {noun}"),
        _summary_table(rows),
        dashboard_url,
    )
    return RenderedEmail(subject=subject, text="\n".join(text_lines), html=html)


def render_fix_published(ctx: dict) -> RenderedEmail:
    repo = ctx.get("repo_full_name") or "repository"
    branch = ctx.get("branch") or "review-fix"
    pr_url = ctx.get("pr_url") or ""
    finding_title = ctx.get("finding_title") or "Verified fix"
    dashboard_url = ctx.get("dashboard_url") or ""
    subject = f"[AutoQA] Verified fix published — {repo} ({branch})"

    rows = [
        ("Repository", _esc(repo)),
        ("Branch", f'<code style="font-size:12px;">{_esc(branch)}</code>'),
        ("Fix", _esc(finding_title)),
    ]
    if pr_url:
        rows.append(("Pull request", _link(pr_url, pr_url)))

    text_lines = [
        f"AutoQA published a verified fix for {repo}.",
        f"Finding: {finding_title}",
        f"Branch: {branch}",
    ]
    if pr_url:
        text_lines.append(f"Pull request: {pr_url}")
    text_lines.append("")
    text_lines.append("The engine never merges; this is a normal PR for review.")

    html = _wrap(
        "Verified fix published",
        _esc(f"{repo} · {finding_title}"),
        _summary_table(rows),
        pr_url or dashboard_url,
    )
    return RenderedEmail(subject=subject, text="\n".join(text_lines), html=html)


def render_test(ctx: dict) -> RenderedEmail:
    dashboard_url = ctx.get("dashboard_url") or ""
    now = datetime.now(UTC).isoformat(timespec="seconds")
    settings = ctx.get("settings") or {}
    rows = [
        ("Sent at", _esc(now)),
        ("SMTP host", _esc(settings.get("host") or "(not set)")),
        ("Sender", _esc(settings.get("from") or "(not set)")),
    ]
    html = _wrap(
        "AutoQA SMTP test",
        "This is a test message from your AutoQA deployment.",
        _summary_table(rows),
        dashboard_url,
    )
    text = (
        "AutoQA SMTP test\n\n"
        "This is a test message from your AutoQA deployment.\n\n"
        f"Sent at: {now}\n"
        f"SMTP host: {settings.get('host') or '(not set)'}\n"
        f"Sender: {settings.get('from') or '(not set)'}\n"
    )
    return RenderedEmail(subject="[AutoQA] SMTP test message", text=text, html=html)


#: Every notification kind the system knows how to render.
RENDERERS = {
    "run_completed": render_run_completed,
    "findings_alert": render_findings_alert,
    "review_completed": render_review_completed,
    "fix_published": render_fix_published,
    "test": render_test,
}


def render(kind: str, ctx: dict) -> RenderedEmail:
    """Render ``kind``, raising ``KeyError`` for an unknown template.

    Callers that accept a kind from the network (the test-email endpoint) must
    validate first; the internal trigger paths use the constants.
    """
    try:
        renderer = RENDERERS[kind]
    except KeyError as exc:
        raise KeyError(f"unknown email template: {kind}") from exc
    return renderer(ctx)
