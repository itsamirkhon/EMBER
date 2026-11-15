# EMBER — Space Apps 2026 project page (paste-ready)

Every field below is written for the Space Apps project page, in English. Numbers come from the live corpus (`2.0.2-bass-provenance`) and are recomputed on the site's Trust page. Replace the two `<…>` links after publishing.

---

## Project name

**EMBER — Evidence Map for Burn & Extinction Risk** · Team EMBER

## High-Level Summary

Across the 15 NASA PSI fire investigations with test tables, none of the 261 solid-material flight tests with measured oxygen ran above 22.7% O₂; all ran near 98–102 kPa, while lunar cabins plan 30–34% O₂ at 56–70 kPa, so material choices for the Moon rest on extrapolation. EMBER — Evidence Map for Burn & Extinction Risk, by Team EMBER — summarizes, ranks and interprets that evidence: it puts the 15 investigations in NASA’s Physical Sciences Informatics (PSI) repository on one map, ranks which of them apply to a given cabin, and interprets how far the nearest tests are from it. A safety engineer picks a cabin and a material and, in two minutes, sees which NASA investigations apply, the nearest real tests and how far away they are, and which flight test would close the gap. EMBER never gives a fire-risk percentage.

## Links

- Live site (no login, no key): `<https://itsamirkhon.github.io/EMBER/>`
- Code: `<https://github.com/itsamirkhon/EMBER>`
- Demo video (30 s, English subtitles): `<video link>`

## Detailed Description

**The problem.** Fire is one of the worst things that can happen in a spacecraft (Apollo 1, the 1997 Mir fire). PSI holds test tables for 15 combustion investigations, but they are scattered across tables, reports and formats. An engineer choosing a cabin lining for an Artemis rover cannot quickly tell which experiments apply to their atmosphere, or whether any do.

**The finding: the evidence cliff.** We normalized 1,678 test records from the 15 PSI investigations with test tables. The 261 solid-material flight tests with a reported oxygen value (BASS, BASS-II, Saffire) ran at 13.6–22.7% O₂ and 98.3–102.2 kPa; only 11 BASS tests went above 22.5%. NASA’s lunar exploration atmosphere is 34% O₂ at 56.5 kPa; the challenge’s rover scenario is 30% at 70.3 kPa. No solid-material flight data overlap these points. Gas flames were flown up to 85% O₂ (ACME CFI-G), but in an oxidizer stream with gaseous fuel, which transfers to fabrics and plastics only qualitatively. NASA work also found that 1 g limiting oxygen concentrations were up to 4 points higher than in microgravity, so ground screening alone can pass materials that burn in orbit. Scope matters: this is about *flight* data in PSI; ground tests at elevated oxygen exist, and partial-gravity tests exist outside PSI: NASA Glenn drop-tower centrifuge tests at lunar gravity (Ferkul and Olson, 2011) and Martian gravity (Olson and Ferkul, 2012, NTRS 20130010991), where some materials burned at lower oxygen than at 1 g, plus aircraft parabolic flights at 0.05–0.6 g. These tests last seconds, so their extinction criteria differ from 1 g tests, and they are not in PSI.

**Who it is for.** A spacecraft fire-safety engineer choosing a cabin material for a lunar rover; second, researchers and students who need cards, comparisons and clean data.

**What it does (the screens).**
1. *Intro* — a 3D illustration of the same flame at 1 g and in microgravity, then a lunar cabin marked “not established”. Labelled as an illustration, not a calculation.
2. *Evidence map* — every test on an O₂ × pressure plane (colour = investigation, shape = fuel phase, hollow = assumed atmosphere), with the ISS, crew capsule, lunar habitat, lunar rover, Mars habitat and EVA suit atmospheres on top, and the evidence cliff drawn at 22.7% O₂.
3. *Mission lens* — pick an environment, a task (prevent, detect, suppress, choose the atmosphere) and a material. All 1,678 records go through nine transparent applicability rules. The answer is one of three plain statuses: **Measured**, **Data nearby** or **Beyond the evidence**, with the reasons. Investigations are ranked on three separate scales (answers the question, matches the conditions, data reliability), never merged into one risk number. An oxygen slider shows the data stop applying as you move past the cliff.
4. *Nearest real tests instead of a refusal* — the three closest flight records and the gap on every axis (“O₂ +7.6 pts, pressure −29.8 kPa, gravity 0 → 0.166 g, material same”), each linked to its PSI table row; plus a “next experiment” card that names the flight test that would shrink the gap most.
5. *Ask EMBER* — questions answered only from PSI rows and NASA reports, every statement tied to a source; with no support, it says so. Ten answers are pre-computed and work without a server.
6. *Investigations, comparison and data* — uniform cards for all 15 investigations, side-by-side protocol comparison, and CSV/JSON exports in which every row keeps its PSI file and row number; unknown values stay empty, never zero.
7. *Back to Earth and Trust* — Spinoff links (smoke detectors, firefighter gear, water mist, fire models for mines and submarines) and a page that checks EMBER against the data.

**How applicability works.** A test supports a question only if it passes all nine rules: recorded outcome, material, geometry, unknown values never count as a match, oxygen in cabin air vs a burner stream, assumed atmospheres capped, no transfer of 0 g or 1 g results to the Moon or Mars, crew flow shut-off is not an extinction limit, and O₂ / pressure / airflow must have been tested together. Rules, not a black box.

**What we checked, and what we did not.**
- The earlier outcome backtest was withdrawn: it incorrectly treated self-extinction as no flame establishment. Trust now publishes a reproducible endpoint-label audit, not predictive accuracy. Applicability requires independent expert validation; no gain over a baseline is claimed.
- 145 AI-extracted claims, every quote found verbatim in the source (145/145); a 36-claim sample re-read: 29 correct, 7 partial, 0 wrong (same model family graded, so optimistic).
- BASS outcomes parsed from free-text notes: 30 random rows read in full, 29/30 agree, 0 wrong.
- While finishing EMBER we found and fixed a bug in our own engine: tests with an unreported airflow skipped the joint-conditions rule, so 16% O₂ tests counted as evidence for a 30% O₂ cabin. A regression test now guards it.
- Not done: independent expert review of claims, protocols and rule tolerances; an independent test set; any partial-gravity data (none exist in PSI).

**Stack.** TypeScript scientific core shared by the browser and a Node API; React 19 + Vite static site; Python corpus pipeline; native WebGL intro. The public site runs entirely in the browser with no server or API key.

## NASA Data and Resources

The 15 combustion investigations in NASA PSI that have test tables (CC0 for reviewed records), with their analysed-data files:

| ID | Investigation | PSI | DOI | Fuel | Records |
|---|---|---|---|---|---|
| BASS-II | Burning and Suppression of Solids – II | [PSI-25](https://psi.nasa.gov/physci/repo/data/investigations/PSI-25) | [10.60555/4qc4-de67](https://doi.org/10.60555/4qc4-de67) | solid | 129 |
| BASS | Burning and Suppression of Solids | [PSI-26](https://psi.nasa.gov/physci/repo/data/investigations/PSI-26) | [10.60555/58h4-dy80](https://doi.org/10.60555/58h4-dy80) | solid | 121 |
| Saffire-I | Spacecraft Fire Safety Experiment – I | [PSI-98](https://psi.nasa.gov/physci/repo/data/investigations/PSI-98) | [10.60555/0t15-1z43](https://doi.org/10.60555/0t15-1z43) | solid | 2 |
| Saffire-II | Spacecraft Fire Experiment – II | [PSI-99](https://psi.nasa.gov/physci/repo/data/investigations/PSI-99) | [10.60555/2chp-m469](https://doi.org/10.60555/2chp-m469) | solid | 9 |
| Saffire-III | Spacecraft Fire Experiment – III | [PSI-100](https://psi.nasa.gov/physci/repo/data/investigations/PSI-100) | [10.60555/040q-4h36](https://doi.org/10.60555/040q-4h36) | solid | 2 |
| FLEX | Flame Extinguishment Experiment | [PSI-69](https://psi.nasa.gov/physci/repo/data/investigations/PSI-69) | [10.60555/mbq8-0451](https://doi.org/10.60555/mbq8-0451) | liquid | 274 |
| FLEX-2 | Flame Extinguishment Experiment – 2 | [PSI-68](https://psi.nasa.gov/physci/repo/data/investigations/PSI-68) | [10.60555/byp8-h018](https://doi.org/10.60555/byp8-h018) | liquid | planned matrix only |
| CFI | Cool Flames Investigation | [PSI-39](https://psi.nasa.gov/physci/repo/data/investigations/PSI-39) | [10.60555/m6pj-a914](https://doi.org/10.60555/m6pj-a914) | liquid | 79 |
| SAME | Smoke and Aerosol Measurement Experiment | [PSI-102](https://psi.nasa.gov/physci/repo/data/investigations/PSI-102) | [10.60555/gd4k-8h62](https://doi.org/10.60555/gd4k-8h62) | solid | 64 |
| SAME-R | Smoke Aerosol Measurement Experiment – Reflight | [PSI-101](https://psi.nasa.gov/physci/repo/data/investigations/PSI-101) | [10.60555/2np7-jv14](https://doi.org/10.60555/2np7-jv14) | solid | 109 |
| ACME-BRE | ACME – Burning Rate Emulator | [PSI-20](https://psi.nasa.gov/physci/repo/data/investigations/PSI-20) | [10.60555/vb93-3y72](https://doi.org/10.60555/vb93-3y72) | gas | 43 |
| ACME-CFI-G | ACME – Cool Flames Investigation with Gases | [PSI-159](https://psi.nasa.gov/physci/repo/data/investigations/PSI-159) | [10.60555/cyt1-kh64](https://doi.org/10.60555/cyt1-kh64) | gas | 333 |
| ACME-E-FIELD | ACME – Electric-Field Effects on Laminar Diffusion Flames | [PSI-22](https://psi.nasa.gov/physci/repo/data/investigations/PSI-22) | [10.60555/se5a-8c73](https://doi.org/10.60555/se5a-8c73) | gas | 32 |
| SPICE | Smoke Point In Co-flow Experiment | [PSI-107](https://psi.nasa.gov/physci/repo/data/investigations/PSI-107) | [10.60555/9kbh-e962](https://doi.org/10.60555/9kbh-e962) | gas | 469 |
| SLICE | Structure and Liftoff In Combustion Experiment | [PSI-106](https://psi.nasa.gov/physci/repo/data/investigations/PSI-106) | [10.60555/pm12-rg61](https://doi.org/10.60555/pm12-rg61) | gas | 12 |

How each is used: test conditions and outcomes become normalized records (O₂ %, kPa, cm/s, g) with source file and row; objectives, hardware and findings fill the investigation cards.

Also used:
- **NASA Technical Reports Server (NTRS)** — 52 reports and abstracts (including NASA/TM-20210011385 for BASS-II outcomes, and Olson, Ruff & Fletcher, NASA/TM-2008-215260 for the 1 g vs microgravity oxygen margin): the source of the 145 quoted claims.
- **ISS Researcher’s Guide to Combustion Science** and NASA Glenn combustion pages — hardware families and investigation context.
- **NASA mission atmosphere documents** (NASA-STD-3001, exploration atmosphere studies) — the six cabin presets; values NASA does not state are marked as assumptions.
- **NASA Spinoff** (fire detector, firefighter air tanks, fire attire/PBI, water mist) and NASA history pages (Apollo 1, Apollo 13, Mir) — Back to Earth and the intro story.

## Use of AI

- **Claim extraction** (offline, before the site was built): an LLM read cached NTRS abstracts and PSI pages and extracted 145 claims, each with a verbatim quote. Every quote was checked programmatically against the source text; a 36-claim sample was re-read (29 correct, 7 partial, 0 wrong).
- **Outcome parsing support**: BASS outcomes were parsed by keyword rules; an AI read 30 random rows in full to audit them.
- **Ask EMBER answers**: OpenAI `gpt-6-luna` writes prose only from the retrieved, applicability-checked evidence. EMBER keeps a model answer only if five automatic checks pass (citations resolve, numbers and units match, observed vs planned kept apart, query constraints kept, lexical support); otherwise it shows the cited records instead. Six of the ten published answers are model text that passed; four are citations only. The public site runs no AI at all: these ten answers are pre-computed.
- **Retrieval and decisions on the server version**: Google `gemini-embedding-2` and `gemini-decision-1` via OpenRouter (optional; the public site uses an offline BM25 + TF-IDF/SVD index).
- **Software development**: AI coding assistants (Anthropic Claude, OpenAI models) helped write code, tests and documentation; the team reviewed and ran all of it.
- **Not AI**: ranking, the nine applicability rules, the three statuses and the endpoint-label audit are deterministic code.
- **Images**: no AI-generated images or video. The 3D flame is procedural WebGL. No NASA logos are used.

## References

- Data: NASA PSI (CC0 for reviewed records), NASA NTRS, NASA Spinoff, NASA History — see NASA Data above.
- Code libraries: React 19.3 (MIT), React DOM 19.3 (MIT), React Router 7.18 (MIT), Vite 8.3 (MIT), TypeScript 7.0 (Apache-2.0), Vitest (MIT), tsx (MIT). Python pipeline: NumPy, scikit-learn (BSD-3-Clause).
- 3D intro: native WebGL, procedural shader written for this project; no third-party 3D models, fonts or images.
- Project license: GPL-3.0.

---

## Demo video — 30 seconds, English subtitles

Subtitles: [`demo-video.en.srt`](./demo-video.en.srt). Suggested capture: the live site at 1920×1080, browser in full screen.

| Time | Shot | Subtitle |
|---|---|---|
| 0:00–0:02 | Team name card | Team EMBER, Tashkent |
| 0:02–0:05 | Intro: flame at 1 g vs microgravity | Fire in space follows different rules. |
| 0:05–0:10 | Home headline | EMBER: NASA’s fire experiments in one place — and where the evidence ends. |
| 0:10–0:20 | Evidence map, then the lunar rover in the mission lens (“Beyond the evidence”) | No solid-material flight test in NASA PSI went above 22.7% O₂. Lunar cabins plan 30%+. |
| 0:20–0:27 | Nearest real tests with axis gaps, then the next-experiment card | EMBER shows the nearest real test — and the experiment that would close the gap. |
| 0:27–0:30 | Site URL | Built on NASA PSI data. |

## Backup: seven slides

1. **EMBER** — team, challenge “Flame in Freefall”, one line: *NASA’s fire experiments in one place — and the line where the evidence ends.*
2. **Problem** — Apollo 1 and Mir; Artemis cabins at 30–34% O₂; 15 investigations with test tables, scattered across PSI.
3. **Finding** — the evidence map: 261 solid flight tests at ≤ 22.7% O₂ and ~100 kPa vs lunar cabins at 30–34% and 56–70 kPa.
4. **Product** — mission lens for the lunar rover: *Beyond the evidence*, nearest tests with gaps, the next experiment.
5. **Why trust it** — nine rules; the withdrawn backtest and current endpoint-label audit; verbatim quotes 145/145; the bug we found and fixed.
6. **NASA data and AI** — 15 PSI investigations with test tables + 52 NTRS reports; AI extracts claims and writes checked prose, rules decide.
7. **Next** — the flight test that closes the gap; Back to Earth (smoke detectors, firefighter gear, water mist, mine and submarine fire models).
