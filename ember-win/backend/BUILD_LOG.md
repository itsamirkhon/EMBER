# Build log (backend)

1. Models (`ember/models.py`) with boundary validation; tests first in `tests/test_models.py`.
2. Corpus: 8 investigations, 20 tests (11 non-exemplar descriptions + 9 structural exemplars), 8 claims, manifest with sha256; `data/README.md` lists exactly what is unverified. Suppression/MDCA-type record deliberately omitted (not confident).
3. Engine: endpoint requirement table, 25-entry rule registry (`RULES_VERSION 2026.11-r1`), semantic rules before numeric closeness, contrasts without causal wording.
4. Retrieval: own BM25, structured filters, RRF; dense/Jev stubs (flag off).
5. Planner: control + >=2 replicates mandatory; exact enumeration up to 16 blocks, else greedy (no optimality claim); coverage is not information gain.
6. Explanation: deterministic generator; optional OpenAI path with verifier and visible fallback (tested with an injected fake client; never exercised against the real API).
7. API + sqlite store (WAL, atomic save, idempotency, crash recovery of interrupted runs), exports, replay, eval summary, saved example seeded at startup.
8. Eval harness: 60 gold cases, group-based dev/validation/test split, baselines A, C, always-insufficient sanity baseline vs D; results in `eval/results.json`.
Smoke test: server started with uvicorn on :8000; curl flow parse -> review (+idempotent replay) -> variant -> programme -> report/dataset export -> replay -> eval summary all succeeded.
