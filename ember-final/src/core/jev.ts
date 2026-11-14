/**
 * Legacy-compatible passage triage interface; default implementation is heuristic:
 * Evaluates 3 bounded atomic questions (Q1_RELEVANCE, Q2_OBSERVATION, Q3_CONTRADICTION)
 * with heuristic scores (NOT domain-calibrated probabilities) and explicit routing
 * to "evidence" | "context" | "conflict". Conflicts are NEVER silently deleted.
 */
import { materialsCompatible } from './applicability';
import { tokenizeBm25 } from './retrieval';
import type {
  ChunkRecord,
  CorpusV2,
  JevPassageDecision,
  JevQuestionScore,
  JevRoute,
  Q1Answer,
  Q2Answer,
  Q3Answer,
  ResearchQuery,
} from './types';

export const JEV_PROMPT_VERSION = 'heuristic-triage-v1' as const;

export interface JevOptions {
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
  corpus?: CorpusV2;
  fetchImpl?: typeof fetch;
  strictLive?: boolean;
}

function softmax<T extends string>(logits: Record<T, number>): Record<T, number> {
  const keys = Object.keys(logits) as T[];
  const maxLogit = Math.max(...keys.map((k) => logits[k]));
  const exps: Record<string, number> = {};
  let sum = 0;
  for (const k of keys) {
    const val = Math.exp(logits[k] - maxLogit);
    exps[k] = val;
    sum += val;
  }
  const out = {} as Record<T, number>;
  for (const k of keys) {
    out[k] = Number((exps[k] / (sum || 1)).toFixed(4));
  }
  return out;
}

function pickBest<T extends string>(probs: Record<T, number>): JevQuestionScore<T> {
  const entries = Object.entries(probs) as [T, number][];
  entries.sort((a, b) => b[1] - a[1]);
  return {
    answer: entries[0][0],
    probabilities: probs,
    confidence: entries[0][1],
  };
}

function scoreQ1(query: ResearchQuery, chunk: ChunkRecord, corpus?: CorpusV2): JevQuestionScore<Q1Answer> {
  const qToks = new Set(tokenizeBm25(query.rawQuestion));
  const cToks = new Set(tokenizeBm25(`${chunk.sectionHeader ?? ''} ${chunk.text} ${chunk.inv ?? ''}`));
  let overlap = 0;
  for (const t of qToks) {
    if (cToks.has(t)) overlap += 1;
  }
  const overlapRatio = qToks.size > 0 ? overlap / qToks.size : 0;

  let invPhaseMatch = false;
  let invMaterialMatch = false;
  if (corpus && chunk.inv) {
    const inv = corpus.investigations.find((i) => i.id === chunk.inv);
    if (inv) {
      invPhaseMatch = query.fuelPhase !== null && inv.fuelPhase === query.fuelPhase;
      invMaterialMatch = query.material !== null && inv.fuel?.types.some((f) => materialsCompatible(query.material, f)) === true;
    }
  } else {
    if (query.material && new RegExp(query.material, 'i').test(chunk.text)) invMaterialMatch = true;
    if (query.fuelPhase && new RegExp(query.fuelPhase, 'i').test(chunk.text)) invPhaseMatch = true;
  }

  const invExplicitlyAsked = chunk.inv ? new RegExp(chunk.inv.replace('-', '[-\\s]?'), 'i').test(query.rawQuestion) : false;

  const directLogit =
    -0.6 +
    3.2 * overlapRatio +
    (invMaterialMatch ? 1.1 : 0) +
    (invPhaseMatch ? 0.6 : 0) +
    (invExplicitlyAsked ? 1.4 : 0);
  const partialLogit = 0.2 + 1.5 * overlapRatio + (invPhaseMatch ? 0.5 : 0);
  const irrelevantLogit = 0.8 - 2.6 * overlapRatio - (invMaterialMatch ? 1.0 : 0) - (invExplicitlyAsked ? 1.2 : 0);

  return pickBest(
    softmax<Q1Answer>({
      direct_match: directLogit,
      partial_context: partialLogit,
      not_relevant: irrelevantLogit,
    }),
  );
}

function scoreQ2(chunk: ChunkRecord, corpus?: CorpusV2): JevQuestionScore<Q2Answer> {
  const txt = `${chunk.epistemicStatus} ${chunk.sectionHeader ?? ''} ${chunk.text}`.toLowerCase();
  const invPlanned = corpus?.investigations.find((i) => i.id === chunk.inv)?.epistemicStatus === 'planned_only';

  const isPlanned =
    invPlanned ||
    chunk.epistemicStatus === 'planned' ||
    chunk.epistemicStatus === 'planned_only' ||
    chunk.epistemicStatus === 'hypothesis' ||
    /\bplanned\b|will\s+be\s+examined|\bobjective\s*\d*\s*:|hypothesis|proposed\s+matrix|not\s+yet\s+flown/.test(txt);

  const isAssumedOrMethod =
    /\bassumed\b|assumption|iss\s+cabin\s+air\s+assumed|apparatus|hardware\s+description|method\s+summary|diagnostic/.test(txt) ||
    chunk.kind === 'method';

  const isObserved =
    !isPlanned &&
    (chunk.epistemicStatus === 'observed' ||
      /\bobserved\b|\bmeasured\b|\bflight\s+tests?\b|\bspread\s+rate|\bextinguished\b|\bburned\b|\bquench/.test(txt));

  return pickBest(
    softmax<Q2Answer>({
      observed_finding: isObserved ? 2.1 : isPlanned ? -1.4 : 0.1,
      planned_or_hypothesis: isPlanned ? 2.4 : -1.2,
      method_or_assumption: isAssumedOrMethod ? 2.0 : -0.6,
    }),
  );
}

function scoreQ3(query: ResearchQuery, chunk: ChunkRecord): JevQuestionScore<Q3Answer> {
  const txt = `${chunk.sectionHeader ?? ''} ${chunk.text}`.toLowerCase();
  let tensionScore = -1.1;

  if (/discrepancy|inconsistent|conflict|contradict|not\s+conservative|artefact|caution|warning/.test(txt)) {
    tensionScore += 2.6;
  }
  if (/inverse\s+flame|oxidizer\s+stream/.test(txt) && query.o2Role === 'ambient') {
    tensionScore += 2.2;
  }
  if (/cool[-\s]*flame/.test(txt) && /completely\s+(?:ceased|stopped)|no\s+combustion\s+after/.test(txt)) {
    tensionScore += 1.9;
  }
  if (/flow\s+turned\s+off|operator\s+shutoff|flow_turned_off/.test(txt) && (query.targetEndpoint === 'quench_limit' || query.targetEndpoint === 'extinction_under_flow_change')) {
    tensionScore += 2.1;
  }
  if (/e-field|electric[-\s]*field/.test(txt) && query.gravityRegime === 'partial_gravity') {
    tensionScore += 2.1;
  }
  if (/unknown|not\s+reported|no\s+outcome/.test(txt)) {
    return pickBest(
      softmax<Q3Answer>({
        consistent: -0.6,
        tension_or_conflict: tensionScore,
        insufficient_to_judge: 1.5,
      }),
    );
  }

  return pickBest(
    softmax<Q3Answer>({
      consistent: tensionScore > 0.4 ? -0.5 : 1.7,
      tension_or_conflict: tensionScore,
      insufficient_to_judge: -0.2,
    }),
  );
}

export function routeJevDecision(
  q1: JevQuestionScore<Q1Answer>,
  q2: JevQuestionScore<Q2Answer>,
  q3: JevQuestionScore<Q3Answer>,
): JevRoute {
  if (q3.answer === 'tension_or_conflict' && q1.answer !== 'not_relevant') {
    return 'conflict';
  }
  if (q1.answer === 'direct_match' && q2.answer === 'observed_finding') {
    return 'evidence';
  }
  return 'context';
}

export function evaluatePassageWithJevOffline(
  query: ResearchQuery,
  chunk: ChunkRecord,
  options: Pick<JevOptions, 'corpus'> = {},
): JevPassageDecision {
  const t0 = Date.now();
  const q1Relevance = scoreQ1(query, chunk, options.corpus);
  const q2Observation = scoreQ2(chunk, options.corpus);
  const q3Contradiction = scoreQ3(query, chunk);
  const route = routeJevDecision(q1Relevance, q2Observation, q3Contradiction);
  const concentrationConfidence = Number(
    ((q1Relevance.confidence + q2Observation.confidence + q3Contradiction.confidence) / 3).toFixed(4),
  );

  return {
    chunkId: chunk.chunkId,
    inv: chunk.inv,
    testId: chunk.testId,
    q1Relevance,
    q2Observation,
    q3Contradiction,
    route,
    concentrationConfidence,
    promptVersion: JEV_PROMPT_VERSION,
    evaluatorMode: 'deterministic_offline',
    latencyMs: Math.max(0, Date.now() - t0),
    sourceRef: chunk.sourceRef,
  };
}

function buildJevPrompt(query: ResearchQuery, chunk: ChunkRecord): string {
  return JSON.stringify({
    promptVersion: JEV_PROMPT_VERSION,
    query: {
      question: query.rawQuestion,
      material: query.material,
      fuelPhase: query.fuelPhase,
      targetEndpoint: query.targetEndpoint,
      o2Pct: query.o2Pct,
      o2Role: query.o2Role,
      pressureKpa: query.pressureKpa,
      gravityRegime: query.gravityRegime,
    },
    passage: {
      chunkId: chunk.chunkId,
      inv: chunk.inv,
      epistemicStatus: chunk.epistemicStatus,
      sectionHeader: chunk.sectionHeader,
      text: chunk.text,
    },
    questions: {
      Q1_RELEVANCE: ['direct_match', 'partial_context', 'not_relevant'],
      Q2_OBSERVATION: ['observed_finding', 'planned_or_hypothesis', 'method_or_assumption'],
      Q3_CONTRADICTION: ['consistent', 'tension_or_conflict', 'insufficient_to_judge'],
    },
  });
}

const JEV_SYSTEM =
  'You are a bounded scientific passage evaluator (jev-v1.0). Reply strictly as JSON with keys q1Relevance, q2Observation, q3Contradiction, each having { answer, probabilities, confidence }. Never fabricate IDs.';

export async function evaluatePassageWithJev(
  query: ResearchQuery,
  chunk: ChunkRecord,
  options: JevOptions = {},
): Promise<JevPassageDecision> {
  if (!options.apiKey && !options.proxyUrl) {
    return evaluatePassageWithJevOffline(query, chunk, options);
  }

  const t0 = Date.now();
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.apiKey ? 'https://api.openai.com/v1/chat/completions' : options.proxyUrl!;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: options.model ?? 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        temperature: 0,
        messages: [
          { role: 'system', content: JEV_SYSTEM },
          { role: 'user', content: buildJevPrompt(query, chunk) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const payload = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error('Empty live JEV response');

    const parsed = JSON.parse(content) as Pick<JevPassageDecision, 'q1Relevance' | 'q2Observation' | 'q3Contradiction'>;
    if (!parsed.q1Relevance?.answer || !parsed.q2Observation?.answer || !parsed.q3Contradiction?.answer) {
      throw new Error('Malformed live JEV JSON');
    }
    const route = routeJevDecision(parsed.q1Relevance, parsed.q2Observation, parsed.q3Contradiction);
    const concentrationConfidence = Number(
      ((parsed.q1Relevance.confidence + parsed.q2Observation.confidence + parsed.q3Contradiction.confidence) / 3).toFixed(4),
    );
    return {
      chunkId: chunk.chunkId,
      inv: chunk.inv,
      testId: chunk.testId,
      q1Relevance: parsed.q1Relevance,
      q2Observation: parsed.q2Observation,
      q3Contradiction: parsed.q3Contradiction,
      route,
      concentrationConfidence,
      promptVersion: JEV_PROMPT_VERSION,
      evaluatorMode: 'live_openai',
      latencyMs: Math.max(0, Date.now() - t0),
      sourceRef: chunk.sourceRef,
    };
  } catch (err) {
    if (options.strictLive) throw err;
    return evaluatePassageWithJevOffline(query, chunk, options);
  }
}
