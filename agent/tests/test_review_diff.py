"""Tests for unified-diff parsing: file status, introduced-vs-inherited, subsets."""

from __future__ import annotations

from agent.review.diff import parse_unified_diff, select_diff_sections

MODIFIED_AND_ADDED = """diff --git a/src/auth.py b/src/auth.py
index 1111111..2222222 100644
--- a/src/auth.py
+++ b/src/auth.py
@@ -10,6 +10,8 @@ def login(user, pw):
     if not user:
         return None
+    if not pw:
+        raise ValueError("empty password")
     return check(user, pw)
diff --git a/tests/test_auth.py b/tests/test_auth.py
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/tests/test_auth.py
@@ -0,0 +1,4 @@
+def test_empty_password_rejected():
+    assert login("u", "") is None
"""


def test_parses_status_and_added_lines():
    index = parse_unified_diff(MODIFIED_AND_ADDED)
    assert set(index.paths) == {"src/auth.py", "tests/test_auth.py"}
    assert index.files["src/auth.py"].status == "modified"
    assert index.files["tests/test_auth.py"].status == "added"
    assert index.files["src/auth.py"].added_lines == {12, 13}
    assert index.files["tests/test_auth.py"].added_lines == {1, 2}
    assert index.added_line_count == 4


def test_introduced_classification():
    """A finding on an added line is introduced; on an untouched line of a touched
    file it is inherited; in an untouched file it is inherited too."""
    index = parse_unified_diff(MODIFIED_AND_ADDED)
    assert index.introduces("src/auth.py", 12) is True
    assert index.introduces("src/auth.py", 11) is False
    assert index.introduces("src/elsewhere.py", 1) is False
    # Unknown line: the file is in the change, so default to introduced rather
    # than quietly downgrading a real finding.
    assert index.introduces("src/auth.py", None) is True


def test_deleted_file_status():
    diff = """diff --git a/src/legacy.py b/src/legacy.py
deleted file mode 100644
--- a/src/legacy.py
+++ /dev/null
@@ -1,2 +0,0 @@
-x = 1
-y = 2
"""
    index = parse_unified_diff(diff)
    assert index.files["src/legacy.py"].status == "deleted"
    assert index.files["src/legacy.py"].removed_lines == {1, 2}
    assert index.files["src/legacy.py"].added_lines == set()


def test_select_diff_sections_produces_applicable_subset():
    test_only = select_diff_sections(MODIFIED_AND_ADDED, lambda f: f.is_new)
    source_only = select_diff_sections(MODIFIED_AND_ADDED, lambda f: not f.is_new)

    assert "tests/test_auth.py" in test_only
    assert "src/auth.py" not in test_only
    assert "src/auth.py" in source_only
    assert "tests/test_auth.py" not in source_only

    # Both halves must still parse, and together they must account for the whole diff.
    assert set(parse_unified_diff(test_only).paths) == {"tests/test_auth.py"}
    assert set(parse_unified_diff(source_only).paths) == {"src/auth.py"}


def test_empty_and_garbage_inputs_are_safe():
    assert parse_unified_diff("").paths == []
    assert parse_unified_diff("not a diff at all").paths == []
    assert select_diff_sections("", lambda f: True) == ""


def test_bare_unified_patch_without_git_header():
    """A patch produced by `diff -u` has no `diff --git` line and must still parse."""
    diff = """--- a/src/app.py
+++ b/src/app.py
@@ -1,3 +1,4 @@
 import os
+import sys
 x = 1
"""
    index = parse_unified_diff(diff)
    assert "src/app.py" in index.files
    assert index.files["src/app.py"].added_lines == {2}
