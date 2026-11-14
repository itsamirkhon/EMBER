"""EMBER backend. Run from backend/: uvicorn ember.main:app --port 8000"""
from __future__ import annotations

import json
import os
import uuid
from hashlib import sha1
from pathlib import Path
from typing import Any, Callable

from fastapi import Body, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse, Response
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import __version__
from .claims import PATCH_FIELDS
from .corpus import DATA_DIR, Corpus, load_corpus
from .engine import ENDPOINT_REQUIREMENTS, RULES, RULES_VERSION
from .exports import IncompatibleFamilies, dataset_csv, report_markdown, review_csv, review_json
from .explain import deterministic_explanation, explain as default_explain
from .models import ResearchQuery, Review, TestProgramme
from .parse import parse_query
from .pipeline import analyse, make_variant, now_iso
from .planner import plan_programme
from .retrieval import Retriever
from .store import IdempotencyConflict, Store

BASE = Path(__file__).resolve().parent.parent
EVAL_RESULTS = BASE / "eval" / "results.json"
EXAMPLE_ID = "rev_example_bass2"


class EmberError(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.message = status, code, message


def envelope(status: int, code: str, message: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


class ParseBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str | None = Field(default=None, max_length=4000)
    config: ResearchQuery | None = None


class ReviewBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    query: ResearchQuery


class VariantBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    config_patch: dict[str, Any]


class ProgrammeBody(BaseModel):
    model_config = ConfigDict(extra="forbid")
    budget_runs: int = Field(ge=1, le=500)
    must_cover: list[str] = []


def _hash(obj: Any) -> str:
    return sha1(json.dumps(obj, sort_keys=True, default=str).encode()).hexdigest()


def _check_key(key: str | None) -> str | None:
    if key is None:
        return None
    if not key.strip() or len(key) > 200 or not key.isprintable():
        raise EmberError(400, "invalid_idempotency_key", "Idempotency-Key must be 1-200 printable characters")
    return key


def seed_example(store: Store, corpus: Corpus, retriever: Retriever) -> None:
    if store.get_review(EXAMPLE_ID):
        return
    q = ResearchQuery.model_validate({"question": "How does the flow-reduction-to-extinction protocol end for a PMMA rod in microgravity, and what is still unknown?",
        "environment": "iss", "topic": "suppression", "endpoint": "extinction_under_flow_reduction",
        "config": {"material": "PMMA", "shape": "rod", "gravity_regime": "microgravity"}})

    def saved(r: Review):
        e = deterministic_explanation(r)
        e.mode = "saved_example"
        e.paragraphs.append("This is a saved example generated at build time from the provisional corpus; it was not produced live.")
        return e
    r = analyse(q, corpus, retriever, review_id=EXAMPLE_ID, created="2026-11-14T00:00:00Z", explain_fn=saved)
    r.manifest["generator"] = "saved_example (deterministic-v1)"
    ref = _reference_test(r, corpus)
    r.programme = plan_programme(r.query, r.open_questions, {}, corpus, budget_runs=14, ref_test=ref)
    store.save_review(r, saved_example=True)


def _reference_test(r: Review, corpus: Corpus):
    for t in r.tests_considered:
        if t.decisions[0].status in ("direct", "limited_context") and corpus.tests[t.test_id].observation_status == "observed" and t.endpoint_support in ("observed", "partial"):
            return corpus.tests[t.test_id]
    return None


def create_app(data_dir: Path = DATA_DIR, db_path: str | Path | None = None, explain_fn: Callable[..., Any] | None = None) -> FastAPI:
    corpus = load_corpus(data_dir)
    retriever = Retriever(corpus)
    store = Store(db_path or os.environ.get("EMBER_DB") or BASE / "var" / "ember.db")
    recovered = store.recover()
    seed_example(store, corpus, retriever)
    explain_fn = explain_fn or default_explain
    app = FastAPI(title="EMBER", version=__version__)
    app.state.store, app.state.corpus, app.state.retriever, app.state.recovered_runs = store, corpus, retriever, recovered
    app.add_middleware(CORSMiddleware, allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"], allow_methods=["*"], allow_headers=["*"])

    @app.exception_handler(EmberError)
    async def _ember(_: Request, e: EmberError):
        return envelope(e.status, e.code, e.message)

    @app.exception_handler(StarletteHTTPException)
    async def _http(_: Request, e: StarletteHTTPException):
        return envelope(e.status_code, "not_found" if e.status_code == 404 else "http_error", str(e.detail))

    @app.exception_handler(RequestValidationError)
    async def _validation(_: Request, e: RequestValidationError):
        msg = "; ".join(f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()[:6])
        return envelope(422, "validation_error", msg)

    @app.exception_handler(Exception)
    async def _crash(_: Request, e: Exception):
        return envelope(500, "internal_error", f"{type(e).__name__}: {e}")

    def get_review(rid: str) -> Review:
        r = store.get_review(rid)
        if r is None:
            raise EmberError(404, "review_not_found", f"no review {rid}")
        return r

    # ------------------------------------------------------------------ meta / corpus
    @app.get("/api/meta")
    def meta():
        live = bool(os.environ.get("OPENAI_API_KEY"))
        invs = corpus.investigations.values()
        return {"version": __version__, "corpus_version": corpus.version, "rules_version": RULES_VERSION, "mode": "live_ai" if live else "deterministic",
                "flags": {"jev": False, "dense": False, "live_ai": live}, "saved_example_id": EXAMPLE_ID,
                "coverage": {"deep": [i.id for i in invs if i.coverage == "deep"], "catalog": [i.id for i in invs if i.coverage == "catalog"]},
                "recovered_runs": app.state.recovered_runs}

    @app.get("/api/rules")
    def rules():
        return {"rules_version": RULES_VERSION, "rules": [r.__dict__ for r in RULES.values()],
                "endpoint_requirements": {k: {"family": v.family, "required": list(v.required), "important": list(v.important), "needs": v.needs}
                                          for k, v in ENDPOINT_REQUIREMENTS.items()}}

    def card(inv, score=0.0, why=""):
        return {"id": inv.id, "name": inv.name, "summary_goal": inv.summary_goal, "platform": inv.platform, "families": inv.families, "materials": inv.materials,
                "topics": inv.topics, "status": inv.status, "verification": inv.verification, "coverage": inv.coverage, "n_tests": len(inv.tests),
                "score": round(score, 5), "why": why}

    @app.get("/api/investigations")
    def investigations(q: str | None = None, topic: str | None = None, material: str | None = None, platform: str | None = None, family: str | None = None):
        hits = retriever.search_investigations(q, topic=topic, material=material, platform=platform, family=family)
        return {"items": [card(corpus.investigations[h.id], h.score, h.why) for h in hits]}

    @app.get("/api/investigations/{inv_id}")
    def investigation(inv_id: str):
        inv = corpus.investigations.get(inv_id)
        if inv is None:
            raise EmberError(404, "investigation_not_found", f"no investigation {inv_id}")
        tests = corpus.tests_of(inv_id)
        d = inv.model_dump()
        d["test_records"] = [t.model_dump() for t in tests]
        d["claims"] = [c.model_dump() for c in corpus.claims_of(inv_id)]
        d["summary"] = _summary(inv, tests, corpus)
        return d

    @app.get("/api/sources/{source_id}")
    def source(source_id: str):
        s = corpus.sources.get(source_id)
        if s is None:
            raise EmberError(404, "source_not_found", f"no source {source_id}")
        return s.model_dump()

    # ------------------------------------------------------------------ parse / review
    @app.post("/api/queries/parse")
    def parse(body: ParseBody):
        if not (body.text and body.text.strip()) and body.config is None:
            raise EmberError(422, "validation_error", "provide text or config")
        r = parse_query(body.text, body.config)
        return {"query": r["query"].model_dump(), "missing": r["missing"], "confirm": r["confirm"]}

    @app.post("/api/reviews", status_code=202)
    def create_review(body: ReviewBody, idempotency_key: str | None = Header(default=None)):
        key = _check_key(idempotency_key)
        scope, h = "POST /api/reviews", _hash(body.model_dump())
        if key:
            hit = store.idem_get(scope, key)
            if hit:
                if hit[0] != h:
                    raise EmberError(409, "idempotency_key_reuse", "this Idempotency-Key was already used with a different request body")
                return JSONResponse(hit[1], status_code=202, headers={"Idempotent-Replay": "true"})
        run_id, rid = "run_" + uuid.uuid4().hex[:12], "rev_" + uuid.uuid4().hex[:12]
        store.create_run(run_id, "running", "retrieval")
        try:
            review = analyse(body.query, corpus, retriever, review_id=rid, explain_fn=explain_fn)
            resp = {"run_id": run_id, "review_id": rid}
            store.save_review(review, idem=(scope, key, h, resp) if key else None, run=(run_id, rid))
        except IdempotencyConflict:  # concurrent request with the same key won the race
            store.update_run(run_id, "error", error="superseded by a concurrent request with the same Idempotency-Key")
            hit = store.idem_get(scope, key)  # type: ignore[arg-type]
            return JSONResponse(hit[1], status_code=202, headers={"Idempotent-Replay": "true"})
        except Exception as e:
            store.update_run(run_id, "error", error=f"{type(e).__name__}: {e}")
            return JSONResponse({"run_id": run_id, "review_id": None}, status_code=202)
        return JSONResponse(resp, status_code=202)

    @app.get("/api/runs/{run_id}")
    def run(run_id: str):
        r = store.get_run(run_id)
        if r is None:
            raise EmberError(404, "run_not_found", f"no run {run_id}")
        return {"run_id": r["run_id"], "status": r["status"], "stage": r["stage"], "error": r["error"], "review_id": r["review_id"]}

    @app.get("/api/reviews")
    def reviews():
        return {"items": store.list_reviews()}

    @app.get("/api/reviews/{rid}")
    def review(rid: str):
        return get_review(rid).model_dump()

    @app.get("/api/reviews/{rid}/revisions")
    def revisions(rid: str):
        get_review(rid)
        return {"items": store.revisions(rid)}

    @app.post("/api/reviews/{rid}/variants")
    def variant(rid: str, body: VariantBody, idempotency_key: str | None = Header(default=None)):
        base = get_review(rid)
        key = _check_key(idempotency_key)
        scope, h = f"POST /api/reviews/{rid}/variants", _hash(body.config_patch)
        if key:
            hit = store.idem_get(scope, key)
            if hit:
                if hit[0] != h:
                    raise EmberError(409, "idempotency_key_reuse", "this Idempotency-Key was already used with a different request body")
                v = store.get_review(hit[1]["variant_id"])
                return JSONResponse({**hit[1], "review": v.model_dump() if v else None}, headers={"Idempotent-Replay": "true"})
        unknown = [k for k in body.config_patch if k not in PATCH_FIELDS and k not in ("environment", "topic")]
        if unknown:
            raise EmberError(422, "unknown_parameter", f"unknown parameter(s): {', '.join(unknown)}")
        try:
            vid = "rev_" + uuid.uuid4().hex[:12]
            var, diff = make_variant(base, body.config_patch, corpus, retriever, new_id=vid, explain_fn=explain_fn)
        except (ValueError, ValidationError) as e:
            raise EmberError(422, "invalid_patch", str(e).splitlines()[0] if isinstance(e, ValueError) else "; ".join(f"{'.'.join(map(str, x['loc']))}: {x['msg']}" for x in e.errors()))
        resp = {"variant_id": vid, "diff": diff}
        store.save_review(var, idem=(scope, key, h, resp) if key else None)
        return {**resp, "review": var.model_dump()}

    @app.post("/api/reviews/{rid}/test-programmes")
    def programme(rid: str, body: ProgrammeBody):
        r = get_review(rid)
        oq_ids = {o.id for o in r.open_questions}
        bad = [m for m in body.must_cover if m not in oq_ids]
        if bad:
            raise EmberError(422, "unknown_open_question", f"must_cover ids not in this review: {', '.join(bad)}")
        prog = plan_programme(r.query, r.open_questions, {}, corpus, budget_runs=body.budget_runs, must_cover=body.must_cover, ref_test=_reference_test(r, corpus))
        if r.programme is None or r.programme.model_dump() != prog.model_dump():
            r.programme = prog
            store.update_review(r, reason=f"test programme (budget {body.budget_runs})")
        return prog.model_dump()

    # ------------------------------------------------------------------ export / replay / eval
    @app.get("/api/reviews/{rid}/export")
    def export(rid: str, format: str = Query("report"), endpoints: str | None = None):
        r = get_review(rid)
        if format == "report":
            return Response(report_markdown(r, corpus), media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": f'inline; filename="{rid}.md"'})
        if format == "json":
            return Response(review_json(r), media_type="application/json", headers={"Content-Disposition": f'inline; filename="{rid}.json"'})
        if format == "csv":
            return Response(review_csv(r, corpus), media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{rid}.csv"'})
        if format == "dataset":
            try:
                text = dataset_csv(r, corpus, [e for e in endpoints.split(",") if e] if endpoints else None)
            except IncompatibleFamilies as e:
                raise EmberError(409, "incompatible_endpoint_families", str(e))
            return Response(text, media_type="text/csv; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{rid}-dataset.csv"'})
        raise EmberError(422, "unknown_format", "format must be one of report, json, csv, dataset")

    @app.get("/api/reviews/{rid}/replay/{test_id}")
    def replay(rid: str, test_id: str):
        get_review(rid)
        t = corpus.tests.get(test_id)
        if t is None:
            raise EmberError(404, "test_not_found", f"no test {test_id}")
        segs = [{"label": s.description, "kind": s.kind, "time_s": s.time_s.value if s.time_s.is_known() else None, "order": s.order} for s in sorted(t.protocol, key=lambda s: s.order)]
        evs = [{"kind": e.kind, "step_order": e.step_order, "time_s": e.time_s.value if e.time_s.is_known() else None, "observed": e.observed, "note": e.note} for e in t.events]
        return {"test_id": t.id, "series": t.series, "observation_status": t.observation_status, "record_type": t.record_type, "segments": segs, "events": evs,
                "measurements": [m.model_dump() for m in t.measurements],
                "disclaimer": "Data replay of the recorded protocol steps and events in the provisional corpus. It is not a physics simulation; missing times are shown as unknown."}

    @app.get("/api/eval/summary")
    def eval_summary():
        try:
            data = json.loads(EVAL_RESULTS.read_text())
        except FileNotFoundError:
            return {"status": "not_measured", "message": "not measured: no evaluation has been run (python -m eval.run_eval)"}
        except (OSError, json.JSONDecodeError):
            return {"status": "not_measured", "message": "not measured: the stored evaluation file is unreadable"}
        return data

    return app


def _summary(inv, tests, corpus: Corpus) -> dict:
    refs = [s.model_dump() for s in inv.sources]
    seq = []
    if tests:
        seq = [f"{s.order}. {s.kind}: {s.description}" for s in sorted(tests[0].protocol, key=lambda s: s.order)]
    shapes = sorted({t.geometry.shape for t in tests if t.geometry.shape})
    grav = sorted({f"{t.gravity.regime} ({'actual' if t.gravity.actual else 'simulated' if t.gravity.actual is False else 'unknown'})" for t in tests})
    nums = {}
    for name, getter in (("thickness_mm", lambda t: t.geometry.thickness_mm), ("diameter_mm", lambda t: t.geometry.diameter_mm), ("flow_velocity_cm_s", lambda t: t.flow.initial_velocity_cm_s),
                         ("o2_fraction", lambda t: t.atmosphere.o2_fraction), ("pressure_kpa", lambda t: t.atmosphere.pressure_kpa)):
        vals = [getter(t).value for t in tests if getter(t).is_known() and isinstance(getter(t).value, (int, float)) and getter(t).kind != "assumed"]
        nums[name] = f"{min(vals)} to {max(vals)}" if vals else "unknown in corpus"
    kr = [c.text for c in corpus.claims_of(inv.id)]

    def e(text, items=None):
        return {"text": text, "items": items if items is not None else [text], "source_refs": refs, "verification": inv.verification}
    return {
        "goal": e(inv.summary_goal),
        "method": e("Recorded protocol (first test): " + ("; ".join(seq) if seq else "not recorded"), seq),
        "materials": e(", ".join(inv.materials) or "not recorded in corpus", inv.materials),
        "conditions_range": {**e("; ".join(f"{k}: {v}" for k, v in nums.items())), "shapes": shapes, "gravity": grav, "numeric": nums,
                             "note": "Assumed placeholder values are not included in ranges."},
        "measurements": e(", ".join(inv.measurements) or "not recorded in corpus", inv.measurements),
        "key_results": e("; ".join(kr) or "No results are recorded in the corpus.", kr),
        "limitations": e("; ".join(inv.limitations), inv.limitations),
    }


app = create_app()
