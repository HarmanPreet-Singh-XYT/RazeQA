"""Unit tests for Multi-Paradigm Code Fix Synthesizer and anchor-context patching."""

import pytest
from pathlib import Path

from agent.analyzer.diff_analyzer import AnalysisResult
from agent.bridge.models import IntentEvent
from agent.remediation.fix_synthesizer import (
    FilePatch,
    FixProposal,
    FixSynthesizer,
    NO_LLM,
    apply_patch_to_text,
    create_unified_diff,
    detect_styling_and_logic_paradigm,
)


def test_detect_styling_and_logic_paradigm():
    # 1. TailwindCSS in JSX/TSX
    tailwind_code = '<div className="flex items-center space-x-4 max-h-[300px] overflow-y-auto">Hello</div>'
    assert detect_styling_and_logic_paradigm(tailwind_code, "app/page.tsx") == "tailwind"

    # 2. CSS Modules
    css_mod_code = 'import styles from "./button.module.css";\nexport function Btn() { return <div className={styles.btn} />; }'
    assert detect_styling_and_logic_paradigm(css_mod_code, "components/button.tsx") == "css_modules"
    assert detect_styling_and_logic_paradigm(".btn { color: red; }", "button.module.css") == "css_modules"

    # 3. CSS-in-JS (Styled-Components / Emotion)
    styled_code = 'import styled from "styled-components";\nconst Box = styled.div`color: blue;`;'
    assert detect_styling_and_logic_paradigm(styled_code, "components/box.tsx") == "css_in_js"

    # 4. Inline Styles
    inline_code = '<div style={{ overflowY: "auto", maxHeight: "400px" }}>Content</div>'
    assert detect_styling_and_logic_paradigm(inline_code, "app/layout.tsx") == "inline_style"

    # 5. Vanilla CSS
    vanilla_code = ".container { display: flex; width: 100%; }"
    assert detect_styling_and_logic_paradigm(vanilla_code, "styles/main.css") == "vanilla_css"

    # 6. Logic / TypeScript
    logic_code = "export function validatePhone(p: string): boolean { return /^[0-9]+$/.test(p); }"
    assert detect_styling_and_logic_paradigm(logic_code, "lib/validation.ts") == "logic"


def test_apply_patch_to_text_exact_and_anchor():
    original_file = """import React from 'react';

export default function CheckoutForm() {
  const isPhoneValid = /^+1\\d{10}$/.test(phone);
  return <form>Checkout</form>;
}
"""
    # 1. Exact match patch
    patch_exact = FilePatch(
        file_path="app/checkout/page.tsx",
        original_snippet="  const isPhoneValid = /^+1\\d{10}$/.test(phone);",
        replacement_snippet="  const isPhoneValid = /^\\+?[\\d\\s-]{10,15}$/.test(phone);",
    )
    updated, ok = apply_patch_to_text(original_file, patch_exact)
    assert ok is True
    assert "const isPhoneValid = /^\\+?[\\d\\s-]{10,15}$/.test(phone);" in updated

    # 2. Whitespace-tolerant anchor match
    patch_whitespace = FilePatch(
        file_path="app/checkout/page.tsx",
        original_snippet="const isPhoneValid = /^+1\\d{10}$/.test(phone);",
        replacement_snippet="const isPhoneValid = /^\\+?[\\d\\s-]{10,15}$/.test(phone);",
    )
    updated2, ok2 = apply_patch_to_text(original_file, patch_whitespace)
    assert ok2 is True
    assert "const isPhoneValid = /^\\+?[\\d\\s-]{10,15}$/.test(phone);" in updated2

    # 3. Ambiguous anchor rejected safely
    duplicate_file = "<div>test</div>\n<div>test</div>\n"
    patch_ambiguous = FilePatch(
        file_path="app/page.tsx",
        original_snippet="<div>test</div>",
        replacement_snippet="<div>fixed</div>",
    )
    _, ok3 = apply_patch_to_text(duplicate_file, patch_ambiguous)
    assert ok3 is False  # Refused replacement to avoid corrupting duplicate blocks

    # 4. Whole-file replace (agentic repair): full_content wins outright,
    # regardless of original_snippet/replacement_snippet.
    patch_full = FilePatch(
        file_path="app/checkout/page.tsx",
        original_snippet="",
        replacement_snippet="",
        full_content="export default function CheckoutForm() { return null; }\n",
    )
    updated4, ok4 = apply_patch_to_text(original_file, patch_full)
    assert ok4 is True
    assert updated4 == "export default function CheckoutForm() { return null; }\n"


def test_fix_synthesizer_heuristic(tmp_path: Path):
    sample_checkout = tmp_path / "app" / "checkout" / "page.tsx"
    sample_checkout.parent.mkdir(parents=True)
    sample_checkout.write_text(
        """import React, { useState } from 'react';

export default function CheckoutPage() {
  const [phone, setPhone] = useState('');
  const isPhoneValid = /^+1\\d{10}$/.test(phone);
  return (
    <div className="flex flex-col">
      <div id="cart-items-scroll" className="flex flex-col space-y-2">
        <span>Item 1</span>
      </div>
    </div>
  );
}
""",
        encoding="utf-8",
    )

    synthesizer = FixSynthesizer(api_key=NO_LLM)  # Test deterministic heuristic
    analysis = AnalysisResult(
        affected_surfaces=["/checkout"],
        risk_tag="High",
        rationale="Phone validation broke Apple Pay express checkout",
    )
    intents = [
        IntentEvent(
            branch="feature/checkout",
            files=["app/checkout/page.tsx"],
            action="edit",
            prompt_summary="Add strict phone validation rule",
            reasoning="Enforce US domestic phone format",
        )
    ]

    proposal = synthesizer.synthesize(
        journey_name="exploratory:/checkout",
        error="Locator('#apple-pay-btn') failed: Phone input validation rejected format",
        analysis=analysis,
        intents=intents,
        source_root=tmp_path,
    )

    assert isinstance(proposal, FixProposal)
    assert len(proposal.patches) >= 1
    assert "phone" in proposal.patches[0].explanation.lower() or "validation" in proposal.patches[0].explanation.lower()
    assert proposal.patches[0].unified_diff != ""


def test_credential_redaction_in_diff():
    synth = FixSynthesizer(api_key=NO_LLM)
    analysis = AnalysisResult(affected_surfaces=["/checkout"], risk_tag="High")
    intents = [
        IntentEvent(
            branch="feature/checkout",
            files=["app/checkout/page.tsx"],
            action="edit",
            prompt_summary="Use secret token ghp_ABC1234567890123456789012345678901234567",
            reasoning="Auth with bearer secret_token_12345",
        )
    ]

    proposal = synth.synthesize(
        journey_name="exploratory:/checkout",
        error="Failed with token ghp_ABC1234567890123456789012345678901234567 and password SuperSecretPassword123!",
        analysis=analysis,
        intents=intents,
    )

    for p in proposal.patches:
        assert "ghp_" not in p.unified_diff
        assert "SuperSecretPassword123!" not in p.unified_diff
        assert "SuperSecretPassword123!" not in proposal.root_cause
