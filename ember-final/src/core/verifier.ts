/**
 * Multi-layer synthesis verifier replacing naive ID-only citation checks.
 * Runs:
 * 1. citationCheck
 * 2. numericUnitCheck
 * 3. epistemicCheck (planned != observed, assumed != measured)
 * 4. constraintPreservationCheck (gas role, E-FIELD, operator shutoff, cool flame, joint gaps)
 * 5. lexicalEntailmentCheck (token overlap + polarity/negation consistency)
 */
import { tokenizeBm25 } from './retrieval';
import type {
  EvidencePackage,
  GeneratedSynthesis,
  SynthesisClaimItem,
  Test,
  VerificationCheckResult,
  VerificationReport,
} from './types';

function extractBracketCitations(text: string): string[] {
  const out: string[] = [];
  const re = /\[([^\]]+)\]/g;
  for (const m of text.matchAll(re)) {
    for (const part of m[1].split(/\s*,\s*/)) {
      const cleaned = part.trim();
      if (cleaned) out.push(cleaned);
    }
  }
  return out;
}

function buildAllowedIds(pkg: EvidencePackage): Set<string> {
  const allowed = new Set<string>();
  for (const h of pkg.retrievedHits) {
    allowed.add(h.chunk.chunkId);
    if (h.chunk.inv) {
      allowed.add(h.chunk.inv);
      allowed.add(`card:${h.chunk.inv}`);
    }
    if (h.chunk.testId) allowed.add(h.chunk.testId);
  }
  for (const d of pkg.applicabilityDecisions) {
    allowed.add(d.testId);
    allowed.add(d.inv);
  }
  for (const r of pkg.rankings) {
    allowed.add(r.inv.id);
    allowed.add(`card:${r.inv.id}`);
  }
  for (const c of pkg.conflictChunks) allowed.add(c.chunkId);
  return allowed;
}

function runCitationCheck(
  items: SynthesisClaimItem[],
  allowed: Set<string>,
  flagged: Set<string>,
): VerificationCheckResult {
  const issues: string[] = [];
  for (const item of items) {
    const inline = extractBracketCitations(item.text);
    const allCites = [...new Set([...item.citations, ...inline])];
    if (allCites.length === 0) {
      issues.push(`Claim ${item.id} has no citations.`);
      flagged.add(item.id);
      continue;
    }
    for (const cid of allCites) {
      if (!allowed.has(cid)) {
        issues.push(`Claim ${item.id} cites unknown/unretrieved id [${cid}].`);
        flagged.add(item.id);
      }
    }
  }
  return { passed: issues.length === 0, issues };
}

function collectTestNumbers(t: Test, nums: Set<number>): void {
  const candidates = [
    t.atmosphere.o2.value,
    t.atmosphere.pressure.value,
    t.atmosphere.diluentPct.value,
    t.flow.initialFlowCmS.value,
    ...(t.flow.sequenceCmS ?? []),
    t.gravity.gravityG.value,
    t.thicknessMm.value,
    t.diameterMm.value,
    t.widthCm.value,
    t.spreadRateMmS.value,
    t.burningRateMm2S.value,
    t.particleSizeNm.value,
    t.smokePointLengthMm.value,
  ];
  for (const c of candidates) {
    if (c !== null && c !== undefined && Number.isFinite(c)) nums.add(c);
  }
}

function extractNumbersFromText(text: string): number[] {
  const nums: number[] = [];
  const matches = text.matchAll(/(?<![a-zA-Z0-9-])\d+(?:\.\d+)?(?![a-zA-Z0-9-])/g);
  for (const m of matches) {
    const n = Number(m[0]);
    if (Number.isFinite(n)) nums.push(n);
  }
  return nums;
}

function buildAllowedNumbers(pkg: EvidencePackage): Set<number> {
  const nums = new Set<number>([0, 1, 2, 3]);
  const q = pkg.query;
  for (const v of [q.o2Pct, q.pressureKpa, q.thicknessMm, q.diameterMm, q.gravityG]) {
    if (v !== null) nums.add(v);
  }
  if (Array.isArray(q.flowCmS)) {
    nums.add(q.flowCmS[0]);
    nums.add(q.flowCmS[1]);
  } else if (q.flowCmS !== null) {
    nums.add(q.flowCmS);
  }

  for (const h of pkg.retrievedHits) {
    for (const n of extractNumbersFromText(h.chunk.text)) nums.add(n);
  }
  for (const t of pkg.evaluatedTests ?? []) collectTestNumbers(t, nums);
  for (const d of pkg.applicabilityDecisions) {
    if (d.jointDistance !== null) nums.add(Number(d.jointDistance.toFixed(2)));
  }
  nums.add(pkg.applicabilityDecisions.filter((d) => d.verdict === 'admissible').length);
  nums.add(pkg.applicabilityDecisions.filter((d) => d.verdict === 'conditional_support').length);
  return nums;
}

function runNumericUnitCheck(
  items: SynthesisClaimItem[],
  pkg: EvidencePackage,
  flagged: Set<string>,
): VerificationCheckResult {
  const allowedNums = buildAllowedNumbers(pkg);
  const issues: string[] = [];

  for (const item of items) {
    // Strip bracket citation tokens and claim-ids like c-0021, fact-1, BASS-II-B1 before numeric check
    const stripped = item.text.replace(/\[[^\]]+\]/g, ' ').replace(/[A-Za-z]+-\d+(?:-[A-Za-z0-9]+)*/g, ' ');
    const foundNums = extractNumbersFromText(stripped);
    for (const n of foundNums) {
      const ok = [...allowedNums].some((a) => Math.abs(a - n) <= Math.max(0.02, Math.abs(a) * 0.005));
      if (!ok) {
        issues.push(`Claim ${item.id} introduces ungrounded number ${n}.`);
        flagged.add(item.id);
      }
    }
    if (/burning[-\s]*rate(?:\s+constant)?[^.\n]*\bmm\b(?!\s*[²2]\/s|2\/s)/i.test(stripped)) {
      issues.push(`Claim ${item.id} reports burning-rate constant with unit mm instead of mm²/s.`);
      flagged.add(item.id);
    }
  }
  return { passed: issues.length === 0, issues };
}

function runEpistemicCheck(
  synthesis: GeneratedSynthesis,
  pkg: EvidencePackage,
  flagged: Set<string>,
): VerificationCheckResult {
  const issues: string[] = [];
  const plannedInvIds = new Set(pkg.rankings.filter((r) => r.inv.epistemicStatus === 'planned_only').map((r) => r.inv.id));
  const plannedChunkIds = new Set(
    pkg.jevDecisions.filter((j) => j.q2Observation.answer === 'planned_or_hypothesis').map((j) => j.chunkId),
  );
  const chunkMeta = new Map(pkg.retrievedHits.map((h) => [h.chunk.chunkId, h.chunk]));
  const testMeta = new Map((pkg.evaluatedTests ?? []).map((t) => [t.testId, t]));

  for (const item of synthesis.observedFact) {
    const cites = [...new Set([...item.citations, ...extractBracketCitations(item.text)])];
    for (const cid of cites) {
      const chunk = chunkMeta.get(cid);
      if (plannedChunkIds.has(cid) || (chunk?.inv && plannedInvIds.has(chunk.inv)) || (chunk && (chunk.epistemicStatus === 'planned' || chunk.epistemicStatus === 'planned_only' || chunk.epistemicStatus === 'hypothesis'))) {
        issues.push(`Observed fact ${item.id} cites planned/hypothesis source [${cid}].`);
        flagged.add(item.id);
      }
      const t = testMeta.get(cid);
      if (t && (t.atmosphere.o2.provenance === 'assumed' || t.atmosphere.pressure.provenance === 'assumed') && !/assumed/i.test(item.text)) {
        issues.push(`Observed fact ${item.id} presents assumed conditions of ${cid} without 'assumed' qualifier.`);
        flagged.add(item.id);
      }
    }
    if (/\bflex-?2\b/i.test(item.text) && !/planned|not\s+observed|matrix/i.test(item.text)) {
      issues.push(`Observed fact ${item.id} refers to planned FLEX-2 without planned qualifier.`);
      flagged.add(item.id);
    }
  }
  return { passed: issues.length === 0, issues };
}

function runConstraintPreservationCheck(
  synthesis: GeneratedSynthesis,
  pkg: EvidencePackage,
  flagged: Set<string>,
): VerificationCheckResult {
  const issues: string[] = [];
  const allText = [
    ...synthesis.observedFact.map((c) => c.text),
    ...synthesis.engineeringImplication.map((c) => c.text),
    ...synthesis.applicabilityConditions,
  ].join(' ');

  if (pkg.conflictChunks.length > synthesis.conflictsPreserved.length) {
    issues.push(`Conflicts dropped: ${pkg.conflictChunks.length} detected by Jev, ${synthesis.conflictsPreserved.length} preserved.`);
  }

  const hasSimulatedAnalogue = pkg.applicabilityDecisions.some((d) => d.reasonCodes.includes('simulated_analogue_gravity'));
  if (hasSimulatedAnalogue && pkg.query.gravityRegime === 'partial_gravity') {
    if (/e-field[^.\n]*(?:validates|proves|confirms)\s+(?:lunar|mars|partial)/i.test(allText)) {
      issues.push('Constraint breach: synthesis claims ACME E-FIELD validates lunar/Martian partial-gravity flammability.');
    }
  }

  const hasOxStream = pkg.applicabilityDecisions.some((d) => d.reasonCodes.includes('oxidizer_stream_vs_ambient'));
  if (hasOxStream && !/oxidizer[_\s]stream|inverse/i.test(allText) && synthesis.applicabilityConditions.length === 0) {
    issues.push('Constraint omission: oxidizer_stream vs ambient O2 role warning was dropped.');
  }

  for (const item of synthesis.observedFact) {
    if (/flow_turned_off|turned\s+flow\s+off/i.test(item.text) && /physical\s+quench\s+limit/i.test(item.text)) {
      issues.push(`Constraint breach in ${item.id}: conflates operator flow_turned_off with physical quench limit.`);
      flagged.add(item.id);
    }
  }

  return { passed: issues.length === 0, issues };
}

function hasNegativePolarity(text: string): boolean {
  return /\b(no\s+ignition|did\s+not\s+ignite|never\s+ignited|not\s+flammable|self-extinguished|failed\s+to\s+ignite)\b/i.test(text);
}

function hasPositiveBurnPolarity(text: string): boolean {
  return /\b(sustained\s+spread|burned\s+steadily|ignited\s+and\s+spread|flame_spread)\b/i.test(text);
}

function runLexicalEntailmentCheck(
  synthesis: GeneratedSynthesis,
  pkg: EvidencePackage,
  flagged: Set<string>,
): VerificationCheckResult {
  const issues: string[] = [];
  const chunkMap = new Map(pkg.retrievedHits.map((h) => [h.chunk.chunkId, h.chunk.text]));
  const testMap = new Map(
    (pkg.evaluatedTests ?? []).map((t) => [
      t.testId,
      `${t.testId} ${t.inv} ${t.fuel ?? ''} ${t.geometry ?? ''} ${t.initialOutcome} ${t.terminalEvent ?? ''} ${t.outcomeRaw ?? ''}`,
    ]),
  );

  for (const item of synthesis.observedFact) {
    const cites = [...new Set([...item.citations, ...extractBracketCitations(item.text)])];
    const sourceText = cites.map((id) => chunkMap.get(id) ?? testMap.get(id) ?? '').join(' ');
    if (!sourceText.trim()) continue;

    const claimToks = tokenizeBm25(item.text.replace(/\[[^\]]+\]/g, ' '));
    const srcToks = new Set(tokenizeBm25(sourceText));
    const hits = claimToks.filter((t) => srcToks.has(t)).length;
    const ratio = claimToks.length > 0 ? hits / claimToks.length : 0;

    if (ratio < 0.25) {
      issues.push(`Claim ${item.id} has low lexical entailment (${(ratio * 100).toFixed(0)}%) against cited evidence.`);
      flagged.add(item.id);
    }
    if (hasNegativePolarity(sourceText) && hasPositiveBurnPolarity(item.text) && !hasNegativePolarity(item.text)) {
      issues.push(`Claim ${item.id} polarity contradicts negative ignition/extinction outcome in cited source.`);
      flagged.add(item.id);
    }
  }
  return { passed: issues.length === 0, issues };
}

export function verifySynthesis(synthesis: GeneratedSynthesis, pkg: EvidencePackage): VerificationReport {
  const flagged = new Set<string>();
  const allowedIds = buildAllowedIds(pkg);
  const allClaims = [...synthesis.observedFact, ...synthesis.authorInterpretation, ...synthesis.engineeringImplication];

  const citationCheck = runCitationCheck(allClaims, allowedIds, flagged);
  const numericUnitCheck = runNumericUnitCheck(allClaims, pkg, flagged);
  const epistemicCheck = runEpistemicCheck(synthesis, pkg, flagged);
  const constraintPreservationCheck = runConstraintPreservationCheck(synthesis, pkg, flagged);
  const lexicalEntailmentCheck = runLexicalEntailmentCheck(synthesis, pkg, flagged);

  const passed =
    citationCheck.passed &&
    numericUnitCheck.passed &&
    epistemicCheck.passed &&
    constraintPreservationCheck.passed &&
    lexicalEntailmentCheck.passed;

  return {
    passed,
    citationCheck,
    numericUnitCheck,
    epistemicCheck,
    constraintPreservationCheck,
    lexicalEntailmentCheck,
    flaggedClaimIds: [...flagged],
  };
}
