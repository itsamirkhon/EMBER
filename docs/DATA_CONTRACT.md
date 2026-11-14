# EMBER data contract

All runtime data lives in `web/public/data/` as JSON and is loaded by the frontend with `fetch('data/<file>.json')` (relative path, so the site works under a GitHub Pages sub-path).
Every field that is unknown is `null`, never invented. Every fact shown to the user must trace back to a `sources[]` entry.

Units (normalized, always): O2 in **% by volume**, pressure in **kPa**, flow velocity in **cm/s**, flame spread rate in **mm/s**, droplet burning-rate constant in **mm²/s**, diameters in **mm**, gravity in **g** (0 = microgravity, 1 = Earth).

Owners: `investigations.json`, `tests.json`, `datasets_manifest.json` → data pipeline (`pipeline/`).
`missions.json`, `claims.json`, `extraction_eval.json`, `earth.json`, `history.json` → content pipeline (`pipeline/content/`).
`validation.json` → backtest script (`web/scripts/backtest.ts`), generated from the two above.

---

## investigations.json

```jsonc
[
  {
    "id": "BASS-II",                 // short stable id, used everywhere as foreign key
    "name": "Burning and Suppression of Solids – II",
    "psi": "PSI-25",
    "psiUrl": "https://psi.nasa.gov/physci/repo/data/investigations/PSI-25",
    "doi": "10.60555/4qc4-de67",     // null if not found
    "doiVerified": true,             // true only if seen on the PSI page itself
    "family": "MSG-SPICE",           // "ACME-CIR" | "MDCA-CIR" | "MSG-SPICE" | "Saffire-Cygnus" | "SAME-MSG" | "other"
    "hardware": "Microgravity Science Glovebox, BASS flow duct",
    "platform": "ISS",               // "ISS" | "Cygnus" | ...
    "fuelPhase": "solid",            // "solid" | "liquid" | "gas"
    "direction": ["prevention"],     // subset of "prevention" | "detection" | "suppression" | "fundamental"
    "safetyConsequence": 3,          // 3 = direct fire-safety answer (BASS, Saffire, SAME, FLEX per challenge text), 2 = partial, 1 = fundamental combustion
    "objective": "…",
    "fuel": { "types": ["PMMA", "cotton-fiberglass (SIBAL)"], "geometry": "flat sheets, cylinders, spheres", "size": "…" },
    "conditions": {                  // ranges actually flown; null if unknown
      "o2Pct":       [14.0, 21.0],
      "pressureKpa": [50.0, 101.3],
      "flowCmS":     [0.0, 40.0],
      "gravityG":    [0.0, 0.0],
      "diluents": ["N2"]
    },
    "varied":   ["O2 concentration", "flow velocity", "sample thickness"],
    "constant": ["pressure ~1 atm (most tests)"],
    "diagnostics": ["color video", "radiometer", "thermocouples"],
    "resultSummary": "2–4 sentences, plain language.",
    "keyFindings": [ { "text": "…", "sourceId": "ntrs-20210011385" } ],
    "nTests": 126,                   // number of rows in tests.json for this investigation (or documented count if no table)
    "flight": true,
    "rawDataAvailable": true,
    "years": "2012–2013",
    "earthRelevance": "optional one sentence",
    "sources": [ { "id": "psi-25", "label": "PSI-25 investigation page", "url": "https://…", "type": "psi" | "ntrs" | "doi" | "nasa-web" | "paper" } ],
    "dataNotes": ["e.g. FLEX header says mm but unit is mm²/s — corrected", "3 rows differ between TM and PSI table"]
  }
]
```

## tests.json

One row per individual test / run. Rows exist only where the PSI table (or a cited NASA report table) provides them.

```jsonc
[
  {
    "inv": "BASS-II",                 // investigations.id
    "testId": "BASS-II-017",         // id as in source, prefixed if needed for uniqueness
    "fuel": "PMMA",                   // normalized material name
    "fuelPhase": "solid",
    "geometry": "flat sheet" ,        // free text, normalized when possible
    "thicknessMm": 0.25,              // solids; null otherwise
    "diameterMm": null,               // droplets/cylinders/burner
    "o2Pct": 16.5,
    "pressureKpa": 101.3,
    "flowCmS": 10.0,                  // null if quiescent unknown; 0 if explicitly quiescent
    "gravityG": 0,
    "diluent": "N2",                  // "N2" | "He" | "CO2" | "Xe" | null
    "diluentPct": null,               // for FLEX-style suppression tests
    "outcome": "burned",              // "burned" | "extinguished" | "no_ignition" | "flame_spread" | "self_extinguished" | "completed" | "disruption" | "unknown" — keep source wording in outcomeRaw
    "outcomeRaw": "flame spread to end",
    "spreadRateMmS": 0.42,            // null if not measured
    "burningRateMm2S": null,
    "particleSizeNm": null,           // SAME-style
    "extra": { },                     // any other source columns, untouched names
    "source": { "sourceId": "psi-25", "file": "BASS-II_test_matrix.xlsx", "row": 18 }
  }
]
```

## datasets_manifest.json

```jsonc
{ "generatedAt": "ISO date", "files": [ { "inv": "BASS-II", "file": "data/raw/PSI-25/…", "url": "…", "sha256": "…", "rows": 126, "license": "CC0-1.0" } ] }
```

## missions.json

```jsonc
[
  { "id": "lunar-rover", "label": "Pressurized lunar rover", "o2Pct": 30, "pressureKpa": 70.3, "flowCmS": [0, 20], "gravityG": 0.166,
    "notes": "…", "assumption": false, "sources": [ { "label": "…", "url": "…" } ] }
]
```
Required ids: `iss`, `spacecraft`, `lunar-base`, `lunar-rover`, `mars-base`, `eva-suit`. `assumption: true` where the challenge/NASA does not give the value directly.

## claims.json

Atomic statements extracted from source documents (NTRS abstracts/reports, PSI descriptions). Used by Q&A retrieval and by the extraction-accuracy check.

```jsonc
[ { "id": "c-0001", "inv": "FLEX", "text": "…", "quote": "verbatim supporting snippet from source", "sourceId": "ntrs-2015…", "sourceUrl": "https://…",
    "topic": ["suppression", "droplet"], "extractedBy": "llm" | "manual" } ]
```

## extraction_eval.json

```jsonc
{ "method": "…", "n": 36, "correct": 33, "partial": 2, "wrong": 1, "items": [ { "claimId": "c-0003", "goldText": "…", "llmText": "…", "verdict": "correct" | "partial" | "wrong", "note": "…" } ] }
```

## earth.json / history.json

```jsonc
[ { "id": "…", "title": "…", "summary": "…", "linkedInvestigations": ["SAME"], "sources": [ { "label": "…", "url": "…" } ] } ]
```

## validation.json (generated)

```jsonc
{ "generatedAt": "…", "backtests": [ { "name": "leave-one-investigation-out", "n": 9, "correct": 7, "details": [ … ] } ], "physicsModel": { … } | null }
```
