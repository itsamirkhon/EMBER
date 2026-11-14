# EMBER backend

Spacecraft fire-evidence lab backend: FastAPI + pydantic v2 + stdlib sqlite3, own BM25/RRF. Contract: `../SPEC.md`.

## Run
```bash
cd backend
python3 -m uvicorn ember.main:app --port 8000
```
State lives in `backend/var/ember.db` (override with `EMBER_DB`). A saved example review (`rev_example_bass2`) is seeded at startup.
Optional live explanation: set `OPENAI_API_KEY` (model via `EMBER_OPENAI_MODEL`, default `gpt-4.1-mini`). Output is verified against the evidence package; on failure the deterministic text is shown with a warning. Without the key the mode is always `deterministic`.

## Test
```bash
cd backend
python3 -m pytest tests -q          # all unit + API tests
python3 -m eval.run_eval            # regenerates eval/results.json (preliminary team evaluation)
python3 -m ember.corpus --rehash    # after intentionally editing data/*.json
```

## Layout
- `ember/models.py` typed contract (ScientificValue with `unknown`, events, claims, reviews, ...), validated at every boundary.
- `ember/corpus.py` loader (manifest hash check, referential integrity). `data/` corpus + `data/README.md` (what is unverified).
- `ember/engine.py` endpoint requirement table, rule registry (`RULES`, `RULES_VERSION`), applicability decisions, contrasts, evidence quality.
- `ember/retrieval.py` BM25 + structured filters + RRF; dense/Jev are flag-off stubs.
- `ember/claims.py` review claims with dependency links, open questions, insights, variant diff.
- `ember/planner.py` test blocks, exact (<=16 blocks) or greedy selection within a run budget.
- `ember/explain.py` deterministic text, optional verified live path. `ember/exports.py` report/json/csv/dataset.
- `ember/store.py` sqlite (WAL, atomic review+revision+idempotency, crash recovery). `ember/main.py` API.
- `eval/` gold cases, baselines A/C vs D, metrics, `results.json`.

## Notes for the frontend
- `GET /api/reviews` and `GET /api/investigations` return `{items:[...]}`.
- `GET /api/investigations/{id}` returns the Investigation (with `tests` = ids) plus `test_records` (full Test objects), `claims` and `summary` (each summary entry: `text`, `items`, `source_refs`, `verification`).
- Extras beyond SPEC: `GET /api/rules`, `GET /api/reviews/{id}/revisions`, `explanation` and `parent_id`/`variant_patch` on Review, `o2_role`/`substrate`/`flow_history` optional config fields, `?endpoints=` on dataset export.
- Errors: `{"error":{"code","message"}}`; dataset merge across endpoint families -> 409 `incompatible_endpoint_families`.
