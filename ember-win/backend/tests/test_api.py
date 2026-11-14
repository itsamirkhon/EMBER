import csv
import io
import json

import pytest
from fastapi.testclient import TestClient

from ember.main import EXAMPLE_ID, create_app

QUERY = {"question": "PMMA rod flow reduction", "environment": "iss", "topic": "suppression", "endpoint": "extinction_under_flow_reduction",
         "config": {"material": "PMMA", "shape": "rod", "gravity_regime": "microgravity", "thickness_mm": 3.0}}


@pytest.fixture
def client(tmp_path):
    app = create_app(db_path=tmp_path / "t.db")
    with TestClient(app) as c:
        c.app_ = app
        yield c


def err(r, status, code):
    assert r.status_code == status, r.text
    e = r.json()["error"]
    assert e["code"] == code and e["message"]


def make_review(c, key=None, query=QUERY):
    h = {"Idempotency-Key": key} if key else {}
    r = c.post("/api/reviews", json={"query": query}, headers=h)
    assert r.status_code == 202
    return r.json()


def test_meta(client):
    m = client.get("/api/meta").json()
    assert m["rules_version"] and m["corpus_version"] and m["mode"] == "deterministic"
    assert m["flags"] == {"jev": False, "dense": False, "live_ai": False}
    assert len(m["coverage"]["deep"]) + len(m["coverage"]["catalog"]) == 8


def test_investigations_list_search_filters(client):
    items = client.get("/api/investigations").json()["items"]
    assert len(items) == 8 and {"id", "score", "why", "verification", "coverage"} <= set(items[0])
    hits = client.get("/api/investigations", params={"q": "smoke particle detector"}).json()["items"]
    assert hits[0]["id"] == "inv_same" and hits[0]["score"] > 0 and hits[0]["why"]
    assert [i["id"] for i in client.get("/api/investigations", params={"topic": "detection"}).json()["items"]] == ["inv_same"]


def test_investigation_detail_and_source(client):
    d = client.get("/api/investigations/inv_bass2").json()
    assert d["verification"] == "provisional" and len(d["test_records"]) == len(d["tests"]) >= 3
    s = d["summary"]
    assert set(s) == {"goal", "method", "materials", "conditions_range", "measurements", "key_results", "limitations"}
    assert s["goal"]["source_refs"][0]["source_id"] == "src_bass2_tm"
    assert s["conditions_range"]["numeric"]["flow_velocity_cm_s"] == "unknown in corpus"
    src = client.get("/api/sources/src_bass2_tm").json()
    assert src["url"].startswith("https://ntrs.nasa.gov/") and set(src) >= {"id", "url", "title", "retrieved", "hash", "type"}
    err(client.get("/api/investigations/nope"), 404, "investigation_not_found")
    err(client.get("/api/sources/nope"), 404, "source_not_found")


def test_parse_endpoint(client):
    r = client.post("/api/queries/parse", json={"text": "PMMA rod flame goes out when flow is reduced in microgravity, 3 mm diameter"}).json()
    assert r["query"]["endpoint"] == "extinction_under_flow_reduction" and r["query"]["config"]["thickness_mm"] == 3.0 and r["missing"] == []
    err(client.post("/api/queries/parse", json={}), 422, "validation_error")
    err(client.post("/api/queries/parse", json={"config": {"question": "x", "endpoint": "bogus"}}), 422, "validation_error")


def test_review_lifecycle_and_envelope(client):
    out = make_review(client)
    run = client.get(f"/api/runs/{out['run_id']}").json()
    assert run == {"run_id": out["run_id"], "status": "done", "stage": "complete", "error": None, "review_id": out["review_id"]}
    rv = client.get(f"/api/reviews/{out['review_id']}").json()
    for k in ("id", "revision", "created", "query", "mode", "manifest", "ranking", "tests_considered", "contrasts", "claims", "safety_insights", "conflicts",
              "limitations", "open_questions", "programme", "warnings"):
        assert k in rv, k
    assert set(rv["manifest"]) == {"corpus", "rules", "code", "generator"} and rv["mode"] == "deterministic"
    assert any(i["id"] == out["review_id"] for i in client.get("/api/reviews").json()["items"])
    err(client.get("/api/reviews/nope"), 404, "review_not_found")
    err(client.get("/api/runs/nope"), 404, "run_not_found")
    err(client.post("/api/reviews", json={"query": {"question": "x", "endpoint": "bogus"}}), 422, "validation_error")
    err(client.post("/api/reviews", json={"query": {"config": {"o2_fraction": 21}}}), 422, "validation_error")


def test_idempotency(client):
    a = make_review(client, "key-1")
    b = client.post("/api/reviews", json={"query": QUERY}, headers={"Idempotency-Key": "key-1"})
    assert b.status_code == 202 and b.json() == a and b.headers["Idempotent-Replay"] == "true"
    n = len(client.get("/api/reviews").json()["items"])
    other = dict(QUERY, question="different")
    err(client.post("/api/reviews", json={"query": other}, headers={"Idempotency-Key": "key-1"}), 409, "idempotency_key_reuse")
    assert len(client.get("/api/reviews").json()["items"]) == n
    c = make_review(client)  # no key: always new
    d = make_review(client)
    assert c["review_id"] != d["review_id"]


def test_saved_example_available_at_startup_and_stable(client, tmp_path):
    r = client.get(f"/api/reviews/{EXAMPLE_ID}").json()
    assert r["mode"] == "saved_example" and r["programme"] is not None and r["programme"]["method"] == "exact"
    assert client.get("/api/reviews").json()["items"][0]["id"] == EXAMPLE_ID
    app2 = create_app(db_path=tmp_path / "t.db")  # restart on same db: reopened, not regenerated
    with TestClient(app2) as c2:
        assert c2.get(f"/api/reviews/{EXAMPLE_ID}").json() == r


def test_variants(client):
    rid = make_review(client)["review_id"]
    r = client.post(f"/api/reviews/{rid}/variants", json={"config_patch": {"gravity_regime": "normal"}})
    assert r.status_code == 200
    v = r.json()
    assert v["variant_id"] == v["review"]["id"] and v["review"]["parent_id"] == rid and v["diff"]
    assert all({"claim_id", "before", "after", "changed_parameter", "reason"} <= set(d) for d in v["diff"])
    assert client.get(f"/api/reviews/{v['variant_id']}").json()["query"]["config"]["gravity_regime"] == "normal"
    err(client.post(f"/api/reviews/{rid}/variants", json={"config_patch": {"bogus": 1}}), 422, "unknown_parameter")
    err(client.post(f"/api/reviews/{rid}/variants", json={"config_patch": {"o2_fraction": 21}}), 422, "invalid_patch")
    err(client.post(f"/api/reviews/{rid}/variants", json={"config_patch": {"material": "PMMA"}}), 422, "invalid_patch")
    err(client.post("/api/reviews/none/variants", json={"config_patch": {"material": "x"}}), 404, "review_not_found")
    r1 = client.post(f"/api/reviews/{rid}/variants", json={"config_patch": {"pressure_kpa": 50}}, headers={"Idempotency-Key": "v1"}).json()
    r2 = client.post(f"/api/reviews/{rid}/variants", json={"config_patch": {"pressure_kpa": 50}}, headers={"Idempotency-Key": "v1"}).json()
    assert r1["variant_id"] == r2["variant_id"]


def test_programmes_and_revisions(client):
    rid = make_review(client)["review_id"]
    rv = client.get(f"/api/reviews/{rid}").json()
    assert rv["programme"] is None
    oq = [o["id"] for o in rv["open_questions"]]
    p = client.post(f"/api/reviews/{rid}/test-programmes", json={"budget_runs": 20, "must_cover": oq[:1]}).json()
    assert p["method"] in ("exact", "greedy") and p["runs_used"] <= 20 and oq[0] in p["covered"]
    assert all(b["replicates"] >= 2 and b["control"] for b in p["blocks"])
    after = client.get(f"/api/reviews/{rid}").json()
    assert after["revision"] == 2 and after["programme"] == p
    client.post(f"/api/reviews/{rid}/test-programmes", json={"budget_runs": 20, "must_cover": oq[:1]})
    assert client.get(f"/api/reviews/{rid}").json()["revision"] == 2  # identical programme: no new revision
    assert [x["revision"] for x in client.get(f"/api/reviews/{rid}/revisions").json()["items"]] == [1, 2]
    err(client.post(f"/api/reviews/{rid}/test-programmes", json={"budget_runs": 0}), 422, "validation_error")
    err(client.post(f"/api/reviews/{rid}/test-programmes", json={"budget_runs": 5, "must_cover": ["nope"]}), 422, "unknown_open_question")


def test_exports(client):
    rid = make_review(client)["review_id"]
    md = client.get(f"/api/reviews/{rid}/export", params={"format": "report"})
    assert md.headers["content-type"].startswith("text/markdown") and "# EMBER review" in md.text
    j = client.get(f"/api/reviews/{rid}/export", params={"format": "json"})
    assert j.headers["content-type"].startswith("application/json") and json.loads(j.text)["id"] == rid
    c = client.get(f"/api/reviews/{rid}/export", params={"format": "csv"})
    assert c.headers["content-type"].startswith("text/csv") and len(list(csv.DictReader(io.StringIO(c.text)))) == 20
    d = client.get(f"/api/reviews/{rid}/export", params={"format": "dataset"})
    assert "group_id" in d.text.splitlines()[0]
    err(client.get(f"/api/reviews/{rid}/export", params={"format": "dataset", "endpoints": "extinction_under_flow_reduction,smoke_detection"}), 409, "incompatible_endpoint_families")
    err(client.get(f"/api/reviews/{rid}/export", params={"format": "pdf"}), 422, "unknown_format")


def test_replay(client):
    rid = make_review(client)["review_id"]
    r = client.get(f"/api/reviews/{rid}/replay/t_bass2_rod_flowreduction").json()
    assert r["segments"] and r["segments"][0]["order"] == 1 and r["segments"][0]["time_s"] is None
    assert r["events"] and "not a physics simulation" in r["disclaimer"]
    err(client.get(f"/api/reviews/{rid}/replay/nope"), 404, "test_not_found")


def test_eval_summary_not_measured_when_missing(client, monkeypatch, tmp_path):
    import ember.main as m
    monkeypatch.setattr(m, "EVAL_RESULTS", tmp_path / "none.json")
    assert client.get("/api/eval/summary").json()["status"] == "not_measured"
    (tmp_path / "bad.json").write_text("{")
    monkeypatch.setattr(m, "EVAL_RESULTS", tmp_path / "bad.json")
    assert client.get("/api/eval/summary").json()["status"] == "not_measured"
    (tmp_path / "ok.json").write_text(json.dumps({"status": "measured", "label": "x"}))
    monkeypatch.setattr(m, "EVAL_RESULTS", tmp_path / "ok.json")
    assert client.get("/api/eval/summary").json()["status"] == "measured"


def test_crash_recovery_marks_interrupted_runs(tmp_path):
    app = create_app(db_path=tmp_path / "t.db")
    app.state.store.create_run("run_dead", "running", "retrieval")
    app2 = create_app(db_path=tmp_path / "t.db")
    with TestClient(app2) as c:
        run = c.get("/api/runs/run_dead").json()
        assert run["status"] == "error" and "interrupted" in run["error"]
        assert c.get("/api/meta").json()["recovered_runs"] == 1


def test_unknown_route_uses_envelope(client):
    err(client.get("/api/nothing"), 404, "not_found")
