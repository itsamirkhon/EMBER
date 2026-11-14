# EMBER frontend

React 18 + TypeScript (strict) + Vite + react-router. Plain CSS tokens, hand-written SVG, no chart library.
The contract is `../SPEC.md`; types are in `src/api/types.ts`, validators in `src/api/parse.ts`
(every response is parsed once at the boundary in `src/api/client.ts`; error envelopes surface as visible banners).

## Run

```bash
npm install
npm run dev            # :5173, proxies /api -> http://localhost:8000 (real backend)
npm run dev:mock       # same, but VITE_MOCK=1: in-browser mock backend (src/api/mock.ts), no backend needed
npm test               # vitest (mock layer is enabled automatically)
npm run typecheck      # tsc --noEmit
npm run build          # typecheck + production build into dist/
```

If port 5173 is busy, Vite moves to the next port; pass `--port N --strictPort` to pin one.
Against the real backend: start it on :8000, then `npm run dev` and open http://localhost:5173.
"Load demo review" opens the first review with `mode: "saved_example"` from `GET /api/reviews` (or the first review if none).

## Real backend contract

`src/api/fixtures/*.json` are captured with curl from the real backend (`/api/meta`, investigations, the saved review, eval, rules, ...).
`src/__tests__/realBackend.test.ts` parses them, and the mock layer (`VITE_MOCK=1`) replays them, so the mock matches the real shapes.
Re-capture the fixtures if the backend contract changes.

## Layout

- `src/api` types, parsers, client, mock fixtures
- `src/components` ScientificValue renderer (`unknown` is always the literal word), badges, timeline, config form
- `src/pages` Landing, ReviewNew (question, parse, confirm, run polling), Review (overview, claims), ReviewViews
  (insights, comparisons, design comparison, test programme, export, data replay), Explorer (+ investigation summary, protocol), Eval, SavedReviews

## Honesty rules enforced in the UI

Unknown values render as `unknown`, never 0 or blank; unmeasured evaluation cells read `not measured`;
contrast wording is shown as returned and never framed as causation; relevance, applicability and evidence quality
are separate columns; coverage is never called information gain; the replay is labelled a data replay, not a physics simulation.

## Known gaps

- Mock fixtures are illustrative, with a visible banner; they are not corpus data.
- Comparison table and claim-evidence links need `GET /api/investigations/{id}` (`test_records`) for every ranked investigation; the shell fetches them in parallel after the review loads.
- The mock layer only has full records for inv_bass2 and inv_flex; other ranked investigations 404 there (handled).
- Light mode follows `prefers-color-scheme`; no manual toggle. No end-to-end browser tests; contrast was checked by token choice, not an automated audit.
