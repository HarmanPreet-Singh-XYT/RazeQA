#!/usr/bin/env bash
# Coding Agent Bridge tool hook (Workspace Root): captures tool-use intent and emits to daemon
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
AGENT_DIR="${ROOT_DIR}/agent"

FILES="${1:-}"
PROMPT="${2:-Coding agent tool modification}"
REASONING="${3:-Automated change during coding session}"
ACTION="${4:-edit}"

if [ -z "${FILES}" ]; then
  # Check git unstaged/modified files as fallback
  FILES=$(cd "${ROOT_DIR}" && git diff --name-only || true)
fi

if [ -d "${AGENT_DIR}" ]; then
  uv --directory "${AGENT_DIR}" run agent-bridge emit \
    --files "${FILES}" \
    --action "${ACTION}" \
    --prompt "${PROMPT}" \
    --reasoning "${REASONING}" || true
fi
