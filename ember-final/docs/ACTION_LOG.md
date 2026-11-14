# EMBER v2 — Chronological `/ub-mode` Engineering Action Log

This log documents the end-to-end engineering execution of `ember-final/` under `/ub-mode` discipline (data-shape correctness, boundary discipline, idempotent pipelines, zero duplicated domain rules, TDD verification, and strict epistemic honesty).

---

## Stage 1 — Legacy Codebase Audit & Architecture Freeze
- **Scope:** Audited legacy `pipeline/`, `web/`, and `docs/DATA_CONTRACT.md` against target spacecraft fire-safety evidence requirements.
- **Artifact Produced:** [`docs/REUSE_FIX_MISSING.md`](./REUSE_FIX_MISSING.md)
- **Key Decisions & 9 Mandatory Audit Fixes Specified:**
  1. Replace binary `BURN`/`NOBURN` scalar collapse (`web/src/lib/evidence.ts:84-93`) with ordered `ProtocolStep[]` and stage-bound `TestEvent[]` records.
  2. Introduce typed `ScientificValue` wrappers (`provenance`: `reported | series_level | derived | assumed | unknown`), mandatory `GasRole` (`ambient` vs `oxidizer_stream`), flow direction/history sequences, `widthCm`, `substrateConfinement`, and `GravitySpec` (`regime`, `platform`, `mode`).
  3. Enforce material, phase, geometry, and gravity regime/mode inside applicability and investigation ranking instead of stripping `fuel`/`fuelPhase`/`gravityAware`.
  4. Replace 1D marginal `conditionBox` intervals with joint multi-dimensional `(O2, pressure, flow)` envelope verification (`RULE-JOINT-01`).
  5. Remove uncalibrated IDW kNN `pBurn` classification and Wilson intervals; restrict numeric modeling to domain-gated `domain_gated_knn_ridge` with leave-one-group-out CV baseline checks.
  6. Remove hardcoded `const marginO2 = 4` (`web/src/pages/Gravity.tsx:47`) and incorrect `ACME-E-FIELD` `"simulated partial gravity"` labeling.
  7. Isolate `FLEX-2` (`PSI-68`, `0` flown rows) under `epistemicStatus: "planned_only"` and repair all `8` audited partial/planned claims (`c-0021`, `c-0037`, `c-0041`, `c-0045`, `c-0101`, `c-0105`, `c-0109`, `c-0113`).
  8. Replace ID-only `[id]` regex citation matching (`web/src/lib/citations.ts:6-17`) with 5-gate content/numeric/epistemic/constraint/entailment verification.
  9. Replace heuristic tolerance-based replicate matching with deterministic `groupId` clustering.

---

## Stage 2 — Idempotent Corpus & Vector Index Pipeline (`corpus-worker`)
- **Artifacts Produced:**
  - [`pipeline/build_corpus.py`](../pipeline/build_corpus.py)
  - [`pipeline/test_build_corpus.py`](../pipeline/test_build_corpus.py)
  - [`public/data/corpus_v2.json`](../public/data/corpus_v2.json) (`25,654,336` bytes)
  - [`public/data/chunks_index.json`](../public/data/chunks_index.json) (`7,132,893` bytes)
  - [`data/ember_corpus.sqlite`](../data/ember_corpus.sqlite) (`60,706,816` bytes)
  - [`public/data/manifest_v2.json`](../public/data/manifest_v2.json) (`22,264` bytes)
- **Outcomes:**
  - Ingested raw `PSI-*` CSV/JSON tables, `data/legacy_seed/*.json`, `data/sources_cache.json`, and `NASA/TM-20210011385` Appendix A & full text.
  - Emitted `corpusVersion: "2.0.0-ember-final"` with `15` investigations (`FLEX-2` `planned_only`), `1,678` tests across `951` deterministic `groupId` clusters, `4,074` `ProtocolStep`s, `2,378` `TestEvent`s, `145` verbatim-verified claims (8 fixed), `68` sources, `6` missions, `9` earth items, and `5` history items.
  - Tag coverage verified: `1,651` tests with observed outcomes, `528` with primary numeric target, `57` with cool-flame continuation, `154` `oxidizer_stream` inverse-flame rows (`ACME-CFI-G`), `642` `assumed`-atmosphere rows (`SAME`/`SAME-R`/`SPICE`).
  - Generated `2,463` indexed chunks with `tfidf-lsa-svd-64d-v1` (64D L2-normalized vectors, `max_features=1600`, `ngram_range=(1,2)`), 7 relational SQLite tables passing `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and SHA-256 checksums in `manifest_v2.json`.
  - **Verification:** `python3 -m pytest -v pipeline/test_build_corpus.py` → **`10/10` passed**.

---

## Stage 3 — Benchmark Suite Construction (`eval-worker`, Phase 1)
- **Artifacts Produced:**
  - [`eval/dev10_cases.json`](../eval/dev10_cases.json) (`10` anchored development cases across `9` groups)
  - [`eval/gold_100_cases.json`](../eval/gold_100_cases.json) (`100` benchmark cases across `36` distinct `groupId` clusters)
- **Design Discipline:**
  - Partitioned strictly by `groupId` into **`50 dev / 20 val / 30 test`** (`0` group overlap across splits).
  - Balanced across `7` task categories (`investigation_selection` `20`, `comparability` `20`, `summary` `15`, `protocol_outcome` `15`, `config_change` `10`, `insufficient_or_invalid_premise` `10`, `full_review` `10`) with `65` admissible/conditional positives and `35` inadmissible negatives.
  - Covered all `10` mandatory hard-case families plus `standard` (`23`), explicitly annotated with `annotationProvenance: "preliminary_team_annotation_from_primary_nasa_sources"`.

---

## Stage 4 — Isomorphic Scientific Core Engine (`engine-worker`)
- **Artifacts Produced:**
  - Config: [`package.json`](../package.json), [`tsconfig.json`](../tsconfig.json), [`tsconfig.node.json`](../tsconfig.node.json), [`vitest.config.ts`](../vitest.config.ts)
  - Pure TypeScript Core ([`src/core/`](../src/core/index.ts)): `types.ts`, `queryParser.ts`, `protocol.ts`, `applicability.ts` (`evaluateStaticMatcher` Baseline C + 9-rule `evaluateApplicability` + `buildContrasts` + `rankInvestigationsV2`), `retrieval.ts` (`searchBm25`, 64D SVD `searchDense`, `filterStructured`, `searchHybrid` RRF `k=60`), `jev.ts` (`jev-v1.0`), `dependencies.ts` (`buildDependencies`, `recalculateDesignVariant`), `planner.ts` (exact branch-and-bound), `generator.ts`, `verifier.ts`, `prediction.ts`, `reviewEngine.ts` (`runReview`, `runReviewSync`, `exportFormatters`), `index.ts`.
  - Test Suite: [`tests/core.test.ts`](../tests/core.test.ts)
- **Verification:** `npx vitest run` → **`21/21` tests passed**; `npm run lint` → exited `0`.

---

## Stage 5 — Protocol & Edge-Case Hardening (`eval-worker` Spot-Check → `engine-worker` Patches)
- **Findings Raised from `dev10_cases.json` Spot-Check:**
  1. `src/core/protocol.ts`: `hasPhysicalFlowExtinction` previously matched `extinction_under_flow_change` events even when `eventType` was `operator_flow_shutoff` (`BASS-II-B1`, `M1`, `P2`).
  2. `src/core/generator.ts`: `determineAnswerBoundary` could promote an explicit `targetInvIds` query (`FLEX-2`, `Saffire-III`) via unrequested fallback investigations.
  3. `src/core/reviewEngine.ts`: test-ID extraction regex omitted trailing letters (`SAME-R-51a`) and `ACME-BRE-*` identifiers.
- **Fixes Applied & Re-Verified:** Patched all 3 edge cases in `src/core/` with regression coverage in `tests/core.test.ts` (`21/21` passed, `npm run lint` exited `0`).

---

## Stage 6 — Typed REST API, Atomic Persistence & Pre-Seeded Snapshots (`server-worker`)
- **Artifacts Produced:**
  - [`server/store.ts`](../server/store.ts): `EmberStore` lazy JSON/full-text caching, atomic temp-file + `rename` writes to `data/reviews_store.json`, SHA-256 request-signature + `idempotencyKey` deduplication, and pre-seeded Judge Demo snapshots (`demo-pmma-lunar`, `demo-cool-flame`) in `SAVED_DEMO_SNAPSHOT` mode.
  - [`server/api.ts`](../server/api.ts): `createApiHandler` and Vite `emberApiPlugin` serving `12` HTTP routes with `ApiEnvelope` (`run_id`, `status`, `mode`, `versions`, `warnings`, `data`/`error`), server-only `OPENAI_API_KEY` handling with explicit `DETERMINISTIC_ENGINE` fallback, and endpoint-compatibility gating (`400 INCOMPATIBLE_ENDPOINTS`) on `modeling_csv` exports.
  - [`server/index.ts`](../server/index.ts) (standalone Node HTTP server on `PORT || 8787`), [`docs/openapi.json`](./openapi.json) (OpenAPI `3.1.0`), and [`tests/api.test.ts`](../tests/api.test.ts).
- **Verification:** `npx vitest run tests/api.test.ts` → **`14/14` passed** (`35/35` combined across `core.test.ts` and `api.test.ts`); `npm run lint` → exited `0`.

---

## Stage 7 — Accessible 9+1 React UI & Evaluation Schema Alignment (`ui-worker`)
- **Artifacts Produced:**
  - [`index.html`](../index.html), [`vite.config.ts`](../vite.config.ts) (`base: './'` + `emberApiPlugin()`), [`src/main.tsx`](../src/main.tsx)
  - [`src/ui/apiClient.ts`](../src/ui/apiClient.ts) (Node `/api/*` client with automatic static `./data/*.json` + in-browser `src/core/` + `localStorage` fallback), [`src/ui/context/EmberContext.tsx`](../src/ui/context/EmberContext.tsx), [`src/ui/App.tsx`](../src/ui/App.tsx) (`HashRouter`), [`src/ui/styles.css`](../src/ui/styles.css)
  - Components (`Layout.tsx`, `StatusPill.tsx`, `SourceModal.tsx`, `ProvenanceTrace.tsx`, `SortableTable.tsx`, `ScientificCharts.tsx`) and all `10` routed pages (`ReviewWorkspacePage.tsx`, `ExplorerPage.tsx`, `InvestigationDetailPage.tsx`, `InsightsPage.tsx`, `ProtocolComparePage.tsx`, `VariantDiffPage.tsx`, `PlannerPage.tsx`, `ModelingLabPage.tsx`, `ExportPage.tsx`, `EvaluationPage.tsx`).
- **Follow-up Integration:** Aligned `EvaluationPage.tsx` directly to the emitted `eval_report.json` schema (`datasetSummary`, Baselines A–D, 5 Ablations, Whole-Product & Common-Data competitor tables, error buckets, and `preliminary_team_annotation_from_primary_nasa_sources` provenance banner).
- **Verification:** `npm run lint` (`0`), `npm run build` (`vite build` → `dist/`), and `npm test` (`35/35`).

---

## Stage 8 — 100-Case Evaluation, Ablations & Competitor Adapters (`eval-worker`, Phase 2)
- **Artifacts Produced:**
  - [`eval/run_evaluation.ts`](../eval/run_evaluation.ts)
  - [`eval/competitor_benchmark.ts`](../eval/competitor_benchmark.ts)
  - [`public/data/eval_report.json`](../public/data/eval_report.json) (`894,414` bytes)
  - [`docs/EVALUATION_REPORT.md`](./EVALUATION_REPORT.md)
- **Execution & Key Measurements:**
  - Executed `npm run eval` and `npx tsx eval/competitor_benchmark.ts` against loaded `corpus_v2.json` and `chunks_index.json` (95% group-clustered bootstrap CIs over `36` `groupId`s).
  - Measured `Variant_D_Full_EMBER`: `invR@5 = 0.9763`, `testR@5 = 0.5861` (`0.5957` on held-out `test`), `comparability app3Way = 0.9500 (19/20)`, `expRuleR = 0.7453 (79/106)`, `configChange Dep F1 = 0.6857 (24/35)`, `jevAcc = 0.8952 (94/105)` (Brier `0.1157`), `planner = 1.0000 (10/10)`, `verifierPass = 0.9600`.
  - Documented observed error examples (`GOLD-002/005`, `GOLD-058/084/085`, `GOLD-045`, `GOLD-003/008/010`) and marked `FlameBound`, `MicroFire Atlas`, `Fotia`, and `HEARTH` honestly as `evaluated: 0` (`outside_claimed_scope` / `not_run`) alongside executed Common-Data adapters (`EMBER_v2` `62/100` vs `StaticMatcher` `61/100`, `RAG` `44/100`, `BM25` `40/100`).

---

## Stage 9 — UI Alignment, Independent Verification & Submission Package (`ui-worker`, `verifier`, `eval-worker`, `docs-worker`)
- **Post-Evaluation UI Alignment (`ui-worker`):** Aligned [`src/ui/pages/EvaluationPage.tsx`](../src/ui/pages/EvaluationPage.tsx) with the final `eval_report.json` schema (`dev10` + `test30` + `competitorBenchmark`), re-verifying `npm run lint`, `npm run build`, and `vitest` (`35/35` passing).
- **Independent End-to-End Verification & Honesty Audit (`verifier`):** Executed `pytest` (`10/10`), SQLite `integrity_check=ok` / `foreign_key_check=[]`, `vitest` (`35/35`), `npm run lint` and `npm run build`, fresh `npm run eval` + `npx tsx eval/competitor_benchmark.ts` runs, and live HTTP + Vite preview smoke checks across `/api/*` endpoints and pre-seeded demo snapshots.
- **Final Report Sync, Doc Fixes & Repo Hygiene (`eval-worker`, `docs-worker`):** Synced [`docs/EVALUATION_REPORT.md`](./EVALUATION_REPORT.md) and [`docs/SUBMISSION_EN.md`](./SUBMISSION_EN.md) latencies verbatim with freshly executed [`public/data/eval_report.json`](../public/data/eval_report.json), aligned [`docs/JUDGE_DEMO_GUIDE.md`](./JUDGE_DEMO_GUIDE.md) (`unknownFields: ["thicknessMm"]`, ISS PMMA `112` admissible / `26` conditional, and two-step `34% O2` -> Lunar Base variant diff), and added [`.gitignore`](../.gitignore).
- **Documentation & Submission Artifacts:** [`docs/JUDGE_DEMO_GUIDE.md`](./JUDGE_DEMO_GUIDE.md), [`docs/SUBMISSION_EN.md`](./SUBMISSION_EN.md), [`docs/PITCH_SLIDES.md`](./PITCH_SLIDES.md), [`docs/ACTION_LOG.md`](./ACTION_LOG.md), and [`README.md`](../README.md).
- **Consistency Audit:** Grounded all numbers, API routes, UI workspaces, script commands, execution modes, and disclaimers strictly against observed workspace files and verified build/test gates.
- **Final Post-Edit Verification Pass (`verifier`):** Confirmed `pytest` (`10/10`), `npm run lint`, `npx vitest run` (`tests/core.test.ts` `21/21`, `tests/api.test.ts` `14/14`; `35/35` total), `npm run build` (`dist/data/eval_report.json` matching `public/data/eval_report.json` byte-for-byte at `894,414` bytes), live-engine/doc parity, and zero broken links.

## Stage 10 — Scientific corrections and OpenRouter integration (2026-11-14)

The earlier stages above record historical implementation claims, not independent scientific validation. Audit found unknown outcomes promoted to ignition, material substring collisions, incomplete protocol binding, stale benchmark scores and review caches. This stage corrects those specific paths; planner, predictor and independent scientific gold still require further work.

- Reproduced material and protocol/unknown-outcome bugs with failing regression tests; introduced shared material patterns and event ordering/stage/test binding. Rebuilt corpus/index/SQLite as `2.0.1-scientific-fixes`, preserving unknown outcomes without invented ignition events.
- Downgraded quote matching to `quote_checked` and investigations to `preliminary_team_reviewed`. Quote equality does not establish scientific correctness.
- Added adversarial assertion/numeric-source guards in the verifier. These deterministic guards are not a general semantic entailment proof.
- Implemented requested OpenRouter Gemini Decisions and Embedding 2 adapters server-side, versioned query/document formatting, strict full-coverage embedding artifact validation, bounded calls and explicit fallback. Native Decisions confidence is not domain calibration. Provider contract and error-path tests use mocks, never real keys or paid requests.
- Added injection points in review/retrieval engine, model provenance and API integration. Live decisions do not imply live prose: no new prose model was chosen. Existing optional OpenAI prose integration remains separate.
- Cache TDD: deterministic then live request and conflicting explicit idempotency key both failed before correction. Signatures now include execution mode/model configuration, retrieval K and engine/corpus versions. Automatic warning-bearing fallbacks are retried; explicit key conflicts return 409. Keys and secret values are never hashed into public provenance.
- Archived reviews retain their original records/conclusions; current data are not silently attached. Incompatible recalculation/export is blocked; stale demos regenerate. Old evaluation metrics are hidden by version guards, not relabelled as current results.
- Agent records: `actions-protocol-data.md`, `actions-verifier.md`, `actions-openrouter.md`. Requested `crapper`/`dryer`/`mutator` utilities were unavailable; targeted manual review/mutation checks are documented there. No numeric CRAP or full mutation-coverage claim is made.
- Validation is recorded in IMPLEMENTATION_STATUS.md and the delivery report. No current independent scientific benchmark, live provider-quality evaluation, competitor run, new physical simulator or validation of planner/predictor is claimed in this stage.
- Final combined checks: 115/115 TypeScript tests (11 files); Python 16 tests and 16 subtests; lint/build successful; SQLite integrity ok, zero foreign-key violations. Vite emits a future native-loader compatibility warning; no current build error. Test-provider traffic was mocked; no live model-quality measurement. The tested copy is applied to the authorized original checkout only after verifying it has no intervening changes.
- Applied 50 reviewed files to the original checkout with precondition checks against baseline `90e9b0a` and SHA-256 equality. Rebuilt original production assets successfully. Code commit: `7fe6a27` (scientific corrections, provider integration and regression tests); documentation is committed separately. No user working changes were overwritten.

## Stage 11 — Local startup verification (2026-11-14)
- Started Vite and integrated API at http://127.0.0.1:5175 (5173/5174 were occupied). Health and reviews endpoints returned HTTP 200 with current engine/corpus.
- Browser exposed a blank-page `Invalid hook call`; optimized dependencies included both ember-final and sibling web copies of React. Forced cache regeneration alone did not fix it. Added Vite `resolve.dedupe` for React/React DOM so hooks and renderer use one instance.
- Browser reload rendered the workspace, Node API Connected indicator and PMMA demo findings/provenance. Lint and production build passed after the correction. Live AI remains unconfigured; no external provider requests were made.
- Local startup refreshed stored demo snapshots in data/reviews_store.json; that runtime data is intentionally excluded from this fix commit.


## Stage 12 — Live OpenRouter connection (2026-11-14)
- Saved the user-supplied key only to ignored server `.env` (0600), without logging it or browser exposure.
- Initial embedding build failed strict model-name validation. One minimal live probe showed HTTP200 model=gemini-embedding-2. Regression reproduced the failure, then exact native-ID acceptance fixed it; unrelated models remain rejected. No model substitution performed.
- Explicit paid build wrote 2,463 document vectors at 768 dimensions. Native Decisions smoke returned the selected versioned model and three valid choice answers.
- Bounded local API review (retrievalK=2) returned HTTP201, warnings=[], two live_openrouter decisions and embedding metadata. Health confirmed configured=true and embeddingIndexPresent=true. Prose remains deterministic by design.
- 36 targeted provider/runtime/review tests and lint pass. No domain accuracy, calibration or competitor-quality claim is inferred from these smoke checks. Runtime reviews, .env and private embedding artifact are not part of the fix commit.


## Stage 13 — Requested OpenAI generation model (2026-11-14)
- Read official GPT-6 Luna model documentation; retained the existing Chat Completions/JSON path and selected reasoning_effort=none. No unrelated legacy classifier model was changed.
- Model-selection regression first failed on the old gpt-4o-mini default; now passes on gpt-6-luna with provenance. Single default constant also drives API request/cache identity and health.
- Automatic review first rejected credential transfer from web/.env; user explicitly approved the exact source/destination and live OpenAI use. A second rejection concerned sending retrieved evidence; user explicitly approved questions/NASA evidence sent to OpenAI for EMBER generation. Only then performed the full live review. Secret values were never logged or committed.
- Exact model access returned HTTP200. Full review returned HTTP201 with no warnings, LIVE_AI prose from gpt-6-luna, live Gemini decision/embedding metadata, eight claim items and all five current verifier checks passing. This verifies operation, not independent domain accuracy.
- Validation: 118 tests across 12 files, lint and production build pass. `.env`, private embeddings and runtime review storage are excluded from this change commit. Code commit: a7473e0.
- Corrected a documentation command's working-directory path before this separate log commit; the source/model configuration and its prior successful verification were unaffected.
