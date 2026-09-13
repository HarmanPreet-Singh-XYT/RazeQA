"""Tests for video conversion and artifact streaming of MP4 recordings."""

from __future__ import annotations

import os
import subprocess
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from agent.api.artifacts import router
from agent.main import app
from agent.journeys.video_converter import (
    convert_webm_to_mp4,
    get_preferred_video_format,
    process_recorded_video,
)


def test_preferred_video_format_default():
    with patch.dict(os.environ, {}, clear=True):
        assert get_preferred_video_format() == "mp4"


def test_preferred_video_format_override():
    with patch.dict(os.environ, {"VIDEO_FORMAT": "webm"}):
        assert get_preferred_video_format() == "webm"
    with patch.dict(os.environ, {"VIDEO_FORMAT": ".MP4"}):
        assert get_preferred_video_format() == "mp4"


def test_process_recorded_video_none():
    assert process_recorded_video(None) is None


def test_process_recorded_video_nonexistent():
    fake_path = Path("/tmp/does_not_exist_12345.webm")
    assert process_recorded_video(fake_path) == fake_path


def test_process_recorded_video_when_webm_requested(tmp_path: Path):
    dummy_webm = tmp_path / "test.webm"
    dummy_webm.write_bytes(b"dummy webm data")

    result = process_recorded_video(dummy_webm, target_format="webm")
    assert result == dummy_webm
    assert dummy_webm.exists()


def test_convert_webm_to_mp4_without_ffmpeg(tmp_path: Path):
    dummy_webm = tmp_path / "test.webm"
    dummy_webm.write_bytes(b"dummy webm data")

    with patch("shutil.which", return_value=None):
        result = convert_webm_to_mp4(dummy_webm)
        assert result == dummy_webm
        assert dummy_webm.exists()


def test_convert_webm_to_mp4_ffmpeg_failure(tmp_path: Path):
    dummy_webm = tmp_path / "test.webm"
    dummy_webm.write_bytes(b"dummy webm data")

    mock_proc = MagicMock()
    mock_proc.returncode = 1
    mock_proc.stderr = "Encoding error"

    with patch("shutil.which", return_value="/usr/bin/ffmpeg"), patch(
        "subprocess.run", return_value=mock_proc
    ):
        result = convert_webm_to_mp4(dummy_webm)
        assert result == dummy_webm
        assert dummy_webm.exists()


def test_convert_webm_to_mp4_success(tmp_path: Path):
    dummy_webm = tmp_path / "test.webm"
    dummy_webm.write_bytes(b"dummy webm data")
    target_mp4 = tmp_path / "test.mp4"

    def fake_subprocess_run(cmd, **kwargs):
        # Simulate ffmpeg writing output file
        target_mp4.write_bytes(b"dummy mp4 data")
        res = MagicMock()
        res.returncode = 0
        return res

    with patch("shutil.which", return_value="/usr/bin/ffmpeg"), patch(
        "subprocess.run", side_effect=fake_subprocess_run
    ):
        result = convert_webm_to_mp4(dummy_webm, remove_original=True)
        assert result == target_mp4
        assert target_mp4.exists()
        assert not dummy_webm.exists()


def test_convert_webm_to_mp4_keep_original_when_env_set(tmp_path: Path):
    dummy_webm = tmp_path / "test.webm"
    dummy_webm.write_bytes(b"dummy webm data")
    target_mp4 = tmp_path / "test.mp4"

    def fake_subprocess_run(cmd, **kwargs):
        target_mp4.write_bytes(b"dummy mp4 data")
        res = MagicMock()
        res.returncode = 0
        return res

    with patch("shutil.which", return_value="/usr/bin/ffmpeg"), patch(
        "subprocess.run", side_effect=fake_subprocess_run
    ), patch.dict(os.environ, {"KEEP_ORIGINAL_VIDEO": "1"}):
        result = convert_webm_to_mp4(dummy_webm)
        assert result == target_mp4
        assert target_mp4.exists()
        assert dummy_webm.exists()


def test_artifacts_router_serves_mp4_with_range_requests(tmp_path: Path):
    client = TestClient(app)

    # Test range response streaming with dummy mp4
    from agent.api.artifacts import _range_streaming_response
    from starlette.requests import Request

    dummy_mp4 = tmp_path / "sample.mp4"
    dummy_mp4.write_bytes(b"0123456789" * 10)  # 100 bytes

    scope = {
        "type": "http",
        "method": "GET",
        "headers": [(b"range", b"bytes=10-19")],
    }
    req = Request(scope)
    resp = _range_streaming_response(dummy_mp4, req)
    assert resp.status_code == 206
    assert resp.media_type == "video/mp4"
    assert resp.headers["content-range"] == "bytes 10-19/100"
    assert resp.headers["content-length"] == "10"
