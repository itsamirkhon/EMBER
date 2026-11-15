import {currentEvaluation} from '../core/evaluationVersion';
import { readSseData, type ReviewProgress } from '../core/reviewStream';
import {
  ENGINE_VERSION,
  exportFormatters,
  generateCandidateBlocks,
  JEV_PROMPT_VERSION,
  optimizeTestProgramme,
  parseResearchQuery,
  recalculateDesignVariant,
  registerReviewCorpus,
  runReviewSync,
  type ChunksIndex,
  type CorpusV2,
  type DesignVariantPatch,
  type DesignVariantResult,
  type Investigation,
  type ResearchQuery,
  type RetrievalMode,
  type Review,
  type SourceRecord,
  type SynthesisMode,
  type Test,
  type TestProgramme,
} from '../core';

export interface ApiEnvelope<T> {
  run_id: string;
  status: 'ok' | 'error';
  mode: SynthesisMode | string;
  versions: {
    corpus: string;
    rules: string;
    engine: string;
    jevPrompt: string;
    code?: string;
  };
  warnings: string[];
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}

export interface SourceDetail extends SourceRecord {
  inv: string[];
  label: string | null;
  year: string | number | null;
  text: string | null;
  hasFullText: boolean;
}

export interface SavedVariantRecord {
  variantId: string;
  createdAt: string;
  patch: DesignVariantPatch;
  result: DesignVariantResult;
}

export interface RunStageSummary {
  name: string;
  status: 'completed' | 'failed';
  durationMs: number;
}

export interface RunRecord {
  runId: string;
  reviewId: string;
  status: 'completed' | 'failed';
  mode: SynthesisMode;
  retrievalMode: RetrievalMode;
  budgetRuns: number;
  createdAt: string;
  completedAt: string;
  stages: RunStageSummary[];
  timingMs: Review['envelope']['timingMs'];
  warnings: string[];
}

export interface SavedReviewSnapshot {
  reviewId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  revision: number;
  idempotencyKey: string;
  requestSignature: string;
  isDemo: boolean;
  review: Review;
  evaluatedTestIds?: string[];
  variants: SavedVariantRecord[];
  runs: RunRecord[];
}

export interface ReviewSummary {
  reviewId: string;
  title: string;
  question: string;
  mode: SynthesisMode;
  answerBoundary: Review['synthesis']['answerBoundary'];
  isDemo: boolean;
  revision: number;
  variantCount: number;
  createdAt: string;
  updatedAt: string;
  idempotencyKey: string;
  lastRunId: string | null;
}

export interface InvestigationDetailData {
  investigation: Investigation;
  tests: Test[];
  claims: CorpusV2['claims'];
}

export interface CreateReviewParams {
  question: string;
  overrides?: Partial<ResearchQuery>;
  budgetRuns?: number;
  retrievalMode?: RetrievalMode;
  useLiveAi?: boolean;
  forceNew?: boolean;
  idempotencyKey?: string;
  title?: string;
}

export interface ClientMeta {
  backendSource: 'node_api' | 'static_fallback';
  warnings: string[];
}

const STORAGE_KEY = 'ember_v2_static_reviews_v1';

const DEMO_SPECS: Array<{
  reviewId: string;
  title: string;
  question: string;
  overrides: Partial<ResearchQuery>;
  budgetRuns: number;
}> = [
  {
    reviewId: 'demo-pmma-lunar',
    title: 'PMMA Flame Spread & Flow-Reduction Extinction: Lunar Rover vs ISS BASS-II',
    question:
      'PMMA flame establishment, sustained spread, and extinction under flow reduction in oxygen-enriched lunar rover 30% O2 / 70.3 kPa, 5 cm/s concurrent flow vs ISS BASS-II',
    overrides: {
      habitableEnvironment: 'lunar_rover',
      o2Pct: 30,
      pressureKpa: 70.3,
      flowCmS: 5,
      flowDirection: 'concurrent',
      gravityG: 0.166,
      gravityRegime: 'partial_gravity',
      material: 'PMMA',
      fuelPhase: 'solid',
      targetEndpoint: 'extinction_under_flow_change',
      enclosureScale: 'large_enclosure',
    },
    budgetRuns: 10,
  },
  {
    reviewId: 'demo-cool-flame',
    title: 'Droplet Hot Extinction vs Continued Cool-Flame Burning (CFI / FLEX)',
    question: 'Droplet hot extinction vs continued cool-flame burning (CFI / FLEX n-dodecane & n-heptane).',
    overrides: {
      fuelPhase: 'liquid',
      material: 'n-dodecane',
      geometry: 'droplet',
      targetEndpoint: 'cool_flame_continuation',
      targetInvIds: ['CFI', 'FLEX'],
    },
    budgetRuns: 10,
  },
];

let cachedCorpusPromise: Promise<CorpusV2> | null = null;
let cachedIndexPromise: Promise<ChunksIndex> | null = null;
let lastBackendMode: ClientMeta['backendSource'] = 'node_api';

export function getLastBackendSource(): ClientMeta['backendSource'] {
  return lastBackendMode;
}

export async function loadStaticCorpus(): Promise<CorpusV2> {
  if (!cachedCorpusPromise) {
    cachedCorpusPromise = fetch('./data/corpus_v2.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load static corpus (${res.status})`);
        const data = await res.json() as CorpusV2;
        if (!Array.isArray(data.tests) || !Array.isArray(data.investigations) || !data.corpusVersion) {
          throw new Error('Static PSI corpus is missing required scientific data fields.');
        }
        return data;
      })
      .catch((error: unknown) => {
        cachedCorpusPromise = null; // allow recovery after a transient or malformed response
        throw error;
      });
  }
  return cachedCorpusPromise;
}

export async function loadStaticChunksIndex(): Promise<ChunksIndex> {
  if (!cachedIndexPromise) {
    cachedIndexPromise = fetch('./data/chunks_index.json')
      .then(async (res) => {
        if (!res.ok) throw new Error(`Failed to load static chunks index (${res.status})`);
        const data = await res.json() as ChunksIndex;
        if (!data.corpusVersion || !Array.isArray(data.chunks)) {
          throw new Error('Static chunks index is missing required fields.');
        }
        return data;
      })
      .catch((error: unknown) => {
        cachedIndexPromise = null;
        throw error;
      });
  }
  return cachedIndexPromise;
}

class ApiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ApiUnavailableError';
  }
}

async function fetchApiJson<T>(url: string, init?: RequestInit): Promise<ApiEnvelope<T>> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...(init?.headers ?? {}),
      },
    });
  } catch (err) {
    if (init?.signal?.aborted) throw err;
    throw new ApiUnavailableError(err instanceof Error ? err.message : 'Network error');
  }

  const contentType = response.headers.get('content-type') ?? '';
  if (response.status === 404 || response.status === 405 || !contentType.includes('application/json')) {
    throw new ApiUnavailableError(`API unavailable (${response.status})`);
  }

  const payload = (await response.json()) as ApiEnvelope<T>;
  if (!response.ok || payload.status === 'error') {
    throw new Error(payload.error?.message ?? `Request failed (${response.status})`);
  }
  lastBackendMode = 'node_api';
  return payload;
}

function readLocalStore(): Record<string, SavedReviewSnapshot> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, SavedReviewSnapshot>;
  } catch {
    return {};
  }
}

function writeLocalStore(store: Record<string, SavedReviewSnapshot>): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ignore storage quota issues in static preview
  }
}

function stripHeavyEvaluatedTests(review: Review): { compact: Review; testIds: string[] } {
  const testIds = (review.evidencePackage.evaluatedTests ?? []).map((t) => t.testId);
  return {
    compact: {
      ...review,
      evidencePackage: {
        ...review.evidencePackage,
        evaluatedTests: undefined,
      },
    },
    testIds,
  };
}

function toSummary(snap: SavedReviewSnapshot): ReviewSummary {
  const lastRun = snap.runs[snap.runs.length - 1];
  return {
    reviewId: snap.reviewId,
    title: snap.title,
    question: snap.review.query.rawQuestion,
    mode: snap.review.synthesis.mode,
    answerBoundary: snap.review.synthesis.answerBoundary,
    isDemo: snap.isDemo,
    revision: snap.revision,
    variantCount: snap.variants.length,
    createdAt: snap.createdAt,
    updatedAt: snap.updatedAt,
    idempotencyKey: snap.idempotencyKey,
    lastRunId: lastRun ? lastRun.runId : snap.review.envelope.runId,
  };
}

function reviewMatchesCurrentVersion(review: Review, corpus: CorpusV2): boolean {
  return review.envelope.engineVersion === ENGINE_VERSION && review.envelope.corpusVersion === corpus.corpusVersion;
}

function requireCurrentReview(review: Review, corpus: CorpusV2): void {
  if (!reviewMatchesCurrentVersion(review, corpus)) {
    throw new Error('Archived historical review uses another engine/corpus version. Create a new review before recomputing or exporting current-corpus measurements.');
  }
}

async function ensureStaticDemos(): Promise<Record<string, SavedReviewSnapshot>> {
  const store = readLocalStore();
  const corpus = await loadStaticCorpus();
  let changed = false;
  for (const demo of DEMO_SPECS) {
    if (store[demo.reviewId]?.isDemo && !reviewMatchesCurrentVersion(store[demo.reviewId].review, corpus)) {
      delete store[demo.reviewId];
      changed = true;
    }
  }
  if (changed) writeLocalStore(store);
  return store;
}

async function computeSnapshotFromSpec(spec: {
  reviewId: string;
  title: string;
  question: string;
  overrides?: Partial<ResearchQuery>;
  budgetRuns: number;
  retrievalMode?: RetrievalMode;
  isDemo: boolean;
  synthesisMode: SynthesisMode;
  idempotencyKey: string;
}): Promise<SavedReviewSnapshot> {
  const [corpus, index] = await Promise.all([loadStaticCorpus(), loadStaticChunksIndex()]);
  const review = runReviewSync({
    question: spec.question,
    overrides: spec.overrides,
    corpus,
    index,
    budgetRuns: spec.budgetRuns,
    retrievalMode: spec.retrievalMode ?? 'hybrid',
    synthesisMode: spec.synthesisMode,
  });
  const now = new Date().toISOString();
  const { compact, testIds } = stripHeavyEvaluatedTests(review);
  const runRecord: RunRecord = {
    runId: review.envelope.runId,
    reviewId: spec.reviewId,
    status: 'completed',
    mode: review.synthesis.mode,
    retrievalMode: review.envelope.retrievalMode,
    budgetRuns: spec.budgetRuns,
    createdAt: now,
    completedAt: now,
    stages: [
      { name: 'parse', status: 'completed', durationMs: review.envelope.timingMs.parse },
      { name: 'retrieve', status: 'completed', durationMs: review.envelope.timingMs.retrieve },
      { name: 'jev', status: 'completed', durationMs: review.envelope.timingMs.jev },
      { name: 'applicability', status: 'completed', durationMs: review.envelope.timingMs.applicability },
      { name: 'synthesis', status: 'completed', durationMs: review.envelope.timingMs.synthesis },
      { name: 'verify', status: 'completed', durationMs: review.envelope.timingMs.verify },
      { name: 'plan', status: 'completed', durationMs: review.envelope.timingMs.plan },
      { name: 'predict', status: 'completed', durationMs: review.envelope.timingMs.predict },
    ],
    timingMs: review.envelope.timingMs,
    warnings: [],
  };

  return {
    reviewId: spec.reviewId,
    title: spec.title,
    createdAt: now,
    updatedAt: now,
    revision: 1,
    idempotencyKey: spec.idempotencyKey,
    requestSignature: `${spec.question}|${JSON.stringify(spec.overrides ?? {})}`,
    isDemo: spec.isDemo,
    review: compact,
    evaluatedTestIds: testIds,
    variants: [],
    runs: [runRecord],
  };
}

export async function parseQuery(
  question: string,
  overrides?: Partial<ResearchQuery>,
): Promise<{ query: ResearchQuery; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<{ query: ResearchQuery } | ResearchQuery>('/api/queries/parse', {
      method: 'POST',
      body: JSON.stringify({ question, overrides }),
    });
    const raw = env.data;
    const query = raw && typeof raw === 'object' && 'query' in raw ? raw.query : (raw as ResearchQuery);
    return { query, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    return {
      query: parseResearchQuery(question, overrides),
      meta: { backendSource: 'static_fallback', warnings: [] },
    };
  }
}

export async function getInvestigations(filters?: {
  direction?: string;
  fuelPhase?: string;
  q?: string;
}): Promise<{ investigations: Investigation[]; meta: ClientMeta }> {
  const qs = new URLSearchParams();
  if (filters?.direction) qs.set('direction', filters.direction);
  if (filters?.fuelPhase) qs.set('fuelPhase', filters.fuelPhase);
  if (filters?.q) qs.set('q', filters.q);
  const suffix = qs.toString() ? `?${qs.toString()}` : '';

  try {
    const env = await fetchApiJson<{ investigations: Investigation[] } | Investigation[]>(`/api/investigations${suffix}`);
    const list = Array.isArray(env.data) ? env.data : env.data?.investigations ?? [];
    return { investigations: list, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const corpus = await loadStaticCorpus();
    let list = corpus.investigations;
    if (filters?.direction) {
      list = list.filter((i) => i.direction.includes(filters.direction as Investigation['direction'][number]));
    }
    if (filters?.fuelPhase) {
      list = list.filter((i) => i.fuelPhase === filters.fuelPhase);
    }
    if (filters?.q) {
      const needle = filters.q.toLowerCase();
      list = list.filter(
        (i) =>
          i.id.toLowerCase().includes(needle) ||
          i.name.toLowerCase().includes(needle) ||
          (i.objective ?? '').toLowerCase().includes(needle) ||
          (i.fuel?.types ?? []).some((f) => f.toLowerCase().includes(needle)),
      );
    }
    return { investigations: list, meta: { backendSource: 'static_fallback', warnings: [] } };
  }
}

export async function getInvestigationDetail(
  id: string,
): Promise<{ detail: InvestigationDetailData; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<{
      investigation: Investigation;
      tests: Test[];
      claims?: CorpusV2['claims'];
    }>(`/api/investigations/${encodeURIComponent(id)}`);
    if (!env.data?.investigation) throw new Error(`Investigation ${id} not found`);
    let claims = env.data.claims;
    if (!claims) {
      const corpus = await loadStaticCorpus();
      claims = corpus.claims.filter((c) => c.inv === id);
    }
    return {
      detail: {
        investigation: env.data.investigation,
        tests: env.data.tests ?? [],
        claims,
      },
      meta: { backendSource: 'node_api', warnings: env.warnings },
    };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const corpus = await loadStaticCorpus();
    const inv = corpus.investigations.find((i) => i.id.toLowerCase() === id.toLowerCase());
    if (!inv) throw new Error(`Investigation ${id} not found in static corpus.`);
    return {
      detail: {
        investigation: inv,
        tests: corpus.tests.filter((t) => t.inv === inv.id),
        claims: corpus.claims.filter((c) => c.inv === inv.id),
      },
      meta: { backendSource: 'static_fallback', warnings: [] },
    };
  }
}

export async function getSourceDetail(sourceId: string): Promise<{ source: SourceDetail; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<SourceDetail>(`/api/sources/${encodeURIComponent(sourceId)}`);
    if (!env.data) throw new Error(`Source ${sourceId} unavailable`);
    return { source: env.data, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const corpus = await loadStaticCorpus();
    const rec = corpus.sources.find((s) => s.sourceId === sourceId);
    const linkedInvs = corpus.investigations
      .filter((i) => i.sources.some((s) => s.id === sourceId || s.url === rec?.url))
      .map((i) => i.id);
    const linkMatch = corpus.investigations.flatMap((i) => i.sources).find((s) => s.id === sourceId);

    const detail: SourceDetail = {
      sourceId,
      title: rec?.title ?? linkMatch?.label ?? sourceId,
      url: rec?.url ?? linkMatch?.url ?? null,
      doi: rec?.doi ?? null,
      type: rec?.type ?? linkMatch?.type ?? 'citation',
      fileHash: rec?.fileHash ?? null,
      notes: rec?.notes ?? null,
      inv: linkedInvs,
      label: linkMatch?.label ?? rec?.title ?? sourceId,
      year: null,
      text: null,
      hasFullText: false,
    };
    return {
      source: detail,
      meta: {
        backendSource: 'static_fallback',
        warnings: ['Running in static offline mode: full cached source text requires the Node API server; showing corpus source metadata & links.'],
      },
    };
  }
}

export async function listReviews(): Promise<{ reviews: ReviewSummary[]; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<{ reviews: ReviewSummary[] } | ReviewSummary[]>('/api/reviews');
    const reviews = Array.isArray(env.data) ? env.data : env.data?.reviews ?? [];
    return { reviews, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const store = await ensureStaticDemos();
    for (const demo of DEMO_SPECS) {
      if (!store[demo.reviewId]) {
        const snap = await computeSnapshotFromSpec({
          ...demo,
          isDemo: true,
          synthesisMode: 'SAVED_DEMO_SNAPSHOT',
          idempotencyKey: demo.reviewId,
        });
        store[demo.reviewId] = snap;
      }
    }
    writeLocalStore(store);
    const reviews = Object.values(store)
      .sort((a, b) => Number(b.isDemo) - Number(a.isDemo) || b.updatedAt.localeCompare(a.updatedAt))
      .map(toSummary);
    return { reviews, meta: { backendSource: 'static_fallback', warnings: [] } };
  }
}

export async function getReviewSnapshot(reviewId: string): Promise<{ snapshot: SavedReviewSnapshot; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<SavedReviewSnapshot>(`/api/reviews/${encodeURIComponent(reviewId)}`);
    if (!env.data) throw new Error(`Review ${reviewId} not found`);
    return { snapshot: env.data, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const store = await ensureStaticDemos();
    if (store[reviewId]) {
      const corpus = await loadStaticCorpus();
      const warnings = reviewMatchesCurrentVersion(store[reviewId].review, corpus) ? [] : ['Archived historical review: original engine/corpus differs from the current version; conclusions are preserved without current experimental records.'];
      return { snapshot: store[reviewId], meta: { backendSource: 'static_fallback', warnings } };
    }
    const demo = DEMO_SPECS.find((d) => d.reviewId === reviewId);
    if (!demo) throw new Error(`Review ${reviewId} not found.`);
    const snap = await computeSnapshotFromSpec({
      ...demo,
      isDemo: true,
      synthesisMode: 'SAVED_DEMO_SNAPSHOT',
      idempotencyKey: demo.reviewId,
    });
    store[demo.reviewId] = snap;
    writeLocalStore(store);
    return { snapshot: snap, meta: { backendSource: 'static_fallback', warnings: [] } };
  }
}

export async function createReview(params: CreateReviewParams, onProgress?: (event: ReviewProgress) => void, signal?: AbortSignal): Promise<{ snapshot: SavedReviewSnapshot; meta: ClientMeta }> {
  try {
    let env: ApiEnvelope<SavedReviewSnapshot>;
    if (onProgress) {
      let response: Response;
      try {
        response = await fetch('/api/reviews', { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json' }, body: JSON.stringify(params), signal });
      } catch (error) {
        if (signal?.aborted) throw error;
        throw new ApiUnavailableError('Review API is unreachable');
      }
      const contentType = response.headers.get('content-type') ?? '';
      if ([404, 405].includes(response.status) || (!contentType.includes('application/json') && !contentType.includes('text/event-stream'))) throw new ApiUnavailableError('Streaming API unavailable');
      if (contentType.includes('text/event-stream')) {
        if (!response.ok || !response.body) throw new Error('Could not start the review stream');
        let result: ApiEnvelope<SavedReviewSnapshot> | undefined;
        for await (const data of readSseData(response.body)) {
          const event = JSON.parse(data);
          if (event.type === 'error') throw new Error(event.message ?? 'Review stream interrupted');
          if (event.type === 'result') result = event.envelope;
          else if (event.type === 'stage' || event.type === 'claim') onProgress(event);
        }
        if (!result) throw new Error('Review stream interrupted before the final checks completed. Please retry.');
        env = result;
      } else {
        // Older API servers still return a complete JSON envelope.
        env = await response.json();
      }
      if (env.status === 'error') throw new Error(env.error?.message ?? 'Review failed');
      lastBackendMode = 'node_api';
    } else {
      env = await fetchApiJson<SavedReviewSnapshot>('/api/reviews', {
        method: 'POST',
        body: JSON.stringify(params),
        signal,
      });
    }
    if (!env.data) throw new Error('Empty response from /api/reviews');
    return { snapshot: env.data, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const warnings: string[] = [];
    if (params.useLiveAi) {
      warnings.push('Static offline mode: Node AI proxy is unreachable. Executed DETERMINISTIC_ENGINE in-browser instead.');
    }
    const reviewId = `rev-${Date.now().toString(36)}`;
    const snap = await computeSnapshotFromSpec({
      reviewId,
      title: params.title ?? (params.question.slice(0, 72) || 'Untitled EMBER Review'),
      question: params.question,
      overrides: params.overrides,
      budgetRuns: params.budgetRuns ?? 10,
      retrievalMode: params.retrievalMode ?? 'hybrid',
      isDemo: false,
      synthesisMode: 'DETERMINISTIC_ENGINE',
      idempotencyKey: params.idempotencyKey ?? reviewId,
    });
    const store = readLocalStore();
    store[reviewId] = snap;
    writeLocalStore(store);
    return { snapshot: snap, meta: { backendSource: 'static_fallback', warnings } };
  }
}

export async function applyDesignVariant(
  reviewId: string,
  patch: DesignVariantPatch,
  localReview?: Review,
): Promise<{ result: DesignVariantResult; snapshot?: SavedReviewSnapshot; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<{ variant?: SavedVariantRecord; result?: DesignVariantResult; snapshot?: SavedReviewSnapshot } & Partial<DesignVariantResult>>(
      `/api/reviews/${encodeURIComponent(reviewId)}/variants`,
      {
        method: 'POST',
        body: JSON.stringify({ patch }),
      },
    );
    const data = env.data;
    const result = data?.result ?? data?.variant?.result ?? (data as DesignVariantResult);
    return { result, snapshot: data?.snapshot, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    const corpus = await loadStaticCorpus();
    let baseReview = localReview;
    const store = readLocalStore();
    if (!baseReview && store[reviewId]) {
      baseReview = store[reviewId].review;
    }
    if (!baseReview) {
      const snap = (await getReviewSnapshot(reviewId)).snapshot;
      baseReview = snap.review;
    }
    requireCurrentReview(baseReview, corpus);
    registerReviewCorpus(baseReview, corpus);
    const result = recalculateDesignVariant(baseReview, patch, corpus);
    if (store[reviewId]) {
      store[reviewId] = {
        ...store[reviewId],
        updatedAt: new Date().toISOString(),
        revision: store[reviewId].revision + 1,
        variants: [
          ...store[reviewId].variants,
          {
            variantId: `var-${Date.now().toString(36)}`,
            createdAt: new Date().toISOString(),
            patch,
            result,
          },
        ],
      };
      writeLocalStore(store);
    }
    return { result, snapshot: store[reviewId], meta: { backendSource: 'static_fallback', warnings: [] } };
  }
}

export async function recalculateTestProgramme(
  reviewId: string,
  budgetRuns: number,
  localReview?: Review,
): Promise<{ testProgramme: TestProgramme; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<{ testProgramme?: TestProgramme } & Partial<TestProgramme>>(
      `/api/reviews/${encodeURIComponent(reviewId)}/test-programmes`,
      {
        method: 'POST',
        body: JSON.stringify({ budgetRuns }),
      },
    );
    const tp = env.data?.testProgramme ?? (env.data as TestProgramme);
    return { testProgramme: tp, meta: { backendSource: 'node_api', warnings: env.warnings } };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    let review = localReview;
    if (!review) {
      review = (await getReviewSnapshot(reviewId)).snapshot.review;
    }
    requireCurrentReview(review, await loadStaticCorpus());
    const candidates = generateCandidateBlocks(review.evidencePackage);
    const testProgramme = optimizeTestProgramme(candidates, budgetRuns);
    const store = readLocalStore();
    if (store[reviewId]) {
      store[reviewId] = {
        ...store[reviewId],
        updatedAt: new Date().toISOString(),
        review: { ...store[reviewId].review, testProgramme },
      };
      writeLocalStore(store);
    }
    return { testProgramme, meta: { backendSource: 'static_fallback', warnings: [] } };
  }
}

export interface ModelingExportScope {
  fuelPhase: 'solid' | 'liquid' | 'gas';
  endpoint:
    | 'spread_rate'
    | 'burning_rate_constant'
    | 'smoke_particle_size'
    | 'smoke_point_length';
}

function testMatchesModelingScope(t: Test, scope: ModelingExportScope): boolean {
  if ((t.fuelPhase ?? '').toLowerCase() !== scope.fuelPhase) return false;
  if (t.events.some((e) => e.endpoint === scope.endpoint)) return true;
  if (scope.endpoint === 'spread_rate') return t.spreadRateMmS.value !== null;
  if (scope.endpoint === 'burning_rate_constant') return t.burningRateMm2S.value !== null;
  if (scope.endpoint === 'smoke_particle_size') return t.particleSizeNm.value !== null;
  if (scope.endpoint === 'smoke_point_length') return t.smokePointLengthMm.value !== null;
  return false;
}

/**
 * The complete NASA PSI corpus is a static asset and does not depend on a saved
 * review or the Node API. Keep exports working on Lightsail's static frontend.
 */
export async function exportCorpusText(
  format: 'json' | 'csv' | 'modeling_csv',
  modelingScope?: ModelingExportScope,
): Promise<{ content: string; filename: string; mimeType: string }> {
  const corpus = await loadStaticCorpus();
  const version = corpus.corpusVersion.replace(/[^a-zA-Z0-9._-]/g, '_');
  const ext = format === 'json' ? 'json' : 'csv';
  const filename = `ember-psi-${version}-${format}.${ext}`;
  const mimeType = format === 'json' ? 'application/json;charset=utf-8' : 'text/csv;charset=utf-8';

  if (format === 'json') {
    return { content: JSON.stringify(corpus, null, 2), filename, mimeType };
  }
  if (format === 'csv') {
    return { content: exportFormatters.csv(corpus.tests, corpus.investigations), filename, mimeType };
  }
  if (!modelingScope) {
    throw new Error('Select a compatible fuel phase and target endpoint for Modeling CSV.');
  }
  const tests = corpus.tests.filter((test) => testMatchesModelingScope(test, modelingScope));
  if (tests.length === 0) {
    throw new Error(`No recorded tests match ${modelingScope.fuelPhase} / ${modelingScope.endpoint}.`);
  }
  return {
    content: exportFormatters.modeling_csv(tests, corpus.investigations),
    filename,
    mimeType,
  };
}

export async function exportReviewText(
  reviewId: string,
  format: 'markdown' | 'json' | 'csv' | 'modeling_csv',
  localReview?: Review,
  modelingScope?: ModelingExportScope,
): Promise<{ content: string; filename: string; mimeType: string }> {
  const ext = format === 'markdown' ? 'md' : format === 'json' ? 'json' : 'csv';
  const filename = `ember-${reviewId}-${format}.${ext}`;
  const mimeType =
    format === 'markdown'
      ? 'text/markdown;charset=utf-8'
      : format === 'json'
        ? 'application/json;charset=utf-8'
        : 'text/csv;charset=utf-8';

  const qs = new URLSearchParams({ format });
  if (format === 'modeling_csv' && modelingScope) {
    qs.set('fuelPhase', modelingScope.fuelPhase);
    qs.set('endpoint', modelingScope.endpoint);
  }

  const generateLocally = async (review: Review) => {
    if (format === 'markdown') return { content: exportFormatters.markdown(review), filename, mimeType };
    if (format === 'json') return { content: exportFormatters.json(review), filename, mimeType };

    const corpus = await loadStaticCorpus();
    requireCurrentReview(review, corpus);
    const ids = new Set(review.evidencePackage.applicabilityDecisions.map((decision) => decision.testId));
    const evaluated = corpus.tests.filter((test) => ids.has(test.testId));
    const scopedTests = evaluated.length > 0 ? evaluated : corpus.tests;

    if (format === 'csv') {
      return { content: exportFormatters.csv(scopedTests, corpus.investigations), filename, mimeType };
    }

    if (!modelingScope) {
      throw new Error('Select a compatible fuel phase and target endpoint for Modeling CSV.');
    }
    const matching = scopedTests.filter((test) => testMatchesModelingScope(test, modelingScope));
    const fallback = matching.length > 0
      ? matching
      : corpus.tests.filter((test) => testMatchesModelingScope(test, modelingScope));
    if (fallback.length === 0) {
      throw new Error(`No recorded tests match ${modelingScope.fuelPhase} / ${modelingScope.endpoint}.`);
    }
    return {
      content: exportFormatters.modeling_csv(fallback, corpus.investigations),
      filename,
      mimeType,
    };
  };

  // The page already holds the exact reviewed snapshot. Generate from that
  // snapshot instead of requesting a route that a static host may rewrite to
  // the SPA HTML entrypoint with status 200.
  if (localReview) return generateLocally(localReview);

  try {
    let res: Response;
    try {
      res = await fetch(`/api/reviews/${encodeURIComponent(reviewId)}/export?${qs.toString()}`);
    } catch {
      throw new ApiUnavailableError('Review export API not reachable');
    }
    const contentType = (res.headers.get('content-type') ?? '').toLowerCase();
    if (res.status === 404 || res.status === 405 || contentType.includes('text/html')) {
      throw new ApiUnavailableError('Export API unavailable on this static site');
    }
    if (!res.ok) {
      const body = await res.text();
      try {
        const payload = JSON.parse(body) as ApiEnvelope<unknown>;
        if (payload.error?.message) throw new Error(payload.error.message);
      } catch (error) {
        if (error instanceof Error && !(error instanceof SyntaxError)) throw error;
      }
      throw new Error(`Export API failed (${res.status})`);
    }

    const text = await res.text();
    const trimmed = text.trimStart();
    if (!trimmed || /^<(?:!doctype\s+html|html|head|body)\b/i.test(trimmed)) {
      throw new ApiUnavailableError('Export response was an HTML page or empty');
    }
    if (contentType.includes('application/json')) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        throw new ApiUnavailableError('Export API returned invalid JSON');
      }
      if (typeof parsed === 'object' && parsed !== null && 'status' in parsed && 'run_id' in parsed) {
        const envelope = parsed as ApiEnvelope<{ content?: string }>;
        if (envelope.status === 'error') throw new Error(envelope.error?.message ?? 'Export API error');
        if (typeof envelope.data?.content === 'string') {
          return { content: envelope.data.content, filename, mimeType };
        }
        throw new ApiUnavailableError('Export API returned a response without file content');
      }
      if (format !== 'json') {
        throw new ApiUnavailableError('Export API returned JSON instead of a text or CSV file');
      }
    } else if (format === 'json') {
      try {
        JSON.parse(text);
      } catch {
        throw new ApiUnavailableError('Export API did not return a JSON document');
      }
    }

    return { content: text, filename, mimeType };
  } catch (error) {
    if (!(error instanceof ApiUnavailableError)) throw error;
    const review = (await getReviewSnapshot(reviewId)).snapshot.review;
    return generateLocally(review);
  }
}

export interface EvalReportData {
  status: 'measured' | 'not_measured';
  raw?: Record<string, unknown>;
}

export async function getEvaluationReport(): Promise<{ report: EvalReportData; meta: ClientMeta }> {
  try {
    const env = await fetchApiJson<Record<string, unknown>>('/api/evaluation');
    const data = env.data ?? {};
    const isNotMeasured = data.status === 'not_measured' || Object.keys(data).length === 0;
    return {
      report: { status: isNotMeasured ? 'not_measured' : 'measured', raw: data },
      meta: { backendSource: 'node_api', warnings: env.warnings },
    };
  } catch (err) {
    if (!(err instanceof ApiUnavailableError)) throw err;
    lastBackendMode = 'static_fallback';
    try {
      const res = await fetch('./data/eval_report.json');
      if (!res.ok) {
        return { report: { status: 'not_measured' }, meta: { backendSource: 'static_fallback', warnings: [] } };
      }
      const corpus = await loadStaticCorpus();
      const raw = currentEvaluation((await res.json()) as Record<string, unknown>,corpus.corpusVersion,ENGINE_VERSION);
      return { report: { status: raw.status === 'not_measured' ? 'not_measured' : 'measured', raw }, meta: { backendSource: 'static_fallback', warnings: [] } };
    } catch {
      return { report: { status: 'not_measured' }, meta: { backendSource: 'static_fallback', warnings: [] } };
    }
  }
}

export { ENGINE_VERSION, JEV_PROMPT_VERSION, exportFormatters };
