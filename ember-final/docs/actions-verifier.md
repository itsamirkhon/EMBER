# Verifier changes — action log

Scope: `src/core/verifier.ts`, `tests/verifier-regression.test.ts`, this log. No corpus changes, provider calls, commits, or pushes. Followed the requested ub-mode TDD workflow.

1. Read ub-mode and the existing verifier, generation contracts, deterministic generator, and core tests. Root causes: a package-global number whitelist; overlap calculated for an entire observed item; guard coverage omitted interpretation; extinction vocabulary conflated with failure to ignite.
2. Wrote eight behavioral tests before edits, including a real `runReviewSync` review over the checked-in NASA corpus. Initial run: **6 failed / 2 passed**. The failure reproduced valid citations laundering appended safety claims across all three categories, unrelated appended text borrowing overlap, swapped units, and a query-only number becoming an observed measurement.
3. Added pure helpers for citation resolution, source/test measurement text, value–unit extraction, and assertion boundaries. Quantities in observations now require value–unit support in cited records/text; query quantities are available only for interpretation/application. `%vol` and `%` are treated as equivalent notation. Comparison retains a 0.5% rounding tolerance. Existing unqualified-number check remains supplementary, not a proof of number semantics.
4. Replaced whole-item lexical screening with conservative assertion-level screening. Missing accessible cited text now fails rather than silently skipping. The API field `lexicalEntailmentCheck` is retained, but comments/messages identify this as lexical mismatch screening, **not semantic entailment**.
5. Applied evidence-review scope guards to observed facts, author interpretations, engineering implications, applicability conditions, and raw summary. Unqualified crew/cabin safety, flight/material certification, and universal extinction claims fail. Negation is handled within an assertion, so a separate negative sentence cannot excuse a positive guarantee. Qualified or explicitly negative scientific wording remains usable.
6. Added a valid limited self-extinction quotation, cross-test number contamination, and mixed negative/positive clause tests. These passed after the main changes. Added a separate regression showing actual ignition followed by self-extinction: **failed first**, then passed after removing self-extinction from the non-ignition polarity pattern. Added raw-summary-only safety injection: **failed first**, then passed after adding that surface to the scope check.
7. Final targeted command: `npx vitest run tests/verifier-regression.test.ts` — **13 passed**. Earlier combined run: verifier regressions passed; core suite had one concurrently changing applicability assertion (`abrupt_cutoff` admissibility), reported to parent. TypeScript lint passed after initial implementation; a later run was blocked by concurrently introduced `review-adapters.test.ts` input fields awaiting their implementation. Parent owns the final integrated checks.
8. Searched available tool metadata for `crapper`, `dryer`, and `mutator`: none are installed/exposed in this session. No CRAP, duplicate-rank, mutation-score, or mutation-tool execution claim is made. Kept helpers local/pure; behavioral adversarial regressions check the actual exported verification API.

## Remaining scientific limits

- Passing these deterministic guards means **no checked violation was found**, not that every generated claim is scientifically supported. Lexical overlap does not establish entailment or causation.
- Assertion splitting and safety/negation recognition are conservative English-language heuristics. Arbitrary paraphrases, complex quotation/nested negation, or other languages need independent semantic checking and a reviewed scientific gold set.
- Value–unit support is not field/role/segment entailment: two quantities with the same unit can still refer to different variables. Multiple citations may pool support. Compound table headers, unit conversions not normalized here, scientific notation, and inferred quantities are not comprehensively covered.
- Interpretation may restate query quantities and the explicit conventional reference regimes 0 g / 1 g; that is not a claim that those quantities were measured in the cited experiment.
- The legacy package-global unqualified-number screen remains for compatibility. Unlabelled numbers, counts, and deductions need typed derivation records for stronger checking.
- Nothing here validates source extraction, AI calibration, experimental applicability, certification, or forecast reliability. No live model evaluation was performed.

## Follow-up: historical snapshot boundaries

Additional authorized scope: hydration/dehydration/demo sections of `server/store.ts`, static storage paths in `src/ui/apiClient.ts`, and new `tests/snapshot-version-regression.test.ts`. Parent separately owns API guards and cache signatures.

1. Wrote four regression tests first: **4/4 failed**. Reproduced current experiments being attached to old conclusions, embedded historical records being discarded during persistence, corpus-only server demo changes not refreshing, and stale static demo reuse.
2. Historical snapshots now skip current-corpus hydration/registration when either engine or corpus differs. Embedded historical records are retained on persistence. Missing archived records remain missing; the implementation does not reconstruct history from current data.
3. Server demos refresh on engine **or** corpus change. Static demo loading invalidates stale demos for recomputation while preserving custom historical reviews. Historical static reads expose a warning; variants, planner recomputation and CSV/modeling exports reject incompatible versions. Readable historical Markdown/JSON remain available.
4. Added API integration coverage for the parent's archive guards: historical reads and Markdown/JSON succeed; variants, programmes and current-data CSV/modeling exports return `409 ARCHIVED_REVIEW`.
5. Initial integration run hit sandbox `listen EPERM` on loopback, not an application assertion. Re-ran with the local-test escalation: **5/5 tests passed**, no provider requests. `npm run lint` passed after these edits.

Limit: older compacted snapshots may already have discarded their original experimental records. They are retained as historical conclusions with original version metadata; restoration requires the matching archived corpus, not the current corpus.
