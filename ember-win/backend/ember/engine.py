"""Applicability engine.

Order of reasoning (never reversed): semantic rules first (material/phase, geometry, gravity,
flow, endpoint-to-event mapping, planned vs observed), numeric closeness only afterwards and
only when both sides are known numbers. Two unknowns are never a match.

Relevance (retrieval score), applicability (this module) and evidence quality are separate.
"""
from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha1
from typing import Any

from .models import (
    ApplicabilityDecision, Contrast, Ground, ResearchQuery, ScientificValue, Test,
)

RULES_VERSION = "2026.11-r1"


@dataclass(frozen=True)
class Rule:
    id: str
    title: str
    severity: str  # hard (-> incompatible) | soft (-> limited_context) | gate (unknown -> insufficient) | contrast
    description: str
    heuristic: bool = False  # True when it carries a tolerance chosen by the team, not derived from the literature


_R = [
    Rule("R-OBS-01", "Planned is not observed", "gate", "A planned test has no observed outcome and cannot support a claim."),
    Rule("R-PHASE-01", "Fuel phase must match", "hard", "Solid, liquid and aerosol records answer different questions."),
    Rule("R-FAM-01", "Material identity", "hard", "Results are material-specific; a different material is not evidence for this material."),
    Rule("R-GEOM-01", "Geometry shape must match", "hard", "Rod, sheet, droplet and aerosol geometries are not interchangeable."),
    Rule("R-GEOM-02", "Thickness/diameter closeness", "soft", "Characteristic dimension affects thermal regime; differing or non-comparable values limit transfer.", True),
    Rule("R-SUB-01", "Substrate/confinement", "soft", "A backing substrate or confinement changes heat loss and flow."),
    Rule("R-GRAV-01", "Gravity regime must match", "hard", "Microgravity, partial and normal gravity flames are different regimes."),
    Rule("R-GRAV-02", "Actual versus simulated gravity", "soft", "A simulated or analogue low-gravity record does not carry actual-microgravity evidence."),
    Rule("R-FLOW-01", "Flow direction", "hard", "Concurrent, opposed and quiescent flow are different spread regimes."),
    Rule("R-FLOW-02", "Endpoint needs a flow reduction", "hard", "Extinction under flow reduction needs a run in which flow was reduced."),
    Rule("R-FLOW-03", "Initial flow velocity closeness", "soft", "Initial flow differences limit transfer.", True),
    Rule("R-FLOW-04", "Flow history", "soft", "Same initial flow with a different reduction history is a different condition."),
    Rule("R-GAS-01", "O2 role: ambient versus oxidizer stream", "soft", "An ambient fraction and an oxidizer-stream fraction are not the same quantity."),
    Rule("R-GAS-02", "O2 fraction closeness", "soft", "Oxygen differences beyond tolerance limit transfer.", True),
    Rule("R-PRS-01", "Pressure closeness", "soft", "Pressure differences beyond tolerance limit transfer.", True),
    Rule("R-IGN-01", "Ignition method", "soft", "Different ignition methods limit ignition-endpoint transfer."),
    Rule("R-EVT-01", "Endpoint-to-event mapping", "hard", "The endpoint must correspond to a recorded event; operator termination is not extinction."),
    Rule("R-EVT-02", "Hot extinction with continued cool burning", "soft", "Loss of the hot flame is not final extinction when cool burning continues."),
    Rule("R-EP-01", "Endpoint must be stated", "gate", "Without an endpoint no event mapping is possible."),
    Rule("R-CON-01", "Single changed factor", "contrast", "A comparison is only allowed when exactly one recorded parameter differs."),
    Rule("R-CON-02", "Unknown fields block a comparison", "contrast", "Unknown on either side means the factor may differ; it is never a match."),
    Rule("R-CON-03", "Same initial flow, different history", "contrast", "Equal initial flow does not make flow conditions equal when the history differs."),
    Rule("R-CON-04", "No causal claim", "contrast", "A contrast reports a difference between records, never a demonstrated cause."),
    Rule("R-CON-05", "Outcome not comparable", "contrast", "A run that did not reach the endpoint cannot be compared as if it had."),
    Rule("R-CLM-01", "Claim status from applicability", "contrast", "direct -> supported; limited_context -> needs_new_comparison; otherwise not_applicable."),
]
RULES: dict[str, Rule] = {r.id: r for r in _R}

TOLERANCES = {"o2_fraction_abs": 0.02, "pressure_rel": 0.10, "flow_velocity_rel": 0.20, "dimension_rel": 0.20}


@dataclass(frozen=True)
class EndpointReq:
    endpoint: str
    family: str
    required: tuple[str, ...]
    important: tuple[str, ...]
    needs: str  # human statement of the evidence needed


ENDPOINT_REQUIREMENTS: dict[str, EndpointReq] = {
    "ignition": EndpointReq("ignition", "ignition_establishment", ("material", "shape", "gravity_regime"),
        ("thickness", "o2_fraction", "pressure_kpa", "flow_velocity", "ignition", "gravity_actual"), "ignition attempt event"),
    "flame_establishment": EndpointReq("flame_establishment", "ignition_establishment", ("material", "shape", "gravity_regime"),
        ("o2_fraction", "pressure_kpa", "flow_velocity", "gravity_actual"), "flame establishment event"),
    "sustained_spread": EndpointReq("sustained_spread", "spread", ("material", "shape", "gravity_regime"),
        ("thickness", "flow_direction", "flow_velocity", "o2_fraction", "pressure_kpa", "gravity_actual"), "sustained spread event"),
    "extinction_under_flow_reduction": EndpointReq("extinction_under_flow_reduction", "extinction_flow",
        ("material", "shape", "gravity_regime", "flow_history"),
        ("thickness", "flow_direction", "flow_velocity", "o2_fraction", "pressure_kpa", "substrate", "gravity_actual"),
        "a flow reduction step and an extinction event (not operator termination)"),
    "cool_burning": EndpointReq("cool_burning", "cool_flame", ("material", "gravity_regime"), ("gravity_actual",),
        "hot extinction followed by continued cool burning"),
    "smoke_detection": EndpointReq("smoke_detection", "detection", ("gravity_regime",), ("gravity_actual",),
        "smoke/aerosol particle measurements"),
    "suppression": EndpointReq("suppression", "suppression", ("material", "gravity_regime"),
        ("o2_fraction", "pressure_kpa", "gravity_actual"), "an intervention/gas-change step and an extinction event"),
}

# ----------------------------------------------------------------------------- normalisation
_MATERIALS = {
    "pmma": ("pmma", "solid"), "polymethyl methacrylate": ("pmma", "solid"), "acrylic": ("pmma", "solid"),
    "plexiglas": ("pmma", "solid"), "plexiglass": ("pmma", "solid"),
    "cotton fiberglass": ("cotton_fiberglass", "solid"), "sibal": ("cotton_fiberglass", "solid"),
    "cotton": ("cotton", "solid"), "fiberglass": ("cotton_fiberglass", "solid"),
    "wood": ("wood", "solid"), "paper": ("paper", "solid"), "nomex": ("nomex", "solid"), "kapton": ("kapton", "solid"),
    "teflon": ("teflon", "solid"), "polyethylene": ("polyethylene", "solid"),
    "n heptane": ("n_heptane", "liquid"), "heptane": ("n_heptane", "liquid"), "methanol": ("methanol", "liquid"),
    "ethanol": ("ethanol", "liquid"), "decane": ("n_decane", "liquid"),
}
_SHAPES = {"rod": "rod", "cylinder": "rod", "cylindrical": "rod", "sheet": "sheet", "flat": "sheet", "plate": "sheet",
           "slab": "sheet", "panel": "sheet", "fabric": "sheet", "film": "sheet", "droplet": "droplet", "drop": "droplet",
           "sphere": "droplet", "aerosol": "aerosol", "smoke": "aerosol"}


def _norm(s: str | None) -> str:
    return " ".join((s or "").lower().replace("_", " ").replace("-", " ").split())


def canon_material(s: str | None) -> tuple[str | None, str | None]:
    n = _norm(s)
    if not n:
        return None, None
    for key in sorted(_MATERIALS, key=len, reverse=True):
        if key in n:
            return _MATERIALS[key]
    return None, None


def canon_shape(s: str | None) -> str | None:
    n = _norm(s)
    for key in sorted(_SHAPES, key=len, reverse=True):
        if key in n:
            return _SHAPES[key]
    return None


# ----------------------------------------------------------------------------- check plumbing
@dataclass
class Check:
    rule_id: str
    field: str
    effect: str  # pass | fail | unknown
    text: str
    hard: bool = False
    assumed: bool = False


def _q_unspecified(rule: str, field: str, what: str) -> Check:
    return Check(rule, field, "unknown", f"The query does not specify {what}.")


def _num(sv: ScientificValue) -> float | None:
    return sv.number()


def _compare_values(rule: str, field: str, qv: Any, sv: ScientificValue, what: str, *, rel: float | None = None,
                    absol: float | None = None, unit: str = "") -> Check:
    """Query value (number or None) against a test ScientificValue. Numbers only compared when both numeric."""
    if qv is None:
        return _q_unspecified(rule, field, what)
    if not sv.is_known():
        return Check(rule, field, "unknown", f"{what}: unknown in the test record (query: {qv}{unit}); unknown is never a match.")
    tn = _num(sv)
    assumed = not sv.is_measured()
    if tn is None:
        return Check(rule, field, "unknown", f"{what}: test records the label '{sv.value}', not comparable with the numeric query value {qv}{unit}.")
    diff = abs(tn - qv)
    close = diff <= absol if absol is not None else diff <= rel * max(abs(qv), abs(tn), 1e-12)
    note = " (assumed value, not a measurement)" if assumed else ""
    if close:
        return Check(rule, field, "pass", f"{what}: test {tn:g}{unit} is within tolerance of the query {qv:g}{unit}{note}.", assumed=assumed)
    return Check(rule, field, "fail", f"{what}: test {tn:g}{unit} differs from the query {qv:g}{unit} beyond tolerance{note}.", assumed=assumed)


def _dimension_sv(shape: str | None, t: Test) -> tuple[ScientificValue, str]:
    cs = canon_shape(t.geometry.shape)
    if cs in ("rod", "droplet"):
        return t.geometry.diameter_mm, "diameter"
    return t.geometry.thickness_mm, "thickness"


def has_flow_reduction(t: Test) -> bool | None:
    k = t.flow.history_kind
    if k in ("stepwise_reduction", "continuous_ramp", "reduction"):
        return True
    if k == "constant":
        return False
    if any(s.kind == "flow_change" and "reduc" in s.description.lower() for s in t.protocol):
        return True
    return None


def observed_kinds(t: Test) -> set[str]:
    return {e.kind for e in t.events if e.observed}


def endpoint_support(t: Test, endpoint: str | None) -> tuple[str, str]:
    """-> (support, explanation). support in observed|partial|not_observed|unknown|planned."""
    if endpoint is None:
        return "unknown", "no endpoint stated"
    if t.observation_status == "planned":
        return "planned", "planned test: no observed outcome exists"
    ev = observed_kinds(t)
    complete = t.events_complete

    def absent(msg: str) -> tuple[str, str]:
        return ("not_observed", msg + " (the record lists all events)") if complete else ("unknown", msg + " is not recorded; the record's event list is incomplete")

    if endpoint == "ignition":
        return ("observed", "ignition attempt recorded") if "ignition_attempt" in ev else absent("ignition attempt")
    if endpoint == "flame_establishment":
        return ("observed", "flame establishment recorded") if "flame_establishment" in ev else absent("flame establishment")
    if endpoint == "sustained_spread":
        return ("observed", "sustained spread recorded") if "sustained_spread" in ev else absent("sustained spread")
    if endpoint == "cool_burning":
        if {"hot_extinction", "continued_cool_burning"} <= ev:
            return "observed", "hot extinction followed by continued cool burning recorded"
        return absent("hot extinction with continued cool burning")
    if endpoint == "smoke_detection":
        if any(w in m.name.lower() for m in t.measurements for w in ("particle", "smoke", "aerosol")):
            return "observed", "smoke/aerosol particle measurement recorded"
        return ("not_observed", "no smoke/aerosol measurement in the record") if t.measurements else ("unknown", "no measurements recorded")
    if endpoint == "suppression":
        has_step = any(s.kind in ("intervention", "gas_change") for s in t.protocol)
        if has_step and ev & {"final_extinction", "hot_extinction"}:
            return "observed", "intervention/gas-change step with an extinction event recorded"
        if not has_step and t.protocol:
            return "not_observed", "no intervention or gas-change step in the protocol"
        return "unknown", "intervention step and extinction outcome not both recorded"
    if endpoint == "extinction_under_flow_reduction":
        red = has_flow_reduction(t)
        if red is False:
            return "not_observed", "the run did not reduce flow, so extinction under flow reduction was not tested"
        if "final_extinction" in ev:
            return ("observed", "final extinction recorded after a flow reduction") if red else ("unknown", "extinction recorded but flow reduction not recorded")
        if "hot_extinction" in ev and "continued_cool_burning" in ev:
            return "partial", "hot flame went out but cool burning continued; this is not final extinction"
        if "hot_extinction" in ev:
            return ("observed", "hot extinction recorded after a flow reduction") if red else ("unknown", "extinction recorded but flow reduction not recorded")
        if "operator_termination" in ev and complete:
            return "not_observed", "the run was terminated by the operator; the flame did not go out, so extinction was not observed"
        return absent("extinction")
    return "unknown", "unrecognised endpoint"


# ----------------------------------------------------------------------------- field checks
def _checks(q: ResearchQuery, t: Test) -> list[Check]:
    c, ep = q.config, q.endpoint
    out: list[Check] = []
    # ---- semantic: endpoint-to-event / observed
    sup, why = endpoint_support(t, ep)
    if ep is None:
        out.append(Check("R-EP-01", "endpoint", "unknown", "The query states no endpoint, so no event mapping is possible."))
    elif sup == "planned":
        out.append(Check("R-OBS-01", "endpoint", "unknown", "Planned test with no observed outcome; it cannot support an observation."))
    elif sup == "observed":
        out.append(Check("R-EVT-01", "endpoint", "pass", f"Endpoint {ep}: {why}."))
    elif sup == "partial":
        out.append(Check("R-EVT-02", "endpoint", "fail", f"Endpoint {ep}: {why}."))
    elif sup == "not_observed":
        out.append(Check("R-EVT-01", "endpoint", "fail", f"Endpoint {ep}: {why}.", hard=True))
    else:
        out.append(Check("R-EVT-01", "endpoint", "unknown", f"Endpoint {ep}: {why}."))
    # ---- material / phase
    qm, qphase = canon_material(c.material)
    tm, _ = canon_material(t.material)
    if c.material is None:
        out.append(_q_unspecified("R-FAM-01", "material", "a material"))
    else:
        tphase = t.phase if t.phase != "unknown" else None
        if qphase and tphase:
            out.append(Check("R-PHASE-01", "material", "pass" if qphase == tphase else "fail",
                             f"Fuel phase: query {qphase}, test {tphase}.", hard=qphase != tphase))
        if qm and tm:
            out.append(Check("R-FAM-01", "material", "pass" if qm == tm else "fail",
                             f"Material: query {c.material}, test {t.material}.", hard=qm != tm))
        elif not t.material:
            out.append(Check("R-FAM-01", "material", "unknown", "Material is unknown in the test record."))
        elif not qm and _norm(c.material) == _norm(t.material):
            out.append(Check("R-FAM-01", "material", "pass", f"Material names are identical ({t.material})."))
        else:
            out.append(Check("R-FAM-01", "material", "unknown", f"Material '{c.material}' is not in the recognised material table; identity versus '{t.material}' cannot be assessed."))
    # ---- shape
    if c.shape is None:
        out.append(_q_unspecified("R-GEOM-01", "shape", "a geometry"))
    else:
        qs, ts = canon_shape(c.shape), canon_shape(t.geometry.shape)
        if qs is None:
            out.append(Check("R-GEOM-01", "shape", "unknown", f"Query shape '{c.shape}' is not recognised."))
        elif ts is None:
            out.append(Check("R-GEOM-01", "shape", "unknown", "Geometry shape is unknown in the test record."))
        else:
            out.append(Check("R-GEOM-01", "shape", "pass" if qs == ts else "fail", f"Geometry: query {qs}, test {ts}.", hard=qs != ts))
    # ---- gravity (regime then actual)
    if c.gravity_regime is None:
        out.append(_q_unspecified("R-GRAV-01", "gravity_regime", "a gravity regime"))
    elif t.gravity.regime == "unknown":
        out.append(Check("R-GRAV-01", "gravity_regime", "unknown", "Gravity regime is unknown in the test record."))
    else:
        ok = c.gravity_regime == t.gravity.regime
        out.append(Check("R-GRAV-01", "gravity_regime", "pass" if ok else "fail",
                         f"Gravity regime: query {c.gravity_regime}, test {t.gravity.regime}.", hard=not ok))
        if ok and c.gravity_regime in ("microgravity", "partial"):
            if t.gravity.actual is False:
                out.append(Check("R-GRAV-02", "gravity_actual", "fail", "The test's low gravity is simulated/analogue, not actual."))
            elif t.gravity.actual is None:
                out.append(Check("R-GRAV-02", "gravity_actual", "unknown", "Whether the test gravity is actual or simulated is not recorded."))
            else:
                out.append(Check("R-GRAV-02", "gravity_actual", "pass", "The test gravity is actual."))
    # ---- flow history (semantic)
    red = has_flow_reduction(t)
    if ep == "extinction_under_flow_reduction":
        if red is True:
            out.append(Check("R-FLOW-02", "flow_history", "pass", "The run included a flow reduction."))
        elif red is False:
            out.append(Check("R-FLOW-02", "flow_history", "fail", "The run held flow constant; it contains no flow reduction.", hard=True))
        else:
            out.append(Check("R-FLOW-02", "flow_history", "unknown", "Whether the flow was reduced during the run is not recorded."))
    if c.flow_history is not None:
        k = t.flow.history_kind
        if k in ("unknown", "other", "reduction"):
            out.append(Check("R-FLOW-04", "flow_history", "unknown", f"The test's flow history ({k}) is not specific enough to compare with '{c.flow_history}'."))
        else:
            out.append(Check("R-FLOW-04", "flow_history", "pass" if k == c.flow_history else "fail",
                             f"Flow history: query {c.flow_history}, test {k}. Equal initial flow does not make histories equal."))
    # ---- flow direction
    if c.flow_direction is None:
        out.append(_q_unspecified("R-FLOW-01", "flow_direction", "a flow direction"))
    elif not t.flow.direction.is_known():
        out.append(Check("R-FLOW-01", "flow_direction", "unknown", "Flow direction is unknown in the test record."))
    else:
        ok = str(t.flow.direction.value) == c.flow_direction
        hard = (ep in ("sustained_spread", "extinction_under_flow_reduction")) and not ok
        out.append(Check("R-FLOW-01", "flow_direction", "pass" if ok else "fail",
                         f"Flow direction: query {c.flow_direction}, test {t.flow.direction.value}.", hard=hard, assumed=not t.flow.direction.is_measured()))
    # ---- substrate
    if c.substrate is None:
        out.append(_q_unspecified("R-SUB-01", "substrate", "a substrate/confinement"))
    elif not t.substrate_confinement:
        out.append(Check("R-SUB-01", "substrate", "unknown", "Substrate/confinement is unknown in the test record."))
    else:
        ok = _norm(c.substrate) == _norm(t.substrate_confinement)
        out.append(Check("R-SUB-01", "substrate", "pass" if ok else "fail", f"Substrate: query {c.substrate}, test {t.substrate_confinement}."))
    # ---- ignition method
    if c.ignition is not None:
        desc = " ".join(s.description.lower() for s in t.protocol if s.kind == "ignition")
        if not desc:
            out.append(Check("R-IGN-01", "ignition", "unknown", "No ignition step in the test record."))
        else:
            toks = [w for w in _norm(c.ignition).split() if len(w) > 2]
            ok = bool(toks) and all(w in desc for w in toks)
            out.append(Check("R-IGN-01", "ignition", "pass" if ok else "unknown" if "not recorded" in desc else "fail",
                             f"Ignition: query '{c.ignition}', test step '{desc}'."))
    # ---- numeric closeness (only after the semantic checks above)
    dim_sv, dim_name = _dimension_sv(c.shape, t)
    qdim_name = "diameter" if canon_shape(c.shape) in ("rod", "droplet") else "thickness"
    if c.thickness_mm is not None and dim_name != qdim_name:
        out.append(Check("R-GEOM-02", "thickness", "unknown", f"Query gives a {qdim_name}; the test records a {dim_name}: not comparable."))
    else:
        out.append(_compare_values("R-GEOM-02", "thickness", c.thickness_mm, dim_sv, f"Characteristic {dim_name}", rel=TOLERANCES["dimension_rel"], unit=" mm"))
    out.append(_compare_values("R-FLOW-03", "flow_velocity", c.flow_velocity_cm_s, t.flow.initial_velocity_cm_s, "Initial flow velocity",
                               rel=TOLERANCES["flow_velocity_rel"], unit=" cm/s"))
    out.append(_compare_values("R-GAS-02", "o2_fraction", c.o2_fraction, t.atmosphere.o2_fraction, "O2 fraction", absol=TOLERANCES["o2_fraction_abs"]))
    trole = t.atmosphere.o2_fraction.role
    if c.o2_role is not None and trole:
        ok = c.o2_role == trole
        out.append(Check("R-GAS-01", "o2_fraction", "pass" if ok else "fail", f"O2 role: query {c.o2_role}, test {trole}; ambient and oxidizer-stream fractions differ in meaning."))
    elif c.o2_role is None and c.o2_fraction is not None and trole:
        out.append(Check("R-GAS-01", "o2_fraction", "unknown", f"The query does not say whether its O2 fraction is ambient or an oxidizer stream; the test's is {trole}."))
    elif c.o2_role is not None and not trole:
        out.append(Check("R-GAS-01", "o2_fraction", "unknown", "The O2 role (ambient/oxidizer stream) is not recorded for the test."))
    out.append(_compare_values("R-PRS-01", "pressure_kpa", c.pressure_kpa, t.atmosphere.pressure_kpa, "Pressure", rel=TOLERANCES["pressure_rel"], unit=" kPa"))
    return out


def user_specified_fields(q: ResearchQuery) -> set[str]:
    c = q.config
    m = {"thickness": c.thickness_mm, "o2_fraction": c.o2_fraction, "pressure_kpa": c.pressure_kpa, "flow_direction": c.flow_direction,
         "flow_velocity": c.flow_velocity_cm_s, "ignition": c.ignition, "substrate": c.substrate, "flow_history": c.flow_history}
    return {k for k, v in m.items() if v is not None}


def importance(q: ResearchQuery, field: str) -> str:
    req = ENDPOINT_REQUIREMENTS.get(q.endpoint or "")
    if field == "endpoint":
        return "required"
    if req and field in req.required:
        return "required"
    if req and field in req.important:
        return "important"
    if field in user_specified_fields(q):
        return "important"
    if req is None and field in ("material", "shape", "gravity_regime"):
        return "required"
    return "optional"


def evaluate_test(q: ResearchQuery, t: Test) -> ApplicabilityDecision:
    checks = _checks(q, t)
    grounds: list[Ground] = []
    hard = soft = False
    req_unknown: list[str] = []
    imp_unknown: list[str] = []
    for ch in checks:
        imp = importance(q, ch.field)
        if ch.effect == "unknown" and imp == "optional":
            continue  # irrelevant for this endpoint and not requested: do not clutter
        grounds.append(Ground(rule_id=ch.rule_id, field=ch.field, effect=ch.effect, text=ch.text))  # type: ignore[arg-type]
        if ch.effect == "fail":
            if ch.hard:
                hard = True
            else:
                soft = True
        elif ch.effect == "unknown":
            (req_unknown if imp == "required" else imp_unknown).append(ch.field)
        elif ch.assumed:
            imp_unknown.append(ch.field)  # passes on an assumed value only: cannot be direct
    unknown_fields = sorted(set(req_unknown) | set(imp_unknown))
    if hard:
        status = "incompatible"
    elif req_unknown:
        status = "insufficient_data"
    elif soft or imp_unknown:
        status = "limited_context"
    else:
        status = "direct"
    return ApplicabilityDecision(test_id=t.id, status=status, grounds=grounds, unknown_fields=unknown_fields, rule_version=RULES_VERSION)  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- evidence quality
def evidence_quality(t: Test, coverage: str, has_url: bool) -> dict[str, Any]:
    fields = [t.geometry.thickness_mm, t.geometry.diameter_mm, t.flow.direction, t.flow.initial_velocity_cm_s,
              t.atmosphere.o2_fraction, t.atmosphere.pressure_kpa]
    known = sum(1 for f in fields if f.is_known())
    measured = sum(1 for f in fields if f.is_measured())
    factors = [f"verification: {t.verification}", f"record type: {t.record_type}", f"coverage: {coverage}",
               f"{measured} of {len(fields)} key conditions reported ({known} known incl. assumed)"]
    if t.verification == "verified" and measured >= 4 and has_url:
        level = "moderate"
    elif t.record_type == "exemplar" or not has_url or t.observation_status == "planned":
        level = "very_low"
    else:
        level = "low"
    return {"level": level, "factors": factors, "verification": t.verification, "record_type": t.record_type}


# ----------------------------------------------------------------------------- contrasts
_CONTRAST_FIELDS = ["material", "shape", "dimension", "substrate", "gravity_regime", "gravity_actual", "flow_direction",
                    "flow_initial_velocity", "flow_history", "o2_fraction", "o2_role", "pressure_kpa"]
_RELEVANT = {"dimension": "thickness", "gravity_actual": "gravity_actual", "flow_initial_velocity": "flow_velocity",
             "flow_history": "flow_history", "o2_role": "o2_fraction"}


def _cval(t: Test, f: str) -> Any:
    def sv(x: ScientificValue):
        return x.value if x.is_known() else None
    if f == "material":
        return canon_material(t.material)[0] or (_norm(t.material) or None)
    if f == "shape":
        return canon_shape(t.geometry.shape)
    if f == "dimension":
        s, name = _dimension_sv(None, t)
        v = sv(s)
        return None if v is None else f"{name}={v}"
    if f == "substrate":
        return _norm(t.substrate_confinement) or None
    if f == "gravity_regime":
        return None if t.gravity.regime == "unknown" else t.gravity.regime
    if f == "gravity_actual":
        return t.gravity.actual
    if f == "flow_direction":
        return sv(t.flow.direction)
    if f == "flow_initial_velocity":
        return sv(t.flow.initial_velocity_cm_s)
    if f == "flow_history":
        return None if t.flow.history_kind == "unknown" else t.flow.history_kind
    if f == "o2_fraction":
        return sv(t.atmosphere.o2_fraction)
    if f == "o2_role":
        return t.atmosphere.o2_fraction.role
    if f == "pressure_kpa":
        return sv(t.atmosphere.pressure_kpa)
    raise KeyError(f)


def compare_tests(a: Test, b: Test, endpoint: str | None) -> Contrast:
    changed, shared, unknown = [], [], []
    for f in _CONTRAST_FIELDS:
        va, vb = _cval(a, f), _cval(b, f)
        if va is None or vb is None:
            unknown.append(f)  # one or both unknown: never a match
        elif va == vb:
            shared.append(f)
        else:
            changed.append(f)
    req = ENDPOINT_REQUIREMENTS.get(endpoint or "")
    relevant = set(req.required) | set(req.important) if req else set()
    blocking_unknown = [f for f in unknown if _RELEVANT.get(f, f) in relevant or f in relevant]
    rules = ["R-CON-01", "R-CON-04"]
    sa, _ = endpoint_support(a, endpoint)
    sb, _ = endpoint_support(b, endpoint)
    ok_support = {"observed", "partial"}
    reasons: list[str] = []
    allowed = True
    if len(changed) != 1:
        allowed = False
        reasons.append("no single changed factor" if not changed else f"{len(changed)} factors differ ({', '.join(changed)})")
    if blocking_unknown:
        allowed = False
        rules.append("R-CON-02")
        reasons.append(f"unknown on at least one side: {', '.join(blocking_unknown)}")
    if not (sa in ok_support and sb in ok_support):
        allowed = False
        rules.append("R-CON-05")
        reasons.append(f"outcome not comparable (endpoint support: {a.id} {sa}, {b.id} {sb})")
        if "operator_termination" in observed_kinds(a) | observed_kinds(b):
            reasons.append("an operator-terminated run is not an extinction")
    same_initial = "flow_initial_velocity" in shared and "flow_history" in changed
    if same_initial:
        rules.append("R-CON-03")
    factor_txt = ", ".join(changed) if changed else "no recorded factor"
    if allowed:
        statement = (f"{a.id} and {b.id} differ in one recorded factor: {changed[0].replace('_', ' ')}. "
                     + ("The initial flow is equal but the flow history differs, so the flow conditions are not the same. " if same_initial else "")
                     + "If their endpoint outcomes differ, that is an association within these two records; it does not show that the factor caused the difference. Replicates would be needed.")
        question = f"Is a change in {changed[0].replace('_', ' ')} associated with a different {(endpoint or 'endpoint').replace('_', ' ')} outcome?"
    else:
        statement = (f"{a.id} and {b.id} are not a controlled comparison: {'; '.join(reasons)}. "
                     + ("The initial flow is equal but the flow history differs. " if same_initial else "")
                     + "No conclusion about the effect of any factor can be drawn from this pair.")
        question = f"Would a controlled comparison of {factor_txt.replace('_', ' ')} be possible with these records?"
    cid = "ctr_" + sha1(f"{a.id}|{b.id}|{endpoint}".encode()).hexdigest()[:10]
    return Contrast(id=cid, test_a=a.id, test_b=b.id, question=question, allowed=allowed, changed_factors=changed,
                    shared=shared, unknown=unknown, statement=statement, rule_ids=sorted(set(rules)))
