from ember.models import QueryConfig, ResearchQuery
from ember.parse import parse_query


def test_text_extraction():
    r = parse_query("How low must flow go before a PMMA rod flame goes out in microgravity on the ISS? 3 mm diameter, 21% O2, 101.3 kPa, opposed flow 5 cm/s", None)
    qq = r["query"]
    c = qq.config
    assert qq.endpoint == "extinction_under_flow_reduction" and qq.environment == "iss" and qq.topic == "suppression"
    assert c.material.lower() == "pmma" and c.shape == "rod" and c.gravity_regime == "microgravity"
    assert c.thickness_mm == 3.0 and abs(c.o2_fraction - 0.21) < 1e-9 and c.pressure_kpa == 101.3
    assert c.flow_direction == "opposed" and c.flow_velocity_cm_s == 5.0
    assert r["missing"] == []
    assert "o2_role" in r["confirm"]


def test_unit_conversions_and_unknowns_stay_null():
    c = parse_query("ignition of a PMMA sheet at 1 atm and 2 mm/s flow", None)["query"].config
    assert abs(c.pressure_kpa - 101.325) < 1e-6 and abs(c.flow_velocity_cm_s - 0.2) < 1e-9
    assert c.o2_fraction is None and c.thickness_mm is None


def test_missing_lists_required_fields():
    r = parse_query("what about smoke detection", None)
    assert r["query"].endpoint == "smoke_detection"
    assert "gravity_regime" not in r["missing"]  # inferred from default environment, but flagged for confirmation
    assert "gravity_regime" in r["confirm"]
    r2 = parse_query("flame extinction", None)
    assert {"material", "shape"} <= set(r2["missing"])
    r3 = parse_query("hello", None)
    assert "endpoint" in r3["missing"]


def test_lunar_environment_infers_partial_gravity():
    q = parse_query("flame spread over cotton fabric on the lunar surface", None)["query"]
    assert q.environment == "lunar_base" and q.config.gravity_regime == "partial" and q.endpoint == "sustained_spread"


def test_config_passthrough_wins_over_text():
    cfg = ResearchQuery(question="x", endpoint="ignition", config=QueryConfig(material="PMMA", shape="sheet", gravity_regime="microgravity"))
    r = parse_query("rod in normal gravity", cfg)
    assert r["query"].config.shape == "sheet" and r["query"].config.gravity_regime == "microgravity"
    assert r["missing"] == []


def test_o2_not_over_one_hundred_percent():
    q = parse_query("PMMA rod ignition with 150% O2", None)["query"]
    assert q.config.o2_fraction is None
