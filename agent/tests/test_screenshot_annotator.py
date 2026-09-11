"""Tests for screenshot annotation and defect bounding box drawing."""

from __future__ import annotations

from pathlib import Path
from PIL import Image

from agent.remediation.screenshot_annotator import annotate_screenshot


def test_screenshot_annotator_draws_bounding_box(tmp_path: Path) -> None:
    # Create a dummy blank screenshot
    screenshot_file = tmp_path / "page_screenshot.png"
    img = Image.new("RGB", (800, 600), color=(255, 255, 255))
    img.save(screenshot_file, "PNG")

    findings = [
        {
            "finding": "Low contrast: 1.8:1 < 4.5:1 on submit button",
            "box": {"x": 100, "y": 150, "width": 120, "height": 40},
        },
        {
            "finding": "Text clipping detected",
            "box": {"x": 300, "y": 200, "width": 80, "height": 30},
        },
    ]

    annotated_path = annotate_screenshot(screenshot_file, findings)
    assert annotated_path.exists()
    assert annotated_path.name == "page_screenshot_annotated.png"

    # Confirm the annotated file is valid image with same dimensions
    with Image.open(annotated_path) as ann_img:
        assert ann_img.size == (800, 600)
        # Verify image is modified (contains red pixels from the box/badge)
        pixels = list(ann_img.getdata())
        has_red = any(p[0] > 200 and p[1] < 100 and p[2] < 100 for p in pixels)
        assert has_red is True
