"""Remediation Prompt and Forensic Report Formatter."""

from __future__ import annotations

import os
from typing import TYPE_CHECKING, Any

from agent.analyzer.diff_analyzer import AnalysisResult
from agent.api.artifacts import to_artifact_url
from agent.bridge.models import IntentEvent
from agent.credentials.redaction import redact_credentials

if TYPE_CHECKING:
    from agent.remediation.fix_synthesizer import FixProposal


def _absolute_artifact_url(local_path: str | None) -> str | None:
    """Converts a stored local artifact path into an absolute, fetchable URL."""
    if not local_path:
        return None
    if local_path.startswith("http://") or local_path.startswith("https://"):
        return local_path
    rel_url = to_artifact_url(local_path)
    if not rel_url:
        return None
    base = os.environ.get("PLATFORM_URL", "http://localhost:8000").rstrip("/")
    return f"{base}{rel_url}"


def generate_remediation_markdown(
    journey_name: str,
    error: str,
    analysis: AnalysisResult,
    intents: list[IntentEvent],
    trace_path: str | None = None,
    video_path: str | None = None,
    dom_snapshot: str | None = None,
    severity: str = "High",
    domain: str | None = None,
    additional_findings: list[str] | None = None,
    fix_proposal: FixProposal | None = None,
    custom_secrets: list[str] | None = None,
) -> str:
    """Produce a forensic-grade remediation markdown prompt with optional synthesized fix diff.

    custom_secrets: known real secret values (e.g. the actual stored test
    account password for this project) to redact verbatim in addition to the
    generic regex patterns — the regexes only catch conventional key=value/
    header shapes, so a real credential embedded in an unusual format (a URL,
    a raw JSON value under an unrecognized key) would otherwise slip through
    into this markdown, which gets sent to an LLM prompt and posted publicly
    as a PR comment.
    """
    clean_error = redact_credentials(error, custom_secrets=custom_secrets)
    clean_dom = redact_credentials(dom_snapshot, custom_secrets=custom_secrets) if dom_snapshot else None

    intent_lines: list[str] = []
    for it in intents[:3]:
        clean_prompt = redact_credentials(it.prompt_summary, custom_secrets=custom_secrets)
        clean_reasoning = redact_credentials(it.reasoning, custom_secrets=custom_secrets)
        intent_lines.append(f"- **Prompt**: *{clean_prompt}*")
        intent_lines.append(f"  - **Intent**: {clean_reasoning}")
        intent_lines.append(f"  - **Files**: `{', '.join(it.files)}`")
    intent_block = "\n".join(intent_lines) if intent_lines else "No bridge intent events logged."

    trace_url = _absolute_artifact_url(trace_path)
    video_url = _absolute_artifact_url(video_path)
    trace_line = f"[{trace_url}]({trace_url})" if trace_url else "Not recorded"
    video_line = f"[{video_url}]({video_url})" if video_url else "Not recorded"

    dom_content = (
        f"```html\n{clean_dom[:1200]}...\n```"
        if clean_dom
        else "*DOM state was not captured or was clean.*"
    )
    dom_block = f"<details>\n<summary>🔍 View Failing DOM Snapshot</summary>\n\n{dom_content}\n</details>"

    domain_badge = f" | **Domain:** `{domain}`" if domain else ""
    findings_block = ""
    if additional_findings:
        findings_items = "\n".join(
            f"- {redact_credentials(f, custom_secrets=custom_secrets)}" for f in additional_findings
        )
        findings_block = f"\n---\n\n### ⚠️ Additional Telemetry Findings\n{findings_items}\n"

    # Format synthesized fix proposal or autonomous agentic repair if present
    proposal_block = ""
    if fix_proposal and (fix_proposal.patches or fix_proposal.unified_diff):
        patch_blocks: list[str] = []
        for p in fix_proposal.patches:
            patch_blocks.append(f"**Target:** `{p.file_path}` — {p.explanation}")
            if p.unified_diff:
                patch_blocks.append(f"```diff\n{p.unified_diff}\n```")
            elif p.replacement_snippet:
                patch_blocks.append(f"```suggestion\n{p.replacement_snippet}\n```")

        # Include unified diff directly if synthesized via agentic repair
        if not patch_blocks and fix_proposal.unified_diff:
            patch_blocks.append(f"```diff\n{fix_proposal.unified_diff}\n```")

        trajectory_block = ""
        if fix_proposal.repair_trajectory:
            step_rows = []
            for t in fix_proposal.repair_trajectory:
                step_idx = t.get("step", 0)
                cmd = t.get("command", "")
                rc = t.get("returncode", 0)
                status_icon = "✅" if rc == 0 else "❌"
                dur = t.get("duration_ms", 0.0)
                step_rows.append(f"- **Step {step_idx}** {status_icon} `{cmd}` *({dur:.0f}ms)*")
            step_list = "\n".join(step_rows)
            trajectory_block = f"""
<details>
<summary>📋 View Autonomous Repair Trajectory ({fix_proposal.steps_taken}/{fix_proposal.max_steps} steps)</summary>

{step_list}

</details>
"""

        build_badge = "✅ Passed (`0` errors)" if fix_proposal.build_passed else "⚠️ Not verified or build failed"
        build_cmd_str = f" (`{fix_proposal.build_command}`)" if fix_proposal.build_command else ""

        proposal_block = f"""
---

### 🛠️ Autonomous Agentic Repair Summary
- **Status:** {'✨ **Fix Synthesized & Verified**' if fix_proposal.build_passed else '⚠️ Fix Proposed (Pending Review)'}
- **Build Verification:** {build_badge}{build_cmd_str}
- **Resource Meter:** `{fix_proposal.steps_taken}/{fix_proposal.max_steps}` steps executed | Cost: `${fix_proposal.total_cost_usd:.4f}`
- **Explanation:** {fix_proposal.explanation or fix_proposal.root_cause}
{trajectory_block}
{chr(10).join(patch_blocks)}
"""

    remediation_prompt = f"""You are fixing a regression caught by the Autonomous PR Testing Engine.

TEST JOURNEY FAILED: {journey_name}
SEVERITY: {severity.upper()}
ERROR: {clean_error}
AFFECTED SURFACES: {', '.join(analysis.affected_surfaces)}

DEVELOPER INTENT BEHIND THE RECENT CHANGE:
{intent_block}

TASK:
1. Inspect the touched files: {', '.join(analysis.affected_surfaces)}
2. Fix the error so that the '{journey_name}' flow succeeds without breaking other flows.
3. Verify that expected elements render and inputs submit properly.
"""

    return f"""## 🚨 Autonomous PR Verification Failed: `{journey_name}`

> **Risk Assessment:** **{analysis.risk_tag.upper()} RISK** | **Severity:** **{severity.upper()}**{domain_badge}
> **Rationale:** {analysis.rationale}
> **Affected Surfaces:** {", ".join(f"`{s}`" for s in analysis.affected_surfaces)}

---

### 🔍 Forensic Evidence
- **Error:** `{clean_error}`
- **Playwright Trace:** {trace_line} *(View with `npx playwright show-trace <file>`)*
- **Session Video:** {video_line}
{dom_block}
{findings_block}
{proposal_block}
---

### 🧠 Intent Context Hand-off
{intent_block}

---

### 📋 Ready-to-Paste Remediation Prompt
Copy and paste this into **Claude Code**, **Cursor**, or your coding agent to resolve the regression:

```markdown
{remediation_prompt.strip()}
```
"""


def generate_pr_summary_comment(
    status: str,
    passed_journeys: list[str],
    failed_journeys: list[dict[str, Any]],
    analysis: AnalysisResult,
    remediation_prompts: list[str],
    additional_findings: list[str] | None = None,
    branch: str = "",
    fix_proposals: list[FixProposal] | None = None,
    custom_secrets: list[str] | None = None,
    trigger_mode: str = "manual_approval",
    auto_committed: bool = False,
) -> str:
    """Generate the GitHub PR comment summarizing the verification run with interactive actions.

    custom_secrets: see generate_remediation_markdown — real known secret
    values to redact verbatim before this text is posted publicly on the PR.
    """
    icon = "✅" if status == "success" else "❌"
    header = f"## {icon} Autonomous PR Verification: **{status.upper()}**"

    body_parts = [header, ""]
    body_parts.append(f"**Risk Level:** `{analysis.risk_tag}` — {analysis.rationale}")
    body_parts.append("")

    if passed_journeys:
        body_parts.append("### ✅ Passed Journeys")
        for j in passed_journeys:
            body_parts.append(f"- `{j}`")
        body_parts.append("")

    if failed_journeys:
        body_parts.append("### ❌ Regressions Detected")
        for f in failed_journeys:
            err_msg = redact_credentials(f.get("error", "Assertion failed"), custom_secrets=custom_secrets)
            sev = f.get("severity", "High")
            dom = f.get("domain", "")
            dom_text = f" [{dom}]" if dom else ""
            body_parts.append(f"- `{f['name']}` ({sev}{dom_text}): {err_msg}")
        body_parts.append("")

        # Interactive Bot Actions Callout
        branch_text = f" to branch `{branch}`" if branch else ""
        if auto_committed:
            body_parts.append("> ### ⚡ Autonomous Auto-Repair")
            body_parts.append(
                f"> - **Auto-Committed:** Autonomous fix verified with green build and automatically committed{branch_text}. Re-verification initiated."
            )
        else:
            body_parts.append("> ### ⚡ Interactive Bot Actions")
            body_parts.append(
                f"> - **Apply Fix:** Reply with **`@pr-agent apply`** to commit the proposed patch{branch_text} and re-verify automatically."
            )
        body_parts.append(
            "> - **Re-run Full Suite:** Reply with **`@pr-agent test --scope full`**"
        )
        body_parts.append(
            "> - **Inspect Route:** Reply with **`@pr-agent inspect /checkout`**"
        )
        body_parts.append("")

    if additional_findings:
        body_parts.append("### ⚠️ Additional Findings")
        for finding in additional_findings:
            body_parts.append(f"- {redact_credentials(finding, custom_secrets=custom_secrets)}")
        body_parts.append("")

    if remediation_prompts:
        body_parts.append("---")
        body_parts.append("### 🛠️ Forensic Proof & Remediation")
        for prompt in remediation_prompts:
            body_parts.append(prompt)
            body_parts.append("")

    body_parts.append(
        "\n*Automated report generated by Autonomous PR Testing Engine via GitHub App.*"
    )

    full_comment = "\n".join(body_parts)

    # Protect against GitHub 65,536 char comment limit
    max_comment_length = 60000
    if len(full_comment) > max_comment_length:
        truncated_notice = "\n\n*(Note: Extended forensic logs truncated to fit GitHub comment size limit. Full artifacts available in dashboard.)*"
        full_comment = full_comment[: max_comment_length - len(truncated_notice)] + truncated_notice

    return full_comment
