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

VIDEO STREAMING NOTE
--------------------
Browsers require HTTP Range request support (RFC 7233) to play <video> elements
inline — they send "Range: bytes=0-" and expect a 206 Partial Content response
with Accept-Ranges and Content-Range headers. A plain 200 FileResponse causes
the browser to refuse playback (though download still works). The
``_range_streaming_response`` helper below implements this for .webm files.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Generator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, StreamingResponse

router = APIRouter(prefix="/artifacts", tags=["artifacts"])

RUNS_BASE = Path(os.environ.get("ARTIFACTS_BASE") or (Path(__file__).resolve().parents[3] / "artifacts" / "runs"))


ALLOWED_SUFFIXES = {".webm", ".mp4", ".zip", ".png", ".json"}

_CHUNK = 1024 * 256  # 256 KiB chunks


def _range_streaming_response(path: Path, request: Request) -> StreamingResponse:
    """Returns a 206 Partial Content streaming response for video files.

    Parses the ``Range`` header (if present) and streams only the requested
    byte range. Always advertises ``Accept-Ranges: bytes`` so browsers know
    they can seek. Falls back to streaming the full file as a 200 when no
    Range header is present.
    """
    file_size = path.stat().st_size
    range_header = request.headers.get("range")

    start = 0
    end = file_size - 1
    status_code = 200

    if range_header:
        # Parse "bytes=<start>-<end>" — browsers typically send "bytes=0-"
        try:
            range_val = range_header.strip().lower().removeprefix("bytes=")
            parts = range_val.split("-")
            start = int(parts[0]) if parts[0] else 0
            end = int(parts[1]) if len(parts) > 1 and parts[1] else file_size - 1
            end = min(end, file_size - 1)
            start = max(0, start)
        except (ValueError, IndexError):
            raise HTTPException(status_code=416, detail="Range Not Satisfiable")

        if start > end or start >= file_size:
            raise HTTPException(status_code=416, detail="Range Not Satisfiable")

        status_code = 206

    content_length = end - start + 1

    def _iter_file() -> Generator[bytes, None, None]:
        with open(path, "rb") as f:
            f.seek(start)
            remaining = content_length
            while remaining > 0:
                chunk = f.read(min(_CHUNK, remaining))
                if not chunk:
                    break
                remaining -= len(chunk)
                yield chunk

    headers = {
        "Content-Length": str(content_length),
        "Accept-Ranges": "bytes",
        "Content-Disposition": f'inline; filename="{path.name}"',
    }
    if status_code == 206:
        headers["Content-Range"] = f"bytes {start}-{end}/{file_size}"

    media_type = "video/mp4" if path.suffix.lower() == ".mp4" else "video/webm"
    return StreamingResponse(
        _iter_file(),
        status_code=status_code,
        media_type=media_type,
        headers=headers,
    )


def _resolve_and_validate(run_dir: str, sub_path: str) -> Path:
    """Validates path components and returns the resolved file Path, or raises 404."""
    runs_base = RUNS_BASE.resolve()
    base = (RUNS_BASE / run_dir).resolve()
    if not base.is_relative_to(runs_base):
        raise HTTPException(status_code=404, detail="Not found")

    target = (base / sub_path).resolve()
    if not target.is_relative_to(base):
        raise HTTPException(status_code=404, detail="Not found")

    if target.suffix.lower() not in ALLOWED_SUFFIXES:
        raise HTTPException(status_code=404, detail="Not found")

    # storage_state.json holds exported session cookies — never serve it.
    if target.name == "storage_state.json":
        raise HTTPException(status_code=404, detail="Not found")

    if not target.is_file():
        raise HTTPException(status_code=404, detail="Artifact not found")

    return target


@router.get("/runs/{run_dir}/{sub_path:path}")
async def get_run_artifact(run_dir: str, sub_path: str, request: Request):
    """Serve a single artifact file, e.g. /artifacts/runs/main_abcd1234/video/x.webm.

    For .webm video files, uses a Range-aware streaming response (HTTP 206)
    so browsers can buffer and play the video inline, not just download it.
    All other file types use a plain FileResponse.
    """
    target = _resolve_and_validate(run_dir, sub_path)

    if target.suffix.lower() in {".webm", ".mp4"}:
        return _range_streaming_response(target, request)

    return FileResponse(path=target, filename=target.name)


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
