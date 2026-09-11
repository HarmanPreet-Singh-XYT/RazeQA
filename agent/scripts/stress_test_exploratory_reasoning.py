"""Stress test: does the diff analyzer infer downstream impact from a SHARED
FILE change, without any keyword hints (no "login", "checkout", "payment",
"auth", "form", "validation", "api" in the diff text)?

Context: the fallback heuristic (DiffAnalyzer._fallback_heuristic) is pure
keyword-matching on diff text — it cannot know that a shared util used by
both /login and /checkout affects /checkout unless the diff literally
contains a matching word. This only tells us anything when ANTHROPIC_API_KEY
is set, so the real (Claude-backed) analysis path runs instead of the
fallback — that's the actual claim under test: can the model reason about
cross-file impact the keyword heuristic structurally cannot.

Run: uv run python scripts/stress_test_exploratory_reasoning.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from agent.analyzer.diff_analyzer import DiffAnalyzer  # noqa: E402

# A real diff: renames the shared field-presence check and changes its
# trimming behavior. Deliberately contains ZERO keywords the fallback
# heuristic keys on (no "login"/"auth"/"payment"/"checkout"/"card"/"form"/
# "validation"/"api") — the ONLY way to know this affects /checkout is to
# know form-validation.ts is imported there, which requires either reading
# the surrounding codebase or being told via the intent log.
DIFF = """diff --git a/web/lib/form-validation.ts b/web/lib/form-validation.ts
index 1234567..89abcde 100644
--- a/web/lib/form-validation.ts
+++ b/web/lib/form-validation.ts
@@ -1,6 +1,6 @@
 /** Shared field-presence check used by both the registration form and the
  * checkout billing-address form — trims whitespace so a field containing
  * only spaces is treated as empty. */
-export function isFieldFilled(value: string): boolean {
-  return value.trim().length > 0;
+export function isFieldFilled(value: string | undefined): boolean {
+  return Boolean(value) && value!.length > 0;
 }
"""

# The bug this introduces: value.trim() is dropped, so whitespace-only input
# ("   ") now passes the check. It also silently changes behavior for undefined
# inputs. This is subtle and easy to miss in review — a realistic regression.

INTENTS_EMPTY: list = []


def main() -> None:
    if not os.environ.get("ANTHROPIC_API_KEY"):
        print(
            "ANTHROPIC_API_KEY is not set — this script would only exercise the "
            "pure keyword-matching fallback heuristic, which cannot possibly infer "
            "cross-file impact (it doesn't read any code besides the diff text). "
            "Set ANTHROPIC_API_KEY in agent/.env and re-run to test the real path.",
            file=sys.stderr,
        )
        sys.exit(1)

    analyzer = DiffAnalyzer()
    result = analyzer.analyze(DIFF, INTENTS_EMPTY)

    print("=" * 70)
    print("STRESS TEST: cross-file impact inference without keyword hints")
    print("=" * 70)
    print(f"Risk tag:            {result.risk_tag}")
    print(f"Affected surfaces:   {result.affected_surfaces}")
    print(f"Recommended journeys: {result.recommended_journeys}")
    print(f"Rationale:           {result.rationale}")
    print("=" * 70)

    surfaces_text = " ".join(result.affected_surfaces).lower()
    journeys_text = " ".join(result.recommended_journeys).lower()
    rationale_text = result.rationale.lower()
    mentions_checkout = (
        "checkout" in surfaces_text or "checkout" in journeys_text or "checkout" in rationale_text
    )

    if mentions_checkout:
        print("PASS: analysis correctly flagged /checkout as affected despite the")
        print("      diff containing no checkout-related keywords — this is real")
        print("      cross-file reasoning, not text matching.")
    else:
        print("FAIL: analysis did NOT flag /checkout. Either the model didn't")
        print("      reason about which routes import form-validation.ts, or it")
        print("      needs the surrounding file tree / intent log to do so.")
        print("      This is the gap the demo pitch depends on being real.")
    print("=" * 70)


if __name__ == "__main__":
    main()
