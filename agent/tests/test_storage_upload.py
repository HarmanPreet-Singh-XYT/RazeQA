"""Tests for Supabase Storage artifact uploading and pipeline integration."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from agent.db.storage import (
    SupabaseArtifactStorage,
    _parse_size,
    max_upload_bytes,
)
from agent.db.supabase import SupabaseRunStore
from agent.runner.pipeline import _artifact_url_for_file


def test_storage_upload_success(tmp_path: Path) -> None:
    test_file = tmp_path / "test_video.webm"
    test_file.write_bytes(b"fake-video-content")

    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_bucket.create_signed_url.return_value = {
        "signedURL": "https://example.supabase.co/storage/v1/object/sign/run-artifacts/runs/run_1/video/test_video.webm?token=abc"
    }
    mock_client.storage.from_.return_value = mock_bucket

    storage = SupabaseArtifactStorage(client=mock_client, bucket="run-artifacts")
    assert storage.is_available() is True

    url = storage.upload_artifact(test_file, "runs/run_1/video/test_video.webm")
    assert url == "https://example.supabase.co/storage/v1/object/sign/run-artifacts/runs/run_1/video/test_video.webm?token=abc"

    mock_client.storage.from_.assert_called_with("run-artifacts")
    mock_bucket.upload.assert_called_once()
    mock_bucket.create_signed_url.assert_called_once()


def test_storage_upload_missing_client(tmp_path: Path) -> None:
    test_file = tmp_path / "video.webm"
    test_file.write_bytes(b"content")

    with patch("agent.db.storage.get_supabase_client", return_value=None):
        storage = SupabaseArtifactStorage(client=None)
        assert storage.is_available() is False
        url = storage.upload_artifact(test_file, "runs/run_1/video.webm")
        assert url is None


def test_storage_upload_nonexistent_file() -> None:
    mock_client = MagicMock()
    storage = SupabaseArtifactStorage(client=mock_client)
    url = storage.upload_artifact(Path("/nonexistent/video.webm"), "runs/run_1/video.webm")
    assert url is None
    mock_client.storage.from_.assert_not_called()


def test_storage_upload_exception_handling(tmp_path: Path) -> None:
    test_file = tmp_path / "video.webm"
    test_file.write_bytes(b"content")

    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_bucket.upload.side_effect = RuntimeError("Supabase S3 error")
    mock_client.storage.from_.return_value = mock_bucket

    storage = SupabaseArtifactStorage(client=mock_client)
    url = storage.upload_artifact(test_file, "runs/run_1/video.webm")
    assert url is None


def test_artifact_url_for_file_with_supabase(tmp_path: Path) -> None:
    test_file = tmp_path / "page@123.webm"
    test_file.write_bytes(b"video-data")

    with patch("agent.db.storage.default_artifact_storage.is_available", return_value=True), \
         patch("agent.db.storage.default_artifact_storage.upload_artifact") as mock_upload:
        mock_upload.return_value = "https://supabase.co/storage/v1/object/public/run-artifacts/runs/run_999/video/page@123.webm"

        url = _artifact_url_for_file(test_file, run_id="run_999", category="video")
        assert url == "https://supabase.co/storage/v1/object/public/run-artifacts/runs/run_999/video/page@123.webm"
        mock_upload.assert_called_once_with(test_file, "runs/run_999/video/page@123.webm")


def test_artifact_url_for_file_fallback(tmp_path: Path) -> None:
    test_file = tmp_path / "page@123.webm"
    test_file.write_bytes(b"video-data")

    with patch("agent.db.storage.default_artifact_storage.is_available", return_value=False), \
         patch("agent.api.artifacts.to_artifact_url", return_value="/artifacts/runs/main_123/video/page@123.webm") as mock_to_url:
        url = _artifact_url_for_file(test_file, run_id="run_999", category="video")
        assert url == "/artifacts/runs/main_123/video/page@123.webm"
        mock_to_url.assert_called_once_with(test_file)


def test_parse_size_accepts_suffixes() -> None:
    assert _parse_size("50MB") == 50 * 1024 * 1024
    assert _parse_size("1gb") == 1024 * 1024 * 1024
    assert _parse_size("1048576") == 1048576
    assert _parse_size("nonsense") == 50 * 1024 * 1024


def test_upload_skips_oversized_file_without_calling_storage(tmp_path: Path, monkeypatch) -> None:
    test_file = tmp_path / "home-trace.zip"
    test_file.write_bytes(b"x" * 2048)

    monkeypatch.setenv("MAX_ARTIFACT_UPLOAD_BYTES", "1024")
    assert max_upload_bytes() == 1024

    mock_client = MagicMock()
    storage = SupabaseArtifactStorage(client=mock_client)
    url = storage.upload_artifact(test_file, "runs/run_1/traces/home-trace.zip")

    assert url is None
    mock_client.storage.from_.assert_not_called()


def test_upload_413_is_reported_as_size_skip(tmp_path: Path, monkeypatch) -> None:
    test_file = tmp_path / "docs-trace.zip"
    test_file.write_bytes(b"content")

    monkeypatch.setenv("MAX_ARTIFACT_UPLOAD_BYTES", "10MB")
    mock_client = MagicMock()
    mock_bucket = MagicMock()
    mock_bucket.upload.side_effect = Exception(
        "{'statusCode': 413, 'error': 'Payload too large', "
        "'message': 'The object exceeded the maximum allowed size'}"
    )
    mock_client.storage.from_.return_value = mock_bucket

    storage = SupabaseArtifactStorage(client=mock_client)
    url = storage.upload_artifact(test_file, "runs/run_1/traces/docs-trace.zip")
    assert url is None
    # It tried exactly once and did not crash; no signed URL is issued.
    mock_bucket.upload.assert_called_once()
    mock_bucket.create_signed_url.assert_not_called()


def test_supabase_run_store_update_includes_urls() -> None:
    mock_client = MagicMock()
    mock_table = MagicMock()
    mock_query = MagicMock()
    mock_query.execute.return_value = MagicMock(data=[{
        "id": "run_123",
        "branch": "feat/x",
        "sha": "abcdef",
        "scope": "changed",
        "test_type": "functional",
        "status": "completed",
        "created_at": "2026-09-10T00:00:00Z",
        "completed_at": "2026-09-10T00:01:00Z",
        "result": {"status": "success"},
    }])
    mock_table.update.return_value = mock_query
    mock_query.eq.return_value = mock_query
    mock_client.table.return_value = mock_table

    store = SupabaseRunStore(client=mock_client)
    res = store.update(
        run_id="run_123",
        status="completed",
        result={"status": "success", "video_url": "https://supabase.co/video.webm"},
        completed=True,
        video_url="https://supabase.co/video.webm",
        trace_url="https://supabase.co/trace.zip",
    )

    assert res is not None
    mock_client.table.assert_called_with("runs")
    payload = mock_table.update.call_args[0][0]
    assert payload["status"] == "completed"
    assert payload["video_url"] == "https://supabase.co/video.webm"
    assert payload["trace_url"] == "https://supabase.co/trace.zip"
    assert "completed_at" in payload
