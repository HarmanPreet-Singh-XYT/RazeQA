#!/usr/bin/env bash
# Coding Agent Bridge tool hook (workspace root).
#
# Captures intent from a coding-agent tool-use step and emits it to the bridge
# daemon. Two invocation modes:
#
#   1. Claude Code PostToolUse hook: the event JSON arrives on stdin. The file
#      path is read from tool_input and the most recent user prompt is read from
#      the state file written by user-prompt.sh.
#   2. Manual / positional: post-tool.sh "<files>" "<prompt>" "<reasoning>" [action]
#
# The emit is best-effort: if the daemon or AGENT_API_KEY is unavailable the
# event is dropped and this script still exits 0 so the coding agent is never
# blocked (idea.md Section 3.1 "always-online").
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# .../<repo>/.claude/hooks -> .../<repo>
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
AGENT_DIR="${ROOT_DIR}/agent"
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
  FILES="$(cd "${ROOT_DIR}" && git diff --name-only 2>/dev/null || true)"
fi
# Nothing identifiable changed -> nothing to report.
[ -n "${FILES}" ] || exit 0

if [ -d "${AGENT_DIR}" ]; then
  uv --directory "${AGENT_DIR}" run agent-bridge emit \
    --files "${FILES}" \
    --action "${ACTION}" \
    --prompt "${PROMPT}" \
    --reasoning "${REASONING}" >/dev/null 2>&1 || true
fi

exit 0
