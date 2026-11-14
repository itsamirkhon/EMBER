/** Client-side BM25 retrieval over claims and investigation cards. Pure, no DOM. */
import type { Claim, Investigation } from './types';

export interface Doc {
  id: string;
  kind: 'claim' | 'card';
  inv: string | null;
  text: string;
  /** claim the doc cites, or card source */
  sourceId: string | null;
  sourceUrl: string | null;
  quote: string | null;
}

const STOP = new Set(
  'a an and are as at be by can do does for from has have how in is it its of on or that the this to was were what when which with why will would into than then there their these those about over under under any all also not no yes we you i'.split(
    ' ',
  ),
);

const SYNONYMS: Record<string, string> = {
  oxygen: 'o2',
  extinguish: 'extinct',
  extinguished: 'extinct',
  extinction: 'extinct',
  extinguishment: 'extinct',
  suppression: 'suppress',
  suppress: 'suppress',
  suppressant: 'suppress',
  flames: 'flame',
  droplets: 'droplet',
  particles: 'particle',
  smoke: 'smoke',
  microgravity: 'microgravity',
  'zero-g': 'microgravity',
  weightless: 'microgravity',
  materials: 'material',
  spreading: 'spread',
  spreads: 'spread',
  burning: 'burn',
  burns: 'burn',
  burned: 'burn',
  pressures: 'pressure',
  velocities: 'flow',
  velocity: 'flow',
  ventilation: 'flow',
  airflow: 'flow',
};

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/o₂/g, 'o2')
    .replace(/[^a-z0-9.\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => SYNONYMS[w] ?? (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

export function buildDocs(claims: Claim[], invs: Investigation[]): Doc[] {
  const docs: Doc[] = claims.map((c) => ({
    id: c.id,
    kind: 'claim',
    inv: c.inv,
    text: `${c.text} ${c.topic.join(' ')} ${c.inv ?? ''}`,
    sourceId: c.sourceId,
    sourceUrl: c.sourceUrl,
    quote: c.quote,
  }));
  for (const inv of invs) {
    const src = inv.sources[0];
    docs.push({
      id: `card:${inv.id}`,
      kind: 'card',
      inv: inv.id,
      text: [inv.id, inv.name, inv.objective, inv.resultSummary, ...(inv.fuel?.types ?? []), ...inv.direction]
        .filter(Boolean)
        .join(' '),
      sourceId: src?.id ?? null,
      sourceUrl: inv.psiUrl ?? src?.url ?? null,
      quote: inv.resultSummary,
    });
  }
  return docs;
}

export interface Bm25Index {
  docs: Doc[];
  tf: Map<string, number>[];
  len: number[];
  avgLen: number;
  df: Map<string, number>;
}

export function buildIndex(docs: Doc[]): Bm25Index {
  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();
  for (const d of docs) {
    const toks = tokenize(d.text);
    const m = new Map<string, number>();
    for (const t of toks) m.set(t, (m.get(t) ?? 0) + 1);
    for (const t of m.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    tf.push(m);
    len.push(toks.length);
  }
  const avgLen = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  return { docs, tf, len, avgLen, df };
}

export interface Hit {
  doc: Doc;
  score: number;
  matched: string[];
}

export const CARD_WEIGHT = 0.6;

export function search(index: Bm25Index, query: string, k = 8, k1 = 1.4, b = 0.75): Hit[] {
  const q = [...new Set(tokenize(query))];
  const N = index.docs.length;
  const hits: Hit[] = [];
  index.docs.forEach((doc, i) => {
    let score = 0;
    const matched: string[] = [];
    for (const term of q) {
      const f = index.tf[i].get(term);
      if (!f) continue;
      const n = index.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * index.len[i]) / (index.avgLen || 1)));
      matched.push(term);
    }
    // investigation cards are long summaries; prefer atomic claims at equal match
    if (doc.kind === 'card') score *= CARD_WEIGHT;
    if (score > 0) hits.push({ doc, score, matched });
  });
  return hits.sort((a, b2) => b2.score - a.score).slice(0, k);
}

/**
 * Minimum evidence rule: a hit supports an answer only if it matches at least
 * `minTerms` distinct query terms (or all, for 1-term queries) and clears `minScore`.
 */
export function supportingHits(hits: Hit[], query: string, minScore = 1.2, minTerms = 2): Hit[] {
  const nq = new Set(tokenize(query)).size;
  const need = Math.min(minTerms, Math.max(1, nq));
  return hits.filter((h) => h.score >= minScore && h.matched.length >= need);
}
