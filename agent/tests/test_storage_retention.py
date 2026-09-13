"""Supabase Storage retention: uploaded artifacts must expire like local ones.

The private `run-artifacts` bucket had no deletion path at all, so videos,
traces and screenshots accumulated forever even after their local copies were
swept by `cleanup_local_artifacts`.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from agent.db.storage import SupabaseArtifactStorage
from agent.runner import retention


class _FakeBucket:
    def __init__(self, tree: dict[str, list[dict]], removed: list[list[str]]):
        self._tree = tree
        self._removed = removed

    def list(self, prefix: str, options: dict | None = None):  # noqa: ARG002
        return list(self._tree.get(prefix, []))

    def remove(self, paths: list[str]):
        self._removed.append(list(paths))
        return [{"name": p} for p in paths]


class _FakeStorageApi:
    def __init__(self, bucket: _FakeBucket):
        self._bucket = bucket

    def from_(self, _name: str) -> _FakeBucket:
        return self._bucket


class _FakeClient:
    def __init__(self, bucket: _FakeBucket):
        self.storage = _FakeStorageApi(bucket)


def _tree() -> dict[str, list[dict]]:
    old = (datetime.now(UTC) - timedelta(days=30)).isoformat()
    fresh = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    return {
        "runs": [
            {"name": "run_old", "id": None},
            {"name": "run_new", "id": None},
        ],
        "runs/run_old": [{"name": "video", "id": None}],
        "runs/run_old/video": [
            {"name": "page.mp4", "id": "1", "created_at": old, "updated_at": old}
        ],
        "runs/run_new": [{"name": "video", "id": None}],
        "runs/run_new/video": [
            {"name": "page.mp4", "id": "2", "created_at": fresh, "updated_at": fresh}
        ],
    }


def test_collect_objects_older_than_walks_the_hierarchy():
    removed: list[list[str]] = []
    storage = SupabaseArtifactStorage(client=_FakeClient(_FakeBucket(_tree(), removed)))

    stale = storage.collect_objects_older_than(7 * 86400)

    assert stale == ["runs/run_old/video/page.mp4"]


def test_delete_objects_batches_and_reports_count():
    removed: list[list[str]] = []
    storage = SupabaseArtifactStorage(client=_FakeClient(_FakeBucket(_tree(), removed)))

    count = storage.delete_objects(["a/1.mp4", "a/2.mp4"])

    assert count == 2
    assert removed == [["a/1.mp4", "a/2.mp4"]]


def test_delete_objects_is_a_noop_without_paths():
    removed: list[list[str]] = []
    storage = SupabaseArtifactStorage(client=_FakeClient(_FakeBucket(_tree(), removed)))
    assert storage.delete_objects([]) == 0
    assert removed == []


def test_cleanup_supabase_artifacts_deletes_only_expired(monkeypatch):
    removed: list[list[str]] = []
    storage = SupabaseArtifactStorage(client=_FakeClient(_FakeBucket(_tree(), removed)))
    monkeypatch.setattr("agent.db.storage.default_artifact_storage", storage)

    deleted = retention.cleanup_supabase_artifacts(max_age_seconds=7 * 86400)

    assert deleted == 1
    assert removed == [["runs/run_old/video/page.mp4"]]


def test_cleanup_supabase_artifacts_is_safe_when_unconfigured(monkeypatch):
    class _Unavailable:
        def is_available(self) -> bool:
            return False

    monkeypatch.setattr("agent.db.storage.default_artifact_storage", _Unavailable())
    assert retention.cleanup_supabase_artifacts() == 0
