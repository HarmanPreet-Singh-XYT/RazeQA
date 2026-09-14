"""Supabase Storage client for uploading and serving forensic test artifacts (videos, traces).

If Supabase credentials are not configured, methods degrade gracefully and return None,
allowing callers to fall back to local disk-based artifact URLs.
"""

from __future__ import annotations

import logging
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from agent.db.supabase import get_supabase_client

logger = logging.getLogger("agent.db.storage")

DEFAULT_BUCKET = "run-artifacts"

# Supabase Storage enforces a per-bucket maximum object size (50 MiB on the
# free tier by default). A Playwright trace zip for a large sweep can exceed
# that, and the storage API answers with an opaque 413
# ("The object exceeded the maximum allowed size"). Uploading it is futile, so
# oversized artifacts are skipped and the caller falls back to the local
# /artifacts route — an explicit, quiet skip instead of a scary failure log on
# every run. Override when the bucket limit is higher (e.g. a Pro project):
#   MAX_ARTIFACT_UPLOAD_BYTES=524288000
DEFAULT_MAX_UPLOAD_BYTES = 50 * 1024 * 1024

_SIZE_SUFFIXES = {
    "b": 1,
    "kb": 1024,
    "kib": 1024,
    "mb": 1024 * 1024,
    "mib": 1024 * 1024,
    "gb": 1024 * 1024 * 1024,
    "gib": 1024 * 1024 * 1024,
}


def _parse_size(value: str | int | None, default: int = DEFAULT_MAX_UPLOAD_BYTES) -> int:
    """Parse ``MAX_ARTIFACT_UPLOAD_BYTES`` accepting plain bytes or a ``50MB`` style suffix."""
    if value is None:
        return default
    if isinstance(value, int):
        return value
    text = str(value).strip().lower()
    if not text:
        return default
    # Longest suffix first: "1gb" also ends in "b", so a naive scan would try to
    # parse "1g" as bytes and fall back to the default.
    for suffix in sorted(_SIZE_SUFFIXES, key=len, reverse=True):
        multiplier = _SIZE_SUFFIXES[suffix]
        if text.endswith(suffix):
            number = text[: -len(suffix)].strip()
            try:
                return int(float(number) * multiplier)
            except ValueError:
                return default
    try:
        return int(text)
    except ValueError:
        return default


def max_upload_bytes() -> int:
    """Configured per-object upload ceiling, read fresh so tests/ops can override."""
    return _parse_size(os.environ.get("MAX_ARTIFACT_UPLOAD_BYTES"))

# Forensic artifacts (videos/traces/screenshots) may contain application UI
# and data from the PR under test, so the bucket is private and every URL
# handed to a client is a short-lived signed URL rather than a permanent
# public one — this matches the same "not anonymously public" posture as the
# /artifacts/runs/* HTTP route in agent.api.artifacts.
SIGNED_URL_EXPIRY_S = 3600

CONTENT_TYPES = {
    ".webm": "video/webm",
    ".mp4": "video/mp4",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".zip": "application/zip",
    ".json": "application/json",
}


class SupabaseArtifactStorage:
    """Manages uploading artifacts to Supabase Storage and obtaining publicly accessible URLs."""

    def __init__(self, client: Any | None = None, bucket: str = DEFAULT_BUCKET) -> None:
        self._client = client
        self.bucket = bucket
        # Oversized files are skipped on every attempt; remember which ones were
        # already reported so a run with N routes does not log N identical
        # warnings (and the console stays readable).
        self._warned_oversize: set[str] = set()

    def _remember_oversize(self, path: Path) -> bool:
        """Record an oversized path, returning False when it was already reported."""
        key = str(path)
        if key in self._warned_oversize:
            return False
        # Bound the set: a long-lived worker could otherwise accumulate one
        # entry per oversized artifact forever.
        if len(self._warned_oversize) >= 500:
            self._warned_oversize.pop()
        self._warned_oversize.add(key)
        return True

    @property
    def client(self) -> Any | None:
        if self._client is None:
            self._client = get_supabase_client()
        return self._client

    def is_available(self) -> bool:
        """Returns True if the Supabase client is configured and available."""
        return self.client is not None

    def upload_artifact(
        self,
        local_path: Path | str | None,
        destination_path: str,
        content_type: str | None = None,
    ) -> str | None:
        """Uploads a local file to Supabase Storage and returns a signed URL.

        Args:
            local_path: Path to the local file to upload.
            destination_path: Destination path/key within the storage bucket (e.g. 'runs/run_123/video.webm').
            content_type: MIME type of the file. Inferred from extension if not provided.

        Returns:
            A signed URL valid for SIGNED_URL_EXPIRY_S seconds, or None if client is
            unavailable, file does not exist, or upload fails. The bucket is private,
            so this signed URL is the only way to fetch the object — there is no
            separate public URL.
        """
        if not local_path:
            return None

        path = Path(local_path)
        if not path.exists() or not path.is_file():
            logger.warning("Artifact file does not exist for upload: %s", path)
            return None

        client = self.client
        if not client:
            logger.debug("Supabase client not configured; skipping upload for %s", path)
            return None

        # Check the ceiling before reading the file: a multi-hundred-MB trace
        # should not even be loaded into memory just to be rejected by the
        # bucket's own limit.
        limit = max_upload_bytes()
        try:
            size = path.stat().st_size
        except OSError as exc:
            logger.warning("Could not stat artifact %s for upload: %s", path, exc)
            return None
        if limit > 0 and size > limit:
            if self._remember_oversize(path):
                logger.warning(
                    "Artifact %s (%.1f MiB) exceeds the Supabase upload limit of %.1f MiB; "
                    "skipping upload and serving it from local artifacts instead. "
                    "Raise MAX_ARTIFACT_UPLOAD_BYTES if the bucket limit is higher, or "
                    "shrink traces (PLAYWRIGHT_TRACE_SCREENSHOTS=false).",
                    path.name,
                    size / (1024 * 1024),
                    limit / (1024 * 1024),
                )
            return None

        if content_type is None:
            content_type = CONTENT_TYPES.get(path.suffix.lower(), "application/octet-stream")

        clean_dest = destination_path.lstrip("/")

        try:
            with open(path, "rb") as f:
                file_bytes = f.read()

            file_options = {"content-type": content_type, "upsert": "true"}

            client.storage.from_(self.bucket).upload(
                path=clean_dest,
                file=file_bytes,
                file_options=file_options,
            )

            signed = client.storage.from_(self.bucket).create_signed_url(
                clean_dest, SIGNED_URL_EXPIRY_S
            )
            signed_url = signed.get("signedURL") or signed.get("signedUrl") if isinstance(signed, dict) else None
            if not signed_url:
                logger.warning("Upload succeeded but no signed URL returned for %s", clean_dest)
                return None
            logger.info("Successfully uploaded %s to Supabase Storage (signed URL issued)", path.name)
            return signed_url
        except Exception as exc:  # noqa: BLE001
            # 413 has a single, actionable cause (the object is larger than the
            # bucket allows). Log it once as a skip-style message rather than a
            # generic failure that looks like an outage.
            if "413" in str(exc) or "exceeded the maximum allowed size" in str(exc):
                if self._remember_oversize(path):
                    logger.warning(
                        "Supabase rejected %s as too large (413); serving it from local "
                        "artifacts instead. Raise MAX_ARTIFACT_UPLOAD_BYTES or the bucket "
                        "limit to store it.",
                        path.name,
                    )
                return None
            logger.warning(
                "Failed to upload %s to Supabase Storage bucket '%s': %s",
                path,
                self.bucket,
                exc,
            )
            return None

    def get_signed_url(self, destination_path: str) -> str | None:
        """Re-signs a URL for an already-uploaded object (e.g. when a cached
        run record is re-fetched after its previous signed URL expired)."""
        client = self.client
        if not client:
            return None
        clean_dest = destination_path.lstrip("/")
        try:
            signed = client.storage.from_(self.bucket).create_signed_url(
                clean_dest, SIGNED_URL_EXPIRY_S
            )
            if isinstance(signed, dict):
                return signed.get("signedURL") or signed.get("signedUrl")
            return None
        except Exception as exc:  # noqa: BLE001
            logger.warning("Failed to re-sign URL for %s: %s", clean_dest, exc)
            return None

    # ------------------------------------------------------------------
    # Retention
    # ------------------------------------------------------------------
    def _list_prefix(self, prefix: str) -> list[dict[str, Any]]:
        client = self.client
        if not client:
            return []
        try:
            entries = client.storage.from_(self.bucket).list(prefix, {"limit": 1000})
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not list Supabase storage prefix '%s': %s", prefix, exc)
            return []
        return entries or []

    def collect_objects_older_than(
        self,
        max_age_seconds: float,
        prefix: str = "runs",
        max_depth: int = 6,
    ) -> list[str]:
        """Return storage object paths under ``prefix`` older than the cutoff.

        Buckets are a virtual hierarchy (`runs/<run>/<category>/<file>`), and the
        storage API lists one directory level at a time, so this walks the tree.
        Folders are entries with no `id`; files carry `created_at` metadata.
        """
        if not self.client:
            return []

        cutoff = datetime.now(UTC) - timedelta(seconds=max_age_seconds)
        stale: list[str] = []
        stack: list[tuple[str, int]] = [(prefix, 0)]
        seen: set[str] = set()

        while stack:
            current, depth = stack.pop()
            if current in seen:
                continue
            seen.add(current)

            for entry in self._list_prefix(current):
                name = entry.get("name")
                if not name:
                    continue
                child = f"{current}/{name}" if current else name
                # A `null` id marks a virtual folder rather than an object.
                if entry.get("id") is None:
                    if depth + 1 < max_depth:
                        stack.append((child, depth + 1))
                    continue

                created_raw = entry.get("created_at") or entry.get("updated_at")
                if not created_raw:
                    continue
                try:
                    created = datetime.fromisoformat(str(created_raw).replace("Z", "+00:00"))
                except ValueError:
                    continue
                if created < cutoff:
                    stale.append(child)

        return stale

    def delete_objects(self, paths: list[str]) -> int:
        """Delete storage objects in batches; returns how many were removed."""
        client = self.client
        if not client or not paths:
            return 0

        removed = 0
        for start in range(0, len(paths), 100):
            batch = paths[start : start + 100]
            try:
                client.storage.from_(self.bucket).remove(batch)
                removed += len(batch)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "Failed to delete %d object(s) from Supabase bucket '%s': %s",
                    len(batch),
                    self.bucket,
                    exc,
                )
        return removed


default_artifact_storage = SupabaseArtifactStorage()
