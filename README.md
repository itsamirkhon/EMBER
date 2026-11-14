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
| Trust (4.10) | `#/trust` | Backtest results and claim-extraction accuracy, shown live in the product. |
| Physics illustration (4.7) | `#/physics` | A 2D thin-fuel flame-spread illustration, labelled **"illustration, not a calculation"** because it is not calibrated. |

## Data

- **15 PSI investigations**: BASS, BASS-II, Saffire-I/II/III, FLEX, FLEX-2, SAME, SAME-R, CFI, ACME BRE, ACME CFI-G, ACME E-FIELD Flames, SPICE, SLICE. All PSI numbers and DOIs were checked against the PSI API.
- **1,622 normalized test rows** from the PSI "Experimental table" files (CC0-1.0). Units: O₂ in %, pressure in kPa, flow in cm/s, spread rate in mm/s, burning-rate constant in mm²/s.
- **145 claims**, each with a verbatim quote from an NTRS abstract, a PSI page or a NASA web page. All 145 quotes were checked programmatically against the cached source text.
- **6 mission atmospheres** with sources. Values NASA does not state directly are marked `assumption: true`.

Each investigation's `dataNotes` lists that dataset's known caveats. Examples: the FLEX "Burning rate; mm" column is really mm²/s, BASS and BASS-II outcomes were parsed from free-text notes, and in CFI-G inverse flames O₂ is the oxidizer stream.

See `docs/DATA_CONTRACT.md` for the schema and `docs/SOURCES.md` for all sources.

## How much to trust it (Trust page)

| Check | Result |
|---|---|
| Leave-one-test-out outcome prediction (sustained vs. extinguished) | **680 / 890 = 76 %**, against a 66 % majority-class baseline |
| Accuracy by answer status | Measured 77 % · Interpolated 70 % · Extrapolated 50 %. Accuracy falls as the status gets less certain, which is the intended behaviour. |
| "Hide an experiment" (leave one investigation out) | 8 of 9 investigations pass. **ACME-BRE fails**: gas-flame outcomes don't transfer from other experiments, and the Trust page says so. |
| Claim extraction, 36 claims checked by hand | 29 correct · 7 partial · 0 wrong. Quotes match the source verbatim in 145 of 145 claims. The same model family wrote and graded the claims, so treat these numbers as optimistic. |

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
