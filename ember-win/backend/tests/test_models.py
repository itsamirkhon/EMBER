import pytest
from pydantic import ValidationError

from ember.models import (
    ApplicabilityDecision, Event, QueryConfig, ResearchQuery, ScientificValue,
    SourceRef, Test, TestBlock,
)


def test_unknown_value_has_no_value():
    sv = ScientificValue()
    assert sv.kind == "unknown" and sv.value is None and not sv.is_known()


def test_unknown_with_value_rejected():
    with pytest.raises(ValidationError):
        ScientificValue(kind="unknown", value=3)


def test_known_kind_requires_value():
    with pytest.raises(ValidationError):
        ScientificValue(kind="reported", value=None)


def test_bool_value_rejected():
    with pytest.raises(ValidationError):
        ScientificValue(kind="reported", value=True)


def test_assumed_is_known_but_flagged():
    sv = ScientificValue(kind="assumed", value=0.21, unit="fraction")
    assert sv.is_known() and not sv.is_measured()


def test_event_kinds_are_distinct_and_no_burn():
    with pytest.raises(ValidationError):
        Event(kind="burn", step_order=1)
    for k in ("hot_extinction", "continued_cool_burning", "operator_termination", "final_extinction"):
        Event(kind=k, step_order=1)


def test_query_config_range_validation():
    with pytest.raises(ValidationError):
        QueryConfig(o2_fraction=21)  # percent given instead of fraction
    with pytest.raises(ValidationError):
        QueryConfig(pressure_kpa=-1)
    assert QueryConfig().material is None


def test_query_rejects_unknown_fields_and_bad_endpoint():
    with pytest.raises(ValidationError):
        ResearchQuery(question="x", endpoint="burning")
    with pytest.raises(ValidationError):
        ResearchQuery(question="x", bogus=1)


def test_test_block_enforces_control_and_two_replicates():
    base = dict(id="b", question_id="q", target={}, control={"a": 1}, fixed={}, changed={},
                endpoint="ignition", measurements=[], replicate_rationale="r", equipment=[],
                runs=4, assumptions=[])
    with pytest.raises(ValidationError):
        TestBlock(replicates=1, **base)
    with pytest.raises(ValidationError):
        TestBlock(replicates=2, **{**base, "control": {}})
    TestBlock(replicates=2, **base)


def test_decision_status_enum():
    with pytest.raises(ValidationError):
        ApplicabilityDecision(test_id="t", status="maybe", grounds=[], unknown_fields=[], rule_version="v")


def test_source_ref_requires_id():
    with pytest.raises(ValidationError):
        SourceRef(url="x")
