"""Exports: report (markdown), json, csv (one row per test) and dataset (long format with units, roles, provenance, explicit
blanks and group ids). The dataset refuses to merge incompatible endpoint families."""
from __future__ import annotations

import csv
import io
from hashlib import sha1

from .corpus import Corpus
from .engine import ENDPOINT_REQUIREMENTS, canon_shape
from .models import Review, ScientificValue, Test


class IncompatibleFamilies(ValueError):
    pass


def review_json(r: Review) -> str:
    return r.model_dump_json(indent=1)


def _md_cell(s) -> str:
    return str(s).replace("|", "\\|").replace("\n", " ")


def report_markdown(r: Review, corpus: Corpus) -> str:
    L: list[str] = []
    L.append(f"# EMBER review {r.id} (revision {r.revision})")
    L.append(f"Mode: {r.mode}. Created: {r.created}. Corpus {r.manifest['corpus']['version']}, rules {r.manifest['rules']}, generator {r.manifest['generator']}.")
    L.append("All corpus records are provisional (team-curated, not verified against the cited sources).")
    if r.parent_id:
        L.append(f"Variant of review {r.parent_id}; change: {r.variant_patch}.")
    L.append("\n## Question")
    c = r.query.config.model_dump()
    L.append(f"{r.query.question or '(none)'}\n\n- Endpoint: {r.query.endpoint}\n- Environment: {r.query.environment}\n- Configuration: "
             + ", ".join(f"{k}={v}" for k, v in c.items() if v is not None))
    if r.explanation:
        L.append("\n## Summary")
        L.append(f"({r.explanation.mode}{' - ' + r.explanation.model if r.explanation.model else ''})")
        L.append(r.explanation.summary)
        L += [f"\n{p}" for p in r.explanation.paragraphs]
    if r.warnings:
        L.append("\n## Warnings")
        L += [f"- {w}" for w in r.warnings]
    L.append("\n## Evidence ranking")
    L.append("| Investigation | Relevance | Direct | Limited | Incompatible | Insufficient | Quality | Why |\n|---|---|---|---|---|---|---|---|")
    for i in r.ranking:
        a = i.applicability_summary
        L.append(f"| {i.investigation_id} | {i.relevance} | {a['direct']} | {a['limited_context']} | {a['incompatible']} | {a['insufficient_data']} | {i.quality['level']} | {_md_cell(i.why)} |")
    L.append("\n## Applicability by test")
    L.append("| Test | Status | Endpoint support | Unknown fields |\n|---|---|---|---|")
    for t in r.tests_considered:
        d = t.decisions[0]
        L.append(f"| {t.test_id} | {d.status} | {t.endpoint_support} | {', '.join(d.unknown_fields)} |")
    L.append("\n## Claims")
    for cl in r.claims:
        L.append(f"- **{cl.status}** ({cl.type}) {cl.text} Evidence: {', '.join(cl.evidence)}. Rules: {', '.join(cl.rule_ids)}. Why: {cl.why}")
    L.append("\n## Contrasts")
    for ct in r.contrasts:
        L.append(f"- {'allowed' if ct.allowed else 'not allowed'}: {ct.statement}")
    L.append("\n## Fire-safety insights")
    for i in r.safety_insights:
        L.append(f"### {i.topic}\n- Observation: {i.observation}\n- Interpretation: {i.interpretation}\n- {i.possible_application}\n- Conditions: {i.conditions}")
    L.append("\n## Open questions")
    L += [f"- ({o.kind}) {o.text}" for o in r.open_questions]
    if r.programme:
        p = r.programme
        L.append(f"\n## Test programme ({p.method}, {p.runs_used}/{p.budget_runs} runs)")
        L.append(p.note)
        for b in p.blocks:
            mark = "selected" if b.id in p.selected else "not selected"
            L.append(f"- {b.id} ({mark}): endpoint {b.endpoint}; control {b.control.get('description')}; changed {list(b.changed)}; {b.replicates} replicates; {b.runs} runs. {b.replicate_rationale}")
    L.append("\n## Limitations")
    L += [f"- {x}" for x in r.limitations]
    return "\n".join(L) + "\n"


def review_csv(r: Review, corpus: Corpus) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["review_id", "revision", "endpoint", "test_id", "investigation_id", "series", "record_type", "verification", "status", "endpoint_support", "unknown_fields", "rule_ids", "non_pass_grounds"])
    for t in r.tests_considered:
        d, test = t.decisions[0], corpus.tests[t.test_id]
        w.writerow([r.id, r.revision, r.query.endpoint or "", t.test_id, test.investigation_id, test.series, test.record_type, test.verification, d.status, t.endpoint_support,
                    ";".join(d.unknown_fields), ";".join(sorted({g.rule_id for g in d.grounds})), " | ".join(f"[{g.rule_id}] {g.text}" for g in d.grounds if g.effect != "pass")])
    return buf.getvalue()


def _family(ep: str) -> str:
    return ENDPOINT_REQUIREMENTS[ep].family


def group_id(t: Test, family: str) -> str:
    key = f"{family}|{t.phase}|{canon_shape(t.geometry.shape)}|{t.gravity.regime}|{t.gravity.actual}"
    return "grp_" + sha1(key.encode()).hexdigest()[:8]


def _prov(sv: ScientificValue | None, fallback: str = "") -> str:
    if sv is not None and sv.source_ref:
        s = sv.source_ref
        return f"{s.source_id}; {s.locator}; {s.url}"
    return fallback


def dataset_csv(r: Review, corpus: Corpus, endpoints: list[str] | None = None) -> str:
    if not r.query.endpoint:
        raise IncompatibleFamilies("the review has no endpoint, so no endpoint family can be assigned")
    wanted = endpoints or [r.query.endpoint]
    for e in wanted:
        if e not in ENDPOINT_REQUIREMENTS:
            raise IncompatibleFamilies(f"unknown endpoint {e}")
    fams = {_family(e) for e in wanted} | {_family(r.query.endpoint)}
    if len(fams) > 1:
        raise IncompatibleFamilies(f"refusing to merge incompatible endpoint families: {', '.join(sorted(fams))}. Export one family per dataset.")
    family = fams.pop()
    buf = io.StringIO()
    w = csv.writer(buf)
    cols = ["group_id", "review_id", "endpoint", "endpoint_family", "test_id", "investigation_id", "variable", "value", "unit", "role", "value_kind", "blank",
            "provenance", "applicability_status", "record_type", "verification"]
    w.writerow(cols)
    for tc in r.tests_considered:
        d = tc.decisions[0]
        if d.status not in ("direct", "limited_context"):
            continue
        t = corpus.tests[tc.test_id]
        inv = corpus.investigations[t.investigation_id]
        fb = f"{inv.sources[0].source_id}; {inv.sources[0].locator}; {inv.sources[0].url}" if inv.sources else ""
        gid = group_id(t, family)

        def row(var, sv: ScientificValue | None = None, value=None, unit=None, role=None, kind=None):
            if sv is not None:
                value, unit, role, kind = (sv.value if sv.is_known() else None), sv.unit, sv.role, sv.kind
            blank = value is None
            w.writerow([gid, r.id, r.query.endpoint, family, t.id, t.investigation_id, var, "" if blank else value, unit or "", role or "", kind or "unknown",
                        "true" if blank else "false", _prov(sv, fb), d.status, t.record_type, t.verification])
        row("material", value=t.material, kind="reported" if t.material else "unknown")
        row("shape", value=t.geometry.shape, kind="reported" if t.geometry.shape else "unknown")
        row("thickness_mm", t.geometry.thickness_mm)
        row("diameter_mm", t.geometry.diameter_mm)
        row("width_mm", t.geometry.width_mm)
        row("substrate_confinement", value=t.substrate_confinement, kind="reported" if t.substrate_confinement else "unknown")
        row("gravity_regime", value=None if t.gravity.regime == "unknown" else t.gravity.regime, kind="reported")
        row("gravity_actual", value=None if t.gravity.actual is None else str(t.gravity.actual).lower(), kind="reported")
        row("flow_direction", t.flow.direction)
        row("flow_initial_velocity_cm_s", t.flow.initial_velocity_cm_s)
        row("flow_history_kind", value=None if t.flow.history_kind == "unknown" else t.flow.history_kind, kind="reported")
        row("o2_fraction", t.atmosphere.o2_fraction)
        row("pressure_kpa", t.atmosphere.pressure_kpa)
        row("diluent", t.atmosphere.diluent)
        row("endpoint_support", value=tc.endpoint_support, kind="derived")
    return buf.getvalue()
