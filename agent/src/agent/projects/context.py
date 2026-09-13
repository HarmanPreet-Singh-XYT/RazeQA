"""Per-repository Context & Secrets loaded for a run.

Three kinds of context, kept apart on purpose:

``variable``  non-sensitive configuration (base URLs, feature flags)
``secret``    credentials, encrypted at rest and never logged or prompted
``seed``      structured facts the agent needs but the code cannot reveal, such
              as a test account or a known record id

Only variables and seed data are surfaced to the model. Secret values are
decrypted solely to be injected into the run environment, and never leave this
module as text.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any

logger = logging.getLogger("agent.projects.context")

KIND_VARIABLE = "variable"
KIND_SECRET = "secret"
KIND_SEED = "seed"
KINDS = (KIND_VARIABLE, KIND_SECRET, KIND_SEED)


@dataclass
class ProjectContext:
    variables: dict[str, str] = field(default_factory=dict)
    secrets: dict[str, str] = field(default_factory=dict)
    seed: list[dict[str, str]] = field(default_factory=list)

    @property
    def is_empty(self) -> bool:
        return not (self.variables or self.secrets or self.seed)

    def prompt_lines(self) -> list[str]:
        """Plain-English context for the planning/analysis agents.

        Deliberately excludes secret values: a prompt is logged by providers and
        is not a place a credential may appear.
        """
        lines: list[str] = []
        for name in sorted(self.variables):
            lines.append(f"- `{name}` is configured in the environment.")
        for item in self.seed:
            name = item.get("name") or "seed"
            value = item.get("value") or ""
            description = item.get("description")
            line = f"- {name}: {value}"
            if description:
                line += f" ({description})"
            lines.append(line)
        return lines

    def to_summary(self) -> dict[str, Any]:
        """What was provided, without any value that must stay private."""
        return {
            "variable_names": sorted(self.variables),
            "secret_names": sorted(self.secrets),
            "seed_names": [item.get("name") for item in self.seed],
        }


EMPTY_CONTEXT = ProjectContext()


def load_project_context(repo_full_name: str) -> ProjectContext:
    """Load a repository's context. Failures degrade to empty, never fatal."""
    if not repo_full_name:
        return ProjectContext()
    try:
        from agent.db.supabase import get_supabase_client

        client = get_supabase_client()
        if not client:
            return ProjectContext()
        proj = (
            client.table("projects")
            .select("id")
            .eq("repo_full_name", repo_full_name)
            .limit(1)
            .execute()
        )
        rows = proj.data or []
        if not rows:
            return ProjectContext()
        project_id = rows[0]["id"]
        res = (
            client.table("project_context")
            .select("kind, name, value, encrypted, description")
            .eq("project_id", project_id)
            .execute()
        )
    except Exception as exc:  # noqa: BLE001
        logger.debug("Could not load project context for %s: %s", repo_full_name, exc)
        return ProjectContext()

    context = ProjectContext()
    for row in res.data or []:
        kind = str(row.get("kind") or "")
        name = str(row.get("name") or "")
        value = row.get("value") or ""
        if not name:
            continue
        if kind == KIND_VARIABLE:
            context.variables[name] = value
        elif kind == KIND_SECRET:
            if not row.get("encrypted"):
                # A plaintext secret row is a bug in the writer, not something to
                # silently use. Skip it and make it visible.
                logger.warning("Secret %s is stored unencrypted; refusing to load it.", name)
                continue
            try:
                from agent.credentials.store import decrypt_field

                context.secrets[name] = decrypt_field(value)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Could not decrypt secret %s: %s", name, exc)
        elif kind == KIND_SEED:
            context.seed.append(
                {
                    "name": name,
                    "value": value,
                    "description": str(row.get("description") or ""),
                }
            )
    return context
