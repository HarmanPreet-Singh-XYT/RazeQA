"""Serves forensic run artifacts (video, trace) over HTTP.

Deliberately NOT a blanket StaticFiles mount on the whole artifacts/
directory: that tree also contains credentials.enc (encrypted credential
store) and per-run storage_state.json (exported session cookies) which must
never be reachable over HTTP. This route only serves files under
artifacts/runs/<run-scoped-dir>/ and only .webm/.zip/.png files (video,
trace, screenshots) — everything else 404s.

Protected by the same bearer-auth middleware as every other route (see
agent.api.auth) — artifacts are forensic evidence of test failures and may
contain application UI/data, so they're not made anonymously public.
"""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

RUNS_BASE = Path(__file__).resolve().parents[3] / "artifacts" / "runs"

ALLOWED_SUFFIXES = {".webm", ".zip", ".png", ".json"}


@router.get("/runs/{run_dir}/{sub_path:path}")
async def get_run_artifact(run_dir: str, sub_path: str) -> FileResponse:
    """Serve a single artifact file, e.g. /artifacts/runs/main_abcd1234/video/x.webm."""
    runs_base = RUNS_BASE.resolve()
    base = (RUNS_BASE / run_dir).resolve()
    # is_relative_to (not a string-prefix check) so a sibling directory that
    # happens to share RUNS_BASE as a string prefix — e.g. "artifacts/runs-evil"
    # against "artifacts/runs" — can't pass a naive startswith() comparison.
    if not base.is_relative_to(runs_base):
        raise HTTPException(status_code=404, detail="Not found")

    target = (base / sub_path).resolve()
    # Reject path traversal: the resolved file must stay inside its run dir.
    if not target.is_relative_to(base):
        raise HTTPException(status_code=404, detail="Not found")

    if target.suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=404, detail="Not found")

    # storage_state.json holds exported session cookies — never serve it,
    # even though .json is otherwise an allowed suffix for DOM/screenshot
    # metadata files.
    if target.name == "storage_state.json":
        raise HTTPException(status_code=404, detail="Not found")

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")

    media_type = "video/webm" if target.suffix == ".webm" else None
    return FileResponse(path=target, media_type=media_type, filename=target.name)


def to_artifact_url(local_path: str | Path | None) -> str | None:
    """Converts a local artifact filesystem path (as stored by the pipeline)
    into a relative API URL the frontend can actually fetch/embed. Returns
    None for paths outside the runs artifact tree (nothing to serve)."""
    if not local_path:
        return None
    try:
        resolved = Path(local_path).resolve()
        rel = resolved.relative_to(RUNS_BASE.resolve())
    except (ValueError, OSError):
        return None
    return f"/artifacts/runs/{rel.as_posix()}"
