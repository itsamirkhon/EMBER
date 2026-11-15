# EMBER

**NASA Space Apps Challenge 2026 · Flame in Freefall**

**One job:** Compare proposed spacecraft fire conditions with the historical experimental record in NASA's Physical Sciences Informatics (PSI) database. EMBER identifies recorded flight tests that match a question, related tests that need caveats, and conditions outside the tested evidence.

EMBER **does not run a new combustion experiment**, calculate a flammability threshold, predict fire probability, or certify spacecraft safety.

## Try the workflow

1. **Choose a mission scenario** and a material in **Check evidence** (`#/lens`). Adjust oxygen and pressure if necessary. Research task, airflow, and gravity can be edited under **Advanced**.
2. Click **Check historical evidence**. The result comes from source-backed applicability rules applied to indexed NASA PSI records, not a simulated fire.
3. Read the **nearest recorded flight tests**, their experimental conditions, and linked source table rows. Use **Evidence map** (`#/map`) when you need to inspect the broader dataset.

The homepage (`#/`) illustrates the actual indexed test coordinates in an interactive 3D field. Records missing plotted dimensions are excluded rather than represented as zero. Mission markers are proposed scenarios, not recorded tests. WebGL has a functional 2D fallback.

## Scientific boundary

The reviewed corpus contains **1,678 normalized records across 15 PSI investigations**. Among its **261 solid-material flight-test records with reported oxygen**, the upper recorded oxygen fraction is **22.7%**. This is a **coverage boundary for a specific subset**, not a universal NASA threshold and not a statement that higher-oxygen experiments never existed. Some atmospheric values are reconstructed or assumed; the UI flags those limitations.

See [technical documentation](ember-final/README.md), [scientific interpretation](ember-final/docs/INTERPRET_STATUS.md), and [submission sources](ember-final/docs/SUBMISSION_2026.md).

## Supporting tools (secondary)

- `#/map`: plottable PSI records and mission markers
- `#/investigations`, `#/compare`: investigation details, source protocols, comparisons
- `#/export`: source-linked corpus JSON and CSV, modeling exports, review reports
- `#/ask`, `#/trust`: cited question answering, checks and backtests
- `#/earth`, `#/review`: NASA spinoffs and advanced research workspace
- `/intro.html`: separate educational flame illustration (not a combustion simulation)

These remain in the repository; reducing what appears first must never erase scientific capabilities or provenance.

## Develop

The **active application is `ember-final/`**. The older `web/` and `ember-win/` prototypes are retained for reference while teammates finish their branches.

```sh
cd ember-final
npm install --no-audit --no-fund
npm run lint
npm test
npm run test:intro
npm run build
npm run dev
```

Static deployment requires no API key. Live model-written answers require the separate server-side API and are not the default scientific evidence flow. Never add provider credentials to frontend code or commits.

## Release and collaboration

Changes to application code should be reviewed on a feature branch. The `main` deployment workflow publishes to AWS Lightsail after merge; do not merge incomplete redesigns while teammates have pending work. The source-level checks do not substitute for a browser smoke test in desktop/mobile or an AWS deploy verification.

Data: NASA PSI and NTRS. Not affiliated with or endorsed by NASA. License: GPL-3.0.
