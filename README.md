# EMBER: Evidence Map for Burn & Extinction Risk

**NASA Space Apps Challenge 2026: "Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data"**

> We show not only what NASA knows about fire in space, but also what nobody knows yet.

EMBER is a web dashboard that turns the microgravity combustion investigations in NASA's Physical Sciences Informatics (PSI) repository into answers to fire-safety design questions. An engineer picks a habitat (ISS, crew capsule, lunar base, pressurized lunar rover, Mars base or EVA suit), a material and conditions. EMBER then shows:

- which NASA investigations apply,
- what those investigations found,
- where the data ends and guessing begins.

Every answer carries a status: **Measured**, **Interpolated** or **Extrapolated**. EMBER also publishes how often its own answers are right.

## What's inside

| Module | Route | What it does |
|---|---|---|
| Mission lens (4.4) | `#/` | Ranks 15 investigations by *consequence × evidence strength × proximity*, with adjustable weights and a per-item breakdown. Each finding is tagged Known, Extrapolating or Unknown. |
| Investigation cards (4.1) | `#/investigations` | One card layout per investigation: objective, fuel, O₂, pressure and flow ranges, what was varied, diagnostics, hardware, result summary, cited findings and a test table. |
| Compare (4.2) and Families (4.3) | `#/compare`, `#/families` | Investigations side by side. A warning appears when hardware family or fuel phase differ. Investigations are grouped by ACME/CIR, MDCA/CIR, MSG/SPICE duct, Saffire/Cygnus and SAME. |
| What-if (4.5) | `#/what-if` | Sliders for O₂, pressure, flow and material. Predicts from the nearest real flight tests (inverse-distance kNN) and always shows the answer status. |
| Gravity bracket (4.6) | `#/gravity` | For the Moon and Mars, shows the µg vs 1 g bracket as an estimate. Includes the literature O₂ margin (1 g Test 1 limits are up to 4 % O₂ higher than µg) and E-FIELD Flames as a partial-gravity analogue. |
| Ask EMBER (5) | `#/ask` | BM25 retrieval over 145 cited claims and the 15 cards. Answers only with citations and says "No evidence in PSI corpus" when nothing matches. An optional OpenAI `gpt-6-luna` answer (bring your own OpenAI API key) is limited to the retrieved claims, and its citations are checked. |
| Export (4.8) | `#/export` | Cleaned test tables as CSV or JSON. Every row carries its PSI id, DOI, source file and row number. |
| Back to Earth (4.9) | `#/earth` | NASA Spinoffs (SCBA air tanks, smoke detectors, firefighter gear, water mist) linked to the investigations. |
| Trust (4.10) | `#/trust` | Backtests (leave one test out, with replicates hidden, hide a whole investigation), each next to its baseline, per fuel phase; numeric-estimate errors; data coverage; claim-extraction accuracy. |
| Flame lab (4.7) | `#/physics` | A live 2D flame model (buoyant incompressible flow, diffusion, one-step chemistry, solid pyrolysis, T⁴ radiation) for a thin fuel sheet or a gas burner, labelled **"illustration, not a calculation"** because it is not calibrated. It shows oxygen sensitivity, blow-off and the buoyant plume; it does not reproduce low-flow quenching. Also drives the four-gravity flame comparison on `#/gravity`. |

## Data

- **15 PSI investigations**: BASS, BASS-II, Saffire-I/II/III, FLEX, FLEX-2, SAME, SAME-R, CFI, ACME BRE, ACME CFI-G, ACME E-FIELD Flames, SPICE, SLICE. All PSI numbers and DOIs were checked against the PSI API.
- **1,678 normalized test rows** from the PSI "Experimental table" files and the investigations' own analysed-data workbooks and reports (CC0-1.0). Units: O₂ in %, pressure in kPa, flow in cm/s, spread rate in mm/s, burning-rate constant in mm²/s, smoke-particle size in nm, smoke-point flame length in mm.
- **145 claims**, each with a verbatim quote from an NTRS abstract, a PSI page or a NASA web page. All 145 quotes were checked programmatically against the cached source text.
- **6 mission atmospheres** with sources. Values NASA does not state directly are marked `assumption: true`.

Where each value comes from:
- **BASS-II outcomes** (123 of 129 rows) and 19 spread rates come from the observation column and Table 5.1 of NASA/TM-20210011385, parsed by word position (`pipeline/extract_tm_bass2.py`).
- **BASS outcomes** were parsed from free-text notes by keyword rules (no results column exists; the final report is unavailable); every row records how its outcome was obtained in `extra.outcomeDerivation`. A manual reading of 30 random rows (`pipeline/audit_bass_outcomes.py`) agrees on 29; the rule gave no wrong burn / no-burn answer in the 27 rows it answered and missed one it could have answered.
- **SAME / SAME-R particle sizes** (130 rows) come from the PSI-101 analysed-results workbook. Neither final report states the atmosphere, so O₂ and pressure are set to ISS cabin air (21 %, 101.3 kPa) and flagged as an **assumption** (`conditions.assumed`): the tests ran in the MSG work volume, and neither report mentions a purge or backfill gas. A mission match that rests on assumed conditions is never shown as Known, at best Extrapolating.
- **SPICE smoke points** (53 rows) come from the smoke-point review sheet. SPICE was not a flammability test (every flame was ignited by design), so its rows are marked `not_applicable` for burn/no-burn and are not counted in outcome accuracy.

Each investigation's `dataNotes` lists that dataset's known caveats. Examples: the FLEX "Burning rate; mm" column is really mm²/s, and in CFI-G inverse flames O₂ is the oxidizer stream.

See `docs/DATA_CONTRACT.md` for the schema and `docs/SOURCES.md` for all sources.

## How much to trust it (Trust page)

Every accuracy is shown next to its baseline and n. 991 test rows have a burn / no-burn outcome; the "majority baseline" always guesses the most common outcome of the same rows.

| Check | Result | Baseline |
|---|---|---|
| Leave one test out, all fuels | 82 % (814 / 991) | 54 % |
| …solid materials only | 88 % (216 / 245) | 84 % ("always burns") |
| Leave one test out **with its replicates hidden too** (no near-identical twin to copy) | 77 % (759 / 991) | 54 % |
| …solid materials only | 86 % (212 / 245) | 84 % |
| …BASS-II (demo dataset) | 83 % (102 / 123) | 86 % — **below baseline** |
| …BASS | 90 % (100 / 111) | 85 % |
| **Hide a whole investigation**, strict accuracy (correct only) | 58 % (570 / 991) | 54 % majority of the hidden tests; 28 % if you guess the other investigations' majority |
| …share of the wrong cross-experiment answers that EMBER itself labelled Extrapolated | 77 % (324 / 421) | |
| BASS outcomes from keyword rules, 30 random rows read manually | 29 / 30 agree, 0 wrong; 1 missed (rule abstained) | with 27 answered rows the error could still be up to ~11 % (rule of three); read by Claude, not an independent human |
| Claim extraction, 36 claims checked by hand | 29 correct · 7 partial · 0 wrong; 145 / 145 quotes verbatim | the same model family wrote and graded the claims, so treat this as optimistic |

What this means:
- **Results barely transfer between different experiments, and EMBER flags it.** Hiding a whole investigation leaves EMBER only slightly better than guessing the majority, but most of its wrong answers in that setting carry an Extrapolated label.
- **For solid materials the data mostly says "it burns".** At the flown conditions 84 % of solid tests sustained a flame, and EMBER adds only a few points on top of that. That is the honest state of the evidence for the demo scenario.
- **Replicates inflate leave-one-test-out.** 934 of 991 tests have a near-identical repeat, so without hiding replicates almost every answer is "Measured". The grouped variant is the fairer number.
- **Numeric estimates** (grouped leave-out, kNN vs. the investigation mean): smoke-point flame length 11 mm vs 17 mm error; smoke-particle size 102 nm vs 112 nm; droplet burning rate 0.110 vs 0.113 mm²/s (no real gain); flame spread rate 0.50 vs 0.42 mm/s (**worse** than the mean, only 21 rows).
- **Coverage:** 502 of 1,678 rows feed no estimate (no burn / no-burn outcome and no numeric result), mostly SPICE settings away from the smoke point (416), SAME tests without sizes (39), CFI (13), SLICE (12), and BASS / BASS-II rows whose outcome could not be determined (16).

The key gap EMBER exposes: PSI has **no solid-material flight data near lunar atmospheres** (30–34 % O₂ at 56–70 kPa). The highest-O₂ microgravity data (up to 85 %) is from CFI-G, which used inverse gas flames, not fabrics or plastics.

## Run it

```bash
cd web
npm install
npm run dev          # http://localhost:5173
npm test             # vitest unit tests for the evidence engine
npm run backtest     # regenerates public/data/validation.json
npm run build        # static site in web/dist
```

**AI answers without pasting a key.** Put your OpenAI key in `web/.env` (git-ignored; see `web/.env.example`):

```bash
echo "OPENAI_API_KEY=sk-..." > web/.env
cd web && npm run dev    # or: npm run build && npx vite preview
```

The dev/preview server reads the key and proxies Ask EMBER requests (`web/server/llmProxy.ts`), so the key never reaches the browser or the build. The proxy pins the model (`gpt-6-luna`) and caps the answer length. The static GitHub Pages site has no server, so there visitors paste their own key. Never put the key in a `VITE_*` variable: Vite would embed it in the public JavaScript.

Rebuild the data from PSI (Python 3.11+, requests, pandas, openpyxl, bs4):

```bash
python3 pipeline/fetch_psi.py        # downloads PSI metadata + experimental tables into data/raw/
python3 pipeline/build_dataset.py    # normalizes into web/public/data/{investigations,tests,datasets_manifest}.json
python3 pipeline/content/extract_claims.py   # refreshes NTRS sources; with OPENAI_API_KEY also re-extracts claims (gpt-6-luna)
```

**Deploy:** pushing to `main` runs `.github/workflows/deploy.yml`, which lints, tests, backtests, builds and publishes to GitHub Pages. Enable Pages with source "GitHub Actions" in the repository settings. The site is fully static; no server or API key is needed.

## Repository layout

```
web/                 React + TypeScript + Vite dashboard
  src/lib/evidence.ts  ranking, kNN, Measured/Interpolated/Extrapolated logic (pure, unit-tested)
  src/lib/retrieval.ts BM25 retrieval for Ask EMBER
  scripts/backtest.ts  validation → public/data/validation.json
  public/data/         all runtime data (JSON)
pipeline/            PSI download + normalization (Python)
pipeline/content/    claim extraction, extraction eval, missions, Back to Earth
data/raw/            original PSI and NTRS downloads (CC0)
docs/                data contract, sources, submission text, demo script
```

## Use of AI

See `docs/SUBMISSION.md` → "Use of AI". In short:
- an LLM (Claude, during the build) extracted the claims and helped write the code; every quote is machine-checked against the source, and the extraction script now runs on OpenAI `gpt-6-luna`;
- the ranking formula is transparent and contains no AI;
- the predictions come from nearest-neighbour search over real tests;
- the optional in-app answers (OpenAI `gpt-6-luna`, user's own key, never stored in the code) can only cite retrieved claims.

## License

Code: GPL-3.0 (see LICENSE). NASA PSI data: CC0-1.0. EMBER is not an official NASA product.
