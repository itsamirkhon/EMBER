# Interpret: implementation and acceptance status

Engine `2.1.0-interpret`; corpus `2.0.1-scientific-fixes`; comparison `interpret-1.0`.

The software implementation is delivered for the scoped corpus. Scientific acceptance remains partial. These are team-defined acceptance gates, not additional NASA judging rules. A passing deterministic guard is not semantic proof.

| Requirement | Implemented and checked | Remaining validation |
|---|---|---|
| INT-01 Endpoint meaning | Separate observed/negative/unknown/not-measured; smoke is not flame; hot extinction is not complete cessation | Independent endpoint extraction audit across the corpus |
| INT-02 Endpoint-specific factors | Geometry, gas roles, gravity mode, ignition, flow and thermal/sample/aerosol history | Domain-reviewed factor completeness and defensible tolerances; no invented tolerance used |
| INT-03 Protocol meaning | Endpoint observations retain segments, events, interventions, order and unknown timing; operator cutoff cannot become quench | Independent source-to-protocol reconstruction audit |
| INT-04 Unknown/provenance | Missing/assumed cannot establish a match; provenance retained | Source audit beyond sampled records |
| INT-05 Causality | Historical row similarity never establishes a controlled causal effect | Source-supported causal designs are not implemented as positive causal inference |
| INT-06 Quantities | Two source-audited arithmetic contrasts, compatible metric definitions, signed deltas and citation-bound derived prose | Wider metric registry, uncertainty estimates and independent quantitative acceptance |
| INT-07 Atomic sources | Claims carry IDs; comparisons retain source locators, segments/events and limits; model attribution is checked | Expert semantic claim-to-source assessment; metadata can require documented correction |
| INT-08 Generation | Structured comparisons and records enter Luna; malformed/unsupported claims trigger explicit deterministic fallback; summary derives from checked claims | No claim of complete semantic enforcement or zero false rejection; adversarial prose assessment remains |
| INT-09 Changes | Every conclusion is linked to its own evidence; unknown citations cannot borrow another conclusion's test dependencies | External verification on realistic design changes |
| INT-10 Useful results | 12/12 expected useful descriptive cases; two supported arithmetic positives | General false-refusal/coverage estimates on closed data |
| INT-11 Product consistency | Shared UI/core; POST, saved GET, Markdown and JSON preserve comparison results; current version prevents stale review reuse | Broader user study and operational testing |
| INT-12 Honest scope | All 15 investigations inventoried with context/planned/aggregate restrictions; 1,678 rows are not independent experiments | Closed source-history groups and independent domain review |

## Evidence and reproducibility

- `npm test`: 184/184 software regression and HTTP lifecycle tests; no external requests. Two workers bound CPU contention; timeouts and assertions are unchanged.
- `npm run lint` and `npm run build`: client/server types and production frontend build.
- `python3 -m unittest pipeline.test_build_corpus pipeline.test_verification_status`: corpus pipeline checks.
- `npm run eval:interpret`: 25/25 source-audited DEVELOPMENT cases; macro-F1=1.0 over present classes; useful descriptive cases 12/12; zero observed critical errors on this finite set. The `comparable` class has no real-case support in this set. A/B reversal is a robustness check, not additional independent cases.
- `npm run eval:interpret:numeric`: 2/2 arithmetic cases, SAME-R +10.4 nm and BASS-II −0.059 mm/s. These are differences of recorded rounded values under differing conditions; no isolated factor effect or uncertainty estimate follows.
- Original failing reports and two post-run annotation corrections remain in `eval/interpret/`; see `INTERPRET_SOURCE_REVIEW.md` for primary-source basis and limitations. Do not describe the final score as untouched test accuracy.

## Same-generator diagnostic

One explicit live run used gpt-6-luna on eight development cases, two tracks with identical prompts, records, source-method references and query. Only the second track received ComparisonResult. Sixteen requests completed without provider/contract errors. Raw evidence matched 2/8 expected comparability labels; adding the structured comparison matched 8/8. Exact causal-label agreement was 6/8 and 7/8 respectively; the remaining mismatches were `insufficient_information` versus the expected descriptive-only label, not positive claims of causation.

This measures adherence to development labels with precomputed decisions. It does not independently validate those decisions, evaluate retrieval, prove semantic correctness of the explanations, or establish superiority over competitor products. No population accuracy or confidence interval is claimed. Raw outputs, model metadata and per-case errors are retained in `eval/interpret/generator-diagnostic-report.json`.

## Live integrated smoke

Saved review `rev-mwh0uga5-cd112246` returned LIVE_AI with no warnings, the selected GPT-6 Luna and actual Gemini decision/embedding metadata. The UI rendered the observation and operator-cutoff limitation, and source verification opened its locator/context. All five deterministic checks passed. Broader earlier requests explicitly fell back when stricter attribution/lexical checks rejected prose; one successful request is not a measured reliability rate. Sanitized public-NASA smoke evidence is retained in `eval/interpret/live-smoke-report.json`.

## Unmet scientific release gates

1. A combustion-domain reviewer independently checks source meaning, applicable factors, atomic claims and disagreement cases.
2. Freeze an independent test split by experimental history/source family; include positive comparable examples and all supported endpoints. Never reuse this development fixture as a closed test.
3. Run the planned BM25, structured-matcher, full-system and component ablations with the same generator and comparable budgets; evaluate useful coverage, critical errors and source support. The eight-case diagnostic does not replace this experiment.
4. Assess live generated prose and numerical uncertainty with external gold. Lexical checks and model confidence cannot provide this gold.

No NASA endorsement, safety certification, universal transferability or independent scientific validation is claimed. Keep Interpret marked as **implemented; scientific acceptance partial** until these gates are passed.
