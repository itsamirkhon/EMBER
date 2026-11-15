# EMBER — Evidence Map for Burn & Extinction Risk

**Team EMBER · NASA Space Apps Challenge 2026 · Flame in Freefall**

15 NASA PSI investigations with test tables · 261 solid-material flight tests with reported oxygen · none above **22.7% O₂**.

**One job:** Compare proposed spacecraft fire conditions with the historical experimental record in NASA's Physical Sciences Informatics (PSI) database. EMBER identifies recorded flight tests that match a question, related tests that need caveats, and conditions outside the tested evidence.

EMBER **does not run a new combustion experiment**, calculate a flammability threshold, predict fire probability, or certify spacecraft safety.

## Try the workflow

1. **Choose a mission scenario** and a material in **Mission lens** (`#/lens`); **Check your cabin** on the home page opens it with the lunar rover and PMMA. Adjust oxygen and pressure if necessary. Research task, airflow, and gravity can be edited under **Advanced**.
2. Click **Check historical evidence**. The result comes from source-backed applicability rules applied to indexed NASA PSI records, not a simulated fire.
3. Read the **nearest recorded flight tests**, their experimental conditions, and linked source table rows. Use **Evidence map** (`#/map`) when you need to inspect the broader dataset.

The homepage (`#/`) illustrates the actual indexed test coordinates in an interactive 3D field. Records missing plotted dimensions are excluded rather than represented as zero. Mission markers are proposed scenarios, not recorded tests. WebGL has a functional 2D fallback.

## Scientific boundary

The reviewed corpus contains **1,678 normalized records across the 15 PSI investigations that have test tables**. Among its **261 solid-material flight-test records with reported oxygen**, the upper recorded oxygen fraction is **22.7%**. This is a **coverage boundary for a specific subset**, not a universal NASA threshold and not a statement that higher-oxygen experiments never existed. Some atmospheric values are reconstructed or assumed; the UI flags those limitations.

See [technical documentation](docs/TECHNICAL.md), [scientific interpretation](docs/INTERPRET_STATUS.md), [submission sources](docs/SUBMISSION_2026.md) and the [concept](docs/CONCEPT.md).

## Supporting tools (secondary)

- `#/map`: plottable PSI records and mission markers
- `#/investigations`, `#/compare`: investigation details, source protocols, comparisons
- `#/export`: source-linked corpus JSON and CSV, modeling exports, review reports
- `#/ask`, `#/trust`: cited question answering, checks and backtests
- `#/earth`, `#/review`: NASA spinoffs and advanced research workspace
- `/intro.html`: separate educational flame illustration (not a combustion simulation)

These remain in the repository; reducing what appears first must never erase scientific capabilities or provenance.

## Develop

One project, at the repository root.

```sh
npm install --no-audit --no-fund
npm run lint
npm test
npm run test:intro
npm run build        # static site in dist/ (what gets deployed)
npm run dev
```

Static deployment requires no API key. Live model-written answers require the separate server-side API and are not the default scientific evidence flow. Never add provider credentials to frontend code or commits.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Scientific engine: applicability, comparison, retrieval, verifier. Shared by the browser and the API |
| `src/ui/` | React app. `v3/` is the public site (home, lens, map, ask, trust); `pages/` is the research workbench |
| `server/` | Node API and optional live-model adapters (also mounted into `npm run dev`) |
| `tests/` | Vitest suites and the 3D intro gate (`tests/presentation/`) |
| `eval/` | Benchmark cases, runners and reports |
| `pipeline/` | `build_corpus.py` builds the corpus, index and SQLite mirror. `seed/` holds the original PSI/NTRS fetch and normalisation scripts that produced `data/legacy_seed/` |
| `scripts/` | Builders for the derived files in `public/data/` and the 3D intro |
| `intro-src/` | Source of the 3D intro, compiled into `public/intro.html` |
| `data/` | `raw/` NASA PSI and NTRS downloads, `legacy_seed/`, source cache, SQLite mirror |
| `public/` | Static files shipped as-is, including the generated `public/data/*.json` |
| `docs/` | Submission text, demo guide, technical reference, audits. `archive/` holds documents of the first prototype |

The earlier prototypes (`web/`, `ember-win/`) were removed from the tree; they remain in Git history up to commit `77a28bb`.

## Release and collaboration

`main` is the only release branch. Changes to application code should be reviewed on a short-lived feature branch. The `main` deployment workflow publishes to AWS Lightsail after merge; do not merge incomplete redesigns while teammates have pending work. The source-level checks do not substitute for a browser smoke test in desktop/mobile or an AWS deploy verification.

Data: NASA PSI and NTRS. Not affiliated with or endorsed by NASA. License: GPL-3.0.
