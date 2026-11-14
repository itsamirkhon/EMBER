import pytest

from ember.corpus import load_corpus
from ember.pipeline import analyse
from ember.retrieval import Retriever
from ember.store import IdempotencyConflict, Store
from tests.helpers import q

C = load_corpus()
R = Retriever(C)


@pytest.fixture
def store(tmp_path):
    return Store(tmp_path / "ember.db")


def mk(i="rev_1"):
    return analyse(q(), C, R, review_id=i, created="2026-01-01T00:00:00Z")


def test_roundtrip_and_reopen_without_regeneration(store, tmp_path):
    r = mk()
    store.save_review(r)
    store.close()
    s2 = Store(tmp_path / "ember.db")
    got = s2.get_review("rev_1")
    assert got == r and got.created == "2026-01-01T00:00:00Z"
    assert s2.get_review("nope") is None


def test_revisions_recorded_and_bumped(store):
    r = mk()
    store.save_review(r)
    r2 = r.model_copy(update={"warnings": ["x"]})
    out = store.update_review(r2, reason="edit")
    assert out.revision == 2 and store.get_review("rev_1").revision == 2
    revs = store.revisions("rev_1")
    assert [x["revision"] for x in revs] == [1, 2] and revs[1]["reason"] == "edit"


def test_idempotency_same_key_same_body(store):
    assert store.idem_get("POST /reviews", "k1") is None
    r = mk()
    store.save_review(r, idem=("POST /reviews", "k1", "hash1", {"review_id": r.id}))
    hit = store.idem_get("POST /reviews", "k1")
    assert hit == ("hash1", {"review_id": "rev_1"})
    with pytest.raises(IdempotencyConflict):
        store.save_review(mk("rev_2"), idem=("POST /reviews", "k1", "hash2", {"review_id": "rev_2"}))
    assert store.get_review("rev_2") is None  # transaction rolled back, no orphan


def test_failed_save_is_atomic(store):
    r = mk()
    store.save_review(r)
    with pytest.raises(Exception):
        store.save_review(r)  # duplicate id
    assert len(store.list_reviews()) == 1


def test_runs_and_crash_recovery(store):
    store.create_run("run_1", "queued")
    store.update_run("run_1", "running", stage="retrieval")
    assert store.get_run("run_1")["status"] == "running"
    assert store.recover() == 1
    run = store.get_run("run_1")
    assert run["status"] == "error" and "interrupted" in run["error"]


def test_list_reviews_summary(store):
    store.save_review(mk("rev_a"))
    store.save_review(mk("rev_b"))
    rows = store.list_reviews()
    assert {r["id"] for r in rows} == {"rev_a", "rev_b"} and "created" in rows[0] and "mode" in rows[0]
