#!/usr/bin/env python3
"""
EMBER v2 Corpus Builder (idempotent pipeline).

Reads legacy seed records, cached NTRS/PSI primary texts, and raw PSI/NTRS tables
to generate:
  - public/data/corpus_v2.json
  - public/data/chunks_index.json
  - data/ember_corpus.sqlite
  - public/data/manifest_v2.json
"""

from __future__ import annotations

import csv
import datetime as dt
import glob
import hashlib
import json
import math
import os
import re
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any

import numpy as np
from sklearn.decomposition import TruncatedSVD
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.preprocessing import normalize

CORPUS_VERSION = "2.0.2-bass-provenance"
EMBEDDING_MODEL = "tfidf-lsa-svd-64d-v1"
EMBEDDING_DIM = 64

ROOT = Path(__file__).resolve().parent.parent
DATA_DIR = ROOT / "data"
SEED_DIR = DATA_DIR / "legacy_seed"
RAW_DIR = DATA_DIR / "raw"
PUBLIC_DATA_DIR = ROOT / "public" / "data"

OUT_CORPUS = PUBLIC_DATA_DIR / "corpus_v2.json"
OUT_CHUNKS = PUBLIC_DATA_DIR / "chunks_index.json"
OUT_SQLITE = DATA_DIR / "ember_corpus.sqlite"
OUT_MANIFEST = PUBLIC_DATA_DIR / "manifest_v2.json"


# ---------------------------------------------------------------------------
# Generic file, hash, and ScientificValue utilities


def sha256_file(path: Path) -> str:
    """Compute hex SHA-256 digest for a file."""
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def sha256_text(text: str) -> str:
    """Compute hex SHA-256 digest for UTF-8 text."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def load_json(path: Path) -> Any:
    """Load JSON from disk."""
    with path.open("r", encoding="utf-8") as f:
        return json.load(f)


def write_json_atomic(path: Path, data: Any, indent: int | None = None) -> None:
    """Write JSON atomically via a temporary file."""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=indent)
    os.replace(tmp, path)


def normalize_ws(text: str | None) -> str:
    """Normalize whitespace and smart quotes for verbatim substring checks."""
    if not text:
        return ""
    s = (
        text.replace("\u2019", "'")
        .replace("\u2018", "'")
        .replace("\u201c", '"')
        .replace("\u201d", '"')
        .replace("\u2013", "-")
        .replace("\u2014", "-")
    )
    return " ".join(s.lower().split())


def make_sv(
    value: float | int | str | None,
    unit: str,
    provenance: str = "reported",
    original_value: str | int | float | None = None,
    original_unit: str | None = None,
    role: str | None = None,
    source_ref: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Construct a typed ScientificValue dictionary."""
    prov = "unknown" if (value is None and provenance == "reported") else provenance
    sv: dict[str, Any] = {
        "value": value,
        "unit": unit,
        "provenance": prov,
    }
    if original_value is not None:
        sv["originalValue"] = original_value
    if original_unit is not None:
        sv["originalUnit"] = original_unit
    if role is not None:
        sv["role"] = role
    if source_ref is not None:
        sv["sourceRef"] = source_ref
    return sv


def make_source_ref(
    source_id: str,
    source_map: dict[str, dict[str, Any]],
    file_hash: str | None = None,
    locator: dict[str, Any] | None = None,
    quote: str | None = None,
    context: str | None = None,
) -> dict[str, Any]:
    """Construct a typed SourceRef dictionary from registry metadata."""
    meta = source_map.get(source_id, {})
    return {
        "sourceId": source_id,
        "url": meta.get("url"),
        "doi": meta.get("doi"),
        "fileHash": file_hash or meta.get("fileHash"),
        "corpusVersion": CORPUS_VERSION,
        "locator": locator or {},
        "quote": quote,
        "context": context,
    }


def parse_float_safe(raw: Any) -> float | None:
    """Extract first numeric float from a value or return None."""
    if raw is None or isinstance(raw, bool):
        return None
    if isinstance(raw, (int, float)):
        return float(raw) if math.isfinite(float(raw)) else None
    m = re.search(r"[-+]?\d*\.?\d+", str(raw))
    return float(m.group(0)) if m else None


# ---------------------------------------------------------------------------
# Raw file indexing & Source registry


def index_raw_files() -> tuple[dict[str, dict[str, Any]], dict[str, str]]:
    """Hash all files under data/ and build lookup maps by relpath and basename."""
    raw_info: dict[str, dict[str, Any]] = {}
    by_basename: dict[str, str] = {}
    for p in sorted(DATA_DIR.rglob("*")):
        if not p.is_file() or p.suffix == ".sqlite" or p.name.endswith(".tmp"):
            continue
        rel = p.relative_to(ROOT).as_posix()
        digest = sha256_file(p)
        raw_info[rel] = {"sha256": digest, "bytes": p.stat().st_size}
        by_basename.setdefault(p.name, digest)
    return raw_info, by_basename


def _psi_dir_for_source(source_id: str) -> Path | None:
    if not source_id.startswith("psi-"):
        return None
    num = source_id.split("-", 1)[1]
    cand = RAW_DIR / f"PSI-{num}"
    return cand if cand.exists() else None


def build_sources_registry(
    sources_cache: list[dict[str, Any]],
    invs_seed: list[dict[str, Any]],
    raw_info: dict[str, dict[str, Any]],
    by_basename: dict[str, str],
) -> tuple[list[dict[str, Any]], dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Build enriched SourceRecord list, lookup map, and cached text lookup."""
    cache_by_id = {s["sourceId"]: s for s in sources_cache}
    doi_by_psi = {
        str(inv.get("psi", "")).lower(): inv.get("doi")
        for inv in invs_seed
        if inv.get("psi") and inv.get("doi")
    }
    ntrs_titles: dict[str, str] = {}
    for nf in glob.glob(str(RAW_DIR / "ntrs" / "*.json")):
        if "appendixA" in nf:
            continue
        obj = load_json(Path(nf))
        if obj.get("id") and obj.get("title"):
            ntrs_titles[f"ntrs-{obj['id']}"] = str(obj["title"])

    records: list[dict[str, Any]] = []
    source_map: dict[str, dict[str, Any]] = {}
    for s in sources_cache:
        sid = s["sourceId"]
        text = s.get("text") or ""
        title = s.get("label") or ntrs_titles.get(sid)
        if not title and text:
            title = text.splitlines()[0].strip()[:180]
        doi = s.get("doi") or doi_by_psi.get(sid)
        fhash: str | None = None
        if sid.startswith("ntrs-"):
            nid = sid.split("-", 1)[1]
            fhash = by_basename.get(f"{nid}.json") or by_basename.get(f"TM-{nid}.txt")
        else:
            pdir = _psi_dir_for_source(sid)
            if pdir:
                inv_json = pdir / "investigation.json"
                if inv_json.exists():
                    rel = inv_json.relative_to(ROOT).as_posix()
                    fhash = raw_info.get(rel, {}).get("sha256")
        if not fhash:
            fhash = sha256_text(text) if text else by_basename.get("sources_cache.json")

        rec = {
            "sourceId": sid,
            "title": title,
            "url": s.get("url"),
            "doi": doi,
            "type": s.get("type"),
            "fileHash": fhash,
            "notes": f"inv={s.get('inv')}; year={s.get('year')}" if s.get("inv") else None,
        }
        records.append(rec)
        source_map[sid] = rec

    # Include external curated URLs from legacy investigations/missions if not in sources_cache
    for sid, meta in [("ntrs-tm-20210011385", "TM-20210011385.txt")]:
        if sid not in source_map and meta in by_basename:
            rec = {
                "sourceId": sid,
                "title": "NASA/TM-20210011385: BASS-II Summary Technical Memorandum",
                "url": "https://ntrs.nasa.gov/citations/20210011385",
                "doi": None,
                "type": "nasa_tm",
                "fileHash": by_basename[meta],
                "notes": "Full technical memorandum text",
            }
            records.append(rec)
            source_map[sid] = rec

    return records, source_map, cache_by_id


# ---------------------------------------------------------------------------
# Test domain reconstruction helpers


def _strip_pot_annotations(air_str: str) -> list[float]:
    """Parse cm/s air-flow sequence from BASS / BASS-II Air display strings."""
    if not air_str or air_str.strip() in ("None", "see fan", "left vm and resent message", "no ign at any flow"):
        return []
    s = air_str.strip()
    # Case like '49  44  42  41  41  40.5 (5   2   0)' -> prefer parenthesized cm/s
    m_paren = re.search(r"\(([^)]+)\)", s)
    if m_paren:
        inner = m_paren.group(1)
        if "pot" not in inner.lower() and not re.search(r"\.\d{2}", inner):
            vals = _extract_clean_numbers(inner)
            outer_vals = _extract_clean_numbers(re.sub(r"\([^)]*\)", " ", s))
            if vals and outer_vals and max(outer_vals) >= 38:
                return vals
    # Remove '(pot ...)' and everything after 'pot'
    s = re.sub(r"\([^)]*pot[^)]*\)", " ", s, flags=re.IGNORECASE)
    s = re.sub(r"\([^)]*\)", " ", s)
    s = re.sub(r"\bpot\b.*$", " ", s, flags=re.IGNORECASE)
    s = s.replace("<1", "0.5").replace("~", "").replace("?", "")
    return _extract_clean_numbers(s)


def _extract_clean_numbers(fragment: str) -> list[float]:
    """Extract airflow step numbers, interpreting range expressions like '3-4' cleanly."""
    cleaned = re.sub(r"(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)", r"\1 \2", fragment)
    out: list[float] = []
    for tok in re.findall(r"\d+(?:\.\d+)?", cleaned):
        val = float(tok)
        if val <= 80.0:
            out.append(val)
    return out


def _classify_flow_history(
    seq: list[float],
    air_raw: str,
    obs: str,
    terminal_event: str | None,
) -> str:
    """Classify FlowHistory literal from sequence and test notes."""
    low = (air_raw + " " + obs).lower()
    if "etc" in air_raw.lower() or "alternat" in low:
        return "pulsed"
    if len(seq) >= 4:
        diffs = [seq[i + 1] - seq[i] for i in range(len(seq) - 1) if seq[i + 1] != seq[i]]
        signs = {1 if d > 0 else -1 for d in diffs}
        if len(signs) == 2 and len(diffs) >= 3:
            return "pulsed"
    if terminal_event == "flow_turned_off" and len(seq) <= 1:
        return "abrupt_cutoff"
    if len(seq) >= 2:
        if seq[-1] < seq[0] or "decr" in low or "down" in low:
            return "stepped_down"
        if seq[-1] > seq[0] or "incr" in low or "blowoff" in low:
            return "stepped_up"
    if "decr" in low or "reduced flow" in low or "turned down" in low or "slow decr" in low:
        return "stepped_down"
    if "incr" in low or "turned flow up" in low:
        return "stepped_up"
    if terminal_event == "flow_turned_off" and ("abruptly" in low or "turned flow off" in low or "air off" in low):
        return "abrupt_cutoff"
    return "steady" if seq or "constant" in low else "unknown"


def _extract_bass_ii_direction(
    tid_short: str,
    geom: str | None,
    app_row: dict[str, Any] | None,
    obs: str,
) -> str:
    """Resolve BASS-II FlowDirection from Appendix A tokens, geometry, and TM sections."""
    if app_row:
        toks = {t.lower() for t in app_row.get("firstLineTokens", [])}
        if "opposed" in toks:
            return "opposed"
        if "concurrent" in toks:
            return "concurrent"
        if "stagnation" in toks:
            return "axial_stagnation"
    prefix = tid_short[0] if tid_short else ""
    if prefix in ("B", "M"):
        return "opposed"
    if prefix == "T":
        return "axial_stagnation" if geom == "spherical section" else "concurrent"
    if prefix == "O":
        return "axial_stagnation"
    if prefix == "P":
        return "opposed"
    if "concurrent" in obs.lower():
        return "concurrent"
    if "opposed" in obs.lower():
        return "opposed"
    return "unknown"


def _extract_bass_direction(geom: str | None, mat_raw: str, obs: str) -> str:
    """Resolve PSI-26 BASS FlowDirection strictly from explicit text markers."""
    combined = f"{mat_raw} {obs}".lower()
    if "opposed" in combined or "oppsed" in combined or "upstream" in combined or "wake" in combined:
        return "opposed"
    if "concurrent" in combined:
        return "concurrent"
    if "stagnation" in combined:
        return "axial_stagnation"
    return "unknown"


def extract_flow_spec(
    row: dict[str, Any],
    src_ref: dict[str, Any],
    app_row: dict[str, Any] | None,
) -> dict[str, Any]:
    """Build structured FlowSpec for any test row."""
    inv = row["inv"]
    extra = row.get("extra") or {}
    val = row.get("flowCmS")
    obs = str(extra.get("tmObservations") or extra.get("observations") or row.get("outcomeRaw") or "")
    air_raw = str(extra.get("Air display") or extra.get("airDisplayCmS") or "")

    seq: list[float] = []
    if inv in ("BASS-II", "BASS"):
        seq = _strip_pot_annotations(air_raw)
        if not seq and val is not None:
            seq = [float(val)]
        elif seq and val is None:
            val = seq[0]
        direction = (
            _extract_bass_ii_direction(row["testId"].replace("BASS-II-", ""), row.get("geometry"), app_row, obs)
            if inv == "BASS-II"
            else _extract_bass_direction(row.get("geometry"), str(extra.get("materialRaw") or ""), obs)
        )
        history = _classify_flow_history(seq, air_raw, obs, extra.get("terminalEvent"))
    elif inv in ("Saffire-I", "Saffire-II", "Saffire-III"):
        d_raw = str(extra.get("Flow Direction") or extra.get("Direction") or "").lower()
        direction = "concurrent" if "concurrent" in d_raw else ("opposed" if "opposed" in d_raw else "unknown")
        history = "steady"
        if val is not None:
            seq = [float(val)]
    elif inv in ("FLEX", "CFI", "ACME-BRE", "ACME-CFI-G"):
        direction = "quiescent"
        history = "steady"
        if val is None and inv in ("FLEX", "CFI"):
            val = 0.0
    elif inv in ("SAME", "SAME-R"):
        direction = "quiescent" if (val == 0 or val == 0.0) else ("coflow" if val is not None else "unknown")
        history = "steady" if val is not None else "unknown"
    elif inv in ("SPICE", "SLICE", "ACME-E-FIELD"):
        direction = "coflow"
        history = "steady" if val is not None else "unknown"
    else:
        direction = "unknown"
        history = "unknown"

    prov = "reported" if val is not None else "unknown"
    if inv in ("FLEX", "CFI") and row.get("flowCmS") is None:
        prov = "series_level"
    spec: dict[str, Any] = {
        "initialFlowCmS": make_sv(val, "cm/s", provenance=prov, original_value=air_raw or None, source_ref=src_ref),
        "direction": direction,
        "history": history,
    }
    if seq:
        spec["sequenceCmS"] = seq
    return spec


def _parse_width_cm(row: dict[str, Any], src_ref: dict[str, Any]) -> dict[str, Any]:
    inv = row["inv"]
    extra = row.get("extra") or {}
    if inv == "BASS-II":
        w = extra.get("sampleWidthCm")
        if w is not None:
            return make_sv(float(w), "cm", "reported", original_value=extra.get("materialRaw"), source_ref=src_ref)
        tm5 = extra.get("tmTable5_1") or {}
        if tm5.get("widthCm") is not None:
            return make_sv(float(tm5["widthCm"]), "cm", "reported", source_ref=src_ref)
        m = re.search(r"(\d+(?:\.\d+)?)\s*cm\b", str(extra.get("materialRaw") or ""))
        if m and row.get("geometry") in ("thin film", "slab", "fabric sheet"):
            return make_sv(float(m.group(1)), "cm", "derived", original_value=extra.get("materialRaw"), source_ref=src_ref)
    elif inv == "BASS":
        mat_raw = str(extra.get("materialRaw") or "")
        if row.get("geometry") in ("fabric sheet", "slab", "sheet"):
            m = re.search(r"(\d+(?:\.\d+)?)\s*cm\b", mat_raw)
            if m:
                return make_sv(float(m.group(1)), "cm", "derived", original_value=mat_raw, source_ref=src_ref)
    elif inv == "Saffire-I":
        # PSI-98 CSV swapped Sample Length (40.6) and Sample Width (94); verified by c-0032 & Saffire-III
        return make_sv(
            40.6,
            "cm",
            "derived",
            original_value=extra.get("Sample Length (cm)"),
            original_unit="cm (PSI-98 table header swapped Length/Width)",
            source_ref=src_ref,
        )
    elif inv in ("Saffire-II", "Saffire-III"):
        raw = extra.get("Sample Width (cm)") or extra.get("Sample Width")
        v = parse_float_safe(raw)
        if v is not None:
            return make_sv(v, "cm", "reported", original_value=raw, original_unit="cm", source_ref=src_ref)
    return make_sv(None, "cm", "unknown", source_ref=src_ref)


def _infer_geometry_and_dims(
    row: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[str | None, dict[str, Any], dict[str, Any], dict[str, Any]]:
    """Repair missing sphere geometry on BASS and wrap thickness/diameter/width as ScientificValue."""
    extra = row.get("extra") or {}
    inv = row["inv"]
    geom = row.get("geometry")
    if geom in (None, "None", ""):
        mat_raw = str(extra.get("materialRaw") or "").lower()
        obs = str(extra.get("observations") or "").lower()
        if inv == "BASS" and ("sphere" in obs or "pmma" in mat_raw) and ("1 cm" in mat_raw or "2 cm" in mat_raw):
            geom = "sphere"
        else:
            geom = None

    thick_val = row.get("thicknessMm")
    thick_orig = extra.get("materialRaw") if "micron" in str(extra.get("materialRaw") or "").lower() else (
        extra.get("Samle Thickness") or extra.get("Sample Thickness (cm)") or extra.get("Sample Thickness")
    )
    thick_unit_orig = "micron" if "micron" in str(thick_orig or "").lower() else None
    thickness = make_sv(
        float(thick_val) if thick_val is not None else None,
        "mm",
        "reported" if thick_val is not None else "unknown",
        original_value=thick_orig,
        original_unit=thick_unit_orig,
        source_ref=src_ref,
    )

    diam_val = row.get("diameterMm")
    diam_prov = "reported" if diam_val is not None else "unknown"
    diam_orig = None
    diam_orig_unit = None
    if diam_val is None and inv == "BASS" and geom == "sphere":
        mat_raw = str(extra.get("materialRaw") or "").lower()
        if "1 cm" in mat_raw:
            diam_val = 10.0
            diam_prov = "derived"
            diam_orig = "1 cm"
            diam_orig_unit = "cm"
        elif "2 cm" in mat_raw:
            diam_val = 20.0
            diam_prov = "derived"
            diam_orig = "2 cm"
            diam_orig_unit = "cm"
    elif diam_val is None and geom == "spherical section":
        mat_raw = str(extra.get("materialRaw") or "").lower()
        if "4 cm" in mat_raw:
            diam_val = 40.0
            diam_prov = "derived"
            diam_orig = "4 cm"
            diam_orig_unit = "cm"

    diameter = make_sv(
        float(diam_val) if diam_val is not None else None,
        "mm",
        diam_prov,
        original_value=diam_orig,
        original_unit=diam_orig_unit,
        source_ref=src_ref,
    )
    width = _parse_width_cm(row, src_ref)
    return geom, thickness, diameter, width


def extract_confinement_and_orientation(row: dict[str, Any], geom: str | None) -> tuple[str | None, str | None]:
    """Determine substrateConfinement and orientation literals."""
    inv = row["inv"]
    extra = row.get("extra") or {}
    confinement: str | None = None
    orientation: str | None = None

    if inv == "BASS-II":
        orientation = "horizontal_msg_duct"
        tm5 = extra.get("tmTable5_1") or {}
        mraw = str(extra.get("materialRaw") or "").lower()
        if tm5.get("sidesBurning") == 1 or "1 sided" in mraw:
            confinement = "1_sided_insulated"
        elif tm5.get("sidesBurning") == 2 or "2 sided" in mraw or geom in ("thin film", "fabric sheet"):
            confinement = "2_sided_free"
        elif geom in ("cylinder (rod)", "candle"):
            confinement = "axisymmetric_free"
        elif geom == "slab":
            confinement = "2_sided_free"
    elif inv == "BASS":
        orientation = "horizontal_msg_duct"
        if geom in ("fabric sheet", "sheet"):
            confinement = "2_sided_free"
        elif geom in ("sphere", "candle"):
            confinement = "axisymmetric_free"
        elif geom == "slab":
            confinement = "slab_mounted"
    elif inv in ("Saffire-I", "Saffire-II", "Saffire-III"):
        orientation = "cygnus_flow_duct"
        confinement = "composite_nomex_backed" if "nomex" in str(row.get("fuel") or "").lower() else "card_mounted"
    elif inv == "CFI":
        orientation = "cir_mdca_chamber"
        fib = str(extra.get("Fiber") or "")
        confinement = "sic_fiber_tethered" if fib == "Yes" else ("free_droplet" if fib == "No" else None)
    elif inv == "FLEX":
        orientation = "cir_mdca_chamber"
        confinement = "free_or_tethered_droplet"
    elif inv in ("SAME", "SAME-R"):
        orientation = "msg_smoke_tube"
        confinement = "heated_wire_coil_substrate"
    elif inv in ("ACME-BRE", "ACME-CFI-G"):
        orientation = "cir_acme_chamber"
        confinement = "porous_burner"
    elif inv in ("SPICE", "SLICE", "ACME-E-FIELD"):
        orientation = "vertical_coflow_nozzle"
        confinement = "coaxial_nozzle"

    return confinement, orientation


def extract_atmosphere(row: dict[str, Any], src_ref: dict[str, Any]) -> dict[str, Any]:
    """Build AtmosphereSpec with explicit o2.role and provenance."""
    inv = row["inv"]
    extra = row.get("extra") or {}

    # O2 provenance & role
    o2_role = "oxidizer_stream" if (inv == "ACME-CFI-G" and ("-I-" in row["testId"] or str(extra.get("Flame Type", "")).lower() == "inverse")) else "ambient"
    o2_prov = "reported" if row.get("o2Pct") is not None else "unknown"
    if inv in ("SAME", "SAME-R", "SPICE") and row.get("o2Pct") is not None:
        o2_prov = "assumed"

    # Pressure provenance & original value
    p_prov = "reported" if row.get("pressureKpa") is not None else "unknown"
    p_orig = None
    p_orig_unit = None
    if inv in ("SAME", "SAME-R", "SPICE") and row.get("pressureKpa") is not None:
        p_prov = "assumed"
    elif inv == "BASS-II" and row.get("pressureKpa") is not None:
        p_prov = "series_level"
        p_orig = 1.0
        p_orig_unit = "atm"
    elif inv == "Saffire-II" and row.get("pressureKpa") is not None:
        p_prov = "series_level"
        p_orig = 100.0
        p_orig_unit = "kPa"
    elif extra.get("pressure_mmHg") is not None:
        p_orig = extra.get("pressure_mmHg")
        p_orig_unit = "mmHg"
    elif extra.get("pressureRaw") is not None:
        p_orig = extra.get("pressureRaw")

    dil_val = row.get("diluentPct")
    dil_prov = "reported" if dil_val is not None else ("unknown" if row.get("diluent") else "unknown")

    return {
        "o2": make_sv(
            row.get("o2Pct"),
            "%vol",
            provenance=o2_prov,
            original_value=extra.get("o2Raw"),
            role=o2_role,
            source_ref=src_ref,
        ),
        "pressure": make_sv(
            row.get("pressureKpa"),
            "kPa",
            provenance=p_prov,
            original_value=p_orig,
            original_unit=p_orig_unit,
            source_ref=src_ref,
        ),
        "diluent": row.get("diluent"),
        "diluentPct": make_sv(dil_val, "%vol", provenance=dil_prov, source_ref=src_ref),
    }


def extract_gravity(row: dict[str, Any], src_ref: dict[str, Any]) -> dict[str, Any]:
    """Build GravitySpec enforcing ISS/Cygnus actual_flight separation."""
    inv = row["inv"]
    platform = "Cygnus" if inv.startswith("Saffire") else "ISS"
    g_val = row.get("gravityG")
    return {
        "gravityG": make_sv(float(g_val) if g_val is not None else 0.0, "g", "series_level", source_ref=src_ref),
        "regime": "microgravity",
        "platform": platform,
        "mode": "actual_flight",
    }


# ---------------------------------------------------------------------------
# ProtocolStep & Event reconstructors per investigation family


def _make_step(
    test_id: str,
    order: int,
    stage_type: str,
    description: str,
    flow_sv: dict[str, Any],
    o2_sv: dict[str, Any],
    p_sv: dict[str, Any],
    intervention: str,
    src_ref: dict[str, Any],
    time_start: float | None = None,
    time_end: float | None = None,
) -> dict[str, Any]:
    return {
        "segmentId": f"{test_id}-seg-{order}",
        "testId": test_id,
        "order": order,
        "timeStartS": time_start,
        "timeEndS": time_end,
        "stageType": stage_type,
        "description": description,
        "flowCmS": flow_sv,
        "o2Pct": o2_sv,
        "pressureKpa": p_sv,
        "intervention": intervention,
        "sourceRef": src_ref,
    }


def _make_event(
    test_id: str,
    idx: int,
    segment_id: str,
    endpoint: str,
    event_type: str,
    observed_val: dict[str, Any],
    sensor: str | None,
    src_ref: dict[str, Any],
) -> dict[str, Any]:
    return {
        "id": f"{test_id}-evt-{idx}",
        "testId": test_id,
        "segmentId": segment_id,
        "endpoint": endpoint,
        "eventType": event_type,
        "observedValue": observed_val,
        "sensorOrMethod": sensor,
        "sourceRef": src_ref,
    }


def _segments_bass_family(
    row: dict[str, Any],
    flow: dict[str, Any],
    atm: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str | None]:
    """Reconstruct multi-segment ProtocolSteps and Events for BASS & BASS-II."""
    tid = row["testId"]
    extra = row.get("extra") or {}
    obs = str(extra.get("tmObservations") or extra.get("observations") or row.get("outcomeRaw") or "")
    low = obs.lower()
    term_event = extra.get("terminalEvent")
    outcome = row.get("outcome") or "unknown"
    seq = flow.get("sequenceCmS") or ([] if flow["initialFlowCmS"]["value"] is None else [flow["initialFlowCmS"]["value"]])
    f0 = seq[0] if seq else None
    o2_sv = atm["o2"]
    p_sv = atm["pressure"]

    def f_sv(v: float | None, prov: str = "reported") -> dict[str, Any]:
        return make_sv(v, "cm/s", provenance=prov if v is not None else "unknown", source_ref=src_ref)

    segs: list[dict[str, Any]] = []
    evts: list[dict[str, Any]] = []
    order = 1

    # A family-level protocol cannot establish the outcome of an undocumented test.
    if outcome == "unknown":
        segs.append(_make_step(
            tid, order, "preparation",
            "Reconstructed BASS protocol context only; ignition and burn outcome unknown",
            f_sv(f0), o2_sv, p_sv, "unknown", src_ref,
        ))
        return segs, evts, "unknown", None

    # Preparation if reused sample (BASS same sphere/candle/preburned)
    if any(k in low for k in ("same sphere", "same candle", "preburned", "re-igntion", "re-ignition", "reignit", "stump")):
        segs.append(_make_step(
            tid, order, "preparation",
            "Reused/preburned sample inspected prior to igniter engagement",
            f_sv(f0), o2_sv, p_sv, "sample_reused", src_ref,
        ))
        order += 1

    # Segment: ignition
    ign_failed = outcome == "no_ignition"
    seg_ign = _make_step(
        tid, order, "ignition",
        f"Reconstructed hot-wire ignition stage at initial flow ({f0} cm/s); inferred from reported burn outcome" if not ign_failed else f"Igniter energized at {f0} cm/s; failed to establish sustained flame",
        f_sv(f0), o2_sv, p_sv, "igniter_energized", src_ref,
    )
    segs.append(seg_ign)
    order += 1

    if ign_failed:
        evts.append(_make_event(
            tid, len(evts) + 1, seg_ign["segmentId"],
            "flame_establishment", "no_ignition",
            make_sv("no_ignition", "state", "reported", source_ref=src_ref),
            "video/visual", src_ref,
        ))
        return segs, evts, "no_ignition", term_event or "no_ignition"

    # Segment: initial steady burn / establishment
    seg_burn = _make_step(
        tid, order, "steady_burn",
        f"Established microgravity flame at {f0} cm/s ({flow['direction']} flow)",
        f_sv(f0), o2_sv, p_sv, "none", src_ref,
    )
    segs.append(seg_burn)
    order += 1
    evts.append(_make_event(
        tid, len(evts) + 1, seg_burn["segmentId"],
        "flame_establishment", "ignited",
        make_sv("ignited", "state", "derived", source_ref=src_ref),
        "inferred from legacy burn outcome; ignition not independently extracted", src_ref,
    ))

    # Spread rate event(s) (including multi-velocity TM Table 5.1)
    tm5 = extra.get("tmTable5_1")
    if isinstance(tm5, dict) and tm5.get("spreadRatesMmS"):
        vels = tm5.get("velocitiesCmS") or []
        for idx_sr, sr in enumerate(tm5["spreadRatesMmS"]):
            v_lbl = vels[idx_sr] if idx_sr < len(vels) else extra.get("spreadRateFlowCmS")
            evts.append(_make_event(
                tid, len(evts) + 1, seg_burn["segmentId"],
                "spread_rate", "measured_spread_rate",
                make_sv(float(sr), "mm/s", "reported", original_value=f"flow={v_lbl} cm/s", source_ref=src_ref),
                "TM Table 5.1 video tracking", src_ref,
            ))
    elif row.get("spreadRateMmS") is not None:
        evts.append(_make_event(
            tid, len(evts) + 1, seg_burn["segmentId"],
            "spread_rate", "measured_spread_rate",
            make_sv(float(row["spreadRateMmS"]), "mm/s", "reported", source_ref=src_ref),
            extra.get("spreadRateSource") or "video tracking", src_ref,
        ))

    if outcome == "flame_spread":
        evts.append(_make_event(
            tid, len(evts) + 1, seg_burn["segmentId"],
            "sustained_spread", "steady_or_propagating_spread",
            make_sv("sustained", "state", "reported", source_ref=src_ref),
            "video", src_ref,
        ))

    # Intermediate flow modification segments for multi-velocity sequences
    last_f = f0
    for nxt in seq[1:]:
        if nxt == last_f:
            continue
        interv = "flow_stepped_down" if (last_f is None or nxt < last_f) else "flow_stepped_up"
        seg_f = _make_step(
            tid, order, "flow_modification",
            f"Tunnel flow adjusted from {last_f} to {nxt} cm/s",
            f_sv(nxt), o2_sv, p_sv, interv, src_ref,
        )
        segs.append(seg_f)
        order += 1
        last_f = nxt

    # Gas intervention (GN2 jet) in BASS / BASS-II during burn (exclude T1 prefill)
    has_n2_jet = bool(re.search(r"\b(gn2|n2)\b", low)) and "fill" not in low
    if row["inv"] == "BASS" and extra.get("GN2 Pot") and "n2" in low:
        has_n2_jet = True
    if has_n2_jet:
        seg_n2 = _make_step(
            tid, order, "gas_intervention",
            f"Gaseous N2 suppressant jet applied during burn (GN2 pot={extra.get('GN2 Pot')})",
            f_sv(last_f), o2_sv, p_sv, "n2_jet_applied", src_ref,
        )
        segs.append(seg_n2)
        order += 1
        if term_event == "n2_extinguished" or "blew out" in low or "put out by n2" in low:
            evts.append(_make_event(
                tid, len(evts) + 1, seg_n2["segmentId"],
                "suppressant_extinction", "n2_jet_extinction",
                make_sv("extinguished", "state", "reported", source_ref=src_ref),
                "video/visual", src_ref,
            ))

    # Terminal segment
    if term_event == "flow_turned_off":
        seg_t = _make_step(
            tid, order, "termination",
            "Test terminated by operator turning off airflow",
            f_sv(0.0, "derived"), o2_sv, p_sv, "flow_shutoff", src_ref,
        )
        segs.append(seg_t)
        evts.append(_make_event(
            tid, len(evts) + 1, seg_t["segmentId"],
            "extinction_under_flow_change", "operator_flow_shutoff",
            make_sv("flow_turned_off", "state", "reported", source_ref=src_ref),
            "operator/video", src_ref,
        ))
    elif term_event == "blowoff":
        seg_t = _make_step(
            tid, order, "termination",
            f"Flame blew off at elevated flow velocity ({last_f} cm/s or max fan)",
            f_sv(last_f), o2_sv, p_sv, "flow_stepped_up", src_ref,
        )
        segs.append(seg_t)
        evts.append(_make_event(
            tid, len(evts) + 1, seg_t["segmentId"],
            "blowoff_limit", "blowoff_extinction",
            make_sv(last_f, "cm/s", "reported" if last_f is not None else "unknown", source_ref=src_ref),
            "video/anemometer", src_ref,
        ))
    elif term_event == "extinguished_at_reduced_flow":
        seg_t = _make_step(
            tid, order, "termination",
            f"Flame quenched/extinguished under reduced flow (final step ~{last_f} cm/s)",
            f_sv(last_f), o2_sv, p_sv, "flow_stepped_down", src_ref,
        )
        segs.append(seg_t)
        evts.append(_make_event(
            tid, len(evts) + 1, seg_t["segmentId"],
            "quench_limit", "extinction_at_reduced_flow",
            make_sv(last_f, "cm/s", "reported" if last_f is not None else "unknown", source_ref=src_ref),
            "video/anemometer", src_ref,
        ))
    elif outcome == "self_extinguished":
        seg_t = _make_step(
            tid, order, "termination",
            "Flame self-extinguished before reaching end of test",
            f_sv(last_f), o2_sv, p_sv, "none", src_ref,
        )
        segs.append(seg_t)
        evts.append(_make_event(
            tid, len(evts) + 1, seg_t["segmentId"],
            "extinction_under_flow_change" if len(seq) > 1 else "flame_establishment",
            "self_extinguished",
            make_sv("self_extinguished", "state", "reported", source_ref=src_ref),
            "video/visual", src_ref,
        ))
    else:
        seg_t = _make_step(
            tid, order, "termination",
            "Burn concluded at end of sample/observation period",
            f_sv(last_f), o2_sv, p_sv, "none", src_ref,
        )
        segs.append(seg_t)

    init_out = "ignited_flame_spread" if outcome == "flame_spread" else ("ignited_burned" if outcome == "burned" else outcome)
    return segs, evts, init_out, term_event


def _segments_droplet(
    row: dict[str, Any],
    flow: dict[str, Any],
    atm: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str | None]:
    """Reconstruct ProtocolSteps & Events for CFI and FLEX (hot vs cool flame separation)."""
    tid = row["testId"]
    extra = row.get("extra") or {}
    f_sv = flow["initialFlowCmS"]
    o2_sv = atm["o2"]
    p_sv = atm["pressure"]
    segs: list[dict[str, Any]] = []
    evts: list[dict[str, Any]] = []

    k_hot = row.get("burningRateMm2S")
    d_ext_hot = extra.get("DextHotMm")
    k_cool = extra.get("kCoolMm2S")
    d_ext_cool = extra.get("DextCoolMm")
    reign = extra.get("reignitions")
    has_cool = k_cool is not None or d_ext_cool is not None

    # Segment 1: Hot flame establishment, steady burning, and hot-flame radiative extinction
    desc_1 = "Hot-flame droplet combustion following ignition"
    if d_ext_hot is not None:
        desc_1 += f" ending in radiative hot-flame extinction at D = {d_ext_hot} mm"
    seg1 = _make_step(tid, 1, "steady_burn", desc_1, f_sv, o2_sv, p_sv, "igniter_energized", src_ref)
    segs.append(seg1)

    if k_hot is not None:
        evts.append(_make_event(
            tid, len(evts) + 1, seg1["segmentId"],
            "burning_rate_constant", "hot_flame_burning_rate",
            make_sv(float(k_hot), "mm^2/s", "reported", source_ref=src_ref),
            "droplet imaging", src_ref,
        ))
    if d_ext_hot is not None:
        evts.append(_make_event(
            tid, len(evts) + 1, seg1["segmentId"],
            "hot_flame_extinction", "radiative_hot_flame_extinction",
            make_sv(float(d_ext_hot), "mm", "reported", source_ref=src_ref),
            "UV/B&W camera", src_ref,
        ))
    elif row["inv"] == "FLEX" and extra.get("extinctionDiameterMm") is not None:
        evts.append(_make_event(
            tid, len(evts) + 1, seg1["segmentId"],
            "hot_flame_extinction", f"flex_{row.get('outcome')}",
            make_sv(float(extra["extinctionDiameterMm"]), "mm", "reported", source_ref=src_ref),
            "CIR/MDCA camera", src_ref,
        ))

    # Segment 2: Cool-flame continuation (strictly separated for CFI)
    if has_cool:
        desc_2 = "Second-stage low-temperature cool-flame continuation after hot-flame extinction"
        if k_cool is not None:
            desc_2 += f" (K_cool = {k_cool} mm^2/s)"
        if reign:
            desc_2 += f"; {reign} reignition(s) observed"
        seg2 = _make_step(tid, 2, "steady_burn", desc_2, f_sv, o2_sv, p_sv, "none", src_ref)
        segs.append(seg2)
        if k_cool is not None:
            evts.append(_make_event(
                tid, len(evts) + 1, seg2["segmentId"],
                "cool_flame_continuation", "cool_flame_burning_rate",
                make_sv(float(k_cool), "mm^2/s", "reported", source_ref=src_ref),
                "B&W droplet camera / radiometer", src_ref,
            ))
        if d_ext_cool is not None:
            evts.append(_make_event(
                tid, len(evts) + 1, seg2["segmentId"],
                "cool_flame_continuation", "cool_flame_extinction_diameter",
                make_sv(float(d_ext_cool), "mm", "reported", source_ref=src_ref),
                "B&W droplet camera", src_ref,
            ))

    term_order = len(segs) + 1
    term_lbl = "cool_flame_extinction" if d_ext_cool is not None else (row.get("outcome") or "extinguished")
    seg_t = _make_step(
        tid, term_order, "termination",
        f"Droplet combustion terminated ({term_lbl})",
        f_sv, o2_sv, p_sv, "none", src_ref,
        time_start=0.0 if extra.get("burnTimeS") is not None else None,
        time_end=parse_float_safe(extra.get("burnTimeS")),
    )
    segs.append(seg_t)

    init_out = "hot_flame_ignited" if (k_hot is not None or d_ext_hot is not None or row.get("outcome") != "unknown") else "unknown"
    return segs, evts, init_out, term_lbl


def _segments_same(
    row: dict[str, Any],
    flow: dict[str, Any],
    atm: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str | None]:
    """Reconstruct Segment 1 (heating below ignition) and Segment 2 (aging chamber) for SAME & SAME-R."""
    tid = row["testId"]
    extra = row.get("extra") or {}
    f_sv = flow["initialFlowCmS"]
    o2_sv = atm["o2"]
    p_sv = atm["pressure"]

    dur = parse_float_safe(extra.get("smokeDurationS") or extra.get("Duration (sec)"))
    aging_s = parse_float_safe(extra.get("netAgingTimeS") or extra.get("Net aging time (sec)"))
    temp_c = extra.get("sampleTemperatureC")

    seg1 = _make_step(
        tid, 1, "preparation",
        f"Pyrolytic heating below ignition (no flame) at sample temp {temp_c} C" if temp_c is not None else "Pyrolytic heating below ignition (non-flaming smoke generation)",
        f_sv, o2_sv, p_sv, "heater_cutoff" if dur is not None else "none", src_ref,
        time_start=0.0 if dur is not None else None,
        time_end=dur,
    )
    seg2 = _make_step(
        tid, 2, "aging",
        f"Smoke coagulation in aging chamber prior to particle sizing (net aging {aging_s} s)" if aging_s is not None else "Smoke aging/transport to particle-size diagnostics",
        f_sv, o2_sv, p_sv, "none", src_ref,
        time_start=None,
        time_end=aging_s,
    )
    evts: list[dict[str, Any]] = []
    if row.get("particleSizeNm") is not None:
        evts.append(_make_event(
            tid, 1, seg2["segmentId"],
            "smoke_particle_size", "smoke_aerosol_sizing",
            make_sv(float(row["particleSizeNm"]), "nm", "reported", source_ref=src_ref),
            "SAME moments / Hatch-Choate diagnostics", src_ref,
        ))
    return [seg1, seg2], evts, "non_flaming_pyrolysis", "smoke_sampled"


def _segments_acme_cfig(
    row: dict[str, Any],
    flow: dict[str, Any],
    atm: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str | None]:
    """Reconstruct ProtocolSteps & Events for ACME-CFI-G (normal vs inverse)."""
    tid = row["testId"]
    extra = row.get("extra") or {}
    f_sv = flow["initialFlowCmS"]
    o2_sv = atm["o2"]
    p_sv = atm["pressure"]
    role = o2_sv.get("role", "ambient")
    outcome = row.get("outcome") or "unknown"
    burn_s = parse_float_safe(extra.get("burn time (sec)"))
    cool_flag = str(extra.get("Cool flame?") or "")

    segs: list[dict[str, Any]] = []
    evts: list[dict[str, Any]] = []

    seg1 = _make_step(
        tid, 1, "ignition",
        f"Porous spherical burner ignition attempt (O2 role={role})",
        f_sv, o2_sv, p_sv, "igniter_energized", src_ref,
    )
    segs.append(seg1)
    if outcome == "no_ignition":
        evts.append(_make_event(
            tid, 1, seg1["segmentId"],
            "flame_establishment", "no_ignition",
            make_sv("no_ignition", "state", "reported", source_ref=src_ref),
            "CIR camera/radiometer", src_ref,
        ))
        return segs, evts, "no_ignition", "no_ignition"

    seg2 = _make_step(
        tid, 2, "steady_burn",
        f"Spherical diffusion flame on porous burner ({'inverse' if role == 'oxidizer_stream' else 'normal'})",
        f_sv, o2_sv, p_sv, "none", src_ref,
        time_start=0.0 if burn_s is not None else None,
        time_end=burn_s,
    )
    segs.append(seg2)
    evts.append(_make_event(
        tid, 1, seg2["segmentId"],
        "flame_establishment", "hot_ignition",
        make_sv(extra.get("Peak burner temp (K)") or extra.get("Peak burner T (C )") or "ignited", "K" if extra.get("Peak burner temp (K)") else "state", "reported", source_ref=src_ref),
        "thermocouple/radiometer", src_ref,
    ))
    if cool_flag.lower().startswith("yes"):
        evts.append(_make_event(
            tid, len(evts) + 1, seg2["segmentId"],
            "cool_flame_continuation", "cool_flame_pci",
            make_sv(cool_flag, "state", "reported", source_ref=src_ref),
            "PMT/thermocouple", src_ref,
        ))

    term_lbl = "self_extinguished" if outcome == "self_extinguished" else "fuel_shutoff"
    seg3 = _make_step(
        tid, 3, "termination",
        f"Flame terminated ({term_lbl})",
        f_sv, o2_sv, p_sv, "flow_shutoff" if outcome == "burned" else "none", src_ref,
    )
    segs.append(seg3)
    if outcome == "self_extinguished":
        evts.append(_make_event(
            tid, len(evts) + 1, seg3["segmentId"],
            "hot_flame_extinction", "self_extinguished",
            make_sv("SE", "state", "reported", source_ref=src_ref),
            "CIR camera", src_ref,
        ))
    return segs, evts, "hot_ignition", term_lbl


def _segments_spice(
    row: dict[str, Any],
    flow: dict[str, Any],
    atm: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str | None]:
    """Reconstruct SPICE ProtocolSteps & smoke_point_length / jet_flame_observation Event."""
    tid = row["testId"]
    extra = row.get("extra") or {}
    f_sv = flow["initialFlowCmS"]
    o2_sv = atm["o2"]
    p_sv = atm["pressure"]

    seg1 = _make_step(tid, 1, "ignition", "Co-flow jet flame ignited at nozzle", f_sv, o2_sv, p_sv, "igniter_energized", src_ref)
    seg2 = _make_step(
        tid, 2, "steady_burn",
        f"Steady co-flow jet flame (fuel rate {extra.get('Fuel Rate (sccm)')} sccm)",
        f_sv, o2_sv, p_sv, "none", src_ref,
    )
    sp = row.get("smokePointLengthMm")
    fl = extra.get("flameLengthMm")
    if sp is not None:
        evt_type = "smoke_point_determination"
        obs_val = make_sv(float(sp), "mm", "reported", source_ref=src_ref)
    else:
        evt_type = "jet_flame_observation"
        obs_val = make_sv(float(fl) if fl is not None else "observed", "mm" if fl is not None else "state", "reported", source_ref=src_ref)
    evt = _make_event(tid, 1, seg2["segmentId"], "smoke_point_length", evt_type, obs_val, "Nikon/CCD imaging", src_ref)
    return [seg1, seg2], [evt], "jet_flame_established", "fuel_shutoff"


def _segments_saffire_or_other(
    row: dict[str, Any],
    flow: dict[str, Any],
    atm: dict[str, Any],
    src_ref: dict[str, Any],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], str, str | None]:
    """Reconstruct ProtocolSteps & Events for Saffire-I/II/III, ACME-BRE, ACME-E-FIELD, SLICE."""
    inv = row["inv"]
    tid = row["testId"]
    extra = row.get("extra") or {}
    f_sv = flow["initialFlowCmS"]
    o2_sv = atm["o2"]
    p_sv = atm["pressure"]
    segs: list[dict[str, Any]] = []
    evts: list[dict[str, Any]] = []

    if inv in ("Saffire-I", "Saffire-II", "Saffire-III"):
        ign_t = parse_float_safe(extra.get("Ignition Time (s)"))
        burn_t = parse_float_safe(extra.get("Burn Time (s)"))
        segs.append(_make_step(
            tid, 1, "ignition",
            f"Hot-wire ignition in Cygnus duct flow ({flow['direction']})",
            f_sv, o2_sv, p_sv, "igniter_energized", src_ref,
            time_start=0.0 if ign_t is not None else None, time_end=ign_t,
        ))
        seg2 = _make_step(
            tid, 2, "steady_burn",
            f"Large-duct flame spread test ({extra.get('Burn Time (s)') or 'Cygnus'} burn)",
            f_sv, o2_sv, p_sv, "none", src_ref,
            time_start=None, time_end=burn_t,
        )
        segs.append(seg2)
        if row.get("spreadRateMmS") is not None:
            evts.append(_make_event(
                tid, 1, seg2["segmentId"],
                "spread_rate", "cygnus_spread_rate",
                make_sv(float(row["spreadRateMmS"]), "mm/s", "reported", source_ref=src_ref),
                "Cygnus video cameras", src_ref,
            ))
        term_ev = "self_extinguished" if row.get("outcome") == "self_extinguished" else ("burnout_complete" if row.get("outcome") == "burned" else "unknown")
        segs.append(_make_step(
            tid, 3, "termination",
            f"Saffire test concluded ({term_ev})",
            f_sv, o2_sv, p_sv, "none", src_ref,
        ))
        return segs, evts, row.get("outcome") or "unknown", term_ev

    # Day-level summary rows: ACME-BRE, ACME-E-FIELD, SLICE
    outcome = row.get("outcome") or "unknown"
    desc_prefix = f"{inv} day-level/condition summary"
    if inv == "ACME-E-FIELD":
        desc_prefix += f" (mesh polarity={extra.get('meshPolarity')}, up to 10 kV in 0g)"
    seg1 = _make_step(
        tid, 1, "ignition" if outcome == "no_ignition" else "steady_burn",
        f"{desc_prefix}: {row.get('outcomeRaw') or outcome}",
        f_sv, o2_sv, p_sv, "igniter_energized", src_ref,
    )
    segs.append(seg1)
    if outcome != "unknown":
        evts.append(_make_event(
            tid, 1, seg1["segmentId"],
            "flame_establishment", f"{inv.lower()}_{outcome}",
            make_sv(row.get("outcomeRaw") or outcome, "state", "series_level", source_ref=src_ref),
            "CIR day log", src_ref,
        ))
    return segs, evts, outcome, outcome


# ---------------------------------------------------------------------------
# Deterministic replicate/series groupId assignment


def _round_opt(v: float | None, ndigits: int) -> float | None:
    return round(float(v), ndigits) if v is not None else None


class _UnionFind:
    def __init__(self) -> None:
        self.parent: dict[str, str] = {}

    def find(self, x: str) -> str:
        p = self.parent.setdefault(x, x)
        if p != x:
            self.parent[x] = self.find(p)
        return self.parent[x]

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.parent[rb] = ra


def assign_group_ids(tests: list[dict[str, Any]]) -> None:
    """Assign deterministic groupId across reused samples, aged pairs, and condition replicates."""
    uf = _UnionFind()
    by_bass_sample: dict[tuple[str, str], list[str]] = defaultdict(list)
    by_same_base: dict[tuple[str, str], list[str]] = defaultdict(list)
    by_same_sample_id: dict[tuple[str, str], list[str]] = defaultdict(list)
    by_cond_sig: dict[str, list[str]] = defaultdict(list)

    for t in tests:
        tid = t["testId"]
        inv = t["inv"]
        extra = t.get("extra") or {}
        if inv in ("BASS", "BASS-II"):
            samp = str(extra.get("Sample #") or "").strip()
            if samp and samp.lower() not in ("none", "na", "?", "unknown"):
                by_bass_sample[(inv, samp)].append(tid)
        if inv in ("SAME", "SAME-R"):
            base_tid = re.sub(r"a$", "", tid)
            by_same_base[(inv, base_tid)].append(tid)
            sid = str(extra.get("sampleId") or "").strip()
            if sid:
                by_same_sample_id[(inv, sid)].append(tid)

        sig = json.dumps([
            inv,
            (t.get("fuel") or "").lower(),
            (t.get("geometry") or "").lower(),
            _round_opt(t["thicknessMm"]["value"], 2),
            _round_opt(t["diameterMm"]["value"], 1),
            _round_opt(t["atmosphere"]["o2"]["value"], 1),
            t["atmosphere"]["o2"].get("role"),
            _round_opt(t["atmosphere"]["pressure"]["value"], 0),
            _round_opt(t["flow"]["initialFlowCmS"]["value"], 1),
            t["flow"].get("direction"),
            (t["atmosphere"].get("diluent") or "").lower(),
            _round_opt(t["atmosphere"]["diluentPct"]["value"], 0),
            _round_opt(t["gravity"]["gravityG"]["value"], 2),
        ], sort_keys=False)
        by_cond_sig[sig].append(tid)

    for bucket in (by_bass_sample, by_same_base, by_same_sample_id, by_cond_sig):
        for tids in bucket.values():
            if len(tids) > 1:
                head = sorted(tids)[0]
                for other in tids[1:]:
                    uf.union(head, other)

    groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for t in tests:
        groups[uf.find(t["testId"])].append(t)

    for root_id, members in groups.items():
        members_sorted = sorted(members, key=lambda x: x["testId"])
        inv = members_sorted[0]["inv"]
        digest = hashlib.sha1(f"{inv}:{members_sorted[0]['testId']}".encode()).hexdigest()[:10]
        gid = f"grp:{inv}:{digest}"
        for m in members:
            m["groupId"] = gid


def bass_workbook_rows() -> dict[int, tuple[Any, ...]]:
    """Read primary workbook once; asRunRow is a locator, never an unverified join."""
    from openpyxl import load_workbook
    path = RAW_DIR / "PSI-26" / "PSI-26_Science Documents_As Run_Test Matrix.xlsx"
    workbook = load_workbook(path, read_only=True, data_only=True)
    rows = dict(enumerate(workbook["as run matrix"].iter_rows(values_only=True), start=1))
    workbook.close()
    return rows


def bass_source_refs(row: dict[str, Any], cells: tuple[Any, ...], source_map: dict[str, dict[str, Any]], file_hash: str) -> dict[str, dict[str, Any]]:
    extra = row["extra"]
    number = int(extra["asRunRow"])
    if str(cells[2]) != str(extra["As Run Test #"]) or str(cells[3]) != str(extra["Test #"]):
        raise ValueError(f"BASS workbook identity mismatch at row {number}: {row['testId']}")
    refs = {}
    for field, column, index in [("o2", "AA", 26), ("pressure", "AB", 27), ("flow", "K", 10), ("observations", "AD", 29)]:
        refs[field] = make_source_ref("psi-26", source_map, file_hash=file_hash,
            locator={"table": "PSI-26_Science Documents_As Run_Test Matrix.xlsx", "sheet": "as run matrix", "row": number, "cell": f"{column}{number}"},
            quote=str(cells[index]) if cells[index] is not None else None,
            context=f"BASS {row['testId']}: {field}; O2 workbook fraction × 100; pressure atm × 101.325 kPa")
    return refs


def reconstruct_all_tests(
    legacy_tests: list[dict[str, Any]],
    source_map: dict[str, dict[str, Any]],
    by_basename: dict[str, str],
    appA_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Transform all 1,678 legacy tests into EMBER v2 Test records."""
    v2_tests: list[dict[str, Any]] = []
    bass_rows = bass_workbook_rows()
    for row in legacy_tests:
        inv = row["inv"]
        tid = row["testId"]
        extra = row.get("extra") or {}
        src_meta = row.get("source") or {}
        sid = src_meta.get("sourceId", "")
        fname = src_meta.get("file", "")
        fhash = by_basename.get(fname) or source_map.get(sid, {}).get("fileHash")

        locator: dict[str, Any] = {}
        if fname:
            locator["table"] = fname
        if src_meta.get("row") is not None:
            locator["row"] = int(src_meta["row"])
        if extra.get("tmAppendixRef"):
            locator["section"] = str(extra["tmAppendixRef"])
        src_ref = make_source_ref(sid, source_map, file_hash=fhash, locator=locator, quote=None if inv == "BASS" else row.get("outcomeRaw"), context=f"{inv} test {tid}")

        app_row = appA_by_id.get(tid.replace("BASS-II-", "")) if inv == "BASS-II" else None
        geom, thickness, diameter, width = _infer_geometry_and_dims(row, src_ref)
        confinement, orientation = extract_confinement_and_orientation(row, geom)
        atm = extract_atmosphere(row, src_ref)
        flow = extract_flow_spec(row, src_ref, app_row)
        gravity = extract_gravity(row, src_ref)
        observation_ref = None
        if inv == "BASS":
            cells = bass_rows[int(extra["asRunRow"])]
            refs = bass_source_refs(row, cells, source_map, by_basename["PSI-26_Science Documents_As Run_Test Matrix.xlsx"])
            atm["o2"]["sourceRef"] = refs["o2"]
            atm["o2"]["originalValue"] = cells[26]
            atm["o2"]["originalUnit"] = "volume fraction"
            atm["pressure"]["sourceRef"] = refs["pressure"]
            atm["pressure"]["originalValue"] = cells[27]
            atm["pressure"]["originalUnit"] = "atm"
            flow["initialFlowCmS"]["sourceRef"] = refs["flow"]
            observation_ref = refs["observations"]

        if inv in ("BASS", "BASS-II"):
            segs, evts, init_out, term_ev = _segments_bass_family(row, flow, atm, observation_ref or src_ref)
        elif inv in ("CFI", "FLEX"):
            segs, evts, init_out, term_ev = _segments_droplet(row, flow, atm, src_ref)
        elif inv in ("SAME", "SAME-R"):
            segs, evts, init_out, term_ev = _segments_same(row, flow, atm, src_ref)
        elif inv == "ACME-CFI-G":
            segs, evts, init_out, term_ev = _segments_acme_cfig(row, flow, atm, src_ref)
        elif inv == "SPICE":
            segs, evts, init_out, term_ev = _segments_spice(row, flow, atm, src_ref)
        else:
            segs, evts, init_out, term_ev = _segments_saffire_or_other(row, flow, atm, src_ref)

        series_id = (
            f"BASS-II-{tid.replace('BASS-II-', '')[0]}" if inv == "BASS-II"
            else (f"{inv}-inverse" if (inv == "ACME-CFI-G" and atm["o2"].get("role") == "oxidizer_stream") else inv)
        )
        sample_num = str(extra.get("Sample #") or extra.get("sampleId") or "").strip()
        sample_id = f"{inv}-sample-{sample_num}" if (sample_num and sample_num.lower() not in ("none", "na", "?", "")) else tid

        v2_tests.append({
            "testId": tid,
            "inv": inv,
            "seriesId": series_id,
            "sampleId": sample_id,
            "groupId": "",
            "fuel": row.get("fuel"),
            "fuelPhase": row.get("fuelPhase"),
            "geometry": geom,
            "thicknessMm": thickness,
            "diameterMm": diameter,
            "widthCm": width,
            "substrateConfinement": confinement,
            "orientation": orientation,
            "atmosphere": atm,
            "flow": flow,
            "gravity": gravity,
            "initialOutcome": init_out,
            "terminalEvent": term_ev,
            "outcomeRaw": row.get("outcomeRaw"),
            **({"observationSourceRef": observation_ref} if observation_ref else {}),
            "segments": segs,
            "events": evts,
            "spreadRateMmS": make_sv(row.get("spreadRateMmS"), "mm/s", "reported" if row.get("spreadRateMmS") is not None else "unknown", original_value=extra.get("ug Spread Rate"), source_ref=src_ref),
            "burningRateMm2S": make_sv(row.get("burningRateMm2S"), "mm^2/s", "reported" if row.get("burningRateMm2S") is not None else "unknown", source_ref=src_ref),
            "particleSizeNm": make_sv(row.get("particleSizeNm"), "nm", "reported" if row.get("particleSizeNm") is not None else "unknown", source_ref=src_ref),
            "smokePointLengthMm": make_sv(row.get("smokePointLengthMm"), "mm", "reported" if row.get("smokePointLengthMm") is not None else "unknown", source_ref=src_ref),
            "extra": extra,
            "sourceRef": src_ref,
        })

    assign_group_ids(v2_tests)
    return v2_tests


# ---------------------------------------------------------------------------
# Investigations builder


METHOD_SUMMARIES: dict[str, str] = {
    "BASS": "ISS Microgravity Science Glovebox (MSG) 76x76 mm duct burning solids in 0-40 cm/s airflow with selectable gaseous N2 suppressant injection; sequential multi-step tests often reused specimens.",
    "BASS-II": "ISS MSG 76x76 mm forced-flow duct across six sub-series (B films, F fabrics/candles, M slabs, O axial-stagnation rods, P opposed rods, T SIBAL concurrent sheets) with stepped velocity protocols and N2 dilution.",
    "Saffire-I": "Meter-scale (0.406x0.94 m) SIBAL cotton-fiberglass fabric burned at 20 cm/s inside the uncrewed Cygnus resupply spacecraft flow duct after ISS unberthing.",
    "Saffire-II": "Nine 5x29 cm material cards (SIBAL, silicone, structural/flat PMMA, PMMA+Nomex) burned inside Cygnus at 100 kPa and 20 or 30 cm/s concurrent/opposed flow.",
    "Saffire-III": "Meter-scale SIBAL fabric flame spread in Cygnus at 30 cm/s concurrent and opposed flow with radiometer, thermocouple, anemometer, and gas diagnostics.",
    "FLEX": "ISS Combustion Integrated Rack (CIR) MDCA droplet extinction tests (heptane, methanol) in quiescent microgravity with N2, CO2, and He diluents at 0.5-1.5 atm.",
    "FLEX-2": "Planned ISS CIR droplet matrix in PSI-68 covering binary/pure alkanes and alcohols (0.5-3.0 atm, 0.17-0.30 O2 mole fraction); zero public flown test rows released in PSI-68.",
    "CFI": "ISS CIR MDCA n-dodecane, iso-dodecane/n-dodecane, and farnesane droplet combustion tracking first-stage hot-flame extinction followed by cool-flame continuation and reignition.",
    "SAME": "ISS MSG non-flaming pyrolysis smoke-generation and aging chamber sizing aerosol distributions across five heated materials assuming nominal ISS cabin air (21% O2, 101.3 kPa).",
    "SAME-R": "ISS MSG reflight of SAME adding Pyrell foam, zero-flow heating, and extended smoke aging (11-1800 s) assuming nominal ISS cabin air (21% O2, 101.3 kPa).",
    "ACME-BRE": "ISS CIR Burning Rate Emulator porous flat burner using gaseous CH4/C2H4/N2 mixtures to emulate condensed-fuel burning rates; PSI-20 CSV contains test-day aggregates only.",
    "ACME-CFI-G": "ISS CIR spherical porous burner producing normal flames (fuel into ambient O2/N2) and inverse flames (O2/N2 oxidizer stream issued from burner into fuel ambient) plus gaseous cool flames.",
    "ACME-E-FIELD": "ISS CIR coflow and gas-jet diffusion flames subjected to high-voltage DC electric fields (up to +/-10 kV) in 0g microgravity to isolate electrical body forces from buoyancy; PSI-22 CSV is test-day aggregated.",
    "SPICE": "ISS MSG Smoke Point in Co-flow Experiment measuring luminous flame height and smoke-point lengths of hydrocarbon co-flow jets under nominal cabin air assumptions (21% O2, 101 kPa).",
    "SLICE": "ISS MSG coflow CH4/C2H4/C2H6 jet imaging studying liftoff and soot structure; PSI-106 CSV provides 12 test-day rows rather than individual flame metrics.",
}


LIMITATIONS_BY_INV: dict[str, list[str]] = {
    "BASS": ["Observations record operator terminations, reused charred samples, and non-monotonic air steps; 20 sphere rows lacked explicit CSV geometry until derived from materialRaw/observations."],
    "BASS-II": ["Pressure (1 atm / 101.3 kPa) is series-level from TM-20210011385 §1 rather than per-test sensor readings; many tests ended by operator flow_shutoff rather than natural extinction."],
    "Saffire-I": ["Only 2 large-scale test conditions flown; PSI-98 table headers transposed Length (40.6) and Width (94 cm) relative to narrative/Saffire-III."],
    "Saffire-II": ["9 short-sample tests; 100 kPa cabin pressure comes from NTRS 20200000557 series report rather than per-row telemetry."],
    "Saffire-III": ["PSI-100 CSV lacks per-test O2, pressure, and quantitative burn-rate outcome columns."],
    "FLEX": ["Quiescent chamber droplet conditions cannot substitute for forced-convection solid-fuel tests."],
    "FLEX-2": ["PLANNED_ONLY: PSI-68 contains a planned experimental matrix (ranges for fuels, diameters, pressures, O2) with zero flown individual test outcomes."],
    "CFI": ["PSI-39 narrative is internally inconsistent on pressure range (Objective states 0.25-5 atm; Approach states 0.25-0.5 atm), whereas PSI-39 CSV includes 1-2 atm tests."],
    "SAME": ["Non-flaming pyrolysis smoke aerosol measurements only; O2 (21%) and pressure (101.3 kPa) are assumed ISS cabin conditions (not logged in PSI-101/102). Original TEM grids suffered contamination."],
    "SAME-R": ["Non-flaming pyrolysis smoke aerosol measurements only; O2 (21%) and pressure (101.3 kPa) are assumed ISS cabin conditions."],
    "ACME-BRE": ["PSI-20 CSV aggregates test days x listed O2 without per-flame pressures, flow rates, or extinction diameters."],
    "ACME-CFI-G": ["Inverse flames (CFI-G-I-*) report burner oxidizer-stream O2 mole fraction rather than ambient O2; must not be conflated with ambient oxygen limits."],
    "ACME-E-FIELD": ["Actual ISS 0g microgravity (NOT partial-g analogue); PSI-22 CSV reports test-day counts without per-flame O2, pressure, or voltage values."],
    "SPICE": ["Steady co-flow jet flames only (no flammability pass/fail); O2 (21±1%) and pressure (101 kPa) are assumed nominal ISS MSG cabin air per SPICE Final Report Table 1."],
    "SLICE": ["PSI-106 CSV contains 12 test-day schedule entries without per-flame O2, pressure, or quantitative soot/liftoff metrics."],
}


def build_investigations(
    invs_seed: list[dict[str, Any]],
    tests: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Enrich all 15 investigation cards with EMBER v2 epistemic status and coverage summaries."""
    by_inv: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for t in tests:
        by_inv[t["inv"]].append(t)

    out: list[dict[str, Any]] = []
    for inv in invs_seed:
        iid = inv["id"]
        rows = by_inv.get(iid, [])
        epistemic = "planned_only" if iid == "FLEX-2" else "observed"
        verif = "preliminary_team_reviewed"

        with_outcome = sum(
            1 for r in rows
            if not (r["initialOutcome"] == "unknown" and not r["outcomeRaw"] and len(r["events"]) == 0)
        )
        with_numeric = sum(
            1 for r in rows
            if any(
                r[k]["value"] is not None
                for k in ("spreadRateMmS", "burningRateMm2S", "particleSizeNm", "smokePointLengthMm")
            )
        )
        with_segs = sum(1 for r in rows if len(r["segments"]) > 0)

        note = (
            "Planned experimental matrix in PSI-68 only; 0 public flown test rows released."
            if iid == "FLEX-2"
            else f"{len(rows)} rows with {with_segs} protocol-segmented tests, {with_outcome} observed outcomes/phenomena, and {with_numeric} primary numeric targets."
        )

        enriched = dict(inv)
        enriched.update({
            "methodSummary": METHOD_SUMMARIES.get(iid, inv.get("objective") or ""),
            "limitations": LIMITATIONS_BY_INV.get(iid, inv.get("dataNotes") or []),
            "epistemicStatus": epistemic,
            "verificationStatus": verif,
            "coverageSummary": {
                "totalRows": len(rows),
                "withObservedOutcome": with_outcome,
                "withNumericTarget": with_numeric,
                "withProtocolSegments": with_segs,
                "completenessNote": note,
            },
        })
        out.append(enriched)
    return out


# ---------------------------------------------------------------------------
# Claim verifier, epistemic classifier, and 8 audited partial-claim fixes


FIXED_CLAIMS_SPECS: dict[str, dict[str, Any]] = {
    "c-0021": {
        "inv": "BASS-II",
        "text": "Across both BASS and BASS-II concurrent-flow SIBAL cotton-fiberglass tests (1.2 and 2.2 cm wide, 16-21% O2), low-speed quenching extinction occurred at 1 to 5 cm/s with higher quench speeds in lower oxygen.",
        "quote": "As a part of the NASA BASS and BASS-II experimental projects aboard the International Space Station, flame growth, spread and extinction over a composite cotton-fiberglass fabric blend (referred to as the SIBAL fabric) were studied in low-speed concurrent forced flows. The tests were conducted in a small flow duct within the Microgravity Science Glovebox. The fuel samples measured 1.2 and 2.2 cm wide and 10 cm long. Ambient oxygen was varied from 21% down to 16% and flow speed from 40 cm/s down to 1 cm/s. A small flame resulted at low flow, enabling us to observe the entire history of flame development including ignition, flame growth, steady spread (in some cases) and decay at the end of the sample. In addition, by decreasing flow velocity during some of the tests, low-speed flame quenching extinction limits were found as a function of oxygen percentage. The quenching speeds were found to be between 1 and 5 cm/s with higher speed in lower oxygen atmosphere.",
        "epistemicStatus": "observed",
        "conditionsScope": "BASS and BASS-II combined ISS MSG concurrent-flow SIBAL fabric tests; 1.2 & 2.2 cm wide, 10 cm long; 16-21% O2, 1-40 cm/s",
        "limitations": ["Applies jointly to BASS and BASS-II SIBAL concurrent-flow datasets rather than BASS-II in isolation."],
        "locator": {"section": "Abstract (ntrs-20150008962)"},
    },
    "c-0037": {
        "inv": "Saffire-I",
        "text": "Downloaded data from the Saffire series resolved whether flame growth reaches a steady size and demonstrated that enclosure size around the sample affects flame spread more than anticipated.",
        "quote": "The downloaded test data show resolved the question of whether flame growth will achieve a steady size and demonstrated that the size of the enclosure surrounding the sample has more impact on the flame spread than anticipated.",
        "epistemicStatus": "observed",
        "conditionsScope": "Saffire series (Cygnus microgravity duct across early Saffire flights)",
        "limitations": ["Source abstract ntrs-20180005168 summarizes the Saffire series broadly rather than Saffire-I alone; note verbatim typographical phrasing ('show resolved')."],
        "locator": {"section": "Abstract (ntrs-20180005168)"},
    },
    "c-0041": {
        "inv": "Saffire-I",
        "text": "Pre-flight 2015 Saffire plans scheduled Saffire-1 and Saffire-3 as meter-scale flame spread tests burned to completion inside the Cygnus pressurized volume.",
        "quote": "On two flights (Saffire-1 and Saffire-3), the experiment will consist of a flame spread test involving a meter-scale sample ignited in the pressurized volume of the spacecraft and allowed to burn to completion while measurements are made.",
        "epistemicStatus": "planned",
        "conditionsScope": "2015 pre-flight experimental design for Saffire-1 and Saffire-3 (Cygnus)",
        "limitations": ["Derived from a 2015 future-tense pre-flight poster (ntrs-20150000894); post-flight outcomes must be verified in Saffire-I/III telemetry rather than this plan."],
        "locator": {"section": "Poster Concept (ntrs-20150000894)"},
    },
    "c-0045": {
        "inv": "Saffire-II",
        "text": "Saffire-II carried a 9-sample card (5 cm x 29 cm each) adding SIBAL, silicone, structural PMMA, flat PMMA, and PMMA with Nomex.",
        "quote": "As a follow on to the Saffire-I investigation, the Saffire-II investigation added more samples including SIBAL, silicone, structure PMMA, flat PMMA, and PMMA with Nomex. The Saffire-1I flight unit had a sample card installed in the middle of a large flow duct. Air is drawn through the flow duct by fans located at the top of the duct with flow straighteners at the bottom of the experiment module. Saffire-II has a sample card that contains 9 samples, each 5 cm x 29 cm.",
        "epistemicStatus": "observed",
        "conditionsScope": "Saffire-II Cygnus flight hardware and 9-sample card configuration",
        "limitations": ["Note PSI-99 OCR artifact ('Saffire-1I', 'structure PMMA') in verbatim quote."],
        "locator": {"section": "Approach (PSI-99)"},
    },
    "c-0101": {
        "inv": "CFI",
        "text": "CFI's stated objectives plan to examine n-dodecane and n-dodecane/iso-dodecane droplets across 0.25-5 atm and helium dilution effects, though PSI-39's Approach text specifies 0.25-0.5 atm.",
        "quote": "The objectives of this investigation are to:\n1) Examine the combustion behavior of n-dodecane and mixtures of n-dodecane/iso-dodecane at pressures ranging from 0.25 atm to 5 atm.\n2) Analyze the effects of helium dilution on cool flame behavior.",
        "epistemicStatus": "planned",
        "conditionsScope": "CFI (PSI-39) investigation objectives for n-dodecane / iso-dodecane droplets and He dilution",
        "limitations": ["PSI-39 contains an internal inconsistency: Objective 1 lists 0.25-5 atm while Approach states 0.25-0.5 atm, whereas PSI-39 CSV observations cluster around 1-2 atm."],
        "locator": {"section": "Objective 1-2 (PSI-39)"},
    },
    "c-0105": {
        "inv": "CFI",
        "text": "Cool-flame-supported quasi-steady droplet combustion was first observed on ISS in the Combustion Integrated Rack with n-alkane fuels (initially discovered during FLEX before detailed study in CFI).",
        "quote": "Cool-flame-supported quasi-steady droplet combustion was first observed during droplet combustion experiments conducted onboard the International Space Station (ISS) in the Combustion Integrated Rack (CIR) with n-alkane fuels.",
        "epistemicStatus": "observed",
        "conditionsScope": "ISS CIR / MDCA n-alkane droplet investigations (FLEX discovery, expanded in CFI)",
        "limitations": ["Initial ISS cool-flame observation occurred in FLEX (ntrs-20140006750 / ntrs-20160000344); attaching this sentence exclusively to CFI without noting FLEX misstates discovery provenance."],
        "locator": {"section": "Abstract (ntrs-20205008449)"},
    },
    "c-0109": {
        "inv": "ACME-BRE",
        "text": "ACME-BRE Objective 1 planned to examine NASA-considered spacecraft atmospheres (14.7 psia / 21% O2, 10.2 psia / 26.5% O2, and 8.2 psia / 34% O2) in long-duration microgravity.",
        "quote": "NASA - considered atmosphere for human space missions will be examined: 14.7 psia, 21 % oxygen: 10.2 psia, 26.5 %; and 8.2 psia, 34 % oxygen.",
        "epistemicStatus": "planned",
        "conditionsScope": "ACME-BRE (PSI-20) flight objective atmosphere targets",
        "limitations": ["Future-tense planned objective ('will be examined'); PSI-20 summary CSV reports test-day O2% (21-34%) without pressure telemetry per test."],
        "locator": {"section": "Objective 1 (PSI-20)"},
    },
    "c-0113": {
        "inv": "ACME-BRE",
        "text": "ACME-BRE Objective 1 aimed to observe CH4/N2 and C2H4/N2 mixtures on 25 and 50 mm porous circular burners in long-duration microgravity.",
        "quote": "Observe burning behavior in long-duration microgravity for CH4/N2 and C2H4/N2mixtures on porous circular burners of 25 and 50 mm diameter.",
        "epistemicStatus": "planned",
        "conditionsScope": "ACME-BRE (PSI-20) planned ISS flight burner objective vs 5.2-s drop-tower tests (ntrs-20160010073)",
        "limitations": ["PSI-20 states this as a flight objective rather than a confirmed flown test log; 25 and 50 mm burners were first tested in NASA 5.2-s drop-tower tests (ntrs-20160010073) and later logged in PSI-20 daily tables."],
        "locator": {"section": "Objective 1 (PSI-20)"},
    },
}


def _classify_claim_epistemic(text: str, quote: str, inv: str | None) -> str:
    """Classify ClaimEpistemicStatus honestly from text/quote modality."""
    low = f"{text} {quote}".lower()
    if inv == "FLEX-2" or any(k in low for k in ("will be", "planned", "intended to", "was to quantify", "sought to", "aimed to", "expected to", "objective:", "overall objective")):
        if "hypothesis" in low or "hypothesiz" in low:
            return "hypothesis"
        return "planned"
    if any(k in low for k in ("hypothe", "proposed", "may want", "suggest", "assume", "simulation", "theoretical")):
        if "hypothe" in low:
            return "hypothesis"
        return "source_interpretation"
    if any(k in low for k in ("first observed", "confirmed", "found", "showed", "measured", "studied", "burned", "ranged", "occurred", "captured", "produced", "varied", "completed", "exceeded", "extinguished")):
        return "observed"
    return "source_interpretation"


def build_claims(
    legacy_claims: list[dict[str, Any]],
    tests: list[dict[str, Any]],
    source_map: dict[str, dict[str, Any]],
    cache_by_id: dict[str, dict[str, Any]],
) -> list[dict[str, Any]]:
    """Build all 145 verified/corrected Claim records with verbatim SourceRef validation."""
    test_ids_by_inv: dict[str, list[str]] = defaultdict(list)
    for t in tests:
        test_ids_by_inv[t["inv"]].append(t["testId"])

    out: list[dict[str, Any]] = []
    for raw in legacy_claims:
        cid = raw["id"]
        sid = raw["sourceId"]
        src_text = cache_by_id.get(sid, {}).get("text", "")
        fix = FIXED_CLAIMS_SPECS.get(cid)

        inv = fix["inv"] if fix else raw.get("inv")
        text = fix["text"] if fix else raw["text"]
        quote = fix["quote"] if fix else raw["quote"]

        if normalize_ws(quote) not in normalize_ws(src_text):
            raise ValueError(f"Claim {cid} quote failed verbatim check in source {sid}")

        epistemic = fix["epistemicStatus"] if fix else _classify_claim_epistemic(text, quote, inv)
        verif = "corrected" if fix else "quote_checked"
        conditions_scope = fix["conditionsScope"] if fix else (
            f"{inv} investigation conditions" if inv else "Cross-investigation spacecraft fire safety literature"
        )
        limitations = list(fix["limitations"]) if fix else []
        if inv == "FLEX-2" and not limitations:
            limitations.append("FLEX-2 is planned_only in PSI-68 with zero public flown individual test rows.")
        locator = fix["locator"] if fix else {"section": f"Source text ({sid})"}

        # Link up to 8 representative testIds from matching investigation when observed
        ev_ids: list[str] = []
        if epistemic == "observed" and inv and inv in test_ids_by_inv:
            ev_ids = test_ids_by_inv[inv][:6]

        src_ref = make_source_ref(
            sid,
            source_map,
            locator=locator,
            quote=quote,
            context=conditions_scope,
        )
        out.append({
            "id": cid,
            "inv": inv,
            "text": text,
            "epistemicStatus": epistemic,
            "evidenceIds": ev_ids,
            "conditionsScope": conditions_scope,
            "limitations": limitations,
            "verificationStatus": verif,
            "sourceRef": src_ref,
            "topics": list(raw.get("topic") or []),
        })
    return out


# ---------------------------------------------------------------------------
# Chunking & 64D TF-IDF + TruncatedSVD LSA index


def _chunk_text_report(
    text: str,
    report_tag: str,
    source_id: str,
    inv: str,
    source_map: dict[str, dict[str, Any]],
    file_hash: str | None,
    max_chars: int = 1600,
) -> list[dict[str, Any]]:
    """Split long technical reports along section headers while preserving sectionHeader & tableUnits."""
    lines = text.splitlines()
    sections: list[tuple[str, str]] = []
    cur_header = f"{source_id} Overview"
    cur_buf: list[str] = []

    header_re = re.compile(r"^(\d+(?:\.\d+)+)\s+[A-Z][A-Za-z0-9 ,\-’'()/]+$|^Table\s+\d+(?:\.\d+)*[.:]?")
    for ln in lines:
        s = ln.strip()
        if header_re.match(s) and len(s) < 110 and not s.endswith(".."):
            if len("\n".join(cur_buf).strip()) > 120:
                sections.append((cur_header, "\n".join(cur_buf).strip()))
                cur_buf = []
            cur_header = s
        cur_buf.append(ln)
    if cur_buf:
        sections.append((cur_header, "\n".join(cur_buf).strip()))

    chunks: list[dict[str, Any]] = []
    unit_re = re.compile(r"\b(mm/s|cm/s|mm\^?2/s|kPa|atm|psia|micron|µm|nm|mg/s|sccm|%vol|%\s*O2)\b", re.IGNORECASE)
    for idx_s, (hdr, body) in enumerate(sections):
        if len(body) < 80:
            continue
        # Sub-split long sections cleanly at paragraph boundaries
        for part_i in range(0, len(body), max_chars):
            piece = body[part_i : part_i + max_chars].strip()
            if len(piece) < 80 or len(re.findall(r"[a-z]{3,}", piece.lower())) < 8:
                continue
            units_found = sorted(set(m.group(0) for m in unit_re.finditer(piece)))
            table_units = ", ".join(units_found) if units_found else None
            full_text = f"[{hdr}]" + (f" [Units: {table_units}]" if table_units else "") + "\n" + piece
            chunks.append({
                "chunkId": f"chk-{report_tag}-{idx_s}-{part_i // max_chars}",
                "kind": "report_section",
                "inv": inv,
                "testId": None,
                "epistemicStatus": "observed",
                "sectionHeader": hdr,
                "tableUnits": table_units,
                "text": full_text,
                "sourceRef": make_source_ref(
                    source_id, source_map, file_hash=file_hash,
                    locator={"section": hdr}, quote=piece[:240], context=hdr,
                ),
            })
    return chunks


def _format_test_chunk(t: dict[str, Any]) -> dict[str, Any]:
    """Create a concise, unit-explicit chunk for a single Test record."""
    tid = t["testId"]
    inv = t["inv"]
    o2 = t["atmosphere"]["o2"]
    pres = t["atmosphere"]["pressure"]
    flow = t["flow"]
    grav = t["gravity"]
    seg_summary = "; ".join(f"S{s['order']}[{s['stageType']}/{s['intervention']}@{s['flowCmS']['value']}cm/s]: {s['description']}" for s in t["segments"])
    evt_summary = "; ".join(f"{e['endpoint']}={e['observedValue']['value']} {e['observedValue']['unit']}" for e in t["events"])
    header = f"{inv} {tid} ({t.get('fuel')}, {t.get('geometry')})"
    table_units = "O2 %vol, pressure kPa, flow cm/s, thickness mm, diameter mm, spread mm/s, k mm^2/s, size nm"
    txt = (
        f"[{header}] [Units: {table_units}]\n"
        f"series={t['seriesId']} group={t['groupId']} fuel={t.get('fuel')} phase={t.get('fuelPhase')} "
        f"geometry={t.get('geometry')} thickness={t['thicknessMm']['value']}mm diameter={t['diameterMm']['value']}mm "
        f"width={t['widthCm']['value']}cm confinement={t.get('substrateConfinement')} | "
        f"O2={o2['value']}% (role={o2.get('role')}, prov={o2['provenance']}) P={pres['value']}kPa (prov={pres['provenance']}) "
        f"diluent={t['atmosphere'].get('diluent')} {t['atmosphere']['diluentPct']['value']}% | "
        f"flow0={flow['initialFlowCmS']['value']}cm/s dir={flow['direction']} history={flow['history']} seq={flow.get('sequenceCmS')} | "
        f"gravity={grav['gravityG']['value']}g {grav['regime']} {grav['platform']} mode={grav['mode']} | "
        f"initialOutcome={t['initialOutcome']} terminalEvent={t['terminalEvent']} | "
        f"segments: {seg_summary} | events: {evt_summary}"
    )
    return {
        "chunkId": f"chk-test-{tid}",
        "kind": "test_protocol",
        "inv": inv,
        "testId": tid,
        "epistemicStatus": "observed",
        "sectionHeader": header,
        "tableUnits": table_units,
        "text": txt,
        "sourceRef": t.get("observationSourceRef") or t["sourceRef"],
    }


def build_chunks_and_lsa(
    investigations: list[dict[str, Any]],
    tests: list[dict[str, Any]],
    claims: list[dict[str, Any]],
    sources_cache: list[dict[str, Any]],
    source_map: dict[str, dict[str, Any]],
    by_basename: dict[str, str],
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Build chunks with headers/units and compute TF-IDF + 64D SVD L2-normalized LSA vectors."""
    chunks: list[dict[str, Any]] = []

    # 1. Investigation cards
    for inv in investigations:
        iid = inv["id"]
        src_id = (inv.get("psi") or "psi").lower()
        cond = inv.get("conditions") or {}
        units = "O2 %vol, pressure kPa, flow cm/s, gravity g"
        hdr = f"{iid} — {inv['name']}"
        txt = (
            f"[{hdr}] [Units: {units}]\n"
            f"epistemicStatus={inv['epistemicStatus']} verificationStatus={inv['verificationStatus']} "
            f"platform={inv.get('platform')} hardware={inv.get('hardware')} phase={inv.get('fuelPhase')}\n"
            f"Objective: {inv.get('objective')}\nMethod: {inv['methodSummary']}\n"
            f"Conditions: O2={cond.get('o2Pct')}% P={cond.get('pressureKpa')}kPa flow={cond.get('flowCmS')}cm/s "
            f"diluents={cond.get('diluents')} assumed={cond.get('assumed')}\n"
            f"Results: {inv.get('resultSummary')}\nLimitations: {' | '.join(inv['limitations'])}\n"
            f"Coverage: {inv['coverageSummary']['completenessNote']}"
        )
        chunks.append({
            "chunkId": f"chk-inv-{iid}",
            "kind": "investigation",
            "inv": iid,
            "testId": None,
            "epistemicStatus": inv["epistemicStatus"],
            "sectionHeader": hdr,
            "tableUnits": units,
            "text": txt,
            "sourceRef": make_source_ref(src_id, source_map, locator={"section": "Investigation Card"}, context=hdr),
        })

    # 2. Claims
    for c in claims:
        hdr = f"Claim {c['id']} ({c.get('inv') or 'Cross-Investigation'}, {c['epistemicStatus']})"
        txt = (
            f"[{hdr}]\nClaim: {c['text']}\nQuote: {c['sourceRef'].get('quote')}\n"
            f"Scope: {c['conditionsScope']}\nLimitations: {' ; '.join(c['limitations'])}"
        )
        chunks.append({
            "chunkId": f"chk-claim-{c['id']}",
            "kind": "claim",
            "inv": c.get("inv"),
            "testId": None,
            "epistemicStatus": c["epistemicStatus"],
            "sectionHeader": hdr,
            "tableUnits": None,
            "text": txt,
            "sourceRef": c["sourceRef"],
        })

    # 3. Cached sources (PSI & NTRS abstracts)
    for s in sources_cache:
        sid = s["sourceId"]
        raw_txt = (s.get("text") or "").strip()
        if not raw_txt:
            continue
        title = source_map.get(sid, {}).get("title") or sid
        raw_inv = s.get("inv")
        inv_list = raw_inv if isinstance(raw_inv, list) else ([raw_inv] if raw_inv else [])
        inv_val = inv_list[0] if len(inv_list) == 1 else (", ".join(inv_list) if inv_list else None)
        ep = "planned" if "FLEX-2" in inv_list else "observed"
        chunks.append({
            "chunkId": f"chk-src-{sid}",
            "kind": "source_abstract",
            "inv": inv_val,
            "testId": None,
            "epistemicStatus": ep,
            "sectionHeader": f"Primary Source {sid}: {title}",
            "tableUnits": None,
            "text": f"[Primary Source {sid}: {title}]\n{raw_txt[:3500]}",
            "sourceRef": make_source_ref(sid, source_map, locator={"section": "Source Text"}, quote=raw_txt[:220], context=title),
        })

    # 4. Full reports: NASA/TM-20210011385, SPICE Final Report, SPICE Dotson Thesis
    tm_path = RAW_DIR / "ntrs" / "TM-20210011385.txt"
    if tm_path.exists():
        chunks.extend(_chunk_text_report(
            tm_path.read_text(encoding="utf-8", errors="ignore"),
            "tm2021", "ntrs-20210011385", "BASS-II", source_map, by_basename.get(tm_path.name),
        ))
    spice_rep = RAW_DIR / "PSI-107" / "PSI-107_Reports_SPICE_FinalReport.txt"
    if spice_rep.exists():
        chunks.extend(_chunk_text_report(
            spice_rep.read_text(encoding="utf-8", errors="ignore"),
            "spice-final", "psi-107", "SPICE", source_map, by_basename.get(spice_rep.name),
        ))
    dotson_rep = RAW_DIR / "PSI-107" / "PSI-107_Reports_SMOKE POINTS OF MICROGRAVITY AND  NORMAL GRAVITY COFLOW DIFFUSION  FLAMES_DotsonThesis.txt"
    if dotson_rep.exists():
        chunks.extend(_chunk_text_report(
            dotson_rep.read_text(encoding="utf-8", errors="ignore"),
            "spice-dotson", "psi-107", "SPICE", source_map, by_basename.get(dotson_rep.name),
        ))

    # 5. FLEX-2 planned experimental table (PSI-68)
    flex2_csv = RAW_DIR / "PSI-68" / "PSI-68_Experimental table_Flex2.csv"
    if flex2_csv.exists():
        csv_txt = flex2_csv.read_text(encoding="utf-8", errors="ignore").strip()
        chunks.append({
            "chunkId": "chk-planned-flex2-matrix",
            "kind": "planned_table",
            "inv": "FLEX-2",
            "testId": None,
            "epistemicStatus": "planned",
            "sectionHeader": "FLEX-2 Planned Experimental Test Matrix (PSI-68)",
            "tableUnits": "Initial Droplet Diameter (mm), Oxygen Mole Fraction, Ambient Pressure (atm), Ambient Temperature (C), Flow Velocity (cm/s)",
            "text": f"[FLEX-2 Planned Experimental Test Matrix (PSI-68)] [Units: mm, mole fraction, atm, C, cm/s]\n{csv_txt}",
            "sourceRef": make_source_ref(
                "psi-68", source_map, file_hash=by_basename.get(flex2_csv.name),
                locator={"table": flex2_csv.name}, quote=csv_txt.splitlines()[0], context="Planned matrix only — no flown outcomes",
            ),
        })

    # 6. All 1,678 Test protocol chunks
    for t in tests:
        chunks.append(_format_test_chunk(t))

    # Fit TF-IDF + TruncatedSVD 64D LSA
    texts = [c["text"] for c in chunks]
    vec = TfidfVectorizer(max_features=1600, ngram_range=(1, 2), stop_words="english", lowercase=True)
    x_tfidf = vec.fit_transform(texts)
    svd = TruncatedSVD(n_components=EMBEDDING_DIM, random_state=42)
    x_lsa = svd.fit_transform(x_tfidf)
    x_norm = normalize(x_lsa, norm="l2", axis=1)

    for idx_c, chunk in enumerate(chunks):
        chunk["vector"] = [round(float(x), 6) for x in x_norm[idx_c]]

    lsa_index = {
        "corpusVersion": CORPUS_VERSION,
        "embeddingModel": EMBEDDING_MODEL,
        "embeddingDim": EMBEDDING_DIM,
        "vocabulary": {str(k): int(v) for k, v in sorted(vec.vocabulary_.items())},
        "idf": [round(float(x), 6) for x in vec.idf_],
        "svdComponents": [[round(float(val), 5) for val in row] for row in svd.components_],
        "chunks": chunks,
    }
    return chunks, lsa_index


# ---------------------------------------------------------------------------
# SQLite export


def write_sqlite_db(
    db_path: Path,
    sources: list[dict[str, Any]],
    investigations: list[dict[str, Any]],
    tests: list[dict[str, Any]],
    claims: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
) -> None:
    """Create normalized, indexed SQLite database via atomic file replacement."""
    db_path.parent.mkdir(parents=True, exist_ok=True)
    tmp_db = db_path.with_suffix(".sqlite.tmp")
    if tmp_db.exists():
        tmp_db.unlink()

    conn = sqlite3.connect(str(tmp_db))
    conn.execute("PRAGMA foreign_keys = ON;")
    cur = conn.cursor()

    cur.executescript("""
    CREATE TABLE sources (
        source_id TEXT PRIMARY KEY,
        title TEXT,
        url TEXT,
        doi TEXT,
        type TEXT,
        file_hash TEXT,
        notes TEXT,
        json TEXT NOT NULL
    );

    CREATE TABLE investigations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        psi TEXT,
        doi TEXT,
        family TEXT,
        platform TEXT,
        fuel_phase TEXT,
        epistemic_status TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        n_tests INTEGER,
        total_rows INTEGER NOT NULL,
        with_observed_outcome INTEGER NOT NULL,
        with_numeric_target INTEGER NOT NULL,
        with_protocol_segments INTEGER NOT NULL,
        method_summary TEXT,
        json TEXT NOT NULL
    );

    CREATE TABLE tests (
        test_id TEXT PRIMARY KEY,
        inv TEXT NOT NULL REFERENCES investigations(id),
        series_id TEXT,
        sample_id TEXT,
        group_id TEXT NOT NULL,
        fuel TEXT,
        fuel_phase TEXT,
        geometry TEXT,
        thickness_mm REAL,
        diameter_mm REAL,
        width_cm REAL,
        substrate_confinement TEXT,
        orientation TEXT,
        o2_pct REAL,
        o2_role TEXT NOT NULL,
        o2_provenance TEXT NOT NULL,
        pressure_kpa REAL,
        pressure_provenance TEXT NOT NULL,
        diluent TEXT,
        diluent_pct REAL,
        initial_flow_cm_s REAL,
        flow_direction TEXT NOT NULL,
        flow_history TEXT NOT NULL,
        gravity_g REAL,
        gravity_regime TEXT NOT NULL,
        gravity_platform TEXT NOT NULL,
        gravity_mode TEXT NOT NULL,
        initial_outcome TEXT NOT NULL,
        terminal_event TEXT,
        outcome_raw TEXT,
        spread_rate_mm_s REAL,
        burning_rate_mm2_s REAL,
        particle_size_nm REAL,
        smoke_point_length_mm REAL,
        source_id TEXT,
        source_file_hash TEXT,
        json TEXT NOT NULL
    );

    CREATE TABLE protocol_segments (
        segment_id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL REFERENCES tests(test_id),
        segment_order INTEGER NOT NULL,
        time_start_s REAL,
        time_end_s REAL,
        stage_type TEXT NOT NULL,
        description TEXT NOT NULL,
        flow_cm_s REAL,
        o2_pct REAL,
        pressure_kpa REAL,
        intervention TEXT NOT NULL,
        source_id TEXT,
        json TEXT NOT NULL
    );

    CREATE TABLE events (
        id TEXT PRIMARY KEY,
        test_id TEXT NOT NULL REFERENCES tests(test_id),
        segment_id TEXT NOT NULL REFERENCES protocol_segments(segment_id),
        endpoint TEXT NOT NULL,
        event_type TEXT NOT NULL,
        observed_value_num REAL,
        observed_value_text TEXT,
        observed_unit TEXT,
        sensor_or_method TEXT,
        source_id TEXT,
        json TEXT NOT NULL
    );

    CREATE TABLE claims (
        id TEXT PRIMARY KEY,
        inv TEXT,
        text TEXT NOT NULL,
        epistemic_status TEXT NOT NULL,
        verification_status TEXT NOT NULL,
        conditions_scope TEXT,
        source_id TEXT,
        quote TEXT,
        json TEXT NOT NULL
    );

    CREATE TABLE chunks (
        chunk_id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        inv TEXT,
        test_id TEXT,
        epistemic_status TEXT NOT NULL,
        section_header TEXT,
        table_units TEXT,
        text TEXT NOT NULL,
        source_id TEXT,
        vector_json TEXT NOT NULL,
        json TEXT NOT NULL
    );

    CREATE INDEX idx_tests_inv ON tests(inv);
    CREATE INDEX idx_tests_group ON tests(group_id);
    CREATE INDEX idx_tests_o2_role ON tests(o2_role);
    CREATE INDEX idx_segments_test ON protocol_segments(test_id);
    CREATE INDEX idx_events_test ON events(test_id);
    CREATE INDEX idx_events_endpoint ON events(endpoint);
    CREATE INDEX idx_claims_inv ON claims(inv);
    CREATE INDEX idx_chunks_inv ON chunks(inv);
    CREATE INDEX idx_chunks_test ON chunks(test_id);
    """)

    cur.executemany(
        "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (s["sourceId"], s.get("title"), s.get("url"), s.get("doi"), s.get("type"), s.get("fileHash"), s.get("notes"), json.dumps(s, ensure_ascii=False))
            for s in sources
        ],
    )
    cur.executemany(
        "INSERT INTO investigations VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                i["id"], i["name"], i.get("psi"), i.get("doi"), i.get("family"), i.get("platform"),
                i.get("fuelPhase"), i["epistemicStatus"], i["verificationStatus"], i.get("nTests"),
                i["coverageSummary"]["totalRows"], i["coverageSummary"]["withObservedOutcome"],
                i["coverageSummary"]["withNumericTarget"], i["coverageSummary"]["withProtocolSegments"],
                i["methodSummary"], json.dumps(i, ensure_ascii=False),
            )
            for i in investigations
        ],
    )
    cur.executemany(
        "INSERT INTO tests VALUES (" + ",".join(["?"] * 37) + ")",
        [
            (
                t["testId"], t["inv"], t["seriesId"], t["sampleId"], t["groupId"],
                t.get("fuel"), t.get("fuelPhase"), t.get("geometry"),
                t["thicknessMm"]["value"], t["diameterMm"]["value"], t["widthCm"]["value"],
                t.get("substrateConfinement"), t.get("orientation"),
                t["atmosphere"]["o2"]["value"], t["atmosphere"]["o2"].get("role", "ambient"),
                t["atmosphere"]["o2"]["provenance"],
                t["atmosphere"]["pressure"]["value"], t["atmosphere"]["pressure"]["provenance"],
                t["atmosphere"].get("diluent"), t["atmosphere"]["diluentPct"]["value"],
                t["flow"]["initialFlowCmS"]["value"], t["flow"]["direction"], t["flow"]["history"],
                t["gravity"]["gravityG"]["value"], t["gravity"]["regime"], t["gravity"]["platform"], t["gravity"]["mode"],
                t["initialOutcome"], t.get("terminalEvent"), t.get("outcomeRaw"),
                t["spreadRateMmS"]["value"], t["burningRateMm2S"]["value"],
                t["particleSizeNm"]["value"], t["smokePointLengthMm"]["value"],
                t["sourceRef"].get("sourceId"), t["sourceRef"].get("fileHash"),
                json.dumps(t, ensure_ascii=False),
            )
            for t in tests
        ],
    )

    seg_rows = []
    evt_rows = []
    for t in tests:
        for s in t["segments"]:
            seg_rows.append((
                s["segmentId"], s["testId"], s["order"], s["timeStartS"], s["timeEndS"],
                s["stageType"], s["description"], s["flowCmS"]["value"], s["o2Pct"]["value"],
                s["pressureKpa"]["value"], s["intervention"], s["sourceRef"].get("sourceId"),
                json.dumps(s, ensure_ascii=False),
            ))
        for e in t["events"]:
            ov = e["observedValue"]["value"]
            ov_num = float(ov) if isinstance(ov, (int, float)) else None
            ov_txt = None if isinstance(ov, (int, float)) or ov is None else str(ov)
            evt_rows.append((
                e["id"], e["testId"], e["segmentId"], e["endpoint"], e["eventType"],
                ov_num, ov_txt, e["observedValue"]["unit"], e.get("sensorOrMethod"),
                e["sourceRef"].get("sourceId"), json.dumps(e, ensure_ascii=False),
            ))
    cur.executemany("INSERT INTO protocol_segments VALUES (" + ",".join(["?"] * 13) + ")", seg_rows)
    cur.executemany("INSERT INTO events VALUES (" + ",".join(["?"] * 11) + ")", evt_rows)

    cur.executemany(
        "INSERT INTO claims VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                c["id"], c.get("inv"), c["text"], c["epistemicStatus"], c["verificationStatus"],
                c["conditionsScope"], c["sourceRef"].get("sourceId"), c["sourceRef"].get("quote"),
                json.dumps(c, ensure_ascii=False),
            )
            for c in claims
        ],
    )
    cur.executemany(
        "INSERT INTO chunks VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        [
            (
                ch["chunkId"], ch["kind"], ch.get("inv"), ch.get("testId"), ch["epistemicStatus"],
                ch.get("sectionHeader"), ch.get("tableUnits"), ch["text"],
                ch["sourceRef"].get("sourceId"), json.dumps(ch["vector"]),
                json.dumps(ch, ensure_ascii=False),
            )
            for ch in chunks
        ],
    )

    conn.commit()
    conn.close()
    os.replace(tmp_db, db_path)


# ---------------------------------------------------------------------------
# Main pipeline orchestrator


def build_all() -> dict[str, Any]:
    """Run full idempotent EMBER v2 corpus build."""
    generated_at = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    raw_info, by_basename = index_raw_files()
    sources_cache = load_json(DATA_DIR / "sources_cache.json")
    invs_seed = load_json(SEED_DIR / "investigations.json")
    tests_seed = load_json(SEED_DIR / "tests.json")
    claims_seed = load_json(SEED_DIR / "claims.json")
    missions_seed = load_json(SEED_DIR / "missions.json")
    earth_seed = load_json(SEED_DIR / "earth.json")
    history_seed = load_json(SEED_DIR / "history.json")
    extraction_eval = load_json(SEED_DIR / "extraction_eval.json")
    outcome_audit = load_json(SEED_DIR / "outcome_audit.json")
    appA = load_json(RAW_DIR / "ntrs" / "TM-20210011385_appendixA.json")
    appA_by_id = {r["testId"]: r for r in appA.get("rows", []) if r.get("testId")}

    sources, source_map, cache_by_id = build_sources_registry(sources_cache, invs_seed, raw_info, by_basename)
    tests = reconstruct_all_tests(tests_seed, source_map, by_basename, appA_by_id)
    investigations = build_investigations(invs_seed, tests)
    claims = build_claims(claims_seed, tests, source_map, cache_by_id)

    corpus_v2 = {
        "corpusVersion": CORPUS_VERSION,
        "generatedAt": generated_at,
        "investigations": investigations,
        "tests": tests,
        "claims": claims,
        "missions": missions_seed,
        "earth": earth_seed,
        "history": history_seed,
        "sources": sources,
        "extractionEval": extraction_eval,
        "outcomeAudit": outcome_audit,
    }
    write_json_atomic(OUT_CORPUS, corpus_v2)

    chunks, lsa_index = build_chunks_and_lsa(investigations, tests, claims, sources_cache, source_map, by_basename)
    write_json_atomic(OUT_CHUNKS, lsa_index)

    write_sqlite_db(OUT_SQLITE, sources, investigations, tests, claims, chunks)

    # Manifest written last with exact SHA-256 of generated outputs + raw files
    n_segs = sum(len(t["segments"]) for t in tests)
    n_evts = sum(len(t["events"]) for t in tests)
    manifest = {
        "corpusVersion": CORPUS_VERSION,
        "generatedAt": generated_at,
        "generator": "pipeline/build_corpus.py",
        "counts": {
            "investigations": len(investigations),
            "tests": len(tests),
            "protocolSegments": n_segs,
            "events": n_evts,
            "claims": len(claims),
            "chunks": len(chunks),
            "sources": len(sources),
            "missions": len(missions_seed),
            "earth": len(earth_seed),
            "history": len(history_seed),
            "groups": len({t["groupId"] for t in tests}),
        },
        "coverage": {
            "plannedOnlyInvestigations": [i["id"] for i in investigations if i["epistemicStatus"] == "planned_only"],
            "testsWithObservedOutcome": sum(i["coverageSummary"]["withObservedOutcome"] for i in investigations),
            "testsWithNumericTarget": sum(i["coverageSummary"]["withNumericTarget"] for i in investigations),
            "testsWithProtocolSegments": sum(i["coverageSummary"]["withProtocolSegments"] for i in investigations),
            "testsWithCoolFlameContinuation": sum(1 for t in tests if any(e["endpoint"] == "cool_flame_continuation" for e in t["events"])),
            "inverseFlameOxidizerStreamCount": sum(1 for t in tests if t["atmosphere"]["o2"].get("role") == "oxidizer_stream"),
            "assumedAtmosphereCount": sum(1 for t in tests if t["atmosphere"]["o2"]["provenance"] == "assumed"),
            "byInvestigation": {i["id"]: i["coverageSummary"] for i in investigations},
        },
        "generatedFiles": {
            p.relative_to(ROOT).as_posix(): {"sha256": sha256_file(p), "bytes": p.stat().st_size}
            for p in (OUT_CORPUS, OUT_CHUNKS, OUT_SQLITE)
        },
        "rawFiles": raw_info,
    }
    write_json_atomic(OUT_MANIFEST, manifest, indent=2)
    return manifest


if __name__ == "__main__":
    summary = build_all()
    print(json.dumps(summary["counts"], indent=2))
