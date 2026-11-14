/**
 * Hybrid retrieval engine:
 * - Domain-aware BM25 over ChunkRecords
 * - Exact sklearn-compatible TfidfVectorizer (1-2 gram, English stop words) + TruncatedSVD 64D cosine search
 * - Structured metadata filter over CorpusV2 / ChunksIndex
 * - Reciprocal Rank Fusion (RRF, k=60) + deduplication with mode flags ("bm25" | "hybrid" | "structured")
 */
import { materialsCompatible } from './applicability';
import { parseResearchQuery } from './queryParser';
import type { ChunkRecord, ChunksIndex, CorpusV2, ResearchQuery, RetrievalHit, RetrievalMode } from './types';

// Exact scikit-learn ENGLISH_STOP_WORDS (318 terms) so encodeDenseQuery matches Python TfidfVectorizer bit-for-bit.
const SKLEARN_STOP_WORDS = new Set(
  (
    'a,about,above,across,after,afterwards,again,against,all,almost,alone,along,already,also,although,always,am,' +
    'among,amongst,amoungst,amount,an,and,another,any,anyhow,anyone,anything,anyway,anywhere,are,around,as,at,back,' +
    'be,became,because,become,becomes,becoming,been,before,beforehand,behind,being,below,beside,besides,between,' +
    'beyond,bill,both,bottom,but,by,call,can,cannot,cant,co,con,could,couldnt,cry,de,describe,detail,do,done,down,' +
    'due,during,each,eg,eight,either,eleven,else,elsewhere,empty,enough,etc,even,ever,every,everyone,everything,' +
    'everywhere,except,few,fifteen,fifty,fill,find,fire,first,five,for,former,formerly,forty,found,four,from,front,' +
    'full,further,get,give,go,had,has,hasnt,have,he,hence,her,here,hereafter,hereby,herein,hereupon,hers,herself,him,' +
    'himself,his,how,however,hundred,i,ie,if,in,inc,indeed,interest,into,is,it,its,itself,keep,last,latter,latterly,' +
    'least,less,ltd,made,many,may,me,meanwhile,might,mill,mine,more,moreover,most,mostly,move,much,must,my,myself,' +
    'name,namely,neither,never,nevertheless,next,nine,no,nobody,none,noone,nor,not,nothing,now,nowhere,of,off,often,' +
    'on,once,one,only,onto,or,other,others,otherwise,our,ours,ourselves,out,over,own,part,per,perhaps,please,put,' +
    'rather,re,same,see,seem,seemed,seeming,seems,serious,several,she,should,show,side,since,sincere,six,sixty,so,' +
    'some,somehow,someone,something,sometime,sometimes,somewhere,still,such,system,take,ten,than,that,the,their,them,' +
    'themselves,then,thence,there,thereafter,thereby,therefore,therein,thereupon,these,they,thick,thin,third,this,' +
    'those,though,three,through,throughout,thru,thus,to,together,too,top,toward,towards,twelve,twenty,two,un,under,' +
    'until,up,upon,us,very,via,was,we,well,were,what,whatever,when,whence,whenever,where,whereafter,whereas,whereby,' +
    'wherein,whereupon,wherever,whether,which,while,whither,who,whoever,whole,whom,whose,why,will,with,within,without,' +
    'would,yet,you,your,yours,yourself,yourselves'
  ).split(','),
);

const BM25_STOP = new Set(
  'a an and are as at be by can do does for from has have how in is it its of on or that the this to was were what when which with why will would into than then there their these those'.split(
    ' ',
  ),
);

const BM25_SYNONYMS: Record<string, string> = {
  oxygen: 'o2',
  extinguish: 'extinct',
  extinguished: 'extinct',
  extinction: 'extinct',
  extinguishment: 'extinct',
  suppression: 'suppress',
  suppressant: 'suppress',
  flames: 'flame',
  droplets: 'droplet',
  particles: 'particle',
  materials: 'material',
  spreading: 'spread',
  spreads: 'spread',
  burning: 'burn',
  burns: 'burn',
  burned: 'burn',
  velocities: 'flow',
  velocity: 'flow',
  ventilation: 'flow',
  airflow: 'flow',
};

export function tokenizeBm25(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/o₂/g, 'o2')
    .replace(/[^a-z0-9.\-]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^[.\-]+|[.\-]+$/g, ''))
    .filter((w) => w.length > 1 && !BM25_STOP.has(w))
    .map((w) => BM25_SYNONYMS[w] ?? (w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w));
}

export interface Bm25IndexState {
  chunks: ChunkRecord[];
  tf: Map<string, number>[];
  len: number[];
  avgLen: number;
  df: Map<string, number>;
}

const bm25Cache = new WeakMap<ChunkRecord[], Bm25IndexState>();

export function buildBm25State(chunks: ChunkRecord[]): Bm25IndexState {
  const cached = bm25Cache.get(chunks);
  if (cached) return cached;

  const tf: Map<string, number>[] = [];
  const len: number[] = [];
  const df = new Map<string, number>();

  for (const chunk of chunks) {
    const fullText = [chunk.sectionHeader, chunk.tableUnits, chunk.inv, chunk.testId, chunk.text].filter(Boolean).join(' ');
    const toks = tokenizeBm25(fullText);
    const counts = new Map<string, number>();
    for (const tok of toks) counts.set(tok, (counts.get(tok) ?? 0) + 1);
    for (const term of counts.keys()) df.set(term, (df.get(term) ?? 0) + 1);
    tf.push(counts);
    len.push(toks.length);
  }
  const avgLen = len.reduce((a, b) => a + b, 0) / Math.max(1, len.length);
  const state: Bm25IndexState = { chunks, tf, len, avgLen, df };
  bm25Cache.set(chunks, state);
  return state;
}

export function searchBm25(index: Pick<ChunksIndex, 'chunks'>, queryText: string, k = 10, k1 = 1.4, b = 0.75): RetrievalHit[] {
  const state = buildBm25State(index.chunks);
  const qTerms = [...new Set(tokenizeBm25(queryText))];
  const N = state.chunks.length;
  const hits: RetrievalHit[] = [];

  for (let i = 0; i < N; i += 1) {
    let score = 0;
    const matchedTerms: string[] = [];
    for (const term of qTerms) {
      const freq = state.tf[i].get(term);
      if (!freq) continue;
      const n = state.df.get(term) ?? 0;
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5));
      score += (idf * freq * (k1 + 1)) / (freq + k1 * (1 - b + (b * state.len[i]) / (state.avgLen || 1)));
      matchedTerms.push(term);
    }
    if (score > 0) {
      hits.push({
        chunk: state.chunks[i],
        score,
        bm25Score: score,
        denseScore: 0,
        structuredScore: 0,
        matchedTerms,
        rank: 0,
      });
    }
  }
  return hits
    .sort((a, b2) => b2.score - a.score)
    .slice(0, k)
    .map((h, idx) => ({ ...h, rank: idx + 1 }));
}

function l2Normalize(vec: number[]): number[] {
  let sq = 0;
  for (let i = 0; i < vec.length; i += 1) sq += vec[i] * vec[i];
  const norm = Math.sqrt(sq);
  if (norm <= 1e-12) return vec.map(() => 0);
  return vec.map((v) => v / norm);
}

/**
 * Exact scikit-learn TfidfVectorizer(ngram_range=(1,2), stop_words="english", lowercase=True)
 * + TruncatedSVD projection + L2 normalization.
 */
export function encodeDenseQuery(
  index: Pick<ChunksIndex, 'vocabulary' | 'idf' | 'svdComponents'>,
  queryText: string,
): number[] {
  const vocabSize = index.idf.length;
  if (vocabSize === 0 || index.svdComponents.length === 0) return [];

  const rawTokens = queryText.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? [];
  const filtered = rawTokens.filter((t) => !SKLEARN_STOP_WORDS.has(t));
  const ngrams: string[] = [...filtered];
  for (let i = 0; i < filtered.length - 1; i += 1) {
    ngrams.push(`${filtered[i]} ${filtered[i + 1]}`);
  }

  const tfidf = new Array<number>(vocabSize).fill(0);
  let hasNonZero = false;
  for (const gram of ngrams) {
    const col = index.vocabulary[gram];
    if (col !== undefined && col >= 0 && col < vocabSize) {
      tfidf[col] += 1;
      hasNonZero = true;
    }
  }
  if (!hasNonZero) return new Array<number>(index.svdComponents.length).fill(0);

  for (let j = 0; j < vocabSize; j += 1) {
    if (tfidf[j] !== 0) tfidf[j] *= index.idf[j];
  }
  const tfidfNorm = l2Normalize(tfidf);

  const projected = index.svdComponents.map((row) => {
    let dot = 0;
    const limit = Math.min(row.length, tfidfNorm.length);
    for (let j = 0; j < limit; j += 1) {
      if (tfidfNorm[j] !== 0) dot += row[j] * tfidfNorm[j];
    }
    return dot;
  });
  return l2Normalize(projected);
}

function dotProduct(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += a[i] * b[i];
  return sum;
}

export function searchDense(index: ChunksIndex, queryText: string, k = 10): RetrievalHit[] {
  const qVec = encodeDenseQuery(index, queryText);
  if (qVec.length === 0 || qVec.every((v) => v === 0)) return [];

  const hits: RetrievalHit[] = [];
  for (const chunk of index.chunks) {
    if (!chunk.vector || chunk.vector.length === 0) continue;
    const sim = dotProduct(qVec, chunk.vector);
    if (sim > 0) {
      hits.push({
        chunk,
        score: sim,
        bm25Score: 0,
        denseScore: sim,
        structuredScore: 0,
        matchedTerms: [],
        rank: 0,
      });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((h, idx) => ({ ...h, rank: idx + 1 }));
}

export function filterStructured(corpus: CorpusV2, query: ResearchQuery, index?: ChunksIndex, k = 15): RetrievalHit[] {
  const invById = new Map(corpus.investigations.map((i) => [i.id, i]));
  const testById = new Map(corpus.tests.map((t) => [t.testId, t]));
  const chunks = index?.chunks ?? buildSynthesizedChunksIndex(corpus).chunks;

  const hits: RetrievalHit[] = [];
  for (const chunk of chunks) {
    let score = 0;
    const inv = chunk.inv ? invById.get(chunk.inv) : undefined;
    const test = chunk.testId ? testById.get(chunk.testId) : undefined;

    if (query.targetInvIds?.length && chunk.inv && query.targetInvIds.includes(chunk.inv)) score += 0.6;
    if (query.fuelPhase && inv?.fuelPhase === query.fuelPhase) score += 0.35;
    if (query.material && (inv?.fuel?.types.some((ft) => materialsCompatible(query.material, ft)) || (test && materialsCompatible(query.material, test.fuel)))) {
      score += 0.45;
    }
    if (test) {
      if (query.o2Pct !== null && test.atmosphere.o2.value !== null && Math.abs(query.o2Pct - test.atmosphere.o2.value) <= 3.0) {
        score += 0.25;
      }
      if (query.pressureKpa !== null && test.atmosphere.pressure.value !== null && Math.abs(query.pressureKpa - test.atmosphere.pressure.value) <= 15) {
        score += 0.2;
      }
      if (query.o2Role === (test.atmosphere.o2.role ?? 'ambient')) score += 0.1;
    }
    if (chunk.epistemicStatus === 'observed') score += 0.1;
    if (inv && inv.epistemicStatus === 'planned_only') score *= 0.6;

    if (score >= 0.35) {
      hits.push({
        chunk,
        score,
        bm25Score: 0,
        denseScore: 0,
        structuredScore: score,
        matchedTerms: [],
        rank: 0,
      });
    }
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((h, idx) => ({ ...h, rank: idx + 1 }));
}

export interface HybridSearchOptions {
  k?: number;
  mode?: RetrievalMode;
  rrfK?: number;
}

export function searchHybrid(
  corpus: CorpusV2,
  index: ChunksIndex,
  queryInput: ResearchQuery | string,
  opts: HybridSearchOptions = {},
): RetrievalHit[] {
  const k = opts.k ?? 12;
  const mode = opts.mode ?? 'hybrid';
  const rrfK = opts.rrfK ?? 60;

  const query = typeof queryInput === 'string' ? parseResearchQuery(queryInput) : queryInput;
  const queryText = query.rawQuestion;

  if (mode === 'bm25') return searchBm25(index, queryText, k);
  if (mode === 'structured') return filterStructured(corpus, query, index, k);

  const bm25Hits = searchBm25(index, queryText, Math.max(k * 2, 24));
  const denseHits = searchDense(index, queryText, Math.max(k * 2, 24));
  const structHits = filterStructured(corpus, query, index, Math.max(k * 2, 24));

  const merged = new Map<string, RetrievalHit>();
  const addList = (list: RetrievalHit[], channel: 'bm25' | 'dense' | 'structured') => {
    for (const h of list) {
      const existing = merged.get(h.chunk.chunkId) ?? {
        chunk: h.chunk,
        score: 0,
        bm25Score: 0,
        denseScore: 0,
        structuredScore: 0,
        matchedTerms: [],
        rank: 0,
      };
      existing.score += 1 / (rrfK + h.rank);
      if (channel === 'bm25') {
        existing.bm25Score = h.bm25Score;
        existing.matchedTerms = h.matchedTerms;
      } else if (channel === 'dense') {
        existing.denseScore = h.denseScore;
      } else {
        existing.structuredScore = h.structuredScore;
      }
      merged.set(h.chunk.chunkId, existing);
    }
  };

  addList(bm25Hits, 'bm25');
  addList(denseHits, 'dense');
  addList(structHits, 'structured');

  const seenText = new Set<string>();
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .filter((hit) => {
      const norm = `${hit.chunk.testId ?? ''}::${hit.chunk.text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
      if (seenText.has(norm)) return false;
      seenText.add(norm);
      return true;
    })
    .slice(0, k)
    .map((h, idx) => ({ ...h, rank: idx + 1 }));
}

/** Synthesizes a fallback ChunksIndex directly from CorpusV2 when chunks_index.json is omitted. */
export function buildSynthesizedChunksIndex(corpus: CorpusV2): ChunksIndex {
  const chunks: ChunkRecord[] = [];
  for (const claim of corpus.claims) {
    chunks.push({
      chunkId: claim.id,
      kind: 'claim',
      inv: claim.inv,
      testId: claim.evidenceIds[0] ?? null,
      epistemicStatus: claim.epistemicStatus,
      sectionHeader: claim.conditionsScope || claim.inv,
      tableUnits: null,
      text: `${claim.text} ${claim.conditionsScope} ${claim.topics.join(' ')}`,
      vector: [],
      sourceRef: claim.sourceRef,
    });
  }
  for (const inv of corpus.investigations) {
    chunks.push({
      chunkId: `card:${inv.id}`,
      kind: 'investigation_card',
      inv: inv.id,
      testId: null,
      epistemicStatus: inv.epistemicStatus === 'planned_only' ? 'planned' : 'observed',
      sectionHeader: `${inv.id}: ${inv.name}`,
      tableUnits: 'O2 %, pressure kPa, flow cm/s',
      text: [inv.id, inv.name, inv.objective, inv.resultSummary, inv.methodSummary, ...inv.limitations, ...inv.dataNotes]
        .filter(Boolean)
        .join(' '),
      vector: [],
      sourceRef: {
        sourceId: inv.sources[0]?.id ?? inv.id,
        url: inv.psiUrl ?? inv.sources[0]?.url ?? null,
        doi: inv.doi,
      },
    });
  }
  return {
    corpusVersion: corpus.corpusVersion,
    embeddingModel: 'bm25-fallback',
    embeddingDim: 0,
    vocabulary: {},
    idf: [],
    svdComponents: [],
    chunks,
  };
}
