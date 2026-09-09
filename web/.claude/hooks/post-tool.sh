#!/usr/bin/env bash
# Coding Agent Bridge tool hook: captures tool-use intent and emits to the bridge daemon
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
AGENT_DIR="$(cd "${PROJECT_DIR}/../agent" && pwd)"

FILES="${1:-}"
PROMPT="${2:-Coding agent tool modification}"
REASONING="${3:-Automated change during coding session}"
ACTION="${4:-edit}"

if [ -z "${FILES}" ]; then
  # Try checking git unstaged/modified files as fallback
  FILES=$(cd "${PROJECT_DIR}" && git diff --name-only || true)
fi

uv --directory "${AGENT_DIR}" run agent-bridge emit \
  --files "${FILES}" \
  --action "${ACTION}" \
  --prompt "${PROMPT}" \
  --reasoning "${REASONING}" || true
