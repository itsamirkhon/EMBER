// Mock backend, enabled with VITE_MOCK=1. It replays JSON captured from the real backend
// (src/api/fixtures) and synthesises only run polling, variants and programme budgets.
// It is loaded lazily so it is not part of the normal bundle's main chunk.
import type { RawResponse } from './client';

type J = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const load = async () => {
  const [review, bass2, flex, investigations, meta, ev, rules, reviews, revisions, parse] = await Promise.all([
    import('./fixtures/review_example.json'), import('./fixtures/investigation_bass2.json'), import('./fixtures/investigation_flex.json'),
    import('./fixtures/investigations.json'), import('./fixtures/meta.json'), import('./fixtures/eval.json'), import('./fixtures/rules.json'),
    import('./fixtures/reviews.json'), import('./fixtures/revisions.json'), import('./fixtures/parse.json'),
  ]);
  return { review: review.default as J, invs: { inv_bass2: bass2.default as J, inv_flex: flex.default as J } as Record<string, J>, investigations: investigations.default as J, meta: meta.default as J, ev: ev.default as J, rules: rules.default as J, reviews: reviews.default as J, revisions: revisions.default as J, parse: parse.default as J };
};
let fxp: ReturnType<typeof load> | null = null;
const created = new Map<string, J>();
const runs = new Map<string, { n: number; review_id: string }>();
let counter = 1;
const clone = <X,>(x: X): X => JSON.parse(JSON.stringify(x));
const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const err = (status: number, code: string, message: string): RawResponse => ({ status, body: { error: { code, message } } });
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function mockTransport(method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<RawResponse> {
  fxp ??= load();
  const fx = await fxp;
  await delay(120);
  const [pathname, search = ''] = path.split('?');
  const sp = new URLSearchParams(search);
  const seg = pathname.replace(/^\/api\//, '').split('/');
  const b = (body ?? {}) as J;
  const getReview = (id: string) => (id === fx.review.id ? fx.review : created.get(id));

  if (pathname === '/api/meta') return ok(fx.meta);
  if (pathname === '/api/rules') return ok(fx.rules);
  if (pathname === '/api/eval/summary') return ok(fx.ev);
  if (seg[0] === 'investigations') {
    if (seg.length === 1) {
      const q = (sp.get('q') ?? '').toLowerCase();
      const items = (fx.investigations.items as J[]).filter((i) => (!q || JSON.stringify(i).toLowerCase().includes(q.split(' ')[0]))
        && (!sp.get('topic') || i.topics.includes(sp.get('topic'))) && (!sp.get('material') || i.materials.includes(sp.get('material')))
        && (!sp.get('platform') || i.platform === sp.get('platform')) && (!sp.get('family') || i.families.includes(sp.get('family'))));
      return ok({ items });
    }
    const inv = fx.invs[seg[1]];
    return inv ? ok(inv) : err(404, 'investigation_not_found', `no investigation ${seg[1]}`);
  }
  if (seg[0] === 'sources' && seg[1]) return ok({ id: seg[1], url: '', title: 'Mock source', retrieved: null, hash: null, type: 'web_page', note: '' });
  if (method === 'POST' && pathname === '/api/queries/parse') {
    const out = clone(fx.parse);
    if (b.text) out.query.question = b.text;
    if (b.config) out.query = b.config;
    return ok(out);
  }
  if (seg[0] === 'reviews' && seg.length === 1) {
    if (method === 'POST') {
      if (!b.query || typeof b.query.question !== 'string') return err(422, 'invalid_query', 'query.question is required.');
      const key = headers?.['Idempotency-Key'];
      const id = key ? `rev_${key.slice(0, 12)}` : `rev_mock${++counter}`;
      if (!created.has(id)) { const r = clone(fx.review); r.id = id; r.query = b.query; r.mode = 'deterministic'; r.explanation.mode = 'deterministic'; created.set(id, r); }
      runs.set(`run_${id}`, { n: 0, review_id: id });
      return ok({ run_id: `run_${id}`, review_id: id }, 202);
    }
    const items = [...(fx.reviews.items as J[]), ...[...created.values()].map((r) => ({ id: r.id, revision: r.revision, created: r.created, mode: r.mode, question: r.query.question, endpoint: r.query.endpoint, parent_id: r.parent_id, saved_example: 0 }))];
    return ok({ items });
  }
  if (seg[0] === 'runs' && seg[1]) {
    const run = runs.get(seg[1]);
    if (!run) return err(404, 'run_not_found', `no run ${seg[1]}`);
    run.n++;
    const stages = ['queued', 'retrieving evidence', 'applying rules', 'building claims'];
    if (run.n <= stages.length) return ok({ run_id: seg[1], status: run.n === 1 ? 'queued' : 'running', stage: stages[run.n - 1], error: null, review_id: null });
    return ok({ run_id: seg[1], status: 'done', stage: 'done', error: null, review_id: run.review_id });
  }
  if (seg[0] === 'reviews' && seg[1]) {
    const r = getReview(seg[1]);
    if (!r) return err(404, 'review_not_found', `no review ${seg[1]}`);
    if (seg.length === 2) return ok(r);
    if (seg[2] === 'revisions') return ok(fx.revisions);
    if (seg[2] === 'variants' && method === 'POST') {
      const patch = b.config_patch as Record<string, unknown> | undefined;
      if (!patch || !Object.keys(patch).length) return err(422, 'invalid_patch', 'config_patch must not be empty');
      const v = clone(r); v.id = `rev_var${++counter}`; v.parent_id = r.id; v.variant_patch = patch; v.revision = 1; v.query.config = { ...v.query.config, ...patch };
      const keys = Object.keys(patch);
      const diff: J[] = [];
      v.claims = v.claims.filter((c: J) => {
        const dep = c.depends_on_fields.some((f: string) => keys.includes(f)) || keys.some((k) => k in c.conditions && c.conditions[k] !== null);
        if (!dep) return true;
        diff.push({ claim_id: c.id, before: c.status, after: null, changed_parameter: keys[0], reason: `claim no longer applies after the change (mock). ${c.why}` });
        return false;
      });
      created.set(v.id, v);
      return ok({ variant_id: v.id, diff, review: v });
    }
    if (seg[2] === 'test-programmes' && method === 'POST') {
      if (typeof b.budget_runs !== 'number' || b.budget_runs < 1) return err(422, 'invalid_budget', 'budget_runs must be a positive integer.');
      const p = clone(r.programme ?? { blocks: [], selected: [], runs_used: 0, covered: [], uncovered: [], method: 'exact', note: '' });
      p.budget_runs = b.budget_runs;
      let used = 0; const keep: J[] = [];
      for (const blk of p.blocks) if (used + blk.runs <= b.budget_runs) { used += blk.runs; keep.push(blk); }
      p.blocks = keep; p.selected = keep.map((x: J) => x.id); p.runs_used = used; p.covered = keep.flatMap((x: J) => x.covers);
      p.uncovered = (r.open_questions as J[]).map((q) => q.id).filter((q: string) => !p.covered.includes(q));
      return ok(p);
    }
    if (seg[2] === 'export') {
      const f = sp.get('format') ?? 'report';
      if (f === 'json') return { status: 200, body: r, text: JSON.stringify(r, null, 2), contentType: 'application/json' };
      if (f === 'csv' || f === 'dataset') return { status: 200, body: null, text: 'review_id,test_id,status\n' + (r.tests_considered as J[]).map((t) => `${r.id},${t.test_id},${t.decisions[0]?.status}`).join('\n'), contentType: 'text/csv' };
      return { status: 200, body: null, text: `# EMBER review ${r.id}\n\n${r.query.question}\n\n${(r.claims as J[]).map((c) => `- [${c.status}] ${c.text}`).join('\n')}\n`, contentType: 'text/markdown' };
    }
    if (seg[2] === 'replay' && seg[3]) {
      const t = Object.values(fx.invs).flatMap((i: J) => i.test_records).find((x: J) => x.id === seg[3]);
      if (!t) return err(404, 'test_not_found', `no test ${seg[3]}`);
      return ok({ test_id: t.id, series: t.series, observation_status: t.observation_status, record_type: t.record_type,
        segments: t.protocol.map((p: J) => ({ label: p.description, kind: p.kind, time_s: p.time_s.value, order: p.order })),
        events: t.events.map((e: J) => ({ ...e, time_s: e.time_s.value })), measurements: t.measurements,
        disclaimer: 'Data replay of the recorded protocol steps and events in the provisional corpus. It is not a physics simulation; missing times are shown as unknown.' });
    }
  }
  return err(404, 'not_found', `No mock route for ${method} ${pathname}`);
}
