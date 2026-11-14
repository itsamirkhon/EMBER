/**
 * Multi-layer synthesis verifier replacing naive ID-only citation checks.
 * Runs:
 * 1. citationCheck
 * 2. numericUnitCheck
 * 3. epistemicCheck (planned != observed, assumed != measured)
 * 4. constraintPreservationCheck (gas role, E-FIELD, operator shutoff, cool flame, joint gaps)
 * 5. lexicalEntailmentCheck (per-assertion lexical mismatch + polarity screening)
 * These deterministic checks are rejection guards, not proof of semantic entailment.
 * The legacy lexicalEntailmentCheck field name is retained for API compatibility.
 */
import { tokenizeBm25 } from './retrieval';
import type {
  Contrast,
  ComparisonResult,
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
  const matches = text.matchAll(/(?<![a-zA-Z0-9.\-])[+-]?\d+(?:\.\d+)?(?![a-zA-Z0-9.\-])/g);
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

function claimCitations(item: SynthesisClaimItem): string[] {
  return [...new Set([...item.citations, ...extractBracketCitations(item.text)])];
}

function testEvidenceText(t: Test): string {
  const measurements = [
    t.atmosphere.o2, t.atmosphere.pressure, t.atmosphere.diluentPct,
    t.flow.initialFlowCmS, t.gravity.gravityG, t.thicknessMm, t.diameterMm,
    t.widthCm, t.spreadRateMmS, t.burningRateMm2S, t.particleSizeNm, t.smokePointLengthMm,
  ];
  const quantities = measurements.filter((m) => m.value !== null).map((m) => `${m.value} ${m.unit}`);
  const flowSequence = (t.flow.sequenceCmS ?? []).map((v) => `${v} cm/s`);
  return [t.testId, t.inv, t.fuel, t.geometry, t.initialOutcome, t.terminalEvent, t.outcomeRaw, ...quantities, ...flowSequence].join(' ');
}

function citedEvidenceText(item: SynthesisClaimItem, pkg: EvidencePackage): string {
  const ids = new Set(claimCitations(item));
  const chunks = pkg.retrievedHits.filter((h) => ids.has(h.chunk.chunkId) || (h.chunk.inv !== null && (ids.has(h.chunk.inv) || ids.has(`card:${h.chunk.inv}`))));
  const tests = (pkg.evaluatedTests ?? []).filter((t) => ids.has(t.testId));
  return [...chunks.map((h) => h.chunk.text), ...tests.map(testEvidenceText)].join(' ');
}

function quantities(text: string): { value: number; unit: string }[] {
  const pattern = /(?<![a-zA-Z0-9])(-?\d+(?:\.\d+)?)\s*(mm[²2]\s*\/\s*s|mm\s*\/\s*s|cm\s*\/\s*s|kpa|atm|mm|cm|nm|%|g)(?![a-zA-Z])/gi;
  return [...text.replace(/%vol\b/gi, '%').matchAll(pattern)].map((m) => ({ value: Number(m[1]), unit: m[2].toLowerCase().replace(/\s+/g, '').replace('²', '2') }));
}

function sameNumber(a: number, b: number): boolean {
  return Math.abs(a - b) <= Math.max(0.000001, Math.abs(a) * 0.005);
}

function isStructuredComparison(contrast: Contrast): contrast is ComparisonResult {
  return 'comparisonVersion' in contrast && 'numericDelta' in contrast && 'observationComparability' in contrast;
}

function derivedDeltaQuantities(item: SynthesisClaimItem, pkg: EvidencePackage, engineeringItems: Set<SynthesisClaimItem>): {value:number;unit:string}[] {
  if (!engineeringItems.has(item) || (item.provenance !== 'derived' && item.provenance !== 'interpretation')) return [];
  if (!/\b(?:difference|delta)\b|\bB\s*(?:minus|−|-)\s*A\b/i.test(item.text)) return [];
  const cited = new Set(claimCitations(item));
  return pkg.contrasts.filter(isStructuredComparison)
    .filter((comparison) => comparison.observationComparability.quantitativeAllowed && comparison.numericDelta !== null && cited.has(comparison.testAId) && cited.has(comparison.testBId))
    .flatMap((comparison) => comparison.numericDelta ? [{value:comparison.numericDelta.value,unit:comparison.numericDelta.unit.toLowerCase().replace(/\s+/g,'').replace('²','2')}] : []);
}

function exactDelta(a: {value:number;unit:string}, b: {value:number;unit:string}): boolean {
  return a.unit === b.unit && Math.abs(a.value-b.value) <= 1e-10;
}

function checkQuantityBindings(item: SynthesisClaimItem, pkg: EvidencePackage, allowQuery: boolean, derived: {value:number;unit:string}[] = []): string[] {
  let source = citedEvidenceText(item, pkg);
  if (allowQuery) {
    const q = pkg.query;
    // 0 g / 1 g denote reference gravity regimes, not invented test measurements.
    source += ' 0 g 1 g';
    source += ` ${q.o2Pct}% ${q.pressureKpa} kPa ${q.thicknessMm} mm ${q.diameterMm} mm ${q.gravityG} g`;
    source += (Array.isArray(q.flowCmS) ? q.flowCmS : [q.flowCmS]).map((v) => ` ${v} cm/s`).join('');
  }
  const supported = quantities(source);
  return quantities(item.text.replace(/\[[^\]]+\]/g, ' '))
    .filter((q) => !supported.some((s) => s.unit === q.unit && sameNumber(s.value, q.value)) && !derived.some((d) => exactDelta(d,q)))
    .map((q) => `Claim ${item.id} has no cited value-unit support for ${q.value} ${q.unit}.`);
}

function runNumericUnitCheck(
  items: SynthesisClaimItem[],
  pkg: EvidencePackage,
  flagged: Set<string>,
  observedIds: Set<string>,
  engineeringItems: Set<SynthesisClaimItem>,
): VerificationCheckResult {
  const allowedNums = buildAllowedNumbers(pkg);
  const issues: string[] = [];

  for (const item of items) {
    // Strip bracket citation tokens and claim-ids like c-0021, fact-1, BASS-II-B1 before numeric check
    const stripped = item.text.replace(/\[[^\]]+\]/g, ' ').replace(/[A-Za-z]+-\d+(?:-[A-Za-z0-9]+)*/g, ' ');
    const derived = derivedDeltaQuantities(item, pkg, engineeringItems);
    const itemQuantities = quantities(item.text.replace(/\[[^\]]+\]/g, ' '));
    const matchedDerived = derived.filter((delta) => itemQuantities.some((q) => exactDelta(delta,q)));
    const arithmeticClaim = engineeringItems.has(item) && (item.provenance === 'derived' || item.provenance === 'interpretation') && /\b(?:difference|delta)\b|\bB\s*(?:minus|−|-)\s*A\b/i.test(item.text);
    if (arithmeticClaim && itemQuantities.length > 0 && matchedDerived.length === 0) {
      issues.push(`Claim ${item.id} has no exact structured delta with both compared test citations, value and unit.`);
      flagged.add(item.id);
    }
    const bindings = checkQuantityBindings(item, pkg, !observedIds.has(item.id), matchedDerived);
    if (bindings.length) {
      issues.push(...bindings);
      flagged.add(item.id);
    }
    const foundNums = extractNumbersFromText(stripped);
    for (const n of foundNums) {
      const ok = matchedDerived.some((delta) => Math.abs(delta.value - n) <= 1e-10) || [...allowedNums].some((a) => Math.abs(a - n) <= Math.max(0.02, Math.abs(a) * 0.005));
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

// Conservative assertion boundaries; decimals are preserved and citations end a support unit.
// This is not a general linguistic parser or a semantic entailment model.
function assertionUnits(text: string): string[] {
  return text.replace(/\[[^\]]+\]/g, '; ')
    .split(/(?<!\d)[.!?;]\s+|[.!?;](?!\d)\s*$|\s+(?:and|but|yet)\s+(?=(?:will|is|it|this|the configuration|cannot|safe)\b)/i)
    .map((part) => part.trim()).filter(Boolean);
}

function unsupportedSafetyAssertions(text: string): string[] {
  return assertionUnits(text).filter((part) => {
    // Negation must precede the guarantee within the same assertion, not anywhere in the item.
    const guarantee = /\bsafe\s+for\s+(?:crewed|human|spacecraft|cabin)|\b(?:certified|qualified|approved)\s+(?:for|as)\b[^.!?;]{0,60}\b(?:flight|spacecraft|cabin|crewed|human)\b|\balways\s+(?:self[- ]extinguish|extinguish)|\b(?:guarantees?|proves?)\s+(?:fire\s+)?safety\b/i.exec(part);
    if (!guarantee) return false;
    const prefix = part.slice(0, guarantee.index).replace(/\bnot\s+only\b/gi, '');
    return !/\b(?:not|cannot|can't|never|no|without)\b|\b(?:do|does)\s+not\b|\binsufficient\b|\bnot\s+establish\b/i.test(prefix);
  });
}

function runConstraintPreservationCheck(
  synthesis: GeneratedSynthesis,
  pkg: EvidencePackage,
  flagged: Set<string>,
): VerificationCheckResult {
  const issues: string[] = [];
  const allClaims = [...synthesis.observedFact, ...synthesis.authorInterpretation, ...synthesis.engineeringImplication];
  for (const item of allClaims) {
    if (unsupportedSafetyAssertions(item.text).length) {
      issues.push(`Claim ${item.id} asserts unqualified safety, certification, or universal extinction outside evidence-review scope.`);
      flagged.add(item.id);
    }
  }
  for (const [section, texts] of [['Applicability conditions', synthesis.applicabilityConditions], ['Raw summary', [synthesis.rawSummary]]] as const) {
    if (texts.some((text) => unsupportedSafetyAssertions(text).length)) {
      issues.push(`${section} asserts an unqualified safety guarantee outside evidence-review scope.`);
    }
  }
  const allText = [
    ...synthesis.observedFact.map((c) => c.text),
    ...synthesis.authorInterpretation.map((c) => c.text),
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

  for (const item of allClaims) {
    if (/flow_turned_off|turned\s+flow\s+off/i.test(item.text) && /physical\s+quench\s+limit/i.test(item.text)) {
      issues.push(`Constraint breach in ${item.id}: conflates operator flow_turned_off with physical quench limit.`);
      flagged.add(item.id);
    }
  }

  return { passed: issues.length === 0, issues };
}

function hasNegativePolarity(text: string): boolean {
  return /\b(no\s+ignition|did\s+not\s+ignite|never\s+ignited|not\s+flammable|failed\s+to\s+ignite)\b/i.test(text);
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
  for (const item of synthesis.observedFact) {
    const sourceText = citedEvidenceText(item, pkg);
    if (!sourceText.trim()) {
      issues.push(`Claim ${item.id} has no accessible cited text for support screening.`);
      flagged.add(item.id);
      continue;
    }
    const srcToks = new Set(tokenizeBm25(sourceText));
    for (const assertion of assertionUnits(item.text)) {
      const claimToks = tokenizeBm25(assertion);
      const hits = claimToks.filter((t) => srcToks.has(t)).length;
      const ratio = claimToks.length > 0 ? hits / claimToks.length : 1;
      if (ratio < 0.25) {
        issues.push(`Claim ${item.id} contains an assertion with low lexical support (${(ratio * 100).toFixed(0)}%); semantic support is not established.`);
        flagged.add(item.id);
      }
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
  const numericUnitCheck = runNumericUnitCheck(allClaims, pkg, flagged, new Set(synthesis.observedFact.map((c) => c.id)), new Set(synthesis.engineeringImplication));
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
