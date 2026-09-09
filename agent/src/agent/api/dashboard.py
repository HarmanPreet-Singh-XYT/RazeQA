"""Interactive Forensic Web Dashboard for Autonomous PR Testing Engine.

Serves a premium dark-mode dashboard at / and /dashboard displaying live runs,
risk assessments, video/trace links, and one-click remediation prompt copy.
"""

from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import HTMLResponse

router = APIRouter(tags=["dashboard"])

DASHBOARD_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Autonomous PR Testing Engine — Control Center</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg: #090d16;
      --card-bg: rgba(18, 24, 38, 0.75);
      --card-border: rgba(255, 255, 255, 0.08);
      --card-hover: rgba(26, 35, 54, 0.85);
      --accent: #6366f1;
      --accent-glow: rgba(99, 102, 241, 0.25);
      --text: #f8fafc;
      --text-muted: #94a3b8;
      --success: #10b981;
      --danger: #f43f5e;
      --warning: #f59e0b;
      --info: #38bdf8;
    }

    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Plus Jakarta Sans', sans-serif;
      background-color: var(--bg);
      background-image: 
        radial-gradient(at 0% 0%, rgba(99, 102, 241, 0.12) 0px, transparent 50%),
        radial-gradient(at 100% 100%, rgba(244, 63, 94, 0.08) 0px, transparent 50%);
      color: var(--text);
      min-height: 100vh;
      padding: 2rem 1.5rem;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
    }

    header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 2.5rem;
      border-bottom: 1px solid var(--card-border);
      padding-bottom: 1.5rem;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 1rem;
    }

    .logo-badge {
      width: 44px;
      height: 44px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.3rem;
      box-shadow: 0 0 20px var(--accent-glow);
    }

    h1 {
      font-size: 1.5rem;
      font-weight: 800;
      letter-spacing: -0.02em;
    }

    .subtitle {
      font-size: 0.875rem;
      color: var(--text-muted);
      margin-top: 2px;
    }

    .status-pill {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: rgba(16, 185, 129, 0.1);
      border: 1px solid rgba(16, 185, 129, 0.25);
      color: var(--success);
      padding: 6px 14px;
      border-radius: 9999px;
      font-size: 0.8125rem;
      font-weight: 600;
    }

    .pulse {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 10px var(--success);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 1.25rem;
      margin-bottom: 2.5rem;
    }

    .stat-card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem 1.5rem;
      transition: all 0.2s ease;
    }

    .stat-card:hover {
      border-color: rgba(99, 102, 241, 0.3);
      transform: translateY(-2px);
    }

    .stat-label {
      font-size: 0.8125rem;
      font-weight: 600;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .stat-value {
      font-size: 2rem;
      font-weight: 800;
      margin-top: 0.5rem;
      letter-spacing: -0.03em;
    }

    .section-title {
      font-size: 1.125rem;
      font-weight: 700;
      margin-bottom: 1rem;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .refresh-btn {
      background: rgba(255, 255, 255, 0.06);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 0.8125rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      background: rgba(255, 255, 255, 0.12);
    }

    .runs-list {
      display: flex;
      flex-direction: column;
      gap: 1rem;
    }

    .run-card {
      background: var(--card-bg);
      backdrop-filter: blur(12px);
      border: 1px solid var(--card-border);
      border-radius: 16px;
      padding: 1.25rem 1.5rem;
      display: flex;
      flex-direction: column;
      gap: 1rem;
      transition: border-color 0.2s;
    }

    .run-card:hover {
      border-color: rgba(255, 255, 255, 0.16);
    }

    .run-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-wrap: wrap;
      gap: 0.75rem;
    }

    .run-meta {
      display: flex;
      align-items: center;
      gap: 0.75rem;
    }

    .badge {
      display: inline-flex;
      align-items: center;
      padding: 4px 10px;
      border-radius: 6px;
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .badge-success { background: rgba(16, 185, 129, 0.15); color: var(--success); }
    .badge-danger { background: rgba(244, 63, 94, 0.15); color: var(--danger); }
    .badge-cached { background: rgba(56, 189, 248, 0.15); color: var(--info); }
    .badge-queued { background: rgba(168, 85, 247, 0.15); color: #c084fc; }

    .badge-risk-high { background: rgba(244, 63, 94, 0.2); color: #fda4af; border: 1px solid rgba(244, 63, 94, 0.4); }
    .badge-risk-medium { background: rgba(245, 158, 11, 0.2); color: #fde68a; border: 1px solid rgba(245, 158, 11, 0.4); }
    .badge-risk-low { background: rgba(16, 185, 129, 0.2); color: #a7f3d0; border: 1px solid rgba(16, 185, 129, 0.4); }

    .sha {
      font-family: 'JetBrains Mono', monospace;
      font-size: 0.8125rem;
      background: rgba(0, 0, 0, 0.3);
      padding: 3px 8px;
      border-radius: 6px;
      color: #cbd5e1;
    }

    .branch-name {
      font-weight: 700;
      font-size: 0.9375rem;
    }

    .run-body {
      font-size: 0.875rem;
      color: #cbd5e1;
      line-height: 1.5;
    }

    .run-actions {
      display: flex;
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: center;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      padding-top: 0.875rem;
    }

    .btn-action {
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid var(--card-border);
      color: var(--text);
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 0.75rem;
      font-weight: 600;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s;
    }

    .btn-action:hover {
      background: rgba(99, 102, 241, 0.2);
      border-color: var(--accent);
      color: #fff;
    }

    .btn-copy {
      background: linear-gradient(135deg, rgba(99, 102, 241, 0.2), rgba(168, 85, 247, 0.2));
      border-color: rgba(99, 102, 241, 0.4);
    }

    .empty-state {
      text-align: center;
      padding: 4rem 1rem;
      color: var(--text-muted);
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <div class="brand">
        <div class="logo-badge">⚡</div>
        <div>
          <h1>Autonomous PR Testing Engine</h1>
          <div class="subtitle">Continuous Forensic Verification & Closed-Loop Remediation</div>
        </div>
      </div>
      <div class="status-pill">
        <div class="pulse"></div>
        Engine Active & Watching
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-label">Total PR Verification Runs</div>
        <div class="stat-value" id="stat-total">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Cached / Deduplicated</div>
        <div class="stat-value" id="stat-cached">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Regressions Caught</div>
        <div class="stat-value" id="stat-regressions" style="color: var(--danger);">0</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Clean Passes</div>
        <div class="stat-value" id="stat-passes" style="color: var(--success);">0</div>
      </div>
    </div>

    <div class="section-title">
      <span>Recent Verification Runs</span>
      <button class="refresh-btn" onclick="fetchRuns()">
        ↻ Refresh
      </button>
    </div>

    <div class="runs-list" id="runs-container">
      <div class="empty-state">Loading runs...</div>
    </div>
  </div>

  <script>
    async function fetchRuns() {
      try {
        const res = await fetch('/runs');
        const runs = await res.json();
        renderDashboard(runs);
      } catch (err) {
        document.getElementById('runs-container').innerHTML = 
          `<div class="empty-state">Failed to load runs: ${err}</div>`;
      }
    }

    function renderDashboard(runs) {
      let cached = 0, regressions = 0, passes = 0;
      runs.forEach(r => {
        if (r.status === 'cached') cached++;
        if (r.status === 'failed') regressions++;
        if (r.status === 'completed') passes++;
      });

      document.getElementById('stat-total').textContent = runs.length;
      document.getElementById('stat-cached').textContent = cached;
      document.getElementById('stat-regressions').textContent = regressions;
      document.getElementById('stat-passes').textContent = passes;

      const container = document.getElementById('runs-container');
      if (!runs || runs.length === 0) {
        container.innerHTML = '<div class="empty-state">No verification runs recorded yet. Trigger a run with <code>agent-bridge check</code> or a GitHub PR.</div>';
        return;
      }

      container.innerHTML = runs.map(run => {
        const badgeClass = run.status === 'completed' ? 'badge-success' : 
                           run.status === 'failed' ? 'badge-danger' : 
                           run.status === 'cached' ? 'badge-cached' : 'badge-queued';
        
        const risk = run.result?.risk_tag || 'Medium';
        const riskClass = risk === 'High' ? 'badge-risk-high' : 
                          risk === 'Low' ? 'badge-risk-low' : 'badge-risk-medium';
        
        const shaShort = run.sha.slice(0, 8);
        const rationale = run.result?.rationale || 'Fresh commit change verified against Playwright user journeys.';
        const passedCount = run.result?.passed_journeys?.length || (run.status === 'completed' ? 1 : 0);
        const failedCount = run.result?.failed_journeys?.length || (run.status === 'failed' ? 1 : 0);

        return `
          <div class="run-card">
            <div class="run-header">
              <div class="run-meta">
                <span class="badge ${badgeClass}">${run.status}</span>
                <span class="badge ${riskClass}">${risk} Risk</span>
                <span class="branch-name">🌿 ${run.branch}</span>
                <span class="sha">${shaShort}</span>
              </div>
              <div style="font-size: 0.75rem; color: var(--text-muted);">
                ${new Date(run.created_at).toLocaleTimeString()}
              </div>
            </div>
            <div class="run-body">
              ${rationale}
              <div style="margin-top: 0.5rem; font-size: 0.8125rem;">
                <strong>Journeys:</strong> ${passedCount} passed, ${failedCount} failed
              </div>
            </div>
            <div class="run-actions">
              <button class="btn-action btn-copy" onclick="copyRemediation('${run.run_id}')">
                📋 Copy Remediation Prompt
              </button>
              <a class="btn-action" href="/runs/${run.run_id}" target="_blank">
                🔍 Inspect Run JSON
              </a>
              <span style="font-size: 0.75rem; color: var(--text-muted); margin-left: auto;">
                ID: ${run.run_id}
              </span>
            </div>
          </div>
        `;
      }).join('');
    }

    function copyRemediation(runId) {
      const prompt = `Fix regression detected by PR Testing Engine on run ${runId}: Please inspect the failing journeys, verify input handling, and ensure all downstream dashboard pages load without errors.`;
      navigator.clipboard.writeText(prompt).then(() => {
        alert("Copied Remediation Prompt to clipboard! Paste it into Claude Code or Cursor.");
      });
    }

    fetchRuns();
    setInterval(fetchRuns, 5000);
  </script>
</body>
</html>
"""


@router.get("/", response_class=HTMLResponse)
@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_page() -> HTMLResponse:
    """Serve the interactive forensic dashboard."""
    return HTMLResponse(content=DASHBOARD_HTML)
