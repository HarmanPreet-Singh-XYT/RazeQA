# Autonomous PR Testing & QA Verification Engine

**One-liner:** An AI system that watches you code — through a CLI/skill plugged into Claude Code, Cursor, Copilot, etc. — and autonomously tests, verifies, and produces forensic proof + one-click fixes for every change you make, without you ever leaving your coding agent.

---

## 1. The Problem

PRs get merged with regressions that nobody catches until production, because:
- Manual QA doesn't scale to how fast AI coding agents now ship code.
- CI test suites only catch what someone thought to write a test for.
- Nobody re-tests "adjacent" flows a change might have silently broken.
- When something does break, developers waste time reproducing it — no video, no trace, no context on *why* the change was made in the first place.

## 2. The Core Idea

Two systems, one product:

1. **Coding Agent Bridge** — a local CLI + skill that plugs into whatever coding agent you're already using. It watches every change you make in real time and captures not just *what* changed, but *why* — the intent behind it, straight from your prompts and the agent's own reasoning.
2. **Autonomous PR Testing Engine** — a sandboxed browser-agent system that takes that intent-enriched diff, plans real user journeys around what changed, executes them in a live browser, and produces forensic-grade proof (video, trace, network waterfall, DOM state) for every pass/fail — plus a ready-to-paste remediation prompt for your coding agent to fix what it broke.

The combination is the pitch: **the same AI that wrote the code hands off rich context to the AI that tests it, and failures come back as a prompt the writing AI can immediately act on.** Closed loop, no human required to bridge the gap.

---

## 3. System Architecture

### 3.1 Coding Agent Bridge

**Local CLI (daemon)** — installed alongside the coding agent, runs in the background per-project.

**Skill/plugin** (Claude Code skill, Cursor rule, Copilot extension equivalent) — hooks into the agent's tool-use loop. On every meaningful step (file edit, file create, file delete):
- Captures: file(s) touched, a compressed summary of the user's request, the agent's stated reasoning/intent for the change.
- Pushes this event **in real time** to the platform backend over a persistent connection (WebSocket), keyed to the current git branch + working directory.
- **Always-online**: no local queue/offline sync needed for v1 — if the platform is unreachable, events are dropped (not blocking the coding agent) and a warning is logged.

This produces a running **intent log** per branch: a timeline of "user asked for X → agent changed files Y because Z" that sits alongside the raw git diff.

**On-demand trigger**: from inside the coding agent session, the user can say "check this against the platform" → skill calls the platform API with the current branch/SHA → platform checks freshness (has this exact SHA already been tested? is it stale relative to a prior run?) → triggers a new run only if needed, otherwise returns the cached result.

> **v1 scope note**: on-demand and on-PR triggers are the two entry points built for the 5-day version; on-push is a stretch goal (Section 7).

### 3.2 Autonomous PR Testing Engine

**Trigger models** (all feed the same pipeline):
- **On-demand** — via the Coding Agent Bridge, as above.
- **On push** — lightweight, `changed`-scope-only run on every commit (optional/config).
- **On PR open/update** — full webhook-driven run, richest output (this is the "traditional" CI-style entry point).

**Pipeline:**

1. **Ingestion** — receives trigger (webhook, CLI call, or push event), pulls the diff, and — if available — the matching intent log from the Coding Agent Bridge for that branch.
2. **Sandbox spin-up** — Docker container on a cloud VM: checkout branch, install deps, seed DB/mock state, boot the preview app server, inject stored credentials as env vars and run the login step (see Section 3.3) if the project requires auth.
3. **Diff + intent analyzer** — a Strands agent (Claude-powered) with tools to read the raw diff, the intent log, and relevant surrounding code; outputs affected routes/components, a risk tag (Low/Medium/High), and a rationale.
4. **Journey planner** — hybrid approach:
   - **Seeded flows**: pre-defined critical user flows that touch the changed surfaces get run directly.
   - **Agent-generated flows**: a second Strands agent, given browser-inspection tools (accessibility tree, DOM, screenshot), explores new/ambiguous surfaces and constructs journeys on the fly — model-driven planning instead of a hardcoded exploration script.
5. **Test scope mode** (per-run config):
   - `changed` — only diff-adjacent surfaces (default, fast/cheap).
   - `full` — full-platform regression sweep.
6. **Test type mode** (per-run config):
   - `functional` — navigation, network response correctness, unhandled exceptions, state consistency.
   - `functional + visual` — adds UI regression detection: baseline screenshot diffing, layout-shift detection, AI-driven visual anomaly spotting (vision-capable pass).
7. **Browser agent execution** — the journey-planner Strands agent drives the browser via Playwright tools (click, type, navigate, scroll, observe), captures a full trace (network, console, DOM snapshots) and a synced video via Playwright's native CDP screencast/tracing — no separate Xvfb/ffmpeg pipeline needed.
   - **Scroll handling**: not every layout scrolls at the page/window level. Dashboards commonly have a fixed sidebar/header and one or more independently scrollable content regions (`overflow-y: auto`/`scroll` containers nested in the DOM). A single `scroll(direction)` tool that only calls `window.scrollTo` will silently fail to reveal content in these layouts. The `scroll` tool needs to be **element-targeted**: given a selector (or "the element currently in focus/under the cursor"), it checks computed style (`overflow-y`) and `scrollHeight > clientHeight` to confirm the element is actually scrollable, then scrolls that element specifically — not the window. The observation step (accessibility tree + screenshot) should flag which regions are scrollable so the agent can reason about *where* to scroll, not just whether to.
8. **Baseline comparison** — same journeys run against `main` (or a cached baseline) to distinguish *new* regressions from pre-existing bugs.
9. **Result packaging** — buckets results into Failed / Passed / Additional Findings, tagged by severity and functional domain. For every failure: bundles the trace, video, DOM snapshot, network context, and diff/intent context into a structured markdown **remediation prompt** — ready to paste into Claude Code, Cursor, or Copilot.
10. **Delivery** — PR comment/check with a summary + links, or returned directly to the CLI for on-demand runs.

### 3.3 Authentication & Credential Handling

Most real apps sit behind a login wall, so the sandbox needs a way to authenticate before journeys can run — without the raw credentials ending up in plaintext anywhere they'd leak (intent logs, traces, videos, LLM context sent back to Claude).

**Setup-time (CLI/project onboarding):**
- When a project is first connected, the CLI prompts: *does this app require login to access the flows you want tested?*
- If yes: prompts for one or more **test credential sets** (e.g. a seeded test account — strongly recommend the user provide a dedicated test/staging account, not real prod credentials, called out explicitly in the CLI prompt).
- For v1, support one role (a single test user). Multi-role (admin vs. regular user) is a stretch goal — see Section 7.

**Storage:**
- Credentials are encrypted at rest (e.g. a secrets manager or an encrypted column, never plain DB fields) and scoped per-project.
- They are injected into the sandbox as environment variables at container boot — never written into the repo, the intent log, or passed as plaintext into any LLM prompt.

**Runtime (inside the sandbox):**
- Before any test journeys run, a dedicated **login step** executes first — either a seeded flow (if you know the login form's selectors) or handed to the browser agent as a tool-driven task ("authenticate using the provided credentials") if the login flow is unknown.
- The agent's `type()` tool receives the credential values from environment/secret injection at call time — the values themselves are never echoed back into the agent's reasoning trace or logged verbatim.
- **Redaction pass**: before any screenshot, video, or trace is stored or included in a remediation prompt, credential fields (password inputs, auth tokens in network requests/headers) are masked/redacted. This matters because forensic artifacts get shared with developers on failure — a leaked test password in a video is still a leak.

**Session persistence:** once authenticated, the session (cookies/local storage) can be captured and reused across journeys in the same run, so login only has to happen once per sandbox spin-up rather than once per journey.

| Layer | Choice | Why |
|---|---|---|
| Browser automation | **Playwright** | Native CDP screencast + tracing (network/console/DOM in one artifact) works in Python and Node; no Xvfb/ffmpeg needed |
| Agent core (diff analysis, journey planning, browser agent loop) | **Python** (FastAPI, Playwright-python) | Best ecosystem for LLM orchestration + agent loops |
| Orchestration API / webhook ingestion / dashboard backend | **Node** | Handles job queue, GitHub webhook, CLI/skill event ingestion |
| LLM | **Claude** (Sonnet for planning/analysis, Haiku for cheap/fast triage), behind a thin model-agnostic interface | Strong agentic + reasoning performance; remediation prompts come back in a coding-agent-native format naturally |
| Agent framework | **AWS Strands Agents SDK** (Python) | Open-source, model-driven agent loop (LLM handles planning/tool-calling instead of hand-coded state machines); native Anthropic model support; built-in MCP support for tool access; separate Strands agents for the diff/intent analyzer, journey planner, and browser-driving agent, each with its own tool set |
| Execution environment | **Docker containers on a managed cloud VM** | Fastest to ship; skip Firecracker/microVMs unless isolation becomes a real problem |
| Coding Agent Bridge transport | **WebSocket**, real-time, always-online | Simplest architecture; no local sync/queue logic needed for v1 |

---

## 5. Build Plan — Solo, Full-Time, 5 Days

Scope is cut to what the demo actually needs: the closed loop (bridge → intent capture → autonomous test → forensic proof → remediation → fix). On-push triggers and the visual/UI regression module move to stretch goals (Section 7) — cuttable without breaking the core story.

**Day 1: Foundation**
- Repo scaffolding (Python agent core + Node orchestration API).
- Docker sandbox: checkout branch, install deps, boot a real test app (pick one demo target app now, e.g. a small Next.js/React app you control — give it a login screen so auth handling has something real to demo against).
- Playwright wired up, first scripted journey running headless in the sandbox with trace + video capture working end-to-end.
- Basic credential prompt + encrypted storage (Section 3.3) — one test account, injected into the sandbox as env vars, login step working before other journeys run.

**Day 2: Coding Agent Bridge**
- CLI daemon + Claude Code skill: hook into tool-use steps, capture intent (file, prompt summary, reasoning).
- WebSocket event stream to backend, intent log stored per-branch.
- On-demand trigger: "check this against the platform" command working from inside a Claude Code session.
- Freshness check (SHA-based dedup) — keep simple, in-memory/DB row is fine.

**Day 3: Diff/Intent Analyzer + Journey Planner**
- Claude-powered diff + intent analyzer → affected surfaces + risk tag.
- Seeded flow library for the demo app's critical paths (2-3 flows is enough).
- Agent-generated exploratory journey for one changed surface (accessibility tree + screenshot observation loop, action dispatch) — prove the hybrid model works, don't over-build breadth. Build the `scroll` tool element-targeted from the start (Section 3.2), not window-level — retrofitting it later means re-testing every journey.
- `changed` scope mode only for v1; leave `full` mode as a config stub.

**Day 4: Baseline Comparison + Result Packaging**
- Lightweight baseline check: run the same journeys against `main` to flag which failures are new vs. pre-existing (doesn't need to be exhaustive — one comparison pass is enough to demo the distinction).
- Result bucketing (Failed/Passed/Additional Findings) with severity tagging.
- Remediation markdown prompt generator (trace + video link + DOM snapshot + diff/intent context).
- GitHub webhook → PR-triggered run → PR comment with summary + artifact links.

**Day 5: Integration, Polish, Demo Prep**
- Minimal dashboard or even just clean CLI/PR-comment output — don't build UI you don't need for the demo.
- Full end-to-end dry run of the demo script (below), at least twice.
- Fix whatever breaks; record a backup demo video in case the live run fails on stage.

---

## 6. Demo Script (What Judges See)

1. **Setup**: a real small web app, open in Claude Code.
2. Ask Claude Code to make a change that *should* work but subtly breaks something (e.g., a form validation change that breaks a downstream flow) — the skill visibly logs intent in real time as it's made.
3. From inside the coding agent, trigger "check this against the platform."
4. Live: sandbox spins up, browser agent runs seeded + agent-generated journeys, judges watch the video/trace stream in.
5. Result: a **High risk** flag on a flow the change didn't obviously touch, a synced video showing the break, and a remediation markdown prompt.
6. Paste the remediation prompt straight back into Claude Code — watch it fix the regression using the exact context (trace, DOM, diff, intent) the platform produced.
7. Re-run → green.

That closed loop — write code → real-time intent capture → autonomous testing → forensic proof → one-click fix → verified green — is the whole pitch in under 5 minutes.

---

## 7. Stretch Goals (if time remains)

- **Multi-role credential support** (admin vs. regular user test accounts) beyond the single test account in v1.
- **On-push trigger mode** (lightweight `changed`-scope run on every commit, not just PR/on-demand).
- **Visual/UI regression module** (baseline screenshot diffing, layout-shift detection, vision-model anomaly spotting) — cut from the 5-day core scope, add back if Day 5 has slack.
- `full` platform regression mode demoed against a larger app.
- Multi-agent coding tool support beyond Claude Code (Cursor, Copilot) to show the bridge isn't single-vendor.
- Risk trend view across multiple PRs/commits on the dashboard.
- Parallel sandbox pooling for faster on-demand checks.

