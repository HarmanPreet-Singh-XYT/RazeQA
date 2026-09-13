"""Per-repository review automation policy.

A repository is not either "on" or "off". Teams need to be able to:

* **pause** reviews while a repo is mid-migration, without revoking GitHub App
  access or losing history (``mode = paused``);
* run reviews but keep the results out of GitHub while they evaluate the signal
  (``mode = silent`` — same as active except nothing is posted back);
* decide separately whether drafts and bot-authored PRs are worth the spend.

The policy lives in ``projects.settings.automation`` so it travels with the
project and is editable from the dashboard without a schema change. These
defaults are deliberately conservative: review real PRs, skip drafts, include
bots, and post results.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Any

logger = logging.getLogger("agent.projects.automation")

MODE_ACTIVE = "active"
MODE_SILENT = "silent"
MODE_PAUSED = "paused"
MODES = (MODE_ACTIVE, MODE_SILENT, MODE_PAUSED)

#: Login suffixes that identify automated authors. GitHub reports the author
#: type on the webhook, but a login suffix is a useful second signal for apps
#: that post as a user account.
_BOT_LOGIN_SUFFIXES = ("[bot]", "-bot", "_bot")


@dataclass(frozen=True)
class AutomationSettings:
    mode: str = MODE_ACTIVE
    reviews: bool = True
    draft_prs: bool = False
    bot_prs: bool = True
    comments: bool = True

    @property
    def paused(self) -> bool:
        return self.mode == MODE_PAUSED or not self.reviews

    @property
    def posts_to_github(self) -> bool:
        return self.comments and self.mode == MODE_ACTIVE

    def to_dict(self) -> dict[str, Any]:
        return {
            "mode": self.mode,
            "reviews": self.reviews,
            "draft_prs": self.draft_prs,
            "bot_prs": self.bot_prs,
            "comments": self.comments,
        }


DEFAULT_AUTOMATION = AutomationSettings()


def parse_automation(settings: Any) -> AutomationSettings:
    """Read the policy out of a project settings blob, tolerating anything."""
    if not isinstance(settings, dict):
        return DEFAULT_AUTOMATION
    raw = settings.get("automation")
    if not isinstance(raw, dict):
        return DEFAULT_AUTOMATION
    mode = str(raw.get("mode") or MODE_ACTIVE).lower()
    if mode not in MODES:
        mode = MODE_ACTIVE
    return AutomationSettings(
        mode=mode,
        reviews=bool(raw.get("reviews", True)),
        draft_prs=bool(raw.get("draft_prs", False)),
        bot_prs=bool(raw.get("bot_prs", True)),
        comments=bool(raw.get("comments", True)),
    )


def is_bot_author(author_type: str | None, login: str | None) -> bool:
    if (author_type or "").lower() == "bot":
        return True
    lowered = (login or "").lower()
    return any(lowered.endswith(suffix) for suffix in _BOT_LOGIN_SUFFIXES)


def should_review(
    policy: AutomationSettings,
    *,
    is_draft: bool,
    author_type: str | None,
    author_login: str | None,
) -> tuple[bool, str]:
    """Return ``(should_review, reason_when_skipped)``."""
    if policy.paused:
        return False, "automation_paused"
    if is_draft and not policy.draft_prs:
        return False, "draft_prs_disabled"
    if is_bot_author(author_type, author_login) and not policy.bot_prs:
        return False, "bot_prs_disabled"
    return True, ""


def load_automation(repo_full_name: str) -> AutomationSettings:
    """Look the policy up for a repository, falling back to the defaults.

    A lookup failure must never block a review, so an unreachable database means
    "use the defaults", not "skip the PR".
    """
    try:
        from agent.db.supabase import get_supabase_client

        client = get_supabase_client()
        if not client or not repo_full_name:
            return DEFAULT_AUTOMATION
        res = (
            client.table("projects")
            .select("settings")
            .eq("repo_full_name", repo_full_name)
            .limit(1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            return DEFAULT_AUTOMATION
        return parse_automation(rows[0].get("settings"))
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not load automation policy for %s: %s", repo_full_name, exc)
        return DEFAULT_AUTOMATION
