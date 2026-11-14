"""Explanation generation. Deterministic by default (labelled `deterministic`). If OPENAI_API_KEY is set, an optional live
path asks a model to rewrite the evidence package; its output is verified against the package and, on any failure, the
deterministic text is used instead with a visible warning. A template is never presented as live AI."""
from __future__ import annotations

import json
import os
import re
import urllib.request
from typing import Callable

from .models import Explanation, Review

CAUSAL = re.compile(r"\b(prov(es|ed|e)|demonstrat(es|ed)|caused by|because of|leads to|guarantee[sd]?)\b", re.I)
ID_RE = re.compile(r"\b(?:t|inv|clm|ctr|oq|ins|src|rev|blk|c)_[a-z0-9_]+\b", re.I)
NUM_RE = re.compile(r"(?<![A-Za-z_])(-?\d+(?:\.\d+)?)\s*(%|kpa|cm/s|mm/s|m/s|mm|k|g)?(?![A-Za-z0-9_])", re.I)


def _walk_text(obj, out: list[str]):
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            _walk_text(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _walk_text(v, out)


def _fnum(s: str) -> float:
    return round(float(s), 6)


def evidence_package(r: Review) -> dict:
    cfg = r.query.config
    pairs: set[tuple[float, str]] = set()
    numbers: set[float] = set()
    for val, unit in ((cfg.thickness_mm, "mm"), (cfg.pressure_kpa, "kpa"), (cfg.flow_velocity_cm_s, "cm/s")):
        if val is not None:
            pairs.add((_fnum(val), unit)); numbers.add(_fnum(val))
    if cfg.o2_fraction is not None:
        pairs.add((_fnum(cfg.o2_fraction), "")); pairs.add((_fnum(cfg.o2_fraction * 100), "%")); numbers |= {_fnum(cfg.o2_fraction), _fnum(cfg.o2_fraction * 100)}
    ids = {c.id for c in r.claims} | {t.test_id for t in r.tests_considered} | {i.investigation_id for i in r.ranking} | {o.id for o in r.open_questions}
    ids |= {c.id for c in r.contrasts} | {i.id for i in r.safety_insights} | {r.id}
    counts = {"tests": len(r.tests_considered), **{k: sum(1 for t in r.tests_considered for d in t.decisions if d.status == k)
              for k in ("direct", "limited_context", "incompatible", "insufficient_data")}}
    numbers |= {float(v) for v in counts.values()}
    # numbers appearing in the review's own text fields are part of the evidence (they come from the engine, not a model)
    texts: list[str] = []
    for part in (r.claims, r.safety_insights, r.open_questions, r.contrasts, r.limitations):
        _walk_text([p.model_dump() if hasattr(p, "model_dump") else p for p in part], texts)
    for t in texts:
        cleaned = ID_RE.sub(" ", t)
        for m in NUM_RE.finditer(cleaned):
            numbers.add(_fnum(m.group(1)))
            pairs.add((_fnum(m.group(1)), (m.group(2) or "").lower()))
    return {"ids": ids, "numbers": numbers, "pairs": pairs, "counts": counts}


def verify_text(text: str, pkg: dict) -> list[str]:
    problems: list[str] = []
    for m in ID_RE.finditer(text):
        if m.group(0) not in pkg["ids"] and m.group(0).lower() not in {i.lower() for i in pkg["ids"]}:
            problems.append(f"unknown id {m.group(0)}")
    cleaned = ID_RE.sub(" ", text)
    for m in NUM_RE.finditer(cleaned):
        v, unit = _fnum(m.group(1)), (m.group(2) or "").lower()
        if v not in pkg["numbers"]:
            problems.append(f"number {m.group(1)} is not in the evidence package")
        elif unit and (v, unit) not in pkg["pairs"]:
            problems.append(f"unit '{unit}' for {m.group(1)} is not in the evidence package")
    if CAUSAL.search(text):
        problems.append("causal wording is not allowed")
    return problems


def _counts_line(r: Review) -> str:
    c = evidence_package(r)["counts"]
    return (f"Of {c['tests']} tests checked, {c['direct']} are directly applicable, {c['limited_context']} apply with limited context, "
            f"{c['incompatible']} are incompatible and {c['insufficient_data']} lack data.")


def deterministic_explanation(r: Review) -> Explanation:
    ep = (r.query.endpoint or "unspecified").replace("_", " ")
    top = r.ranking[0] if r.ranking else None
    supported = [c for c in r.claims if c.type == "observation" and c.status in ("supported", "needs_new_comparison")]
    obs = " ".join(c.text for c in supported[:2]) or "No applicable record observes this endpoint under the stated configuration."
    interp = next((c.text for c in r.claims if c.type != "observation" and c.status != "not_applicable"), None)
    interp_txt = (interp + " (provisional; interpretation, not an observation)") if interp else "No interpretation is recorded for the applicable evidence; none is added."
    app = r.safety_insights[0].possible_application if r.safety_insights else "No application is suggested because no applicable evidence was found."
    missing = "; ".join(o.text.rstrip(".") for o in r.open_questions[:3]) or "No open questions were generated."
    summary = (f"Review of '{r.query.question or ep}' for endpoint {ep}. " + _counts_line(r)
               + (f" Best-matching investigation: {top.investigation_id}." if top else ""))
    return Explanation(mode="deterministic", summary=summary, paragraphs=[
        f"Observation: {obs}", f"Interpretation: {interp_txt}", f"Possible application: {app.removeprefix('Possible application: ')}", f"Missing: {missing}.",
        "All records are provisional; this text is generated from templates and the evidence package, not by a language model."], warnings=[])


def _openai_call(api_key: str, model: str) -> Callable[[list[dict]], str]:
    def call(messages: list[dict]) -> str:
        req = urllib.request.Request("https://api.openai.com/v1/chat/completions", method="POST",
            data=json.dumps({"model": model, "messages": messages, "response_format": {"type": "json_object"}}).encode(),
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:  # noqa: S310 - fixed https endpoint
            return json.loads(resp.read())["choices"][0]["message"]["content"]
    return call


def explain(r: Review, llm: Callable[[list[dict]], str] | None = None, api_key: str | None = None, model: str | None = None) -> Explanation:
    api_key = api_key if api_key is not None else os.environ.get("OPENAI_API_KEY")
    det = deterministic_explanation(r)
    if not api_key:
        return det
    model = model or os.environ.get("EMBER_OPENAI_MODEL", "gpt-4.1-mini")
    pkg = evidence_package(r)
    facts = {"question": r.query.question, "endpoint": r.query.endpoint, "summary": det.summary, "paragraphs": det.paragraphs,
             "claims": [{"id": c.id, "text": c.text, "status": c.status} for c in r.claims[:12]]}
    messages = [
        {"role": "system", "content": "Rewrite the evidence package as a short explanation for fire-safety engineers. Use ONLY facts, numbers, units and ids "
         "present in the package. Keep four labelled parts: Observation, Interpretation, Possible application, Missing. Never claim causation. "
         'Return JSON {"summary": str, "paragraphs": [str]}.'},
        {"role": "user", "content": json.dumps(facts)}]
    try:
        raw = (llm or _openai_call(api_key, model))(messages)
        data = json.loads(raw)
        summary, paras = str(data["summary"]), [str(p) for p in data.get("paragraphs", [])]
    except Exception as e:  # network, auth, parse: all fall back visibly
        det.warnings = [f"live_ai request failed ({type(e).__name__}: {e}); showing deterministic text instead."]
        return det
    problems = verify_text(" ".join([summary, *paras]), pkg)
    if problems:
        det.warnings = [f"live_ai output failed verification ({len(problems)} problem(s): {'; '.join(problems[:3])}); showing deterministic text instead."]
        return det
    return Explanation(mode="live_ai", summary=summary, paragraphs=paras, warnings=[], model=model)
