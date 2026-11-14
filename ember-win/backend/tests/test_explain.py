import json

from ember.explain import deterministic_explanation, evidence_package, explain, verify_text
from ember.models import Explanation
from ember.pipeline import analyse
from tests.helpers import q
from ember.corpus import load_corpus
from ember.retrieval import Retriever

C = load_corpus()
R = Retriever(C)


def review():
    return analyse(q("extinction_under_flow_reduction", thickness_mm=3.0), C, R, review_id="rev_t", created="2026-01-01T00:00:00Z")


def test_deterministic_is_labelled_and_layered():
    r = review()
    e = deterministic_explanation(r)
    assert e.mode == "deterministic" and e.model is None
    text = e.summary + " ".join(e.paragraphs)
    assert text.startswith("Observation") or "Observation:" in text
    for label in ("Observation:", "Interpretation:", "Possible application:", "Missing:"):
        assert label in " ".join(e.paragraphs), label
    assert verify_text(" ".join([e.summary, *e.paragraphs]), evidence_package(r)) == []


def test_verifier_rejects_invented_number_unit_and_source_id():
    r = review()
    pkg = evidence_package(r)
    assert verify_text("The flame went out at 47 cm/s.", pkg)
    assert verify_text("Thickness 3 mm was used.", pkg) == []
    assert verify_text("Thickness 3 kPa was used.", pkg)  # wrong unit for that number
    assert verify_text("See t_made_up_test for details.", pkg)
    assert verify_text("This proves the flow caused extinction.", pkg)


def test_live_success_is_labelled_live_ai():
    r = review()
    good = json.dumps({"summary": "Observation: records of PMMA rod flow reduction exist.", "paragraphs": ["Missing: thickness is unknown in the records."]})
    e = explain(r, llm=lambda msgs: good, api_key="k", model="m")
    assert e.mode == "live_ai" and e.model == "m" and not e.warnings


def test_live_failure_falls_back_visibly():
    r = review()
    bad = json.dumps({"summary": "The flame went out at 47 cm/s [t_invented].", "paragraphs": []})
    e = explain(r, llm=lambda msgs: bad, api_key="k", model="m")
    assert e.mode == "deterministic" and e.warnings and "verification" in e.warnings[0]
    assert e.model is None


def test_live_exception_and_garbage_fall_back():
    r = review()
    def boom(msgs):
        raise RuntimeError("network")
    e = explain(r, llm=boom, api_key="k", model="m")
    assert e.mode == "deterministic" and "network" in e.warnings[0]
    e2 = explain(r, llm=lambda m: "not json", api_key="k", model="m")
    assert e2.mode == "deterministic" and e2.warnings


def test_no_key_means_deterministic_never_live(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    e = explain(review())
    assert e.mode == "deterministic" and not e.warnings
