import pytest

from ember.models import OpenQuestion
from ember.planner import build_blocks, plan_programme, select_exact, select_greedy
from tests.helpers import q


def oq(i, kind="missing_condition", field="thickness"):
    return OpenQuestion(id=f"oq_{i}", kind=kind, text=f"question {i}", field=field, endpoint="extinction_under_flow_reduction", test_ids=[])


def test_blocks_have_control_two_replicates_endpoint_and_fixed_changed():
    blocks = build_blocks(q(thickness_mm=2.0), [oq(1), oq(2, field="o2_fraction")], {}, None)
    assert len(blocks) == 2
    for b in blocks:
        assert b.control and b.replicates >= 2 and b.runs == b.replicates * 2
        assert b.endpoint == "extinction_under_flow_reduction" and b.measurements and b.replicate_rationale
        assert b.changed and b.fixed is not None and b.assumptions


def test_same_changed_factor_merged_into_one_block():
    blocks = build_blocks(q(), [oq(1), oq(2)], {}, None)
    assert len(blocks) == 1 and set(blocks[0].covers) == {"oq_1", "oq_2"}


def test_exact_small_and_state_label():
    qs = [oq(i, field=f) for i, f in enumerate(["thickness", "o2_fraction", "pressure_kpa", "flow_velocity"])]
    p = plan_programme(q(), qs, {}, None, budget_runs=13)
    assert p.method == "exact" and p.runs_used <= 13 and p.runs_used == len(p.selected) * 6
    assert len(p.selected) == 2 and len(p.covered) == 2 and len(p.uncovered) == 2
    assert "information gain" in p.note.lower() and "not" in p.note.lower()


def test_exact_beats_greedy_trap_case():
    # classic knapsack trap: greedy by ratio picks the small item and misses the optimum
    items = [("a", 6, 4.0), ("b", 5, 3.0), ("c", 5, 3.0)]  # (id, cost, weight)
    exact = select_exact(items, 10)
    greedy = select_greedy(items, 10)
    assert sum(w for i, c, w in items if i in exact) == 6.0
    assert sum(w for i, c, w in items if i in greedy) <= 6.0


def test_greedy_when_many_and_no_optimum_claim():
    qs = [oq(i, field=f"f{i}") for i in range(20)]
    p = plan_programme(q(), qs, {}, None, budget_runs=40)
    assert p.method == "greedy" and "optimal" in p.note.lower() and "no claim" in p.note.lower()
    assert p.runs_used <= 40


def test_budget_never_exceeded_and_too_small_gives_empty():
    qs = [oq(1)]
    p = plan_programme(q(), qs, {}, None, budget_runs=3)
    assert p.selected == [] and p.runs_used == 0 and p.uncovered == ["oq_1"]


def test_must_cover_respected_or_flagged():
    qs = [oq(1, kind="needs_comparison", field="a"), oq(2, kind="endpoint_gap", field=None), oq(3, field="c")]
    p = plan_programme(q(), qs, {}, None, budget_runs=13, must_cover=["oq_1"])
    assert "oq_1" in p.covered
    p2 = plan_programme(q(), qs, {}, None, budget_runs=5, must_cover=["oq_1"])
    assert "oq_1" in p2.uncovered and "must_cover" in p2.note


def test_deterministic():
    qs = [oq(i, field=f"f{i}") for i in range(5)]
    a = plan_programme(q(), qs, {}, None, budget_runs=12).model_dump()
    b = plan_programme(q(), qs, {}, None, budget_runs=12).model_dump()
    assert a == b


def test_budget_validation():
    with pytest.raises(ValueError):
        plan_programme(q(), [oq(1)], {}, None, budget_runs=0)
