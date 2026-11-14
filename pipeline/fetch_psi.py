#!/usr/bin/env python3
"""Download PSI investigation metadata + experimental tables for EMBER.

PSI (https://psi.nasa.gov/physci/repo/) is an Angular app backed by a JSON API
(discovered by reading the main.*.js bundle):

  GET /geode-py/ws/repo/investigations/PSI-NN          -> full investigation record
      (title, doi, objective, hypothesis, approach, researchImpacts, publications,
       experimentalTable[], added[] = every file in the current version)
  GET /geode-py/ws/studies/PSI-NN/download?file=<name>&redirect=false
      -> text body = short-lived presigned S3 URL for that file
  GET /geode-py/ws/repo/search?q=...                   -> Elasticsearch-style search

Outputs (originals kept untouched):
  data/raw/PSI-NN/investigation.json       full API record
  data/raw/PSI-NN/<file>                   experimental table(s) + selected small docs
  data/raw/fetch_log.json                  url, sha256, size per file

Usage:  python3 pipeline/fetch_psi.py [--force] [--ntrs] [--tm]
"""
import argparse, hashlib, json, os, sys, time, datetime
from pathlib import Path
import requests

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / "data" / "raw"
API = "https://psi.nasa.gov/geode-py/ws"
MAX_BYTES = 50 * 1024 * 1024

# EMBER id -> PSI accession (verified against the API on 2026-11-14)
INVESTIGATIONS = {
    "BASS-II": "PSI-25", "BASS": "PSI-26",
    "Saffire-I": "PSI-98", "Saffire-II": "PSI-99", "Saffire-III": "PSI-100",
    "FLEX": "PSI-69", "FLEX-2": "PSI-68",
    "SAME": "PSI-102", "SAME-R": "PSI-101",
    "CFI": "PSI-39", "ACME-BRE": "PSI-20", "ACME-CFI-G": "PSI-159",
    "ACME-E-FIELD": "PSI-22", "SPICE": "PSI-107", "SLICE": "PSI-106",
}

# Extra small files (science-document spreadsheets / readmes) worth keeping.
EXTRA_FILES = {
    "PSI-25": ["PSI-25_Science Documents_BASS-II_Test.Matrices.xlsx",
               "PSI-25_Science Documents_BASS-II_ReadMe.docx"],
    "PSI-26": ["PSI-26_Science Documents_As Run_Test Matrix.xlsx",
               "PSI-26_Science Documents_Planned_Test Matrix.xlsx"],
    "PSI-39": ["PSI-39_Science Documents_CFI_DataSummary_Spreadsheet_Jan2021.xlsx"],
    "PSI-98": ["PSI-98_Science Documents_SAFFIRE-I and SAFFIRE-III Readme.docx"],
    # per-test results that are not in the PSI experimental tables
    "PSI-101": ["PSI-101_Analyzed Data_SAME, SAME-R_Results.xlsx",
                "PSI-101_Reports_SAME-R_Final Report.pdf"],
    "PSI-102": ["PSI-102_Reports_SAME_Final Science Report.pdf"],
    "PSI-107": ["PSI-107_Reports_SPICE_FinalReport.pdf",
                "PSI-107_Reports_SMOKE POINTS OF MICROGRAVITY AND  NORMAL GRAVITY COFLOW DIFFUSION  FLAMES_DotsonThesis.pdf",
                "PSI-107_Raw Data_Spice Flight Test Data II modified.xls",
                "PSI-107_Raw Data_Spice_Flight_Flamelength.xls",
                "PSI-107_Raw Data_SmokePointReview-0g-3.xlsx"],
}

# NTRS queries used to locate at least one NASA report per investigation.
NTRS_QUERIES = {
    "BASS-II": "Burning and Suppression of Solids II BASS-II",
    "BASS": "Burning and Suppression of Solids BASS microgravity",
    "Saffire-I": "Saffire spacecraft fire safety experiment Cygnus",
    "Saffire-II": "Saffire-II spacecraft fire experiment",
    "Saffire-III": "Saffire-III spacecraft fire experiment",
    "FLEX": "Flame Extinguishment Experiment FLEX droplet",
    "FLEX-2": "bi-component droplet combustion ISS",
    "SAME": "Smoke Aerosol Measurement Experiment SAME",
    "SAME-R": "smoke aerosol reflight",
    "CFI": "cool flame droplet International Space Station dodecane",
    "ACME-BRE": "Burning Rate Emulator",
    "ACME-CFI-G": "Advanced Combustion via Microgravity Experiments",
    "ACME-E-FIELD": "ACME E-FIELD",
    "SPICE": "Smoke Point In Co-flow Experiment",
    "SLICE": "Structure and Liftoff In Combustion Experiment",
}

# NTRS citation records cited in pipeline/cards.py (abstracts kept for provenance)
NTRS_RECORDS = ["20210011385", "20160000593", "20150019858", "20140011099", "20170001636", "20170000230",
                "20170008805", "20200000557", "20150023456", "20090014812", "20130014061", "20130000422",
                "20150010172", "20070031686", "20205008449", "20170009141", "20160010073", "30580252934587",
                "20220015583", "20210021781", "20210015913", "20090014827", "20140017780", "20150002322",
                "20170000666", "20170007283"]

S = requests.Session()
S.headers["User-Agent"] = "EMBER-NASA-SpaceApps-2026/1.0 (research; data pipeline)"


def get(url, **kw):
    for attempt in range(4):
        try:
            r = S.get(url, timeout=180, **kw)
            r.raise_for_status()
            return r
        except Exception as e:  # noqa
            if attempt == 3:
                raise
            print(f"   retry {attempt+1}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))


def sha256(p):
    h = hashlib.sha256()
    with open(p, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def download_file(acc, fname, dest, force):
    if dest.exists() and not force:
        return None
    presigned = get(f"{API}/studies/{acc}/download",
                    params={"file": fname, "redirect": "false"}).text.strip()
    r = get(presigned)
    dest.write_bytes(r.content)
    return presigned


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", action="store_true", help="re-download existing files")
    ap.add_argument("--ntrs", action="store_true", help="refresh NTRS search results and citation records")
    ap.add_argument("--tm", action="store_true", help="download BASS-II TM-20210011385 and store its text (needs pdftotext)")
    a = ap.parse_args()
    log_path = RAW / "fetch_log.json"
    log = json.loads(log_path.read_text()) if log_path.exists() else {"files": {}}
    for inv, acc in INVESTIGATIONS.items():
        d = RAW / acc
        d.mkdir(parents=True, exist_ok=True)
        meta_p = d / "investigation.json"
        print(f"[{inv}] {acc}")
        if a.force or not meta_p.exists():
            meta = get(f"{API}/repo/investigations/{acc}").json()
            meta_p.write_text(json.dumps(meta, indent=1, ensure_ascii=False))
        meta = json.loads(meta_p.read_text())
        assert meta.get("accession") == acc, f"accession mismatch for {acc}"
        sizes = {f["file_name"]: f.get("file_size") or 0 for f in meta.get("added", [])}
        wanted = [f["file_name"] for f in (meta.get("experimentalTable") or [])]
        wanted += [f for f in EXTRA_FILES.get(acc, []) if f in sizes]
        for fname in wanted:
            if sizes.get(fname, 0) > MAX_BYTES:
                print(f"   skip (>50MB) {fname}")
                continue
            dest = d / fname
            try:
                url = download_file(acc, fname, dest, a.force)
            except Exception as e:
                print(f"   FAILED {fname}: {e}")
                continue
            rel = str(dest.relative_to(ROOT))
            entry = log["files"].get(rel, {})
            entry.update({"inv": inv, "psi": acc, "file": fname,
                          "url": f"https://psi.nasa.gov/physci/repo/data/investigations/{acc}",
                          "apiDownload": f"{API}/studies/{acc}/download?file={requests.utils.quote(fname)}",
                          "sha256": sha256(dest), "bytes": dest.stat().st_size,
                          "license": meta.get("licenseIdentifier")})
            if url:
                entry["fetchedAt"] = datetime.datetime.now(datetime.timezone.utc).isoformat()
            log["files"][rel] = entry
            print(f"   ok {fname} ({dest.stat().st_size} B)")
        # NTRS search results (raw JSON kept for provenance)
        ntrs_p = d / "ntrs_search.json"
        if a.ntrs or not ntrs_p.exists():
            try:
                r = get("https://ntrs.nasa.gov/api/citations/search",
                        params={"q": NTRS_QUERIES[inv], "page.size": 10})
                ntrs_p.write_text(json.dumps(r.json(), indent=1, ensure_ascii=False))
            except Exception as e:
                print(f"   NTRS failed: {e}")
    nd = RAW / "ntrs"
    nd.mkdir(exist_ok=True)
    for nid in NTRS_RECORDS:
        p = nd / f"{nid}.json"
        if a.ntrs or not p.exists():
            try:
                p.write_text(json.dumps(get(f"https://ntrs.nasa.gov/api/citations/{nid}").json(), indent=1, ensure_ascii=False))
            except Exception as e:
                print(f"   NTRS {nid} failed: {e}")
    if a.tm:
        # BASS-II Summary Report (49 MB PDF, not kept); only the extracted text is stored.
        import subprocess, tempfile
        with tempfile.TemporaryDirectory() as td:
            pdf = Path(td) / "tm.pdf"
            pdf.write_bytes(get("https://ntrs.nasa.gov/api/citations/20210011385/downloads/TM-20210011385.pdf").content)
            subprocess.run(["pdftotext", "-layout", str(pdf), str(nd / "TM-20210011385.txt")], check=False)
    log_path.write_text(json.dumps(log, indent=1))
    print("done")


if __name__ == "__main__":
    main()
