# RazeQA — Autonomous Intent-to-Verification Engine

> **Elevator Pitch:** Autonomous QA for AI coding: captures prompt intent, tests PRs via live browser journeys, and returns forensic video proof with ready-to-paste fixes.

---

## Inspiration

With AI coding agents like Claude Code, Cursor, and Copilot, developers are shipping features and refactors at 10x speed. However, QA has become the biggest bottleneck in modern software delivery:
1. **Traditional CI suites only test what humans wrote explicit assertions for** — they miss regressions in subtle, adjacent user journeys that developers didn't anticipate.
2. **AI writes code fast, but breaks things silently** — an agent fixing a checkout bug might inadvertently break an authentication modal or cause a layout shift on mobile screens.
3. **Debugging is tedious** — when a tester or user reports a bug, developers waste hours trying to reproduce it without video replays, network traces, or context on *why* the code was originally written that way.

We asked: **What if the same intelligence that writes your code could autonomously test it in a live browser, understand your original intent, record video proof of regressions, and hand back an instant fix prompt before you merge?** That was the spark for **RazeQA**.

---

## What it does

**RazeQA** is an autonomous closed-loop QA platform that bridges developer intent directly to end-to-end browser verification:

- **Coding Agent Bridge:** A background daemon and CLI plugin (`agent-bridge`) that hooks into your local coding agent (Claude Code, Cursor, Copilot). It captures not just *what* code changed in git diffs, but *why* — logging the user's prompts and the agent's internal reasoning into an **Intent Stream**.
- **Ephemeral Sandbox Orchestration:** On every Pull Request or on-demand check, RazeQA spins up an isolated, hardened container, clones the branch, installs dependencies, and boots the preview application.
- **Autonomous Vision & Browser Agents:** Using Playwright and vision-capable LLMs, RazeQA dynamically explores affected pages, executes critical user flows, tests complex interactive states, and detects visual anomalies (layout shifts, broken responsive states, console errors, failing API calls).
- **Baseline Differential Analysis:** Journeys run against both the PR branch and the `main` baseline to distinguish new regressions from pre-existing issues.
- **Forensic Artifact Packaging:** For every failure, RazeQA captures synchronized video recordings (`.mp4`/`.webm`), Playwright trace archives (`.zip`), network waterfalls, and DOM snapshots.
- **Self-Healing Remediation Prompts:** Posts native GitHub Check Runs and PR comments containing a structured, root-cause breakdown and a copy-pasteable **AI Fix Prompt** that your coding agent can immediately use to repair the regression.

---

## How we built it

RazeQA was designed as a dual-engine architecture:

1. **Autonomous Engine (Python / FastAPI / Docker / Playwright)**:
   - **Agent Orchestrator:** Powered by LLM-driven planning agents that synthesize test journeys directly from diffs and prompt intents.
   - **Vision & Exploration Engine:** Employs Playwright Chromium with element-level bounding box detection and perceptual visual diffing to explore arbitrary web applications without brittle selectors.
   - **Docker Sandbox Isolation:** Hardened container lifecycle management with dynamic port allocation, CPU/memory sandboxing, and zero-host-disk source retention.
   - **GitHub App Client:** Native GitHub Check Runs API and PR commenting pipeline authenticating via short-lived RS256 JWTs and ephemeral installation tokens.

2. **Control Center & Telemetry Dashboard (Next.js 16 / TypeScript / Tailwind CSS / Supabase)**:
   - **Modern Next.js 16 App Router UI**: Real-time run timeline, interactive video player with synchronized step-by-step logs, network inspector, and one-click fix copy triggers.
   - **Supabase Backend**: Multi-tenant database schema with Row-Level Security (RLS), HMAC-verified GitHub App installation lifecycle tracking, and signed cross-origin artifact storage.
   - **Dev Tools Suite**: A built-in developer toolbox with 20+ utilities (OpenGraph previewer, schema generators, headers analyzers, and payload validators).

---

## Challenges we ran into

- **Capturing True Developer Intent:** Linking raw git diffs to human prompts required building a lightweight local daemon that could unobtrusively hook into coding agent tool loops over WebSockets without slowing down the developer.
- **Dynamic Browser Navigation & Deep DOM Scrolling:** Standard browser automation tools struggle when layouts contain nested, scrollable containers (`overflow-y: auto`) or dynamic modals. We engineered element-targeted scroll inspection and accessibility tree traversal so the vision agent reasons about *where* to scroll and interact.
- **Container Memory & Resource Isolation:** Heavy full-stack builds (e.g., Next.js Turbopack + SWC + Tailwind compilation) frequently triggered kernel Out-Of-Memory (`Killed`) errors in restricted containers. We tuned Node heap management (`--max-old-space-size=2048`) and dynamic memory allocation (`3g+`) to reliably build arbitrary production bundles.
- **Secure GitHub App Authentication:** Ensuring zero long-lived secret storage by implementing dynamic RS256 JWT generation, on-the-fly 1-hour installation token minting, and HMAC-SHA256 signature verification for every webhook event.

---

## Accomplishments that we're proud of

- 🎬 **True Zero-Config Video Forensics:** Producing full-fidelity video replays, Playwright traces, and visual snapshots of actual regressions on live PRs without writing a single line of test code.
- 🔁 **The Closed-Loop Feedback Cycle:** Going from human prompt → coding agent change → autonomous browser verification → instant AI fix prompt delivered back to the PR in minutes.
- 🛡️ **Hermetic Test Suite:** Comprehensive test coverage with **666+ automated tests** verifying security invariants, memory limits, webhook handshakes, and sandbox isolation.
- 🚀 **Full End-to-End Delivery:** Seamlessly connecting a local CLI, cloud backend, PostgreSQL/Supabase database, Next.js frontend, and GitHub App into a cohesive developer experience.

---

## What we learned

- **Intent transforms QA:** Knowing *why* code changed makes test generation dramatically smarter than simply analyzing static code diffs or ASTs.
- **Vision-language models excel at exploratory QA:** Combining DOM accessibility trees with visual screenshots allows AI agents to navigate modern, complex web applications just like a human tester would.
- **Developer trust requires forensic proof:** An AI saying "this PR failed" isn't enough; giving developers an embedded video replay and an exact network trace makes the failure undeniable and effortless to resolve.

---

## What's next for RazeQA — Autonomous Intent-to-Verification Engine

- 📱 **Cross-Browser & Multi-Device Testing:** Expanding execution to mobile viewports (iOS Safari / Android Chrome emulation) and multi-browser matrices (Firefox, WebKit).
- ⚡ **Auto-Commit PR Fixes:** Adding an opt-in automated repair flow where RazeQA can autonomously test its own generated patch and commit the fix directly to the PR branch.
- 🤝 **IDE & Terminal Integrations:** Deepening plugins for Cursor, VS Code, and JetBrains so developers can trigger live preview sandbox verification with a single hotkey before pushing code.
- 🧠 **Project Memory & Flakiness Detection:** Learning a repository's flakiness profile and critical conversion funnels over time to optimize test generation budgets.
