# EMBER 2.1.0

**Spacecraft Fire Evidence Lab** — a scientific workbench for finding, comparing and interpreting NASA combustion evidence for a specified configuration, and identifying what requires additional research.

The current corpus contains **15 investigations, 1,678 records, 145 source-linked claims, 68 source records and 2,463 retrieval chunks**. The 1,678 records include series aggregates and reconstructed protocol representations; they are **not 1,678 independent experimental runs**. Claim quotations were checked against cached source text. That check does not independently validate their scientific meaning, attribution or applicability.

`Engine: 2.1.0-interpret / corpus: 2.0.1-scientific-fixes`. The product separates question relevance, observation applicability and evidence quality, preserves unknown data and protocol-dependent outcomes, and supports configuration comparison, review snapshots and export. It is a research-support tool, not hardware qualification or a spacecraft safety certification.

## Quickstart

Install the repository's Node dependencies, then start the integrated frontend/API:

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. Deterministic mode requires no external model key. Production-style local execution:

```sh
npm run build
npx tsx server/index.ts
```

The standalone server serves `/api/*` and `dist/` on `PORT`, default `8787`.

## OpenRouter models

The selected server-side models are:

- `google/gemini-decision-1` for three bounded passage judgments: relevance, observation versus plan/method, and contradiction with an explicit query premise.
- `google/gemini-embedding-2` for document/query embeddings in the hybrid retrieval branch.

Configure **`OPENROUTER_API_KEY`** in the server environment or a local ignored `.env`, following [`.env.example`](./.env.example). Never use a `VITE_` variable for secrets. Generate the document embedding artifact explicitly:

```sh
npm run embeddings:openrouter
npm run dev
```

The embedding command makes paid provider requests. It reads `public/data/chunks_index.json` and atomically writes ignored, server-side `data/openrouter_embeddings.json`. It does not run automatically on startup or for each review. Rebuild it after corpus/chunk changes. The server checks corpus version, model, formatting, dimensions, IDs and content hashes before using it.

Enable the UI live option or send `useLiveAi: true` to `POST /api/reviews`. With only an OpenRouter key, retrieval/decisions can be live while prose remains deterministic: the overall synthesis badge is not evidence that every component is offline. Inspect decision `evaluatorMode`, actual model/prompt metadata, retrieval mode and warnings. `bm25`/`structured` retrieval does not run the embedding branch.

A separate server-side `OPENAI_API_KEY` enables **`gpt-6-luna`** for evidence-grounded prose through the existing OpenAI Chat Completions path. The selected model is defined once in the generator, included in request-cache identity and reported by health/model provenance. The decision model does not generate free text. No generative model is silently substituted for Gemini Decision. At the adapter boundary, invalid responses and provider failures are errors; the API may explicitly return a deterministic review with a warning. Always retain that warning when evaluating results.

**Live OpenRouter connectivity and a bounded review have been checked; scientific quality and domain calibration have not been established.** Automated adapter tests use mocked documented wire responses. Google choice confidence is native `p_max`; the legacy field `concentrationConfidence` averages native confidences and is not TypeSafe concentration, combustion probability or proof of scientific correctness. Offline `jev.ts` is heuristic passage triage, not a real Jev invocation or a calibrated scientific decision model.

See [OpenRouter contracts and operation](./docs/OPENROUTER.md) for exact endpoints, task formatting, batching, timeouts and limitations.

## Implemented workflow and current limits

The React workspaces cover research review, investigation exploration, source dossiers, fire-safety insights, protocol comparison, design variants, test planning, modeling/replay, export and evaluation. The TypeScript scientific core is shared with the Node API; Python builds the versioned corpus, local retrieval index, manifest and SQLite mirror.

This phase corrected material alias collisions, invented ignition on unknown BASS records, several event-binding/chronology bypasses, and tested safety-claim/numeric contamination in verification. Corrected examples have behavior regressions. This is not an independent scientific validation of every reconstructed protocol.

The verifier applies deterministic scope, citation, number/unit and lexical mismatch checks. Passing it means those checks found no violation; lexical overlap does not prove semantic entailment, causal validity or universal safety. Planner feasibility, predictor reliability and complete semantic claim support still require independent validation. Quantitative prediction is not validated CFD. Data replay, conceptual illustration and model output must remain distinguishable.

## Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Vite frontend with integrated `/api/*` |
| `npm run build` | Client typecheck and production build |
| `npm run preview` | Built application with API middleware |
| `npm test` | Core, regression, provider-boundary and API tests |
| `npm run lint` | Client/server TypeScript checks |
| `npm run corpus` | Rebuild corpus, local SVD index, manifest and SQLite mirror |
| `npm run embeddings:openrouter` | Explicit paid document-vector build; server key required |
| `npm run eval` | Existing internal cases, baselines and ablations; no live Gemini benchmark |
| `python3 -m unittest pipeline.test_build_corpus` | Python reconstruction/corpus checks; requires pipeline Python dependencies |
| `npx tsx eval/competitor_benchmark.ts` | Existing benchmark harness; external competitors need actual configured adapters |

The existing offline dense index is TF-IDF/SVD and is labelled separately from Gemini embeddings. Rebuilding the corpus does not generate Gemini vectors.

## Interpret acceptance

One shared comparison engine separates observation comparability, query applicability and causal support. UI, review generation and Markdown/JSON export consume the same structured verdicts. Missing measurements, nonflaming smoke, aggregates and operator shutdown cannot become invented flame outcomes. Supported arithmetic differences retain exact source-method references and explicit descriptive limits. Design changes invalidate each conclusion through its own cited observations.

The source-audited development set passes 25/25 descriptive cases and 2/2 quantitative cases. Original failing reports and corrected annotations are retained. This is not independent scientific acceptance: the real-case set lacks the `comparable` class, external domain review and a closed test split. See [Interpret status](./docs/INTERPRET_STATUS.md) and [source review](./docs/INTERPRET_SOURCE_REVIEW.md).

Run `npm run eval:interpret` and `npm run eval:interpret:numeric` without credentials. The opt-in same-generator diagnostic uses paid requests only with an explicit `--live`; its small post-development results do not establish superiority.

## Evaluation status

The repository contains a team-authored 100-case evaluation suite and baseline/ablation harness. It is useful for development regression checks. It **does not yet establish independent scientific superiority**: dependent source/test records can cross the historical splits, the baseline comparison needs strengthening, and historical full-engine results were worse than the static baseline on some scientific decisions. Do not reuse old metrics as evidence for this corrected release or for live Gemini components.

The independent evaluation still needs source-reviewed gold, source/series-aware grouping, a closed test split, useful-answer coverage alongside critical-error rates, and remeasurement after changes. Competitor placeholders/common-data baselines are not executed competitor products. No complete head-to-head benchmark against FlameBound, MicroFire Atlas, Fotia or HEARTH has been performed.

`public/data/eval_report.json` and older evaluation/submission documents may contain historical claims and outputs. Their code/corpus version and provenance must be checked before presentation. A model-backed decision is not validated simply because the API call succeeds.

## Repository map

- `src/core/`: domain types, parsing, retrieval, compatibility, protocols, dependencies, synthesis, verification, planning, prediction and exports.
- `src/ui/`: React application and API client.
- `server/`: HTTP API, review persistence and server-only OpenRouter integration.
- `pipeline/`: Python corpus builder and explicit OpenRouter embedding build.
- `public/data/`: public versioned corpus, local index, manifest and historical evaluation output.
- `data/`: raw/cached sources, SQLite mirror, review snapshots and optional private embedding artifact.
- `eval/`: existing team-authored cases and evaluation/competitor harnesses.
- `tests/`: behavior regressions and integration tests.

The API supports health, investigations, source inspection, query parsing, saved reviews/runs, design variants, test-programme updates and Markdown/JSON/CSV exports. [OpenAPI](./docs/openapi.json) describes the base interface; inspect runtime health, envelopes and component provenance for newly added model metadata.

## Developer handoff

Start with [current implementation status and next steps — Russian](./docs/IMPLEMENTATION_STATUS.md), [OpenRouter integration](./docs/OPENROUTER.md), and the phase action logs: [protocol/data](./docs/actions-protocol-data.md), [verifier](./docs/actions-verifier.md), [providers](./docs/actions-openrouter.md).

Older [evaluation report](./docs/EVALUATION_REPORT.md), [demo guide](./docs/JUDGE_DEMO_GUIDE.md), [submission](./docs/SUBMISSION_EN.md) and [pitch](./docs/PITCH_SLIDES.md) remain working materials. Reconcile their claims with current measured behavior before using them externally.
