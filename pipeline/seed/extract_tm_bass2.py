#!/usr/bin/env python3
"""Extract the per-test observation column of NASA/TM-20210011385 Appendix A (BASS-II test matrices).

The appendix tables (pages 111-121 of the PDF) are landscape tables whose last column,
"Test observations and anomalies (ignited, spread, extinguished, burn time, color, etc.)",
wraps over several lines. `pdftotext -layout` interleaves those wrapped lines with other
columns, so this script uses word coordinates (`pdftotext -bbox`) instead:

  * each table row is anchored by its test-number word (B1, F2, P13a, ...),
  * every word to the right of the page's observation-column edge between two anchors
    belongs to that row's observation text.

Output: data/raw/ntrs/TM-20210011385_appendixA.json  (list of rows, see below)
It is a derived file kept in data/raw because the 49 MB PDF itself is not stored.
build_dataset.py reads it offline.

Usage:  python3 pipeline/seed/extract_tm_bass2.py [path/to/TM-20210011385.pdf]
        (without a path the PDF is downloaded from NTRS into a temp dir; needs pdftotext)
"""
import html, json, re, subprocess, sys, tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "data" / "raw" / "ntrs" / "TM-20210011385_appendixA.json"
URL = "https://ntrs.nasa.gov/api/citations/20210011385/downloads/TM-20210011385.pdf"
FIRST, LAST = 111, 121  # PDF pages holding Tables A.1-A.6
ID_RE = re.compile(r"^[BFPMOT]\d{1,2}[ab]?$")
WORD_RE = re.compile(r'<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*?)</word>')


def pages_words(pdf):
    out = subprocess.run(["pdftotext", "-f", str(FIRST), "-l", str(LAST), "-bbox", str(pdf), "-"],
                         check=True, capture_output=True, text=True).stdout
    pages = []
    for chunk in out.split("<page ")[1:]:
        ws = [(float(a), float(b), float(c), float(d), html.unescape(t)) for a, b, c, d, t in WORD_RE.findall(chunk)]
        pages.append(ws)
    return pages


def reading_order(ws, tol=5.0):
    """Group words into lines (y within tol, so subscripts stay on their line), then sort by x."""
    lines = []
    for w in sorted(ws, key=lambda w: w[1]):
        if lines and w[1] - lines[-1][0] <= tol:
            lines[-1][1].append(w)
        else:
            lines.append([w[1], [w]])
    return [w for _, ln in lines for w in sorted(ln, key=lambda w: w[0])]


def extract(pdf):
    rows = []
    for pno, words in enumerate(pages_words(pdf), start=FIRST):
        # table caption
        cap = " ".join(w[4] for w in sorted(words, key=lambda w: (round(w[1]), w[0])) if w[1] < 200)
        m = re.search(r"TABLE A\.(\d)", cap)
        if not m:
            continue
        table = f"A.{m.group(1)}"
        # observation column edge: the header word 'Test' directly left of 'observations'
        obs_hdr = [w for w in words if w[4] == "observations"]
        if not obs_hdr:
            continue
        oh = obs_hdr[0]
        # left edge of the observation column = just right of the 'Final CO, ppm' header (last 'ppm')
        ppm = [w for w in words if w[4] == "ppm" and w[1] < oh[1] + 120]
        x0 = (max(w[2] for w in ppm) + 3) if ppm else oh[0] - 36
        # test-number column: the header 'Test number' sits left of 'Sample number'
        anchors = [w for w in words if ID_RE.match(w[4]) and 120 < w[0] < 330 and w[1] > oh[3]]
        anchors.sort(key=lambda w: w[1])
        # footnote block starts at the first single-letter line in the left margin below the table
        foot = [w[1] for w in words if re.fullmatch(r"[a-h]", w[4]) and w[0] < 60 and w[1] > oh[3]]
        y_end = min(foot) if foot else 10_000
        for k, a in enumerate(anchors):
            y_top = a[1] - 3
            y_bot = anchors[k + 1][1] - 3 if k + 1 < len(anchors) else y_end
            line = sorted([w for w in words if abs(w[1] - a[1]) < 3], key=lambda w: w[0])
            first_tokens = [w[4] for w in line if w[0] < x0]
            obs = " ".join(w[4] for w in reading_order([w for w in words if w[0] >= x0 and y_top <= w[1] < y_bot]))
            obs = re.sub(r"\b(C?O) 2\b", r"\g<1>2", obs)       # subscript 2 in O2 / CO2
            obs = re.sub(r"(\w)- (\w)", r"\1-\2", obs).strip()
            # cells in the left part of the row (all lines between anchors), for the material column etc.
            block = reading_order([w for w in words if w[0] < x0 and y_top <= w[1] < y_bot])
            rows.append({"table": table, "page": pno, "testId": a[4], "y": round(a[1], 1),
                         "firstLineTokens": first_tokens,
                         "leftBlockText": " ".join(w[4] for w in block),
                         "observations": obs})
    return rows


def main():
    if len(sys.argv) > 1:
        rows = extract(Path(sys.argv[1]))
    else:
        import requests
        with tempfile.TemporaryDirectory() as td:
            pdf = Path(td) / "tm.pdf"
            pdf.write_bytes(requests.get(URL, timeout=600).content)
            rows = extract(pdf)
    OUT.write_text(json.dumps({"source": "NASA/TM-20210011385 Appendix A (Tables A.1-A.6)", "url": URL,
                               "pages": [FIRST, LAST], "method": "pdftotext -bbox word coordinates",
                               "rows": rows}, indent=1, ensure_ascii=False))
    print(f"{len(rows)} rows -> {OUT.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
