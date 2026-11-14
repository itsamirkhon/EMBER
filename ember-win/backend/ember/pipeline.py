"""Assembles a Review from a ResearchQuery: retrieval -> applicability -> contrasts -> claims -> insights -> explanation."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from itertools import combinations
from typing import Any, Callable

from . import __version__
from .claims import build_claims, build_insights, build_open_questions, diff_claims
from .corpus import Corpus
from .engine import RULES_VERSION, compare_tests, endpoint_support, evaluate_test, evidence_quality
from .explain import explain as default_explain
from .models import QueryConfig, RankingItem, ResearchQuery, Review, TestConsidered
from .retrieval import Retriever

LEVELS = ["very_low", "low", "moderate", "high"]
ABSENT = re.compile(r"\b(saffire[- ]?(iv|v|vi)\b|mdca|bass[- ]?iii)\b", re.I)
HARD_OK_FIELDS = {"endpoint", "flow_history"}  # contrasts may include tests that only fail on the endpoint mapping


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def analyse(q: ResearchQuery, corpus: Corpus, retriever: Retriever, *, review_id: str, created: str | None = None,
            explain_fn: Callable[..., Any] | None = default_explain, parent_id: str | None = None, variant_patch: dict | None = None) -> Review:
    hits = retriever.rank_for_query(q)
    decisions = {tid: evaluate_test(q, t) for tid, t in corpus.tests.items()}
    supports = {tid: endpoint_support(t, q.endpoint) for tid, t in corpus.tests.items()}
    max_score = max((h.score for h in hits), default=1.0) or 1.0

    ranking: list[RankingItem] = []
    for h in hits:
        inv = corpus.investigations[h.id]
        summ = {k: 0 for k in ("direct", "limited_context", "incompatible", "insufficient_data")}
        qualities = []
        for t in corpus.tests_of(h.id):
            d = decisions[t.id]
            summ[d.status] += 1
            qualities.append((d.status, evidence_quality(t, inv.coverage, any(s.url for s in inv.sources))))
        usable = [qq for st, qq in qualities if st in ("direct", "limited_context")] or [qq for _, qq in qualities]
        best = max(usable, key=lambda x: LEVELS.index(x["level"])) if usable else {"level": "very_low", "factors": []}
        quality = {"level": best["level"], "verification": inv.verification, "coverage": inv.coverage, "factors": best["factors"],
                   "note": "Evidence quality is separate from relevance and applicability."}
        why = h.why + f" Applicability of its tests: {summ['direct']} direct, {summ['limited_context']} limited, {summ['incompatible']} incompatible, {summ['insufficient_data']} insufficient."
        ranking.append(RankingItem(investigation_id=h.id, relevance=round(h.score / max_score, 4), applicability_summary=summ, quality=quality, why=why))

    tests_considered = [TestConsidered(test_id=tid, endpoint_support=supports[tid][0], decisions=[decisions[tid]])  # type: ignore[arg-type]
                        for tid in corpus.tests]

    top_inv = [r.investigation_id for r in ranking[:3] if r.relevance > 0]
    focus = [t.id for iid in top_inv for t in corpus.tests_of(iid)]
    cand = [tid for tid in focus if not any(g.effect == "fail" and g.field not in HARD_OK_FIELDS and _hard(decisions[tid], g) for g in decisions[tid].grounds)]
    contrasts = []
    by_inv: dict[str, list[str]] = {}
    for tid in cand:
        by_inv.setdefault(corpus.tests[tid].investigation_id, []).append(tid)
    for tids in by_inv.values():
        for a, b in combinations(sorted(tids), 2):
            contrasts.append(compare_tests(corpus.tests[a], corpus.tests[b], q.endpoint))
    contrasts.sort(key=lambda c: (not c.allowed, len(c.changed_factors), c.id))
    contrasts = contrasts[:12]

    claims = build_claims(q, corpus, decisions, supports, contrasts, focus)
    oqs = build_open_questions(q, corpus, decisions, supports, contrasts)
    insights = build_insights(q, corpus, claims, oqs, [r.investigation_id for r in ranking])

    warnings: list[str] = []
    if q.endpoint is None:
        warnings.append("No endpoint was stated; every test is insufficient_data until an endpoint is chosen.")
    if not any(d.status in ("direct", "limited_context") for d in decisions.values()):
        warnings.append("No record in the corpus is applicable to this configuration and endpoint.")
    for m in ABSENT.finditer(q.question or ""):
        warnings.append(f"'{m.group(0)}' is not in the corpus; the results below do not cover it.")
    limitations = [
        "All corpus records are provisional (team-curated, not yet verified against the cited sources).",
        "Numeric conditions that are unknown in the corpus are never assumed; unknown on both sides is not a match.",
        "Contrasts describe differences between records and do not establish cause.",
        f"Coverage: {sum(1 for i in corpus.investigations.values() if i.coverage == 'deep')} deep and "
        f"{sum(1 for i in corpus.investigations.values() if i.coverage == 'catalog')} catalog-level investigations.",
    ]
    r = Review(id=review_id, revision=1, created=created or now_iso(), query=q, mode="deterministic",
               manifest={"corpus": {"version": corpus.version, "hash": corpus.content_hash}, "rules": RULES_VERSION, "code": __version__, "generator": "deterministic-v1"},
               ranking=ranking, tests_considered=tests_considered, contrasts=contrasts, claims=claims, safety_insights=insights, conflicts=[],
               limitations=limitations, open_questions=oqs, programme=None, warnings=warnings, parent_id=parent_id, variant_patch=variant_patch)
    if explain_fn is not None:
        e = explain_fn(r)
        r.explanation, r.mode = e, e.mode
        r.manifest["generator"] = f"live_ai:{e.model}" if e.mode == "live_ai" else "deterministic-v1"
        r.warnings += e.warnings
    return r


def _hard(d, g) -> bool:
    from .engine import RULES
    return RULES[g.rule_id].severity == "hard"


def apply_patch(q: ResearchQuery, patch: dict) -> ResearchQuery:
    if not patch:
        raise ValueError("config_patch must not be empty")
    cfg_keys = set(QueryConfig.model_fields)
    top_keys = {"endpoint", "environment", "topic"}
    unknown = set(patch) - cfg_keys - top_keys
    if unknown:
        raise ValueError(f"unknown parameter(s) in config_patch: {', '.join(sorted(unknown))}")
    data = q.model_dump()
    for k, v in patch.items():
        (data if k in top_keys else data["config"])[k] = v
    return ResearchQuery.model_validate(data)


def make_variant(base: Review, patch: dict, corpus: Corpus, retriever: Retriever, *, new_id: str, created: str | None = None,
                 explain_fn: Callable[..., Any] | None = default_explain) -> tuple[Review, list[dict]]:
    nq = apply_patch(base.query, patch)
    if nq == base.query:
        raise ValueError("config_patch does not change the query")
    var = analyse(nq, corpus, retriever, review_id=new_id, created=created, explain_fn=explain_fn, parent_id=base.id, variant_patch=patch)
    before = {t.test_id: t.decisions[0] for t in base.tests_considered}
    after = {t.test_id: t.decisions[0] for t in var.tests_considered}
    diff = diff_claims(base.claims, var.claims, patch, before, after)
    return var, diff
