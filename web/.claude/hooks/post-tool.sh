#!/usr/bin/env bash
# Coding Agent Bridge tool hook (web workspace).
#
# Same behaviour as the workspace-root hook: accepts a Claude Code PostToolUse
# JSON payload on stdin, or "<files>" "<prompt>" "<reasoning>" [action] as
# positional arguments, and forwards the intent event to the local bridge
# daemon. Best-effort by design: never blocks the coding agent.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .../<repo>/web/.claude/hooks -> .../<repo>/web
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
REPO_ROOT="$(cd "${PROJECT_DIR}/.." && pwd)"
AGENT_DIR="${REPO_ROOT}/agent"
STATE_FILE="${SCRIPT_DIR}/../.bridge_last_prompt"

FILES=""
PROMPT=""
REASONING=""
ACTION="edit"

if [ "$#" -gt 0 ]; then
  FILES="${1:-}"
  PROMPT="${2:-}"
  REASONING="${3:-}"
  ACTION="${4:-edit}"
else
  PAYLOAD="$(cat 2>/dev/null || true)"
  if [ -n "${PAYLOAD}" ] && command -v python3 >/dev/null 2>&1; then
    eval "$(printf '%s' "${PAYLOAD}" | python3 -c '
import json, shlex, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
tool_input = data.get("tool_input") or {}
files = (
    tool_input.get("file_path")
    or tool_input.get("notebook_path")
    or tool_input.get("path")
    or ""
)
tool_name = data.get("tool_name") or ""
action = {"Write": "create", "NotebookEdit": "edit"}.get(tool_name, "edit")
print("HOOK_FILES=" + shlex.quote(str(files)))
print("HOOK_ACTION=" + shlex.quote(action))
' 2>/dev/null)"
    FILES="${HOOK_FILES:-}"
    ACTION="${HOOK_ACTION:-edit}"
  fi
  if [ -f "${STATE_FILE}" ]; then
    PROMPT="$(head -c 500 "${STATE_FILE}" 2>/dev/null || true)"
  fi
fi

[ -n "${PROMPT}" ] || PROMPT="Coding agent tool modification"
[ -n "${REASONING}" ] || REASONING="${PROMPT}"

if [ -z "${FILES}" ]; then
  # Paths are relative to the web workspace for this hook.
  FILES="$(cd "${PROJECT_DIR}" && git diff --name-only 2>/dev/null || true)"
fi
[ -n "${FILES}" ] || exit 0

if [ -d "${AGENT_DIR}" ]; then
  uv --directory "${AGENT_DIR}" run agent-bridge emit \
    --files "${FILES}" \
    --action "${ACTION}" \
    --prompt "${PROMPT}" \
    --reasoning "${REASONING}" >/dev/null 2>&1 || true
fi

exit 0
