# Space Apps 2026 submission text: EMBER

Paste these sections into the Space Apps project page. Fill in the `[ ]` placeholders before submitting.

**Project name:** EMBER: Evidence Map for Burn & Extinction Risk
**Challenge:** Flame in Freefall: SI-Powered Fire Safety Insights from Microgravity Combustion Data
**Demo:** [GitHub Pages URL, e.g. https://<user>.github.io/<repo>/]
**Repository:** [GitHub URL]
**Video (≤ 30 s) / slides:** [link]

---

## High-level summary

EMBER is a web dashboard that turns NASA's microgravity combustion data into answers for fire-safety design. An engineer picks a habitat (ISS, lunar base, pressurized lunar rover, Mars base, EVA suit), a material and conditions. EMBER ranks 15 PSI investigations with a transparent formula: safety consequence × evidence strength × proximity to the mission. It shows what each investigation found, with citations, and predicts outcomes from the nearest real flight tests. Every answer is labelled **Measured**, **Interpolated** or **Extrapolated**. A built-in Trust page reports how often EMBER is right, always next to a baseline. Within an experiment it predicts 77 % of held-out tests (replicates hidden) against a 54 % majority baseline. Across experiments it is barely better than guessing (58 % vs 54 %), but it labels 77 % of those wrong answers Extrapolated: the data does not transfer between experiments, and EMBER says so itself. EMBER shows what NASA knows about fire in space, and what nobody knows yet.

## Project details

**Problem.** Results from microgravity combustion experiments are published in NASA's PSI repository, but they are hard to find, harder to compare and hardest to interpret. Decisions for the Moon are being made right now, under three gaps:
- **Oxygen:** exploration atmospheres reach 30–34 % O₂ at 56–70 kPa, and every spacecraft material is certified at 30 % O₂ and 10.2 psia.
- **Gravity:** PSI has no partial-gravity data yet; LUCI and FM2 are still to come.
- **Access:** the existing data is hard to use.

EMBER closes the third gap and honestly shows the first two.

**What it does.**
1. **Mission lens:** ranks investigations for a chosen habitat. The weights are adjustable and every score shows its breakdown. Each finding is tagged Known, Extrapolating or Unknown.
2. **Investigation cards:** one layout for 15 investigations: objective, fuel, O₂, pressure and flow ranges, what was varied, diagnostics, hardware family, prevention/detection/suppression tag, and cited findings.
3. **Compare and hardware families:** warns when two investigations differ in hardware (ACME/CIR, MDCA/CIR, MSG/SPICE duct, Saffire/Cygnus) or in fuel phase.
4. **What-if:** O₂, pressure, flow and material sliders. A nearest-neighbour estimate over 1,678 real tests that always states whether the point was measured, lies between tests, or lies outside the data.
5. **Gravity bracket:** for the Moon and Mars, shows the range between 1 g and µg as an explicit estimate. Uses NASA's finding that 1 g Test 1 oxygen limits run up to 4 % O₂ higher than in µg, plus E-FIELD Flames as a partial-gravity analogue.
6. **Ask EMBER:** question answering over 145 claims, each backed by a verbatim quote. It cites every answer or replies "No evidence in PSI corpus".
7. **Export:** cleaned CSV with PSI id, DOI, source file and row number on every row, ready for predictive modelling.
8. **Back to Earth:** connects the findings to SCBA air tanks, smoke detectors, firefighter gear and water-mist suppression.
9. **Trust page:**
   - backtests, each next to its majority baseline and split by fuel phase: leave one test out, the same with replicates hidden (so EMBER can't copy a near-identical twin), and hiding a whole investigation (strict accuracy 58 % vs 54 %, with 77 % of the wrong answers flagged Extrapolated);
   - for the demo's solid materials, the honest result: 86 % vs an 84 % "always burns" baseline, and BASS-II alone 83 % vs 86 %, below baseline;
   - numeric estimates (smoke-particle size, smoke-point length, burning rate, spread rate) against the investigation mean, including where kNN is worse;
   - claim-extraction accuracy: 29 correct, 7 partial and 0 wrong out of 36, with 145/145 quotes found verbatim in their sources.

**Demo scenario.** Choosing a cabin-lining material for a pressurized lunar rover at 30 % O₂ / 70.3 kPa. EMBER finds the relevant investigations: BASS-II, SAME-R, Saffire and BASS. It shows that the closest solid-material flight tests stop at about 23 % O₂ and 1 atm, so the answer is **Extrapolated**. It then gives the literature margin and the citations an engineer needs next.

**Benefits.**
- Makes PSI usable in minutes instead of hours.
- Stops over-confident reuse of out-of-range data.
- Points to which experiments would close the most important gaps: solid materials at lunar O₂ and pressure, and partial gravity.

**Tools.**
- React, TypeScript and Vite for the static site (GitHub Pages).
- Python (requests, pandas, openpyxl) for the PSI data pipeline.
- BM25 retrieval.
- Inverse-distance-weighted kNN.
- Vitest.
- Anthropic Claude: claim extraction during the build. OpenAI API (`gpt-6-luna`): optional in-app answer synthesis and the re-runnable extraction script.

## NASA data used

- **NASA Physical Sciences Informatics (PSI)** experimental tables and metadata (CC0-1.0), retrieved through the PSI web API:
  - PSI-25 BASS-II
  - PSI-26 BASS
  - PSI-98, PSI-99, PSI-100 Saffire-I, II and III
  - PSI-69 FLEX
  - PSI-68 FLEX-2
  - PSI-102 SAME
  - PSI-101 SAME-R
  - PSI-39 CFI
  - PSI-20 ACME BRE
  - PSI-159 ACME CFI-G
  - PSI-22 ACME E-FIELD Flames
  - PSI-107 SPICE
  - PSI-106 SLICE
- **NASA Technical Reports Server (NTRS)**: abstracts and reports used for the claims (see docs/SOURCES.md).
- **NASA Glenn Combustion Science**, NASA History (Apollo 1, Apollo 13, the Mir fire) and **NASA Spinoff** (Fireman's Air Tanks, Fire Detector, New Technology for the Fire Attire).

## Use of AI

- **Claim extraction:** a large language model (Anthropic Claude) read NASA abstracts and pages and wrote atomic claims, each with a verbatim supporting quote. A script checks that every quote appears word for word in the cached source; claims that fail are dropped. 36 claims were then checked against their sources by hand (29 correct, 7 partial, 0 wrong). The same model family helped with that grading, which we disclose as a limitation.
- **Ask EMBER:** retrieval is plain BM25, not AI. If a user supplies their own OpenAI API key, `gpt-6-luna` writes an answer from the retrieved claims only, and every citation is checked against them.
- **Ranking and prediction:** a transparent formula and nearest-neighbour search over real tests. No trained neural networks are involved.
- **Development:** AI coding assistants (Claude Code) helped write the software and documentation. The team reviewed all of it.
- No AI-generated images, video or voice appear in the product. [Update this if your video uses any.]

## References

See `docs/SOURCES.md` (every NTRS id, PSI page and NASA URL used) and the `sources[]` fields in `web/public/data/*.json`.
