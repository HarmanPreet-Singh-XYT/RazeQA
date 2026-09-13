"""Video post-processing and format conversion for Playwright journey recordings.

Chromium's CDP screencast and Playwright's record_video_dir natively output
WebM (VP8/VP9) video files. This module converts recorded WebM videos to MP4
(H.264 / yuv420p / faststart) for universal browser streaming, mobile support,
and forensic playback.
"""

from __future__ import annotations

import logging
import os
import shutil
import subprocess
from pathlib import Path

logger = logging.getLogger("agent.journeys.video_converter")

DEFAULT_VIDEO_FORMAT = "mp4"


def get_preferred_video_format() -> str:
    """Returns the configured preferred video format (e.g. 'mp4' or 'webm').

    Can be configured via the VIDEO_FORMAT environment variable. Defaults to 'mp4'.
    """
    raw = os.environ.get("VIDEO_FORMAT", DEFAULT_VIDEO_FORMAT).strip().lower().lstrip(".")
    return raw or DEFAULT_VIDEO_FORMAT


def convert_webm_to_mp4(
    webm_path: Path | str,
    output_path: Path | str | None = None,
    *,
    remove_original: bool = True,
    timeout_seconds: float = 60.0,
) -> Path:
    """Converts a WebM video file to MP4 format using ffmpeg.

    Uses H.264 video encoding with yuv420p pixel format and +faststart flag
    for optimal browser streaming compatibility and seeking.

    If ffmpeg is not available on the system, or if conversion fails, logs a warning
    and falls back to returning the original webm file without raising an exception.
    """
    source = Path(webm_path).resolve()
    if not source.exists() or source.stat().st_size == 0:
        return source

    dest = Path(output_path).resolve() if output_path else source.with_suffix(".mp4")
    if source == dest:
        return source

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        logger.info("ffmpeg is not installed; keeping original recording at %s", source)
        return source

    cmd = [
        ffmpeg_bin,
        "-y",
        "-i", str(source),
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-movflags", "+faststart",
        str(dest),
    ]

    try:
        proc = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=timeout_seconds,
            check=False,
            text=True,
        )
        if proc.returncode != 0:
            logger.warning(
                "ffmpeg conversion from %s to %s failed (exit %d): %s",
                source,
                dest,
                proc.returncode,
                proc.stderr[-500:] if proc.stderr else "",
            )
            if dest.exists():
                try:
                    dest.unlink()
                except OSError:
                    pass
            return source

        if not dest.exists() or dest.stat().st_size == 0:
            logger.warning("ffmpeg completed but output %s is missing or empty", dest)
            return source

        # Conversion succeeded
        logger.info("Successfully converted %s to MP4 (%s, %d bytes)", source.name, dest.name, dest.stat().st_size)
        if remove_original and not os.environ.get("KEEP_ORIGINAL_VIDEO"):
            try:
                source.unlink()
            except OSError as exc:
                logger.debug("Failed to remove original webm file %s: %s", source, exc)

        return dest

    except subprocess.TimeoutExpired:
        logger.warning("ffmpeg conversion timed out for %s after %ss", source, timeout_seconds)
        if dest.exists():
            try:
                dest.unlink()
            except OSError:
                pass
        return source
    except Exception as exc:  # noqa: BLE001
        logger.warning("Unexpected error during video conversion for %s: %s", source, exc)
        return source


def stitch_videos(
    video_paths: list[Path | str],
    dest: Path | str,
    timeout_seconds: int = 300,
) -> Path | None:
    """Concatenate per-route recordings into one session replay.

    Each route is recorded in its own browser context, so a sweep produces one
    short clip per page. Watching a single clip made it look like the agent never
    left the home page; this joins them in visit order so the headline replay
    shows the whole navigation.

    Returns the stitched path, or None when there is nothing to stitch or
    ffmpeg is unavailable/failed — callers then fall back to a single clip
    rather than presenting a broken video.
    """
    existing = [Path(p) for p in video_paths if p and Path(p).exists()]
    if len(existing) < 2:
        return None

    ffmpeg_bin = shutil.which("ffmpeg")
    if not ffmpeg_bin:
        logger.info("ffmpeg is not installed; cannot stitch %d clips", len(existing))
        return None

    destination = Path(dest)
    destination.parent.mkdir(parents=True, exist_ok=True)

    list_file = destination.parent / f".{destination.stem}-concat.txt"
    try:
        # The concat demuxer needs paths escaped for its own quoting rules:
        # a literal single quote inside the path is written as '\''.
        list_file.write_text(
            "".join(
                "file '" + p.resolve().as_posix().replace("'", "'\\''") + "'\n"
                for p in existing
            ),
            encoding="utf-8",
        )

        def _run(args: list[str]) -> subprocess.CompletedProcess | None:
            try:
                return subprocess.run(
                    args, capture_output=True, text=True, timeout=timeout_seconds, check=False
                )
            except (subprocess.SubprocessError, OSError) as exc:
                logger.warning("ffmpeg stitch command failed: %s", exc)
                return None

        # 1. Stream-copy concat: fast and lossless, valid when every clip shares
        #    codec and dimensions (the normal case — same browser, same viewport).
        copy_attempt = _run(
            [
                ffmpeg_bin, "-y", "-f", "concat", "-safe", "0",
                "-i", str(list_file), "-c", "copy", str(destination),
            ]
        )
        if copy_attempt is not None and copy_attempt.returncode == 0 and _has_content(destination):
            logger.info("Stitched %d clips into %s (stream copy)", len(existing), destination)
            return destination

        # 2. Re-encode: handles clips whose parameters differ, which makes the
        #    concat demuxer produce a file that will not play.
        reencode_attempt = _run(
            [
                ffmpeg_bin, "-y", "-f", "concat", "-safe", "0",
                "-i", str(list_file),
                "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                "-movflags", "+faststart", str(destination),
            ]
        )
        if reencode_attempt is not None and reencode_attempt.returncode == 0 and _has_content(destination):
            logger.info("Stitched %d clips into %s (re-encoded)", len(existing), destination)
            return destination

        logger.warning(
            "Could not stitch session replay from %d clips: %s",
            len(existing),
            (reencode_attempt.stderr[-800:] if reencode_attempt is not None else "no ffmpeg result"),
        )
        if destination.exists():
            try:
                destination.unlink()
            except OSError:
                pass
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("Unexpected error stitching session replay: %s", exc)
        return None
    finally:
        try:
            list_file.unlink()
        except OSError:
            pass


def _has_content(path: Path) -> bool:
    try:
        return path.is_file() and path.stat().st_size > 0
    except OSError:
        return False


def process_recorded_video(
    video_path: Path | str | None,
    target_format: str | None = None,
) -> Path | None:
    """Processes a newly recorded Playwright video file, converting it to the preferred format.

    Parameters
    ----------
    video_path : Path | str | None
        Path to the recorded video file.
    target_format : str | None
        Target video format extension ('mp4', 'webm'). If None, uses get_preferred_video_format().

    Returns
    -------
    Path | None
        The path to the processed video file, or None if input was None.
    """
    if not video_path:
        return None

    path = Path(video_path)
    if not path.exists():
        return path

    desired = (target_format or get_preferred_video_format()).lower().lstrip(".")

    if desired == "mp4" and path.suffix.lower() == ".webm":
        return convert_webm_to_mp4(path)

    return path
