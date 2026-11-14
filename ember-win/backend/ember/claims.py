"""Review claims with dependency links, insights (three separate layers), open questions, and variant recompute helpers."""
from __future__ import annotations

from hashlib import sha1

from .corpus import Corpus
from .engine import ENDPOINT_REQUIREMENTS, endpoint_support
from .models import (
    ApplicabilityDecision, Contrast, Insight, OpenQuestion, ResearchQuery, ReviewClaim,
)

STATUS_OF = {"direct": "supported", "limited_context": "needs_new_comparison", "incompatible": "not_applicable", "insufficient_data": "not_applicable"}

# which decision-check fields a changed query parameter can influence
PATCH_FIELDS = {
    "material": ["material"], "shape": ["shape", "thickness"], "thickness_mm": ["thickness"], "o2_fraction": ["o2_fraction"],
    "o2_role": ["o2_fraction"], "pressure_kpa": ["pressure_kpa"], "gravity_regime": ["gravity_regime", "gravity_actual"],
    "flow_direction": ["flow_direction"], "flow_velocity_cm_s": ["flow_velocity"], "ignition": ["ignition"],
    "substrate": ["substrate"], "flow_history": ["flow_history"], "endpoint": ["endpoint", "flow_history"],
}


def _h(*parts: str) -> str:
    return sha1("|".join(parts).encode()).hexdigest()[:10]


def _why(d: ApplicabilityDecision) -> str:
    bad = [g for g in d.grounds if g.effect != "pass"]
    if not bad:
        return "All checked conditions match."
    return " ".join(f"[{g.rule_id}] {g.text}" for g in bad[:4]) + (f" (+{len(bad) - 4} more)" if len(bad) > 4 else "")


def _conditions(q: ResearchQuery, d: ApplicabilityDecision) -> dict:
    cfg = q.config.model_dump()
    cond = {"endpoint": q.endpoint}
    for g in d.grounds:
        key = {"thickness": "thickness_mm", "flow_velocity": "flow_velocity_cm_s", "flow_history": "flow_history", "gravity_actual": "gravity_regime",
               "o2_fraction": "o2_fraction", "endpoint": "endpoint"}.get(g.field, g.field)
        if key in cfg:
            cond[key] = cfg[key]
    return cond


def build_claims(q: ResearchQuery, corpus: Corpus, decisions: dict[str, ApplicabilityDecision], supports: dict[str, tuple[str, str]],
                 contrasts: list[Contrast], focus_tests: list[str]) -> list[ReviewClaim]:
    claims: list[ReviewClaim] = []
    ep = q.endpoint or "unspecified"
    for tid in focus_tests:
        d, t = decisions[tid], corpus.tests[tid]
        sup, expl = supports[tid]
        if d.status in ("direct", "limited_context"):
            text = f"{t.series} ({tid}): {expl}."
        elif d.status == "incompatible":
            text = f"{t.series} ({tid}) does not bear on this question: {expl}." if sup == "not_observed" else f"{t.series} ({tid}) is incompatible with the stated configuration."
        else:
            text = f"{t.series} ({tid}) cannot be used yet: required information is missing ({', '.join(d.unknown_fields) or 'unspecified'})."
        if t.record_type == "exemplar":
            text += " [structural exemplar, not a measurement]"
        claims.append(ReviewClaim(
            id=f"clm_obs_{_h(tid, ep)}", text=text, type="observation", evidence=[tid],
            rule_ids=sorted({g.rule_id for g in d.grounds} | {"R-CLM-01"}), conditions=_conditions(q, d),
            status=STATUS_OF[d.status], why=_why(d), depends_on_fields=sorted({g.field for g in d.grounds})))  # type: ignore[arg-type]
    for c in contrasts:
        if c.test_a not in focus_tests and c.test_b not in focus_tests:
            continue
        claims.append(ReviewClaim(
            id=f"clm_con_{c.id}", text=c.statement, type="derived_interpretation", evidence=[c.test_a, c.test_b],
            rule_ids=sorted(set(c.rule_ids) | {"R-CLM-01"}), conditions={"changed": c.changed_factors, "shared": c.shared},
            status="supported" if c.allowed else "needs_new_comparison",
            why="A single recorded factor differs; this describes the records and does not establish cause." if c.allowed else "Not a controlled comparison.",
            depends_on_fields=sorted(set(c.changed_factors) | set(c.unknown))))
    for cl in corpus.claims.values():
        ev_tests = [e for e in cl.evidence if e in corpus.tests]
        if not ev_tests:
            continue
        ds = [decisions[e] for e in ev_tests if e in decisions]
        usable = [d for d in ds if d.status in ("direct", "limited_context")]
        if not usable:
            continue
        status = "supported" if any(d.status == "direct" for d in usable) else "needs_new_comparison"
        claims.append(ReviewClaim(
            id=f"clm_src_{cl.id}", text=cl.text, type=cl.type, evidence=cl.evidence,
            rule_ids=sorted({g.rule_id for d in usable for g in d.grounds} | {"R-CLM-01"}), conditions=dict(cl.conditions), status=status,  # type: ignore[arg-type]
            why=("Source statement (provisional). " + "; ".join(cl.limitations)) if cl.limitations else "Source statement (provisional).",
            depends_on_fields=sorted({g.field for d in usable for g in d.grounds})))
    return claims


# ----------------------------------------------------------------------------- open questions
def build_open_questions(q: ResearchQuery, corpus: Corpus, decisions: dict[str, ApplicabilityDecision], supports: dict, contrasts: list[Contrast]) -> list[OpenQuestion]:
    ep = q.endpoint or "unspecified"
    usable = [t for t, d in decisions.items() if d.status in ("direct", "limited_context")]
    oqs: list[OpenQuestion] = []
    observed = [t for t in usable if supports[t][0] in ("observed", "partial")]
    if not observed:
        oqs.append(OpenQuestion(id=f"oq_{_h('gap', ep)}", kind="endpoint_gap", endpoint=q.endpoint,
            text=f"No usable record observes the {ep.replace('_', ' ')} outcome for the stated configuration; it would have to be run."))
    counts: dict[str, list[str]] = {}
    for tid in usable[:6]:
        for f in decisions[tid].unknown_fields:
            counts.setdefault(f, []).append(tid)
    for f, tids in sorted(counts.items(), key=lambda kv: (-len(kv[1]), kv[0]))[:4]:
        oqs.append(OpenQuestion(id=f"oq_{_h('missing', f, ep)}", kind="missing_condition", field=f, endpoint=q.endpoint, test_ids=sorted(tids),
            text=f"{f.replace('_', ' ')} is unknown or unspecified in the closest records ({len(tids)} test(s)), so the {ep.replace('_', ' ')} outcome at a stated value is unchecked"))
    seen = set()
    for c in contrasts:
        if c.allowed:
            continue
        key = tuple(c.changed_factors) or ("unknown",)
        if key in seen or len(seen) >= 3:
            continue
        seen.add(key)
        label = ", ".join(key).replace("_", " ")
        text = (f"No controlled single-factor comparison of {label} exists in the corpus for {ep.replace('_', ' ')}." if key != ("unknown",)
                else f"The closest records cannot be compared for {ep.replace('_', ' ')}: no single factor differs or key conditions are unknown on at least one side.")
        oqs.append(OpenQuestion(id=f"oq_{_h('cmp', *key, ep)}", kind="needs_comparison", field=key[0] if key != ("unknown",) else None, endpoint=q.endpoint,
            test_ids=[c.test_a, c.test_b], text=text))
    return oqs


# ----------------------------------------------------------------------------- insights
_APPLICATION = {
    "ignition": "Possible application: when screening materials or settings for ignition resistance, treat the recorded ignition conditions as candidates to check; this is not a safety threshold.",
    "flame_establishment": "Possible application: use the recorded establishment conditions as candidates for follow-up checks; not a safety threshold.",
    "sustained_spread": "Possible application: use the recorded spread conditions as candidates when reviewing material choices; not a safety threshold.",
    "extinction_under_flow_reduction": "Possible application: if ventilation reduction is considered as a response to fire, the recorded flow-reduction protocol is a candidate to replicate for the actual material and geometry; the records alone do not give a flow level that ensures extinction.",
    "cool_burning": "Possible application: detection and suppression logic should not assume that loss of the visible flame means burning has stopped, pending evidence for the relevant fuel.",
    "smoke_detection": "Possible application: smoke detector design should be checked against the recorded particle measurements for the relevant material; the records do not give a detector specification.",
    "suppression": "Possible application: candidate atmosphere or diluent changes to test for suppression; the droplet analogue does not establish performance on solid fuels.",
}
_TOPIC = {"ignition": "prevention", "flame_establishment": "prevention", "sustained_spread": "prevention",
          "extinction_under_flow_reduction": "suppression", "cool_burning": "detection", "smoke_detection": "detection", "suppression": "suppression"}


def build_insights(q: ResearchQuery, corpus: Corpus, claims: list[ReviewClaim], oqs: list[OpenQuestion], ranked_ids: list[str]) -> list[Insight]:
    if not q.endpoint:
        return []
    topic = q.topic or _TOPIC[q.endpoint]
    obs = [c for c in claims if c.type == "observation" and c.status in ("supported", "needs_new_comparison")]
    insights: list[Insight] = []
    by_inv: dict[str, list[ReviewClaim]] = {}
    for c in obs:
        by_inv.setdefault(corpus.tests[c.evidence[0]].investigation_id, []).append(c)
    for iid in ranked_ids:
        if iid not in by_inv or len(insights) >= 3:
            continue
        cs = by_inv[iid][:3]
        inv = corpus.investigations[iid]
        cond_status = "all matching conditions are known" if all(c.status == "supported" for c in cs) else "some conditions are unknown or differ, so the result is limited to the recorded context"
        interp = [c for c in claims if c.type != "observation" and set(c.evidence) & {*inv.tests, *(ch.id for ch in inv.text_chunks)}]
        interpretation = (interp[0].text + " (stated as interpretation, provisional)") if interp else f"No interpretation is recorded in the corpus for {inv.name}; the observation is not generalised."
        insights.append(Insight(
            id=f"ins_{_h(iid, q.endpoint)}", topic=topic,  # type: ignore[arg-type]
            observation=" ".join(c.text for c in cs[:2]), interpretation=f"{interpretation} Evidence status: {cond_status}.",
            possible_application=_APPLICATION[q.endpoint], conditions={"investigation": inv.name, **{k: v for k, v in cs[0].conditions.items() if v is not None}},
            open_questions=[o.id for o in oqs[:3]], claim_ids=[c.id for c in cs] + [c.id for c in interp[:1]]))
    return insights


def diff_claims(before: list[ReviewClaim], after: list[ReviewClaim], patch: dict, before_dec: dict[str, ApplicabilityDecision],
                after_dec: dict[str, ApplicabilityDecision]) -> list[dict]:
    b, a = {c.id: c for c in before}, {c.id: c for c in after}
    changed_fields = {f for k in patch for f in PATCH_FIELDS.get(k, [])}
    out = []
    for cid in sorted(set(b) | set(a)):
        cb, ca = b.get(cid), a.get(cid)
        if cb and ca and cb.status == ca.status and cb.why == ca.why:
            continue
        ref = ca or cb
        fields: set[str] = set()
        reasons = []
        for tid in ref.evidence:
            if tid in before_dec and tid in after_dec:
                gb = {(g.rule_id, g.field, g.effect) for g in before_dec[tid].grounds}
                ga = {(g.rule_id, g.field, g.effect) for g in after_dec[tid].grounds}
                for rule, field, eff in sorted(ga - gb):
                    fields.add(field)
                    txt = next(g.text for g in after_dec[tid].grounds if (g.rule_id, g.field, g.effect) == (rule, field, eff))
                    reasons.append(f"[{rule}] {txt}")
        reasons = list(dict.fromkeys(reasons))
        params = sorted(k for k in patch if set(PATCH_FIELDS.get(k, [])) & (fields or changed_fields))
        if not cb:
            reason = "claim appears only after the change. " + " ".join(reasons[:2])
        elif not ca:
            reason = "claim no longer applies after the change. " + " ".join(reasons[:2])
        else:
            reason = f"status {cb.status} -> {ca.status}. " + " ".join(reasons[:3])
        out.append({"claim_id": cid, "before": cb.status if cb else None, "after": ca.status if ca else None,
                    "changed_parameter": ", ".join(params) or ", ".join(sorted(patch)), "reason": reason.strip()})
    return out
