@AGENTS.md

# Coding Agent Bridge Integration

This project is connected to the **Autonomous PR Testing Engine** via the **Coding Agent Bridge**.

## Real-Time Intent Capture
On every meaningful step (file edit, file create, file delete):
- Capture the file(s) touched, a compressed summary of the user's request, and your stated reasoning/intent for the change.
- Emit the intent event to the local bridge daemon using:
  ```bash
  uv --directory ../agent run agent-bridge emit \
    --files "path/to/modified/file" \
    --action "edit" \
    --prompt "<user prompt summary>" \
    --reasoning "<agent intent/reasoning>"
  ```
- Or run the tool hook script:
  ```bash
  .claude/hooks/post-tool.sh "<files>" "<prompt>" "<reasoning>"
  ```
- If the platform is unreachable or offline, the event is dropped without blocking your workflow.

## On-Demand Platform Verification
When the user asks to "check this against the platform", "verify against platform", or uses `/check`:
- Run the on-demand check command:
  ```bash
  uv --directory ../agent run agent-bridge check
  ```
- The engine checks freshness using the current commit SHA:
  - If identical to a completed run, the cached result is returned instantly.
  - If changes were made, a new test run is enqueued and verified against browser journeys.
