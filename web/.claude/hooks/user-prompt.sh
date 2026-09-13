#!/usr/bin/env bash
# Coding Agent Bridge user-prompt hook (web workspace).
#
# Claude Code fires UserPromptSubmit before the model runs. The prompt itself is
# the best available summary of *why* subsequent edits are being made, so it is
# cached here and attached to the next PostToolUse intent event by post-tool.sh.
#
# Best-effort: always exits 0 so the coding agent is never blocked.
set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE_FILE="${SCRIPT_DIR}/../.bridge_last_prompt"

PAYLOAD="$(cat 2>/dev/null || true)"
[ -n "${PAYLOAD}" ] || exit 0
command -v python3 >/dev/null 2>&1 || exit 0

printf '%s' "${PAYLOAD}" | python3 -c '
import json, sys
try:
    data = json.load(sys.stdin)
except Exception:
    sys.exit(0)
prompt = (data.get("prompt") or "").strip().replace("\n", " ")
if prompt:
    sys.stdout.write(prompt[:500])
' > "${STATE_FILE}" 2>/dev/null || true

exit 0
