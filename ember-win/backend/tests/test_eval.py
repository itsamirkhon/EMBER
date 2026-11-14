import json
from pathlib import Path

import pytest

from eval.metrics import applicability_metrics, ndcg_at_k, recall_at_k
from eval.run_eval import LABEL, assign_splits, load_gold, run, validate_gold
from ember.corpus import load_corpus

C = load_corpus()


def test_retrieval_metrics():
    assert recall_at_k(["a", "b", "c"], ["a", "z"], 3) == 0.5
    assert ndcg_at_k(["a", "b"], ["a"], 5) == 1.0
    assert ndcg_at_k(["b", "a"], ["a"], 5) < 1.0
    assert ndcg_at_k([], ["a"], 5) == 0.0


def test_applicability_metrics_confusion_and_rates():
    pairs = [("direct", "direct"), ("limited_context", "insufficient_data"), ("incompatible", "direct"), ("insufficient_data", "insufficient_data")]
    m = applicability_metrics(pairs)
    assert m["accuracy"] == 0.5
    assert m["confusion"]["limited_context"]["insufficient_data"] == 1
    assert m["false_refusal_rate"] == 0.5          # 1 of 2 gold-usable cases refused
    assert m["over_acceptance_rate"] == 0.5        # 1 of 2 gold-not-usable cases accepted
    assert m["per_class"]["direct"]["precision"] == 0.5 and m["per_class"]["direct"]["recall"] == 1.0
    assert applicability_metrics([])["n"] == 0


def test_gold_is_valid_and_covers_categories():
    gold = load_gold()
    assert validate_gold(gold, C) == []
    assert len(gold) >= 30
    cats = {c["category"] for c in gold}
    assert {"retrieval", "applicability", "protocol_outcome", "config_change", "insufficient_data"} <= cats
    tags = {t for c in gold for t in c["tags"]}
    assert {"positive", "false_premise", "hard_case", "operator_termination", "planned_vs_observed", "ambient_vs_oxidizer_stream",
            "actual_vs_simulated_gravity", "same_initial_flow_different_history", "substrate", "hot_extinction_cool_burning"} <= tags
    positives = [c for c in gold if c["type"] == "applicability" and c["expected"] in ("direct", "limited_context")]
    assert len(positives) >= 8  # 'always insufficient' must fail


def test_validate_gold_catches_errors():
    bad = [{"id": "x", "group": "g", "category": "applicability", "type": "applicability", "tags": [], "query": {"question": "q"}, "test_id": "t_nope", "expected": "maybe"}]
    assert len(validate_gold(bad, C)) == 2


def test_splits_by_group_stable_and_disjoint():
    gold = load_gold()
    a, b = assign_splits(gold), assign_splits(list(reversed(gold)))
    assert a == b
    assert set(a.values()) == {"dev", "validation", "test"}
    # all cases of a group share a split by construction; each split is non-empty
    per = {s: sum(1 for c in gold if a[c["group"]] == s) for s in set(a.values())}
    assert all(v > 0 for v in per.values())


def test_run_labels_and_baselines():
    res = run()
    assert res["status"] == "measured" and res["label"] == LABEL
    assert "not independent scientific validation" in res["label"]
    assert res["baseline_tuning"]["A"]["tuned_on"] == "dev"
    allapp = res["applicability"]["all"]
    assert allapp["Z_always_insufficient"]["false_refusal_rate"] == 1.0  # always-insufficient fails the positive cases
    assert allapp["D"]["false_refusal_rate"] is not None and allapp["D"]["accuracy"] > allapp["A"]["accuracy"]
    assert allapp["D"]["accuracy"] > allapp["C"]["accuracy"]
    assert res["endpoint_support"]["all"]["A"] == "not measured"
    assert res["caveats"] and "failures_D" in res


def test_stored_results_file_present_and_labelled():
    p = Path(__file__).resolve().parent.parent / "eval" / "results.json"
    d = json.loads(p.read_text())
    assert d["status"] == "measured" and "preliminary team evaluation" in d["label"]
