# EMBER: OpenRouter decision and embedding adapters

These adapters use the user-selected models without model substitution:

- `google/gemini-decision-1`: `POST https://openrouter.ai/api/alpha/decisions`.
- `google/gemini-embedding-2`: `POST https://openrouter.ai/api/v1/embeddings`.

The first endpoint is **not** chat completions. It returns typed answers, not generated scientific prose. A separate generative model is still required if the product enables free-text generation.

## Server integration

`server/openrouter.ts` exports `OpenRouterClient`, `DECISION_MODEL`, `EMBEDDING_MODEL`, `DECISION_PROMPT_VERSION`, `EMBEDDING_FORMAT_VERSION`, `formatEmbeddingQuery`, and `formatEmbeddingDocument`.

Construct the client in the server process with `new OpenRouterClient()`; it reads `OPENROUTER_API_KEY` from the server environment. Never use a `VITE_` variable for credentials. An explicit `apiKey` and `fetchImpl` can be injected for tests. Missing credentials fail before any request. Request timeout defaults to 20 seconds, configurable as `timeoutMs` in the constructor (maximum 120 seconds). HTTP, transport, malformed-response and timeout errors propagate; there is no automatic offline or alternate-model fallback. Error messages exclude raw provider bodies and headers.

### Passage evaluation

```ts
const decision = await client.evaluatePassage({
  query: researchQuery,
  passage: {
    chunkId: chunk.chunkId,
    text: chunk.text,
    epistemicStatus: chunk.epistemicStatus,
    sectionHeader: chunk.sectionHeader,
  },
});
```

One request asks three bounded choice questions: relevance, observed versus planned/method content, and tension with an explicit query premise. A question alone does not assert a premise. Unrelated conditions alone do not establish contradiction. The returned typed fields are `q1Relevance`, `q2Observation`, `q3Contradiction`, `route`, `concentrationConfidence`, `promptVersion`, `evaluatorMode`, `model`, `responseId`, `latencyMs`. Root integration attaches chunk/source/test IDs and provenance rather than accepting model-generated IDs.

Each response must contain all three answer records with the correct `type: choice`, exact label set, finite probabilities within [0,1], sum within 0.001 of 1, a maximum-probability selected choice, and confidence within [0,1]. Although OpenRouter's generic schema marks confidence/distributions optional across providers, Google's native ChoiceAnswer documents both as required. Missing fields are rejected; no synthetic probabilities are generated and no extra request flag is required. The returned model must match the requested model or its versioned build prefix. The provider response ID and resolved model are retained. For the observed embedding response, the exact native Google ID `gemini-embedding-2` is also accepted for the requested router ID; unrelated model IDs are rejected.

Code routes related contradictions into `conflict`, direct observed findings into `evidence`, and other material into `context`. These are **retrieval triage labels**, not permission to assert scientific applicability. The deterministic material/protocol/endpoint engine remains authoritative for compatibility. Mixed passages can contain both observations and plans: the observation label does not certify every sentence. Google's native choice confidence is the winning option's probability (`p_max`), unlike Jev's distribution-concentration definition. The compatibility field `concentrationConfidence` currently stores the mean native confidence; its legacy name does not change that meaning. Neither this value nor individual passage probabilities are combustion probabilities, establish claim entailment, or demonstrate calibration on this domain. Threshold tuning and semantic quality require the frozen evaluation protocol.

### Embeddings

`await client.embed(formattedInputs, dimensions)` returns one validated vector per input in input order. It accepts 1–128 inputs and defaults to 768 dimensions; 1–3072 are supported by the client. The response must contain exactly the requested indices, distinct and in range, with finite nonzero vectors of the requested dimension and a finite Euclidean norm. It never substitutes SVD or another embedding model.

Google Embedding 2 **does not support `task_type`**. Text search uses complementary formatting:

- query: `task: search result | query: {question}`;
- document: `title: {section title or none} | text: {chunk text}`.

Use the exported formatters both at build and query time. Use the same model, dimension and format version for both branches. Do not compare SVD vectors or Embedding 1 vectors to Embedding 2 vectors. Cosine similarity does not imply physical applicability or scientific confidence.

## Explicit offline artifact build

The following command makes paid API requests when a server key is configured. It is not invoked automatically by tests, app startup, or each review:

```sh
npx tsx pipeline/embed_openrouter.ts public/data/chunks_index.json data/openrouter_embeddings.json
```

Set `OPENROUTER_API_KEY` in the process environment using the team's secret manager or local ignored environment loading. The script itself does not load dotenv files. Optional process variables: `EMBEDDING_DIMENSIONS` (default 768), `EMBEDDING_BATCH_SIZE` (32, maximum 128), `EMBEDDING_CONCURRENCY` (2, maximum 8). Set these before running the command; do not put credentials in shell history.

Input is the existing chunks index with `corpusVersion` and `chunks`. The pipeline validates all IDs/text before spending, formats documents once, computes SHA-256 of each **formatted document input**, and outputs:

```ts
{
  corpusVersion,
  embeddingModel: 'google/gemini-embedding-2',
  embeddingDim: 768,
  formatVersion: 'gemini-search-v1',
  entries: [{ chunkId, contentHash, vector }]
}
```

The existing 2,463-chunk index is not modified. Old SVD vectors are not copied into the new artifact. Batches run with bounded concurrency and preserve source order. A failed batch rejects the build, leaving any previous artifact intact. File publication uses a unique temporary file followed by atomic rename; identical successful builds replace the artifact coherently. There is no per-batch resume/cache: a failed run may already have incurred charges, and retrying repeats completed calls. One process owns the target artifact. Source hashes detect input drift; the model name is a provider alias, not a guarantee that future provider weights are identical.

Before using an artifact, the server must validate model, dimension, format, corpus version, duplicate/missing IDs, and every current formatted-document hash. Missing or stale artifacts are explicit errors in live embedding mode. Queries generate only a query embedding; document vectors are built offline. Hybrid fusion and exact scientific filtering belong in the retrieval/scientific engine, not this adapter.

## Verification and limits

`npx vitest run tests/openrouter.test.ts` uses mocked documented wire responses; it makes no paid network requests. Tests cover typed request construction, malformed distributions, unknown labels, model substitution, error sanitization, timeout, vector ordering/validation, corpus-ID validation, bounded batch concurrency, failed builds, and atomic replacement. On 2026-11-14 a real provider smoke check succeeded, 2,463 document embeddings (768 dimensions) were built, and a bounded local API review returned live Gemini decision/embedding provenance without fallback. The resolved decision model was `google/gemini-decision-1-20261111`; embedding responses used native ID `gemini-embedding-2`. This establishes connectivity and runtime contracts only. Domain calibration, benchmark quality and a controlled cost/latency study remain unmeasured.

Primary documentation checked 2026-11-14:

- [OpenRouter Decisions OpenAPI](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-request)
- [OpenRouter team's wire-format reference](https://github.com/OpenRouterTeam/skills/blob/main/skills/openrouter-decisions/references/decisions-api.md)
- [Gemini Decision 1 model](https://openrouter.ai/google/gemini-decision-1)
- [OpenRouter embeddings API](https://openrouter.ai/docs/api/api-reference/embeddings/submit-an-embedding-request)
- [Google Embedding 2 task formatting](https://ai.google.dev/gemini-api/docs/embeddings#task-types)

Additional primary contract verification: [Google SDK ChoiceAnswer](https://googleapis.github.io/js-genai/release_docs/types/gaos_models_decisions_choice-answer.ChoiceAnswer.html) documents required per-option normalized probabilities and native confidence as `p_max`; [Google launch announcement](https://blog.google/innovation-and-ai/technology/developers-tools/gemini-decisions-api/) confirms distributions for Choice. The ambiguous shorter OpenRouter model description does not require replacing unordered categorical questions with ordered Score rubrics.
