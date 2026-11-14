import json
import shutil

import pytest

from ember.corpus import CorpusError, DATA_DIR, load_corpus

HARD_FIELDS = ["flow_history", "operator", "cool", "thickness", "substrate", "o2_role", "simulated", "planned"]


def test_loads_and_counts():
    c = load_corpus()
    assert len(c.investigations) == 8
    assert len(c.tests) >= 10
    assert c.version.endswith("provisional")
    deep = {i.id for i in c.investigations.values() if i.coverage == "deep"}
    assert {"inv_bass2", "inv_saffire1", "inv_saffire2", "inv_saffire3", "inv_sibal"} <= deep
    assert all(i.text_chunks for i in c.investigations.values())


def test_everything_provisional_and_has_protocol():
    c = load_corpus()
    assert all(t.verification == "provisional" for t in c.tests.values())
    assert all(i.verification == "provisional" for i in c.investigations.values())
    assert sum(1 for t in c.tests.values() if t.protocol) >= 10


def test_real_urls_present_and_no_invented_numbers():
    c = load_corpus()
    assert c.sources["src_bass2_tm"].url == "https://ntrs.nasa.gov/api/citations/20210011385/downloads/TM-20210011385.pdf"
    assert c.sources["src_flex2_nasa"].url.endswith("/youre-hot-then-youre-cold/")
    # every known numeric value must be an explicit assumption (nominal cabin), never reported
    for t in c.tests.values():
        for sv in (t.geometry.thickness_mm, t.geometry.width_mm, t.geometry.diameter_mm, t.flow.initial_velocity_cm_s,
                   t.atmosphere.o2_fraction, t.atmosphere.pressure_kpa):
            if sv.is_known():
                assert sv.kind == "assumed"


def test_hard_cases_covered():
    c = load_corpus()
    t = c.tests
    # same initial flow, different history
    a, b = t["t_bass2_ex_hist_stepdown"], t["t_bass2_ex_hist_ramp"]
    assert a.flow.initial_velocity_cm_s.value == b.flow.initial_velocity_cm_s.value and a.flow.history_kind != b.flow.history_kind
    kinds = {e.kind for e in t["t_bass2_ex_operator_term"].events}
    assert "operator_termination" in kinds and not kinds & {"final_extinction", "hot_extinction"}
    kinds = {e.kind for e in t["t_flex2_heptane_cool"].events}
    assert {"hot_extinction", "continued_cool_burning"} <= kinds and "final_extinction" not in kinds
    assert t["t_bass2_ex_o2_stream"].atmosphere.o2_fraction.role == "oxidizer_stream"
    assert t["t_bass2_ex_hist_stepdown"].atmosphere.o2_fraction.role == "ambient"
    assert t["t_bass2_ex_sim_g"].gravity.actual is False
    assert t["t_saffire3_ex_planned"].observation_status == "planned"
    assert t["t_bass2_ex_sheet_backed"].substrate_confinement != t["t_bass2_ex_sheet_thin"].substrate_confinement


def test_hash_mismatch_refused(tmp_path):
    d = tmp_path / "data"
    shutil.copytree(DATA_DIR, d)
    p = d / "tests.json"
    p.write_text(p.read_text() + " ")
    with pytest.raises(CorpusError):
        load_corpus(d)


def test_invalid_record_refused(tmp_path):
    d = tmp_path / "data"
    shutil.copytree(DATA_DIR, d)
    p = d / "claims.json"
    rows = json.loads(p.read_text())
    rows[0]["type"] = "bogus"
    p.write_text(json.dumps(rows))
    with pytest.raises(CorpusError):
        load_corpus(d, verify_hashes=False)


def test_dangling_reference_refused(tmp_path):
    d = tmp_path / "data"
    shutil.copytree(DATA_DIR, d)
    p = d / "claims.json"
    rows = json.loads(p.read_text())
    rows[0]["evidence"] = ["t_nope"]
    p.write_text(json.dumps(rows))
    with pytest.raises(CorpusError):
        load_corpus(d, verify_hashes=False)
