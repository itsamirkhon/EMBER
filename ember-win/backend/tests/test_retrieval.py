import pytest

from ember.corpus import load_corpus
from ember.retrieval import BM25, DenseRetriever, JevRetriever, NotEnabled, Retriever, rrf, tokenize
from tests.helpers import q

C = load_corpus()
R = Retriever(C)


def test_tokenize_and_bm25_ranking():
    idx = BM25([("a", "pmma rod flame extinction"), ("b", "smoke aerosol particle detector"), ("c", "pmma sheet spread")])
    r = idx.search("smoke detector")
    assert r[0][0] == "b"
    assert idx.search("zzzz") == []
    assert tokenize("Flow-Reduction, O2!") == ["flow", "reduction", "o2"]


def test_bm25_idf_rare_term_wins():
    idx = BM25([("a", "flame flame flame"), ("b", "flame cool"), ("c", "flame spread")])
    assert idx.search("cool flame")[0][0] == "b"


def test_rrf_fuses_and_is_deterministic():
    fused = rrf([["a", "b", "c"], ["c", "a"]])
    assert [x for x, _ in fused][0] == "a"
    assert rrf([["a", "b"], ["b", "a"]]) == rrf([["a", "b"], ["b", "a"]])
    ids = [x for x, _ in rrf([["x"], ["y"]])]
    assert ids == ["x", "y"]  # tie broken stably


def test_investigation_search_text_and_why():
    hits = R.search_investigations("smoke particle size detector")
    assert hits[0].id == "inv_same" and "BM25" in hits[0].why and "smoke" in hits[0].why.lower()
    hits = R.search_investigations("cool flame after hot flame extinction droplet")
    assert hits[0].id == "inv_flex2"


def test_filters_are_hard():
    hits = R.search_investigations(None, topic="detection")
    assert [h.id for h in hits] == ["inv_same"]
    assert {h.id for h in R.search_investigations(None, material="PMMA")} == {"inv_bass2"}
    assert {h.id for h in R.search_investigations(None, platform="cygnus")} == {"inv_saffire1", "inv_saffire2", "inv_saffire3"}
    assert R.search_investigations("pmma", topic="detection") == []


def test_test_level_search_returns_tests():
    hits = R.search_tests("operator termination rod PMMA")
    assert hits and all(h.id in C.tests for h in hits)
    hits = R.search_tests("cool flame", investigation_ids=["inv_flex2"])
    assert [h.id for h in hits] == ["t_flex2_heptane_cool"]


def test_structured_rank_uses_query_config():
    hits = R.rank_for_query(q("cool_burning", material="n-heptane", shape="droplet"))
    assert hits[0].id in ("inv_flex2", "inv_flex")
    top = [h.id for h in hits[:2]]
    assert "inv_flex2" in top
    assert hits[0].why


def test_dense_and_jev_are_flag_off_stubs():
    for cls in (DenseRetriever, JevRetriever):
        s = cls()
        assert s.enabled is False
        with pytest.raises(NotEnabled):
            s.search("x")
