"""Cheap, deterministic checks for "visually broken but structurally fine"
elements — the class of defect a plain visibility check (display:none,
opacity, coverage) cannot catch, because the element genuinely is visible
and reachable; it just looks wrong to a human eye.

These run in-page via getComputedStyle/getBoundingClientRect, no screenshot
or model call needed, so they execute on every candidate element in every
journey for free. They catch the common, mechanically-detectable cases:
low text/background contrast, text clipped by its own container, and
another element's box significantly overlapping this one's without being a
parent/child relationship.

What these CANNOT catch — anything that's a genuine rendering judgment call
(a button that's the "wrong" shade of a brand color, a layout that's
technically fine but looks cramped, an icon that doesn't match its label)
needs actual vision, not CSS math. See visual_heuristics.is_borderline() and
journeys/element_vision.py for the escalation path.
"""

from __future__ import annotations

from dataclasses import dataclass

from playwright.sync_api import Page

# WCAG AA minimum for normal text is 4.5:1, large text/UI components 3:1.
# Below this, treat as a hard visual defect. Between this and the borderline
# ceiling, treat as ambiguous (worth an actual vision check, not confident
# either way from contrast math alone).
CONTRAST_FAIL_THRESHOLD = 2.5
CONTRAST_BORDERLINE_CEILING = 4.5

_HEURISTIC_SCRIPT = """(selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;

    function parseColor(str) {
        const m = str.match(/rgba?\\(([^)]+)\\)/);
        if (!m) return null;
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }

    function relativeLuminance(c) {
        const srgb = [c.r, c.g, c.b].map(v => {
            v = v / 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
        return 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    }

    function contrastRatio(fg, bg) {
        const l1 = relativeLuminance(fg);
        const l2 = relativeLuminance(bg);
        const lighter = Math.max(l1, l2);
        const darker = Math.min(l1, l2);
        return (lighter + 0.05) / (darker + 0.05);
    }

    function effectiveBackground(node) {
        // Walk up until a non-transparent background is found; default to
        // white (the common page background) if the whole ancestry chain
        // is transparent.
        let cur = node;
        while (cur) {
            const style = window.getComputedStyle(cur);
            const bg = parseColor(style.backgroundColor);
            if (bg && bg.a > 0.05) return bg;
            cur = cur.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
    }

    const style = window.getComputedStyle(el);
    const fg = parseColor(style.color) || { r: 0, g: 0, b: 0, a: 1 };
    const bg = effectiveBackground(el);
    const contrast = contrastRatio(fg, bg);

    const textClipped = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;

    // Overlap check: any element (not an ancestor/descendant of this one)
    // whose box meaningfully intersects this element's box.
    const rect = el.getBoundingClientRect();
    const rectArea = Math.max(rect.width * rect.height, 1);
    let overlapRatio = 0;
    let overlappingTag = null;
    const candidates = document.querySelectorAll('div, span, img, section, aside, header, nav');
    for (const other of candidates) {
        if (other === el || el.contains(other) || other.contains(el)) continue;
        const oStyle = window.getComputedStyle(other);
        if (oStyle.display === 'none' || oStyle.visibility === 'hidden' || parseFloat(oStyle.opacity) < 0.05) continue;
        const oRect = other.getBoundingClientRect();
        if (oRect.width <= 0 || oRect.height <= 0) continue;

        const ix = Math.max(0, Math.min(rect.right, oRect.right) - Math.max(rect.left, oRect.left));
        const iy = Math.max(0, Math.min(rect.bottom, oRect.bottom) - Math.max(rect.top, oRect.top));
        const intersection = ix * iy;
        if (intersection <= 0) continue;

        const ratio = intersection / rectArea;
        if (ratio > overlapRatio) {
            overlapRatio = ratio;
            overlappingTag = other.tagName.toLowerCase() + (other.id ? '#' + other.id : '');
        }
    }

    return {
        contrast_ratio: contrast,
        text_clipped: textClipped,
        overlap_ratio: overlapRatio,
        overlapping_with: overlappingTag,
    };
}"""


@dataclass
class VisualHeuristicResult:
    selector: str
    contrast_ratio: float
    text_clipped: bool
    overlap_ratio: float
    overlapping_with: str | None

    @property
    def is_defect(self) -> bool:
        """High-confidence defect: bad enough that CSS math alone is
        sufficient to call it broken, no vision check needed."""
        return (
            self.contrast_ratio < CONTRAST_FAIL_THRESHOLD
            or self.text_clipped
            or self.overlap_ratio > 0.6
        )

    @property
    def is_borderline(self) -> bool:
        """Ambiguous zone: not clean, not confidently broken either — this
        is where an actual vision check earns its cost, versus a clean
        element (skip) or a clear defect (already know it's bad)."""
        if self.is_defect:
            return False
        return (
            CONTRAST_FAIL_THRESHOLD <= self.contrast_ratio < CONTRAST_BORDERLINE_CEILING
            or 0.15 < self.overlap_ratio <= 0.6
        )

    def describe(self) -> str:
        parts = []
        if self.contrast_ratio < CONTRAST_BORDERLINE_CEILING:
            parts.append(f"low text/background contrast ({self.contrast_ratio:.1f}:1)")
        if self.text_clipped:
            parts.append("label text is clipped/overflowing its container")
        if self.overlap_ratio > 0.15:
            target = f" by {self.overlapping_with}" if self.overlapping_with else ""
            parts.append(f"{self.overlap_ratio:.0%} of the element is overlapped{target}")
        return "; ".join(parts) if parts else "no issues detected"


def check_visual_heuristics(page: Page, selector: str) -> VisualHeuristicResult | None:
    """Runs contrast/clipping/overlap checks against a single element.
    Returns None if the selector doesn't resolve to anything (already
    filtered out by is_visible_and_reachable, most likely)."""
    try:
        raw = page.evaluate(_HEURISTIC_SCRIPT, selector)
    except Exception:  # noqa: BLE001
        return None
    if raw is None:
        return None
    return VisualHeuristicResult(
        selector=selector,
        contrast_ratio=raw["contrast_ratio"],
        text_clipped=raw["text_clipped"],
        overlap_ratio=raw["overlap_ratio"],
        overlapping_with=raw.get("overlapping_with"),
    )
