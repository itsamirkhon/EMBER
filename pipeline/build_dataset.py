#!/usr/bin/env python3
"""Normalize raw PSI downloads (data/raw/PSI-NN) into the EMBER JSON contract.

Outputs (see docs/DATA_CONTRACT.md):
  web/public/data/tests.json
  web/public/data/investigations.json
  web/public/data/datasets_manifest.json

Rules: values are only taken from source files; anything unknown is null and
explained in the investigation's dataNotes. Every source column that is not
mapped to a contract field is kept verbatim in `extra`.

Usage: python3 pipeline/build_dataset.py   (after pipeline/fetch_psi.py)
"""
import csv, datetime, hashlib, io, json, math, re, sys
from pathlib import Path
from urllib.parse import quote

import openpyxl

sys.path.insert(0, str(Path(__file__).resolve().parent))
from cards import CARDS  # noqa: E402  hand-curated card text (with sources)

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
OUT = ROOT / "web" / "public" / "data"

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
                burningRateMm2S=None, particleSizeNm=None, extra={})
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


# --------------------------------------------------------------------------- BASS-II (PSI-25)

def bass2():
    inv, psi, src = "BASS-II", "PSI-25", "psi-25"
    fname = "PSI-25_Experimental table_BASS-II.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
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
        txt = (d["Fan display"] + " | " + air).lower()
        if "no ign" in txt:
            outcome, oraw = "no_ignition", "no ignition"
        elif "blowoff" in txt or "blow off" in txt:
            outcome, oraw = "extinguished", "blowoff"
        elif re.search(r"\bext\b|extinguished|\bout\b|ext after", txt):
            outcome, oraw = "extinguished", "flame extinguished (flow reduced)"
        else:
            outcome, oraw = "unknown", None
        used = {"Test #", "Fuel Sample Material", "Calibrated  initial O2 % by vol"}
        extra = blank_extra(d, used)
        extra["materialRaw"] = mat
        if inferred:
            extra["fuelInferredFrom"] = "BASS-II ReadMe (PI sample descriptions)"
        if outcome != "unknown":
            extra["outcomeDerivedFrom"] = "keywords in 'Fan display'/'Air display' text"
        m = re.search(r"(\d+(?:\.\d+)?)\s*cm\s*(?:wide)?", ml)
        if m and geom != "cylinder (rod)" and geom != "spherical section":
            extra["sampleWidthCm"] = float(m.group(1))
        out.append(row(inv, f"BASS-II-{d['Test #']}", src, fname, rn, fuel=fuel, fuelPhase="solid",
                       geometry=geom, thicknessMm=thick, diameterMm=dia,
                       o2Pct=num(d["Calibrated  initial O2 % by vol"]), flowCmS=flow, diluent="N2",
                       outcome=outcome, outcomeRaw=oraw, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "PSI table has no flame-spread-rate column; spreadRateMmS is null for all BASS-II rows.")
    note(inv, "PSI table has no pressure column; pressureKpa is null (tests ran in the MSG working volume at ISS cabin pressure, value not tabulated).")
    note(inv, "flowCmS = first value of the 'Air display' column (duct flow speed in cm/s per the BASS-II ReadMe); flow was usually stepped during a test and the full sequence is kept in extra['Air display'].")
    note(inv, "PSI table has no explicit outcome column. Outcome is derived only where the fan/air text says 'ext', 'extinguished', 'blowoff' or 'no ign'; all other rows are 'unknown' (most tests did ignite and burn).")
    note(inv, "o2Pct = 'Calibrated initial O2 % by vol'. Some 'final O2' values (e.g. 1.6, 0.6, 39.1, 40.4) are clearly sensor artefacts and are kept only in extra.")
    note(inv, "Rod diameters converted from inches (1/4\" = 6.35 mm, 3/8\" = 9.525 mm, 1/2\" = 12.7 mm). Two rows are dated 2018 in the source (T9, T18) although GMT 175 matches 2014 — kept as given in extra.")
    note(inv, "NASA/TM-20210011385 (BASS-II Summary Report) Appendix A repeats these test matrices with an extra 'Test observations and anomalies (ignited, spread, extinguished...)' column; it is only available as a multi-page PDF layout (text dump in data/raw/ntrs/TM-20210011385.txt) and is not yet parsed, so outcomes here come from the PSI table only.")
    return out


# --------------------------------------------------------------------------- BASS (PSI-26)

def bass_obs_outcome(text):
    """Indicative outcome from the free-text observation column (keyword rules)."""
    raw = (text or "").strip()
    t = raw.lower()
    if not t:
        return "unknown", None
    # drop negated phrases so 'did not blow out' is not read as an extinction
    t = re.sub(r"(did not|didn't|not|never|no joy[^.]*?|would not)\s+(?:completely\s+)?(blow out|blow off|extinguish\w*|go out|went out)", " ", t)
    ignited = re.search(r"(?<!not )(?<!never )\bignited\b|\bign(?:ition)? (?:at|in|took)|\bign in\b|\bigniton\b|flame lit|good ignition|ignition was", t)
    rules = [
        ("no_ignition", r"no ignition on this test|no ignition|did not ignite|failed to ignite|no flame\.|just smoked|not even any smoke"
                        + ("" if ignited else r"|no joy|igniter (?:is )?broke|broke before ignition|igniter didn't work|igniter seems to have broken")),
        ("self_extinguished", r"self-extinguish|went out on its own|extinguished in ~|extinguished after \d|died when igniter|burned for only|did not sustain|not sustain|no luck keeping"),
        ("extinguished", r"extinguish|blew out|blow out|blowoff|went out|flame died|\bout at\b|flamed out"),
        ("completed", r"burned out|burned to completion|burned out all|ran out of fuel|fuel ran out|consumed"),
        ("burned", r"spread|burn|sooty|flame"),
    ]
    for outcome, pat in rules:
        if re.search(pat, t):
            return outcome, raw[:240]
    return "unknown", raw[:240]


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
            outcome, oraw = bass_obs_outcome(obs)
            extra["asRunRow"] = xrow
            extra["airDisplayCmS"] = air or None
            extra["fanDisplay"] = str(rec.get("Fan display")) if rec.get("Fan display") is not None else None
            extra["observations"] = obs or None
            extra["CO2_mmHg"] = num(rec.get("CO2, mm Hg"))
            extra["GN2 Pot"] = rec.get("GN2 Pot")
            extra["outcomeDerivedFrom"] = "keyword rules on 'Test Observations' (As Run Test Matrix.xlsx)"
            extra = {k: v for k, v in extra.items() if v not in (None, "", "None")}
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
    note(inv, "Outcome is derived by keyword rules from the free-text 'Test Observations' column; outcomeRaw keeps the first 240 characters of that text. Treat as indicative, not authoritative.")
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

def same():
    inv, psi, src = "SAME", "PSI-102", "psi-102"
    fname = "PSI-102_Experimental table_SAME.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
        mat = d["Sample Material"]
        same_as = "same conditions as 1-4" in mat
        name = mat.split(":")[0].strip()
        extra = {"materialRaw": mat, "Weight loss rate (mg/min)": num(d["Weight loss rate (mg/min)"]),
                 "Aging Duration (minutes)": num(d["Aging Duration (minutes)"]),
                 "testType": "smoke generation by heating below ignition (not a flame test)"}
        if same_as:
            extra["conditions"] = "same conditions as samples 1-4 (PSI table)"
        extra = {k: v for k, v in extra.items() if v is not None}
        out.append(row(inv, f"SAME-{d['Sample #']}", src, fname, rn, fuel=name, fuelPhase="solid",
                       geometry="heated sample (smoke source)", flowCmS=num(d["Air Flow (cm/s)"]), extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "The PSI SAME table is a condition summary: 4 Teflon rows (flow 5–10 cm/s, aging 1–20 min) and 4 further materials run at 'the same conditions as 1-4' (their numeric fields are null).")
    note(inv, "Smoke tests heat samples below ignition, so outcome is 'unknown' (no flame). Particle sizes are not in the PSI table (only in per-run analysed spreadsheets) -> particleSizeNm null.")
    return out


def same_r():
    inv, psi, src = "SAME-R", "PSI-101", "psi-101"
    fname = "PSI-101_Experimental table_SAME-R.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out = []
    for rn, d in rows:
        extra = blank_extra(d, {"Sample Type", "SAME Test #", "Inlet velocity (cm/s)"})
        extra["testType"] = "smoke generation by heating below ignition (not a flame test)"
        tid = f"SAME-R-{d['SAME Test #']}"
        if any(o["testId"] == tid for o in out):
            tid += f"-{d['Sample Type']}"
            note(inv, f"Test # {d['SAME Test #']} appears for two materials (reburn rows); testId suffixed with the material.")
        out.append(row(inv, tid, src, fname, rn, fuel=d["Sample Type"], fuelPhase="solid",
                       geometry="heated sample (smoke source)", flowCmS=num(d["Inlet velocity (cm/s)"]), extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "Rows with an 'a' suffix (e.g. 51a) are the aged-smoke measurement of the same burn; kept as separate rows as in the PSI table.")
    note(inv, "PSI table gives inlet velocity, heater ratio Rt/R0 and aging times only; particle size results (NTRS 20130000422: mostly 200–400 nm average) are not per-row in the table -> particleSizeNm null. Outcome 'unknown' (no flame).")
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


def spice():
    inv, psi, src = "SPICE", "PSI-107", "psi-107"
    fname = "PSI-107_Experimental table_Spice.csv"
    _, rows = read_csv(psi_file(psi, fname))
    out, neg = [], 0
    seen = {}
    for rn, d in rows:
        air = num(d["Air Rate (cm/s)"])
        if air is not None and air < 0:
            neg += 1
            air_v = None
        else:
            air_v = air
        base = f"SPICE-{d['GMT date']}-{d['GMT ignition'].replace(':', '')}"
        seen[base] = seen.get(base, 0) + 1
        extra = blank_extra(d, {"Fuel", "Nozzle (mm)", "Air Rate (cm/s)"})
        if air is not None and air < 0:
            extra["airRateRaw"] = air
        out.append(row(inv, f"{base}-{seen[base]}", src, fname, rn, fuel=d["Fuel"].replace("75% ", "75 % "),
                       fuelPhase="gas", geometry="round nozzle, co-flow jet flame", diameterMm=num(d["Nozzle (mm)"]),
                       flowCmS=air_v, extra=extra))
    FILES_USED.append((inv, psi_file(psi, fname), len(out)))
    note(inv, "Each row is one fuel-flow/air-flow setting of an ignited jet flame (several rows share one ignition). flowCmS = co-flow air velocity; nozzle inner diameter in diameterMm.")
    if neg:
        note(inv, f"{neg} rows have a negative air rate (sensor offset at fan-off); flowCmS set to null, raw value in extra.airRateRaw.")
    note(inv, "The table has no smoke-point flag, O2 or pressure (co-flow is cabin air in the MSG) -> outcome 'unknown', o2Pct/pressureKpa null.")
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

ENUM = {"burned", "extinguished", "no_ignition", "flame_spread", "self_extinguished", "completed", "disruption", "unknown"}
PLAUSIBLE = {"o2Pct": (0, 100), "pressureKpa": (10, 600), "flowCmS": (0, 100), "gravityG": (0, 1),
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
    cols = ["o2Pct", "pressureKpa", "flowCmS", "diameterMm", "thicknessMm", "spreadRateMmS", "burningRateMm2S"]
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
