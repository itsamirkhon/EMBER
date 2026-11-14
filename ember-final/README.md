# EMBER v2 (`ember-final`)

**Evidence-Grounded Spacecraft Fire Safety Scientific Workbench**  
`Engine & Corpus Version: 2.0.0-ember-final` · `Rules Version: 9-rules-v2.0` · `JEV Version: jev-v1.0`

EMBER v2 ingests **15 NASA Physical Sciences Informatics (PSI)** investigations, **NTRS** technical reports (`NASA/TM-20210011385`), and **`1,678` experimental runs** (`4,074` stage-bound `ProtocolStep`s, `2,378` typed `TestEvent`s, `145` verbatim-verified claims, `68` primary sources) into an isomorphic scientific engine (`src/core/`), a typed HTTP API (`server/`), and a `9+1`-workspace dark-lab React UI (`src/ui/`).

Every query separates **Question Relevance**, **Observation Applicability**, and **Evidence Quality**, isolates gas roles (`ambient` vs `oxidizer_stream`), preserves stage-bound flow shutoff (`FT`) vs physical extinction (`SE`) and cool-flame continuation, flags unsupported joint `(O2, pressure, flow)` corners inside overlapping 1D intervals, recalculates design-variant dependencies live, and runs offline without an external LLM key.

---

## Quickstart

From `ember-final/`:

```bash
# 1. Start Vite dev server with integrated /api/* middleware (no API key required)
npm run dev
```

Open the local URL printed by Vite (default `http://localhost:5173`).

### Standalone Production Server (Optional)

```bash
npm run build
npx tsx server/index.ts
```

Starts the standalone Node HTTP server on `PORT || 8787` (`http://localhost:8787`), serving both `/api/*` and built `dist/` static assets.

### Optional Server-Side Live AI Mode

By default, EMBER runs in `DETERMINISTIC_ENGINE` and `SAVED_DEMO_SNAPSHOT` modes with zero external network calls. To enable optional server-side OpenAI synthesis (`useLiveAi: true` in `POST /api/reviews` or the UI toggle), set `OPENAI_API_KEY` in the server environment or `ember-final/.env`. The key is never transmitted to the browser; if absent or unreachable, `server/api.ts` falls back explicitly to `DETERMINISTIC_ENGINE` with a warning.

---

## Scripts & Reproduction Commands

### `package.json` Scripts (`ember-final/`)

| Command | Action | Notes |
| :--- | :--- | :--- |
| `npm run dev` | `vite` | Starts dev server with `emberApiPlugin()` (`/api/*` middleware) |
| `npm run build` | `tsc --noEmit -p tsconfig.json && vite build` | Type-checks client/tests and outputs static bundle to `dist/` |
| `npm run preview` | `vite preview` | Previews built `dist/` with integrated `/api/*` middleware |
| `npm test` | `vitest run` | Runs `tests/core.test.ts` (`21` tests) + `tests/api.test.ts` (`14` tests) |
| `npm run lint` | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p tsconfig.node.json` | Strict TypeScript checks across UI, tests, server, eval, and core |
| `npm run eval` | `tsx eval/run_evaluation.ts` | Runs `dev10` + `100`-case benchmark (Baselines A–D & 5 ablations) |
| `npm run corpus` | `python3 pipeline/build_corpus.py` | Idempotently rebuilds `corpus_v2.json`, `chunks_index.json`, `ember_corpus.sqlite`, `manifest_v2.json` |

### Additional Verification Commands

```bash
# Rebuild & verify Python corpus pipeline (requires python3 + numpy, scipy, sklearn, pandas, pytest)
python3 -m pytest -v pipeline/test_build_corpus.py

# Run external competitor scope audit & Common-Data adapter benchmark
npx tsx eval/competitor_benchmark.ts
```

---

## Architecture & Directory Tree

```text
ember-final/
├── index.html
├── package.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
├── vitest.config.ts
├── pipeline/
│   ├── build_corpus.py            # Idempotent PSI/NTRS -> v2 JSON, 64D SVD chunks, SQLite, SHA-256 manifest
│   └── test_build_corpus.py       # 10 pytest checks covering corpus integrity, roles, protocols, SQLite
├── src/
│   ├── main.tsx
│   ├── core/                      # Pure isomorphic scientific engine (shared by server, eval, browser fallback)
│   │   ├── index.ts
│   │   ├── types.ts               # Domain contracts (GasValue role, GravitySpec mode, ProtocolStep, RuleId)
│   │   ├── queryParser.ts         # Structured ResearchQuery parser + non-blocking unknownFields
│   │   ├── protocol.ts            # Stage-bound segment & event matcher (FT vs SE vs cool flame)
│   │   ├── applicability.ts       # Static Matcher (Baseline C) + 9 EMBER rules + contrasts + ranker
│   │   ├── dependencies.ts        # Design-variant DAG builder & live recalculateDesignVariant()
│   │   ├── retrieval.ts           # BM25 + 64D LSA SVD cosine + structured filter + RRF (k=60)
│   │   ├── jev.ts                 # Calibrated 3-question atomic passage triage (jev-v1.0)
│   │   ├── planner.ts             # Exact branch-and-bound budget optimizer (controls + replicates >= 2)
│   │   ├── generator.ts           # Epistemic-separated synthesis & AnswerBoundary classifier
│   │   ├── verifier.ts            # 5-gate verification (citations, numeric/unit, epistemic, constraints, entailment)
│   │   ├── prediction.ts          # Domain-gated kNN/ridge predictor with grouped CV & refusal gate
│   │   └── reviewEngine.ts        # Full pipeline orchestration & exportFormatters (md, json, csv, modeling_csv)
│   └── ui/                        # Accessible dark-lab React 19 + HashRouter SPA
│       ├── App.tsx
│       ├── apiClient.ts           # /api/* client + automatic static ./data/*.json & localStorage fallback
│       ├── styles.css
│       ├── context/EmberContext.tsx
│       ├── components/            # Layout, ProvenanceTrace, ScientificCharts, SortableTable, SourceModal, StatusPill
│       └── pages/                 # 10 page components covering the 9+1 workspaces
├── server/
│   ├── store.ts                   # EmberStore: lazy corpus cache, atomic reviews_store.json, pre-seeded demos
│   ├── api.ts                     # createApiHandler + Vite emberApiPlugin + typed ApiEnvelope
│   └── index.ts                   # Standalone Node HTTP server (PORT || 8787)
├── eval/
│   ├── dev10_cases.json           # 10 anchored dev cases (9 groupId clusters)
│   ├── gold_100_cases.json        # 100 gold cases across 36 groupIds (50 dev / 20 val / 30 test)
│   ├── run_evaluation.ts          # Baselines A–D + 5 ablations + 95% group-clustered bootstrap CIs
│   └── competitor_benchmark.ts    # Whole-product scope audit & Common-Data adapters
├── tests/
│   ├── core.test.ts               # 21 unit & integration tests against src/core/ and corpus_v2.json
│   └── api.test.ts                # 14 HTTP API integration tests
├── data/
│   ├── ember_corpus.sqlite        # 7-table SQLite mirror (PRAGMA integrity_check + foreign_key_check)
│   ├── reviews_store.json         # Persisted reviews & pre-seeded demo snapshots
│   ├── sources_cache.json         # Cached primary PSI/NTRS source texts
│   ├── legacy_seed/               # Audited legacy seed JSONs
│   └── raw/                       # Raw PSI-* CSV/JSONs & NTRS reports (incl. TM-20210011385)
├── public/data/
│   ├── corpus_v2.json             # 15 investigations, 1,678 tests (951 groups), 145 claims, 68 sources
│   ├── chunks_index.json          # 2,463 chunks with 64D tfidf-lsa-svd-64d-v1 vectors
│   ├── manifest_v2.json           # SHA-256 digests, byte counts & per-investigation coverage
│   └── eval_report.json           # Full measured evaluation output
└── docs/
    ├── REUSE_FIX_MISSING.md       # Legacy audit & 9 mandatory scientific fixes
    ├── EVALUATION_REPORT.md       # Detailed 100-case evaluation, ablations & error analysis
    ├── JUDGE_DEMO_GUIDE.md        # 60–90s interactive demo walkthrough
    ├── SUBMISSION_EN.md           # Full English challenge submission
    ├── PITCH_SLIDES.md            # <= 7 pitch slides + 69-word <= 30s video script
    ├── ACTION_LOG.md              # Chronological /ub-mode engineering log
    └── openapi.json               # OpenAPI 3.1.0 specification
```

---

## REST API Endpoints (`server/api.ts` & `docs/openapi.json`)

Every JSON response uses the typed envelope `{ run_id, status, mode, versions: { corpus, rules, engine, jevPrompt, code }, warnings, data?, error? }`.

| Method & Route | Description |
| :--- | :--- |
| `GET /api/health` | Service health, `corpusVersion`, `engineVersion`, corpus counts, `liveAiConfigured` boolean |
| `GET /api/investigations` | List all `15` PSI investigations (optional `?direction=`, `?fuelPhase=`, `?platform=`, `?epistemicStatus=`, `?q=`) |
| `GET /api/investigations/:id` | Investigation card, `coverageSummary`, tests, and claims |
| `GET /api/sources/:id` | Primary source metadata and full cached text (`sources_cache.json` + `TM-20210011385.txt` fallback) |
| `POST /api/queries/parse` | Parses `{ question, overrides, parserOptions }` into structured `ResearchQuery` (`400` on invalid/empty body) |
| `GET /api/reviews` | Lists saved review summaries and pre-seeded Judge Demo snapshots |
| `POST /api/reviews` | Runs `runReview` / `runReviewSync`, deduplicates via `idempotencyKey` / signature, persists snapshot |
| `GET /api/runs/:id` | Run execution status, stage breakdown, timings, and warnings |
| `GET /api/reviews/:id` | Reopens a saved review snapshot deterministically without invoking any LLM |
| `POST /api/reviews/:id/variants` | Runs `recalculateDesignVariant` against a design patch and appends a revision to history |
| `POST /api/reviews/:id/test-programmes` | Re-optimizes `TestProgramme` within `{ budgetRuns }` while locking mandatory controls & replicates |
| `GET /api/reviews/:id/export` | Streams `format=markdown\|json\|csv\|modeling_csv`; `modeling_csv` preserves `groupId`, `o2Role`, provenance & `null`s, refusing mixed endpoints (`400 INCOMPATIBLE_ENDPOINTS`) unless scoped |
| `GET /api/evaluation` | Returns `public/data/eval_report.json` or `{ status: "not_measured" }` if absent |

---

## 9+1 UI Workspaces (`src/ui/App.tsx`, `HashRouter`)

1. **`/` & `/reviews/:id` — Review Workspace:** Structured condition editor, live parsed `ResearchQuery` confirmation, 3-score KPIs, expandable `ProvenanceTrace`, separated Observed Facts / Author Interpretations / Engineering Implications / Preserved Conflicts / Open Gaps, and 5-gate Verifier status.
2. **`/explorer` — Experiment Explorer:** Filterable `15`-investigation catalog displaying separate **Question Relevance**, **Observation Applicability**, and **Evidence Quality** bars plus `Observed` vs `Planned Matrix Only` (`FLEX-2`) badges.
3. **`/investigations/:id` — Investigation Dossier:** Objective, hardware, condition ranges (`assumed` / `planned` badged), limitations, key findings with `<dialog>` `SourceModal`, and test table linking to Protocol View.
4. **`/insights` — Fire Safety Insights:** Prevention, detection, and suppression syntheses strictly separated into Observed Facts, Author Interpretations, Applicability Conditions, and Open Questions.
5. **`/protocol-compare` — Protocol & Comparison:** Stage-bound `ProtocolStep` + `TestEvent` timeline (`BASS-II-B1` `FT` vs `BASS-II-M1` step-down vs `CFI-1206` cool flame) and 2–4 test causal contrast matrix + SVG plots.
6. **`/variants` — Design Variant Diff:** Side-by-side Variant A vs Variant B editor with causal impact chains (`changedParameter -> affectedRuleOrEvidence -> conclusionChange`) and verdict deltas.
7. **`/planner` — Test Programme Planner:** Budget slider (`1–40` runs) optimizing Priority Question Coverage via exact branch-and-bound with locked mandatory controls and replicates.
8. **`/modeling` — Modeling & Replay Lab:** Three isolated tabs: `Data Replay` (NASA series plots), `Domain-Gated Endpoint Predictor` (`domain_gated_knn_ridge` + grouped CV refusal gate), and `Conceptual Illustration` (`CONCEPTUAL ILLUSTRATION — NOT A PHYSICAL CALCULATION`).
9. **`/export` — Export & Modeling Dataset:** Downloads Markdown, JSON, Test Evidence CSV, and single-endpoint-gated Predictive Modeling CSV.
10. **`/evaluation` — Evaluation Benchmark:** Interactive tables for the `100`-case gold suite, Baselines A–D, 5 ablations, Whole-Product scope audit, Common-Data adapters, and error examples.

---

## Pre-Seeded Demos & Runtime Modes

On first store initialization (`server/store.ts` and browser fallback `src/ui/apiClient.ts`), two deterministic demo snapshots are pre-seeded under **`SAVED_DEMO_SNAPSHOT`** mode:

- **`demo-pmma-lunar`:** *"PMMA flame establishment, sustained spread, and extinction under flow reduction in oxygen-enriched lunar rover 30% O2 / 70.3 kPa, 5 cm/s concurrent flow vs ISS BASS-II"* (`insufficient_data` boundary revealing the partial-gravity + joint atmosphere safety gap; `9/10` planned runs across `4` test blocks).
- **`demo-cool-flame`:** *"Droplet hot extinction vs continued cool-flame burning (CFI / FLEX n-dodecane & n-heptane)"* (`sufficient_observed` boundary with `15` admissible / `35` conditional tests of `259` evaluated, separating hot-flame quench from segment-2 cool flames).

Three explicit execution modes appear across API envelopes and UI badges:
- **`SAVED_DEMO_SNAPSHOT`** — Pre-seeded reproducible snapshots served without LLM calls.
- **`DETERMINISTIC_ENGINE`** — Default offline live engine (or in-browser static fallback if `/api/*` is unreachable).
- **`LIVE_AI`** — Optional server-side OpenAI synthesis checked by all 5 verifier gates, never bypassing `answerBoundary`.

---

## Measured Evaluation Highlights (`eval_report.json`)

> **Provenance Notice (`preliminary_team_annotation_from_primary_nasa_sources`):** Benchmarks use team-authored gold annotations across `100` cases (`36` non-overlapping `groupId`s split `50 dev / 20 val / 30 test`), grounded in primary NASA PSI/NTRS records. This is preliminary internal validation, not independent third-party certification.

| Metric (`n = 100`, `36` Groups) | Variant A (`BM25`) | Variant B (`Hybrid RAG`) | Variant C (`Static Matcher`) | Variant D (`Full EMBER v2`) |
| :--- | :---: | :---: | :---: | :---: |
| **Investigation Recall@5** (`/95`) | `0.9553` | `0.9219` | `0.9430` | **`0.9763`** (`92.75/95`) |
| **Test Recall@5** (`/89` overall / `/27` `test`) | `0.4916` / `0.5401` | `0.4148` / `0.4506` | `0.3633` / `0.2562` | **`0.5861`** / **`0.5957`** |
| **Applicability F1** / **3-Way** (`/100`) | `0.7879` / `0.4000` | `0.8050` / `0.4400` | **`0.8788`** / **`0.6500`** | `0.8120` / `0.6200` |
| **Pairwise Comparability 3-Way** (`/20`) | `0.2000` | `0.2500` | `0.7500` | **`0.9500`** (`19/20`) |
| **Expected Rule Recall** (`/106`) | `0.0000` | `0.0000` | `0.0000` | **`0.7453`** (`79/106`) |
| **Config-Change Dep. F1 / Post-Bnd** | `0.0000` / `0.0000` | `0.0000` / `0.0000` | `0.0000` / `0.0000` | **`0.6857`** / **`0.7000`** |
| **JEV Atomic Acc / Brier Score** | `0.8381` / `0.2500` | `0.8381` / `0.1586` | `0.8381` / `0.1586` | **`0.8952`** / **`0.1157`** |
| **Planner Exact / Controls / Replicates** | `0.50` | `0.50` | `0.50` | **`1.0000`** (`10/10`) |
| **Verifier Pass Rate** (`/100`) | `n/a` | `n/a` | `n/a` | **`0.9600`** (`96/100`) |

- **External Peer Systems (`FlameBound`, `MicroFire Atlas`, `Fotia`, `HEARTH`):** `0` evaluated (`outside_claimed_scope` / `not_run`; `0` fabricated metrics). On Common-Data capability adapters over identical `corpus_v2.json`, `EMBER_v2` scores `62/100` `app3Way` vs `StaticMatcher_CommonData_Adapter` `61/100`, `RAG_CommonData_Adapter` `44/100`, and `BM25_CommonData_Adapter` `40/100`.
- Full tables, 5 ablations, 95% group-clustered CIs, and observed failure modes are documented in [`docs/EVALUATION_REPORT.md`](./docs/EVALUATION_REPORT.md).

---

## Disclaimers & Documentation Links

- **Non-Qualification Disclaimer:** EMBER v2 is a scientific evidence-support tool—**not** a flight hardware qualification, spacecraft fire-safety certification, or NASA-endorsed engineering authority. Zero actual orbital/lunar/Martian partial-gravity (`0.166 g` / `0.38 g`) flammability rows exist in PSI v2, and `FLEX-2` has `0` flown public test rows (`planned_only`).
- **Key Docs:**
  - [Judge Demo Guide (60–90s)](./docs/JUDGE_DEMO_GUIDE.md)
  - [Challenge Submission (English)](./docs/SUBMISSION_EN.md)
  - [Pitch Slides & 30s Script](./docs/PITCH_SLIDES.md)
  - [Evaluation Report](./docs/EVALUATION_REPORT.md)
  - [Legacy Audit & 9 Mandatory Fixes](./docs/REUSE_FIX_MISSING.md)
  - [Chronological `/ub-mode` Action Log](./docs/ACTION_LOG.md)
  - [OpenAPI 3.1.0 Specification](./docs/openapi.json)
