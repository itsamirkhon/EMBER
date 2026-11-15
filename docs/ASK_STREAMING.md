# Ask EMBER: checked streaming and evidence comparison

Ask EMBER sends `POST /api/reviews` with `Accept: text/event-stream`. Existing JSON clients remain supported. Validation errors (including out-of-scope questions) are ordinary JSON responses before the stream starts.

The SSE response uses JSON `data:` frames:

- `{ "type": "stage", "stage": "retrieval" }` (also applicability, synthesis, verification).
- `{ "type": "claim", "section": "observedFact", "claim": { ... } }`: a completed claim that has passed structural, attribution, descriptive-boundary and evidence checks. This is a preview; the full document is still pending.
- `{ "type": "result", "envelope": { ... } }`: the normal API envelope with the saved review and warnings. Replace all previews with this final result, including when the whole answer fails and deterministic fallback is used.
- `{ "type": "error", "message": "..." }`: an interrupted review. Clear the unfinished preview and allow retry. Do not silently retry a partially consumed request, which could repeat paid calls.

The server requests actual Chat Completions streaming, parses incremental JSON using AI SDK `parsePartialJson`, and never publishes the potentially repaired final array item. Complete candidate claims must pass EMBER's checks before emission. Whole-answer parsing and verification still decide the final result. Partial checks are rejection guards, not proof of scientific correctness. No arbitrary typing timer or unchecked token stream is used.

SSE responses set `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform` and include heartbeat comments. Stop/navigation aborts the fetch and provider requests. Cached reviews can return a result immediately without a new generation. Older JSON servers and deterministic offline mode still return complete answers rather than simulated streaming.

## Evidence and coverage

- Effect/causality questions are capped at `conditional_or_partial`: this engine's comparisons are descriptive, even when records are admissible. Engine version `2.1.1-ask-evidence` prevents replay of reviews computed under the old classification.
- The quick answer reuses checked engineering implications or observations; it is not a separate unchecked model summary.
- Tables show cited tests for verified prose. Missing evidence/fallback reviews show nearest actual-flight records as context, prioritizing the material and reported O₂/pressure/flow/gravity. Other materials and unknown values are explicit, never predictions or zero-valued measurements.
- Recorded flow steps appear only when backed by the original source field. Sequence position is not elapsed time, and the final listed speed is not labelled an exact quench threshold.
- Protocol links select the actual test; the full-review link selects the newly saved review.

## Deployment

Deploy/restart the Node API with the new server files and `ai` dependency as well as publishing the frontend. The current repository deployment workflow publishes static assets only; merging a frontend build does not update a separately managed API. An old API remains compatible but cannot provide checked live previews.

Reference: [OpenAI streaming responses](https://developers.openai.com/api/docs/guides/streaming-responses).
