# EMBER v2 — 60–90 Second Judge Demo Guide

> [!NOTE]
> **Zero-Key Deterministic Walkthrough**: Everything in this guide runs locally out of the box using Pre-seeded Saved Snapshots (`SAVED_DEMO_SNAPSHOT`: `demo-pmma-lunar`, `demo-cool-flame`) and the live deterministic engine (`DETERMINISTIC_ENGINE`) with **no external API key required**. Optional server-side `LIVE_AI` (`OPENAI_API_KEY` in server env or `.env`) is never required and never exposed to the browser.

---

## 1. Quick Launch (Before You Start)

From `ember-final/`:

```bash
npm run dev
```

Open the local Vite URL (default `http://localhost:5173`). Vite mounts the integrated `/api/*` middleware via `emberApiPlugin()` (`server/api.ts`), and all UI routes use `HashRouter` (`/#/`) so direct links and reloads always work.

*(Alternative standalone Node server: `npm run build && npx tsx server/index.ts` on `http://localhost:8787`, or pure static hosting using the automatic in-browser `./data/*.json` + `src/core/` fallback.)*

---

## 2. Step-by-Step Walkthrough (60–90 Seconds)

### Step 1 (`0:00–0:15`) — Scenario A: Lunar Rover PMMA & Pre-Seeded Snapshots (`/`)

1. Open **`/#/`** (loads **`demo-pmma-lunar`** automatically) or click **`Demo 1: PMMA Lunar Rover`** in the header of the **Scientific Evidence Review Workspace**.
2. Point out the **Execution Mode** badge (`SAVED_DEMO_SNAPSHOT`) and **Live Parsed `ResearchQuery` Confirmation**:
   - Environment: `lunar_rover` (`30% O2` `[ambient]`, `70.3 kPa`, `5 cm/s` `concurrent` flow, `0.166g` `partial_gravity`, `large_enclosure`)
   - Fuel & Endpoint: `PMMA` (`solid`), `extinction_under_flow_change`
   - Non-blocking open parameters recorded transparently: `unknownFields: ["thicknessMm"]`
3. Highlight the **Answer Boundary** KPI: **`insufficient_data`** (`0` admissible / `0` conditional across the `80` evaluated tests in the candidate pool) with **Verifier Gate: `All 5 Checks Passed`** (`Citations`, `Numeric & Units`, `Epistemic Provenance`, `Constraint Preservation`, `Lexical Entailment`).
4. Expand any item in **Observed Experimental Facts (`4`)**, **Author Interpretations (`1`)**, **Preserved Conflicts & Counterevidence (`2`)**, or **Open Evidence Gaps (`4`)** to inspect the `ProvenanceTrace` (`ProtocolStep -> Event -> ApplicabilityDecision -> SourceRef quote & locator`), and click **`Demo 2: CFI/FLEX Cool Flames`** (`demo-cool-flame`) to contrast an in-domain liquid droplet scenario (**`sufficient_observed`**, `15` admissible / `35` conditional across `259` evaluated tests, `6` observed facts, `1` preserved conflict).
5. Click back to **`Demo 1: PMMA Lunar Rover`** before moving to Step 2.

---

### Step 2 (`0:15–0:25`) — Research Dashboard & 3-Axis Investigation Ranker (`/#/explorer`)

1. Click **`Explorer`** in the top navigation bar (`/#/explorer`) to view all **15 NASA PSI investigations**.
2. Point out the **three separated score bars** on each investigation card:
   - **1. Question Relevance**
   - **2. Observation Applicability**
   - **3. Evidence Quality & Completeness**
3. Call attention to **`BASS-II`** vs **`BASS`** and **`FLEX-2`**:
   - **`BASS-II`** ranks highest on **Question Relevance (`1.00`)** and **Evidence Quality (`0.98`)**, yet scores **`0.00` Observation Applicability (`inadmissible`)** for the lunar rover query—proving why topical relevance must never be confused with cross-regime physical validity.
   - **`FLEX-2`** carries a dedicated **`Planned Matrix Only`** (`planned_only`, `0` test rows) badge so planned objectives never masquerade as observed flight evidence.
4. *(Optional click)* Open **`BASS-II`** (`/#/investigations/BASS-II`) to show the searchable per-test table and native `<dialog>` **`SourceModal`** with primary text from `GET /api/sources/:id`.

---

### Step 3 (`0:25–0:40`) — Protocol Timeline & Contrast Inspector (`/#/protocol-compare`)

1. Click **`Protocol & Compare`** (`/#/protocol-compare`).
2. On **Tab 1 (`1. Protocol Step Timeline`)**:
   - Click preset **`BASS-II-B1`**: see the 3 stage-bound steps (`#1 ignition` `igniter_energized` @ `5 cm/s` → `#2 steady_burn` `none` @ `5 cm/s` → `#3 termination` `flow_shutoff` @ `0 cm/s`) badged **`Operator Flow Shutoff (FT)`** and **`Timestamp: unknown`** (timestamps are kept `null` rather than invented).
   - Click **`BASS-II-M1`**: contrast a physical step-down (`#1 ignition` @ `10 cm/s` → `#2 steady_burn` @ `10 cm/s` → `#3 flow_modification: flow_stepped_down` @ `8 cm/s` → `#4 termination: flow_shutoff` @ `0 cm/s`).
   - Click **`CFI-1206`**: show **`Cool-Flame Continuation`** separating `burning_rate_constant` (`0.379 mm²/s`), `hot_flame_extinction` (`3.577 mm`), and `cool_flame_continuation` (`0.385` / `0.497`).
3. Switch to **Tab 2 (`2. Admissible Comparison & Series Plots`)**:
   - With `BASS-II-B1`, `BASS-II-B10`, `BASS-II-M1` loaded, point to the **`Confounded / Inadmissible Contrast`** warning banner flagging mixed operator shutoff (`FT`) vs natural/step-down extinction endpoints, plus the live SVG plots (`O2 % vs Initial Flow Velocity`, `BASS-II Table 5.1 Spread Rate`, and `SAME-R Particle Size vs Aging Time`).

---

### Step 4 (`0:40–0:55`) — Live Design-Variant Dependency Diff (`21% -> 34% O2`) (`/#/variants`)

To see the sharpest dependency shift from a clean ISS baseline (`sufficient_observed`) to an oxygen-enriched lunar habitat (`34% O2 / 56.5 kPa / 0.166g`):

1. **Quick ISS Baseline Setup (10 seconds):** Return to **`Review Workspace`** (`/#/`), select preset **`ISS (21% O2 · 101.3 kPa · 0g)`**, set Target Endpoint to **`sustained_spread`** (keep `PMMA`, `solid`, `10 cm/s`), and click **`Run Evidence Review`** (`DETERMINISTIC_ENGINE` mode → **`sufficient_observed`**, **`112` admissible / `26` conditional** tests).
2. Click **`Inspect Design Variants`** (or **`Variant Diff`** in the nav bar, `/#/variants`).
3. **Single-Variable O2 Step (`21% -> 34% O2`):** In **Variant B (Perturbed Design Specification)**, change **O2 %** to **`34`** (keeping `101.3 kPa` and `0g`) and click **`Compute Variant B Dependency Diff`** to show **`131` previously usable test(s) becoming inadmissible** (`becameInadmissible: 131`).
4. **Combined Lunar Base Patch (`34% O2 · 56.5 kPa · 0.166g`):** Also set **Pressure (kPa)** to **`56.5`** and **Gravity (g)** to **`0.166`**, then click **`Compute Variant B Dependency Diff`** again to show the full causal chain output:
   - **`3` Weakened Rule Edges** (`o2Pct, pressureKpa, gravityG -> RULE-JOINT-01 (BASS-II, BASS) -> Support weakened to conditional`, **`7` downgraded / `becameConditional: 7`**).
   - **`1` Invalidated Rule Edge** (`o2Pct, pressureKpa, gravityG -> RULE-GRAV-01 -> 131 previously usable test(s) became inadmissible`).
5. *(Bonus 3-second click)* Click **`Preset 1: Thin 0.1mm PMMA film → Thick 3.0mm slab / Opposed flow`** or **`Preset 3: Reassign O2 Role → Oxidizer Stream`** to show `RULE-GEOM-01`, `RULE-PROT-01`, and `RULE-GAS-01` immediately invalidating burner-stream conflation.

---

### Step 5 (`0:55–1:05`) — Budget-Constrained Test Programme Planner (`/#/planner`)

1. Switch back to **`demo-pmma-lunar`** (or stay on the active review) and open **`Planner`** (`/#/planner`).
2. Highlight the **Epistemic Boundary** banner: *"Priority Question Coverage optimizer — NOT Bayesian information gain, posterior failure probability, or risk-weighted utility."*
3. On **`demo-pmma-lunar`** at default budget **`10` runs**, show the exact branch-and-bound schedule (**`9 / 10` runs used**):
   - **`blk-ctrl-baseline`** (`2` runs, `2` replicates) — **`Mandatory Control` (`Locked & Preserved`)**
   - **`blk-joint-atmosphere`** (`2` runs, `2` replicates) — verifies `(30% O2, 70.3 kPa)` corner
   - **`blk-partial-g-bracket`** (`2` runs, `2` replicates) — `0g + 1g` bracketing pair
   - **`blk-stepped-quench`** (`3` runs, `3` replicates) — isolates flow-step quench vs `FT`
4. Drag the **Budget Slider** to **`5` runs** and click **`Optimize Programme`** to demonstrate how the optimizer automatically drops optional blocks while keeping mandatory controls and replicates intact.

---

### Step 6 (`1:05–1:20`) — Domain-Gated Modeling Lab & Replicate-Safe Export (`/#/modeling`, `/#/export`)

1. Click **`Modeling Lab`** (`/#/modeling`):
   - **Tab 1 (`1. Data Replay`)**: real measured NASA series (`BASS-II Table 5.1`, `CFI Hot vs Cool Extinction`, `SAME-R Smoke Sizing`).
   - **Tab 2 (`2. Domain-Gated Endpoint Predictor`)**:
     - Click **`In-Domain Preset: PMMA BASS-II`** (`21% O2`, `101.3 kPa`, `0.2 mm`, `10 cm/s`) → predicts `spreadRateMmS = 0.795 mm/s` with leave-one-group-out CV MAE `0.160 mm/s` (beating investigation/global mean baselines).
     - Click **`Out-of-Domain Stress Preset (45% O2 / 35 kPa)`** → refuses cleanly (`refused_out_of_domain`: joint distance `9.36` exceeds limit `1.75`).
   - **Tab 3 (`3. Conceptual Illustration`)**: visually badged **`CONCEPTUAL ILLUSTRATION — NOT A PHYSICAL CALCULATION`**.
2. Click **`Export`** (`/#/export`):
   - Show downloadable **Markdown**, **JSON Snapshot**, **Test Evidence CSV**, and **Predictive Modeling CSV (Single-Endpoint Gate)**—which enforces a single compatible `fuelPhase` + `endpoint`, preserves `groupId`, `o2Role`, and explicit `null`s without zero imputation.

---

### Step 7 (`1:20–1:30`) — Honest Evaluation & Benchmark Lab (`/#/evaluation`)

1. Click **`Evaluation`** (`/#/evaluation`).
2. Point to the top provenance banner (**`preliminary_team_annotation_from_primary_nasa_sources`** — team-authored benchmark grounded in primary NASA sources, not independent third-party validation).
3. Summarize the **100-case / 36-groupId (`50 dev / 20 val / 30 test`)** tables:
   - **Variant D (Full EMBER v2)**: `97.6%` Inv Recall@5, `58.6%` Test Recall@5 (vs `36.3%` Static Matcher), `74.5%` Expected Rule Recall (vs `0.0%` A/B/C), `89.5%` JEV Atomic Acc (`0.1157` Brier), `100.0%` Planner Exactness & Control/Replicate Preservation, `96.0%` Verifier Pass.
   - **5 Engine Ablations** & **Competitor Scope Audit**: **FlameBound**, **MicroFire Atlas**, **Fotia**, and **HEARTH** show **`0 / 100` evaluated** (`outside_claimed_scope` / `not_run`) with **`—` (no fabricated metrics)**, while executable Common-Data adapters compare identical-corpus capability (`62%` EMBER v2 vs `61%` Static Matcher, `44%` RAG, `40%` BM25).
