> Historical 2.0.0 artifact. Engine/corpus 2.0.1 changed scientific semantics. Metrics and demo counts below have not been revalidated for 2.0.1; they are not current scientific validation. See IMPLEMENTATION_STATUS.md.

# EMBER v2 — Challenge Submission (English)

**Evidence-Grounded Microgravity & Spacecraft Fire Safety Scientific Workbench**  
**Corpus & Engine Version:** `2.0.0-ember-final` · **Rules Version:** `9-rules-v2.0` · **JEV Prompt Version:** `jev-v1.0`  
**Evaluation Annotation Provenance:** `preliminary_team_annotation_from_primary_nasa_sources` *(internal preliminary benchmark grounded in primary NASA PSI/NTRS records; not an independent external scientific audit or flight qualification)*

---

## 1. The Problem: Why Generic RAG & Table Lookups Fail Spacecraft Fire Safety

NASA's Physical Sciences Informatics (PSI) and Technical Reports Server (NTRS) preserve decades of orbital combustion experiments (`BASS`, `BASS-II`, `Saffire-I/II/III`, `FLEX`, `CFI`, `SAME`, `SAME-R`, `ACME`, `SPICE`, `SLICE`). Yet applying these datasets to new mission designs—such as a lunar base (`34% O2`, `56.5 kPa`, `0.166 g`) or pressurized lunar rover (`30% O2`, `70.3 kPa`, `0.166 g`)—routinely fails when tools flatten experimental rows into generic text chunks or naive parameter ranges.

Our forensic audit of the legacy prototype ([REUSE_FIX_MISSING.md](./REUSE_FIX_MISSING.md)) documented **9 critical scientific failure modes** that EMBER v2 eliminates by construction:

1. **Binary `BURN`/`NOBURN` Collapse:** Collapsing multi-stage combustion timelines into one scalar conflates intentional operator ventilation cutoff (`flow_turned_off` / `FT` in `BASS-II-B1`) with physical flow-reduction extinction (`SE`), and hides low-temperature **cool-flame continuation** (`57` `CFI`/`FLEX` tests) after radiative hot-flame quench.
2. **Missing Physical Roles & Contexts:** Untyped `O2%` columns mix `ACME-CFI-G` inverse burner **`oxidizer_stream`** feeds (`154` rows, up to `85% O2`) with cabin **`ambient`** air, while `SAME`/`SAME-R`/`SPICE` nominal ISS cabin air (`642` rows) carries **`assumed`** provenance indistinguishable from sensor readings.
3. **Material & Gravity Stripping:** Legacy `proximity()` and `findingStatus()` stripped `fuel`, `fuelPhase`, and `gravityAware`, letting liquid droplet or PMMA rod data certify mismatched solid fabrics or partial-gravity premises.
4. **1D Marginal Bounding-Box Trap:** Independent `[min, max]` parameter intervals falsely endorse empty joint `(O2, pressure, flow)` cells where high O2 was only tested at low pressure or different flow speeds.
5. **Uncalibrated `pBurn` Probabilities:** Inverse-distance-weighted kNN burn probabilities + Wilson intervals produced overconfident percentages across incompatible endpoints.
6. **Arbitrary `+4% O2` Margin & `E-FIELD` Misattribution:** Hardcoding `+4% O2` uniformly across fuels and labeling `ACME-E-FIELD` (ISS `0 g` electric-field studies) as `"simulated partial gravity"` violated primary `psi-22` (`c-0125`) documentation.
7. **Planned vs. Observed Conflation:** `FLEX-2` (`PSI-68`, `0` flown public rows) and 8 audited partial/planned claims (`c-0021`, `c-0037`, `c-0041`, `c-0045`, `c-0101`, `c-0105`, `c-0109`, `c-0113`) were mixed with observed flight evidence.
8. **ID-Only Citation Checks:** Matching `[c-0001]` tokens via regex checked existence without verifying numbers, units, epistemic status, constraint preservation, or lexical entailment.
9. **Heuristic Replicate Leakage:** Tolerance-based replicate matching failed to link sequential reused `BASS` samples or aged `SAME`/`SAME-R` smoke pairs (`SAME-29` / `SAME-29a`), leaking near-duplicates across validation splits.

---

## 2. Product Hierarchy (3-Tier Decision-Support Architecture)

EMBER v2 is organized into a strict three-tier workflow exposed across **9+1 accessible workspaces** (`HashRouter` in [App.tsx](../src/ui/App.tsx)) and a typed HTTP API ([openapi.json](./openapi.json)):

### Tier 1 — Interactive Research Dashboard & Investigation Ranker
- **Review Workspace (`/` & `/reviews/:id`):** Structured `ResearchQuery` builder with habitat presets (`ISS`, `Crew Capsule`, `Lunar Base`, `Pressurized Lunar Rover`, `Mars Base`, `EVA Suit`, `Custom`), safety task selector, 12 typed combustion endpoints, `o2Role` selector, non-blocking `unknownFields`, and expandable `ProvenanceTrace` (`ProtocolStep -> TestEvent -> ApplicabilityDecision -> SourceRef quote & locator`).
- **Experiment Explorer (`/explorer`) & Investigation Dossier (`/investigations/:id`):** Filters all `15` PSI investigations and scores each independently across **Question Relevance**, **Observation Applicability**, and **Evidence Quality & Completeness**, clearly flagging `FLEX-2` as **`Planned Matrix Only`**.
- **Fire Safety Insights (`/insights`):** Organizes prevention, detection, and suppression evidence into strictly separated **Observed Facts**, **Author Interpretations**, **Engineering Implications & Applicability Conditions**, and **Open Questions**.

### Tier 2 — Protocol & Applicability Engine
- **Protocol Timeline & Comparison (`/protocol-compare`):** Inspects stage-bound `ProtocolStep` timelines (`preparation` → `ignition` → `steady_burn` → `flow_modification` / `gas_intervention` → `aging` → `termination`) and evaluates 2–4 test side-by-side contrasts (`Admissible Contrast` vs `Confounded / Inadmissible Contrast`) alongside SVG series plots.
- **Design Variant Diff (`/variants`):** Live dependency-graph recalculation showing how design edits (e.g., `21% -> 34% O2`, `0.1 mm -> 3.0 mm` slab, or `o2Role -> oxidizer_stream`) retain, weaken, or invalidate rule edges and shift test verdicts.
- **Modeling & Visual Lab (`/modeling`) & Export (`/export`):** Empirical NASA data replay, domain-gated `domain_gated_knn_ridge` endpoint prediction with leave-one-group-out CV refusal gates (`refused_out_of_domain` / `refused_insufficient_data` / `refused_below_baseline`), a visually gated `CONCEPTUAL ILLUSTRATION — NOT A PHYSICAL CALCULATION` schematic, and replicate-safe `modeling_csv` export (`groupId`, `o2Role`, provenance, explicit `null`s, refusing mixed-endpoint merges).

### Tier 3 — Constrained Test-Programme Planner & Evaluation Lab
- **Test Programme Planner (`/planner`):** Exact branch-and-bound selector over candidate `TestBlock`s maximizing priority question coverage within `budgetRuns` while locking mandatory baseline controls and replicate counts ($\ge 2$). Explicitly labeled as a Priority Question Coverage selector—never Bayesian information gain.
- **Evaluation Lab (`/evaluation`):** Displays the live `eval_report.json` benchmark across Baselines A–D, 5 engine ablations, Whole-Product scope audits, and Common-Data adapters.

---

## 3. NASA PSI & NTRS Data Curation (`corpus_v2.json`)

Built deterministically by [pipeline/build_corpus.py](../pipeline/build_corpus.py) from raw `PSI-*` experimental tables/JSONs, NTRS JSON/text reports (including `NASA/TM-20210011385` Appendix A and Tables 5.1/7.1), and `sources_cache.json`, with all artifacts checksummed in [manifest_v2.json](../public/data/manifest_v2.json):

| Corpus Artifact / Dimension | Measured Count / Specification |
| :--- | :--- |
| **Corpus & Engine Version** | `2.0.0-ember-final` |
| **Investigations** | **`15`** (`14` `observed` + **`1` `planned_only` (`FLEX-2` / `PSI-68`, `0` flown rows)**) |
| **Test Rows** | **`1,678`** (`1,651` with observed outcomes, `528` with primary numeric target, `1,678` protocol-segmented) |
| **Deterministic `groupId` Clusters** | **`951`** (linking sequential reused samples, `SAME`/`SAME-R` aged pairs, and condition replicates) |
| **Protocol Steps (`ProtocolStep[]`)** | **`4,074`** stage-bound steps (`timeStartS`/`timeEndS` kept `null` when absent in source) |
| **Recorded Events (`TestEvent[]`)** | **`2,378`** typed endpoint events (`57` with cool-flame continuation) |
| **Gas-Role & Assumed Coverage** | **`154`** `oxidizer_stream` inverse-flame rows (`ACME-CFI-G`); **`642`** `assumed`-atmosphere rows (`SAME`/`SAME-R`/`SPICE`) |
| **Verbatim Claims (`Claim[]`)** | **`145`** verbatim-verified claims against `sources_cache.json` (all `8` audited partial/planned claims fixed) |
| **Primary Sources & Context Items** | **`68`** sources · `6` missions · `9` earth items · `5` history items |
| **Vector Chunk Index (`chunks_index.json`)** | **`2,463`** chunks (`tfidf-lsa-svd-64d-v1`, 64D L2-normalized vectors preserving section headers & table units) |
| **Relational SQLite Mirror (`ember_corpus.sqlite`)** | `7` tables (`investigations`, `tests`, `protocol_segments`, `events`, `claims`, `chunks`, `sources`), passing `PRAGMA integrity_check` & `foreign_key_check` |

---

## 4. Technical Engine & Design-Variant Dependency Graph

Implemented in pure isomorphic TypeScript ([src/core/](../src/core/index.ts)):

- **Hybrid Retrieval & JEV Passage Triage ([retrieval.ts](../src/core/retrieval.ts), [jev.ts](../src/core/jev.ts)):** Reciprocal Rank Fusion (`k = 60`) over BM25, 64D TF-IDF/TruncatedSVD dense cosine matching, and structured query filtering. Retrieved passages pass through **`jev-v1.0`**, evaluating 3 bounded atomic questions (`Q1_RELEVANCE`, `Q2_OBSERVATION`, `Q3_CONTRADICTION`) with softmax probabilities and routing to `evidence`, `context`, or **`conflict`** (contradictions are never dropped).
- **9-Rule Applicability Gate & Protocol Segmenter ([protocol.ts](../src/core/protocol.ts), [applicability.ts](../src/core/applicability.ts)):** Evaluates `RULE-EP-01` (endpoint), `RULE-MAT-01` (fuel/phase), `RULE-GEOM-01` (thin film $\le 0.5\text{ mm}$ vs intermediate vs thick slab $\ge 2\text{ mm}$ vs rod/fabric & enclosure scale), `RULE-UNK-01` (`unknown !== unknown`), `RULE-GAS-01` (`ambient` vs `oxidizer_stream`), `RULE-PROV-01` (`assumed` capped at `conditional_support`), `RULE-GRAV-01` (regime + `actual_flight` vs `simulated_analogue`/`ground_1g`), `RULE-PROT-01` (`FT` shutoff vs physical extinction, flow direction, cool-flame caveat), and `RULE-JOINT-01` (multi-dimensional `(O2, P, flow)` distance + `marginalOverlapButJointMissing`).
- **Design-Variant Dependency Graph ([dependencies.ts](../src/core/dependencies.ts)):** Maps query parameters (`o2Pct`, `o2Role`, `pressureKpa`, `flowCmS`, `flowDirection`, `thicknessMm`, `geometry`, `gravityG`, `material`, `targetEndpoint`) to rules via `PARAMETER_RULE_MAP`. Calling `recalculateDesignVariant` re-evaluates the corpus pool under the patched design and returns **`retainedEdges`**, **`weakenedEdges`**, **`invalidatedEdges`**, **`verdictDelta`**, and explicit **`changedParameter -> affectedRuleOrEvidence -> conclusionChange`** impact chains.
- **5-Gate Automated Verifier ([verifier.ts](../src/core/verifier.ts)):** Checks every generated synthesis across `citationCheck`, `numericUnitCheck`, `epistemicCheck`, `constraintPreservationCheck`, and `lexicalEntailmentCheck`.

---

## 5. Evaluation Results (`eval_report.json` & `EVALUATION_REPORT.md`)

> [!IMPORTANT]
> **Annotation Provenance (`preliminary_team_annotation_from_primary_nasa_sources`):**  
> [dev10_cases.json](../eval/dev10_cases.json) (`10` cases, `9` groups) and [gold_100_cases.json](../eval/gold_100_cases.json) (`100` cases across **`36` distinct `groupId` clusters** split **`50 dev / 20 val / 30 test`** with `0` group overlap across splits) are team-authored benchmark suites grounded directly in primary NASA PSI tables, NTRS abstracts, and `NASA/TM-20210011385`. This represents preliminary internal validation, not an independent third-party audit.

### 5.1 Main System Variants (`n = 100`, `36` Group Clusters, 95% Group-Clustered Bootstrap CIs)

| Metric (Denominator) | Variant A: BM25 Only | Variant B: Standard RAG | Variant C: Static Matcher | Variant D: Full EMBER v2 |
| :--- | :---: | :---: | :---: | :---: |
| **Inv Recall@5** (`/95`) | `0.9553` `[0.9243, 0.9824]` | `0.9219` `[0.8827, 0.9579]` | `0.9430` `[0.9093, 0.9704]` | **`0.9763`** (`92.75/95`) `[0.9493, 0.9942]` |
| **Inv nDCG@5** (`/95`) | `0.9132` | `0.9111` | `0.8706` | **`0.9621`** (`91.40/95`) |
| **Test Recall@5** (`/89`) | `0.4916` | `0.4148` | `0.3633` | **`0.5861`** (`52.17/89`; **`0.5957`** on `test` `/27`) |
| **Applicability F1** | `0.7879` (`130/165`) | `0.8050` (`128/159`) | **`0.8788`** (`116/132`) | `0.8120` (`108/133`) `[0.7257, 0.8846]` |
| **Applicability 3-Way** (`/100`) | `0.4000` | `0.4400` | **`0.6500`** | `0.6200` (`comparability`: **`0.9500`** `19/20`) |
| **Confusion Matrix** (`TP/FP/FN/TN`) | `65/35/0/0` | `64/30/1/5` | **`58/9/7/26`** | `54/14/11/21` (`FAR=0.4000`, `FRR=0.1692`) |
| **Expected Rule Recall** (`/106`) | `0.0000` (`0/106`) | `0.0000` (`0/106`) | `0.0000` (`0/106`) | **`0.7453`** (`79/106`) |
| **Answer Boundary Acc** (`/100`) | `0.6200` | `0.6700` | **`0.7600`** | `0.6000` (`full_review`: **`0.8000`** `8/10`) |
| **Config-Change Dep. F1 / Post-Bnd** | `0.0000` / `0.0000` | `0.0000` / `0.0000` | `0.0000` / `0.0000` | **`0.6857`** (`24/35`) / **`0.7000`** (`7/10`) |
| **JEV Atomic Acc / Brier / LogLoss** | `0.8381` / `0.2500` / `0.6931` | `0.8381` / `0.1586` / `0.5129` | `0.8381` / `0.1586` / `0.5129` | **`0.8952`** (`94/105`) / **`0.1157`** / **`0.4061`** |
| **Planner Exact / Ctrl / Rep** (`/10`) | `0.50` / `0.50` / `0.50` | `0.50` / `0.50` / `0.50` | `0.50` / `0.50` / `0.50` | **`1.0000`** (`10/10` / `10/10` / `10/10`) |
| **Verifier Pass Rate** (`/100`) | `n/a` | `n/a` | `n/a` | **`0.9600`** (`96/100`) |
| **Mean / p95 Latency (ms)** | `14.32` / `14.27` | `37.77` / `63.16` | `38.35` / `63.20` | `420.06` / `924.19` (JEV: `0.405 ms`) |

*Granularity Trade-off Note:* `Variant C (Static Matcher)` outputs only binary `admissible`/`inadmissible` labels and never emits `conditional` or rule rationales (`0/106` expected rules, `0/14` config-change dependencies). Whenever EMBER's 9-rule engine properly downgrades 1D/surrogate proximity cases to `conditional_support`, binary confusion metrics count `conditional` as positive admission; meanwhile Full EMBER dominates **Test Recall@5** (`0.5861` vs `0.3633`), **Pairwise Comparability 3-Way** (`0.9500 (19/20)` vs `0.7500`), **Expected Rule Recall** (`0.7453` vs `0.0000`), **`full_review` Boundary Accuracy** (`0.8000` vs `0.5000`), **`config_change` Post-Boundary** (`0.7000` vs `0.4000`), **JEV Calibration**, and **Planner Constraint Preservation** (`10/10`).

### 5.2 Ablations (`n = 100`) & Competitor Adapters
- **5 Component Ablations:**
  - `D_no_protocol`: `expRuleR` drops `0.7453 -> 0.5943` (`-16` detections), false admissions rise (`FP: 14 -> 17`, `FAR 0.4000 -> 0.4857`).
  - `D_no_geometry`: `testR@5` drops (`0.5861 -> 0.5590`), `expRuleR` drops (`0.7453 -> 0.6415`), `cfgF1` drops (`0.6857 -> 0.6471`), `verPass` drops (`0.96 -> 0.95`), while `app3Way` rises (`0.62 -> 0.67`) because `RULE-UNK-01` thickness checks inside the geometry gate currently downgrade `SIBAL` fabric sheets lacking `thicknessMm`.
  - `D_collapsed_outcomes`: `invR@5` drops `0.9763 -> 0.9728` and `expRuleR` drops `79/106 -> 77/106` (leaving identical applicability counts because `checkRuleProt01` still calls `matchProtocolSegment`—an observed gap documented in [EVALUATION_REPORT.md](./EVALUATION_REPORT.md)).
  - `D_no_jev`: JEV atomic accuracy drops `0.8952 -> 0.8381`, Brier degrades `0.1157 -> 0.1586`, LogLoss `0.4061 -> 0.5129`, and `verifierPassRate` drops `0.9600 -> 0.8800`.
  - `D_bm25_only`: `invNDCG@5` drops `0.9621 -> 0.9283`, `expRuleR` drops `79/106 -> 76/106`, and `verifierPassRate` drops `0.9600 -> 0.9200`.
- **Competitor Scope Audit & Common-Data Adapters ([competitor_benchmark.ts](../eval/competitor_benchmark.ts)):**
  - **External Peer Systems (`FlameBound`, `MicroFire Atlas`, `Fotia`, `HEARTH`):** No local binaries or endpoints exist in the workspace (`0` evaluated cases, `0` fabricated metrics): explicitly classified per case as **`outside_claimed_scope`** (`55` / `65` / `55` / `55`) or **`not_run`** (`45` / `35` / `45` / `45`), with `COMPETITOR_*_CMD` env hooks documented for future live runs.
  - **Common-Data Executed Adapters on Identical `corpus_v2.json` (`n = 100`):** `EMBER_v2` (`62/100` `app3Way`, `0.8000` positive coverage, `0.4000` FAR, `0.6000` boundary, `353.41 ms`) vs `StaticMatcher_CommonData_Adapter` (`61/100`, `0.3714` FAR, `0.7400` boundary, `3.44 ms`), `RAG_CommonData_Adapter` (`44/100`, `0.8571` FAR, `28.96 ms`), `BM25_CommonData_Adapter` (`40/100`, `1.0000` FAR, `6.89 ms`).

---

## 6. AI Usage, Runtime Execution Modes & Verifier Disclosure

EMBER v2 enforces strict transparency via `SynthesisMode` in every API envelope and UI badge:

- **`SAVED_DEMO_SNAPSHOT`:** Pre-seeded deterministic judge snapshots (`demo-pmma-lunar`, `demo-cool-flame`) stored in `data/reviews_store.json` and reopened via `GET /api/reviews/:id` without invoking any LLM.
- **`DETERMINISTIC_ENGINE` (Default Live Mode):** Runs the complete hybrid RRF retrieval, calibrated `jev-v1.0` classifier, 9-rule applicability engine, dependency DAG, exact branch-and-bound planner, structured synthesis, and 5-gate verifier offline with zero external API keys (and falls back seamlessly to an in-browser engine over `./data/*.json` + `localStorage` if the Node backend is absent).
- **`LIVE_AI` (Optional Server-Side Synthesis):** Triggered only when `useLiveAi: true` is explicitly sent **and** `OPENAI_API_KEY` is configured on the server (`process.env` or `.env`—never sent to the browser). If absent or unreachable, `server/api.ts` falls back explicitly to `DETERMINISTIC_ENGINE` with a visible warning. Even when `LIVE_AI` runs, deterministic `answerBoundary` cannot be overridden and outputs are checked by all 5 verifier gates.

---

## 7. Non-Qualification Disclaimer & Engineering Next Steps

> [!WARNING]
> **Non-Qualification & Scientific Scope Notice**: EMBER v2 is a **scientific evidence-grounded decision-support workbench**, **not** a spacecraft flight certification, hardware qualification, or NASA-endorsed engineering authority. Zero actual orbital/lunar/Martian partial-gravity (`0.166 g` / `0.38 g`) flammability rows exist in PSI v2, `FLEX-2` remains `planned_only` (`0` flown rows), `Conceptual Illustration` schematics are non-computational, and all evaluation benchmarks reflect preliminary team annotations (`preliminary_team_annotation_from_primary_nasa_sources`).

**Documented Immediate Next Steps (from [EVALUATION_REPORT.md](./EVALUATION_REPORT.md) Error Analysis):**
1. Fix `determineAnswerBoundary` in `src/core/generator.ts` to inspect pairwise `comparisonTestIdA`/`comparisonTestIdB` inadmissibility directly (resolving `10/20` `comparability` boundary mismatches such as `GOLD-002`/`GOLD-005`).
2. Update `testJointDistance` in `src/core/applicability.ts` so `flow = null` on quiescent/unlogged rows does not bypass `(O2, pressure)` joint-envelope rejection (`GOLD-058`/`084`/`085`).
3. Exempt `fabric` geometries (e.g., `SIBAL`) from planar solid `RULE-UNK-01` thickness penalties (`GOLD-045/046/047`) and filter `buildDependencies` per patched parameter (`GOLD-042`).
4. Propagate `collapsedOutcomes` inside `checkRuleProt01` for cleaner ablation separation, and bind `COMPETITOR_*_CMD` adapters if external teams supply CLI binaries.
