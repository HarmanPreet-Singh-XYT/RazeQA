"""Screenshot Annotator using Pillow.

Draws red bounding boxes and numerical badge callouts over offending UI elements
to visually pinpoint defect locations on forensic screenshots.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from PIL import Image, ImageDraw, ImageFont

logger = logging.getLogger("agent.remediation.screenshot_annotator")

# Colors
BOX_BORDER_COLOR = (239, 68, 68, 255)  # Tailwind red-500
BOX_FILL_COLOR = (239, 68, 68, 45)      # Translucent red overlay
BADGE_BG_COLOR = (220, 38, 38, 255)    # Tailwind red-600
BADGE_TEXT_COLOR = (255, 255, 255, 255)
LABEL_BG_COLOR = (15, 23, 42, 230)     # Slate-900 translucent
LABEL_TEXT_COLOR = (248, 250, 252, 255)


def _get_font(size: int = 14) -> ImageFont.ImageFont:
    try:
        return ImageFont.load_default()
    except Exception:
        return None  # type: ignore


def annotate_screenshot(
    image_path: Path | str,
    findings: list[dict[str, Any] | str],
    output_path: Path | str | None = None,
) -> Path:
    """Annotates a screenshot with red bounding boxes and defect labels.

    Args:
        image_path: Path to the raw forensic screenshot.
        findings: List of defect finding dictionaries (with optional 'box' or 'bounding_box'
                  keys: {x, y, width, height}) or finding description strings.
        output_path: Destination path for the annotated PNG. If None, appends '_annotated.png'.

    Returns:
        Path to the newly created annotated screenshot. Original is preserved.
    """
    src_path = Path(image_path)
    if not src_path.exists():
        raise FileNotFoundError(f"Source screenshot does not exist: {src_path}")

    if output_path is None:
        dest_path = src_path.parent / f"{src_path.stem}_annotated.png"
    else:
        dest_path = Path(output_path)

    # Open image and convert to RGBA for alpha compositing
    with Image.open(src_path) as base_img:
        img = base_img.convert("RGBA")
        overlay = Image.new("RGBA", img.size, (255, 255, 255, 0))
        draw = ImageDraw.Draw(overlay)
        font = _get_font(13)

        img_w, img_h = img.size
        numbered_findings: list[str] = []

        for idx, finding in enumerate(findings, start=1):
            finding_text = finding.get("finding") if isinstance(finding, dict) else str(finding)
            numbered_findings.append(f"{idx}. {finding_text}")

            box = None
            if isinstance(finding, dict):
                box = finding.get("box") or finding.get("bounding_box") or finding.get("rect")

            if box and isinstance(box, dict):
                x = float(box.get("x", 0))
                y = float(box.get("y", 0))
                w = float(box.get("width", 0))
                h = float(box.get("height", 0))

                # Clamp to image boundaries
                x0 = max(0, min(x, img_w - 1))
                y0 = max(0, min(y, img_h - 1))
                x1 = max(0, min(x + w, img_w - 1))
                y1 = max(0, min(y + h, img_h - 1))

                if x1 > x0 and y1 > y0:
                    # 1. Translucent box fill
                    draw.rectangle([x0, y0, x1, y1], fill=BOX_FILL_COLOR)
                    # 2. Prominent red border
                    for offset in range(3):
                        draw.rectangle(
                            [max(0, x0 - offset), max(0, y0 - offset), min(img_w, x1 + offset), min(img_h, y1 + offset)],
                            outline=BOX_BORDER_COLOR,
                        )

                    # 3. Numbered marker badge in corner
                    badge_size = 24
                    bx0 = max(0, x0 - 4)
                    by0 = max(0, y0 - badge_size - 4)
                    bx1 = bx0 + badge_size
                    by1 = by0 + badge_size
                    draw.ellipse([bx0, by0, bx1, by1], fill=BADGE_BG_COLOR, outline=(255, 255, 255, 255))
                    draw.text((bx0 + 8, by0 + 5), str(idx), fill=BADGE_TEXT_COLOR, font=font)

                    # 4. Short label near the badge
                    short_label = finding_text[:50] + ("..." if len(finding_text) > 50 else "")
                    lx0 = bx1 + 4
                    ly0 = by0
                    lx1 = lx0 + len(short_label) * 8 + 12
                    ly1 = ly0 + badge_size
                    if lx1 < img_w:
                        draw.rounded_rectangle([lx0, ly0, lx1, ly1], radius=4, fill=LABEL_BG_COLOR)
                        draw.text((lx0 + 6, ly0 + 5), short_label, fill=LABEL_TEXT_COLOR, font=font)

        # Composite overlay with base image
        annotated_img = Image.alpha_composite(img, overlay)
        # Convert back to RGB and save
        annotated_img.convert("RGB").save(dest_path, "PNG")
        logger.info("Created annotated screenshot with %d finding(s): %s", len(findings), dest_path)

    return dest_path
