import pytest

from ember import engine
from ember.corpus import load_corpus
from ember.engine import compare_tests, endpoint_support, evaluate_test
from tests.helpers import mk_test, q

C = load_corpus()


def status(query, t):
    return evaluate_test(query, t).status


def test_rule_registry_complete_and_versioned():
    assert engine.RULES_VERSION
    used = set()
    t = mk_test()
    for qq in (q(), q("ignition"), q("cool_burning")):
        used |= {g.rule_id for g in evaluate_test(qq, t).grounds}
    assert used <= set(engine.RULES)
    assert all(r.title and r.description for r in engine.RULES.values())


def test_endpoint_requirement_table_differs_by_endpoint():
    ign, ext = engine.ENDPOINT_REQUIREMENTS["ignition"], engine.ENDPOINT_REQUIREMENTS["extinction_under_flow_reduction"]
    assert "flow_history" in ext.required and "flow_history" not in ign.required
    assert set(engine.ENDPOINT_REQUIREMENTS) == {"ignition", "flame_establishment", "sustained_spread", "extinction_under_flow_reduction",
                                                 "cool_burning", "smoke_detection", "suppression"}


def test_fully_known_matching_is_direct():
    t = mk_test()
    d = evaluate_test(q(thickness_mm=3.0, flow_direction="opposed", flow_velocity_cm_s=10, o2_fraction=0.21, o2_role="ambient",
                        pressure_kpa=101.3, substrate="free_standing", flow_history="stepwise_reduction"), t)
    assert d.status == "direct", [g for g in d.grounds if g.effect != "pass"]


def test_numeric_closeness_only_limits_never_incompatible():
    t = mk_test()
    d = evaluate_test(q(thickness_mm=3.0, flow_direction="opposed", flow_velocity_cm_s=10, o2_fraction=0.35, o2_role="ambient",
                        pressure_kpa=101.3, substrate="free_standing", flow_history="stepwise_reduction"), t)
    assert d.status == "limited_context"
    assert any(g.rule_id == "R-GAS-02" and g.effect == "fail" for g in d.grounds)


def test_semantic_rules_come_before_numbers():
    # geometry mismatch is incompatible even when every number matches
    t = mk_test()
    d = evaluate_test(q(shape="sheet", thickness_mm=3.0, o2_fraction=0.21, pressure_kpa=101.3), t)
    assert d.status == "incompatible"


def test_two_unknowns_never_match():
    t = mk_test(geometry={"shape": "rod"})  # diameter unknown
    d = evaluate_test(q(), t)  # query thickness also unspecified
    thick = [g for g in d.grounds if g.field == "thickness"]
    assert thick and all(g.effect == "unknown" for g in thick)
    assert d.status != "direct" and "thickness" in d.unknown_fields


def test_unknown_test_value_vs_known_query_is_unknown():
    t = mk_test(geometry={"shape": "rod"})
    d = evaluate_test(q(thickness_mm=3.0), t)
    assert any(g.field == "thickness" and g.effect == "unknown" for g in d.grounds)


def test_required_unknown_gives_insufficient():
    d = evaluate_test(q(material=None), mk_test())
    assert d.status == "insufficient_data" and "material" in d.unknown_fields
    d2 = evaluate_test(q(), mk_test(material=None))
    assert d2.status == "insufficient_data"


def test_material_and_phase_mismatch_incompatible():
    assert status(q(material="n-heptane", shape="droplet"), mk_test()) == "incompatible"
    assert status(q(material="cotton-fiberglass"), mk_test()) == "incompatible"


def test_gravity_regime_and_actual_vs_simulated():
    assert status(q(gravity_regime="normal"), mk_test()) == "incompatible"
    sim = mk_test(gravity={"regime": "microgravity", "platform": "analogue", "actual": False})
    d = evaluate_test(q(), sim)
    assert d.status == "limited_context" and any(g.rule_id == "R-GRAV-02" and g.effect == "fail" for g in d.grounds)


def test_flow_direction_conflict_incompatible_for_spread_and_extinction():
    assert status(q(flow_direction="concurrent"), mk_test()) == "incompatible"


def test_ambient_vs_oxidizer_stream():
    stream = mk_test(atmosphere={"o2_fraction": {"kind": "reported", "value": 0.21, "unit": "fraction", "role": "oxidizer_stream"},
                                 "pressure_kpa": {"kind": "reported", "value": 101.3}})
    d = evaluate_test(q(o2_fraction=0.21, o2_role="ambient"), stream)
    assert d.status == "limited_context" and any(g.rule_id == "R-GAS-01" and g.effect == "fail" for g in d.grounds)


def test_same_initial_flow_different_history_not_equal():
    t = mk_test(flow={"direction": {"kind": "reported", "value": "opposed"}, "initial_velocity_cm_s": {"kind": "reported", "value": 10},
                      "history_kind": "continuous_ramp"})
    d = evaluate_test(q(flow_velocity_cm_s=10, flow_history="stepwise_reduction"), t)
    assert d.status == "limited_context"
    assert any(g.rule_id == "R-FLOW-04" and g.effect == "fail" for g in d.grounds)
    assert any(g.rule_id == "R-FLOW-03" and g.effect == "pass" for g in d.grounds)


def test_constant_flow_cannot_answer_flow_reduction_endpoint():
    t = mk_test(flow={"history_kind": "constant"}, protocol=[{"order": 1, "kind": "ignition", "description": "x"}], events=[{"kind": "sustained_spread", "step_order": 1}])
    assert status(q(), t) == "incompatible"


def test_operator_termination_is_not_extinction():
    t = mk_test(events=[{"kind": "operator_termination", "step_order": 2}])
    assert endpoint_support(t, "extinction_under_flow_reduction")[0] == "not_observed"
    assert status(q(), t) == "incompatible"
    # ...but if the record's event list is incomplete we cannot say
    t2 = mk_test(events=[{"kind": "operator_termination", "step_order": 2}], events_complete=False)
    assert endpoint_support(t2, "extinction_under_flow_reduction")[0] == "unknown"
    assert status(q(), t2) == "insufficient_data"


def test_hot_extinction_with_cool_burning():
    t = mk_test(events=[{"kind": "hot_extinction", "step_order": 2}, {"kind": "continued_cool_burning", "step_order": 2}])
    assert endpoint_support(t, "extinction_under_flow_reduction")[0] == "partial"
    d = evaluate_test(q(), t)
    assert d.status == "limited_context" and any(g.rule_id == "R-EVT-02" for g in d.grounds)
    assert endpoint_support(t, "cool_burning")[0] == "observed"


def test_planned_vs_observed():
    t = mk_test(observation_status="planned", events=[{"kind": "final_extinction", "step_order": 2, "observed": False}])
    d = evaluate_test(q(), t)
    assert d.status == "insufficient_data" and any(g.rule_id == "R-OBS-01" for g in d.grounds)


def test_substrate_difference_limits():
    d = evaluate_test(q(substrate="backed_insulating"), mk_test())
    assert any(g.rule_id == "R-SUB-01" and g.effect == "fail" for g in d.grounds) and d.status == "limited_context"


def test_no_endpoint_is_insufficient():
    assert status(q(endpoint=None), mk_test()) == "insufficient_data"


def test_ignition_vs_extinction_requirements_differ_on_same_test():
    t = mk_test(flow={"history_kind": "constant"}, protocol=[{"order": 1, "kind": "ignition", "description": "x"}],
                events=[{"kind": "ignition_attempt", "step_order": 1}])
    assert status(q("extinction_under_flow_reduction"), t) == "incompatible"
    assert status(q("ignition"), t) in ("direct", "limited_context")


def test_corpus_cool_flame_direct_and_extinction_limited():
    t = C.tests["t_flex2_heptane_cool"]
    d = evaluate_test(q("cool_burning", material="n-heptane", shape="droplet"), t)
    assert d.status == "direct", d.grounds
    d2 = evaluate_test(q("extinction_under_flow_reduction", material="n-heptane", shape="droplet"), t)
    assert d2.status == "incompatible"  # constant flow droplet: no flow reduction


def test_corpus_smoke():
    t = C.tests["t_same_smoke_samples"]
    assert status(q("smoke_detection", material=None, shape=None), t) in ("direct", "limited_context")


# ---------------- contrasts
def test_contrast_single_factor_allowed_and_non_causal():
    a, b = C.tests["t_bass2_ex_hist_stepdown"], C.tests["t_bass2_ex_sim_g"]
    c = compare_tests(a, b, "extinction_under_flow_reduction")
    assert c.changed_factors == ["gravity_actual"] and c.allowed
    s = c.statement.lower()
    assert "does not show" in s and "caused" in s
    assert "R-CON-04" in c.rule_ids
    for bad in ("proves", "because of", "caused by", "leads to"):
        assert bad not in s


def test_contrast_same_initial_flow_different_history():
    c = compare_tests(C.tests["t_bass2_ex_hist_stepdown"], C.tests["t_bass2_ex_hist_ramp"], "extinction_under_flow_reduction")
    assert "flow_history" in c.changed_factors and "flow_initial_velocity" in c.shared
    assert "R-CON-03" in c.rule_ids and c.allowed
    assert "flow history differs" in c.statement


def test_contrast_ambient_vs_stream_role():
    c = compare_tests(C.tests["t_bass2_ex_hist_stepdown"], C.tests["t_bass2_ex_o2_stream"], "extinction_under_flow_reduction")
    assert c.changed_factors == ["o2_role"]


def test_contrast_substrate_and_thickness_each_single_factor():
    c = compare_tests(C.tests["t_bass2_ex_sheet_thin"], C.tests["t_bass2_ex_sheet_backed"], "extinction_under_flow_reduction")
    assert c.changed_factors == ["substrate"] and c.allowed
    c2 = compare_tests(C.tests["t_bass2_ex_sheet_thin"], C.tests["t_bass2_ex_sheet_thick"], "extinction_under_flow_reduction")
    assert c2.changed_factors == ["dimension"] and c2.allowed


def test_contrast_operator_termination_not_allowed():
    c = compare_tests(C.tests["t_bass2_ex_hist_stepdown"], C.tests["t_bass2_ex_operator_term"], "extinction_under_flow_reduction")
    assert not c.allowed and "R-CON-05" in c.rule_ids and "operator" in c.statement


def test_contrast_unknowns_block_and_are_listed():
    c = compare_tests(C.tests["t_bass2_rod_flowreduction"], C.tests["t_bass2_sheet_flowreduction"], "extinction_under_flow_reduction")
    assert not c.allowed and "R-CON-02" in c.rule_ids and "thickness" not in c.shared
    assert "flow_direction" in c.unknown  # both unknown -> unknown, not shared
    assert "flow_direction" not in c.shared


def test_contrast_multiple_changes_not_allowed():
    c = compare_tests(C.tests["t_bass2_ex_sheet_thick"], C.tests["t_bass2_ex_hist_stepdown"], "extinction_under_flow_reduction")
    assert not c.allowed and len(c.changed_factors) > 1


def test_evidence_quality_separate_and_capped():
    t = C.tests["t_bass2_ex_hist_stepdown"]
    assert engine.evidence_quality(t, "deep", False)["level"] == "very_low"
    r = engine.evidence_quality(C.tests["t_bass2_rod_flowreduction"], "deep", True)
    assert r["level"] == "low" and r["verification"] == "provisional"
