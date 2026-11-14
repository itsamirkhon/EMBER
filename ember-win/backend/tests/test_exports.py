import csv
import io
import json

import pytest

from ember.corpus import load_corpus
from ember.exports import IncompatibleFamilies, dataset_csv, report_markdown, review_csv, review_json
from ember.pipeline import analyse
from ember.retrieval import Retriever
from tests.helpers import q

C = load_corpus()
R = Retriever(C)
REV = analyse(q("extinction_under_flow_reduction", thickness_mm=3.0), C, R, review_id="rev_x", created="2026-01-01T00:00:00Z")


def rows(text):
    return list(csv.DictReader(io.StringIO(text)))


def test_report_has_sections_mode_and_provisional():
    md = report_markdown(REV, C)
    for h in ("# EMBER review", "## Question", "## Evidence ranking", "## Applicability by test", "## Claims", "## Contrasts", "## Fire-safety insights",
              "## Open questions", "## Limitations", "Mode: deterministic", "provisional"):
        assert h in md, h
    assert "t_bass2_ex_operator_term" in md and "rev_x" in md


def test_json_roundtrip():
    assert json.loads(review_json(REV))["id"] == "rev_x"


def test_review_csv_one_row_per_test_with_explicit_blanks():
    rs = rows(review_csv(REV, C))
    assert len(rs) == len(C.tests)
    r = next(x for x in rs if x["test_id"] == "t_bass2_rod_flowreduction")
    assert r["status"] == "limited_context" and r["unknown_fields"]


def test_dataset_has_group_ids_units_roles_provenance_blanks():
    rs = rows(dataset_csv(REV, C))
    assert rs and all(r["group_id"].startswith("grp_") for r in rs)
    assert {"unit", "role", "value_kind", "blank", "provenance", "endpoint_family", "test_id", "variable"} <= set(rs[0])
    o2 = [r for r in rs if r["variable"] == "o2_fraction" and r["test_id"] == "t_bass2_ex_o2_stream"][0]
    assert o2["role"] == "oxidizer_stream" and o2["value_kind"] == "assumed" and o2["unit"] == "fraction"
    blank = [r for r in rs if r["test_id"] == "t_bass2_rod_flowreduction" and r["variable"] == "flow_initial_velocity_cm_s"][0]
    assert blank["blank"] == "true" and blank["value"] == "" and blank["value_kind"] == "unknown"
    assert all(r["endpoint_family"] == "extinction_flow" for r in rs)
    assert {r["test_id"] for r in rs}.isdisjoint({"t_bass2_ex_operator_term", "t_bass2_rod_constant_flow"})  # incompatible tests excluded
    # tests that differ in geometry get different group ids
    g = {r["test_id"]: r["group_id"] for r in rs}
    assert g["t_bass2_rod_flowreduction"] != g["t_bass2_sheet_flowreduction"] if "t_bass2_sheet_flowreduction" in g else True


def test_dataset_refuses_incompatible_endpoint_families():
    with pytest.raises(IncompatibleFamilies):
        dataset_csv(REV, C, endpoints=["extinction_under_flow_reduction", "smoke_detection"])
    with pytest.raises(IncompatibleFamilies):
        dataset_csv(REV, C, endpoints=["ignition"])  # review endpoint family differs
    dataset_csv(REV, C, endpoints=["extinction_under_flow_reduction"])
    # same family may be merged
    r2 = analyse(q("ignition"), C, R, review_id="rev_y")
    dataset_csv(r2, C, endpoints=["ignition", "flame_establishment"])


def test_dataset_refuses_without_endpoint():
    r = analyse(q(None), C, R, review_id="rev_z")
    with pytest.raises(IncompatibleFamilies):
        dataset_csv(r, C)
