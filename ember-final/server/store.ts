import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENGINE_VERSION,
  registerReviewCorpus,
  runReviewSync,
  type ChunksIndex,
  type CorpusV2,
  type DesignVariantPatch,
  type DesignVariantResult,
  type QueryParserOptions,
  type ResearchQuery,
  type RetrievalMode,
  type Review,
  type RunEnvelope,
  type SourceRecord,
  type SynthesisMode,
  type Test,
} from '../src/core/index';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT_DIR = resolve(THIS_DIR, '..');

export interface CachedSourceEntry {
  sourceId: string;
  inv?: string[];
  type?: string;
  label?: string;
  year?: string | number | null;
  url?: string | null;
  text?: string;
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
  status: 'completed';
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
  timingMs: RunEnvelope['timingMs'];
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

interface PersistedStoreFile {
  schemaVersion: string;
  updatedAt: string;
  reviews: Record<string, SavedReviewSnapshot>;
}

export interface StoreOptions {
  rootDir?: string;
  storePath?: string;
}

interface DemoSpec {
  reviewId: string;
  title: string;
  question: string;
  overrides: Partial<ResearchQuery>;
  budgetRuns: number;
}

const DEMO_SPECS: DemoSpec[] = [
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

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const val = (value as Record<string, unknown>)[key];
      if (val !== undefined) out[key] = canonicalize(val);
    }
    return out;
  }
  return value;
}

export function computeReviewSignature(params: {
  question: string;
  overrides?: Partial<ResearchQuery>;
  parserOptions?: QueryParserOptions;
  retrievalMode: RetrievalMode;
  budgetRuns: number;
}): string {
  const normalized = canonicalize({
    question: params.question.trim().replace(/\s+/g, ' '),
    overrides: params.overrides ?? {},
    parserOptions: params.parserOptions ?? {},
    retrievalMode: params.retrievalMode,
    budgetRuns: params.budgetRuns,
  });
  return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
}

export function buildStagesFromTiming(timingMs: RunEnvelope['timingMs']): RunStageSummary[] {
  const ordered: Array<[string, number]> = [
    ['parse', timingMs.parse],
    ['retrieve', timingMs.retrieve],
    ['jev', timingMs.jev],
    ['applicability', timingMs.applicability],
    ['synthesis', timingMs.synthesis],
    ['verify', timingMs.verify],
    ['plan', timingMs.plan],
    ['predict', timingMs.predict],
  ];
  return ordered.map(([name, durationMs]) => ({ name, status: 'completed', durationMs }));
}

export function resolveOpenAiApiKey(rootDir: string): string | null {
  const fromEnv = process.env.OPENAI_API_KEY?.trim();
  if (fromEnv) return fromEnv;

  const envPath = join(rootDir, '.env');
  if (!existsSync(envPath)) return null;
  try {
    const raw = readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const match = trimmed.match(/^(?:export\s+)?OPENAI_API_KEY\s*=\s*(.+)$/);
      if (!match) continue;
      const cleaned = match[1].trim().replace(/^['"]|['"]$/g, '');
      if (cleaned) return cleaned;
    }
  } catch {
    return null;
  }
  return null;
}

function dehydrateSnapshot(snap: SavedReviewSnapshot): SavedReviewSnapshot {
  const testIds =
    snap.evaluatedTestIds ??
    snap.review.evidencePackage.evaluatedTests?.map((t) => t.testId) ??
    snap.review.evidencePackage.applicabilityDecisions.map((d) => d.testId);

  return {
    ...snap,
    evaluatedTestIds: testIds,
    review: {
      ...snap.review,
      evidencePackage: {
        ...snap.review.evidencePackage,
        evaluatedTests: undefined,
      },
    },
  };
}

function hydrateSnapshot(
  snap: SavedReviewSnapshot,
  corpus: CorpusV2,
  testsById: Map<string, Test>,
): SavedReviewSnapshot {
  const ids = snap.evaluatedTestIds ?? snap.review.evidencePackage.applicabilityDecisions.map((d) => d.testId);
  const existing = snap.review.evidencePackage.evaluatedTests;
  const evaluatedTests =
    existing && existing.length > 0
      ? existing
      : ids.map((id) => testsById.get(id)).filter((t): t is Test => t !== undefined);

  const hydratedReview: Review = {
    ...snap.review,
    evidencePackage: {
      ...snap.review.evidencePackage,
      evaluatedTests,
    },
  };
  registerReviewCorpus(hydratedReview, corpus);
  registerReviewCorpus(hydratedReview.evidencePackage, corpus);

  return {
    ...snap,
    evaluatedTestIds: ids,
    review: hydratedReview,
  };
}

export class EmberStore {
  readonly rootDir: string;
  readonly storePath: string;

  private corpusCache: CorpusV2 | null = null;
  private chunksCache: ChunksIndex | null = null;
  private sourcesCache: Map<string, CachedSourceEntry> | null = null;
  private testsByIdCache: Map<string, Test> | null = null;
  private tmFullTextCache: string | null | undefined = undefined;
  private snapshots = new Map<string, SavedReviewSnapshot>();
  private runsIndex = new Map<string, RunRecord>();
  private initPromise: Promise<void> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private tmpSeq = 0;

  constructor(options: StoreOptions = {}) {
    this.rootDir = options.rootDir ? resolve(options.rootDir) : DEFAULT_ROOT_DIR;
    this.storePath = options.storePath ? resolve(options.storePath) : join(this.rootDir, 'data', 'reviews_store.json');
  }

  async getCorpus(): Promise<CorpusV2> {
    if (this.corpusCache) return this.corpusCache;
    const raw = await readFile(join(this.rootDir, 'public', 'data', 'corpus_v2.json'), 'utf8');
    const parsed = JSON.parse(raw) as CorpusV2;
    this.corpusCache = parsed;
    this.testsByIdCache = new Map(parsed.tests.map((t) => [t.testId, t]));
    return parsed;
  }

  async getChunksIndex(): Promise<ChunksIndex> {
    if (this.chunksCache) return this.chunksCache;
    const raw = await readFile(join(this.rootDir, 'public', 'data', 'chunks_index.json'), 'utf8');
    const parsed = JSON.parse(raw) as ChunksIndex;
    this.chunksCache = parsed;
    return parsed;
  }

  async getSourcesMap(): Promise<Map<string, CachedSourceEntry>> {
    if (this.sourcesCache) return this.sourcesCache;
    const path = join(this.rootDir, 'data', 'sources_cache.json');
    const map = new Map<string, CachedSourceEntry>();
    if (existsSync(path)) {
      const raw = await readFile(path, 'utf8');
      const items = JSON.parse(raw) as CachedSourceEntry[];
      for (const item of items) {
        map.set(item.sourceId, item);
      }
    }
    this.sourcesCache = map;
    return map;
  }

  async getSourceById(sourceId: string): Promise<SourceDetail | null> {
    const [corpus, cacheMap] = await Promise.all([this.getCorpus(), this.getSourcesMap()]);
    const corpusRec = corpus.sources.find((s) => s.sourceId === sourceId);
    const cached = cacheMap.get(sourceId);
    if (!corpusRec && !cached) return null;

    let text: string | null = cached?.text ?? null;
    if (text === null && sourceId === 'ntrs-tm-20210011385') {
      text = await this.loadTmFullText();
    }

    return {
      sourceId,
      title: corpusRec?.title ?? cached?.label ?? sourceId,
      label: cached?.label ?? corpusRec?.title ?? null,
      inv: cached?.inv ?? [],
      type: corpusRec?.type ?? cached?.type,
      year: cached?.year ?? null,
      url: corpusRec?.url ?? cached?.url ?? null,
      doi: corpusRec?.doi ?? null,
      fileHash: corpusRec?.fileHash ?? null,
      notes: corpusRec?.notes ?? null,
      text,
      hasFullText: Boolean(text && text.length > 0),
    };
  }

  private async loadTmFullText(): Promise<string | null> {
    if (this.tmFullTextCache !== undefined) return this.tmFullTextCache;
    const tmPath = join(this.rootDir, 'data', 'raw', 'ntrs', 'TM-20210011385.txt');
    if (!existsSync(tmPath)) {
      this.tmFullTextCache = null;
      return null;
    }
    this.tmFullTextCache = await readFile(tmPath, 'utf8');
    return this.tmFullTextCache;
  }

  async ensureInitialized(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.initializeInternal();
    }
    await this.initPromise;
  }

  private async initializeInternal(): Promise<void> {
    const [corpus, index] = await Promise.all([this.getCorpus(), this.getChunksIndex()]);
    const testsById = this.testsByIdCache ?? new Map(corpus.tests.map((t) => [t.testId, t]));

    let loadedAny = false;
    if (existsSync(this.storePath)) {
      try {
        const raw = await readFile(this.storePath, 'utf8');
        const parsed = JSON.parse(raw) as PersistedStoreFile;
        for (const [id, snap] of Object.entries(parsed.reviews ?? {})) {
          const hydrated = hydrateSnapshot(snap, corpus, testsById);
          this.snapshots.set(id, hydrated);
          for (const run of hydrated.runs) {
            this.runsIndex.set(run.runId, run);
          }
          loadedAny = true;
        }
      } catch {
        // Corrupt or partial store file fallback: rebuild clean store with pre-seeded demos.
        this.snapshots.clear();
        this.runsIndex.clear();
      }
    }

    let modified = !loadedAny;
    for (const demo of DEMO_SPECS) {
      if (!this.snapshots.has(demo.reviewId)) {
        const seeded = this.buildDemoSnapshot(demo, corpus, index);
        this.snapshots.set(seeded.reviewId, seeded);
        for (const run of seeded.runs) {
          this.runsIndex.set(run.runId, run);
        }
        modified = true;
      }
    }

    if (modified) {
      await this.persistAtomic();
    }
  }

  private buildDemoSnapshot(demo: DemoSpec, corpus: CorpusV2, index: ChunksIndex): SavedReviewSnapshot {
    const baseReview = runReviewSync({
      question: demo.question,
      overrides: demo.overrides,
      corpus,
      index,
      budgetRuns: demo.budgetRuns,
    });

    const now = new Date().toISOString();
    const runId = `run-${demo.reviewId}`;
    const demoReview: Review = {
      ...baseReview,
      synthesis: {
        ...baseReview.synthesis,
        mode: 'SAVED_DEMO_SNAPSHOT',
      },
      envelope: {
        ...baseReview.envelope,
        runId,
        mode: 'SAVED_DEMO_SNAPSHOT',
      },
    };
    registerReviewCorpus(demoReview, corpus);
    registerReviewCorpus(demoReview.evidencePackage, corpus);

    const run: RunRecord = {
      runId,
      reviewId: demo.reviewId,
      status: 'completed',
      mode: 'SAVED_DEMO_SNAPSHOT',
      retrievalMode: demoReview.envelope.retrievalMode,
      budgetRuns: demo.budgetRuns,
      createdAt: now,
      completedAt: now,
      stages: buildStagesFromTiming(demoReview.envelope.timingMs),
      timingMs: demoReview.envelope.timingMs,
      warnings: [],
    };

    return {
      reviewId: demo.reviewId,
      title: demo.title,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      idempotencyKey: demo.reviewId,
      requestSignature: computeReviewSignature({
        question: demo.question,
        overrides: demo.overrides,
        retrievalMode: 'hybrid',
        budgetRuns: demo.budgetRuns,
      }),
      isDemo: true,
      review: demoReview,
      evaluatedTestIds: demoReview.evidencePackage.evaluatedTests?.map((t) => t.testId) ?? [],
      variants: [],
      runs: [run],
    };
  }

  private persistAtomic(): Promise<void> {
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.storePath), { recursive: true });
      const reviewsRecord: Record<string, SavedReviewSnapshot> = {};
      for (const [id, snap] of this.snapshots.entries()) {
        reviewsRecord[id] = dehydrateSnapshot(snap);
      }
      const payload: PersistedStoreFile = {
        schemaVersion: ENGINE_VERSION,
        updatedAt: new Date().toISOString(),
        reviews: reviewsRecord,
      };
      this.tmpSeq += 1;
      const tmpPath = `${this.storePath}.${process.pid}.${this.tmpSeq}.tmp`;
      try {
        await writeFile(tmpPath, JSON.stringify(payload), 'utf8');
        await rename(tmpPath, this.storePath);
      } catch (err) {
        await unlink(tmpPath).catch(() => undefined);
        throw err;
      }
    });
    return this.writeChain;
  }

  async listReviewSummaries(): Promise<ReviewSummary[]> {
    await this.ensureInitialized();
    const list: ReviewSummary[] = [];
    for (const snap of this.snapshots.values()) {
      list.push({
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
        lastRunId: snap.runs[snap.runs.length - 1]?.runId ?? null,
      });
    }
    return list.sort((a, b) => {
      if (a.isDemo !== b.isDemo) return a.isDemo ? -1 : 1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  async getReview(reviewId: string): Promise<SavedReviewSnapshot | null> {
    await this.ensureInitialized();
    return this.snapshots.get(reviewId) ?? null;
  }

  async getRun(runId: string): Promise<RunRecord | null> {
    await this.ensureInitialized();
    return this.runsIndex.get(runId) ?? null;
  }

  async findIdempotentMatch(
    explicitKey: string | undefined,
    signature: string,
  ): Promise<SavedReviewSnapshot | null> {
    await this.ensureInitialized();
    if (explicitKey) {
      for (const snap of this.snapshots.values()) {
        if (snap.idempotencyKey === explicitKey) return snap;
      }
    }
    for (const snap of this.snapshots.values()) {
      if (!snap.isDemo && snap.requestSignature === signature) return snap;
    }
    return null;
  }

  async saveNewReview(params: {
    review: Review;
    title: string;
    idempotencyKey?: string;
    requestSignature: string;
    budgetRuns: number;
    warnings: string[];
  }): Promise<{ snapshot: SavedReviewSnapshot; run: RunRecord }> {
    await this.ensureInitialized();
    const corpus = await this.getCorpus();
    const now = new Date().toISOString();
    const suffix = randomUUID().slice(0, 8);
    const reviewId = `rev-${Date.now().toString(36)}-${suffix}`;
    const runId = `run-${Date.now().toString(36)}-${suffix}`;

    const updatedReview: Review = {
      ...params.review,
      envelope: {
        ...params.review.envelope,
        runId,
      },
    };
    registerReviewCorpus(updatedReview, corpus);
    registerReviewCorpus(updatedReview.evidencePackage, corpus);

    const run: RunRecord = {
      runId,
      reviewId,
      status: 'completed',
      mode: updatedReview.synthesis.mode,
      retrievalMode: updatedReview.envelope.retrievalMode,
      budgetRuns: params.budgetRuns,
      createdAt: now,
      completedAt: now,
      stages: buildStagesFromTiming(updatedReview.envelope.timingMs),
      timingMs: updatedReview.envelope.timingMs,
      warnings: [...params.warnings],
    };

    const snapshot: SavedReviewSnapshot = {
      reviewId,
      title: params.title,
      createdAt: now,
      updatedAt: now,
      revision: 1,
      idempotencyKey: params.idempotencyKey ?? params.requestSignature.slice(0, 24),
      requestSignature: params.requestSignature,
      isDemo: false,
      review: updatedReview,
      evaluatedTestIds: updatedReview.evidencePackage.evaluatedTests?.map((t) => t.testId) ?? [],
      variants: [],
      runs: [run],
    };

    this.snapshots.set(reviewId, snapshot);
    this.runsIndex.set(runId, run);
    await this.persistAtomic();
    return { snapshot, run };
  }

  async appendVariant(
    reviewId: string,
    patch: DesignVariantPatch,
    result: DesignVariantResult,
  ): Promise<{ snapshot: SavedReviewSnapshot; variant: SavedVariantRecord } | null> {
    await this.ensureInitialized();
    const snap = this.snapshots.get(reviewId);
    if (!snap) return null;

    const now = new Date().toISOString();
    const variant: SavedVariantRecord = {
      variantId: `var-${snap.variants.length + 1}-${randomUUID().slice(0, 6)}`,
      createdAt: now,
      patch,
      result,
    };

    const updated: SavedReviewSnapshot = {
      ...snap,
      revision: snap.revision + 1,
      updatedAt: now,
      variants: [...snap.variants, variant],
    };
    this.snapshots.set(reviewId, updated);
    await this.persistAtomic();
    return { snapshot: updated, variant };
  }

  async updateTestProgramme(
    reviewId: string,
    testProgramme: Review['testProgramme'],
  ): Promise<SavedReviewSnapshot | null> {
    await this.ensureInitialized();
    const snap = this.snapshots.get(reviewId);
    if (!snap) return null;

    const now = new Date().toISOString();
    const corpus = await this.getCorpus();
    const updatedReview: Review = {
      ...snap.review,
      testProgramme,
    };
    registerReviewCorpus(updatedReview, corpus);
    registerReviewCorpus(updatedReview.evidencePackage, corpus);

    const updated: SavedReviewSnapshot = {
      ...snap,
      revision: snap.revision + 1,
      updatedAt: now,
      review: updatedReview,
    };
    this.snapshots.set(reviewId, updated);
    await this.persistAtomic();
    return updated;
  }

  async getEvaluationReport(): Promise<Record<string, unknown>> {
    const evalPath = join(this.rootDir, 'public', 'data', 'eval_report.json');
    if (!existsSync(evalPath)) {
      return {
        status: 'not_measured',
        message: 'Evaluation report has not been generated yet.',
      };
    }
    const raw = await readFile(evalPath, 'utf8');
    return JSON.parse(raw) as Record<string, unknown>;
  }

  getEvaluatedTestsForReview(snap: SavedReviewSnapshot, corpus: CorpusV2): Test[] {
    if (snap.review.evidencePackage.evaluatedTests && snap.review.evidencePackage.evaluatedTests.length > 0) {
      return snap.review.evidencePackage.evaluatedTests;
    }
    const testsById = this.testsByIdCache ?? new Map(corpus.tests.map((t) => [t.testId, t]));
    const ids = snap.evaluatedTestIds ?? snap.review.evidencePackage.applicabilityDecisions.map((d) => d.testId);
    return ids.map((id) => testsById.get(id)).filter((t): t is Test => t !== undefined);
  }
}
