#!/usr/bin/env python3
"""EMBER content pipeline: fetch source texts and (optionally) extract atomic claims with Claude.

What it does
------------
1. For each of the 15 EMBER investigations, fetch the source texts we cite:
     * the PSI investigation record (JSON API behind the PSI Angular site:
       https://psi.nasa.gov/geode-py/ws/repo/investigations/PSI-NN) -> objective / approach / research impacts
     * curated NTRS citations (https://ntrs.nasa.gov/api/citations/<id>) -> title + abstract
     * optional NTRS keyword searches (results kept only if they mention the investigation)
   Everything is written to pipeline/content/cache/ (raw JSON + a normalized `sources.json`).

2. IF the environment has ANTHROPIC_API_KEY (or another credential the Anthropic SDK resolves),
   ask Claude (model `claude-opus-5-5`, structured JSON output) to extract atomic, citable,
   fire-safety-relevant claims, each with a verbatim supporting quote. Every quote is then checked
   to occur verbatim (whitespace-normalized) in the cached source text; claims whose quote is not
   found are DROPPED. Output: web/public/data/claims.json (only with --write; otherwise
   pipeline/content/cache/claims.llm.json).

   Without a key the script only refreshes the source cache (step 1) and, with --verify, checks
   the quotes of the existing claims.json against the cache.

Usage
-----
    python3 pipeline/content/extract_claims.py              # fill missing cache entries (+ extract if key present)
    python3 pipeline/content/extract_claims.py --refresh    # re-download every source
    python3 pipeline/content/extract_claims.py --offline    # use cache only, no network
    python3 pipeline/content/extract_claims.py --verify     # verify quotes in web/public/data/claims.json
    python3 pipeline/content/extract_claims.py --write      # with a key: overwrite web/public/data/claims.json
"""
from __future__ import annotations

import argparse
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
CACHE = Path(__file__).resolve().parent / "cache"
DATA = ROOT / "web" / "public" / "data"
UA = "EMBER-content-pipeline/1.0 (NASA Space Apps 2026; research use)"

MODEL = "claude-opus-5-5"
REFRESH = False  # set by --refresh: re-download sources even if cached

# --------------------------------------------------------------------------------------
# Source configuration. ntrs: curated NTRS ids; search: (query, regex the result must match)
# --------------------------------------------------------------------------------------
INVESTIGATIONS: dict[str, dict] = {
    "BASS": {"psi": "PSI-26", "ntrs": ["20140011099", "20150008961", "20150008962", "20210011385"],
             "search": [("BASS experiment microgravity flammability", r"\bBASS\b(?!-II)")]},
    "BASS-II": {"psi": "PSI-25", "ntrs": ["20210011385", "20150008962", "20160000593", "20150019858", "20170006615",
                                           "20160012691"],
                "search": [("BASS-II microgravity", r"BASS-II|BASS II")]},
    "Saffire-I": {"psi": "PSI-98", "ntrs": ["20170000230", "20170001636", "20180005168", "20150000894",
                                             "20130000677"]},
    "Saffire-II": {"psi": "PSI-99", "ntrs": ["20150022421", "20200000557"]},
    "Saffire-III": {"psi": "PSI-100", "ntrs": []},
    "FLEX": {"psi": "PSI-69", "ntrs": ["20150023456", "20090014812", "20130014061", "20140006750", "20150018397",
                                       "20160000344"]},
    "FLEX-2": {"psi": "PSI-68", "ntrs": ["20170000666"]},
    "SAME": {"psi": "PSI-102", "ntrs": ["20070031686", "20040053578", "20170007283"]},
    "SAME-R": {"psi": "PSI-101", "ntrs": ["20130000422", "20150010172"]},
    "CFI": {"psi": "PSI-39", "ntrs": ["20205008449", "20250001364"]},
    "ACME-BRE": {"psi": "PSI-20", "ntrs": ["20160010073", "20170009141"]},
    "ACME-CFI-G": {"psi": "PSI-159", "ntrs": ["20210015913", "20220015583"]},
    "ACME-E-FIELD": {"psi": "PSI-22", "ntrs": ["20220007191"]},
    "SPICE": {"psi": "PSI-107", "ntrs": ["20090014827", "20140017780"]},
    "SLICE": {"psi": "PSI-106", "ntrs": ["20160012298", "20150011070"]},
}

# Context sources (missions / exploration atmosphere / ventilation), not tied to one investigation.
CONTEXT_NTRS = ["20240003211", "20220009536", "20150021491", "20090012334", "20080034883",
                "20260002050", "20260003925", "20240013238", "19990053973", "20050199446",
                "20250010653", "20210020516", "20210017780", "20050217475"]

PSI_FIELDS = [("objective", "Objective"), ("approach", "Approach"), ("researchImpacts", "Research impacts"),
              ("hypothesis", "Hypothesis"), ("description", "Description")]


# --------------------------------------------------------------------------------------
# Fetch helpers
# --------------------------------------------------------------------------------------
def http_json(url: str, retries: int = 3) -> dict:
    last = None
    for i in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except (OSError, json.JSONDecodeError) as e:  # URLError, timeouts, connection resets
            last = e
            time.sleep(2 * (i + 1))
    raise RuntimeError(f"fetch failed: {url}: {last}")


def clean(text: str | None) -> str:
    """Strip HTML tags/entities and normalize whitespace (same normalization used for quote checks)."""
    if not text:
        return ""
    t = re.sub(r"(?i)<br\s*/?>|</p>|</li>", "\n", text)
    t = re.sub(r"<[^>]+>", "", t)
    t = html.unescape(t).replace("\xa0", " ")
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r"\s*\n\s*", "\n", t)
    return t.strip()


def norm(s: str) -> str:
    """Normalization for verbatim-quote matching: unify quotes/dashes, collapse whitespace."""
    s = s.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    s = s.replace("–", "-").replace("—", "-").replace("‐", "-").replace("‑", "-")
    return re.sub(r"\s+", " ", s).strip().lower()


def cached(path: Path, url: str, offline: bool) -> dict | None:
    if path.exists() and (offline or not REFRESH):
        return json.loads(path.read_text())
    if offline:
        return None
    try:
        d = http_json(url)
    except RuntimeError as e:
        print(f"  ! {e}", file=sys.stderr)
        return json.loads(path.read_text()) if path.exists() else None
    path.write_text(json.dumps(d, indent=1, ensure_ascii=False))
    return d


def psi_source(inv: str, psi: str, offline: bool) -> dict | None:
    d = cached(CACHE / f"psi-{psi}.json", f"https://psi.nasa.gov/geode-py/ws/repo/investigations/{psi}", offline)
    if not d:
        return None
    parts = [f"{d.get('title', '')} ({d.get('investigationAcronym', '')})"]
    for key, label in PSI_FIELDS:
        v = clean(d.get(key))
        if v:
            parts.append(f"{label}: {v}")
    return {
        "sourceId": psi.lower(), "inv": [inv], "type": "psi",
        "label": f"{psi} investigation page ({d.get('investigationAcronym', inv)})",
        "url": f"https://psi.nasa.gov/physci/repo/data/investigations/{psi}",
        "doi": d.get("doi"), "text": "\n".join(parts),
    }


def ntrs_source(nid: str, invs: list[str], offline: bool) -> dict | None:
    d = cached(CACHE / f"ntrs-{nid}.json", f"https://ntrs.nasa.gov/api/citations/{nid}", offline)
    if not d or not d.get("abstract"):
        return None
    year = (d.get("distributionDate") or d.get("created") or "")[:4]
    return {
        "sourceId": f"ntrs-{nid}", "inv": invs, "type": "ntrs",
        "label": f"NTRS {nid}: {clean(d.get('title'))}", "year": year,
        "url": f"https://ntrs.nasa.gov/citations/{nid}",
        "text": clean(d.get("title")) + "\n" + clean(d.get("abstract")),
    }


def ntrs_search(query: str, size: int = 10) -> list[dict]:
    url = "https://ntrs.nasa.gov/api/citations/search?" + urllib.parse.urlencode({"q": query, "page.size": size})
    return http_json(url).get("results", [])


def build_sources(offline: bool) -> list[dict]:
    CACHE.mkdir(parents=True, exist_ok=True)
    by_id: dict[str, dict] = {}

    def add(src: dict | None):
        if not src:
            return
        if src["sourceId"] in by_id:
            for i in src["inv"]:
                if i not in by_id[src["sourceId"]]["inv"]:
                    by_id[src["sourceId"]]["inv"].append(i)
        else:
            by_id[src["sourceId"]] = src

    for inv, cfg in INVESTIGATIONS.items():
        print(f"[{inv}]", file=sys.stderr)
        add(psi_source(inv, cfg["psi"], offline))
        ids = list(cfg.get("ntrs", []))
        if not offline:
            for q, pat in cfg.get("search", []):
                try:
                    for r in ntrs_search(q):
                        blob = (r.get("title") or "") + " " + (r.get("abstract") or "")
                        if re.search(pat, blob) and str(r["id"]) not in ids:
                            ids.append(str(r["id"]))
                except RuntimeError as e:
                    print(f"  ! search failed: {e}", file=sys.stderr)
        for nid in ids:
            add(ntrs_source(nid, [inv], offline))
    for nid in CONTEXT_NTRS:
        add(ntrs_source(nid, [], offline))

    sources = sorted(by_id.values(), key=lambda s: s["sourceId"])
    (CACHE / "sources.json").write_text(json.dumps(sources, indent=1, ensure_ascii=False))
    print(f"cached {len(sources)} sources -> {CACHE / 'sources.json'}", file=sys.stderr)
    return sources


# --------------------------------------------------------------------------------------
# Quote verification
# --------------------------------------------------------------------------------------
def quote_in_source(quote: str, src_text: str) -> bool:
    q = norm(quote).strip(" .")
    return bool(q) and q in norm(src_text)


def verify_claims(claims: list[dict], sources: list[dict]) -> dict:
    by_id = {s["sourceId"]: s for s in sources}
    ok, missing_src, bad = [], [], []
    for c in claims:
        s = by_id.get(c.get("sourceId"))
        if s is None:
            missing_src.append(c["id"])
        elif quote_in_source(c.get("quote", ""), s["text"]):
            ok.append(c["id"])
        else:
            bad.append(c["id"])
    return {"n": len(claims), "verbatim": len(ok), "notFound": bad, "sourceNotCached": missing_src}


# --------------------------------------------------------------------------------------
# LLM extraction (only when a credential is available)
# --------------------------------------------------------------------------------------
TOPICS = ["prevention", "detection", "suppression", "fundamental", "oxygen-limit", "flow", "pressure",
          "smoke", "droplet", "solid", "gas", "cool-flame", "partial-gravity", "large-scale", "material-test",
          "soot", "electric-field", "hardware"]

CLAIM_SCHEMA = {
    "type": "object",
    "properties": {
        "claims": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "sourceId": {"type": "string"},
                    "text": {"type": "string"},
                    "quote": {"type": "string"},
                    "topic": {"type": "array", "items": {"type": "string", "enum": TOPICS}},
                },
                "required": ["sourceId", "text", "quote", "topic"],
                "additionalProperties": False,
            },
        }
    },
    "required": ["claims"],
    "additionalProperties": False,
}

SYSTEM = (
    "You extract atomic, citable statements from NASA microgravity-combustion source texts for a fire-safety "
    "evidence dashboard used by spacecraft and lunar-habitat engineers. Each claim must state exactly one fact "
    "that the source supports, in plain English, keeping numbers and units exactly as the source gives them. "
    "Each claim needs a `quote`: a contiguous, verbatim, character-for-character span copied from the source "
    "text (no ellipses, no paraphrase, no added words) that on its own supports the claim. Prefer facts that "
    "answer design questions: oxygen limits for self-extinction, effects of flow velocity, smoke particle sizes, "
    "amounts of CO2/He diluent needed for extinction, comparison with the NASA-STD-6001 Test 1 method, "
    "large-scale (Saffire) results, cool flames, partial gravity. Do not include facts that are only in your "
    "background knowledge. If a source has nothing useful, return no claims for it."
)


def extract_with_claude(sources: list[dict]) -> list[dict]:
    import anthropic  # imported lazily so the cache refresh works without the SDK installed

    client = anthropic.Anthropic()
    out: list[dict] = []
    for inv in INVESTIGATIONS:
        srcs = [s for s in sources if inv in s["inv"]]
        if not srcs:
            continue
        docs = "\n\n".join(f'<source id="{s["sourceId"]}">\n{s["text"]}\n</source>' for s in srcs)
        prompt = (f"Investigation: {inv}\n\nSources:\n{docs}\n\n"
                  f"Extract 4-10 claims about {inv} across these sources (use the source id exactly).")
        try:
            resp = client.messages.create(
                model=MODEL,
                max_tokens=16000,
                system=SYSTEM,
                messages=[{"role": "user", "content": prompt}],
                output_config={"effort": "high",
                               "format": {"type": "json_schema", "schema": CLAIM_SCHEMA}},
            )
        except anthropic.RateLimitError as e:
            print(f"  ! rate limited on {inv}: {e}", file=sys.stderr)
            continue
        except anthropic.APIStatusError as e:
            print(f"  ! API error {e.status_code} on {inv}: {e.message}", file=sys.stderr)
            continue
        except anthropic.APIConnectionError as e:
            print(f"  ! connection error on {inv}: {e}", file=sys.stderr)
            continue
        if resp.stop_reason == "refusal":
            print(f"  ! refusal on {inv}: {resp.stop_details}", file=sys.stderr)
            continue
        if resp.stop_reason == "max_tokens":
            print(f"  ! output truncated on {inv}; skipping", file=sys.stderr)
            continue
        text = next((b.text for b in resp.content if b.type == "text"), "")
        try:
            claims = json.loads(text)["claims"]
        except (json.JSONDecodeError, KeyError) as e:
            print(f"  ! unparsable output on {inv}: {e}", file=sys.stderr)
            continue
        by_id = {s["sourceId"]: s for s in srcs}
        kept = 0
        for c in claims:
            s = by_id.get(c["sourceId"])
            if s is None or not quote_in_source(c["quote"], s["text"]):
                continue  # drop: quote not verbatim in the cited source
            out.append({"inv": inv, "text": c["text"], "quote": c["quote"], "sourceId": s["sourceId"],
                        "sourceUrl": s["url"], "topic": c["topic"], "extractedBy": "llm"})
            kept += 1
        print(f"[{inv}] {kept}/{len(claims)} claims kept after verbatim-quote check", file=sys.stderr)
    for i, c in enumerate(out, 1):
        c["id"] = f"c-{i:04d}"
    return [{"id": c["id"], **{k: v for k, v in c.items() if k != "id"}} for c in out]


def have_credentials() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"))


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--offline", action="store_true", help="use cached sources only (no network at all)")
    ap.add_argument("--refresh", action="store_true", help="re-download sources that are already cached")
    ap.add_argument("--verify", action="store_true", help="verify quotes of web/public/data/claims.json")
    ap.add_argument("--write", action="store_true", help="write extracted claims to web/public/data/claims.json")
    args = ap.parse_args()
    global REFRESH
    REFRESH = args.refresh

    sources = build_sources(args.offline)

    if args.verify:
        claims = json.loads((DATA / "claims.json").read_text())
        rep = verify_claims(claims, sources)
        print(json.dumps(rep, indent=1))
        return 0 if not rep["notFound"] and not rep["sourceNotCached"] else 1

    if not have_credentials():
        print("No ANTHROPIC_API_KEY set: source cache refreshed, extraction skipped.", file=sys.stderr)
        return 0

    claims = extract_with_claude(sources)
    target = DATA / "claims.json" if args.write else CACHE / "claims.llm.json"
    target.write_text(json.dumps(claims, indent=1, ensure_ascii=False))
    print(f"wrote {len(claims)} verified claims -> {target}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
