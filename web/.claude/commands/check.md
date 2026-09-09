---
description: Trigger an autonomous PR testing platform check on current branch and commit SHA
---

# /check - On-Demand PR Testing Verification

Run the autonomous PR testing verification against the platform for the current branch and SHA.

```bash
uv --directory ../agent run agent-bridge check
```

This verifies freshness against previous runs (deduplicating identical commit SHAs) or enqueues a new autonomous test run with Playwright browser journeys, video capture, and trace generation.
