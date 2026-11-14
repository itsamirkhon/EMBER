/**
 * Grounded synthesis generator with explicit mode ("LIVE_AI" | "DETERMINISTIC_ENGINE" | "SAVED_DEMO_SNAPSHOT")
 * and strict epistemic separation into observedFact / authorInterpretation / engineeringImplication /
 * applicabilityConditions / openQuestions.
 */
import type {
  AnswerBoundary,
  ConflictSummaryItem,
  EvidencePackage,
  GeneratedSynthesis,
  SynthesisClaimItem,
  SynthesisMode,
} from './types';

export const DEFAULT_SYNTHESIS_MODEL = 'gpt-6-luna';

export interface GeneratorOptions {
  mode?: SynthesisMode;
  apiKey?: string;
  proxyUrl?: string;
  model?: string;
  savedSnapshot?: GeneratedSynthesis;
  fetchImpl?: typeof fetch;
  strictLive?: boolean;
}

function isInvalidPremise(pkg: EvidencePackage): { invalid: boolean; reason: string | null } {
  const qText = pkg.query.rawQuestion.toLowerCase();
  if (/rocket|propellant\s+fire|solid\s+rocket\s+motor/.test(qText)) {
    return { invalid: true, reason: 'Rocket propulsion and propellant fire safety are explicitly outside spacecraft cabin scope.' };
  }
  if (/e-field/i.test(qText) && pkg.query.gravityRegime === 'partial_gravity' && /validat|certif|prove|cabin|lunar|mars/.test(qText)) {
    return {
      invalid: true,
      reason: 'ACME E-FIELD Flames (electric-field analogue on microgravity gas burners) cannot validate lunar/Martian partial-gravity cabin flammability.',
    };
  }
  if (/cfi-g|inverse\s+flame/i.test(qText) && /cabin|ambient\s+o2|solid\s+material/i.test(qText) && /85\s*%/.test(qText)) {
    return {
      invalid: true,
      reason: 'ACME-CFI-G inverse flame O2 values (up to 85%) represent burner oxidizer_stream feed, not spacecraft ambient O2.',
    };
  }
  return { invalid: false, reason: null };
}

export function determineAnswerBoundary(pkg: EvidencePackage): AnswerBoundary {
  const premise = isInvalidPremise(pkg);
  if (premise.invalid) return 'invalid_premise';

  const targetSet = pkg.query.targetInvIds?.length ? new Set(pkg.query.targetInvIds) : null;
  const scopedRankings = targetSet ? pkg.rankings.filter((r) => targetSet.has(r.inv.id)) : pkg.rankings;
  const scopedDecisions = targetSet
    ? pkg.applicabilityDecisions.filter((d) => targetSet.has(d.inv))
    : pkg.applicabilityDecisions;
  const scopedEvidence = targetSet
    ? pkg.evidenceChunks.filter((c) => c.inv !== null && targetSet.has(c.inv))
    : pkg.evidenceChunks;

  const admissibleCount = scopedDecisions.filter((d) => d.verdict === 'admissible').length;
  const conditionalCount = scopedDecisions.filter((d) => d.verdict === 'conditional_support').length;
  const observedEvCount = scopedEvidence.length;
  const hasObservedTopInv = scopedRankings.some((r) => r.inv.epistemicStatus === 'observed' && r.applicabilityScore >= 0.4);

  if (admissibleCount > 0 && (observedEvCount > 0 || hasObservedTopInv)) {
    return 'sufficient_observed';
  }
  if (
    conditionalCount > 0 ||
    (observedEvCount > 0 && scopedRankings.some((r) => r.status !== 'planned_only' && r.status !== 'inadmissible'))
  ) {
    return 'conditional_or_partial';
  }
  return 'insufficient_data';
}

function sanitizeChunkSnippet(raw: string, maxLen: number): string {
  const clean = raw
    .replace(/\s+/g, ' ')
    .replace(/\[([^\]]+)\]/g, '($1)')
    .trim();
  return clean.length > maxLen ? `${clean.slice(0, maxLen - 3)}...` : clean;
}

function buildObservedFacts(pkg: EvidencePackage): SynthesisClaimItem[] {
  const facts: SynthesisClaimItem[] = [];
  const usedIds = new Set<string>();

  for (const ev of pkg.evidenceChunks.slice(0, 4)) {
    if (ev.q2Observation.answer !== 'observed_finding') continue;
    const hit = pkg.retrievedHits.find((h) => h.chunk.chunkId === ev.chunkId);
    if (!hit) continue;
    if (pkg.rankings.some((r) => r.inv.id === hit.chunk.inv && r.inv.epistemicStatus === 'planned_only')) continue;

    const snippet = sanitizeChunkSnippet(hit.chunk.text, 260);
    const id = `fact-${facts.length + 1}`;
    facts.push({
      id,
      text: `${snippet} [${hit.chunk.chunkId}]`,
      citations: [hit.chunk.chunkId],
      provenance: 'reported',
    });
    usedIds.add(hit.chunk.chunkId);
  }

  const admissibleDecisions = pkg.applicabilityDecisions.filter((d) => d.verdict === 'admissible').slice(0, 3);
  const conditionalDecisions = pkg.applicabilityDecisions.filter((d) => d.verdict === 'conditional_support').slice(0, 2);
  const testLookup = new Map((pkg.evaluatedTests ?? []).map((t) => [t.testId, t]));

  for (const dec of [...admissibleDecisions, ...conditionalDecisions]) {
    if (facts.length >= 6) break;
    if (usedIds.has(dec.testId)) continue;
    const t = testLookup.get(dec.testId);
    if (!t) continue;
    const o2Str = t.atmosphere.o2.value !== null ? `${t.atmosphere.o2.value}% O2 (${t.atmosphere.o2.role}, ${t.atmosphere.o2.provenance})` : 'O2 unknown';
    const pStr = t.atmosphere.pressure.value !== null ? `${t.atmosphere.pressure.value} kPa (${t.atmosphere.pressure.provenance})` : 'pressure unknown';
    const flowStr = t.flow.initialFlowCmS.value !== null ? `${t.flow.initialFlowCmS.value} cm/s (${t.flow.direction}, ${t.flow.history})` : 'flow unknown';
    const ratePart =
      t.spreadRateMmS.value !== null
        ? `, spread rate ${t.spreadRateMmS.value} mm/s`
        : t.burningRateMm2S.value !== null
          ? `, burning-rate constant ${t.burningRateMm2S.value} mm²/s`
          : t.particleSizeNm.value !== null
            ? `, smoke particle diameter ${t.particleSizeNm.value} nm`
            : t.smokePointLengthMm.value !== null
              ? `, smoke-point length ${t.smokePointLengthMm.value} mm`
              : '';

    facts.push({
      id: `fact-${facts.length + 1}`,
      text: `Test ${t.testId} (${t.inv}, ${t.fuel ?? 'unspecified fuel'}, ${t.geometry ?? 'unspecified geometry'}) at ${o2Str}, ${pStr}, ${flowStr} recorded initial outcome ${t.initialOutcome}${t.terminalEvent ? ` and terminal event ${t.terminalEvent}` : ''}${ratePart} [${t.testId}].`,
      citations: [t.testId],
      provenance: t.atmosphere.o2.provenance === 'assumed' ? 'assumed' : 'reported',
    });
    usedIds.add(t.testId);
  }

  return facts;
}

function buildAuthorInterpretations(pkg: EvidencePackage): SynthesisClaimItem[] {
  const out: SynthesisClaimItem[] = [];
  for (const ctx of pkg.contextChunks.slice(0, 4)) {
    const hit = pkg.retrievedHits.find((h) => h.chunk.chunkId === ctx.chunkId);
    if (!hit) continue;
    const snippet = sanitizeChunkSnippet(hit.chunk.text, 220);
    const prefix =
      ctx.q2Observation.answer === 'planned_or_hypothesis'
        ? 'Planned scope / hypothesis (not observed flight data)'
        : ctx.q2Observation.answer === 'method_or_assumption'
          ? 'Methodological context / assumption'
          : 'Author interpretation / contextual finding';
    out.push({
      id: `interp-${out.length + 1}`,
      text: `${prefix}: ${snippet} [${hit.chunk.chunkId}]`,
      citations: [hit.chunk.chunkId],
      provenance: ctx.q2Observation.answer === 'planned_or_hypothesis' ? 'planned' : 'interpretation',
    });
  }
  return out;
}

function buildEngineeringImplications(
  pkg: EvidencePackage,
  boundary: AnswerBoundary,
  observedFact: SynthesisClaimItem[],
): SynthesisClaimItem[] {
  const out: SynthesisClaimItem[] = [];
  const topInv = pkg.rankings[0];
  const citeFallback = observedFact[0]?.citations ?? (topInv ? [`card:${topInv.inv.id}`] : []);

  const premise = isInvalidPremise(pkg);
  if (premise.invalid && premise.reason) {
    out.push({
      id: 'imp-1',
      text: `Invalid transfer premise rejected: ${premise.reason}${citeFallback.length ? ` [${citeFallback[0]}]` : ''}`,
      citations: citeFallback,
      provenance: 'interpretation',
    });
    return out;
  }

  if (boundary === 'insufficient_data') {
    out.push({
      id: 'imp-1',
      text: `Insufficient observed PSI flight evidence directly satisfies the queried conditions (${pkg.query.material ?? 'unspecified material'}, ${pkg.query.o2Pct !== null ? `${pkg.query.o2Pct}% O2` : 'O2 unspecified'}, ${pkg.query.pressureKpa !== null ? `${pkg.query.pressureKpa} kPa` : 'pressure unspecified'}); do not treat planned matrices or inadmissible analogues as measured safety proof.${citeFallback.length ? ` [${citeFallback[0]}]` : ''}`,
      citations: citeFallback,
      provenance: 'interpretation',
    });
    return out;
  }

  const admCount = pkg.applicabilityDecisions.filter((d) => d.verdict === 'admissible').length;
  const condCount = pkg.applicabilityDecisions.filter((d) => d.verdict === 'conditional_support').length;
  const topCite = citeFallback[0] ?? (topInv ? `card:${topInv.inv.id}` : 'engine-summary');

  out.push({
    id: 'imp-1',
    text: `Engineering boundary (${boundary}): ${admCount} directly admissible and ${condCount} conditionally supporting test records inform ${pkg.query.safetyTask.replace(/_/g, ' ')} for ${pkg.query.habitableEnvironment.replace(/_/g, ' ')} [${topCite}].`,
    citations: [topCite],
    provenance: 'interpretation',
  });

  if (pkg.query.gravityRegime === 'partial_gravity') {
    out.push({
      id: 'imp-2',
      text: `No actual partial-gravity (${pkg.query.gravityG ?? 'lunar/Mars'} g) tests exist in PSI; bracket design decisions cautiously between 0 g and 1 g observations without unvalidated O2 margins or E-FIELD transfer [${topCite}].`,
      citations: [topCite],
      provenance: 'interpretation',
    });
  }
  return out;
}

function buildApplicabilityConditions(pkg: EvidencePackage): string[] {
  const conds = new Set<string>(pkg.query.validationWarnings);
  const codeMessages: Record<string, string> = {
    oxidizer_stream_vs_ambient: 'RULE-GAS-01: Excluded oxidizer_stream burner O2 data (e.g., ACME-CFI-G inverse flames) from ambient cabin O2 comparisons.',
    simulated_analogue_gravity: 'RULE-GRAV-01: Excluded ACME-E-FIELD electric-field simulated analogue from partial-gravity cabin material validation.',
    gravity_regime_gap: 'RULE-GRAV-01: Partial-gravity target lacks direct flight data; microgravity/1g findings are conditional.',
    operator_termination_not_physical_extinction: 'RULE-PROT-01: Separated operator flow shutoff (flow_turned_off / FT) from physical quench/blowoff limits.',
    cool_flame_continuation_caveat: 'RULE-PROT-01: Flagged cool-flame continuation (segment 2) following hot-flame extinction (segment 1) in droplet tests.',
    unsupported_joint_combination: 'RULE-JOINT-01: Detected unsupported joint (O2, pressure, flow) combination despite 1D marginal range overlap.',
    assumed_provenance_cap: 'RULE-PROV-01: Capped assumed-atmosphere investigations (SAME/SAME-R) at conditional_support.',
    planned_only_matrix: 'Epistemic gate: Excluded planned-only matrix (FLEX-2) from observed experimental proof.',
    unknown_field_mismatch: 'RULE-UNK-01: Enforced unknown !== unknown; unrecorded fields never count as matched.',
    thickness_regime_mismatch: 'RULE-GEOM-01: Separated thermally thin films (<=0.5 mm) from thick slabs (>=2 mm) and cylindrical rods.',
    enclosure_scale_mismatch: 'RULE-GEOM-01: Flagged enclosure scale difference between small MSG flow duct and large Cygnus volume.',
  };
  for (const dec of pkg.applicabilityDecisions) {
    for (const code of dec.reasonCodes) {
      if (codeMessages[code]) conds.add(codeMessages[code]);
    }
  }
  return [...conds];
}

function buildConflictsPreserved(pkg: EvidencePackage): ConflictSummaryItem[] {
  return pkg.conflictChunks.map((c) => {
    const hit = pkg.retrievedHits.find((h) => h.chunk.chunkId === c.chunkId);
    const txt = hit?.chunk.text.replace(/\s+/g, ' ').trim() ?? `Conflict detected for ${c.chunkId}`;
    return {
      chunkId: c.chunkId,
      inv: c.inv,
      summary: txt.length > 220 ? `${txt.slice(0, 217)}...` : txt,
      sourceRef: c.sourceRef,
    };
  });
}

export function generateDeterministicSynthesis(pkg: EvidencePackage): GeneratedSynthesis {
  const answerBoundary = determineAnswerBoundary(pkg);
  const observedFact = answerBoundary === 'invalid_premise' ? [] : buildObservedFacts(pkg);
  const authorInterpretation = buildAuthorInterpretations(pkg);
  const engineeringImplication = buildEngineeringImplications(pkg, answerBoundary, observedFact);
  const applicabilityConditions = buildApplicabilityConditions(pkg);
  const openQuestions = [
    ...pkg.gaps,
    ...pkg.query.unknownFields.map((f) => `Unspecified query parameter: ${f}`),
  ];
  const conflictsPreserved = buildConflictsPreserved(pkg);

  const rawSummary = [
    ...observedFact.map((f) => f.text),
    ...engineeringImplication.map((i) => i.text),
  ].join(' ');

  return {
    mode: 'DETERMINISTIC_ENGINE',
    answerBoundary,
    observedFact,
    authorInterpretation,
    engineeringImplication,
    applicabilityConditions,
    openQuestions: [...new Set(openQuestions)],
    conflictsPreserved,
    rawSummary: rawSummary || 'No directly supporting observed evidence found in PSI corpus.',
    modelName: null,
  };
}

export async function generateSynthesis(
  pkg: EvidencePackage,
  options: GeneratorOptions = {},
): Promise<GeneratedSynthesis> {
  if (options.mode === 'SAVED_DEMO_SNAPSHOT' && options.savedSnapshot) {
    return {
      ...options.savedSnapshot,
      mode: 'SAVED_DEMO_SNAPSHOT',
      conflictsPreserved:
        options.savedSnapshot.conflictsPreserved.length > 0
          ? options.savedSnapshot.conflictsPreserved
          : buildConflictsPreserved(pkg),
    };
  }

  const useLive = (options.mode === 'LIVE_AI' || !!options.apiKey || !!options.proxyUrl) && options.mode !== 'DETERMINISTIC_ENGINE';
  if (!useLive || (!options.apiKey && !options.proxyUrl)) {
    return generateDeterministicSynthesis(pkg);
  }

  const det = generateDeterministicSynthesis(pkg);
  const model = options.model ?? DEFAULT_SYNTHESIS_MODEL;
  const fetchFn = options.fetchImpl ?? globalThis.fetch;
  const endpoint = options.apiKey ? 'https://api.openai.com/v1/chat/completions' : options.proxyUrl!;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (options.apiKey) headers.Authorization = `Bearer ${options.apiKey}`;

  const promptPayload = {
    question: pkg.query.rawQuestion,
    answerBoundary: det.answerBoundary,
    applicabilityConditions: det.applicabilityConditions,
    evidence: pkg.retrievedHits.slice(0, 8).map((h) => ({
      id: h.chunk.chunkId,
      inv: h.chunk.inv,
      epistemicStatus: h.chunk.epistemicStatus,
      text: h.chunk.text,
    })),
    conflicts: det.conflictsPreserved,
  };

  try {
    const res = await fetchFn(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        response_format: { type: 'json_object' },
        ...(model === DEFAULT_SYNTHESIS_MODEL ? {reasoning_effort:'none'} : {temperature:0}),
        messages: [
          {
            role: 'system',
            content:
              'You are EMBER. Synthesize ONLY from the provided JSON evidence. Return JSON with observedFact, authorInterpretation, engineeringImplication (arrays of {id,text,citations,provenance}), applicabilityConditions (string[]), openQuestions (string[]), rawSummary (string). Every sentence must cite exact provided ids in brackets [id]. Never present planned items as observed.',
          },
          { role: 'user', content: JSON.stringify(promptPayload) },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error('Empty synthesis response');
    const parsed = JSON.parse(raw) as Partial<GeneratedSynthesis>;

    return {
      mode: 'LIVE_AI',
      answerBoundary: det.answerBoundary,
      observedFact: Array.isArray(parsed.observedFact) ? parsed.observedFact : det.observedFact,
      authorInterpretation: Array.isArray(parsed.authorInterpretation) ? parsed.authorInterpretation : det.authorInterpretation,
      engineeringImplication: Array.isArray(parsed.engineeringImplication) ? parsed.engineeringImplication : det.engineeringImplication,
      applicabilityConditions: Array.isArray(parsed.applicabilityConditions) ? parsed.applicabilityConditions : det.applicabilityConditions,
      openQuestions: Array.isArray(parsed.openQuestions) ? parsed.openQuestions : det.openQuestions,
      conflictsPreserved: det.conflictsPreserved,
      rawSummary: typeof parsed.rawSummary === 'string' ? parsed.rawSummary : det.rawSummary,
      modelName: model,
    };
  } catch (err) {
    if (options.strictLive) throw err;
    return det;
  }
}
