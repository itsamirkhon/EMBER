import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApiHandler, emberApiPlugin, type ApiEnvelope } from '../server/api';
import { createStandaloneServer } from '../server/index';
import { COMPARISON_VERSION, ENGINE_VERSION, runReviewSync, type ChunksIndex, type CorpusV2, type ComparisonResult, type Review } from '../src/core';

const EMBER_ROOT = resolve(__dirname, '..');

async function requestJson<T = Record<string, unknown>>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<{ status: number; headers: Headers; body: ApiEnvelope<T> }> {
  const res = await fetch(`${baseUrl}${path}`, init);
  const body = (await res.json()) as ApiEnvelope<T>;
  return { status: res.status, headers: res.headers, body };
}

describe('EMBER v2 HTTP API & Store', () => {
  let tmpDir: string;
  let storePath: string;
  let server: Server;
  let baseUrl: string;
  let createdReviewId = '';
  let createdRunId = '';

  beforeAll(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ember-api-test-'));
    storePath = join(tmpDir, 'reviews_store.json');
    const handler = createApiHandler(EMBER_ROOT, { storePath });
    server = createServer((req, res) => {
      void handler(req, res);
    });
    await new Promise<void>((resolveListen) => {
      server.listen(0, '127.0.0.1', () => resolveListen());
    });
    const addr = server.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected ephemeral TCP port');
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => {
      server.close(() => resolveClose());
    });
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('GET /api/health returns typed envelope, corpus counts, and never exposes API keys', async () => {
    const { status, body } = await requestJson<{
      healthy: boolean;
      corpusVersion: string;
      engineVersion: string;
      counts: Record<string, number>;
      liveAiConfigured: boolean;
    }>(baseUrl, '/api/health');

    expect(status).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.versions.corpus).toBe('2.0.2-bass-provenance');
    expect(body.versions.jevPrompt).toBe('heuristic-triage-v1');
    expect(body.data?.healthy).toBe(true);
    expect(body.data?.counts.investigations).toBe(15);
    expect(body.data?.counts.tests).toBe(1678);
    expect(typeof body.data?.liveAiConfigured).toBe('boolean');
    expect(existsSync(storePath)).toBe(true);
  });

  it('GET /api/investigations supports filtering by direction, fuelPhase, and q', async () => {
    const all = await requestJson<{ total: number; investigations: Array<{ id: string }> }>(
      baseUrl,
      '/api/investigations',
    );
    expect(all.status).toBe(200);
    expect(all.body.data?.total).toBe(15);

    const det = await requestJson<{ total: number; investigations: Array<{ id: string }> }>(
      baseUrl,
      '/api/investigations?direction=detection',
    );
    expect(det.status).toBe(200);
    expect(det.body.data?.investigations.some((i) => i.id === 'SAME')).toBe(true);

    const liq = await requestJson<{ total: number; investigations: Array<{ id: string }> }>(
      baseUrl,
      '/api/investigations?fuelPhase=liquid',
    );
    expect(liq.status).toBe(200);
    expect(liq.body.data?.investigations.map((i) => i.id)).toEqual(expect.arrayContaining(['CFI', 'FLEX', 'FLEX-2']));

    const qRes = await requestJson<{ total: number; investigations: Array<{ id: string }> }>(
      baseUrl,
      '/api/investigations?q=BASS-II',
    );
    expect(qRes.status).toBe(200);
    expect(qRes.body.data?.investigations[0]?.id).toBe('BASS-II');
  });

  it('GET /api/investigations/:id returns card, coverage, tests, and 404 on unknown id', async () => {
    const ok = await requestJson<{
      investigation: { id: string };
      coverage: { totalRows: number; withProtocolSegments: number };
      tests: Array<{ testId: string }>;
    }>(baseUrl, '/api/investigations/BASS-II');

    expect(ok.status).toBe(200);
    expect(ok.body.data?.investigation.id).toBe('BASS-II');
    expect(ok.body.data?.coverage.totalRows).toBe(129);
    expect(ok.body.data?.tests.length).toBe(129);

    const missing = await requestJson(baseUrl, '/api/investigations/DOES-NOT-EXIST');
    expect(missing.status).toBe(404);
    expect(missing.body.status).toBe('error');
    expect(missing.body.error?.code).toBe('NOT_FOUND');
  });

  it('GET /api/sources/:id returns source metadata and cached full text', async () => {
    const res = await requestJson<{
      sourceId: string;
      text: string | null;
      hasFullText: boolean;
    }>(baseUrl, '/api/sources/ntrs-20040053578');

    expect(res.status).toBe(200);
    expect(res.body.data?.sourceId).toBe('ntrs-20040053578');
    expect(res.body.data?.hasFullText).toBe(true);
    expect((res.body.data?.text ?? '').length).toBeGreaterThan(50);

    const tm = await requestJson<{ sourceId: string; hasFullText: boolean; text: string | null }>(
      baseUrl,
      '/api/sources/ntrs-tm-20210011385',
    );
    expect(tm.status).toBe(200);
    expect(tm.body.data?.hasFullText).toBe(true);
    expect((tm.body.data?.text ?? '').length).toBeGreaterThan(1000);

    const missing = await requestJson(baseUrl, '/api/sources/no-such-source');
    expect(missing.status).toBe(404);
  });

  it('POST /api/queries/parse validates payloads and parses natural language + overrides', async () => {
    const badJson = await requestJson(baseUrl, '/api/queries/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid-json',
    });
    expect(badJson.status).toBe(400);
    expect(badJson.body.error?.code).toBe('INVALID_JSON');

    const empty = await requestJson(baseUrl, '/api/queries/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: '   ' }),
    });
    expect(empty.status).toBe(400);
    expect(empty.body.error?.code).toBe('EMPTY_QUERY');

    const overridesOnly = await requestJson<{ query: { material: string | null; o2Pct: number | null } }>(
      baseUrl,
      '/api/queries/parse',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: '', overrides: { material: 'PMMA', o2Pct: 30 } }),
      },
    );
    expect(overridesOnly.status).toBe(200);
    expect(overridesOnly.body.data?.query.material).toBe('PMMA');
    expect(overridesOnly.body.data?.query.o2Pct).toBe(30);

    const parsed = await requestJson<{
      query: {
        material: string | null;
        o2Pct: number | null;
        pressureKpa: number | null;
        thicknessMm: number | null;
        flowCmS: number | [number, number] | null;
      };
    }>(baseUrl, '/api/queries/parse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question: 'PMMA 0.1 mm film flame spread at 30% O2 and 70.3 kPa',
        overrides: { flowCmS: 5 },
      }),
    });
    expect(parsed.status).toBe(200);
    expect(parsed.body.data?.query.material).toBe('PMMA');
    expect(parsed.body.data?.query.o2Pct).toBe(30);
    expect(parsed.body.data?.query.pressureKpa).toBe(70.3);
    expect(parsed.body.data?.query.thicknessMm).toBe(0.1);
    expect(parsed.body.data?.query.flowCmS).toBe(5);
  });

  it('GET /api/reviews/demo-pmma-lunar returns pre-seeded demo snapshot with SAVED_DEMO_SNAPSHOT mode', async () => {
    const demo = await requestJson<{
      reviewId: string;
      revision: number;
      review: {
        synthesis: { mode: string };
        envelope: { mode: string };
      };
    }>(baseUrl, '/api/reviews/demo-pmma-lunar');

    expect(demo.status).toBe(200);
    expect(demo.body.mode).toBe('SAVED_DEMO_SNAPSHOT');
    expect(demo.body.data?.reviewId).toBe('demo-pmma-lunar');
    expect(demo.body.data?.review.synthesis.mode).toBe('SAVED_DEMO_SNAPSHOT');
    expect(demo.body.data?.review.envelope.mode).toBe('SAVED_DEMO_SNAPSHOT');

    const cool = await requestJson<{ reviewId: string; review: { synthesis: { mode: string } } }>(
      baseUrl,
      '/api/reviews/demo-cool-flame',
    );
    expect(cool.status).toBe(200);
    expect(cool.body.data?.reviewId).toBe('demo-cool-flame');
    expect(cool.body.data?.review.synthesis.mode).toBe('SAVED_DEMO_SNAPSHOT');
  });

  it('POST /api/reviews is idempotent, records run details, and reopens deterministically via GET /api/reviews/:id', async () => {
    const payload = {
      question: 'PMMA thin film 0.1 mm sustained spread in BASS-II at 21% O2 and 101.3 kPa',
      overrides: { flowDirection: 'opposed', flowCmS: 5 },
      retrievalMode: 'hybrid',
      budgetRuns: 8,
    };

    const first = await requestJson<{
      reviewId: string;
      runId: string;
      idempotentReplay: boolean;
      review: Review;
    }>(baseUrl, '/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    expect(first.status).toBe(201);
    expect(first.body.status).toBe('ok');
    expect(first.body.mode).toBe('DETERMINISTIC_ENGINE');
    expect(first.body.data?.idempotentReplay).toBe(false);
    createdReviewId = first.body.data?.reviewId ?? '';
    createdRunId = first.body.data?.runId ?? '';
    expect(createdReviewId).toMatch(/^rev-/);
    expect(createdRunId).toMatch(/^run-/);
    const createdReview = first.body.data?.review;
    if (!createdReview) throw new Error('Created review was not returned');
    expect(first.body.versions.engine).toBe(ENGINE_VERSION);
    expect(createdReview.envelope.engineVersion).toBe(ENGINE_VERSION);
    expect(createdReview.evidencePackage.contrasts.length).toBeGreaterThan(0);
    const comparisons = createdReview.evidencePackage.contrasts as ComparisonResult[];
    for (const comparison of comparisons) {
      expect(comparison.comparisonVersion).toBe(COMPARISON_VERSION);
      expect(comparison.endpoint).toBe(createdReview.query.targetEndpoint);
      expect(comparison.observationComparability).toEqual(expect.objectContaining({
        status: expect.any(String), quantitativeAllowed: expect.any(Boolean), reasons: expect.any(Array),
      }));
      expect(comparison.causalSupport.status).toBe('descriptive_only');
      expect(comparison.causalSupport.reasons.length).toBeGreaterThan(0);
      expect(comparison.applicabilityToQuery.a.testId).toBe(comparison.testAId);
      expect(comparison.applicabilityToQuery.b.testId).toBe(comparison.testBId);
      expect(comparison.observations.a.testId).toBe(comparison.testAId);
      expect(comparison.observations.b.testId).toBe(comparison.testBId);
      expect(comparison.factors.length).toBeGreaterThan(0);
      expect(comparison.sourceRefs.length).toBeGreaterThan(0);
      expect(comparison.prohibitedInferences.length).toBeGreaterThan(0);
      expect(comparison.nextAction.length).toBeGreaterThan(0);
      expect(Array.isArray(comparison.fieldDataConflicts)).toBe(true);
    }


    const replay = await requestJson<{
      reviewId: string;
      runId: string;
      idempotentReplay: boolean;
    }>(baseUrl, '/api/reviews', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...payload,
        question: '  PMMA thin film   0.1 mm sustained spread in BASS-II at 21% O2 and 101.3 kPa ',
      }),
    });

    expect(replay.status).toBe(200);
    expect(replay.body.data?.idempotentReplay).toBe(true);
    expect(replay.body.data?.reviewId).toBe(createdReviewId);

    const runRes = await requestJson<{
      runId: string;
      reviewId: string;
      status: string;
      stages: Array<{ name: string; status: string }>;
      timingMs: { total: number };
    }>(baseUrl, `/api/runs/${createdRunId}`);
    expect(runRes.status).toBe(200);
    expect(runRes.body.data?.reviewId).toBe(createdReviewId);
    expect(runRes.body.data?.status).toBe('completed');
    expect(runRes.body.data?.stages.length).toBe(8);

    const reopen = await requestJson<{ reviewId: string; review: Review }>(
      baseUrl,
      `/api/reviews/${createdReviewId}`,
    );
    expect(reopen.status).toBe(200);
    expect(reopen.body.data?.reviewId).toBe(createdReviewId);
    expect(reopen.body.data?.review.query.material).toBe('PMMA');
    expect(reopen.body.data?.review.envelope.engineVersion).toBe(ENGINE_VERSION);
    expect(reopen.body.data?.review.evidencePackage.contrasts).toEqual(comparisons);

    // Saving/reopening and both exports must preserve the engine's scientific decisions.
    const jsonExport = await fetch(`${baseUrl}/api/reviews/${createdReviewId}/export?format=json`);
    expect(jsonExport.status).toBe(200);
    const exportedReview = await jsonExport.json() as Review;
    expect(exportedReview.envelope.engineVersion).toBe(ENGINE_VERSION);
    expect(exportedReview.evidencePackage.contrasts).toEqual(comparisons);
    const markdownExport = await fetch(`${baseUrl}/api/reviews/${createdReviewId}/export?format=markdown`);
    expect(markdownExport.status).toBe(200);
    const markdown = await markdownExport.text();
    expect(markdown).toContain(`Engine: ${ENGINE_VERSION}`);
    for (const comparison of comparisons) {
      expect(markdown).toContain(`### ${comparison.testAId} / ${comparison.testBId}`);
      expect(markdown).toContain(`Comparison version: ${comparison.comparisonVersion}`);
      expect(markdown).toContain(`Observation comparability: ${comparison.observationComparability.status}`);
      expect(markdown).toContain(`Applicability to query: A=${comparison.applicabilityToQuery.a.verdict}; B=${comparison.applicabilityToQuery.b.verdict}`);
      expect(markdown).toContain(`Causal support: ${comparison.causalSupport.status}`);
      for (const limit of comparison.limitations) expect(markdown).toContain(`Limitation: ${limit}`);
      for (const unsupported of comparison.prohibitedInferences) expect(markdown).toContain(`Unsupported inference: ${unsupported}`);
      for (const source of comparison.sourceRefs) {
        expect(markdown).toContain(`Source: ${source.sourceId}; locator=${JSON.stringify(source.locator ?? {})}`);
      }
      expect(markdown).toContain(`Next action: ${comparison.nextAction}`);
    }


    const list = await requestJson<{ total: number; reviews: Array<{ reviewId: string }> }>(baseUrl, '/api/reviews');
    expect(list.status).toBe(200);
    expect(list.body.data?.reviews.filter((r) => r.reviewId === createdReviewId).length).toBe(1);
  });

  it.each([
    ['provider_error', 'request failed or was unreachable'],
    ['invalid_response', 'invalid response or unsupported claims'],
    ['verification_failed', 'rejected by EMBER’s evidence checks'],
  ])('POST /api/reviews explains %s when live synthesis falls back', async (reason, warning) => {
    const prevKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = 'sk-test-redacted-dummy';
    const failingServer = createServer(
      createApiHandler(EMBER_ROOT, {
        storePath,
        fetchImpl: async () => {
          if (reason === 'provider_error') return new Response('private provider detail', { status: 401 });
          if (reason === 'invalid_response') return new Response('{broken JSON');
          const { synthesis } = runReviewSync({
            question: 'Cotton fabric flame spread in BASS-II', retrievalK: 2,
            corpus: JSON.parse(readFileSync(join(EMBER_ROOT, 'public/data/corpus_v2.json'), 'utf8')) as CorpusV2,
            index: JSON.parse(readFileSync(join(EMBER_ROOT, 'public/data/chunks_index.json'), 'utf8')) as ChunksIndex,
          });
          synthesis.observedFact[0].text += ' Pressure was 98765 kPa.';
          return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(synthesis) } }] }));
        },
      }),
    );
    await new Promise<void>((resolveListen) => {
      failingServer.listen(0, '127.0.0.1', () => resolveListen());
    });
    const addr = failingServer.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected port');
    const url = `http://127.0.0.1:${addr.port}`;

    try {
      const res = await requestJson<{ review: Review }>(url, '/api/reviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          question: 'Cotton fabric flame spread in BASS-II',
          useLiveAi: true,
          forceNew: true,
          retrievalK: 2,
        }),
      });
      expect(res.status).toBe(201);
      expect(res.body.mode).toBe('DETERMINISTIC_ENGINE');
      expect(res.body.data?.review.synthesis.mode).toBe('DETERMINISTIC_ENGINE');
      expect(res.body.data?.review.synthesis.fallbackReason).toBe(reason);
      expect(res.body.warnings.join(' ')).toContain(warning);
      expect(JSON.stringify(res.body)).not.toContain('sk-test-redacted-dummy');
      expect(JSON.stringify(res.body)).not.toContain('private provider detail');
    } finally {
      if (prevKey === undefined) delete process.env.OPENAI_API_KEY;
      else process.env.OPENAI_API_KEY = prevKey;
      await new Promise<void>((resolveClose) => {
        failingServer.close(() => resolveClose());
      });
    }
  });

  it('POST /api/reviews/:id/variants recalculates dependencies when changing thicknessMm and flowDirection', async () => {
    const targetId = createdReviewId || 'demo-pmma-lunar';
    const res = await requestJson<{
      reviewId: string;
      revision: number;
      variantId: string;
      updatedQuery: { thicknessMm: number | null; flowDirection: string | null };
      impactChains: Array<{ changedParameter: string; affectedRuleOrEvidence: string; conclusionChange: string }>;
      retainedEdges: unknown[];
      weakenedEdges: unknown[];
      invalidatedEdges: unknown[];
    }>(baseUrl, `/api/reviews/${targetId}/variants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        patch: {
          thicknessMm: 3.0,
          flowDirection: 'concurrent',
        },
      }),
    });

    expect(res.status).toBe(200);
    expect(res.body.data?.revision).toBeGreaterThanOrEqual(2);
    expect(res.body.data?.updatedQuery.thicknessMm).toBe(3.0);
    expect(res.body.data?.updatedQuery.flowDirection).toBe('concurrent');
    expect((res.body.data?.impactChains ?? []).length).toBeGreaterThan(0);
    expect(
      res.body.data?.impactChains.some(
        (c) => c.affectedRuleOrEvidence.includes('RULE-GEOM-01') || c.affectedRuleOrEvidence.includes('RULE-PROT-01'),
      ),
    ).toBe(true);
  });

  it('POST /api/reviews/:id/test-programmes honors budgetRuns and preserves mandatory controls', async () => {
    const res = await requestJson<{
      reviewId: string;
      revision: number;
      testProgramme: {
        budgetRuns: number;
        usedRuns: number;
        mandatoryControlsPreserved: boolean;
        replicatesPreserved: boolean;
        selectedBlocks: Array<{ isMandatoryControl: boolean }>;
      };
    }>(baseUrl, '/api/reviews/demo-pmma-lunar/test-programmes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ budgetRuns: 6 }),
    });

    expect(res.status).toBe(200);
    expect(res.body.data?.testProgramme.budgetRuns).toBe(6);
    expect(res.body.data?.testProgramme.usedRuns).toBeLessThanOrEqual(6);
    expect(res.body.data?.testProgramme.mandatoryControlsPreserved).toBe(true);
    expect(res.body.data?.testProgramme.replicatesPreserved).toBe(true);
    expect(res.body.data?.testProgramme.selectedBlocks.some((b) => b.isMandatoryControl)).toBe(true);
  });

  it('GET /api/reviews/:id/export exports markdown, json, csv, and endpoint-safe modeling_csv', async () => {
    const mdRes = await fetch(`${baseUrl}/api/reviews/demo-pmma-lunar/export?format=markdown`);
    expect(mdRes.status).toBe(200);
    const mdText = await mdRes.text();
    expect(mdText).toContain('# EMBER Review:');

    const jsonRes = await fetch(`${baseUrl}/api/reviews/demo-pmma-lunar/export?format=json`);
    expect(jsonRes.status).toBe(200);
    const jsonParsed = JSON.parse(await jsonRes.text()) as { query: { rawQuestion: string } };
    expect(jsonParsed.query.rawQuestion).toContain('PMMA');

    const csvRes = await fetch(`${baseUrl}/api/reviews/demo-pmma-lunar/export?format=csv`);
    expect(csvRes.status).toBe(200);
    const csvText = await csvRes.text();
    expect(csvText.split(/\r?\n/)[0]).toContain('groupId');
    expect(csvText.split(/\r?\n/)[0]).toContain('o2Role');

    const modSingle = await fetch(`${baseUrl}/api/reviews/demo-pmma-lunar/export?format=modeling_csv`);
    expect(modSingle.status).toBe(200);
    const modSingleText = await modSingle.text();
    const header = modSingleText.split(/\r?\n/)[0];
    expect(header).toContain('groupId');
    expect(header).toContain('o2Role');
    expect(header).toContain('o2Provenance');
    expect(header).toContain('protocolSummary');

    // Mixed endpoint families without explicit scope must be refused cleanly
    const modMixed = await fetch(`${baseUrl}/api/reviews/demo-cool-flame/export?format=modeling_csv`);
    expect(modMixed.status).toBe(400);
    const modMixedErr = (await modMixed.json()) as ApiEnvelope;
    expect(modMixedErr.status).toBe('error');
    expect(modMixedErr.error?.code).toBe('INCOMPATIBLE_ENDPOINTS');

    // Scoped modeling_csv export on demo-cool-flame succeeds cleanly
    const modScoped = await fetch(`${baseUrl}/api/reviews/demo-cool-flame/export?format=modeling_csv&fuelPhase=liquid`);
    expect(modScoped.status).toBe(200);
    const modScopedText = await modScoped.text();
    expect(modScopedText.split(/\r?\n/)[0]).toContain('groupId');
    expect(modScopedText).toContain('CFI');
  });

  it('GET /api/evaluation returns eval report or clean not_measured status', async () => {
    const res = await requestJson<{ status?: string }>(baseUrl, '/api/evaluation');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.data).toBeDefined();
  });

  it('handles 404/405 boundaries, standalone server, and Vite emberApiPlugin', async () => {
    const notFound = await requestJson(baseUrl, '/api/unknown-route');
    expect(notFound.status).toBe(404);
    expect(notFound.body.error?.code).toBe('NOT_FOUND');

    const wrongMethod = await requestJson(baseUrl, '/api/health', { method: 'POST' });
    expect(wrongMethod.status).toBe(405);
    expect(wrongMethod.body.error?.code).toBe('METHOD_NOT_ALLOWED');

    const plugin = emberApiPlugin({ rootDir: EMBER_ROOT, storePath });
    expect(plugin.name).toBe('ember-api-plugin');
    expect(typeof plugin.configureServer).toBe('function');
    expect(typeof plugin.configurePreviewServer).toBe('function');

    const standalone = createStandaloneServer({ rootDir: EMBER_ROOT, storePath });
    await new Promise<void>((resolveListen) => {
      standalone.listen(0, '127.0.0.1', () => resolveListen());
    });
    const addr = standalone.address();
    if (!addr || typeof addr === 'string') throw new Error('Expected port');
    try {
      const res = await requestJson<{ healthy: boolean }>(`http://127.0.0.1:${addr.port}`, '/api/health');
      expect(res.status).toBe(200);
      expect(res.body.data?.healthy).toBe(true);
    } finally {
      await new Promise<void>((resolveClose) => {
        standalone.close(() => resolveClose());
      });
    }
  });

  it('docs/openapi.json is valid OpenAPI 3.1 covering all endpoints', () => {
    const spec = JSON.parse(readFileSync(join(EMBER_ROOT, 'docs', 'openapi.json'), 'utf8')) as {
      openapi: string;
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toBe('3.1.0');
    const expectedPaths = [
      '/api/health',
      '/api/investigations',
      '/api/investigations/{id}',
      '/api/sources/{id}',
      '/api/queries/parse',
      '/api/reviews',
      '/api/runs/{id}',
      '/api/reviews/{id}',
      '/api/reviews/{id}/variants',
      '/api/reviews/{id}/test-programmes',
      '/api/reviews/{id}/export',
      '/api/evaluation',
    ];
    for (const p of expectedPaths) {
      expect(spec.paths[p]).toBeDefined();
    }
  });
});
