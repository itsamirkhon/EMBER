import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import {
  ENGINE_VERSION,
  JEV_PROMPT_VERSION,
  exportFormatters,
  generateCandidateBlocks,
  optimizeTestProgramme,
  parseResearchQuery,
  recalculateDesignVariant,
  runReview,
  runReviewSync,
  type CorpusV2,
  type DesignVariantPatch,
  type Investigation,
  type QueryParserOptions,
  type ResearchQuery,
  type RetrievalMode,
  type SynthesisMode,
  type TargetEndpoint,
  type Test,
} from '../src/core/index';
import {
  EmberStore,
  computeReviewSignature,
  resolveOpenAiApiKey,
  type SavedReviewSnapshot,
} from './store';

export const RULES_VERSION = '9-rules-v2.0';
const MAX_BODY_BYTES = 1024 * 1024;
const VALID_RETRIEVAL_MODES = new Set<RetrievalMode>(['bm25', 'hybrid', 'structured']);
const VALID_EXPORT_FORMATS = new Set(['markdown', 'json', 'csv', 'modeling_csv']);
const VALID_PATCH_KEYS = new Set<keyof DesignVariantPatch>([
  'thicknessMm',
  'flowDirection',
  'flowCmS',
  'o2Pct',
  'pressureKpa',
  'gravityG',
  'material',
  'geometry',
  'o2Role',
  'targetEndpoint',
  'enclosureScale',
]);

export interface ApiVersions {
  corpus: string;
  rules: string;
  engine: string;
  jevPrompt: string;
  code: string;
}

export interface ApiEnvelope<T = unknown> {
  run_id: string;
  status: 'ok' | 'error';
  mode: SynthesisMode;
  versions: ApiVersions;
  warnings: string[];
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface ApiHandlerOptions {
  rootDir?: string;
  storePath?: string;
  store?: EmberStore;
  fetchImpl?: typeof fetch;
}

class HttpError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
  }
}

function buildVersions(corpusVersion = '2.0.0-ember-final'): ApiVersions {
  return {
    corpus: corpusVersion,
    rules: RULES_VERSION,
    engine: ENGINE_VERSION,
    jevPrompt: JEV_PROMPT_VERSION,
    code: ENGINE_VERSION,
  };
}

function makeRunId(prefix = 'api'): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function setApiHeaders(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'no-store');
}

function sendJson<T>(res: ServerResponse, statusCode: number, envelope: ApiEnvelope<T>): void {
  setApiHeaders(res);
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(envelope));
}

function sendOk<T>(
  res: ServerResponse,
  statusCode: number,
  data: T,
  opts: { runId?: string; mode?: SynthesisMode; corpusVersion?: string; warnings?: string[] } = {},
): void {
  sendJson(res, statusCode, {
    run_id: opts.runId ?? makeRunId(),
    status: 'ok',
    mode: opts.mode ?? 'DETERMINISTIC_ENGINE',
    versions: buildVersions(opts.corpusVersion),
    warnings: opts.warnings ?? [],
    data,
  });
}

function sendError(
  res: ServerResponse,
  statusCode: number,
  code: string,
  message: string,
  corpusVersion?: string,
  runId?: string,
): void {
  sendJson(res, statusCode, {
    run_id: runId ?? makeRunId('err'),
    status: 'error',
    mode: 'DETERMINISTIC_ENGINE',
    versions: buildVersions(corpusVersion),
    warnings: [],
    error: { code, message },
  });
}

function isPlainObject(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body exceeds 1 MiB limit.');
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    throw new HttpError(400, 'EMPTY_BODY', 'JSON request body is required.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Malformed JSON request body.');
  }
  if (!isPlainObject(parsed)) {
    throw new HttpError(400, 'INVALID_REQUEST', 'JSON body must be an object.');
  }
  return parsed;
}

function validateQuestionAndOverrides(body: Record<string, unknown>): {
  question: string;
  overrides: Partial<ResearchQuery> | undefined;
  parserOptions: QueryParserOptions | undefined;
} {
  if (body.question !== undefined && typeof body.question !== 'string') {
    throw new HttpError(400, 'INVALID_QUESTION', 'Field "question" must be a string.');
  }
  if (body.overrides !== undefined && !isPlainObject(body.overrides)) {
    throw new HttpError(400, 'INVALID_OVERRIDES', 'Field "overrides" must be an object.');
  }
  if (body.parserOptions !== undefined && !isPlainObject(body.parserOptions)) {
    throw new HttpError(400, 'INVALID_PARSER_OPTIONS', 'Field "parserOptions" must be an object.');
  }

  const question = typeof body.question === 'string' ? body.question : '';
  const overrides = body.overrides as Partial<ResearchQuery> | undefined;
  const hasOverrides = Boolean(overrides && Object.keys(overrides).length > 0);

  if (question.trim().length === 0 && !hasOverrides) {
    throw new HttpError(400, 'EMPTY_QUERY', 'Provide a non-empty "question" or non-empty "overrides".');
  }

  return {
    question,
    overrides,
    parserOptions: body.parserOptions as QueryParserOptions | undefined,
  };
}

function validateReviewParams(body: Record<string, unknown>): {
  retrievalMode: RetrievalMode;
  retrievalK: number | undefined;
  budgetRuns: number;
  useLiveAi: boolean;
  model: string | undefined;
  title: string | undefined;
  idempotencyKey: string | undefined;
  forceNew: boolean;
} {
  const retrievalMode = (body.retrievalMode ?? 'hybrid') as RetrievalMode;
  if (typeof retrievalMode !== 'string' || !VALID_RETRIEVAL_MODES.has(retrievalMode)) {
    throw new HttpError(400, 'INVALID_PARAMETER', 'retrievalMode must be "bm25", "hybrid", or "structured".');
  }

  let budgetRuns = 10;
  if (body.budgetRuns !== undefined) {
    if (typeof body.budgetRuns !== 'number' || !Number.isFinite(body.budgetRuns) || body.budgetRuns < 0 || body.budgetRuns > 500) {
      throw new HttpError(400, 'INVALID_PARAMETER', 'budgetRuns must be a finite number between 0 and 500.');
    }
    budgetRuns = Math.floor(body.budgetRuns);
  }

  let retrievalK: number | undefined;
  if (body.retrievalK !== undefined) {
    if (typeof body.retrievalK !== 'number' || !Number.isFinite(body.retrievalK) || body.retrievalK < 1 || body.retrievalK > 100) {
      throw new HttpError(400, 'INVALID_PARAMETER', 'retrievalK must be a finite integer between 1 and 100.');
    }
    retrievalK = Math.floor(body.retrievalK);
  }

  if (body.useLiveAi !== undefined && typeof body.useLiveAi !== 'boolean') {
    throw new HttpError(400, 'INVALID_PARAMETER', 'useLiveAi must be a boolean.');
  }
  if (body.forceNew !== undefined && typeof body.forceNew !== 'boolean') {
    throw new HttpError(400, 'INVALID_PARAMETER', 'forceNew must be a boolean.');
  }
  if (body.model !== undefined && typeof body.model !== 'string') {
    throw new HttpError(400, 'INVALID_PARAMETER', 'model must be a string.');
  }
  if (body.title !== undefined && typeof body.title !== 'string') {
    throw new HttpError(400, 'INVALID_PARAMETER', 'title must be a string.');
  }
  if (body.idempotencyKey !== undefined && typeof body.idempotencyKey !== 'string') {
    throw new HttpError(400, 'INVALID_PARAMETER', 'idempotencyKey must be a string.');
  }

  return {
    retrievalMode,
    retrievalK,
    budgetRuns,
    useLiveAi: Boolean(body.useLiveAi),
    model: typeof body.model === 'string' && body.model.trim() ? body.model.trim() : undefined,
    title: typeof body.title === 'string' && body.title.trim() ? body.title.trim() : undefined,
    idempotencyKey:
      typeof body.idempotencyKey === 'string' && body.idempotencyKey.trim()
        ? body.idempotencyKey.trim()
        : undefined,
    forceNew: Boolean(body.forceNew),
  };
}

function isValidNullableNumber(val: unknown, min: number, max: number): boolean {
  return val === null || (typeof val === 'number' && Number.isFinite(val) && val >= min && val <= max);
}

function validateFlowCmS(val: unknown): boolean {
  if (val === null) return true;
  if (typeof val === 'number') return Number.isFinite(val) && val >= 0 && val <= 1000;
  if (Array.isArray(val) && val.length === 2) {
    return (
      typeof val[0] === 'number' &&
      Number.isFinite(val[0]) &&
      val[0] >= 0 &&
      typeof val[1] === 'number' &&
      Number.isFinite(val[1]) &&
      val[1] >= 0
    );
  }
  return false;
}

function parseVariantPatch(body: Record<string, unknown>): DesignVariantPatch {
  const source = body.patch !== undefined ? body.patch : body;
  if (!isPlainObject(source)) {
    throw new HttpError(400, 'INVALID_PATCH', 'Variant patch must be an object.');
  }

  const patch: DesignVariantPatch = {};
  for (const [key, val] of Object.entries(source)) {
    if (!VALID_PATCH_KEYS.has(key as keyof DesignVariantPatch)) {
      throw new HttpError(400, 'INVALID_PATCH_FIELD', `Unsupported variant patch field "${key}".`);
    }
    if (val === undefined) continue;
    (patch as Record<string, unknown>)[key] = val;
  }

  if (Object.keys(patch).length === 0) {
    throw new HttpError(400, 'EMPTY_VARIANT_PATCH', 'Provide at least one parameter to modify in variant patch.');
  }
  if (patch.thicknessMm !== undefined && !isValidNullableNumber(patch.thicknessMm, 0, 1000)) {
    throw new HttpError(400, 'INVALID_PATCH_VALUE', 'thicknessMm must be null or a finite number between 0 and 1000.');
  }
  if (patch.o2Pct !== undefined && !isValidNullableNumber(patch.o2Pct, 0, 100)) {
    throw new HttpError(400, 'INVALID_PATCH_VALUE', 'o2Pct must be null or a finite number between 0 and 100.');
  }
  if (patch.pressureKpa !== undefined && !isValidNullableNumber(patch.pressureKpa, 0, 1000)) {
    throw new HttpError(400, 'INVALID_PATCH_VALUE', 'pressureKpa must be null or a finite number between 0 and 1000.');
  }
  if (patch.gravityG !== undefined && !isValidNullableNumber(patch.gravityG, 0, 20)) {
    throw new HttpError(400, 'INVALID_PATCH_VALUE', 'gravityG must be null or a finite number between 0 and 20.');
  }
  if (patch.flowCmS !== undefined && !validateFlowCmS(patch.flowCmS)) {
    throw new HttpError(400, 'INVALID_PATCH_VALUE', 'flowCmS must be null, a finite number, or a 2-number range.');
  }

  return patch;
}

function filterInvestigations(investigations: Investigation[], params: URLSearchParams): Investigation[] {
  const dir = params.get('direction')?.trim().toLowerCase() ?? '';
  const phase = params.get('fuelPhase')?.trim().toLowerCase() ?? '';
  const platform = params.get('platform')?.trim().toLowerCase() ?? '';
  const epistemic = params.get('epistemicStatus')?.trim().toLowerCase() ?? '';
  const q = params.get('q')?.trim().toLowerCase() ?? '';

  return investigations.filter((inv) => {
    if (dir && !inv.direction.some((d) => d.toLowerCase() === dir)) return false;
    if (phase && (inv.fuelPhase ?? '').toLowerCase() !== phase) return false;
    if (platform && !(inv.platform ?? '').toLowerCase().includes(platform)) return false;
    if (epistemic && inv.epistemicStatus.toLowerCase() !== epistemic) return false;
    if (q) {
      const hay = [
        inv.id,
        inv.name,
        inv.psi ?? '',
        inv.objective ?? '',
        inv.hardware ?? '',
        inv.methodSummary,
        inv.resultSummary ?? '',
        ...(inv.fuel?.types ?? []),
      ]
        .join(' ')
        .toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

type ModelingEndpointFamily =
  | 'solid_flammability'
  | 'liquid_droplet_combustion'
  | 'smoke_particle_size'
  | 'smoke_point_length'
  | 'gas_burner_flame';

function classifyModelingEndpointFamily(test: Test): ModelingEndpointFamily {
  if (
    test.inv === 'SAME' ||
    test.inv === 'SAME-R' ||
    test.particleSizeNm.value !== null ||
    test.events.some((e) => e.endpoint === 'smoke_particle_size')
  ) {
    return 'smoke_particle_size';
  }
  if (
    test.inv === 'SPICE' ||
    test.smokePointLengthMm.value !== null ||
    test.events.some((e) => e.endpoint === 'smoke_point_length')
  ) {
    return 'smoke_point_length';
  }
  if (test.fuelPhase === 'liquid') return 'liquid_droplet_combustion';
  if (test.fuelPhase === 'gas') return 'gas_burner_flame';
  return 'solid_flammability';
}

function testMatchesEndpointFilter(test: Test, endpoint: string): boolean {
  if (test.events.some((e) => e.endpoint === endpoint)) return true;
  if (endpoint === 'spread_rate') return test.spreadRateMmS.value !== null;
  if (endpoint === 'burning_rate_constant') return test.burningRateMm2S.value !== null;
  if (endpoint === 'smoke_particle_size') return test.particleSizeNm.value !== null;
  if (endpoint === 'smoke_point_length') return test.smokePointLengthMm.value !== null;
  return false;
}

function scopeModelingTests(
  snap: SavedReviewSnapshot,
  allTests: Test[],
  corpus: CorpusV2,
  params: URLSearchParams,
): Test[] {
  const invParam = params.get('inv')?.trim() ?? '';
  const phaseParam = params.get('fuelPhase')?.trim() ?? '';
  const endpointParam = params.get('endpoint')?.trim() ?? '';
  const familyParam = params.get('family')?.trim() ?? '';
  const scopeParam = params.get('scope')?.trim() ?? '';

  const invById = new Map(corpus.investigations.map((i) => [i.id.toLowerCase(), i]));
  const decisionById = new Map(snap.review.evidencePackage.applicabilityDecisions.map((d) => [d.testId, d]));

  let tests = allTests;
  if (scopeParam === 'admissible') {
    tests = tests.filter((t) => {
      const verdict = decisionById.get(t.testId)?.verdict;
      return verdict === 'admissible' || verdict === 'conditional_support';
    });
  }
  if (invParam) {
    tests = tests.filter((t) => t.inv.toLowerCase() === invParam.toLowerCase());
  }
  if (phaseParam) {
    tests = tests.filter((t) => (t.fuelPhase ?? '').toLowerCase() === phaseParam.toLowerCase());
  }
  if (endpointParam) {
    tests = tests.filter((t) => testMatchesEndpointFilter(t, endpointParam as TargetEndpoint));
  }
  if (familyParam) {
    const famLower = familyParam.toLowerCase();
    tests = tests.filter((t) => {
      const endpointFam = classifyModelingEndpointFamily(t);
      const invFam = (invById.get(t.inv.toLowerCase())?.family ?? '').toLowerCase();
      return endpointFam.toLowerCase() === famLower || invFam === famLower;
    });
  }

  if (tests.length === 0) {
    throw new HttpError(400, 'NO_MATCHING_TESTS', 'No evaluated tests matched the requested modeling_csv export scope.');
  }

  const families = [...new Set(tests.map(classifyModelingEndpointFamily))];
  if (families.length > 1 && scopeParam !== 'explicit') {
    throw new HttpError(
      400,
      'INCOMPATIBLE_ENDPOINTS',
      `Refused merging incompatible modeling endpoint families (${families.join(', ')}) into a single modeling_csv. Scope by ?inv=, ?fuelPhase=, ?endpoint=, ?family=, or pass scope=explicit.`,
    );
  }
  return tests;
}

function sendAttachment(
  res: ServerResponse,
  contentType: string,
  filename: string,
  content: string,
): void {
  setApiHeaders(res);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.end(content);
}

function decodeSegment(raw: string): string {
  try {
    return decodeURIComponent(raw);
  } catch {
    throw new HttpError(400, 'INVALID_URI', 'Malformed URL path parameter.');
  }
}

function assertMethod(method: string, expected: string): void {
  if (method !== expected) {
    throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed; expected ${expected}.`);
  }
}

function snapshotToData(snap: SavedReviewSnapshot, extra: Record<string, unknown> = {}) {
  return {
    reviewId: snap.reviewId,
    title: snap.title,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    revision: snap.revision,
    idempotencyKey: snap.idempotencyKey,
    isDemo: snap.isDemo,
    review: snap.review,
    variants: snap.variants,
    runs: snap.runs,
    ...extra,
  };
}

export function createApiHandler(
  rootDir?: string,
  options: ApiHandlerOptions = {},
): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  const store =
    options.store ??
    new EmberStore({
      rootDir: rootDir ?? options.rootDir,
      storePath: options.storePath,
    });

  async function handleHealth(res: ServerResponse): Promise<void> {
    await store.ensureInitialized();
    const [corpus, index, sourcesMap, reviews] = await Promise.all([
      store.getCorpus(),
      store.getChunksIndex(),
      store.getSourcesMap(),
      store.listReviewSummaries(),
    ]);
    sendOk(
      res,
      200,
      {
        healthy: true,
        service: 'ember-final-api',
        corpusVersion: corpus.corpusVersion,
        engineVersion: ENGINE_VERSION,
        counts: {
          investigations: corpus.investigations.length,
          tests: corpus.tests.length,
          claims: corpus.claims.length,
          chunks: index.chunks.length,
          sources: Math.max(corpus.sources.length, sourcesMap.size),
          savedReviews: reviews.length,
        },
        liveAiConfigured: Boolean(resolveOpenAiApiKey(store.rootDir)),
      },
      { corpusVersion: corpus.corpusVersion },
    );
  }

  async function handleInvestigationsList(res: ServerResponse, params: URLSearchParams): Promise<void> {
    const corpus = await store.getCorpus();
    const filtered = filterInvestigations(corpus.investigations, params);
    sendOk(
      res,
      200,
      { total: filtered.length, investigations: filtered },
      { corpusVersion: corpus.corpusVersion },
    );
  }

  async function handleInvestigationDetail(res: ServerResponse, id: string): Promise<void> {
    const corpus = await store.getCorpus();
    const inv =
      corpus.investigations.find((i) => i.id === id) ??
      corpus.investigations.find((i) => i.id.toLowerCase() === id.toLowerCase());
    if (!inv) {
      throw new HttpError(404, 'NOT_FOUND', `Investigation "${id}" not found.`);
    }
    const tests = corpus.tests.filter((t) => t.inv === inv.id);
    const claims = corpus.claims.filter((c) => c.inv === inv.id);
    sendOk(
      res,
      200,
      {
        investigation: inv,
        coverage: inv.coverageSummary,
        tests,
        claims,
      },
      { corpusVersion: corpus.corpusVersion },
    );
  }

  async function handleSourceDetail(res: ServerResponse, id: string): Promise<void> {
    const corpus = await store.getCorpus();
    const source = await store.getSourceById(id);
    if (!source) {
      throw new HttpError(404, 'NOT_FOUND', `Source "${id}" not found.`);
    }
    sendOk(res, 200, source, { corpusVersion: corpus.corpusVersion });
  }

  async function handleParseQuery(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const corpus = await store.getCorpus();
    const body = await readJsonBody(req);
    const { question, overrides, parserOptions } = validateQuestionAndOverrides(body);
    const query = parseResearchQuery(question, overrides, parserOptions);
    sendOk(res, 200, { query }, { corpusVersion: corpus.corpusVersion });
  }

  async function handleCreateReview(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const [corpus, index] = await Promise.all([store.getCorpus(), store.getChunksIndex()]);
    const body = await readJsonBody(req);
    const { question, overrides, parserOptions } = validateQuestionAndOverrides(body);
    const params = validateReviewParams(body);

    const headerIdem = req.headers['idempotency-key'];
    const headerKey = typeof headerIdem === 'string' && headerIdem.trim() ? headerIdem.trim() : undefined;
    const explicitKey = params.idempotencyKey ?? headerKey;

    const signature = computeReviewSignature({
      question,
      overrides,
      parserOptions,
      retrievalMode: params.retrievalMode,
      budgetRuns: params.budgetRuns,
    });

    if (!params.forceNew) {
      const existing = await store.findIdempotentMatch(explicitKey, signature);
      if (existing) {
        const lastRun = existing.runs[existing.runs.length - 1];
        sendOk(
          res,
          200,
          snapshotToData(existing, {
            runId: lastRun?.runId ?? existing.review.envelope.runId,
            idempotentReplay: true,
          }),
          {
            runId: lastRun?.runId ?? existing.review.envelope.runId,
            mode: existing.review.synthesis.mode,
            corpusVersion: corpus.corpusVersion,
            warnings: lastRun?.warnings ?? [],
          },
        );
        return;
      }
    }

    const warnings: string[] = [];
    const apiKey = params.useLiveAi ? resolveOpenAiApiKey(store.rootDir) : null;
    let review;

    if (params.useLiveAi && !apiKey) {
      warnings.push('OPENAI_API_KEY is not configured on the server; fell back explicitly to DETERMINISTIC_ENGINE.');
      review = runReviewSync({
        question,
        overrides,
        parserOptions,
        corpus,
        index,
        budgetRuns: params.budgetRuns,
        retrievalMode: params.retrievalMode,
        retrievalK: params.retrievalK,
      });
    } else if (params.useLiveAi && apiKey) {
      try {
        review = await runReview({
          question,
          overrides,
          parserOptions,
          corpus,
          index,
          budgetRuns: params.budgetRuns,
          retrievalMode: params.retrievalMode,
          retrievalK: params.retrievalK,
          synthesisMode: 'LIVE_AI',
          apiKey,
          model: params.model,
          fetchImpl: options.fetchImpl,
        });
        if (review.synthesis.mode !== 'LIVE_AI') {
          warnings.push('Live AI synthesis failed or was unreachable; fell back explicitly to DETERMINISTIC_ENGINE.');
        }
      } catch {
        warnings.push('Live AI request failed; fell back explicitly to DETERMINISTIC_ENGINE.');
        review = runReviewSync({
          question,
          overrides,
          parserOptions,
          corpus,
          index,
          budgetRuns: params.budgetRuns,
          retrievalMode: params.retrievalMode,
          retrievalK: params.retrievalK,
        });
      }
    } else {
      review = runReviewSync({
        question,
        overrides,
        parserOptions,
        corpus,
        index,
        budgetRuns: params.budgetRuns,
        retrievalMode: params.retrievalMode,
        retrievalK: params.retrievalK,
      });
    }

    const title = params.title ?? (question.trim() || `${review.query.material ?? 'Custom'} ${review.query.habitableEnvironment}`);
    const { snapshot, run } = await store.saveNewReview({
      review,
      title,
      idempotencyKey: explicitKey,
      requestSignature: signature,
      budgetRuns: params.budgetRuns,
      warnings,
    });

    sendOk(
      res,
      201,
      snapshotToData(snapshot, { runId: run.runId, idempotentReplay: false }),
      {
        runId: run.runId,
        mode: snapshot.review.synthesis.mode,
        corpusVersion: corpus.corpusVersion,
        warnings,
      },
    );
  }

  async function handleVariantCreate(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const corpus = await store.getCorpus();
    const snap = await store.getReview(id);
    if (!snap) {
      throw new HttpError(404, 'NOT_FOUND', `Review "${id}" not found.`);
    }
    const body = await readJsonBody(req);
    const patch = parseVariantPatch(body);
    const result = recalculateDesignVariant(snap.review, patch, corpus);
    const saved = await store.appendVariant(id, patch, result);
    if (!saved) {
      throw new HttpError(404, 'NOT_FOUND', `Review "${id}" not found.`);
    }
    sendOk(
      res,
      200,
      {
        reviewId: saved.snapshot.reviewId,
        revision: saved.snapshot.revision,
        variantId: saved.variant.variantId,
        createdAt: saved.variant.createdAt,
        ...result,
      },
      {
        runId: saved.snapshot.runs.at(-1)?.runId ?? saved.snapshot.review.envelope.runId,
        mode: saved.snapshot.review.synthesis.mode,
        corpusVersion: corpus.corpusVersion,
      },
    );
  }

  async function handleTestProgrammeUpdate(req: IncomingMessage, res: ServerResponse, id: string): Promise<void> {
    const corpus = await store.getCorpus();
    const snap = await store.getReview(id);
    if (!snap) {
      throw new HttpError(404, 'NOT_FOUND', `Review "${id}" not found.`);
    }
    const body = await readJsonBody(req);
    if (
      typeof body.budgetRuns !== 'number' ||
      !Number.isFinite(body.budgetRuns) ||
      body.budgetRuns < 0 ||
      body.budgetRuns > 500
    ) {
      throw new HttpError(400, 'INVALID_BUDGET', 'budgetRuns must be a finite number between 0 and 500.');
    }

    const candidates = generateCandidateBlocks(snap.review.evidencePackage);
    const testProgramme = optimizeTestProgramme(candidates, Math.floor(body.budgetRuns));
    const updated = await store.updateTestProgramme(id, testProgramme);
    if (!updated) {
      throw new HttpError(404, 'NOT_FOUND', `Review "${id}" not found.`);
    }

    sendOk(
      res,
      200,
      {
        reviewId: updated.reviewId,
        revision: updated.revision,
        testProgramme,
        candidates,
      },
      {
        runId: updated.runs.at(-1)?.runId ?? updated.review.envelope.runId,
        mode: updated.review.synthesis.mode,
        corpusVersion: corpus.corpusVersion,
      },
    );
  }

  async function handleExport(res: ServerResponse, id: string, params: URLSearchParams): Promise<void> {
    const corpus = await store.getCorpus();
    const snap = await store.getReview(id);
    if (!snap) {
      throw new HttpError(404, 'NOT_FOUND', `Review "${id}" not found.`);
    }

    const format = (params.get('format') ?? 'json').trim();
    if (!VALID_EXPORT_FORMATS.has(format)) {
      throw new HttpError(400, 'INVALID_FORMAT', 'format must be one of markdown, json, csv, modeling_csv.');
    }

    const safeId = id.replace(/[^a-zA-Z0-9_-]+/g, '_');
    if (format === 'markdown') {
      sendAttachment(res, 'text/markdown; charset=utf-8', `ember-${safeId}.md`, exportFormatters.markdown(snap.review));
      return;
    }
    if (format === 'json') {
      sendAttachment(res, 'application/json; charset=utf-8', `ember-${safeId}.json`, exportFormatters.json(snap.review));
      return;
    }

    const evaluatedTests = store.getEvaluatedTestsForReview(snap, corpus);
    if (format === 'csv') {
      const content = exportFormatters.csv(evaluatedTests, corpus.investigations);
      sendAttachment(res, 'text/csv; charset=utf-8', `ember-${safeId}.csv`, content);
      return;
    }

    const scopedTests = scopeModelingTests(snap, evaluatedTests, corpus, params);
    const content = exportFormatters.modeling_csv(scopedTests, corpus.investigations);
    sendAttachment(res, 'text/csv; charset=utf-8', `ember-${safeId}-modeling.csv`, content);
  }

  async function dispatch(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method === 'OPTIONS') {
      setApiHeaders(res);
      res.statusCode = 204;
      res.end();
      return;
    }

    const parsedUrl = new URL(req.url ?? '/', 'http://localhost');
    const rawPath = parsedUrl.pathname;
    const path = rawPath.length > 1 && rawPath.endsWith('/') ? rawPath.slice(0, -1) : rawPath;
    const params = parsedUrl.searchParams;

    if (path === '/api/health') {
      assertMethod(method, 'GET');
      await handleHealth(res);
      return;
    }
    if (path === '/api/investigations') {
      assertMethod(method, 'GET');
      await handleInvestigationsList(res, params);
      return;
    }
    if (path === '/api/queries/parse') {
      assertMethod(method, 'POST');
      await handleParseQuery(req, res);
      return;
    }
    if (path === '/api/evaluation') {
      assertMethod(method, 'GET');
      const corpus = await store.getCorpus();
      const report = await store.getEvaluationReport();
      sendOk(res, 200, report, { corpusVersion: corpus.corpusVersion });
      return;
    }
    if (path === '/api/reviews') {
      if (method === 'GET') {
        const corpus = await store.getCorpus();
        const reviews = await store.listReviewSummaries();
        sendOk(res, 200, { total: reviews.length, reviews }, { corpusVersion: corpus.corpusVersion });
        return;
      }
      if (method === 'POST') {
        await handleCreateReview(req, res);
        return;
      }
      throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Method ${method} not allowed on /api/reviews.`);
    }

    const invMatch = path.match(/^\/api\/investigations\/([^/]+)$/);
    if (invMatch) {
      assertMethod(method, 'GET');
      await handleInvestigationDetail(res, decodeSegment(invMatch[1]));
      return;
    }

    const srcMatch = path.match(/^\/api\/sources\/([^/]+)$/);
    if (srcMatch) {
      assertMethod(method, 'GET');
      await handleSourceDetail(res, decodeSegment(srcMatch[1]));
      return;
    }

    const runMatch = path.match(/^\/api\/runs\/([^/]+)$/);
    if (runMatch) {
      assertMethod(method, 'GET');
      const corpus = await store.getCorpus();
      const run = await store.getRun(decodeSegment(runMatch[1]));
      if (!run) throw new HttpError(404, 'NOT_FOUND', 'Run not found.');
      sendOk(res, 200, run, { runId: run.runId, mode: run.mode, corpusVersion: corpus.corpusVersion, warnings: run.warnings });
      return;
    }

    const varMatch = path.match(/^\/api\/reviews\/([^/]+)\/variants$/);
    if (varMatch) {
      assertMethod(method, 'POST');
      await handleVariantCreate(req, res, decodeSegment(varMatch[1]));
      return;
    }

    const progMatch = path.match(/^\/api\/reviews\/([^/]+)\/test-programmes$/);
    if (progMatch) {
      assertMethod(method, 'POST');
      await handleTestProgrammeUpdate(req, res, decodeSegment(progMatch[1]));
      return;
    }

    const expMatch = path.match(/^\/api\/reviews\/([^/]+)\/export$/);
    if (expMatch) {
      assertMethod(method, 'GET');
      await handleExport(res, decodeSegment(expMatch[1]), params);
      return;
    }

    const revMatch = path.match(/^\/api\/reviews\/([^/]+)$/);
    if (revMatch) {
      assertMethod(method, 'GET');
      const corpus = await store.getCorpus();
      const snap = await store.getReview(decodeSegment(revMatch[1]));
      if (!snap) throw new HttpError(404, 'NOT_FOUND', 'Review not found.');
      const lastRun = snap.runs[snap.runs.length - 1];
      sendOk(
        res,
        200,
        snapshotToData(snap),
        {
          runId: lastRun?.runId ?? snap.review.envelope.runId,
          mode: snap.review.synthesis.mode,
          corpusVersion: corpus.corpusVersion,
          warnings: lastRun?.warnings ?? [],
        },
      );
      return;
    }

    throw new HttpError(404, 'NOT_FOUND', `Unknown API route "${path}".`);
  }

  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await dispatch(req, res);
    } catch (err) {
      if (res.headersSent) return;
      if (err instanceof HttpError) {
        sendError(res, err.statusCode, err.code, err.message);
        return;
      }
      sendError(
        res,
        500,
        'INTERNAL_ERROR',
        err instanceof Error ? err.message : 'Unexpected server error.',
      );
    }
  };
}

export function emberApiPlugin(options: ApiHandlerOptions = {}): Plugin {
  const apiHandler = createApiHandler(options.rootDir, options);

  const registerMiddleware = (middlewares: Connect.Server): void => {
    middlewares.use((req, res, next) => {
      const pathname = (req.url ?? '/').split('?')[0];
      if (pathname !== '/api' && !pathname.startsWith('/api/')) {
        next();
        return;
      }
      void apiHandler(req, res).catch((err) => {
        if (!res.headersSent) {
          sendError(
            res,
            500,
            'INTERNAL_ERROR',
            err instanceof Error ? err.message : 'Unhandled API middleware error.',
          );
        }
      });
    });
  };

  return {
    name: 'ember-api-plugin',
    configureServer(server) {
      registerMiddleware(server.middlewares);
    },
    configurePreviewServer(server) {
      registerMiddleware(server.middlewares);
    },
  };
}
