"""Tests that reading a run refreshes an expired Supabase signed video/trace URL
instead of handing back the stale one persisted at upload time."""

from __future__ import annotations

from unittest.mock import MagicMock, patch

from agent.api.runs import _normalize_artifact_urls


def _stale_url(path: str = "runs/run_1/video/clip.webm") -> str:
    return f"https://example.supabase.co/storage/v1/object/sign/run-artifacts/{path}?token=stale"


def test_normalize_artifact_urls_refreshes_expiring_video_url() -> None:
    data = {"video_url": _stale_url(), "trace_url": None, "result": {}}

    with patch("agent.db.storage.default_artifact_storage") as mock_storage:
        mock_storage.is_available.return_value = True
        mock_storage.refresh_signed_url.return_value = _stale_url().replace("stale", "fresh")

        out = _normalize_artifact_urls(data)

    assert out["video_url"].endswith("token=fresh")
    mock_storage.refresh_signed_url.assert_called_once_with(_stale_url())


def test_normalize_artifact_urls_falls_back_to_stale_url_on_refresh_failure() -> None:
    stale = _stale_url()
    data = {"video_url": stale, "trace_url": None, "result": {}}

    with patch("agent.db.storage.default_artifact_storage") as mock_storage:
        mock_storage.is_available.return_value = True
        mock_storage.refresh_signed_url.return_value = None

        out = _normalize_artifact_urls(data)

    assert out["video_url"] == stale


def test_normalize_artifact_urls_leaves_non_signed_http_urls_untouched() -> None:
    data = {"video_url": "https://cdn.example.com/video.mp4", "trace_url": None, "result": {}}
    out = _normalize_artifact_urls(data)
    assert out["video_url"] == "https://cdn.example.com/video.mp4"


def test_normalize_artifact_urls_refreshes_url_nested_in_result() -> None:
    data = {"video_url": None, "trace_url": None, "result": {"video_url": _stale_url()}}

    with patch("agent.db.storage.default_artifact_storage") as mock_storage:
        mock_storage.is_available.return_value = True
        mock_storage.refresh_signed_url.return_value = _stale_url().replace("stale", "fresh")

        out = _normalize_artifact_urls(data)

    assert out["result"]["video_url"].endswith("token=fresh")
