"""Heuristic query parsing: text and/or structured config -> ResearchQuery plus missing/confirm lists.
Nothing is guessed silently: inferred fields are listed in `confirm`; unspecified fields stay null."""
from __future__ import annotations

import re

from .engine import ENDPOINT_REQUIREMENTS, _MATERIALS, _SHAPES
from .models import QueryConfig, ResearchQuery

_DISPLAY = {"pmma": "PMMA", "cotton_fiberglass": "cotton-fiberglass", "n_heptane": "n-heptane", "methanol": "methanol", "ethanol": "ethanol",
            "wood": "wood", "paper": "paper", "nomex": "Nomex", "kapton": "Kapton", "teflon": "Teflon", "polyethylene": "polyethylene", "n_decane": "n-decane",
            "cotton": "cotton"}
_ENV = [("lunar_base", r"\b(lunar|moon)\b"), ("mars_transit", r"\bmars\b"), ("gateway", r"\bgateway\b"), ("rover", r"\brover\b"), ("iss", r"\b(iss|space station)\b")]
_ENV_GRAV = {"iss": "microgravity", "gateway": "microgravity", "mars_transit": "microgravity", "lunar_base": "partial", "rover": "partial", "other": None}
_EP = [("cool_burning", r"cool[- ]flame|cool burning"), ("smoke_detection", r"smoke|aerosol|detector|detection"),
       ("extinction_under_flow_reduction", r"extinct|extinguish|flow reduc|reduc\w* (the )?flow|goes? out|flame out"),
       ("suppression", r"suppress|agent|diluent"), ("flame_establishment", r"establish"), ("sustained_spread", r"spread"), ("ignition", r"ignit")]
_TOPIC = {"smoke_detection": "detection", "cool_burning": "detection", "suppression": "suppression", "extinction_under_flow_reduction": "suppression"}
_MAT_ORDER = sorted(_MATERIALS, key=len, reverse=True)
_SHAPE_ORDER = sorted(_SHAPES, key=len, reverse=True)


def _first_num(pattern: str, text: str, flags=re.I):
    m = re.search(pattern, text, flags)
    return m


def parse_query(text: str | None, config: ResearchQuery | None) -> dict:
    t = (text or "").lower().replace("_", " ")
    confirm: list[str] = []
    cfg: dict = {}
    top: dict = {"question": text or ""}
    # material / shape
    for k in _MAT_ORDER:
        if k in t.replace("-", " "):
            cfg["material"] = _DISPLAY[_MATERIALS[k][0]]
            break
    for k in _SHAPE_ORDER:
        if re.search(rf"\b{k}\b", t):
            cfg["shape"] = _SHAPES[k] if k != "smoke" else None
            if cfg["shape"] is None:
                del cfg["shape"]
            break
    # numbers
    m = re.search(r"(\d+(?:\.\d+)?)\s*%\s*(?:o2|oxygen)", t) or re.search(r"(?:o2|oxygen)[^\d%]{0,15}(\d+(?:\.\d+)?)\s*%", t)
    if m and 0 <= float(m.group(1)) <= 100:
        cfg["o2_fraction"] = float(m.group(1)) / 100
        confirm.append("o2_role")
    m = re.search(r"(\d+(?:\.\d+)?)\s*(kpa|atm|psi|bar)\b", t)
    if m:
        cfg["pressure_kpa"] = float(m.group(1)) * {"kpa": 1, "atm": 101.325, "psi": 6.894757, "bar": 100}[m.group(2)]
    m = re.search(r"(\d+(?:\.\d+)?)\s*(cm/s|mm/s|m/s)\b", t)
    if m:
        cfg["flow_velocity_cm_s"] = float(m.group(1)) * {"cm/s": 1, "mm/s": 0.1, "m/s": 100}[m.group(2)]
    mm = re.findall(r"(\d+(?:\.\d+)?)\s*mm\b(?!/)", t)
    if mm:
        near = re.search(r"(\d+(?:\.\d+)?)\s*mm\s*(?:thick|diam|dia)|(?:thick\w*|diam\w*)\D{0,12}(\d+(?:\.\d+)?)\s*mm", t)
        v = float(next(g for g in near.groups() if g)) if near else float(mm[0])
        if v > 0:
            cfg["thickness_mm"] = v
            if not near:
                confirm.append("thickness_mm")
    for k in ("opposed", "concurrent", "quiescent"):
        if re.search(rf"\b{k}\b", t):
            cfg["flow_direction"] = k
    if re.search(r"\bstep(wise)?\b", t):
        cfg["flow_history"] = "stepwise_reduction"
    elif re.search(r"\bramp", t):
        cfg["flow_history"] = "continuous_ramp"
    elif re.search(r"constant flow|steady flow", t):
        cfg["flow_history"] = "constant"
    if re.search(r"\bambient\b", t):
        cfg["o2_role"] = "ambient"
    elif re.search(r"oxidi[sz]er (stream|flow)", t):
        cfg["o2_role"] = "oxidizer_stream"
    if re.search(r"\bbacked\b|insulating substrate", t):
        cfg["substrate"] = "backed_insulating"
    # gravity
    if re.search(r"micro-?gravity|zero[- ]g|weightless|\bmicro-g\b", t):
        cfg["gravity_regime"] = "microgravity"
    elif re.search(r"normal gravity|\b1 ?g\b|earth gravity|terrestrial", t):
        cfg["gravity_regime"] = "normal"
    elif re.search(r"lunar gravity|partial gravity|moon gravity|martian gravity", t):
        cfg["gravity_regime"] = "partial"
    # environment, endpoint, topic
    for env, pat in _ENV:
        if re.search(pat, t):
            top["environment"] = env
            break
    for ep, pat in _EP:
        if re.search(pat, t):
            top["endpoint"] = ep
            break
    if top.get("endpoint"):
        top["topic"] = _TOPIC.get(top["endpoint"], "prevention")
    # structured config overrides text
    if config is not None:
        base = config.model_dump()
        for k, v in base["config"].items():
            if v is not None:
                cfg[k] = v
        for k in ("endpoint", "topic"):
            if base[k] is not None:
                top[k] = base[k]
        if config.question:
            top["question"] = config.question
        if "environment" in config.model_fields_set:
            top["environment"] = config.environment
    env = top.get("environment", "iss")
    top["environment"] = env
    if "gravity_regime" not in cfg and _ENV_GRAV.get(env):
        cfg["gravity_regime"] = _ENV_GRAV[env]
        confirm.append("gravity_regime")
    if "o2_role" in confirm and cfg.get("o2_role"):
        confirm.remove("o2_role")
    query = ResearchQuery.model_validate({**top, "config": cfg})
    req = ENDPOINT_REQUIREMENTS.get(query.endpoint or "")
    need = ["material", "shape", "gravity_regime"] if req is None else [f for f in req.required if f in ("material", "shape", "gravity_regime")]
    missing = [f for f in need if getattr(query.config, f) is None]
    if query.endpoint is None:
        missing.insert(0, "endpoint")
    return {"query": query, "missing": missing, "confirm": sorted(set(confirm))}
