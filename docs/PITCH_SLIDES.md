# EMBER v2 — Pitch Deck & 30-Second Video Script

> **Strict Slide Count:** 7 concise slides · **Provenance Honesty:** All evaluation metrics reflect our team-authored internal benchmark (`preliminary_team_annotation_from_primary_nasa_sources`); peer systems without local executables (`FlameBound`, `MicroFire Atlas`, `Fotia`, `HEARTH`) are reported as `0` evaluated (`outside_claimed_scope` / `not_run`), with zero fabricated numbers.

---

## Slide 1 — EMBER v2: Evidence-Grounded Spacecraft Fire Safety Workbench

- **What it is:** A deterministic-first scientific workbench transforming NASA Physical Sciences Informatics (PSI) & NTRS microgravity combustion archives into verifiable, protocol-aware design decisions.
- **Core Principle:** **Never turn topical search similarity or collapsed `BURN`/`NOBURN` labels into unverified habitat safety claims.**
- **Zero-Key Reproducibility:** Runs deterministically offline (`DETERMINISTIC_ENGINE` & `SAVED_DEMO_SNAPSHOT` modes) with optional server-side `LIVE_AI` strictly gated by a 5-check verifier.

---

## Slide 2 — The Problem: 9 Hidden Traps in Spacecraft Combustion Data

Generic RAG and static spreadsheets break when transferred to lunar/Martian missions (`30–34% O2`, `56.5–70.3 kPa`, `0.166g–0.38g`):
1. **Binary `BURN` Collapse:** Equates operator ventilation shutoff (`FT` in `BASS-II-B1`) with physical flame quench (`SE`), and hides `57` **cool-flame continuations** (`CFI`/`FLEX`).
2. **Gas-Role & Provenance Conflation:** `ACME-CFI-G` inverse-burner `oxidizer_stream` O2 (`154` rows, up to `85%`) looks identical to cabin `ambient` O2; `SAME`/`SAME-R`/`SPICE` nominal ISS air (`642` rows) is **`assumed`**.
3. **1D Bounding-Box Illusion & Missing Gravity Gates:** Overlapping 1D ranges mask empty joint `(O2, P, flow)` cells; `ACME-E-FIELD` (`0g` ISS electric fields) was falsely labeled `"simulated partial gravity"`, alongside an unvalidated hardcoded `+4% O2` margin.
4. **Planned vs. Observed Leakage:** `FLEX-2` (`PSI-68`, `0` flown rows) and `8` partial/planned claims mixed into observed evidence.

---

## Slide 3 — 3-Tier Product Hierarchy (`9+1` Workspaces + Typed HTTP API)

- **Tier 1 — Interactive Research Dashboard (`/#/`, `/#/explorer`, `/#/investigations/:id`, `/#/insights`):**
  - Parses physical conditions (`O2`, `o2Role`, `pressure`, `flow`, `direction`, `gravity`, `thickness`, `endpoint`), separates **Question Relevance**, **Observation Applicability**, and **Evidence Quality**, and strictly splits **Observed Facts**, **Author Interpretations**, **Applicability Conditions**, **Conflicts**, and **Open Gaps**.
- **Tier 2 — Protocol & Applicability Engine (`/#/protocol-compare`, `/#/variants`, `/#/modeling`, `/#/export`):**
  - Stage-bound `ProtocolStep` timeline (`4,074` steps), **9 applicability rules (`9-rules-v2.0`)**, live Design-Variant Dependency Diff, domain-gated `domain_gated_knn_ridge` predictor with refusal gates, and replicate-safe `modeling_csv` export (`groupId` preserved).
- **Tier 3 — Test-Programme Planner & Evaluation Lab (`/#/planner`, `/#/evaluation`):**
  - Exact branch-and-bound optimizer maximizing priority question coverage within `budgetRuns` while locking mandatory controls and $\ge 2$ replicates.

---

## Slide 4 — NASA PSI & NTRS Data Curation (`corpus_v2.json`)

Idempotent `pipeline/build_corpus.py` with SHA-256 `manifest_v2.json` and 7-table `ember_corpus.sqlite`:

- **`15` NASA PSI Investigations:** `14` observed + `FLEX-2` isolated as `epistemicStatus: "planned_only"` (`0` flown rows).
- **`1,678` Test Rows across `951` `groupId` Clusters:** Links sequential reused `BASS` samples, aged `SAME`/`SAME-R` smoke pairs, and replicates to prevent CV leakage.
- **`4,074` Protocol Steps & `2,378` Typed Events:** Null timestamps preserved honestly (`timeStartS: null` when absent in `NASA/TM-20210011385`); `154` `oxidizer_stream` rows and `642` `assumed`-atmosphere rows tagged explicitly.
- **`145` Verbatim Claims & `2,463` Indexed Chunks:** All `8` audited partial/planned claims fixed (`c-0021`, `c-0037`, `c-0041`, `c-0045`, `c-0101`, `c-0105`, `c-0109`, `c-0113`); `64D` `tfidf-lsa-svd-64d-v1` vectors preserve section headers and table units.

---

## Slide 5 — Live Design-Variant Diff & Constrained Test Planner

- **Design-Variant Dependency Graph (`/#/variants`):**
  - Shifting an ISS PMMA baseline (`21% O2 / 101.3 kPa / 0g`, `112` admissible / `26` conditional) to **Lunar Base (`34% O2 / 56.5 kPa / 0.166g`)** immediately triggers **`RULE-JOINT-01`** (`3` weakened edges, `7` downgraded) and **`RULE-GRAV-01`** (`1` invalidated edge, **`131` tests become inadmissible**).
- **Exact Constrained Test Planner (`/#/planner`):**
  - On Lunar Rover PMMA (`demo-pmma-lunar`, `insufficient_data` at `30% O2 / 70.3 kPa / 0.166g`), allocates `9 / 10` runs across `blk-ctrl-baseline` (**Mandatory Control locked**), `blk-joint-atmosphere`, `blk-partial-g-bracket`, and `blk-stepped-quench`.
  - **Epistemic Guardrail:** Explicitly labeled **Priority Question Coverage**—never Bayesian information gain.

---

## Slide 6 — Preliminary 100-Case Evaluation & Honest Competitor Audit

*Benchmark: `100` gold cases across `36` non-overlapping `groupId` clusters (`50 dev / 20 val / 30 test`), `annotationProvenance: preliminary_team_annotation_from_primary_nasa_sources`:*

- **Full EMBER v2 (`Variant D`) vs. Baselines (`A` BM25 / `B` Hybrid RAG / `C` Static Matcher):**
  - **Investigation Recall@5 / nDCG@5:** **`97.4%`** (`92.5/95`) / **`0.9606`** (best across all variants)
  - **Test Recall@5:** **`58.8%`** overall (`60.8%` on held-out `test`) vs **`36.3%`** (`25.6%`) for Static Matcher
  - **Pairwise Comparability 3-Way (`n=20`):** **`90.0%`** (`18/20`) vs `75.0%` Static / `25.0%` RAG / `20.0%` BM25
  - **Expected Rule Recall (`/106`):** **`75.5%`** vs **`0.0%`** for Baselines A, B, and C
  - **JEV Atomic Accuracy / Brier:** **`89.5%`** (`94/105`) / **`0.1157`** (vs uncalibrated `83.8%` / `0.1586`)
  - **Config-Change Dep. F1 / Planner Exactness / Verifier Pass:** **`43.3%`** (`26/60`) / **`100.0%`** (`10/10`) / **`95.0%`** (`95/100`)
- **Competitor Audit (Zero Fabricated Metrics):** `EMBER_v2` `67/100` vs Common-Data adapters (`StaticMatcher 61/100`, `RAG 44/100`, `BM25 40/100`); external peer systems (**FlameBound**, **MicroFire Atlas**, **Fotia**, **HEARTH**) = **`0` evaluated** (`outside_claimed_scope` / `not_run`).

---

## Slide 7 — Modes, Non-Qualification Disclaimer & Next Steps

- **Three Explicit Modes:** `SAVED_DEMO_SNAPSHOT` (`demo-pmma-lunar`, `demo-cool-flame`), `DETERMINISTIC_ENGINE` (default offline live engine), and optional server-side `LIVE_AI` (strictly post-checked by all 5 verifier gates).
- **Non-Qualification Disclaimer:** EMBER v2 is a **scientific evidence workbench**, **not** flight certification or NASA qualification. PSI v2 has `0` actual orbital partial-gravity (`0.166g`/`0.38g`) flammability rows, `FLEX-2` is `planned_only`, and schematic diagrams are labeled non-computational.
- **Immediate Roadmap:** Pairwise boundary scoping (`GOLD-002`/`005`), null-flow handling inside `testJointDistance` (`GOLD-058`), `SIBAL` woven-fabric exemption in `RULE-UNK-01` (`GOLD-045`), and `buildDependencies` per-parameter filtering.

---

## <= 30-Second Video Script (69 Words)

> Standard AI search fails spacecraft fire safety, confusing ventilation shutoffs with flame extinction, cool flames with non-ignition, and burner jets with cabin air. EMBER v2 turns 15 NASA PSI investigations with test tables, 1,678 tests, 4,074 protocol steps, and 2,378 events into a protocol-gated workbench. On our preliminary 100-case benchmark, EMBER achieves 90% comparability accuracy, 82.6% applicability F1, 75.5% rule recall, and 100% planner constraint preservation, refusing out-of-domain guesses rather than extrapolating.
