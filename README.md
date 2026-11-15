# EMBER — Evidence Map for Burn & Extinction Risk

**NASA Space Apps Challenge 2026 · “Flame in Freefall”**

> NASA’s fire experiments in one place — and the line where the evidence ends.

None of the 261 solid-material flight tests with measured oxygen in NASA’s Physical Sciences Informatics (PSI) repository ran above **22.7% O₂**, and all ran near 98–102 kPa. Lunar cabins plan **30–34% O₂ at 56–70 kPa**. EMBER shows a spacecraft fire-safety engineer which NASA investigations apply to their cabin, the nearest real tests and how far away they are, and which flight test would close the gap. It never gives a fire-risk percentage.

- **Live site:** https://itsamirkhon.github.io/EMBER/ (static, no login, no API key)
- **Project page text, NASA data list, Use of AI, references, video script:** [`docs/SUBMISSION_2026.md`](docs/SUBMISSION_2026.md)

## The screens

| Route | Screen |
|---|---|
| `#/` | 3D intro (flame at 1 g vs microgravity, then a lunar cabin) and the finding |
| `#/map` | Evidence map: all tests by O₂ × pressure with mission atmospheres and the evidence cliff |
| `#/lens` | Mission lens: environment, task, material → *Measured* / *Data nearby* / *Beyond the evidence*, three ranking scales, nearest real tests with axis gaps, next experiment |
| `#/ask` | Ask EMBER: cited answers; ten pre-computed answers work without a server |
| `#/investigations`, `#/compare`, `#/export` | Cards for the 15 investigations with test tables, protocol comparison, CSV/JSON with source row for every record |
| `#/earth`, `#/trust` | Back to Earth (NASA Spinoff) and the self-check page (backtest vs baseline, claim checks, limits) |

## Run it

One project, at the repository root.

```sh
npm install
npm run dev          # site + optional API at the printed URL
npm test             # 221 core, regression and API tests
npm run test:intro   # 36 tests for the 3D intro's evidence gate
npm run lint         # TypeScript checks for client and server
npm run build        # static site in dist/ (what gets deployed)
```

Without keys everything runs in the browser. With a server-side `.env` (see `.env.example`), the Node API adds live retrieval decisions and model-written answers; secrets never reach the frontend.

Rebuild the derived data after a corpus change: `npm run data:compact`, `npm run data:trust`, `npm run intro`, and (paid, needs `OPENAI_API_KEY`) `npm run data:ask`.

## Layout

| Path | What lives there |
|---|---|
| `src/core/` | Scientific engine: applicability, comparison, retrieval, verifier. Shared by the browser and the API |
| `src/ui/` | React app. `v3/` is the judge-facing site (home, map, lens, ask, trust); `pages/` is the research workbench |
| `server/` | Node API and optional live-model adapters (also mounted into `npm run dev`) |
| `tests/` | Vitest suites and the 3D intro gate (`tests/presentation/`) |
| `eval/` | Benchmark cases, runners and reports |
| `pipeline/` | `build_corpus.py` builds the corpus, index and SQLite mirror. `seed/` holds the original PSI/NTRS fetch and normalisation scripts that produced `data/legacy_seed/` |
| `scripts/` | Builders for the derived files in `public/data/` and the 3D intro |
| `intro-src/` | Source of the 3D intro, compiled into `public/intro.html` |
| `data/` | `raw/` NASA PSI and NTRS downloads, `legacy_seed/`, source cache, SQLite mirror |
| `public/` | Static files shipped as-is, including the generated `public/data/*.json` |
| `docs/` | Submission text, demo guide, technical reference, audits. `archive/` holds documents of the first prototype |

`main` is the only release branch: every push runs `Verify EMBER` and deploys `dist/` to Lightsail and GitHub Pages. Work on a short-lived branch and merge through a pull request.

## More

- [Technical reference](docs/TECHNICAL.md) · [Implementation status](docs/IMPLEMENTATION_STATUS.md) · [Interpret status](docs/INTERPRET_STATUS.md) · [Concept](docs/CONCEPT.md)
- The earlier prototypes (`web/`, `ember-win/`) were removed from the tree; they remain in Git history up to commit `77a28bb`.

Data: NASA PSI (CC0 for reviewed records) and NTRS. Not an official NASA product and not a certification tool. License: GPL-3.0.
