# EMBER v2 Scientific & Systems Evaluation Report

> [!IMPORTANT]
> **Annotation Provenance (`preliminary_team_annotation_from_primary_nasa_sources`)**:  
> Both [dev10_cases.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/dev10_cases.json) and [gold_100_cases.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/gold_100_cases.json) are team-authored benchmark suites grounded directly in primary NASA PSI records, NTRS abstracts, and `NASA/TM-20210011385` Appendix A / Tables 5.1 & 7.1. **This is preliminary internal validation, not an independent third-party human audit.**

**Engine Version:** `2.0.0-ember-final` | **Corpus Version:** `2.0.0-ember-final` (15 investigations, 1,678 tests, 145 claims, 2,463 indexed chunks with 64D SVD) | **Report Source:** [eval_report.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/public/data/eval_report.json) (`generatedAt: 2026-11-14T20:55:40.450Z`, `competitorBenchmark.generatedAt: 2026-11-14T20:56:30.051Z`)

---

## 1. Benchmark Architecture & Split Discipline

To prevent test-case leakage across closely related spacecraft fire scenarios, the 100 benchmark cases in [gold_100_cases.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/gold_100_cases.json) are partitioned by **group cluster (`groupId`)** rather than random row sampling:

| Split | Cases | Distinct `groupId`s | Group Overlap | Purpose |
| :--- | :---: | :---: | :---: | :--- |
| `dev` | 50 | 17 | 0 across splits | Iterative debugging & protocol edge-case tuning |
| `val` | 20 | 8 | 0 across splits | Model/rule trade-off checking & ablation tuning |
| `test` | 30 | 11 | 0 across splits | Held-out evaluation (including unseen hard-case combinations) |
| **Total** | **100** | **36** | **0** | Full evaluation reported with 95% group-clustered bootstrap CIs |

### Category & Hard-Case Coverage (`n = 100`)

- **By Category (`gold_100_cases.json`):** `investigation_selection` (20), `comparability` (20), `summary` (15), `protocol_outcome` (15), `config_change` (10), `insufficient_or_invalid_premise` (10), `full_review` (10). Admissible/conditional positives: `65`; inadmissible negatives: `35`.
- **Mandatory Hard-Case Families Covered Across `dev` and `test`:**
  - `positive_admissible_control` (14) — verifies EMBER does not blanket-refuse valid comparisons
  - `unsupported_joint_combination` (10) — empty $(O_2, P, \text{flow})$ cells inside valid 1D marginal bounds
  - `planned_vs_observed` (10) — planned test matrices (`FLEX-2`, `ACME-BRE` planned tables) vs flight observations
  - `operator_termination_vs_physical_extinction` (8) — `flow_turned_off` / `FT` / `N2 jet` vs `extinguished_at_reduced_flow` / `SE`
  - `flight_ug_vs_simulated_partial_g_or_1g` (8) — `actual_flight` 0g vs `ACME E-FIELD` / `ground_1g` / partial-$g$
  - `geometry_thickness_substrate_mismatch` (7) — `0.1 mm` PMMA film vs `3–10 mm` slabs vs `6.35 mm` rods; `MSG` vs `Cygnus` ducts
  - `hot_extinction_cool_flame_continuation` (6) — hot-flame quench with continued cool-flame burning (`CFI` / `FLEX` n-alkanes)
  - `ambient_vs_oxidizer_stream` (6) — `ACME-CFI-G` inverse burner stream $O_2$ (up to 85%) vs cabin ambient $O_2$
  - `same_initial_flow_different_protocol` (4) — identical initial flow (e.g. `BASS-II-B1` vs `B17`, `P1` vs `O3a`) with diverging step-down histories
  - `unknown_not_equal_unknown` (4) — missing/null fields (`unknown !== unknown`, e.g., `Saffire-III` / unknown thickness)
  - `standard` (23) — representative domain, JEV, and planning queries
- **Development Smoke Suite ([dev10_cases.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/dev10_cases.json), `n=10, groups=9`):** Full EMBER achieves **Inv Recall@5 `1.0000 (9/9)`**, **Test Recall@5 `0.7778 (7/9)`**, **App F1 `0.9091 (10/11)`**, **App 3-Way `0.8000 (8/10)`** (`TP=5, FP=1, FN=0, TN=4`), **Answer Boundary `0.8000 (8/10)`**, **Positive Coverage `1.0000 (5/5)`**, **JEV Atomic `0.8333 (5/6)`** (Brier `0.0591`, LogLoss `0.2043`), **Planner Exactness/Controls/Replicates `1.0000 (1/1)`**, **Verifier Pass `1.0000 (10/10)`**, mean latency `273.1 ms` (`p95 = 361.17 ms`).

---

## 2. Main System Variants Comparison (`n = 100`, `36` Groups)

Evaluated directly against [src/core/](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/index.ts) via [run_evaluation.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/run_evaluation.ts). On `config_change` cases (`n = 10`), `Full EMBER` applies `recalculateDesignVariant` and `determineAnswerBoundary` so metrics score post-patch behavior, while static baselines evaluate a single unpatched snapshot. Confidence intervals are 95% group-clustered bootstrap intervals over `groupId`.

### 2.1 Overall & Held-Out Test Split Summary

| Metric (with Denominator) | Variant A: BM25 Only | Variant B: Standard RAG | Variant C: Static Matcher | Variant D: Full EMBER v2 |
| :--- | :---: | :---: | :---: | :---: |
| **Inv Recall@5** *(overall, `/95`)* | `0.9553` `[0.9243, 0.9824]` | `0.9219` `[0.8827, 0.9579]` | `0.9430` `[0.9093, 0.9704]` | **`0.9763`** (`92.75/95`) `[0.9493, 0.9942]` |
| **Inv nDCG@5** *(overall, `/95`)* | `0.9132` `[0.8761, 0.9465]` | `0.9111` `[0.8751, 0.9439]` | `0.8706` `[0.8147, 0.9148]` | **`0.9621`** (`91.4013/95`) `[0.9332, 0.9852]` |
| **Test Recall@5** *(overall, `/89`)* | `0.4916` `[0.3945, 0.5797]` | `0.4148` `[0.3234, 0.5059]` | `0.3633` `[0.2822, 0.4476]` | **`0.5861`** (`52.1667/89`) `[0.5038, 0.6657]` |
| **Test nDCG@5** *(overall, `/89`)* | `0.4801` `[0.3870, 0.5653]` | `0.3729` `[0.2864, 0.4582]` | `0.3520` `[0.2773, 0.4279]` | **`0.5700`** (`50.729/89`) `[0.4783, 0.6549]` |
| **Test Recall@5** *(held-out `test`, `/27`)* | `0.5401` `[0.3910, 0.6897]` | `0.4506` `[0.2581, 0.6429]` | `0.2562` `[0.1200, 0.3974]` | **`0.5957`** (`16.0833/27`) `[0.5030, 0.7019]` |
| **Applicability Precision** *(overall)* | `0.6500` (`65/100`) | `0.6809` (`64/94`) | **`0.8657`** (`58/67`) | `0.7941` (`54/68`) `[0.6769, 0.8933]` |
| **Applicability Recall** *(overall, `/65`)* | **`1.0000`** (`65/65`) | `0.9846` (`64/65`) | `0.8923` (`58/65`) | `0.8308` (`54/65`) `[0.7302, 0.9206]` |
| **Applicability F1** *(overall)* | `0.7879` (`130/165`) | `0.8050` (`128/159`) | **`0.8788`** (`116/132`) | `0.8120` (`108/133`) `[0.7257, 0.8846]` |
| **Applicability 3-Way Acc** *(overall, `/100`)* | `0.4000` `[0.2842, 0.5152]` | `0.4400` `[0.3163, 0.5600]` | **`0.6500`** `[0.5354, 0.7547]` | `0.6200` `[0.5196, 0.7184]` |
| **Applicability 3-Way Acc** *(held-out `test`, `/30`)* | `0.3667` `[0.1290, 0.6061]` | `0.4667` `[0.2333, 0.7000]` | **`0.6667`** `[0.4667, 0.8387]` | `0.5333` `[0.3793, 0.7000]` |
| **Confusion Matrix** *(TP / FP / FN / TN)* | `65 / 35 / 0 / 0` | `64 / 30 / 1 / 5` | **`58 / 9 / 7 / 26`** | `54 / 14 / 11 / 21` |
| **False Admission Rate (FAR)** *($\text{FP}/35$)* | `1.0000` (`35/35`) | `0.8571` (`30/35`) | **`0.2571`** (`9/35`) | `0.4000` (`14/35`) |
| **False Rejection Rate (FRR)** *($\text{FN}/65$)* | `0.0000` (`0/65`) | `0.0154` (`1/65`) | `0.1077` (`7/65`) | `0.1692` (`11/65`) |
| **Expected Rule Recall** *(overall, `/106`)* | `0.0000` (`0/106`) | `0.0000` (`0/106`) | `0.0000` (`0/106`) | **`0.7453`** (`79/106`) |
| **Answer Boundary Acc** *(overall, `/100`)* | `0.6200` `[0.5149, 0.7255]` | `0.6700` `[0.5784, 0.7600]` | **`0.7600`** `[0.6667, 0.8416]` | `0.6000` `[0.4848, 0.7087]` |
| **Positive Coverage** *(overall, `/65`)* | **`1.0000`** (`65/65`) | `0.9846` (`64/65`) | `0.8923` (`58/65`) | `0.8308` (`54/65`) `[0.7302, 0.9206]` |
| **Config-Change Dep. F1** *(overall)* | `0.0000` (`0/14`) | `0.0000` (`0/14`) | `0.0000` (`0/14`) | **`0.6857`** (`24/35`; P `0.5714`, R `0.8571`) |
| **Config-Change Dir / Post-Bnd Acc** *(`/10`)* | `0.0000` / `0.0000` | `0.0000` / `0.0000` | `0.0000` / `0.0000` | **`0.6000`** (`6/10`) / **`0.7000`** (`7/10`) |
| **JEV Atomic Acc** *(overall, `/105`)* | `0.8381` `[0.7576, 0.9167]` | `0.8381` `[0.7576, 0.9167]` | `0.8381` `[0.7576, 0.9167]` | **`0.8952`** (`94/105`) `[0.8286, 0.9479]` |
| **JEV Routing / Brier / LogLoss** | `0.5143` / `0.25` / `0.6931` | `0.5143` / `0.1586` / `0.5129` | `0.5143` / `0.1586` / `0.5129` | **`0.5714`** (`20/35`) / **`0.1157`** / **`0.4061`** |
| **Planner Exact / Ctrl / Rep** *(`/10`)* | `0.50` / `0.50` / `0.50` | `0.50` / `0.50` / `0.50` | `0.50` / `0.50` / `0.50` | **`1.0000`** (`10/10` / `10/10` / `10/10`) |
| **Verifier Pass / Completion** *(`/100`)* | `n/a (0/0)` / `1.00` | `n/a (0/0)` / `1.00` | `n/a (0/0)` / `1.00` | **`0.9600`** (`96/100`) / `1.00` (`100/100`) |
| **Latency Mean / p95 (ms)** | `14.32` / `14.27` | `37.77` / `63.16` | `38.35` / `63.20` | `420.06` / `924.19` (JEV: `0.405 ms`) |

### 2.2 Category Breakdown (Full EMBER vs Static Matcher vs Baselines)

| Category (`n`) | Variant A (`app3Way` / `testR@5`) | Variant B (`app3Way` / `testR@5`) | Variant C Static (`app3Way` / `bnd` / `testR@5`) | Variant D Full EMBER (`app3Way` / `appF1` / `bnd` / `invR@5` / `testR@5`) |
| :--- | :---: | :---: | :---: | :---: |
| `investigation_selection` (20) | `0.5500` / `0.0583` | `0.5500` / `0.1333` | `0.6000` / `0.9000` / `0.1375` | **`0.7500`** / `0.9474` / `0.6000` / `0.9583` / **`0.2750`** |
| `summary` (15) | `0.4667` / `0.1012` | `0.4667` / `0.2917` | `0.5333` / `0.8667` / `0.1012` | `0.5333` / `0.8800` / `0.4667` / **`0.9778`** / `0.1845` |
| `comparability` (20) | `0.2000` / **`1.0000`** | `0.2500` / `0.7167` | `0.7500` / `0.8000` / `0.5750` | **`0.9500`** (`19/20`) / **`0.9231`** / `0.5000` / `1.0000` / `0.8500` |
| `protocol_outcome` (15) | `0.8000` / `0.9111` | `0.8000` / `0.5778` | `0.8000` / `0.9333` / `0.6444` | `0.6000` / `0.9286` / `0.7333` / `1.0000` / **`0.9444`** |
| `config_change` (10) | `0.2000` / `0.6000` | `0.1000` / `0.4500` | `0.1000` / `0.4000` / `0.4000` | **`0.3000`** / `0.4000` / **`0.7000`** / `1.0000` / **`0.9000`** |
| `insufficient_or_invalid_premise` (10) | `0.0000` / `n/a` | `0.2000` / `n/a` | **`0.8000`** / **`0.6000`** / `n/a` | `0.5000` / `0.0000` / `0.5000` / `1.0000` / `n/a` |
| `full_review` (10) | `0.4000` / `0.1500` | `0.6000` / `0.2667` | **`0.9000`** / `0.5000` / `0.3000` | `0.3000` / `0.5714` / **`0.8000`** / `0.8917` / **`0.3917`** |

> [!NOTE]
> **Interpreting Why Static Matcher Outscores Full EMBER on Binary Premise/Full-Review 3-Way Checks While Failing on Boundary & Comparability**:  
> - **Binary vs 3-Way Granularity (`insufficient_or_invalid_premise` & `full_review`):** `Variant C (Static_Matcher)` only outputs two labels (`admissible` or `inadmissible`)—it never produces `conditional`. Whenever EMBER's 9-rule engine properly emits `conditional_support` + `extrapolated` for 1D/surrogate proximity cases (e.g., `GOLD-024`, `GOLD-040`, `GOLD-048`, `GOLD-067`, `GOLD-097`), the binary confusion matrix scores `conditional` as positive admission (`FP`), whereas `Full EMBER` gets **80% (`8/10`) `answerBoundaryAccuracy` on `full_review` vs `Static_Matcher`'s `50% (`5/10`)**.
> - **Pairwise Comparability (`comparability`, `n=20`):** `Full EMBER` reaches **`0.9500 (19/20)`** 3-way accuracy and **`0.9231`** F1 vs `0.7500 / 0.7143` for `Static_Matcher` and `0.2000 / 0.2500` for RAG/BM25, driven by protocol segmentation and gas-role isolation.
> - **Test-Level & Post-Patch Retrieval:** `Full EMBER` achieves **`0.5861`** Test Recall@5 overall (`0.5957` on held-out `test`, **`0.9000`** on `config_change`, **`0.9444`** on `protocol_outcome`) vs `0.3633` overall (`0.2562` on held-out `test`) for `Static_Matcher`.

---

## 3. Ablation Study (5 Component Ablations on `n = 100`)

| System | Inv R@5 | Test R@5 | App F1 (`TP/FP/FN/TN`) | App 3-Way | Exp Rule Recall (`/106`) | Answer Bnd | JEV Acc / Brier | Verifier Pass | Mean Lat (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **`Variant_D_Full_EMBER`** | `0.9763` | `0.5861` | `0.8120` (`54/14/11/21`) | `0.6200` | **`0.7453`** (`79/106`) | `0.6000` | **`0.8952`** / **`0.1157`** | **`0.9600`** | `420.06` |
| `D_no_protocol` | `0.9763` | `0.5993` | `0.8116` (`56/17/9/18`) | `0.6300` | `0.5943` (`63/106`) | `0.6000` | `0.8952` / `0.1157` | `0.9600` | `354.24` |
| `D_no_geometry` | `0.9763` | `0.5590` | `0.8382` (`57/14/8/21`) | `0.6700` | `0.6415` (`68/106`) | `0.6400` | `0.8952` / `0.1157` | `0.9500` | `334.42` |
| `D_collapsed_outcomes` | `0.9728` | `0.5861` | `0.8120` (`54/14/11/21`) | `0.6200` | `0.7264` (`77/106`) | `0.6000` | `0.8952` / `0.1157` | `0.9600` | `329.97` |
| `D_no_jev` | `0.9763` | `0.5861` | `0.8120` (`54/14/11/21`) | `0.6200` | `0.7453` (`79/106`) | `0.6000` | `0.8381` / `0.1586` | `0.8800` | `301.25` |
| `D_bm25_only` | `0.9719` | `0.5861` | `0.8120` (`54/14/11/21`) | `0.6200` | `0.7170` (`76/106`) | `0.6000` | `0.8952` / `0.1157` | `0.9200` | `279.71` |

Key empirical findings across ablations:
1. **`D_no_protocol`:** Disabling `RULE-PROT-01` increases false admissions (`FP: 14 -> 17`, FAR `0.4000 -> 0.4857`) and drops `expectedRuleRecall` from `0.7453` to `0.5943` (-16 rule detections across `operator_termination_vs_physical_extinction` and `same_initial_flow_different_protocol`).
2. **`D_no_geometry`:** Disabling `RULE-GEOM-01` degrades `testRecall@5` (`0.5861 -> 0.5590`), `expectedRuleRecall` (`0.7453 -> 0.6415`), `configChangeDependencyF1` (`0.6857 -> 0.6471`), and `verifierPassRate` (`0.96 -> 0.95`), **but** raises `app3Way` (`0.62 -> 0.67`), `positiveCoverage` (`54/65 -> 57/65`), and `answerBoundary` (`0.60 -> 0.64`). Direct code inspection explains why: in [applicability.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/applicability.ts), `RULE-UNK-01` thickness checks inside the geometry gate downgrade `SIBAL` woven fabric rows (which lack numeric `thicknessMm`) to `conditional_support` (`GOLD-045/046/047`), causing over-cautious false rejections on positive fabric controls.
3. **`D_collapsed_outcomes`:** Slightly lowers `invRecall@5` (`0.9763 -> 0.9728`) and `expectedRuleRecall` (`79/106 -> 77/106`), while producing identical applicability confusion counts (`54/14/11/21`) because [applicability.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/applicability.ts) `checkRuleProt01` still calls `matchProtocolSegment` when `collapsedOutcomes: true` (a genuine implementation gap in `src/core/`, documented without altering `src/core/`).
4. **`D_no_jev`:** Replacing calibrated `jev-v1.0` with uncalibrated constant routing degrades JEV atomic accuracy (`0.8952 -> 0.8381`), JEV routing (`0.5714 -> 0.5143`), probability calibration (`Brier 0.1157 -> 0.1586`, `LogLoss 0.4061 -> 0.5129`), and drops `verifierPassRate` from `0.9600` to `0.8800`.
5. **`D_bm25_only`:** Drops `invNDCG@5` (`0.9621 -> 0.9283`), `testNDCG@5` (`0.5700 -> 0.5663`), `expectedRuleRecall` (`79/106 -> 76/106`), and `verifierPassRate` (`0.96 -> 0.92`).

---

## 4. Subsystem Evaluations

- **JEV Passage Evaluator (`jev-v1.0`, 35 annotated claims × 3 atomic checks = 105 evaluations):**
  - Calibrated `Full EMBER`: Atomic Accuracy **`0.8952 (94/105)`** (`[0.8286, 0.9479]`), Routing Accuracy **`0.5714 (20/35)`**, Brier Score **`0.1157`**, Log Loss **`0.4061`**, Mean Latency **`0.405 ms`**.
  - Uncalibrated (`D_no_jev` / RAG / Static): Atomic Accuracy `0.8381 (88/105)`, Routing `0.5143 (18/35)`, Brier `0.1586`, Log Loss `0.5129` (BM25 uniform `0.5` prior: Brier `0.2500`, Log Loss `0.6931`).
- **Design-Variant Dependency DAG (`config_change`, `n = 10`, `14` gold rules):**
  - Dependency Rule Precision **`0.5714 (12/21)`**, Recall **`0.8571 (12/14)`**, **F1 `0.6857 (24/35)`**; Direction Accuracy **`0.6000 (6/10)`**; Post-Change Boundary Accuracy **`0.7000 (7/10)`**; Post-Change `testRecall@5` **`0.9000 (9/10)`**.
  - Why Precision is `12/21` and Direction is `6/10`: `buildDependencies` ([dependencies.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/dependencies.ts)) aggregates warnings across the entire investigation pool rather than only the patched parameter, so unrelated conditional `RULE-JOINT-01` edges remain tagged `weakened` even on positive shift `GOLD-042` (`lunar-rover -> ISS`).
- **Constrained Test-Programme Planner (`plannerGold`, `n = 10`):**
  - Exact branch-and-bound optimizer (`optimizeTestProgramme`): **Exactness `1.0000 (10/10)`**, **Mandatory Control Preservation `1.0000 (10/10)`**, **Replicate $\ge 2$ Preservation `1.0000 (10/10)`** (vs greedy baseline `0.5000 (5/10)` across all three metrics).
- **Split-Level Consistency (`dev` vs `val` vs `test`):**
  - `Full EMBER` `dev` (`n=50, g=17`): `invR@5 = 0.9929`, `testR@5 = 0.5530`, `appF1 = 0.8485`, `app3Way = 0.6800`, `bnd = 0.6400`, `jevAcc = 0.9167`, `cfgF1 = 0.7368`.
  - `Full EMBER` `val` (`n=20, g=8`): `invR@5 = 0.9298`, `testR@5 = 0.6528`, `appF1 = 0.7857`, `app3Way = 0.6000`, `bnd = 0.5500`, `jevAcc = 0.8889`, `cfgF1 = 0.5714`.
  - `Full EMBER` `test` (`n=30, g=11`): `invR@5 = 0.9799`, `testR@5 = 0.5957`, `appF1 = 0.7692`, `app3Way = 0.5333`, `bnd = 0.5667`, `jevAcc = 0.8000`, `cfgF1 = 0.6667`.

---

## 5. External Competitor Benchmark & Whole-Product vs Common-Data Comparison

Implemented in [competitor_benchmark.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/competitor_benchmark.ts). Because external Space Apps peer systems (**FlameBound**, **MicroFire Atlas**, **Fotia**, **HEARTH**) have **no local binaries or endpoints in the workspace**, **0 numbers are fabricated**: every external `(system, caseId)` pair is explicitly classified as `outside_claimed_scope` or `not_run`.

### 5.1 Whole-Product Scope Audit (`n = 100`)

| System | Execution Kind | Evaluated | Outside Claimed Scope | Not Run | App 3-Way | Boundary Acc | Notes |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :--- |
| **EMBER v2** | `local_evaluated_engine` | `100` | `0` | `0` | `0.6200` (`62/100`) | `0.6000` (`60/100`) | Full 10-axis NASA PSI safety & design engine |
| **FlameBound** | `external_peer_system` | `0` | `55` | `45` | `null` | `null` | Lacks stage protocol, gas-role, joint envelope, `unknown!==unknown`, JEV, DAG, exact planner |
| **MicroFire Atlas** | `external_peer_system` | `0` | `65` | `35` | `null` | `null` | Lacks protocol segmentation, joint envelope, `unknown!==unknown`, DAG, exact planner |
| **Fotia** | `external_peer_system` | `0` | `55` | `45` | `null` | `null` | Retrieval/evidence summarization scope only; no applicability/protocol/planner engines |
| **HEARTH** | `external_peer_system` | `0` | `55` | `45` | `null` | `null` | Habitat-level screening without test-level protocol or DAG recalculation |

*(Hooks exist via `COMPETITOR_FLAMEBOUND_CMD`, `COMPETITOR_MICROFIRE_ATLAS_CMD`, `COMPETITOR_FOTIA_CMD`, `COMPETITOR_HEARTH_CMD` if external endpoints are bound later.)*

### 5.2 Executable Common-Data Capability Comparison (`n = 100` on `corpus_v2.json`)

| Adapter | Evaluated | App 3-Way (`n=100`) | Positive Coverage (`n=65`)* | False Admission Rate (`n=35`) | Boundary Acc (`n=100`) | Mean Latency (ms) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **`EMBER_v2`** | `100` | **`0.6200`** (`62/100`) | `0.8000` (`52/65`) | `0.4000` (`14/35`) | `0.6000` (`60/100`) | `353.41` |
| `StaticMatcher_CommonData_Adapter` | `100` | `0.6100` (`61/100`) | `0.9077` (`59/65`) | **`0.3714`** (`13/35`) | **`0.7400`** (`74/100`) | `3.44` |
| `RAG_CommonData_Adapter` | `100` | `0.4400` (`44/100`) | `0.9538` (`62/65`) | `0.8571` (`30/35`) | `0.6700` (`67/100`) | `28.96` |
| `BM25_CommonData_Adapter` | `100` | `0.4000` (`40/100`) | `0.9538` (`62/65`) | `1.0000` (`35/35`) | `0.6200` (`62/100`) | `6.89` |

*\*Note on metric differences across scripts: In `competitor_benchmark.ts`, `positiveCoverage` counts `applicabilityCorrect || boundaryCorrect` on positives (`52/65 = 0.8000` for `EMBER_v2`), whereas `run_evaluation.ts` counts non-inadmissible true-positive rate (`54/65 = 0.8308`). Likewise, `StaticMatcher_CommonData_Adapter` checks target test rows directly against the query (`61/100`, FAR `13/35`) without the pairwise cross-test projection used by `Variant_C_Static_Matcher` (`65/100`, FAR `9/35`).*

---

## 6. Observed Error Examples & Root-Cause Engineering Analysis

Concrete errors directly observed in `eval_report.json` (`errorExamples`) and targeted diagnostic runs against `src/core/`:

1. **Pairwise Comparison Boundary Disconnect (`GOLD-002`, `GOLD-005` — `comparability`):**
   - *Observed:* On `GOLD-002` (`BASS-II-B1` vs `BASS-II-B17`, both 5 cm/s opposed thin PMMA film) and `GOLD-005` (`BASS-II-P1` vs `BASS-II-O3a`), Full EMBER correctly predicted `inadmissible` via `RULE-PROT-01` / `RULE-JOINT-01` (where BM25 and Static Matcher falsely admitted `admissible`), **yet** predicted `answerBoundary = measured` instead of `insufficient_or_refuse`.
   - *Root Cause:* `determineAnswerBoundary` in [generator.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/generator.ts) inspects investigation-level `scopedDecisions` across `BASS-II` instead of checking whether the specific `comparisonTestIdA`/`comparisonTestIdB` pair is inadmissible, accounting for `10/20` boundary mismatches in `comparability`.
2. **Null-Flow Bypass in Joint $(O_2, P, \text{flow})$ Envelope (`GOLD-058`, `GOLD-084`, `GOLD-085` — `unsupported_joint_combination`):**
   - *Observed:* Full EMBER returned `admissible / measured` instead of `inadmissible / extrapolated` on `BASS-II`, `BASS`, and `CFI` queries with unsupported joint $(O_2, P)$ combinations (e.g. `30% O2 / 70.3 kPa`).
   - *Root Cause:* In [applicability.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/applicability.ts), `testJointDistance` returns `null` whenever any test parameter (such as `flow.initialFlowCmS.value` on `BASS-41-34`) is `null`, causing `RULE-JOINT-01` to pass despite extreme $(O_2, P)$ divergence.
3. **`RULE-UNK-01` Over-Conservatism on Fabric Sheets (`GOLD-045` — `positive_admissible_control`):**
   - *Observed:* Woven `SIBAL` cotton-fiberglass fabric queries returned `conditional / extrapolated` instead of `admissible / measured` on `BASS-II` (`0` admissible / `8` conditional).
   - *Root Cause:* `checkRuleUnk01` in [applicability.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/src/core/applicability.ts) treats `fabric sheet` rows with `thicknessMm: null` as planar solid slabs missing thickness.
4. **Protocol/Geometry Interaction on `config_change` & Mechanism Queries (`GOLD-003`, `GOLD-008`, `GOLD-010`):**
   - On `GOLD-003` (`BASS-II-B1` `0.1 mm` patched to `3.0 mm slab`), Full EMBER ranked `BASS-II-M2/M5` properly (`testRecall@5 = 0.90` on `config_change`) and got `measured` right, while single-row evaluation of the starting `targetTestId` (`BASS-II-B1`) returned `inadmissible` via `RULE-GEOM-01` (vs gold `conditional`). Similarly, `GOLD-008` (`1 mm` vs `2 mm` PMMA slab) triggered `inadmissible` (`RULE-GEOM-01`, `RULE-PROT-01`) vs gold `conditional`, and `GOLD-010` (`N2 jet` vs `fan shutoff` comparison) returned `conditional` (`RULE-PROT-01`) vs gold `admissible`.
5. **Contrast Where Full EMBER Prevents Safety-Critical Baseline Failures:**
   - `GOLD-002` & `GOLD-005` (`same_initial_flow_different_protocol`): `BM25` and `Static_Matcher` falsely admitted `admissible / measured` with `rules=[]`; Full EMBER blocked via `[RULE-PROT-01, RULE-JOINT-01]`.
   - `GOLD-018` (`FLEX-232` shifted to `13% O2, 71 kPa`): `Static_Matcher` falsely admitted `admissible / measured`; Full EMBER rejected via `[RULE-JOINT-01]`.
   - `GOLD-019` & `GOLD-020` (`ACME-CFI-G` `85% O2` inverse flame vs cabin ambient): `BM25` falsely admitted `admissible / measured`; Full EMBER rejected via `[RULE-GAS-01]` and `[RULE-MAT-01, RULE-JOINT-01]`.

---

## 7. Reproduction Commands

Run from the workspace root or inside `ember-final`:

```bash
cd "ember-final"
npx tsc --noEmit -p tsconfig.node.json
npm run lint
npm run eval
npx tsx eval/competitor_benchmark.ts
```

Artifacts produced:
- Structured metrics JSON: [public/data/eval_report.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/public/data/eval_report.json)
- Main benchmark script: [eval/run_evaluation.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/run_evaluation.ts)
- Competitor & Common-Data adapter script: [eval/competitor_benchmark.ts](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/competitor_benchmark.ts)
- Benchmark datasets: [eval/dev10_cases.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/dev10_cases.json), [eval/gold_100_cases.json](file:///home/sukhrob/Desktop/Projects/NASA%20Space%20Apps%20Challenge/ember-final/eval/gold_100_cases.json)
