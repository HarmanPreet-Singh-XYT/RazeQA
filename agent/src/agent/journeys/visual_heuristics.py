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

    // Resolve a CSS colour to sRGB by painting one pixel and reading it back.
    //
    // This used to be a regex for rgb()/rgba(). Every modern syntax —
    // lab(), oklch(), color(display-p3 …), which Tailwind v4 and current
    // design systems emit — fell through to the `|| black` fallback. Light
    // text on a dark hero was therefore measured as black-on-dark and
    // reported as "low text/background contrast (1.1:1)". The browser knows
    // every colour space; let it do the conversion.
    const _cv = document.createElement('canvas');
    _cv.width = 1;
    _cv.height = 1;
    const _ctx = _cv.getContext('2d', { willReadFrequently: true });

    function parseColor(str) {
        if (!str) return null;
        try {
            _ctx.clearRect(0, 0, 1, 1);
            _ctx.fillStyle = 'rgba(0, 0, 0, 0)';
            _ctx.fillStyle = str;
            _ctx.fillRect(0, 0, 1, 1);
            const d = _ctx.getImageData(0, 0, 1, 1).data;
            return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 };
        } catch (e) {
            return null;
        }
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
            // A gradient or image background cannot be reduced to a single
            // colour. Walking past it and using some further ancestor's colour
            // measured text against a background it is not painted on, so
            // report "unknown" and claim nothing rather than inventing a
            // defect — or paying for a vision call on every gradient panel.
            if (style.backgroundImage && style.backgroundImage !== 'none') return null;
            cur = cur.parentElement;
        }
        return { r: 255, g: 255, b: 255, a: 1 };
    }

    // Does this element's background-image actually hide anything? A gradient
    // made of 7%-alpha lines does not, and a decorative grid overlay was
    // otherwise reported as "100% of the element is overlapped by div" on five
    // hero controls — where it is not even painted above them.
    const _NAMED_COLORS =
        /\\b(?:white|black|red|green|blue|gray|grey|transparent|currentcolor|yellow|orange|purple|pink|teal|cyan|magenta|lime|navy|maroon|olive|silver|aqua|fuchsia)\\b/gi;

    function imageObscures(bgImage) {
        if (!bgImage || bgImage === 'none') return false;
        // A referenced image paints content that cannot be introspected.
        if (bgImage.indexOf('url(') !== -1) return true;
        const tokens = bgImage.match(
            /rgba?\\([^)]*\\)|oklch\\([^)]*\\)|lab\\([^)]*\\)|color\\([^)]*\\)|#[0-9a-fA-F]{3,8}/g
        ) || [];
        const named = bgImage.match(_NAMED_COLORS) || [];
        let maxAlpha = 0;
        for (const token of tokens.concat(named)) {
            const c = parseColor(token);
            if (c && c.a > maxAlpha) maxAlpha = c.a;
        }
        return maxAlpha > 0.5;
    }

    // An element only overlaps *visually* if it actually paints something
    // opaque there. The old check counted any geometrically intersecting
    // sibling, so a fully transparent panel (background: rgba(0,0,0,0)) sitting
    // over a button was reported as "100% of the element is overlapped by div"
    // — 28 such findings on a single healthy marketing site.
    function paints(other) {
        const s = window.getComputedStyle(other);
        if (s.display === 'none' || s.visibility === 'hidden') return false;
        if (parseFloat(s.opacity) < 0.05) return false;
        const bg = parseColor(s.backgroundColor);
        if (bg && bg.a > 0.5) return true;
        if (imageObscures(s.backgroundImage)) return true;
        const tag = other.tagName.toLowerCase();
        return tag === 'img' || tag === 'canvas' || tag === 'video' || tag === 'svg';
    }

    const style = window.getComputedStyle(el);
    const fg = parseColor(style.color);
    const bg = effectiveBackground(el);
    const contrast = (fg && bg) ? contrastRatio(fg, bg) : null;

    const textClipped = el.scrollWidth > el.clientWidth + 2 || el.scrollHeight > el.clientHeight + 2;

    // Overlap check: any painted element (not an ancestor/descendant of this
    // one) whose box meaningfully intersects this element's box.
    const rect = el.getBoundingClientRect();
    const rectArea = Math.max(rect.width * rect.height, 1);
    let overlapRatio = 0;
    let overlappingTag = null;
    const candidates = document.querySelectorAll('div, span, img, section, aside, header, nav');
    for (const other of candidates) {
        if (other === el || el.contains(other) || other.contains(el)) continue;
        if (!paints(other)) continue;
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
    # None when the background could not be reduced to a colour (a gradient or
    # image sits behind the element). Unmeasured is not the same as bad.
    contrast_ratio: float | None
    text_clipped: bool
    overlap_ratio: float
    overlapping_with: str | None

    @property
    def is_defect(self) -> bool:
        """High-confidence defect: bad enough that CSS math alone is
        sufficient to call it broken, no vision check needed."""
        return (
            (self.contrast_ratio is not None and self.contrast_ratio < CONTRAST_FAIL_THRESHOLD)
            or self.text_clipped
            or self.overlap_ratio > 0.6
        )

    @property
    def is_borderline(self) -> bool:
        """Ambiguous zone: not clean, not confidently broken either — this
        is where an actual vision check earns its cost, versus a clean
        element (skip) or a clear defect (already know it's bad).

        An unmeasurable contrast is deliberately *not* borderline: escalating
        every element that happens to sit on a gradient would fire a vision
        call per element per route, and we would be paying to re-answer a
        question we never actually asked.
        """
        if self.is_defect:
            return False
        return (
            (self.contrast_ratio is not None
             and CONTRAST_FAIL_THRESHOLD <= self.contrast_ratio < CONTRAST_BORDERLINE_CEILING)
            or 0.15 < self.overlap_ratio <= 0.6
        )

    def describe(self) -> str:
        parts = []
        if self.contrast_ratio is not None and self.contrast_ratio < CONTRAST_BORDERLINE_CEILING:
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
