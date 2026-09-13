"""Tests for the verification rules — the part that decides what "fixed" means."""

from __future__ import annotations

from agent.review.verification import (
    RegressionEvidence,
    ScopedFile,
    ScopeLimits,
    VerificationInput,
    check_scope,
    evaluate_verification,
    is_protected_path,
)


def test_protected_paths_cover_tests_ci_and_lint_config():
    for path in (
        "tests/test_auth.py",
        "src/__tests__/login.test.tsx",
        "app/login.spec.ts",
        "internal/api/handler_test.go",
        "conftest.py",
        "pkg/testdata/input.json",
        ".github/workflows/ci.yml",
        ".gitlab-ci.yml",
        "Jenkinsfile",
        "eslint.config.js",
        ".eslintrc.json",
        "ruff.toml",
        "pytest.ini",
        "jest.config.ts",
        "mypy.ini",
        "src/components/__snapshots__/Button.snap",
    ):
        assert is_protected_path(path), f"{path} should be protected"


def test_ordinary_source_paths_are_not_protected():
    for path in (
        "src/auth.py",
        "web/app/login/page.tsx",
        "internal/api/handler.go",
        "lib/latest/thing.py",
        "src/contest/entry.py",
        "README.md",
    ):
        assert not is_protected_path(path), f"{path} should not be protected"


def test_modifying_an_existing_test_is_a_hard_violation():
    """This is the cheapest way to make any gate pass, so it is structural."""
    violations = check_scope([ScopedFile("tests/test_auth.py", "modified")], changed_lines=3)
    assert len(violations) == 1
    assert violations[0].kind == "protected_path_modified"


def test_deleting_or_renaming_ci_config_is_a_violation():
    assert check_scope([ScopedFile(".github/workflows/ci.yml", "deleted")], 1)
    assert check_scope([ScopedFile("eslint.config.js", "modified")], 1)


def test_adding_a_new_test_file_is_allowed_by_default():
    """The pipeline *requires* a regression test, so a brand-new test file cannot
    be a violation — the distinction is add vs edit."""
    assert check_scope([ScopedFile("tests/test_regression.py", "added")], changed_lines=10) == []


def test_adding_a_new_test_file_can_be_disallowed():
    violations = check_scope(
        [ScopedFile("tests/test_regression.py", "added")],
        changed_lines=10,
        limits=ScopeLimits(allow_new_test_files=False),
    )
    assert [v.kind for v in violations] == ["protected_path_added"]


def test_adding_a_new_ci_workflow_or_lint_config_is_a_violation():
    """Only a *new test* earns the exemption.

    Adding a workflow or a lint config is not a regression proof — it redefines
    the gate the patch is about to be judged by, which is the same attack as
    editing one.
    """
    for path in (
        ".github/workflows/agent.yml",
        ".gitlab-ci.yml",
        "eslint.config.js",
        "pytest.ini",
        "ruff.toml",
    ):
        violations = check_scope([ScopedFile(path, "added")], changed_lines=5)
        assert [v.kind for v in violations] == ["protected_path_added"], path


def test_test_paths_and_gate_config_paths_are_distinct():
    from agent.review.verification import is_gate_config_path, is_test_path

    assert is_test_path("tests/test_auth.py") is True
    assert is_gate_config_path("tests/test_auth.py") is False

    assert is_gate_config_path(".github/workflows/ci.yml") is True
    assert is_test_path(".github/workflows/ci.yml") is False

    assert is_test_path("src/app.py") is False
    assert is_gate_config_path("src/app.py") is False


def test_scope_budget_rejects_oversized_patches():
    files = [ScopedFile(f"src/mod{i}.py", "modified") for i in range(9)]
    violations = check_scope(files, changed_lines=10, limits=ScopeLimits(max_files=8))
    assert [v.kind for v in violations] == ["too_many_files"]

    violations = check_scope([ScopedFile("src/a.py", "modified")], changed_lines=500)
    assert [v.kind for v in violations] == ["diff_too_large"]


def _evidence(**kwargs) -> RegressionEvidence:
    base = {"published": True, "failed_before": True, "passed_after": True}
    base.update(kwargs)
    return RegressionEvidence(**base)


def test_green_suite_alone_is_not_evidence():
    """A patch with no regression test cannot be accepted: there is no evidence
    the defect was reproducible at all."""
    report = evaluate_verification(
        VerificationInput(evidence=RegressionEvidence(published=False), build_passed=True, suite_passed=True)
    )
    assert report.passed is False
    assert "no regression test" in " ".join(report.reasons)


def test_test_that_passes_before_the_fix_is_not_evidence():
    report = evaluate_verification(
        VerificationInput(evidence=_evidence(failed_before=False), build_passed=True, suite_passed=True)
    )
    assert report.passed is False
    assert "did not fail before the fix" in " ".join(report.reasons)


def test_build_and_suite_must_still_pass():
    build_fail = evaluate_verification(
        VerificationInput(evidence=_evidence(), build_passed=False, suite_passed=True)
    )
    assert build_fail.passed is False
    assert "build failed" in " ".join(build_fail.reasons)

    suite_fail = evaluate_verification(
        VerificationInput(evidence=_evidence(), build_passed=True, suite_passed=False)
    )
    assert suite_fail.passed is False
    assert "suite failed" in " ".join(suite_fail.reasons)


def test_falsified_patch_is_rejected_and_missing_critic_is_a_warning():
    refuted = evaluate_verification(
        VerificationInput(
            evidence=_evidence(),
            build_passed=True,
            suite_passed=True,
            critic_refuted=True,
            critic_reason="the patch swallows the exception",
        )
    )
    assert refuted.passed is False
    assert "critic refuted" in " ".join(refuted.reasons)

    uncriticised = evaluate_verification(
        VerificationInput(evidence=_evidence(), build_passed=True, suite_passed=True, critic_refuted=None)
    )
    # No critic is not a pass signal, but it is not a failure either — it is
    # recorded so the reader knows the patch was never adversarially challenged.
    assert uncriticised.passed is True
    assert "no critic was run" in " ".join(uncriticised.warnings)


def test_scope_violation_fails_even_with_perfect_evidence():
    report = evaluate_verification(
        VerificationInput(
            files=[ScopedFile("tests/test_auth.py", "modified")],
            evidence=_evidence(),
            build_passed=True,
            suite_passed=True,
            scope_violations=check_scope([ScopedFile("tests/test_auth.py", "modified")], 5),
        )
    )
    assert report.passed is False
    assert report.checks["scope"] is False


def test_every_failure_is_reported_not_just_the_first():
    """A rejected attempt should tell the reader everything that was wrong."""
    report = evaluate_verification(
        VerificationInput(
            evidence=RegressionEvidence(published=False),
            build_passed=False,
            suite_passed=False,
            scope_violations=check_scope([ScopedFile("tests/a.py", "modified")], 1),
        )
    )
    assert report.passed is False
    assert len(report.reasons) >= 4
    assert set(report.checks) >= {
        "scope",
        "regression_test_published",
        "test_fails_before_fix",
        "test_passes_after_fix",
        "build_passed",
        "suite_passed",
        "not_refuted",
    }


def test_unconfigured_build_and_suite_are_warnings_not_verified_checks():
    report = evaluate_verification(
        VerificationInput(
            evidence=_evidence(),
            build_passed=True,
            suite_passed=True,
            build_ran=False,
            suite_ran=False,
        )
    )
    assert report.passed is True
    assert "not compiled" in " ".join(report.warnings)
    assert "only the regression test was run" in " ".join(report.warnings)
