#!/usr/bin/env python3
"""Normalize raw PSI downloads (data/raw/PSI-NN) into the EMBER JSON contract.

Outputs (see docs/archive/DATA_CONTRACT.md):
  data/legacy_seed/tests.json
  data/legacy_seed/investigations.json
  data/legacy_seed/datasets_manifest.json

Rules: values are only taken from source files; anything unknown is null and
explained in the investigation's dataNotes. Every source column that is not
mapped to a contract field is kept verbatim in `extra`.

Usage: python3 pipeline/seed/build_dataset.py   (after pipeline/seed/fetch_psi.py)
"""
import csv, datetime, hashlib, io, json, math, re, sys
from pathlib import Path
from urllib.parse import quote

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cards import CARDS  # noqa: E402  hand-curated card text (with sources)

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "legacy_seed"

ATM_KPA = 101.325
MMHG_KPA = 0.1333224
INCH_MM = 25.4

# --------------------------------------------------------------------------- helpers

def read_csv(path, encoding=None):
    raw = Path(path).read_bytes()
    for enc in ([encoding] if encoding else []) + ["utf-8-sig", "cp1252"]:
        try:
            text = raw.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    rows = list(csv.reader(io.StringIO(text)))
    header = [h.strip() for h in rows[0]]
    out = []
    for i, r in enumerate(rows[1:], start=2):  # spreadsheet row number (header = 1)
        r = r + [""] * (len(header) - len(r))
        out.append((i, {header[j]: r[j].strip() for j in range(len(header))}))
    return header, out


def num(s):
    """Parse a plain number; returns None for blanks, dashes, n/a, text."""
    if s is None:
        return None
    if isinstance(s, (int, float)):
        return None if (isinstance(s, float) and math.isnan(s)) else float(s)
    s = str(s).strip().replace("–", "").replace("—", "")
    if s in ("", "-", "n/a", "N/A", "none", "?"):
        return None
    try:
        v = float(s)
    except ValueError:
        return None
    return None if math.isnan(v) else v


def first_num(s):
    m = re.search(r"-?\d+(?:\.\d+)?|-?\.\d+", str(s or ""))
    return float(m.group(0)) if m else None


def r3(x, n=3):
    return None if x is None else round(x, n)


def blank_extra(d, used):
    return {k: v for k, v in d.items() if k not in used and v not in ("", None)}


def row(inv, test_id, src_id, file, rownum, **kw):
    base = dict(inv=inv, testId=test_id, fuel=None, fuelPhase=None, geometry=None,
                thicknessMm=None, diameterMm=None, o2Pct=None, pressureKpa=None,
                flowCmS=None, gravityG=0, diluent=None, diluentPct=None,
                outcome="unknown", outcomeRaw=None, spreadRateMmS=None,
                burningRateMm2S=None, particleSizeNm=None, smokePointLengthMm=None, extra={})
    base.update(kw)
    base["source"] = {"sourceId": src_id, "file": file, "row": rownum}
    return base


def psi_file(psi, name):
    return RAW / psi / name


NOTES = {}      # inv -> list of data notes discovered while parsing
FILES_USED = []  # (inv, path, rows)


def note(inv, text):
    NOTES.setdefault(inv, [])
    if text not in NOTES[inv]:
        NOTES[inv].append(text)


# --------------------------------------------------------------------------- shared outcome semantics (BASS, BASS-II)
#
# For the solid-material duct tests (BASS, BASS-II) a test usually ran like this: ignite at the
# initial flow, let the flame spread, then step the flow up (blow-off attempt) or down until the flame
# quenched, or turn the flow off. `outcome` therefore describes what happened AT THE ROW'S STATED
# CONDITIONS (initial O2, initial flow): did a flame establish itself and burn/spread there?
#   flame_spread / burned  - flame established and sustained (spread explicitly reported -> flame_spread)
#   self_extinguished      - only a brief flame that did not sustain / did not spread
#   no_ignition            - the material did not ignite (igniter failures are NOT counted -> unknown)
# How the test ended is kept separately in extra.terminalEvent:
#   blowoff | extinguished_at_reduced_flow | flow_turned_off | burned_out | extinguished_by_N2 |
#   self_extinguished | no_ignition | null (not reported)

def _strip_negated(t):
    """Remove negated phrases so 'did not blow off' is not read as a blow-off etc."""
    t = re.sub(r"(did not|didn't|not|never|without success[^,;.]*|no joy[^,;.]*?|would not|could not)\s+(?:completely\s+|quite\s+)?"
               r"(blow ?out|blow ?off|blowoff|extinguish\w*|go out|went out|reach)", " ", t)
    t = re.sub(r"tried (to )?blow ?off[^,;.]*(but did not|without success)", " ", t)
    t = re.sub(r"no blowoff( attained)?|tr(y|ied) (and |to )?blow ?(out|off)[^,;.]*", " ", t)
    return t


def terminal_event(text):
    t = _strip_negated((text or "").lower())
    # partial blow-outs (stagnation region, one half, leading edge only) are not the end of the test
    t = re.sub(r"(blew|blow) (out|off) (the )?(stag\w*( region| zone)?|bottom half|top half|leading edge)|"
               r"(stag\w*|stagnation region|leading edge|bottom half)( \(le\))? (gradually )?(blew|blow) (out|off)", " ", t)
    if re.search(r"blew out|blow ?out|blow ?off|blowoff|blew off|blow-off", t):
        if re.search(r"(n2|gn2)[^.;]{0,40}(blew|blow)|(blew|blow)[^.;]{0,15}with gn2|with gn2", t):
            return "extinguished_by_N2"
        return "blowoff"
    if re.search(r"burned (the )?entire|burned completely|complete burnout|burned out|fuel is burned out|burn(ed)? full sample|"
                 r"whole sample|ran out of fuel|fuel ran out|sample mostly gone|fuel was consumed|burned to completion|out of wax|running out of wax", t):
        return "burned_out"
    if re.search(r"flow off|flow (is )?turned off|turn(ed)? off (the )?(flow|air|fan)|turned off flow|air off|fan off|flow to 0\b|pot turned to 0;|fan pot to 0\b|"
                 r"turning off flow|stepped to 0 flow|when (all )?flow stops|all flow stops", t):
        return "flow_turned_off"
    if re.search(r"quench|extinguish|extinction|flame out|went out|goes out|\bout at\b|died|self-extinguished|out on its own|"
                 r"winked out|flamed out|out immediately|\(flame out\)", t):
        return "extinguished_at_reduced_flow"
    return None


def classify_bass2_obs(text):
    """Outcome at the initial conditions from the TM Appendix A observation text (see block comment above)."""
    t = (text or "").lower().strip()
    if not t or set(t) <= {"-"}:
        return "unknown", None
    if re.search(r"did not ignite|no ignition", t):
        return "no_ignition", "no_ignition"
    if re.search(r"brief ignition|briefly flashed|only brief|would not sustain|no sustained flame|no joy on sustained|not sustain|"
                 r"would not stay lit|brief flames go out|^extinguished quickly|only stayed lit .{0,30}less than a minute|died immediately|"
                 r"did not spread at all|before spreading", t):
        return "self_extinguished", "self_extinguished"
    if re.search(r"spread|propagat|burned entire|burned completely|burn full sample|burned out|complete burnout|wrap", t):
        return "flame_spread", terminal_event(t)
    if re.search(r"burn|steady|stable|ignit|flame|blowoff|blew out|blow ?off|quench|extinction|extinguish|flamelet", t):
        return "burned", terminal_event(t)
    return "unknown", None


# Manual reading of observation cells the rules cannot interpret (TM-20210011385 Appendix A).
BASS2_OVERRIDES = {
    "B3": ("burned", None, "observation describes the flame colour at lower flows ('lower flow flames much more blue')"),
    "B4": ("burned", None, "observation describes the bubble layer left by the burning flame"),
    "B7": ("burned", None, "observation describes the bubble layer left by the burning flame"),
    "B12": ("burned", None, "observation describes the flame ('mostly blue, soot only on bottom')"),
    "P21b": ("unknown", None, "igniter broke during ignition attempts (equipment failure, not a material result)"),
    "T1": ("burned", None, "TM Table 7.1 lists T1 at 10 cm/s, 18.5 % O2 with no 'No ignition' flag; Appendix A cell only lists instruments"),
    "T2": ("burned", None, "observation refers to 'very late in the burn'"),
    "T6": ("burned", None, "'still did not extinguish' - flame persisted"),
    "T15": ("burned", None, "observation and TM Table 7.1 ('No blowoff') - flame persisted up to 29 cm/s"),
    "T17": ("burned", None, "'Tried to blowoff, but did not' / TM Table 7.1 'No blowoff'"),
}


def _tm_text():
    p = RAW / "ntrs" / "TM-20210011385.txt"
    return p.read_text(encoding="utf-8") if p.exists() else ""


def tm_table_5_1(txt):
    """TM-20210011385 Table 5.1 (Miller PMMA slabs): per-test velocities and spread rates."""
    out = {}
    i = txt.find("TABLE 5.1.")
    if i < 0:
        return out
    for line in txt[i:i + 4000].splitlines():
        m = re.match(r"^\s*(M\d+)\s+(\d)\s+([\d.]+)\s+(\d)\s+(.+?)\s{2,}(.+?)\s{2,}([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*$", line)
        if not m:
            continue
        vel = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", m.group(5))]
        rates = [float(x) for x in re.findall(r"\d*\.\d+|\d+", m.group(6))] if "not tracked" not in m.group(6).lower() else []
        out[m.group(1)] = {"thicknessMm": float(m.group(2)), "widthCm": float(m.group(3)), "sidesBurning": int(m.group(4)),
                           "velocitiesCmS": vel, "spreadRatesMmS": rates, "burnTimeMin": float(m.group(7)),
                           "initialO2": float(m.group(8)), "finalO2": float(m.group(9)), "raw": line.strip()}
    return out


def tm_table_7_1(txt):
    """TM-20210011385 Table 7.1 (T'ien SIBAL, concurrent flow): flow range, O2, comment per test."""
    out = {}
    i = txt.find("TABLE 7.1.")
    if i < 0:
        return out
    for line in txt[i:i + 5000].splitlines():
        m = re.match(r"^\s*GMT(\d+)-(T\d+[ab]?)\s+([\d.]+)\s+(.+?)\s{2,}([\d.]+)b?\s+(.*?)\s*$", line)
        if m and m.group(6).strip() != "BASS":   # 4 rows of the table are BASS (not BASS-II) tests
            out.setdefault(m.group(2), []).append({"gmt": int(m.group(1)), "widthCm": float(m.group(3)), "flowRaw": m.group(4).strip(),
                                                   "o2": float(m.group(5)), "comment": m.group(6).strip("- ").strip() or None})
    return out


def bass2():
    inv, psi, src = "BASS-II", "PSI-25", "psi-25"
    fname = "PSI-25_Experimental table_BASS-II.csv"
    _, rows = read_csv(psi_file(psi, fname))
    tm_path = RAW / "ntrs" / "TM-20210011385_appendixA.json"
    tm_rows = {r["testId"]: r for r in json.loads(tm_path.read_text())["rows"]} if tm_path.exists() else {}
    txt = _tm_text()
    t51, t71 = tm_table_5_1(txt), tm_table_7_1(txt)
    b1_quote = "steady spread rate of 2.2 mm/s, the flow was abruptly cut off"
    out, disc = [], []
    for rn, d in rows:
        tid = d["Test #"].strip()
        mat = d["Fuel Sample Material"]
        ml = mat.lower()
        fuel, geom, thick, dia, inferred = None, None, None, None, False
        if "sibal" in ml:
            fuel, geom = "SIBAL (cotton-fiberglass fabric)", "fabric sheet"
        elif "nomex" in ml:
            fuel, geom = "Nomex III", "fabric sheet"
        elif "candle" in ml:
            fuel, geom = "Japan wax candle", "candle"
        elif "spherical section" in ml:
            # ReadMe: "Also had 1 sample/2 tests with 4 cm pmma spherical section" (T'ien)
            fuel, geom, inferred = "PMMA", "spherical section", True
        elif "rod" in ml:
            fuel, geom = "PMMA", "cylinder (rod)"
            m = re.search(r'(\d+)/(\d+)\s*"?', mat) or re.search(r'(\d+)/(\d+)', mat)
            if m:
                dia = r3(int(m.group(1)) / int(m.group(2)) * INCH_MM)
            else:
                m = re.search(r'(\d*\.\d+)\s*"', mat)
                if m:
                    dia = r3(float(m.group(1)) * INCH_MM)
        else:  # films and slabs are all PMMA per ReadMe (Bhattacharjee films, Miller slabs)
            fuel = "PMMA"
            geom = "thin film" if ("film" in ml or "micron" in ml) else "slab"
            if "pmma" not in ml:
                inferred = True
        m = re.search(r"(\d+(?:\.\d+)?)\s*micron", ml)
        if m:
            thick = float(m.group(1)) / 1000
        else:
            m = re.search(r"(\d*\.?\d+)\s*mm", ml)
            if m and fuel == "PMMA" and geom != "cylinder (rod)":
                thick = float(m.group(1))
        air = d["Air display"]
        flow = None
        m = re.search(r"(\d+(?:\.\d+)?)\s*cm/s", air)
        if m:
            flow = float(m.group(1))
        elif re.match(r"^\s*\d", air):
            flow = first_num(air)
            par = re.search(r"\(([^)]*)\)", air)
            if flow is not None and flow >= 40 and par and first_num(par.group(1)) is not None:
                # fan-display values were typed into the air column; cm/s values are in parentheses (e.g. O13a)
                flow = first_num(par.group(1))
        used = {"Test #", "Fuel Sample Material", "Calibrated  initial O2 % by vol"}
        extra = blank_extra(d, used)
        extra["materialRaw"] = mat
        if inferred:
            extra["fuelInferredFrom"] = "BASS-II ReadMe (PI sample descriptions)"
        m = re.search(r"(\d+(?:\.\d+)?)\s*cm\s*(?:wide)?", ml)
        if m and geom != "cylinder (rod)" and geom != "spherical section":
            extra["sampleWidthCm"] = float(m.group(1))
        o2 = num(d["Calibrated  initial O2 % by vol"])
        spread = None
        # ---- outcome: TM-20210011385 Appendix A observation column (report), else PSI fan/air text (keyword rule)
        tm = tm_rows.get(tid)
        if tm:
            obs = tm["observations"]
            extra["tmObservations"] = obs or None
            extra["tmAppendixRef"] = f"NASA/TM-20210011385 Table {tm['table']} (PDF p. {tm['page']})"
            if tid in BASS2_OVERRIDES:
                outcome, term, why = BASS2_OVERRIDES[tid]
                extra["outcomeDerivation"] = "report"
                extra["outcomeNote"] = "manual reading of the TM observation cell: " + why
            else:
                outcome, term = classify_bass2_obs(obs)
                extra["outcomeDerivation"] = "report"
            oraw = obs[:240] if obs and set(obs) - {"-"} else None
            # discrepancies TM vs PSI table
            toks = tm["firstLineTokens"]
            if tid in toks:
                k = toks.index(tid)
                tm_sample = toks[k + 1] if k + 1 < len(toks) else None
                if tm_sample and tm_sample.lower() != d["Sample #"].strip().lower():
                    disc.append(f"{tid}: sample # TM '{tm_sample}' vs PSI '{d['Sample #'].strip()}'")
                tm_asrun = toks[k - 1] if k >= 1 and re.fullmatch(r"\d+", toks[k - 1]) else None
                if tm_asrun:
                    extra["asRunTestNo"] = int(tm_asrun)
            dm = re.match(r"\d+/\d+/(\d{2,4})$", toks[0]) if toks else None
            pm = re.match(r"\d+/\d+/(\d{2,4})$", d["Date"].strip())
            if dm and pm and int(dm.group(1)) % 100 != int(pm.group(1)) % 100:
                disc.append(f"{tid}: date TM {toks[0]} vs PSI {d['Date'].strip()}")
            if len(toks) >= 8:
                tm_o2 = num(toks[-8])
                if tm_o2 is not None and o2 is not None and abs(tm_o2 - o2) > 0.05:
                    disc.append(f"{tid}: calibrated initial O2 TM {tm_o2} vs PSI {o2}")
        else:
            txt_l = (d["Fan display"] + " | " + air).lower()
            if "no ign" in txt_l:
                outcome, oraw = "no_ignition", "no ignition"
            elif re.search(r"blowoff|blow off|\bext\b|extinguished|\bout\b|ext after", txt_l):
                outcome, oraw = "burned", f"PSI fan/air display: {d['Fan display'].strip()} | {air.strip()}"
            else:
                outcome, oraw = "unknown", None
            term = terminal_event(txt_l.replace("ext", "extinguished"))
            extra["outcomeDerivation"] = "keyword-rule"
            extra["outcomeNote"] = "not in TM-20210011385 (2016 test); a blow-off/extinction noted in the PSI fan/air columns implies a flame was present, otherwise unknown"
        extra["terminalEvent"] = term
        # ---- T'ien summary table (TM Table 7.1)
        if tid in t71:
            e = t71[tid][0]
            extra["tmTable7_1"] = {"flowCmS": e["flowRaw"], "o2Pct": e["o2"], "comment": e["comment"]}
            if e["comment"] and "no ignition" in e["comment"].lower() and outcome != "no_ignition":
                disc.append(f"{tid}: TM Table 7.1 says 'No ignition', Appendix A says '{(extra.get('tmObservations') or '')[:70]}' (kept {outcome})")
            if o2 is not None and abs(e["o2"] - o2) > 0.15:
                disc.append(f"{tid}: O2 TM Table 7.1 {e['o2']} vs PSI {o2}")
        # ---- spread rates
        if tid in t51:
            e = t51[tid]
            extra["tmTable5_1"] = {k: v for k, v in e.items() if k != "raw"}
            if e["spreadRatesMmS"]:
                spread = e["spreadRatesMmS"][0]
                extra["spreadRateFlowCmS"] = e["velocitiesCmS"][0] if e["velocitiesCmS"] else None
                extra["spreadRateSource"] = "NASA/TM-20210011385 Table 5.1 (first listed velocity / rate pair)"
            if thick is None:
                thick = e["thicknessMm"]
            if o2 is not None and abs(e["initialO2"] - o2) > 0.15:
                disc.append(f"{tid}: initial O2 TM Table 5.1 {e['initialO2']} vs PSI {o2}")
        if tid == "B1" and b1_quote in txt:
            spread = 2.2
            extra["spreadRateSource"] = "NASA/TM-20210011385 §2.1.2.1: 'In the first test ... 100-μm sample ... steady spread rate of 2.2 mm/s, the flow was abruptly cut off'"
        # ---- pressure (stated in the report, not tabulated)
        if tid.startswith("T"):
            extra["pressureSource"] = "NASA/TM-20210011385 §7 (T'ien SIBAL tests): 'Ambient pressure was 1 atm.'"
        else:
            extra["pressureSource"] = "NASA/TM-20210011385 §1 O2-consumption analysis: MSG work volume at 'pressure P = 1 atm' (not measured per test)"
        out.append(row(inv, f"BASS-II-{tid}", src, fname, rn, fuel=fuel, fuelPhase="solid",
                       geometry=geom, thicknessMm=thick, diameterMm=dia,
                       o2Pct=o2, pressureKpa=101.3, flowCmS=flow, diluent="N2",
                       outcome=outcome, outcomeRaw=oraw, spreadRateMmS=spread, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    if tm_path.exists():
        FILES_USED.append((inv, tm_path, sum(1 for t in out if "tmObservations" in t["extra"])))
    n_tm = sum(1 for t in out if "tmObservations" in t["extra"])
    note(inv, f"Outcome source: the 'Test observations and anomalies' column of NASA/TM-20210011385 Appendix A (Tables A.1–A.6), extracted with word coordinates by pipeline/seed/extract_tm_bass2.py into data/raw/ntrs/TM-20210011385_appendixA.json; joined on test number for {n_tm} of {len(out)} PSI rows. "
              "The 3 rows not in the TM (O20–O22, run in 2016) use the PSI fan/air text (extra.outcomeDerivation = 'keyword-rule').")
    note(inv, "Outcome semantics: the outcome is what happened at the row's stated (initial) O2 and flow — flame_spread/burned = a flame established and was sustained; self_extinguished = only a brief flame; no_ignition = material did not ignite. "
              "Most tests then stepped the flow down to quenching or up to blow-off; that end state is in extra.terminalEvent, not in outcome. Observation text is in extra.tmObservations; 10 cells needing interpretation were read manually (extra.outcomeNote starts with 'manual reading').")
    note(inv, "spreadRateMmS: Miller PMMA slab tests M1–M20 from TM Table 5.1 (first velocity/rate pair; all pairs in extra.tmTable5_1; M6 and M12 'Not tracked'), and B1 = 2.2 mm/s from TM §2.1.2.1. Other PIs report spread rates only in figures — not digitised.")
    note(inv, "pressureKpa = 101.3: the TM states 'Ambient pressure was 1 atm' for the T'ien tests and uses P = 1 atm for the MSG work volume in its O2-consumption analysis; the value is not measured per test (basis in extra.pressureSource).")
    note(inv, "flowCmS = first value of the 'Air display' column (duct flow speed in cm/s per the BASS-II ReadMe); flow was usually stepped during a test and the full sequence is kept in extra['Air display'].")
    note(inv, "o2Pct = 'Calibrated initial O2 % by vol'. Some 'final O2' values (e.g. 1.6, 0.6, 39.1, 40.4) are clearly sensor artefacts and are kept only in extra.")
    note(inv, "Rod diameters converted from inches (1/4\" = 6.35 mm, 3/8\" = 9.525 mm, 1/2\" = 12.7 mm). Rows T9 and T18 are dated 2018 in the PSI table (F4, T9, T10, T18 in the TM) although GMT 175 matches 2014 — kept as given in extra.")
    if disc:
        note(inv, f"{len(disc)} discrepancies between TM-20210011385 and the PSI table: " + "; ".join(disc) + ".")
    else:
        note(inv, "No sample-number or initial-O2 discrepancies were found between TM-20210011385 Appendix A and the PSI table.")
    return out


# --------------------------------------------------------------------------- BASS (PSI-26)

# As-Run observation cells the keyword rules cannot interpret (keyed by the first 60 characters of the cell)
BASS_OVERRIDES = {
    "Huge ignition kernel, then rest of video very dim.  1 cm wid": ("unknown", "manual review: only an ignition kernel and a very dim video are reported"),
}


def bass_obs_outcome(text):
    """Outcome at the initial conditions from the As-Run 'Test Observations' text (keyword rules).

    Same semantics as BASS-II (see the block comment above classify_bass2_obs). Returns
    (outcome, outcomeRaw, terminalEvent, note)."""
    raw = (text or "").strip()
    t = raw.lower()
    if not t:
        return "unknown", None, None, None
    persisted = re.search(r"did not blow (?:out|off)|didn't blow|no blowoff|did not extinguish|still did not extinguish|flame kept going", t)
    tn = _strip_negated(t)
    tn = re.sub(r"no spread|did not spread|didn't spread|not sustain for any spread|didn't propagate at all|did not propagate|"
                r"remove soot|soot clean\w*", " ", tn)
    igniter_fail = re.search(r"igniter (?:is |seems to have |was )?(?:broke|broken|failed)|igniter didn't work|broke before ignition|"
                             r"broke \d* ?igniters?|not enough fuel", t)
    strong_burn = re.search(r"spread|propagat|sooty|soot|wrap|envelope|engulfed|steady|stable|burn(?:ed)? (?:about |for )?~? ?\d+(?:\.\d+)? ?min|"
                            r"\d+ ?min(?:ute)? burn|long burn|good burn|nice burn|flame (?:grew|kept going|stabilized)|grew|burned out|"
                            r"burned to completion|burning laminar|ran out of fuel|consumed|~ ?\d+ s burn", tn) or persisted
    hard_brief = re.search(r"burned for only|died when igniter|did not sustain|not sustain|no luck keeping|winks? out|winked out|"
                           r"went out when igniter|didn't propagate at all|no spread|extinguished in ~? ?\d+ s|extinguished after \d+ s", t)
    soft_brief = re.search(r"brief(?:ly)? (?:ignition|flame)|ignited briefly|got a flame briefly|flamed out", t)
    own = re.search(r"self-extinguish|went out on its own|extinguished (?:all )?by itself", t)
    noign = re.search(r"no ignition|did not ignite|failed to ignite|no flame\b|just smoked|not even (?:much |any )?smoke|"
                      r"did not ignite but smoked|puff of smoke", t)
    nojoy = re.search(r"no joy", t)
    ign_pos = [m.start() for m in re.finditer(r"(?<!not )(?<!didn't )\b(?:ignit(?:ed|ion (?:at|in|took|was))|igniton|ign (?:at|in|took)|good ignition|flame lit|lit on)", t)]
    note = None
    if hard_brief:
        outcome = "self_extinguished"
    elif strong_burn:
        outcome = "flame_spread" if re.search(r"spread|propagat|wrap|engulfed|burned out|consumed|burned to completion", tn) else "burned"
    elif soft_brief or (own and not re.search(r"pot|fan|flow", t)):
        outcome = "self_extinguished"
    elif noign or (nojoy and not ign_pos):
        first = (noign or nojoy).start()
        if ign_pos and max(ign_pos) > first:
            outcome = "burned"          # e.g. 'did not ignite first 2 attempts ... ignited and was all blue'
        elif igniter_fail:
            outcome, note = "unknown", "no ignition because of igniter failure / sample set-up, not a material result"
        else:
            outcome = "no_ignition"
    elif igniter_fail and not ign_pos:
        outcome, note = "unknown", "igniter failure before ignition"
    elif re.search(r"burn|flame|ignit|extinguish|blew|blow|went out|out at", tn):
        outcome = "burned"
    else:
        outcome = "unknown"
    if raw_id_override := BASS_OVERRIDES.get(raw[:60]):
        outcome, note = raw_id_override
    if outcome in ("no_ignition", "self_extinguished"):
        term = outcome
    elif outcome == "unknown":
        term = None
    else:
        term = terminal_event(t)
    return outcome, raw[:240], term, note


def bass():
    inv, psi, src = "BASS", "PSI-26", "psi-26"
    fname = "PSI-26_Experimental table_BASS.csv"
    xname = "PSI-26_Science Documents_As Run_Test Matrix.xlsx"
    _, rows = read_csv(psi_file(psi, fname))
    wb = openpyxl.load_workbook(psi_file(psi, xname), data_only=True)
    ws = wb["as run matrix"]
    hdr = None
    asrun = {}
    for i, r in enumerate(ws.iter_rows(values_only=True), start=1):
        if r[2] == "As run test no.":
            hdr = [str(c).strip() if c is not None else f"col{j}" for j, c in enumerate(r)]
            continue
        if hdr is None or r[2] is None or r[3] is None:
            continue
        rec = dict(zip(hdr, r))
        key = (str(r[2]).strip(), str(r[3]).strip())
        asrun.setdefault(key, (i, rec))
    out, unmatched = [], 0
    for rn, d in rows:
        mat = d["Fuel Sample Material"]
        if not d["Test #"].strip():
            continue  # non-test row (e.g. "SOOT Cleaning") in the PSI table
        ml = mat.lower()
        geom, dia, fuel = None, None, None
        if "sibal" in ml:
            fuel, geom = "SIBAL (cotton-fiberglass fabric)", "fabric sheet"
        elif "nomex" in ml:
            fuel, geom = ("Nomex blend" if "blend" in ml else "Nomex III"), "fabric sheet"
        elif "ultem" in ml:
            fuel, geom = "Ultem", "sheet"
        elif "candle" in ml:
            fuel, geom = ("Japan wax candle" if "japan" in ml else "paraffin wax candle"), "candle"
        elif "wax" in ml:
            fuel, geom = "paraffin wax", "slab"
        elif "sphere" in ml:
            fuel, geom = "PMMA", "sphere"
        elif "slab" in ml:
            fuel, geom = "PMMA", "slab"
        elif "pmma" in ml:
            fuel, geom = "PMMA", None
        if geom == "sphere":
            m = re.search(r"(\d+(?:\.\d+)?)\s*cm", ml)
            if m:
                dia = float(m.group(1)) * 10
        key = (d["As Run Test #"].strip(), d["Test #"].strip())
        hit = asrun.get(key)
        extra = blank_extra(d, {"Fuel Sample Material"})
        extra["materialRaw"] = mat
        o2 = p = flow = None
        outcome, oraw = "unknown", None
        if hit:
            xrow, rec = hit
            o2v = num(rec.get("O2 % by volume"))
            o2 = r3(o2v * 100, 2) if o2v is not None and o2v < 1 else o2v
            pv = num(rec.get("pressure, atm"))
            p = r3(pv * ATM_KPA, 1) if pv is not None else None
            air = str(rec.get("Air display") or "")
            if re.match(r"^\s*\d", air):
                flow = first_num(air)
            obs_key = [k for k in rec if k.startswith("Test Observations")]
            obs = str(rec[obs_key[0]]) if obs_key and rec[obs_key[0]] else ""
            outcome, oraw, term, onote = bass_obs_outcome(obs)
            extra["asRunRow"] = xrow
            extra["airDisplayCmS"] = air or None
            extra["fanDisplay"] = str(rec.get("Fan display")) if rec.get("Fan display") is not None else None
            extra["observations"] = obs or None
            extra["CO2_mmHg"] = num(rec.get("CO2, mm Hg"))
            extra["GN2 Pot"] = rec.get("GN2 Pot")
            extra["outcomeDerivation"] = "keyword-rule"
            extra["outcomeNote"] = onote
            extra = {k: v for k, v in extra.items() if v not in (None, "", "None")}
            extra["terminalEvent"] = term
        else:
            unmatched += 1
        tid = d["Test #"].strip()
        out.append(row(inv, f"BASS-{d['As Run Test #'].strip()}-{tid}", src, fname, rn, fuel=fuel,
                       fuelPhase="solid", geometry=geom, diameterMm=dia, o2Pct=o2, pressureKpa=p,
                       flowCmS=flow, diluent="N2", outcome=outcome, outcomeRaw=oraw, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    FILES_USED.append((inv, psi_file(psi, xname), len(out) - unmatched))
    note(inv, "The PSI experimental table only lists date, test numbers and material. O2, pressure, duct flow and observations are joined from 'PSI-26_Science Documents_As Run_Test Matrix.xlsx' (sheet 'as run matrix') on (As Run Test #, Test #).")
    if unmatched:
        note(inv, f"{unmatched} PSI-table rows had no match in the As Run matrix; their conditions are null.")
    note(inv, "Outcome is derived by keyword rules (extra.outcomeDerivation = 'keyword-rule') from the free-text 'Test Observations' column of the As-Run matrix; outcomeRaw keeps the first 240 characters. "
              "No better per-test source exists in data/raw: the BASS final report listed on PSI (PSI-26_Reports_BASS_FinalReport.pdf) returns HTTP 404, and NASA/TM-20210011385 covers BASS-II only (its Table 7.1 lists 4 BASS SIBAL tests without outcomes).")
    note(inv, "Outcome semantics as for BASS-II: the outcome describes the row's initial O2/flow (flame established and sustained -> burned/flame_spread; brief flame only -> self_extinguished; material did not ignite -> no_ignition). "
              "How the test ended (flow reduced to quench, flow off, N2 blow-out, burn-out) is in extra.terminalEvent. Igniter failures are 'unknown', not no_ignition.")
    note(inv, "flowCmS = first value in 'Air display' (cm/s); flow was usually stepped during a test (full sequence in extra.airDisplayCmS). No spread-rate column exists.")
    note(inv, "O2 fraction (e.g. 0.221) converted to %, pressure converted from atm to kPa (x101.325).")
    return out


# --------------------------------------------------------------------------- Saffire

def saffire1():
    inv, psi, src = "Saffire-I", "PSI-98", "psi-98"
    fname = "PSI-98_Experimental table_SAFFIRE-1.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
        sid = d["Sample Number"]
        if not sid.startswith("S"):
            continue
        o2raw = d["Percent O2"]
        vals = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", o2raw)]
        o2 = r3(sum(vals) / len(vals), 2) if vals else None
        bt = num(d["Burn Time (s)"])
        extra = blank_extra(d, {"Sample Number", "Material", "Air Flow (cm/s)", "Percent O2"})
        extra["o2Raw"] = o2raw
        out.append(row(inv, f"Saffire-I-{sid}", src, fname, rn, fuel="SIBAL (cotton-fiberglass fabric)",
                       fuelPhase="solid", geometry=f"large fabric sheet, {d['Flow Direction'].strip().lower()} flow",
                       thicknessMm=None, o2Pct=o2, flowCmS=num(d["Air Flow (cm/s)"]), diluent="N2",
                       outcome="burned" if bt else "unknown",
                       outcomeRaw=f"burn time {d['Burn Time (s)']} s" if bt else None, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "Only 2 burn tests (S1 concurrent, S2 opposed); rows F1/F2 (pre-test flow visualisation) are not tests and are skipped.")
    note(inv, "PSI table header says 'Sample Thickness (cm) = 0.37'. The same SIBAL fabric is listed as 0.37 mm in Saffire-II, so the unit is doubtful; thicknessMm left null (raw value in extra).")
    note(inv, "PSI table gives length 40.6 cm and width 94 cm; PSI text describes the sample as ~0.94 m long and 0.4 m wide (columns appear swapped).")
    note(inv, "O2 given as a range (21.5–21.7) for S1: o2Pct is the midpoint; raw text in extra.o2Raw. Pressure not tabulated (null).")
    note(inv, "No spread rate in the PSI table. Outcome 'burned' is based on the reported burn time only.")
    return out


def saffire2():
    inv, psi, src = "Saffire-II", "PSI-99", "psi-99"
    fname = "PSI-99_Experimental table_SAFFIRE-2.csv"
    header, rows = read_csv(psi_file(psi, fname))
    # header has mojibake for mu ('?-g'); find columns by position
    ug_burn, ug_spread, g1_burn, g1_spread = header[11], header[12], header[13], header[14]
    out, last_mat = [], None
    for rn, d in rows:
        sid = d["Sample Number"]
        if not re.match(r"^2-\d", sid):
            continue
        mat = d["Material"]
        inferred = False
        if not mat:
            mat, inferred = last_mat, True
        last_mat = mat
        ml = (mat or "").lower()
        fuel = ("SIBAL (cotton-fiberglass fabric)" if "sibal" in ml else
                "PMMA + Nomex" if "nomex" in ml else "PMMA" if "pmma" in ml else
                "silicone" if "silicone" in ml else mat)
        th_raw = d["Samle Thickness"]
        thick = None
        m = re.match(r"^\s*(\d*\.?\d+)\s*(mm|cm)\s*$", th_raw)
        if m:
            v = m.group(1)
            if re.match(r"^0\d", v):  # '037 mm' typo -> 0.37
                v = "0." + v[1:]
            thick = float(v) * (10 if m.group(2) == "cm" else 1)
        o2v = first_num(d["Percent O2 (Note 1)"])
        sp = d[ug_spread]
        spread = None
        m = re.match(r"^\s*(\d+(?:\.\d+)?)\s*mm/s", sp)
        if m:
            spread = float(m.group(1))
        bt = d["Burn Time (s)"]
        if bt.lower().startswith("insignificant"):
            outcome = "self_extinguished"
        elif first_num(bt) is not None:
            outcome = "burned"
        else:
            outcome = "unknown"
        oraw = f"burn time: {bt}; ug burn length: {d[ug_burn]}"
        extra = blank_extra(d, {"Sample Number", "Material", "Air Flow (cm/s)", "Percent O2 (Note 1)"})
        extra = {("ug Burn Length" if k == ug_burn else "ug Spread Rate" if k == ug_spread else k): v for k, v in extra.items()}
        extra["o2Raw"] = d["Percent O2 (Note 1)"]
        extra["pressureSource"] = "ntrs-20200000557 (Saffire II run at 100 kPa)"
        if inferred:
            extra["materialInferred"] = "blank cell in PSI table; filled from the row above (merged cell in source)"
        out.append(row(inv, f"Saffire-II-{sid}", src, fname, rn, fuel=fuel, fuelPhase="solid",
                       geometry=f"5 x 29 cm sample, {d['Flow Direction'].strip().lower()} flow", thicknessMm=thick,
                       o2Pct=o2v, pressureKpa=100.0, flowCmS=first_num(d["Air Flow (cm/s)"]), diluent="N2",
                       outcome=outcome, outcomeRaw=oraw, spreadRateMmS=spread, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "9 samples on one card. Microgravity spread rate is given only for the two SIBAL samples (2.1 and 2.6 mm/s); 1-g comparison columns are kept in extra.")
    note(inv, "Thickness '037 mm' in the PSI table is read as 0.37 mm (typo). Sample 2-8 thickness 'See Fig. 5' -> null.")
    note(inv, "Material cells for 2-6 and 2-9 are blank in the PSI CSV (merged cells); filled from the row above and flagged in extra.materialInferred.")
    note(inv, "O2 is derived from measured CO2 production referenced to ISS initial O2 (PSI Note 1); for ranges the first (initial) value is used.")
    note(inv, "pressureKpa = 100 from NTRS 20200000557 ('Saffire II, on board the Cygnus spacecraft at 100 kPa'), not from the PSI table.")
    note(inv, "Silicone samples: burn time 'Insignificant' -> outcome self_extinguished. Thick PMMA (2-8, 2-9): flames stayed anchored at the base with regression 0.01–0.04 mm/s (PSI Note 4); spread rate null.")
    return out


def saffire3():
    inv, psi, src = "Saffire-III", "PSI-100", "psi-100"
    fname = "PSI-100_Experimental table_SAFFIRE-3.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
        sid = d["Sample Number"]
        extra = blank_extra(d, {"Sample Number", "Material", "Air Flow"})
        out.append(row(inv, f"Saffire-III-{sid}", src, fname, rn, fuel="SIBAL (cotton-fiberglass fabric)",
                       fuelPhase="solid", geometry=f"large fabric sheet, {d['Direction'].strip().lower()} flow",
                       flowCmS=first_num(d["Air Flow"]), diluent="N2", extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "PSI table has only sample geometry, flow (30 cm/s) and direction: no O2, pressure, burn time, spread rate or outcome -> those fields are null/'unknown'.")
    note(inv, "Thickness listed as '.33 cm' — same unit doubt as Saffire-I (SIBAL is sub-millimetre); thicknessMm left null, raw value in extra.")
    return out


# --------------------------------------------------------------------------- FLEX / FLEX-2 / CFI (MDCA)

FLEX_OUTCOME = {"extinction": "extinguished", "disruption": "disruption", "completion": "completed"}


def flex():
    inv, psi, src = "FLEX", "PSI-69", "psi-69"
    fname = "PSI-69_Experimental table_FLEX.csv"
    header, rows = read_csv(psi_file(psi, fname))
    out = []
    cO2, cN2, cCO2, cHe = header[6], header[7], header[8], header[9]
    for rn, d in rows:
        n = int(d["FLEX Test #"])
        xo2, xn2, xco2, xhe = (num(d[c]) for c in (cO2, cN2, cCO2, cHe))
        if xco2:
            dil, dpct = "CO2", r3(xco2 * 100, 1)
        elif xhe:
            dil, dpct = "He", r3(xhe * 100, 1)
        else:
            dil, dpct = "N2", r3(xn2 * 100, 1) if xn2 is not None else None
        p = num(d["Ambient pressure; mmHg"])
        if p is not None and p <= 0:
            note(inv, f"FLEX test {n} has ambient pressure 0 mmHg in the PSI table (recording error); pressureKpa set to null.")
            p_bad, p = p, None
        te = d["Test end"]
        extra = {"FLEX Identifier": d["FLEX Identifier"], "Test Date": d["Test Date"], "Test GMT": d["Test GMT"],
                 "pressure_mmHg": p, "x_O2": xo2, "x_N2": xn2, "x_CO2": xco2, "x_He": xhe,
                 "extinctionDiameterMm": num(d["Visible flame extinction diameter; mm"]),
                 "burnTimeS": num(d["Burn time; s"])}
        out.append(row(inv, f"FLEX-{n:03d}", src, fname, rn, fuel=d["Fuel"].strip().lower(), fuelPhase="liquid",
                       geometry="droplet", diameterMm=num(d["Droplet initial diameter; mm"]),
                       o2Pct=r3(xo2 * 100, 1) if xo2 is not None else None,
                       pressureKpa=r3(p * MMHG_KPA, 1) if p is not None else None,
                       diluent=dil, diluentPct=dpct, outcome=FLEX_OUTCOME.get(te.lower(), "unknown"), outcomeRaw=te,
                       burningRateMm2S=num(d["Burning rate; mm"]), extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "PSI header 'Burning rate; mm' is the droplet burning-rate constant K in mm²/s (values 0.05–1.06; the 0.3–1.06 bulk matches typical d²-law constants); stored as burningRateMm2S.")
    note(inv, "PSI headers 'O/N/CO/He initial ambient composition' are O2, N2, CO2, He mole fractions (subscripts lost in the CSV). Converted to %; the suppressant (CO2 or He) is reported in diluent/diluentPct, otherwise N2.")
    note(inv, "Pressure converted from mmHg to kPa (x0.13332). Source file is cp1252-encoded; '–' cells are treated as missing.")
    note(inv, "flowCmS is null: the table does not state per-test flow; most FLEX tests were quiescent (free or tethered droplets), some had slow drift/translation (not tabulated).")
    note(inv, "Outcome mapping: Extinction -> extinguished, Disruption -> disruption (droplet disruption/test end), Completion -> completed (burned to completion).")
    note(inv, "NASA/TP-20150023456 reports 284 tests from Mar 2009–Dec 2011; the PSI table has 274 rows.")
    return out


def cfi():
    inv, psi, src = "CFI", "PSI-39", "psi-39"
    fname = "PSI-39_Experimental table_CFI.csv"
    xname = "PSI-39_Science Documents_CFI_DataSummary_Spreadsheet_Jan2021.xlsx"
    _, rows = read_csv(psi_file(psi, fname))
    wb = openpyxl.load_workbook(psi_file(psi, xname), data_only=True)
    ws = wb["DATA"]
    it = ws.iter_rows(values_only=True)
    hdr = [str(h).strip() if h is not None else "" for h in next(it)]
    data = {}
    for i, r in enumerate(it, start=2):
        if r[0] is None:
            continue
        rec = dict(zip(hdr, r))
        data.setdefault(str(r[0]).strip().split(".")[0], (i, rec))
    out, joined, dups, seen_rows = [], 0, [], {}
    for rn, d in rows:
        fx = d["Flex Number"].strip()
        sig = tuple(v.strip() for v in d.values())
        if fx in seen_rows:
            if sig == seen_rows[fx]:
                dups.append(fx)
                continue
            fx = f"{fx}-r{rn}"
        seen_rows[fx] = sig
        p_atm = first_num(d["Pressure"])
        xo2, xn2, xhe = num(d["Oxygen"]), num(d["Nitrogen"]), num(d["Helium"])
        f = d["Fuel"].strip()
        if f == "C12H26":
            fuel = "n-dodecane"
        else:
            m = re.match(r"\[\.(\d+)\]/\[\.(\d+)\]", f)
            fuel = f"n-dodecane/iso-dodecane {m.group(1)}/{m.group(2)}" if m else f
        dil, dpct = ("He", r3(xhe * 100, 1)) if xhe else ("N2", r3(xn2 * 100, 1) if xn2 is not None else None)
        extra = {"Test Date": d["Test Date"], "CIR": d["CIR"], "Fiber": d["Fiber"] or None,
                 "pressureRaw": d["Pressure"], "x_N2": xn2, "x_He": xhe}
        d0 = k_hot = None
        outcome, oraw = "unknown", None
        hit = data.get(fx)
        if hit:
            joined += 1
            xr, rec = hit
            d0 = num(rec.get("D0 ( mm )"))
            k_hot = num(rec.get("khot ( mm^2/s )"))
            dext_hot = num(rec.get("Dext, hot ( mm )"))
            extra.update({"dataSummaryRow": xr, "DextHotMm": dext_hot,
                          "kCoolMm2S": num(rec.get("kcool ( mm^2/s )")),
                          "DextCoolMm": num(rec.get("Dext,cool ( mm )")),
                          "reignitions": rec.get("Reignitions")})
            if dext_hot is not None:
                outcome, oraw = "extinguished", f"hot-flame extinction at D = {dext_hot} mm"
                if extra["kCoolMm2S"] is not None:
                    oraw += f"; cool-flame burning (k = {extra['kCoolMm2S']} mm²/s)"
        extra = {k: v for k, v in extra.items() if v not in (None, "")}
        out.append(row(inv, f"CFI-{fx}", src, fname, rn, fuel=fuel, fuelPhase="liquid", geometry="droplet",
                       diameterMm=d0, o2Pct=r3(xo2 * 100, 1) if xo2 is not None else None,
                       pressureKpa=r3(p_atm * ATM_KPA, 1) if p_atm is not None else None,
                       diluent=dil, diluentPct=dpct, outcome=outcome, outcomeRaw=oraw,
                       burningRateMm2S=k_hot, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    FILES_USED.append((inv, psi_file(psi, xname), joined))
    if dups:
        note(inv, f"The PSI CFI table repeats {len(dups)} rows verbatim (Flex {', '.join(dups)}); duplicates dropped, so {len(out)} unique tests remain of {len(rows)} table rows.")
    note(inv, f"Conditions from the PSI experimental table; D0, hot/cool burning-rate constants and extinction diameters joined from the CFI DataSummary spreadsheet (sheet 'DATA') on Flex Number ({joined} of {len(out)} rows matched).")
    note(inv, "burningRateMm2S = hot-flame k (khot); cool-flame k and extinction diameters are in extra. Outcome 'extinguished' = hot flame extinguished (cool flame may continue); rows without a hot-extinction diameter are 'unknown'.")
    note(inv, "Some hot-flame k values are very small (0.001–0.2 mm²/s), mostly at 17 % O2 where the hot flame extinguished quickly; values are as given in the DataSummary spreadsheet.")
    note(inv, "Pressure parsed from text like '1 atm' and converted to kPa. flowCmS null (quiescent droplet tests, not tabulated).")
    return out


# --------------------------------------------------------------------------- SAME / SAME-R

SAME_RESULTS = ("PSI-101", "PSI-101_Analyzed Data_SAME, SAME-R_Results.xlsx")
SMOKE_OUTCOME_RAW = "smoke generation by heating below ignition — no flame outcome applies"


def _sheet(ws, header_row=2):
    rows = list(ws.iter_rows(values_only=True))
    hdr = [str(h).strip() if h is not None else "" for h in rows[header_row - 1]]
    return hdr, [(i, r) for i, r in enumerate(rows[header_row:], start=header_row + 1)]


def _um_to_nm(v):
    """Workbook diameters are in micrometres; 0, blanks and Excel errors ('#DIV/0!') mean 'not computed'."""
    v = num(v)
    return r3(v * 1000, 1) if v is not None and v > 0 else None


def _pos(v):
    v = num(v)
    return v if v is not None and v > 0 else None


# SAME / SAME-R give no O2 or pressure. Both ran in the MSG work volume on the ISS; neither final report states the
# atmosphere or mentions a purge / backfill gas (N2 only diluted the sampled aerosol before the instruments), and MSG
# work-volume N2 dilution was first used later by BASS-II (NTRS 20150019858). So cabin air is assumed, and flagged.
CABIN_ASSUMED = dict(o2Pct=21.0, pressureKpa=101.3)
CABIN_ASSUMPTION = (
    "assumption: ISS cabin air (21% O2, 101.3 kPa). The test ran in the MSG work volume on the ISS (SAME Final Science "
    "Report p.20-21; SAME-R Final Report p.9: smoke 'diffused out of the inlet into the MSG volume'); neither report "
    "states O2 or pressure or mentions a purge or backfill gas (N2 was added only to dilute the sampled aerosol). "
    "MSG work-volume N2 dilution was first used later, by BASS-II (NTRS 20150019858)."
)


def cabin_assumed_extra() -> dict:
    return {"conditionsAssumed": ["o2Pct", "pressureKpa"], "o2PressureBasis": CABIN_ASSUMPTION}


def same():
    """SAME (PSI-102): per-test rows from the 'SAME1 Flight Tests 8-27-09' sheet of the SAME/SAME-R results workbook."""
    inv, src = "SAME", "psi-101"
    psi, xname = SAME_RESULTS
    wb = openpyxl.load_workbook(psi_file(psi, xname), data_only=True, read_only=True)
    hdr, rows = _sheet(wb["SAME1 Flight Tests 8-27-09"])
    col = {h: j for j, h in enumerate(hdr) if h}
    c_amd = col["Computed arithmetic mean diameter (micrometers)"]
    c_dam = [j for h, j in col.items() if h.startswith("Diam Avg Mass (DAM)")][0]
    out = []
    for rn, r in rows:
        if r[col["Sample Type"]] is None or r[col["SAME #"]] is None:
            continue
        same_no = str(r[col["SAME #"]]).strip()
        mat = str(r[col["Sample Type"]]).strip()
        temp = num(r[col["T ( C) - Eq. 2 of lrt"]])
        extra = {"testIdNumber": str(r[col["Test ID Number"]]).strip(), "description": str(r[col["Description"]] or "").strip() or None,
                 "heaterRt_R0": num(r[col["Rt/R0"]]), "sampleTemperatureC": r3(temp, 1) if temp else None,
                 "smokeDurationS": num(r[col["Duration (sec)"]]), "netAgingTimeS": r3(num(r[col["Net Aging  Duration"]]), 1),
                 "massLossMg": num(r[col["Mass Loss (mg)"]]),
                 "diameterOfAverageMassNm": _um_to_nm(r[c_dam]),
                 "hatchChoateGeometricMeanDiameterNm": _um_to_nm(r[col["Hatch Choate Dg"]]),
                 "hatchChoateGeometricStdDev": _pos(r[col["Hatch Choate Sigma g"]]),
                 "particleCountPerCm3": _pos(r[col["Mo Best Diameter (#/cm3)"]]) if "Mo Best Diameter (#/cm3)" in col else None,
                 "aged": same_no.endswith("a"),
                 "testType": "smoke generation by heating below ignition (not a flame test)",
                 "resultsSheet": "SAME1 Flight Tests 8-27-09"}
        extra = {k: v for k, v in extra.items() if v is not None} | cabin_assumed_extra()
        out.append(row(inv, f"SAME-{same_no}", src, xname, rn, fuel=mat, fuelPhase="solid" if mat != "DBP" else "liquid",
                       geometry="heated sample in smoke-generation tube" if mat != "DBP" else "heated DBP reference aerosol source",
                       flowCmS=num(r[col["Inlet Velocity (cm/sec)"]]), outcome="unknown", outcomeRaw=SMOKE_OUTCOME_RAW,
                       particleSizeNm=_um_to_nm(r[c_amd]), extra=extra, **CABIN_ASSUMED))
    FILES_USED.append((inv, psi_file(psi, xname), len(out)))
    FILES_USED.append((inv, psi_file("PSI-102", "PSI-102_Experimental table_SAME.csv"), 0))
    note(inv, "o2Pct and pressureKpa are an " + CABIN_ASSUMPTION + " Flagged per row in extra.conditionsAssumed.")
    n_size = sum(1 for t in out if t["particleSizeNm"] is not None)
    note(inv, f"Rows come from the per-test sheet 'SAME1 Flight Tests 8-27-09' of '{xname}' (PSI-101 science data, covers SAME and SAME-R): {len(out)} test points incl. 'a' (secondarily aged) rows. "
              "The PSI-102 experimental table is only an 8-row condition summary (Teflon at 5–10 cm/s, 1–20 min aging, 'same conditions' for other materials) and is not used for rows; the workbook gives 2–8 cm/s for the flown tests.")
    note(inv, f"particleSizeNm = arithmetic (count) mean diameter M1/M0 ('Computed arithmetic mean diameter', µm x1000), available for {n_size} rows; zeros, blanks and '#DIV/0!' cells mean 'not computed' -> null. "
              "Other size metrics are in extra (diameterOfAverageMassNm, hatchChoateGeometricMeanDiameterNm, hatchChoateGeometricStdDev). DBP (dibutyl phthalate reference aerosol) rows have no computed sizes.")
    note(inv, "Smoke tests heat samples below ignition, so there is no flame outcome: outcome 'unknown' (no extra.outcomeDerivation). "
              "Heating: extra.heaterRt_R0 (heater resistance ratio) and extra.sampleTemperatureC (from 'T ( C) - Eq. 2 of lrt'). O2/pressure are not tabulated (MSG cabin air).")
    return out


def same_r():
    inv, psi, src = "SAME-R", "PSI-101", "psi-101"
    fname = "PSI-101_Experimental table_SAME-R.csv"
    _, rows = read_csv(psi_file(psi, fname))
    xpsi, xname = SAME_RESULTS
    wb = openpyxl.load_workbook(psi_file(xpsi, xname), data_only=True, read_only=True)
    hdr, xrows = _sheet(wb["SAME R Results"])
    col = {}
    for j, h in enumerate(hdr):
        col.setdefault(h, j)
    res = {}
    for rn, r in xrows:
        k = r[col["SAME #"]]
        if k is not None and r[col["Sample Type"]] is not None:
            res.setdefault((str(k).strip().lower(), str(r[col["Sample Type"]]).strip().lower()), (rn, r))
    out, joined = [], 0
    for rn, d in rows:
        extra = blank_extra(d, {"Sample Type", "SAME Test #", "Inlet velocity (cm/s)"})
        extra["testType"] = "smoke generation by heating below ignition (not a flame test)"
        tid = f"SAME-R-{d['SAME Test #']}"
        if any(o["testId"] == tid for o in out):
            tid += f"-{d['Sample Type']}"
            note(inv, f"Test # {d['SAME Test #']} appears for two materials (reburn rows); testId suffixed with the material.")
        size = None
        hit = res.get((d["SAME Test #"].strip().lower(), d["Sample Type"].strip().lower()))
        if hit:
            joined += 1
            xr, r = hit
            temp = num(r[col["T ( C) - Eq. 2 of lrt"]])
            size = _um_to_nm(r[col["M1/M0 (micro-m)--AMD"]])
            add = {"resultsRow": xr, "sampleId": r[col["Sample ID"]], "sampleTemperatureC": r3(temp, 1) if temp else None,
                   "massLossMg": num(r[col["Mass Loss (mg)"]]),
                   "diameterOfAverageMassNm": _um_to_nm(r[col["Diameter of Average mass (micro-m)"]]),
                   "d21Nm": _um_to_nm(r[col["George's d2,1,  (micro-m)"]]),
                   "hatchChoateGeometricMeanDiameterNm": _um_to_nm(r[col["Hatch Choate Dg"]]),
                   "hatchChoateGeometricStdDev": _pos(r[col["Hatch Choate Sigma g"]]),
                   "particleCountPerCm3": _pos(r[col["M0 best Diameter (#/cm3)"]])}
            extra.update({k: v for k, v in add.items() if v is not None})
        out.append(row(inv, tid, src, fname, rn, fuel=d["Sample Type"], fuelPhase="solid",
                       geometry="heated sample (smoke source)", flowCmS=num(d["Inlet velocity (cm/s)"]),
                       outcome="unknown", outcomeRaw=SMOKE_OUTCOME_RAW, particleSizeNm=size,
                       extra=extra | cabin_assumed_extra(), **CABIN_ASSUMED))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    FILES_USED.append((inv, psi_file(xpsi, xname), joined))
    note(inv, "o2Pct and pressureKpa are an " + CABIN_ASSUMPTION + " Flagged per row in extra.conditionsAssumed.")
    n_size = sum(1 for t in out if t["particleSizeNm"] is not None)
    unmatched = [t["testId"] for t in out if "resultsRow" not in t["extra"]]
    if unmatched:
        note(inv, f"No workbook match for {', '.join(unmatched)} (the PSI table lists test 57 for both Lampwick and Teflon; the results workbook has 57 only as Lampwick) -> sizes null.")
    note(inv, "Rows with an 'a' suffix (e.g. 51a) are the aged-smoke measurement of the same burn; kept as separate rows as in the PSI table.")
    note(inv, f"Particle sizes joined from sheet 'SAME R Results' of '{xname}' (PSI-101 analyzed data) on (SAME #, material): {joined} of {len(out)} rows matched, {n_size} with a size. "
              "particleSizeNm = arithmetic (count) mean diameter M1/M0 ('M1/M0 (micro-m)--AMD', µm x1000) from the ionization-chamber (M1) and CPC (M0) moments; "
              "extra also has diameterOfAverageMassNm (DAM, from DustTrak mass and M0), d21Nm, hatchChoateGeometricMeanDiameterNm and hatchChoateGeometricStdDev. Zeros/Excel errors in the workbook -> null.")
    note(inv, "Heating: 'Rt/R0' (heater resistance ratio, PSI table) and extra.sampleTemperatureC (workbook column 'T ( C) - Eq. 2 of lrt'). Aging: PSI 'Net aging time (sec)'. "
              "Outcome 'unknown', no extra.outcomeDerivation (samples heated below ignition; no flame). O2/pressure not tabulated (MSG cabin air).")
    return out


# --------------------------------------------------------------------------- ACME (CIR)

def bre():
    inv, psi, src = "ACME-BRE", "PSI-20", "psi-20"
    fname = "PSI-20_Experimental table_ACME BRE.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
        o2s = []
        for tok in d["Oxygen Conc (percent)"].split(";"):
            tok = tok.strip()
            if not tok:
                continue
            if tok.endswith("00%"):  # '3400%' / '2100%' spreadsheet-format artefacts
                o2s.append((float(tok[:-3]), tok))
            else:
                o2s.append((float(tok.rstrip("%")), tok))
        ign = int(num(d["Flames Ignited"]) or 0)
        fb = d["Fuel Bottle"].replace("%C", "% C")
        fuel = fb if fb.startswith("100%") else fb + " (balance N2)"
        for o2, tok in o2s:
            extra = {"date": f"{d['Year']}-{d['Month']}-{d['Date']}", "fuelBottle": d["Fuel Bottle"],
                     "flamesIgnitedThatDay": ign, "o2Raw": tok, "granularity": "test-day x listed O2 (not individual tests)"}
            out.append(row(inv, f"BRE-{d['Year']}-{d['Month']}-{d['Date']}-{int(o2) if o2.is_integer() else o2}", src, fname, rn,
                           fuel=fuel, fuelPhase="gas", geometry="porous flat burner (condensed-fuel emulator)",
                           diameterMm=num(d["Burner Size (mm)"]), o2Pct=o2, flowCmS=0.0, diluent="N2",
                           outcome="burned" if ign > 0 else "no_ignition",
                           outcomeRaw=f"{ign} flames ignited that day", extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "PSI table is a per-test-day summary: each row lists the approximate O2 levels of tests that ignited and the number of flames ignited that day. Rows here are (day x O2 level), not individual tests.")
    note(inv, "O2 cells '3400%' and '2100%' are spreadsheet percent-format artefacts and are read as 34 and 21 %.")
    note(inv, "Chamber pressure was varied but is not identified in the PSI summary table -> pressureKpa null. PSI objective lists target atmospheres 14.7 psia/21 %, 10.2 psia/26.5 %, 8.2 psia/34 % O2.")
    note(inv, "flowCmS = 0: BRE burns in a quiescent ambient (PSI objective: 'burning conditions in a quiescent microgravity ambient').")
    return out


def efield():
    inv, psi, src = "ACME-E-FIELD", "PSI-22", "psi-22"
    fname = "PSI-22_Experimental table_ACME E-FIELD Flames.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out, cur = [], None
    for rn, d in rows:
        if d["Test Type"]:
            cur = d
        if cur is None or not d["Fuel Conc"]:
            continue
        conc = first_num(d["Fuel Conc"])
        bottle = cur["Fuel Bottle"]
        fuel_species = "CH4" if "CH4" in bottle else "C2H4" if "C2H4" in bottle else bottle
        burner = "coflow burner" if "coflow" in cur["Test Type"] else "gas-jet burner"
        extra = {"testType": cur["Test Type"], "testDay": cur["Test Day"], "meshPolarity": cur["Mesh Polarity"],
                 "fuelBottle": bottle, "fuelConcPct": conc, "flamesIgnitedThatDay": num(cur["Flames Ignited"]),
                 "granularity": "test-day x fuel concentration (not individual tests)"}
        tid = f"EFIELD-{cur['Test Day']}-{cur['Mesh Polarity'][:3]}-{int(conc) if conc is not None else 'x'}"
        k = sum(1 for o in out if o["testId"].startswith(tid))
        out.append(row(inv, tid + (f"-{k+1}" if k else ""), src, fname, rn,
                       fuel=f"{fuel_species} {int(conc)}% in N2" if conc and conc < 100 else fuel_species,
                       fuelPhase="gas", geometry=burner, outcome="burned",
                       outcomeRaw=f"{cur['Flames Ignited']} flames ignited that day", extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "PSI table is a per-test-day summary (fuel, dilution, electrode polarity, number of flames ignited); rows here are (day x fuel concentration), not individual tests.")
    note(inv, "Oxidizer O2, pressure, coflow velocity and applied voltage are not in the PSI table -> null. Electric field is applied up to 10 kV (PSI approach text).")
    return out


def cfig():
    inv, psi, src = "ACME-CFI-G", "PSI-159", "psi-159"
    out = []

    def outcome_of(hot, se):
        h = (hot or "").strip().lower()
        s = (se or "").strip().upper()
        if h == "no":
            return "no_ignition"
        if h == "flash":
            return "self_extinguished"
        if h == "yes":
            return {"SE": "self_extinguished", "FT": "burned"}.get(s, "unknown")
        return "unknown"

    fn = "PSI-159_Experimental table_CFI-G_Normal Flames.csv"
    _, rows = read_csv(psi_file(psi, fn))
    for rn, d in rows:
        if not d["Test"]:
            continue
        hot, se = d["Hot ignition"], d["Self-ext or flow term"]
        extra = blank_extra(d, {"Test", "Fuel", "XO2 before test", "approx p (bar)", "Hot ignition", "Self-ext or flow term"})
        extra["flameType"] = "normal (fuel issued from burner into O2/N2 ambient)"
        p = num(d["approx p (bar)"])
        xo2 = num(d["XO2 before test"])
        out.append(row(inv, f"CFI-G-N-{d['Test'].replace(' ', '')}-D{d['Day']}", src, fn, rn,
                       fuel=d["Fuel"] + ("" if d["Fuel"].startswith("%") or "%" in d["Fuel"] else " (100%)"),
                       fuelPhase="gas", geometry="spherical porous burner, normal flame",
                       o2Pct=r3(xo2 * 100, 2) if xo2 is not None else None,
                       pressureKpa=r3(p * 100, 1) if p is not None else None, flowCmS=0.0, diluent="N2",
                       outcome=outcome_of(hot, se), outcomeRaw=f"hot ignition: {hot}; end: {se}", extra=extra))
    n_norm = len(out)
    FILES_USED.append((inv, psi_file(psi, fn), n_norm))
    fi = "PSI-159_Experimental table_CFI-G_Inverse Flames.csv"
    _, rows = read_csv(psi_file(psi, fi))
    for rn, d in rows:
        if not d["Test"]:
            continue
        hot, se = d["Hot ignition"], d["Self -ext or flow term"]
        extra = blank_extra(d, {"Test", "Fuel", "XO2", "approx p (bar)", "Hot ignition", "Self -ext or flow term"})
        extra["flameType"] = "inverse (O2/N2 oxidizer issued from burner into fuel-containing ambient)"
        extra["o2Meaning"] = "O2 mole fraction of the oxidizer stream from the burner, not of the ambient"
        p = num(d["approx p (bar)"])
        xo2 = num(d["XO2"])
        out.append(row(inv, f"CFI-G-I-{d['Test'].replace(' ', '')}-D{int(float(d['Day']))}", src, fi, rn,
                       fuel=d["Fuel"], fuelPhase="gas", geometry="spherical porous burner, inverse flame",
                       o2Pct=r3(xo2 * 100, 2) if xo2 is not None else None,
                       pressureKpa=r3(p * 100, 1) if p is not None else None, flowCmS=0.0, diluent="N2",
                       outcome=outcome_of(hot, se), outcomeRaw=f"hot ignition: {hot}; end: {se}", extra=extra))
    FILES_USED.append((inv, psi_file(psi, fi), len(out) - n_norm))
    note(inv, f"Two PSI tables: normal flames ({n_norm} rows) and inverse flames ({len(out) - n_norm} rows; the CSV has ~860 trailing blank lines which are skipped).")
    note(inv, "For inverse flames o2Pct is the O2 fraction of the oxidizer stream leaving the burner (up to 85 %), not an ambient atmosphere — do not compare directly with solid-material tests.")
    note(inv, "Outcome mapping: Hot ignition 'No' -> no_ignition; 'flash' -> self_extinguished; 'Yes' + SE (self-extinguished) -> self_extinguished; 'Yes' + FT (flow terminated while burning) -> burned. Cool-flame observations are in extra['Cool flame?'].")
    note(inv, "Pressure 'approx p (bar)' converted to kPa (x100). flowCmS = 0 (spherical burner in a quiescent chamber; fuel/oxidizer mass flow rates are in extra). Diluent assumed N2 per the 'O2/N2' description in PSI text.")
    return out


def _hms(v):
    """'8:56:16', '08.56.16' -> (8, 56, 16); anything else -> the stripped text."""
    m = re.fullmatch(r"(\d{1,2})[:.](\d{2})[:.](\d{2})", str(v).strip())
    return tuple(int(x) for x in m.groups()) if m else str(v).strip()


def spice():
    inv, psi, src = "SPICE", "PSI-107", "psi-107"
    fname = "PSI-107_Experimental table_Spice.csv"
    mname = "PSI-107_Raw Data_Spice Flight Test Data II modified.xls"
    rname = "PSI-107_Raw Data_SmokePointReview-0g-3.xlsx"
    _, rows = read_csv(psi_file(psi, fname))
    # ---- master sheet "Data record of Video and Stills" (source of the PSI table; adds lengths, flags, comments)
    import xlrd
    ms = xlrd.open_workbook(str(psi_file(psi, mname))).sheet_by_index(0)
    master = []
    for i in range(4, ms.nrows):
        v = ms.row_values(i)
        master.append({"row": i + 1, "date": num(v[0]), "noz": num(v[9]), "sccm": num(v[17]), "air": num(v[20]),
                       "tp": str(v[7]).strip().rstrip(".0") if isinstance(v[7], str) else (str(int(v[7])) if v[7] != "" else None),
                       "pressurePa": num(v[10]), "lengthMm": num(v[16]), "nikonHeightMm": num(v[24]),
                       "smokeFlag": str(v[25]).strip().upper() or None, "SH": str(v[5]).strip().lower() or None,
                       "LO": str(v[6]).strip().lower() or None, "comment": str(v[26]).strip() or None})

    def close(a, b, tol=0.02):
        return (a is None and b is None) or (a is not None and b is not None and abs(a - b) <= tol)

    # ---- curated smoke points (sheet 'Smoke Point Datasheet', ISS rows only)
    rv = openpyxl.load_workbook(psi_file(psi, rname), data_only=True, read_only=True)["Smoke Point Datasheet"]
    smoke_pts = []
    for i, r in enumerate(rv.iter_rows(values_only=True), start=1):
        if i < 5 or not isinstance(r[5], str) or num(r[18]) is None or num(r[0]) is None:
            continue
        ign = r[1].strftime("%H:%M:%S") if isinstance(r[1], datetime.time) else str(r[1]).strip()
        smoke_pts.append({"row": i, "date": num(r[0]), "ign": ign, "tp": r[5].strip(), "fuel": str(r[6]).strip(), "noz": num(r[7]),
                          "lspMm": num(r[18]), "sccm": num(r[25]), "air": num(r[29]), "used": False})
    out, neg, ptr, joined = [], 0, 0, 0
    seen = {}
    for rn, d in rows:
        air = num(d["Air Rate (cm/s)"])
        air_v = None if (air is not None and air < 0) else air
        if air is not None and air < 0:
            neg += 1
        base = f"SPICE-{d['GMT date']}-{d['GMT ignition'].replace(':', '')}"
        seen[base] = seen.get(base, 0) + 1
        extra = blank_extra(d, {"Fuel", "Nozzle (mm)", "Air Rate (cm/s)"})
        if air is not None and air < 0:
            extra["airRateRaw"] = air
        # join to the master sheet: same day, nozzle, fuel rate and air rate, searching forward (the PSI table keeps its order)
        date, sccm, noz = num(d["GMT date"]), num(d["Fuel Rate (sccm)"]), num(d["Nozzle (mm)"])
        hit = None
        for q in range(ptr, min(ptr + 80, len(master))):
            m = master[q]
            if m["date"] == date and close(m["sccm"], sccm) and close(m["air"], air) and close(m["noz"], noz, 0.001):
                hit, ptr = m, q + 1
                break
        comment = None
        if hit:
            joined += 1
            comment = hit["comment"] if hit["comment"] and not re.match(r"ISS0|DSC_|manual nikon", hit["comment"], re.I) else None
            add = {"masterRow": hit["row"], "testPoint": hit["tp"], "flameLengthMm": r3(hit["lengthMm"], 1),
                   "nikonFlameHeightMm": r3(hit["nikonHeightMm"], 1) if hit["nikonHeightMm"] else None,
                   "smokeHeightFlag": hit["smokeFlag"], "flagSH": hit["SH"], "flagLO": hit["LO"], "comment": comment,
                   "pressurePa": hit["pressurePa"]}
            extra.update({k: v for k, v in add.items() if v not in (None, "")})
        # outcome: SPICE was a smoke-point study, not a flammability test. Every row is a deliberately ignited jet flame,
        # so "burned" would be a by-design constant that inflates outcome accuracy. Rows are 'completed' (excluded from
        # burn/no-burn estimates); the informative result is the smoke point (smokePointLengthMm). Blow-offs stay in outcomeRaw.
        if comment and re.search(r"blew off|blew out|blows out|blow ?off", comment, re.I):
            oraw = f"master-sheet comment: {comment}"
        else:
            oraw = "ignited coflow jet flame at this fuel/air setting" + (f" ({comment})" if comment else "")
        outcome = "not_applicable"
        extra["outcomeDerivation"] = "source-table" if hit else "keyword-rule"
        extra["o2PressureBasis"] = "nominal: SPICE Final Report Table 1 note — ua, uf, Re 'assume conditions of 298 K, 101 kPa and 21±1% O2' (MSG cabin air, not measured per test)"
        out.append(row(inv, f"{base}-{seen[base]}", src, fname, rn, fuel=d["Fuel"].replace("75% ", "75 % "),
                       fuelPhase="gas", geometry="round nozzle, co-flow jet flame", diameterMm=noz,
                       o2Pct=21.0, pressureKpa=101.0, flowCmS=air_v, diluent="N2",
                       outcome=outcome, outcomeRaw=oraw, extra=extra))
    # ---- attach each curated smoke point to one PSI row: same day, nozzle and ignition time, nearest air/fuel setting.
    # The review sheet recomputed fuel rates with corrected flow-meter factors, so sccm values differ from the PSI table.
    for c in smoke_pts:
        cands = [t for t in out if num(t["extra"].get("GMT date")) == c["date"] and close(t["diameterMm"], c["noz"], 0.001)
                 and _hms(t["extra"].get("GMT ignition", "")) == _hms(c["ign"]) and t["smokePointLengthMm"] is None]
        if not cands or c["air"] is None:
            continue
        def dist(t):
            fr = num(t["extra"].get("Fuel Rate (sccm)")) or 0
            return abs((t["flowCmS"] if t["flowCmS"] is not None else -99) - c["air"]) + 10 * abs(fr - (c["sccm"] or 0)) / max(c["sccm"] or 1, 1)
        best = min(cands, key=dist)
        best["smokePointLengthMm"] = r3(c["lspMm"], 1)
        best["extra"].update({"smokePointTestPoint": c["tp"], "smokePointReviewRow": c["row"],
                              "smokePointAirCmS": r3(c["air"], 2), "smokePointFuelRateSccm": r3(c["sccm"], 2)})
        c["used"] = True
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    FILES_USED.append((inv, psi_file(psi, mname), joined))
    n_sp = sum(1 for t in out if t["smokePointLengthMm"] is not None)
    FILES_USED.append((inv, psi_file(psi, rname), n_sp))
    unused = [c["tp"] for c in smoke_pts if not c["used"]]
    note(inv, "Each row is one fuel-flow/air-flow setting of an ignited jet flame (several rows share one ignition). flowCmS = co-flow air velocity; nozzle inner diameter in diameterMm.")
    if neg:
        note(inv, f"{neg} rows have a negative air rate (sensor offset at fan-off); flowCmS set to null, raw value in extra.airRateRaw.")
    note(inv, f"Joined {joined} of {len(out)} PSI rows to the master sheet '{mname}' (sheet 'Data record of Video and Stills', the source of the PSI table) on day, nozzle, fuel rate and air rate in table order. "
              "From it: extra.flameLengthMm (luminous flame length from video, mm), extra.nikonFlameHeightMm, extra.smokeHeightFlag ('Smoke Height' Y/N column), extra.flagSH / extra.flagLO (columns headed 'SH ?' / 'LO ?', undocumented — LO is probably lift-off), extra.comment.")
    note(inv, f"smokePointLengthMm = luminous flame length at the smoke point (mm) from the curated sheet 'Smoke Point Datasheet' of '{rname}' (55 ISS smoke points; the SPICE Final Report Table 1 counts 52). "
              f"Attached to {n_sp} PSI rows: same day, nozzle and ignition time, then the fuel/air setting nearest to the review sheet's (the review recomputed fuel rates with corrected meter factors; its values are kept in extra.smokePointAirCmS / smokePointFuelRateSccm)"
              + (f"; no PSI row with that ignition time for {', '.join(unused)}" if unused else "") + ". All other rows are not at their smoke point -> null.")
    note(inv, "o2Pct = 21 and pressureKpa = 101 are the nominal conditions stated in the SPICE Final Report (Table 1 note: '298 K, 101 kPa and 21±1% O2'; coflow is MSG cabin air). The master sheet's 'Pressure (Pa)' column is a constant 101325 (kept in extra.pressurePa). Not measured per test.")
    note(inv, "Outcome: 'not_applicable' for every row. SPICE deliberately ignited every flame, so 'burned' would be a by-design constant, not a flammability result; "
              "SPICE rows are therefore excluded from burn/no-burn estimates and backtests (blow-off comments are kept in outcomeRaw). "
              "SPICE's natural per-row result is the smoke point (sooting vs non-sooting); the Final Report notes 'All smoke point flames were attached to the burner, i.e., not lifted'.")
    return out


def slice_():
    inv, psi, src = "SLICE", "PSI-106", "psi-106"
    fname = "PSI-106_Experimental table_Slice.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
        date = d["Test Date"].split(" ")[0].strip()
        fuel = d["Fuel Type"].strip()
        m = re.match(r"(\d+%\s*[A-Z0-9]+(?:\s*\(balance N2\))?)", fuel)
        out.append(row(inv, f"SLICE-{date}", src, fname, rn, fuel=m.group(1) if m else fuel, fuelPhase="gas",
                       geometry="co-flow jet burner", extra={"testDateRaw": d["Test Date"], "fuelTypeRaw": fuel,
                                                              "granularity": "test day (not individual flames)"}))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "PSI table only lists test days and fuel mixture (12 days, Feb–Mar 2012); no flow, O2, pressure or outcome per flame -> nulls / 'unknown'.")
    return out


def flex2_rows():
    inv = "FLEX-2"
    FILES_USED.append((inv, psi_file("PSI-68", "PSI-68_Experimental table_Flex2.csv"), 0))
    note(inv, "The PSI table (8 rows) is a planned test matrix by fuel (initial diameter 1.5–5 mm, O2 0.17–0.30, pressure 0.5–3 atm, flow 0.1–5 cm/s), not per-test results, so no rows are emitted in tests.json.")
    note(inv, "conditions[] ranges are the planned matrix (PSI table / approach text), not measured flown values.")
    return []


PARSERS = [bass2, bass, saffire1, saffire2, saffire3, flex, flex2_rows, cfi, same, same_r, bre, efield, cfig, spice, slice_]

# --------------------------------------------------------------------------- investigations

def rng(vals, nd=1):
    v = [x for x in vals if isinstance(x, (int, float))]
    return [round(min(v), nd), round(max(v), nd)] if v else None


def build_investigations(tests):
    invs = []
    for card in CARDS:
        c = json.loads(json.dumps(card))  # deep copy
        psi = c["psi"]
        meta = json.loads((RAW / psi / "investigation.json").read_text())
        c["name"] = c.get("name") or meta.get("title")
        c["psiUrl"] = f"https://psi.nasa.gov/physci/repo/data/investigations/{psi}"
        api_doi = (meta.get("doi") or "").strip() or None
        claimed = c.get("doi")
        c["doi"] = api_doi or claimed
        c["doiVerified"] = bool(api_doi) and (claimed is None or claimed == api_doi)
        if claimed and api_doi and claimed != api_doi:
            c.setdefault("dataNotes", []).append(f"DOI corrected from {claimed} to {api_doi} (PSI record).")
        rows = [t for t in tests if t["inv"] == c["id"]]
        cond = c.get("conditions") or {}
        if rows:
            computed = {
                "o2Pct": rng([t["o2Pct"] for t in rows]),
                "pressureKpa": rng([t["pressureKpa"] for t in rows]),
                "flowCmS": rng([t["flowCmS"] for t in rows]),
                "gravityG": rng([t["gravityG"] for t in rows]),
                "diluents": sorted({t["diluent"] for t in rows if t["diluent"]}) or None,
            }
            for k, v in computed.items():
                if v is not None:
                    cond[k] = v
                else:
                    cond.setdefault(k, None)
            c["nTests"] = len(rows)
            assumed = sorted({k for t in rows for k in t["extra"].get("conditionsAssumed", [])})
            if assumed:
                cond["assumed"] = assumed
                cond["assumptionNote"] = next(t["extra"]["o2PressureBasis"] for t in rows if t["extra"].get("conditionsAssumed"))
        else:
            for k in ("o2Pct", "pressureKpa", "flowCmS", "gravityG", "diluents"):
                cond.setdefault(k, None)
            c["nTests"] = c.get("nTests", 0)
        c["conditions"] = cond
        c["rawDataAvailable"] = bool(rows)
        c["dataNotes"] = c.get("dataNotes", []) + NOTES.get(c["id"], [])
        # psi + doi sources always present
        srcs = c.setdefault("sources", [])
        ids = {s["id"] for s in srcs}
        if f"psi-{psi.split('-')[1]}" not in ids:
            srcs.insert(0, {"id": f"psi-{psi.split('-')[1]}", "label": f"{psi} investigation page (NASA PSI)",
                            "url": c["psiUrl"], "type": "psi"})
        if c["doi"] and f"doi-{psi.lower()}" not in ids:
            srcs.insert(1, {"id": f"doi-{psi.lower()}", "label": f"PSI dataset DOI {c['doi']}",
                            "url": f"https://doi.org/{c['doi']}", "type": "doi"})
        order = ["id", "name", "psi", "psiUrl", "doi", "doiVerified", "family", "hardware", "platform", "fuelPhase",
                 "direction", "safetyConsequence", "objective", "fuel", "conditions", "varied", "constant", "diagnostics",
                 "resultSummary", "keyFindings", "nTests", "flight", "rawDataAvailable", "years", "earthRelevance",
                 "sources", "dataNotes"]
        invs.append({k: c.get(k) for k in order} | {k: v for k, v in c.items() if k not in order})
    return invs


# --------------------------------------------------------------------------- validation

ENUM = {"burned", "extinguished", "no_ignition", "flame_spread", "self_extinguished", "completed", "disruption", "not_applicable", "unknown"}
PLAUSIBLE = {"smokePointLengthMm": (0, 200), "particleSizeNm": (1, 5000), "o2Pct": (0, 100), "pressureKpa": (10, 600), "flowCmS": (0, 100), "gravityG": (0, 1),
             "spreadRateMmS": (0, 50), "burningRateMm2S": (0, 3), "diameterMm": (0, 60), "thicknessMm": (0, 30),
             "diluentPct": (0, 100)}


def validate(tests, invs):
    errs = []
    ids = {i["id"] for i in invs}
    seen = set()
    for t in tests:
        if t["inv"] not in ids:
            errs.append(f"{t['testId']}: unknown inv {t['inv']}")
        if t["testId"] in seen:
            errs.append(f"duplicate testId {t['testId']}")
        seen.add(t["testId"])
        d = t["extra"].get("outcomeDerivation")
        if d is not None and d not in ("source-table", "report", "keyword-rule"):
            errs.append(f"{t['testId']}: bad extra.outcomeDerivation {d}")
        if t["outcome"] != "unknown" and d is None:
            errs.append(f"{t['testId']}: known outcome without extra.outcomeDerivation")
        if t["outcome"] not in ENUM:
            errs.append(f"{t['testId']}: bad outcome {t['outcome']}")
        for k, (lo, hi) in PLAUSIBLE.items():
            v = t.get(k)
            if v is None:
                continue
            if not isinstance(v, (int, float)) or isinstance(v, bool):
                errs.append(f"{t['testId']}: {k} not numeric ({v!r})")
            elif not (lo <= v <= hi):
                errs.append(f"{t['testId']}: {k}={v} outside plausible [{lo},{hi}]")
    for i in invs:
        for s in i["keyFindings"]:
            if s["sourceId"] not in {x["id"] for x in i["sources"]}:
                errs.append(f"{i['id']}: keyFinding sourceId {s['sourceId']} missing from sources")
        if i["nTests"] != sum(1 for t in tests if t["inv"] == i["id"]) and i["rawDataAvailable"]:
            errs.append(f"{i['id']}: nTests mismatch")
    return errs


def sha256(p):
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


def main():
    tests = []
    for p in PARSERS:
        tests.extend(p())
    # every row with a known outcome says how it was obtained; parsers that read an explicit
    # result column of a source table did not set it themselves
    for t in tests:
        if t["outcome"] != "unknown":
            t["extra"].setdefault("outcomeDerivation", "source-table")
    invs = build_investigations(tests)
    errs = validate(tests, invs)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "tests.json").write_text(json.dumps(tests, indent=1, ensure_ascii=False, allow_nan=False))
    (OUT / "investigations.json").write_text(json.dumps(invs, indent=1, ensure_ascii=False, allow_nan=False))
    psi_of = {c["id"]: c["psi"] for c in CARDS}
    lic = {}
    files = []
    for inv, path, n in FILES_USED:
        psi = psi_of[inv]
        if psi not in lic:
            lic[psi] = json.loads((RAW / psi / "investigation.json").read_text()).get("licenseIdentifier")
        files.append({"inv": inv, "file": str(Path(path).relative_to(ROOT)),
                      "url": f"https://psi.nasa.gov/physci/repo/data/investigations/{psi}",
                      "apiDownload": f"https://psi.nasa.gov/geode-py/ws/studies/{psi}/download?file={quote(Path(path).name)}",
                      "sha256": sha256(path), "rows": n, "license": lic[psi]})
    manifest = {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
                "generator": "pipeline/build_dataset.py", "files": files}
    (OUT / "datasets_manifest.json").write_text(json.dumps(manifest, indent=1, ensure_ascii=False))

    # summary
    print(f"tests.json: {len(tests)} rows; investigations.json: {len(invs)} cards")
    cols = ["o2Pct", "pressureKpa", "flowCmS", "diameterMm", "thicknessMm", "spreadRateMmS", "burningRateMm2S", "particleSizeNm", "smokePointLengthMm"]
    print(f"{'inv':14s} {'rows':>5s} " + " ".join(f"{c[:8]:>8s}" for c in cols) + "  outcomes")
    for i in invs:
        rs = [t for t in tests if t["inv"] == i["id"]]
        oc = {}
        for t in rs:
            oc[t["outcome"]] = oc.get(t["outcome"], 0) + 1
        print(f"{i['id']:14s} {len(rs):5d} " + " ".join(f"{sum(t[c] is not None for t in rs):8d}" for c in cols)
              + "  " + ", ".join(f"{k}:{v}" for k, v in sorted(oc.items())))
    if errs:
        print(f"\nVALIDATION: {len(errs)} problem(s)")
        for e in errs[:50]:
            print("  -", e)
        sys.exit(1)
    print("\nVALIDATION: OK")


if __name__ == "__main__":
    main()
