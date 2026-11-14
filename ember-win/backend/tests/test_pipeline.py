import pytest

from ember.corpus import load_corpus
from ember.pipeline import analyse, apply_patch, make_variant
from ember.retrieval import Retriever
from tests.helpers import q

C = load_corpus()
R = Retriever(C)


def rev(query=None, **kw):
    return analyse(query or q("extinction_under_flow_reduction"), C, R, review_id="rev_a", created="2026-01-01T00:00:00Z", **kw)


def test_review_shape_and_separation():
    r = rev()
    assert r.ranking[0].investigation_id == "inv_bass2"
    item = r.ranking[0]
    assert {"direct", "limited_context", "incompatible", "insufficient_data"} == set(item.applicability_summary)
    assert 0 < item.relevance <= 1 and item.quality["level"] in ("very_low", "low", "moderate", "high")
    assert r.tests_considered and len(r.tests_considered) == len(C.tests)
    assert r.manifest["rules"] and r.manifest["corpus"]["version"] and r.mode == "deterministic"
    assert r.explanation and r.explanation.mode == r.mode


def test_hard_case_tests_land_where_expected():
    r = rev()
    st = {t.test_id: t.decisions[0].status for t in r.tests_considered}
    assert st["t_bass2_ex_operator_term"] == "incompatible"      # operator termination is not extinction
    assert st["t_bass2_rod_constant_flow"] == "incompatible"     # no flow reduction
    assert st["t_bass2_ex_sim_g"] == "limited_context"           # simulated gravity
    assert st["t_bass2_ex_o2_stream"] == "limited_context"
    assert st["t_flex2_heptane_cool"] == "incompatible"
    assert st["t_saffire3_ex_planned"] in ("incompatible", "insufficient_data")


def test_contrasts_never_causal_and_dependency_links():
    r = rev()
    assert r.contrasts
    assert any(c.allowed for c in r.contrasts) and any(not c.allowed for c in r.contrasts)
    for c in r.contrasts:
        assert "R-CON-04" in c.rule_ids
        assert "caused by" not in c.statement.lower()
    for cl in r.claims:
        assert cl.evidence and cl.rule_ids and cl.status in ("supported", "needs_new_comparison", "not_applicable")
        assert cl.depends_on_fields is not None
    obs = [c for c in r.claims if c.type == "observation"]
    assert obs and all("R-CLM-01" in c.rule_ids for c in obs)


def test_insights_keep_three_layers_separate():
    r = rev()
    assert r.safety_insights
    for i in r.safety_insights:
        assert i.observation and i.interpretation and i.possible_application
        assert i.possible_application.startswith("Possible application")
        assert i.observation != i.interpretation != i.possible_application
        assert "Possible application" not in i.observation


def test_open_questions_generated():
    r = rev()
    assert r.open_questions and {o.kind for o in r.open_questions} <= {"missing_condition", "needs_comparison", "endpoint_gap"}


def test_cool_burning_review_finds_flex2_direct():
    r = rev(q("cool_burning", material="n-heptane", shape="droplet"))
    st = {t.test_id: t.decisions[0].status for t in r.tests_considered}
    assert st["t_flex2_heptane_cool"] == "direct"
    assert r.ranking[0].investigation_id in ("inv_flex2", "inv_flex")


def test_false_premise_warning_and_no_direct():
    qq = q("sustained_spread", material="wood", shape="sheet", gravity_regime="partial")
    qq = qq.model_copy(update={"question": "What did Saffire-IV show for wood at lunar gravity?"})
    r = rev(qq)
    assert any("Saffire-IV" in w or "saffire-iv" in w.lower() for w in r.warnings)
    assert not any(d.decisions[0].status == "direct" for d in r.tests_considered)
    assert any("No record" in w for w in r.warnings)


def test_variant_diff_with_reasons_and_unaffected_claims_unchanged():
    base = rev()
    var, diff = make_variant(base, {"gravity_regime": "normal"}, C, R, new_id="rev_b", created="2026-01-01T00:00:00Z")
    assert var.parent_id == "rev_a" and var.variant_patch == {"gravity_regime": "normal"}
    assert diff and all(d["reason"] and d["changed_parameter"] == "gravity_regime" for d in diff)
    assert any(d["before"] != d["after"] for d in diff)
    changed_ids = {d["claim_id"] for d in diff}
    bmap = {c.id: c for c in base.claims}
    for c in var.claims:
        if c.id not in changed_ids and c.id in bmap:
            assert c.status == bmap[c.id].status  # claims not in the diff did not change
    # claims that never depended on gravity (source statements on droplets) are not attributed to it falsely
    assert all("gravity" in d["reason"].lower() or d["after"] is None or d["before"] is None or "[R-" in d["reason"] for d in diff)


def test_variant_that_adds_specificity_changes_status():
    base = rev(q("extinction_under_flow_reduction", thickness_mm=3.0, flow_history="stepwise_reduction"))
    var, diff = make_variant(base, {"flow_history": "continuous_ramp"}, C, R, new_id="rev_c")
    assert any(d["claim_id"].startswith("clm_obs_") and "R-FLOW-04" in d["reason"] for d in diff)


def test_patch_validation():
    base = rev()
    with pytest.raises(ValueError):
        apply_patch(base.query, {"nonsense": 1})
    with pytest.raises(Exception):
        apply_patch(base.query, {"o2_fraction": 21})
    with pytest.raises(ValueError):
        make_variant(base, {"material": "PMMA"}, C, R, new_id="x")  # no change
    with pytest.raises(ValueError):
        apply_patch(base.query, {})
