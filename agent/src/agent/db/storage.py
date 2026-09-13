"""Supabase Storage client for uploading and serving forensic test artifacts (videos, traces).

If Supabase credentials are not configured, methods degrade gracefully and return None,
allowing callers to fall back to local disk-based artifact URLs.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from agent.db.supabase import get_supabase_client

logger = logging.getLogger("agent.db.storage")

DEFAULT_BUCKET = "run-artifacts"

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
