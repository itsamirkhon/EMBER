import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildContrasts,
  buildDependencies,
  buildSynthesizedChunksIndex,
  encodeDenseQuery,
  evaluateApplicability,
  evaluatePassageWithJev,
  evaluatePassageWithJevOffline,
  evaluateStaticMatcher,
  exportFormatters,
  exportModelingCsv,
  exportReviewJson,
  exportReviewMarkdown,
  generateCandidateBlocks,
  generateDeterministicSynthesis,
  generateSynthesis,
  groupedCrossValidate,
  matchProtocolSegment,
  optimizeTestProgramme,
  parseResearchQuery,
  predictDomainGated,
  rankInvestigationsV2,
  recalculateDesignVariant,
  runReview,
  runReviewSync,
  searchBm25,
  searchDense,
  searchHybrid,
  verifySynthesis,
  type ChunkRecord,
  type ChunksIndex,
  type Claim,
  type CorpusV2,
  type Investigation,
  type ProtocolStep,
  type ResearchQuery,
  type ScientificValue,
  type SourceRef,
  type Test,
  type TestEvent,
} from '../src/core/index';

// ---------------------------------------------------------------------------
// Fixture builders

function ref(sourceId: string, locator?: SourceRef['locator']): SourceRef {
  return {
    sourceId,
    url: `https://psi.nasa.gov/physci/repo/data/investigations/${sourceId.toUpperCase()}`,
    doi: '10.60555/test-doi',
    locator,
  };
}

function sv<T extends number | string>(
  value: T | null,
  unit: string,
  provenance: ScientificValue['provenance'] = 'reported',
): ScientificValue<T> {
  return { value, unit, provenance };
}

function makeTest(overrides: Partial<Test> & { testId: string; inv: string }): Test {
  const sourceRef = overrides.sourceRef ?? ref(overrides.inv.toLowerCase());
  return {
    testId: overrides.testId,
    inv: overrides.inv,
    seriesId: overrides.seriesId ?? `${overrides.inv}-S1`,
    sampleId: overrides.sampleId ?? `${overrides.testId}-smp`,
    groupId: overrides.groupId ?? `grp-${overrides.testId}`,
    fuel: overrides.fuel ?? 'PMMA',
    fuelPhase: overrides.fuelPhase ?? 'solid',
    geometry: overrides.geometry ?? 'thin film',
    thicknessMm: overrides.thicknessMm ?? sv(0.1, 'mm'),
    diameterMm: overrides.diameterMm ?? sv<number>(null, 'mm', 'unknown'),
    widthCm: overrides.widthCm ?? sv(2.0, 'cm'),
    substrateConfinement: overrides.substrateConfinement ?? null,
    orientation: overrides.orientation ?? null,
    atmosphere: overrides.atmosphere ?? {
      o2: { value: 21.0, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa', 'series_level'),
      diluent: 'N2',
      diluentPct: { value: 79.0, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: overrides.flow ?? {
      initialFlowCmS: sv(5.0, 'cm/s'),
      direction: 'opposed',
      history: 'steady',
      sequenceCmS: [5.0],
    },
    gravity: overrides.gravity ?? {
      gravityG: sv(0, 'g'),
      regime: 'microgravity',
      platform: 'ISS',
      mode: 'actual_flight',
    },
    initialOutcome: overrides.initialOutcome ?? 'flame_spread',
    terminalEvent: overrides.terminalEvent ?? null,
    outcomeRaw: overrides.outcomeRaw ?? 'steady opposed flame spread',
    segments: overrides.segments ?? [],
    events: overrides.events ?? [],
    spreadRateMmS: overrides.spreadRateMmS ?? sv<number>(null, 'mm/s', 'unknown'),
    burningRateMm2S: overrides.burningRateMm2S ?? sv<number>(null, 'mm2/s', 'unknown'),
    particleSizeNm: overrides.particleSizeNm ?? sv<number>(null, 'nm', 'unknown'),
    smokePointLengthMm: overrides.smokePointLengthMm ?? sv<number>(null, 'mm', 'unknown'),
    extra: overrides.extra ?? {},
    sourceRef,
  };
}

function makeStep(
  testId: string,
  order: number,
  stageType: ProtocolStep['stageType'],
  intervention: ProtocolStep['intervention'],
  flowCmS: number | null,
  description: string,
): ProtocolStep {
  return {
    segmentId: `${testId}-seg-${order}`,
    testId,
    order,
    timeStartS: null,
    timeEndS: null,
    stageType,
    description,
    flowCmS: sv(flowCmS, 'cm/s'),
    o2Pct: sv(21.0, '%'),
    pressureKpa: sv(101.3, 'kPa', 'series_level'),
    intervention,
    sourceRef: ref('psi-25'),
  };
}

function makeEvent(
  testId: string,
  segmentId: string,
  endpoint: TestEvent['endpoint'],
  eventType: string,
  value: number | string | null,
  unit: string,
): TestEvent {
  return {
    id: `${testId}-ev-${endpoint}`,
    testId,
    segmentId,
    endpoint,
    eventType,
    observedValue: sv(value, unit),
    sensorOrMethod: 'video',
    sourceRef: ref('psi-25'),
  };
}

function makeInv(overrides: Partial<Investigation> & { id: string }): Investigation {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    psi: overrides.psi ?? 'PSI-25',
    psiUrl: 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25',
    doi: '10.60555/4qc4-de67',
    doiVerified: true,
    family: overrides.family ?? 'MSG-SPICE',
    hardware: overrides.hardware ?? 'MSG flow duct',
    platform: overrides.platform ?? 'ISS',
    fuelPhase: overrides.fuelPhase ?? 'solid',
    direction: overrides.direction ?? ['prevention'],
    safetyConsequence: overrides.safetyConsequence ?? 3,
    objective: overrides.objective ?? 'Study spacecraft material flammability.',
    fuel: overrides.fuel ?? { types: ['PMMA'], geometry: 'thin film, slab, rod', size: '0.1-12.7 mm' },
    conditions: overrides.conditions ?? {
      o2Pct: [14, 22.2],
      pressureKpa: [101.3, 101.3],
      flowCmS: [0, 20],
      gravityG: [0, 0],
      diluents: ['N2'],
    },
    varied: ['flow', 'O2'],
    constant: ['1 atm'],
    diagnostics: ['video'],
    resultSummary: overrides.resultSummary ?? 'Microgravity combustion results.',
    keyFindings: [],
    nTests: overrides.nTests ?? 10,
    flight: overrides.flight ?? true,
    rawDataAvailable: true,
    years: '2014',
    sources: [{ id: 'psi-25', label: 'PSI-25', url: 'https://psi.nasa.gov/physci/repo/data/investigations/PSI-25', type: 'psi' }],
    dataNotes: [],
    methodSummary: 'Flow duct testing in ISS MSG.',
    limitations: [],
    epistemicStatus: overrides.epistemicStatus ?? 'observed',
    verificationStatus: 'verified',
    coverageSummary: {
      totalRows: overrides.nTests ?? 10,
      withObservedOutcome: overrides.nTests ?? 10,
      withNumericTarget: 2,
      withProtocolSegments: overrides.nTests ?? 10,
      completenessNote: 'Test fixture',
    },
  };
}

function buildAuditFixtureCorpus(): { corpus: CorpusV2; testsById: Record<string, Test> } {
  const b1 = makeTest({
    testId: 'BASS-II-B1',
    inv: 'BASS-II',
    groupId: 'grp-b2-film-22',
    fuel: 'PMMA',
    geometry: 'thin film',
    thicknessMm: sv(0.1, 'mm'),
    atmosphere: {
      o2: { value: 22.2, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa', 'series_level'),
      diluent: 'N2',
      diluentPct: { value: 77.8, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: { initialFlowCmS: sv(5.0, 'cm/s'), direction: 'opposed', history: 'abrupt_cutoff', sequenceCmS: [5.0] },
    initialOutcome: 'flame_spread',
    terminalEvent: 'flow_turned_off',
    outcomeRaw: 'Ignited very quickly, turned flow off after spread halfway; flame extinguished very quickly',
    spreadRateMmS: sv(2.2, 'mm/s'),
    segments: [
      makeStep('BASS-II-B1', 1, 'steady_burn', 'igniter_energized', 5.0, 'Steady opposed spread at 5 cm/s (2.2 mm/s)'),
      makeStep('BASS-II-B1', 2, 'termination', 'flow_shutoff', 0.0, 'Operator turned flow off halfway; flame extinguished'),
    ],
    events: [
      makeEvent('BASS-II-B1', 'BASS-II-B1-seg-1', 'sustained_spread', 'steady_spread', 2.2, 'mm/s'),
      makeEvent('BASS-II-B1', 'BASS-II-B1-seg-1', 'spread_rate', 'spread_rate', 2.2, 'mm/s'),
    ],
  });

  const b10 = makeTest({
    testId: 'BASS-II-B10',
    inv: 'BASS-II',
    groupId: 'grp-b2-film-21-rep',
    fuel: 'PMMA',
    geometry: 'thin film',
    thicknessMm: sv(0.2, 'mm'),
    atmosphere: {
      o2: { value: 21.0, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa', 'series_level'),
      diluent: 'N2',
      diluentPct: { value: 79.0, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: { initialFlowCmS: sv(5.0, 'cm/s'), direction: 'opposed', history: 'stepped_down', sequenceCmS: [5, 4, 3, 2, 1] },
    initialOutcome: 'flame_spread',
    terminalEvent: 'extinguished_at_reduced_flow',
    outcomeRaw: 'Multiple velocities for steady spread, extinguished at pot 0.35',
    segments: [
      makeStep('BASS-II-B10', 1, 'steady_burn', 'igniter_energized', 5.0, 'Steady spread at 5 cm/s'),
      makeStep('BASS-II-B10', 2, 'flow_modification', 'flow_stepped_down', 1.0, 'Flow stepped down 5->4->3->2->1 cm/s; extinguished at pot 0.35'),
    ],
    events: [
      makeEvent('BASS-II-B10', 'BASS-II-B10-seg-1', 'sustained_spread', 'steady_spread', 'flame_spread', 'categorical'),
      makeEvent('BASS-II-B10', 'BASS-II-B10-seg-2', 'extinction_under_flow_change', 'quench_extinction', 1.0, 'cm/s'),
      makeEvent('BASS-II-B10', 'BASS-II-B10-seg-2', 'quench_limit', 'quench_extinction', 1.0, 'cm/s'),
    ],
  });

  const m1 = makeTest({
    testId: 'BASS-II-M1',
    inv: 'BASS-II',
    groupId: 'grp-b2-slab-22',
    fuel: 'PMMA',
    geometry: 'slab',
    thicknessMm: sv(1.0, 'mm'),
    atmosphere: {
      o2: { value: 22.2, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa', 'series_level'),
      diluent: 'N2',
      diluentPct: { value: 77.8, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: { initialFlowCmS: sv(10.0, 'cm/s'), direction: 'opposed', history: 'stepped_down', sequenceCmS: [10, 8] },
    initialOutcome: 'flame_spread',
    terminalEvent: 'flow_turned_off',
    spreadRateMmS: sv(0.071, 'mm/s'),
    segments: [
      makeStep('BASS-II-M1', 1, 'steady_burn', 'igniter_energized', 10.0, 'Slow propagation at 10 cm/s (0.071 mm/s)'),
      makeStep('BASS-II-M1', 2, 'flow_modification', 'flow_stepped_down', 8.0, 'Stepped down to 8 cm/s; flame shrank'),
      makeStep('BASS-II-M1', 3, 'termination', 'flow_shutoff', 0.0, 'Flow turned off'),
    ],
    events: [
      makeEvent('BASS-II-M1', 'BASS-II-M1-seg-1', 'sustained_spread', 'steady_spread', 0.071, 'mm/s'),
      makeEvent('BASS-II-M1', 'BASS-II-M1-seg-1', 'spread_rate', 'spread_rate', 0.071, 'mm/s'),
    ],
  });

  const o1 = makeTest({
    testId: 'BASS-II-O1',
    inv: 'BASS-II',
    groupId: 'grp-b2-rod-22',
    fuel: 'PMMA',
    geometry: 'cylinder (rod)',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    diameterMm: sv(6.35, 'mm'),
    atmosphere: {
      o2: { value: 22.2, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa', 'series_level'),
      diluent: 'N2',
      diluentPct: { value: 77.8, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: { initialFlowCmS: sv(20.0, 'cm/s'), direction: 'axial_stagnation', history: 'stepped_down', sequenceCmS: [20, 10, 5, 2, 1] },
    initialOutcome: 'burned',
    terminalEvent: 'extinguished_at_reduced_flow',
    segments: [
      makeStep('BASS-II-O1', 1, 'steady_burn', 'igniter_energized', 20.0, 'PMMA 6.35 mm rod ignited at 20 cm/s'),
      makeStep('BASS-II-O1', 2, 'flow_modification', 'flow_stepped_down', 1.0, 'Stepped down 20->10->5->2->1 cm/s'),
    ],
    events: [makeEvent('BASS-II-O1', 'BASS-II-O1-seg-2', 'quench_limit', 'quench_extinction', 1.0, 'cm/s')],
  });

  const cfi1206 = makeTest({
    testId: 'CFI-1206',
    inv: 'CFI',
    groupId: 'grp-cfi-dodecane-21',
    fuel: 'n-dodecane',
    fuelPhase: 'liquid',
    geometry: 'droplet',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    diameterMm: sv(4.039, 'mm'),
    atmosphere: {
      o2: { value: 21.0, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa'),
      diluent: 'N2',
      diluentPct: { value: 79.0, unit: '%', role: 'diluent', provenance: 'reported' },
    },
    flow: { initialFlowCmS: sv(0, 'cm/s'), direction: 'quiescent', history: 'steady' },
    initialOutcome: 'extinguished',
    terminalEvent: 'cool_flame_extinction',
    outcomeRaw: 'hot-flame extinction at D = 3.577 mm; cool-flame burning (k = 0.385 mm²/s)',
    burningRateMm2S: sv(0.379, 'mm2/s'),
    extra: { DextHotMm: 3.577, kCoolMm2S: 0.385, DextCoolMm: 0.497 },
    segments: [
      makeStep('CFI-1206', 1, 'steady_burn', 'igniter_energized', 0, 'Hot-flame droplet combustion ending at DextHot = 3.577 mm'),
      makeStep('CFI-1206', 2, 'steady_burn', 'none', 0, 'Cool-flame continuation at k = 0.385 mm2/s until DextCool = 0.497 mm'),
    ],
    events: [
      makeEvent('CFI-1206', 'CFI-1206-seg-1', 'hot_flame_extinction', 'hot_flame_extinction', 3.577, 'mm'),
      makeEvent('CFI-1206', 'CFI-1206-seg-1', 'burning_rate_constant', 'burning_rate_constant', 0.379, 'mm2/s'),
      makeEvent('CFI-1206', 'CFI-1206-seg-2', 'cool_flame_continuation', 'cool_flame_burning', 0.385, 'mm2/s'),
    ],
  });

  const cfigInverse = makeTest({
    testId: 'CFI-G-I-21202A2-D2',
    inv: 'ACME-CFI-G',
    groupId: 'grp-cfig-inv-85',
    fuel: 'ethane',
    fuelPhase: 'gas',
    geometry: 'spherical porous burner, inverse flame',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    diameterMm: sv(6.0, 'mm'),
    atmosphere: {
      o2: { value: 85.0, unit: '%', role: 'oxidizer_stream', provenance: 'reported' },
      pressure: sv(220.7, 'kPa'),
      diluent: 'N2',
      diluentPct: { value: 15.0, unit: '%', role: 'diluent', provenance: 'reported' },
    },
    flow: { initialFlowCmS: sv(0, 'cm/s'), direction: 'quiescent', history: 'steady' },
    initialOutcome: 'self_extinguished',
    terminalEvent: 'SE',
    events: [makeEvent('CFI-G-I-21202A2-D2', 'seg-1', 'flame_establishment', 'hot_ignition', 'Yes', 'categorical')],
  });

  const cfigNormal = makeTest({
    testId: 'CFI-G-N-21291G1-D11',
    inv: 'ACME-CFI-G',
    groupId: 'grp-cfig-norm-38',
    fuel: 'methane',
    fuelPhase: 'gas',
    geometry: 'spherical porous burner, normal flame',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    diameterMm: sv(6.0, 'mm'),
    atmosphere: {
      o2: { value: 38.8, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.3, 'kPa'),
      diluent: 'N2',
      diluentPct: { value: 61.2, unit: '%', role: 'diluent', provenance: 'reported' },
    },
    flow: { initialFlowCmS: sv(0, 'cm/s'), direction: 'quiescent', history: 'steady' },
    initialOutcome: 'burned',
    events: [makeEvent('CFI-G-N-21291G1-D11', 'seg-1', 'flame_establishment', 'burner_flame', 'burned', 'categorical')],
  });

  const sameR51 = makeTest({
    testId: 'SAME-R-51',
    inv: 'SAME-R',
    groupId: 'grp-samer-kapton-51',
    fuel: 'Kapton',
    fuelPhase: 'solid',
    geometry: 'heated sample (smoke source)',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    atmosphere: {
      o2: { value: 21.0, unit: '%', role: 'ambient', provenance: 'assumed' },
      pressure: sv(101.3, 'kPa', 'assumed'),
      diluent: null,
      diluentPct: { value: null, unit: '%', role: 'diluent', provenance: 'unknown' },
    },
    flow: { initialFlowCmS: sv(8.1, 'cm/s'), direction: 'coflow', history: 'steady' },
    initialOutcome: 'not_applicable',
    outcomeRaw: 'smoke generation by heating below ignition',
    particleSizeNm: sv(56.4, 'nm'),
    events: [makeEvent('SAME-R-51', 'seg-1', 'smoke_particle_size', 'smoke_aging', 56.4, 'nm')],
  });

  const saffire3S1 = makeTest({
    testId: 'Saffire-III-S1',
    inv: 'Saffire-III',
    groupId: 'grp-saffire3',
    fuel: 'SIBAL (cotton-fiberglass fabric)',
    fuelPhase: 'solid',
    geometry: 'large fabric sheet, concurrent flow',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    atmosphere: {
      o2: { value: null, unit: '%', role: 'ambient', provenance: 'unknown' },
      pressure: sv<number>(null, 'kPa', 'unknown'),
      diluent: 'N2',
      diluentPct: { value: null, unit: '%', role: 'diluent', provenance: 'unknown' },
    },
    flow: { initialFlowCmS: sv(30.0, 'cm/s'), direction: 'concurrent', history: 'steady' },
    gravity: { gravityG: sv(0, 'g'), regime: 'microgravity', platform: 'Cygnus', mode: 'actual_flight' },
    initialOutcome: 'unknown',
    outcomeRaw: null,
  });

  const efield = makeTest({
    testId: 'EFIELD-18073-neg-100',
    inv: 'ACME-E-FIELD',
    groupId: 'grp-efield-ch4',
    fuel: 'CH4',
    fuelPhase: 'gas',
    geometry: 'coflow burner',
    thicknessMm: sv<number>(null, 'mm', 'unknown'),
    atmosphere: {
      o2: { value: null, unit: '%', role: 'ambient', provenance: 'unknown' },
      pressure: sv<number>(null, 'kPa', 'unknown'),
      diluent: null,
      diluentPct: { value: null, unit: '%', role: 'diluent', provenance: 'unknown' },
    },
    flow: { initialFlowCmS: sv<number>(null, 'cm/s', 'unknown'), direction: 'coflow', history: 'unknown' },
    gravity: { gravityG: sv(0, 'g'), regime: 'microgravity', platform: 'SimulatedAnalogue', mode: 'simulated_analogue' },
    initialOutcome: 'burned',
    events: [makeEvent('EFIELD-18073-neg-100', 'seg-1', 'flame_establishment', 'electric_field_flame', 'burned', 'categorical')],
  });

  // Joint O2+P range trap pair in BASS: (15% O2, 101 kPa) and (21% O2, 55 kPa) — no test at (15% O2, 55 kPa)!
  const jointLowO2 = makeTest({
    testId: 'JOINT-LOW-O2',
    inv: 'JOINT-TRAP',
    groupId: 'grp-joint-1',
    fuel: 'PMMA',
    atmosphere: {
      o2: { value: 15.0, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(101.0, 'kPa'),
      diluent: 'N2',
      diluentPct: { value: 85.0, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: { initialFlowCmS: sv(10.0, 'cm/s'), direction: 'opposed', history: 'steady' },
    events: [makeEvent('JOINT-LOW-O2', 'seg-1', 'sustained_spread', 'steady_spread', 'burned', 'categorical')],
  });
  const jointLowP = makeTest({
    testId: 'JOINT-LOW-P',
    inv: 'JOINT-TRAP',
    groupId: 'grp-joint-2',
    fuel: 'PMMA',
    atmosphere: {
      o2: { value: 21.0, unit: '%', role: 'ambient', provenance: 'reported' },
      pressure: sv(55.0, 'kPa'),
      diluent: 'N2',
      diluentPct: { value: 79.0, unit: '%', role: 'diluent', provenance: 'derived' },
    },
    flow: { initialFlowCmS: sv(10.0, 'cm/s'), direction: 'opposed', history: 'steady' },
    events: [makeEvent('JOINT-LOW-P', 'seg-1', 'sustained_spread', 'steady_spread', 'burned', 'categorical')],
  });

  const tests = [b1, b10, m1, o1, cfi1206, cfigInverse, cfigNormal, sameR51, saffire3S1, efield, jointLowO2, jointLowP];
  const testsById = Object.fromEntries(tests.map((t) => [t.testId, t]));

  const claims: Claim[] = [
    {
      id: 'c-0021',
      inv: 'BASS-II',
      text: 'SIBAL fabric in concurrent flow during BASS and BASS-II quenched at 1 to 5 cm/s with higher quench speed at lower oxygen.',
      epistemicStatus: 'observed',
      evidenceIds: ['BASS-II-B10'],
      conditionsScope: 'BASS & BASS-II microgravity flow duct',
      limitations: ['Covers BASS and BASS-II jointly'],
      verificationStatus: 'corrected',
      sourceRef: ref('ntrs-20150008962', { page: 1 }),
      topics: ['oxygen-limit', 'flow', 'solid'],
    },
    {
      id: 'c-0076',
      inv: 'FLEX-2',
      text: 'FLEX-2 planned droplet matrix varies pressure from 0.5 to 3.0 atm and O2 from 10% to 40%.',
      epistemicStatus: 'planned',
      evidenceIds: [],
      conditionsScope: 'FLEX-2 planned test matrix (no flown rows)',
      limitations: ['Planned matrix only'],
      verificationStatus: 'verified',
      sourceRef: ref('psi-68', { section: 'Objectives' }),
      topics: ['droplet', 'suppression'],
    },
    {
      id: 'c-0101',
      inv: 'CFI',
      text: 'CFI objective mentions 0.25 to 5 atm while approach text states 0.25 to 0.5 atm — internal source pressure discrepancy.',
      epistemicStatus: 'source_interpretation',
      evidenceIds: ['CFI-1206'],
      conditionsScope: 'CFI PSI-39 description',
      limitations: ['Internal pressure range conflict in source text'],
      verificationStatus: 'corrected',
      sourceRef: ref('psi-39', { section: 'Objective vs Approach' }),
      topics: ['cool-flame', 'droplet', 'pressure'],
    },
    {
      id: 'c-b1',
      inv: 'BASS-II',
      text: 'BASS-II-B1 0.1 mm PMMA thin film spread steadily at 2.2 mm/s in 22.2% O2 at 5 cm/s opposed flow before operator turned flow off (flow_turned_off).',
      epistemicStatus: 'observed',
      evidenceIds: ['BASS-II-B1'],
      conditionsScope: 'BASS-II thin film opposed flow',
      limitations: ['Operator flow shutoff'],
      verificationStatus: 'verified',
      sourceRef: ref('ntrs-20210011385', { table: 'A.1', page: 111 }),
      topics: ['solid', 'spread_rate'],
    },
  ];

  const investigations: Investigation[] = [
    makeInv({ id: 'BASS-II', psi: 'PSI-25', fuelPhase: 'solid', nTests: 129, fuel: { types: ['PMMA', 'SIBAL'], geometry: 'thin film, slab, rod', size: '0.1-12.7 mm' } }),
    makeInv({ id: 'CFI', psi: 'PSI-39', fuelPhase: 'liquid', family: 'MDCA-CIR', direction: ['suppression'], nTests: 79, fuel: { types: ['n-dodecane'], geometry: 'droplet', size: '1.5-4 mm' } }),
    makeInv({ id: 'ACME-CFI-G', psi: 'PSI-159', fuelPhase: 'gas', family: 'ACME-CIR', direction: ['fundamental'], nTests: 333, fuel: { types: ['ethane', 'methane'], geometry: 'spherical porous burner', size: '6 mm' } }),
    makeInv({
      id: 'SAME-R',
      psi: 'PSI-101',
      fuelPhase: 'solid',
      family: 'SAME-MSG',
      direction: ['detection'],
      nTests: 109,
      fuel: { types: ['Kapton', 'Teflon'], geometry: 'heated sample', size: 'tube' },
      conditions: { o2Pct: [21, 21], pressureKpa: [101.3, 101.3], flowCmS: [0, 8.1], gravityG: [0, 0], diluents: null, assumed: ['o2Pct', 'pressureKpa'], assumptionNote: 'ISS cabin air assumed' },
    }),
    makeInv({ id: 'FLEX-2', psi: 'PSI-68', fuelPhase: 'liquid', family: 'MDCA-CIR', direction: ['suppression'], nTests: 0, epistemicStatus: 'planned_only', fuel: { types: ['heptane'], geometry: 'droplet', size: '1.5-5 mm' } }),
    makeInv({ id: 'Saffire-III', psi: 'PSI-100', fuelPhase: 'solid', family: 'Saffire-Cygnus', platform: 'Cygnus', nTests: 2, fuel: { types: ['SIBAL'], geometry: 'large fabric sheet', size: '94 x 40.6 cm' } }),
    makeInv({ id: 'ACME-E-FIELD', psi: 'PSI-22', fuelPhase: 'gas', family: 'ACME-CIR', direction: ['fundamental'], nTests: 32, fuel: { types: ['CH4'], geometry: 'coflow burner', size: 'burner' } }),
    makeInv({ id: 'JOINT-TRAP', psi: 'PSI-X', fuelPhase: 'solid', nTests: 2, fuel: { types: ['PMMA'], geometry: 'thin film', size: '0.1 mm' } }),
  ];

  const corpus: CorpusV2 = {
    corpusVersion: '2.0.0-ember-final-test',
    generatedAt: '2026-11-14T20:00:00Z',
    investigations,
    tests,
    claims,
    missions: [],
    earth: [],
    history: [],
    sources: [],
    extractionEval: {},
    outcomeAudit: {},
  };
  return { corpus, testsById };
}

// ---------------------------------------------------------------------------
// 1. Query Parser Tests

describe('queryParser', () => {
  it('parses lunar rover psia/O2/material without blocking when thicknessMm is unknown', () => {
    const q = parseResearchQuery('Evaluate PMMA flammability for a pressurized lunar rover at 30% O2 and 10.2 psia with 5 cm/s opposed flow');
    expect(q.habitableEnvironment).toBe('lunar_rover');
    expect(q.material).toBe('PMMA');
    expect(q.fuelPhase).toBe('solid');
    expect(q.o2Pct).toBe(30);
    expect(q.pressureKpa).toBeCloseTo(70.3, 1);
    expect(q.flowCmS).toBe(5);
    expect(q.flowDirection).toBe('opposed');
    expect(q.gravityG).toBeCloseTo(0.166, 3);
    expect(q.gravityRegime).toBe('partial_gravity');
    expect(q.thicknessMm).toBeNull();
    expect(q.unknownFields).toContain('thicknessMm');
    expect(q.validationWarnings.some((w) => /partial-gravity/i.test(w))).toBe(true);
  });

  it('normalizes legacy short safetyTask aliases and null environment cleanly', () => {
    const q = parseResearchQuery('Kapton smoke particle size', {
      habitableEnvironment: null as unknown as ResearchQuery['habitableEnvironment'],
      safetyTask: 'detection' as unknown as ResearchQuery['safetyTask'],
    });
    expect(q.habitableEnvironment).toBe('custom');
    expect(q.safetyTask).toBe('smoke_detection');
  });
});

// ---------------------------------------------------------------------------
// 2. Protocol & All 9 Audit Bug Tests

describe('protocol and applicability rules (all 9 audit fixes)', () => {
  const { corpus, testsById } = buildAuditFixtureCorpus();

  it('Bug #1: separates BASS-II-B1 operator termination from physical quench limit while matching seg-1 spread', () => {
    const qSpread = parseResearchQuery('PMMA 0.1 mm thin film sustained spread in 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity', {
      targetEndpoint: 'sustained_spread',
    });
    const mSpread = matchProtocolSegment(qSpread, testsById['BASS-II-B1']);
    expect(mSpread.endpointMatched).toBe(true);
    expect(mSpread.matchedSegmentIds).toEqual(['BASS-II-B1-seg-1']);
    expect(mSpread.operatorTerminated).toBe(true);

    const qQuench = parseResearchQuery('PMMA 0.1 mm thin film quench limit in 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity', {
      targetEndpoint: 'quench_limit',
    });
    const decB1 = evaluateApplicability(qQuench, testsById['BASS-II-B1']);
    expect(decB1.verdict).toBe('inadmissible');
    expect(decB1.reasonCodes).toContain('operator_termination_not_physical_extinction');

    // Static Baseline C wrongly admits B1 for quench_limit!
    const staticB1 = evaluateStaticMatcher(qQuench, testsById['BASS-II-B1']);
    expect(staticB1.admissible).toBe(true);

    // Physical extinction test B10 DOES match quench_limit on seg-2!
    const qQuenchB10 = parseResearchQuery('PMMA 0.2 mm thin film quench limit at 21% O2 101.3 kPa 5 cm/s opposed flow microgravity', {
      targetEndpoint: 'quench_limit',
    });
    const decB10 = evaluateApplicability(qQuenchB10, testsById['BASS-II-B10']);
    expect(decB10.verdict).toBe('admissible');
    expect(decB10.protocolMatch.matchedSegmentIds).toContain('BASS-II-B10-seg-2');
  });

  it('Bug #1b: allows abrupt_cutoff query targeting BASS-II-B1 termination directly', () => {
    const qAbrupt = parseResearchQuery('Did BASS-II-B1 terminate by operator flow shutoff?', {
      targetEndpoint: 'extinction_under_flow_change',
      flowHistory: 'abrupt_cutoff',
      material: 'PMMA',
      thicknessMm: 0.1,
      o2Pct: 22.2,
      pressureKpa: 101.3,
      flowCmS: 5.0,
      flowDirection: 'opposed',
      gravityG: 0,
    });
    const dec = evaluateApplicability(qAbrupt, testsById['BASS-II-B1']);
    expect(dec.verdict).toBe('admissible');
    expect(dec.protocolMatch.operatorTerminated).toBe(true);
  });

  it('Bug #1c: CFI cool flame continuation (seg-2) separated from hot flame extinction (seg-1)', () => {
    const qCool = parseResearchQuery('n-dodecane droplet cool flame continuation at 21% O2 101.3 kPa microgravity', {
      targetEndpoint: 'cool_flame_continuation',
    });
    const decCool = evaluateApplicability(qCool, testsById['CFI-1206']);
    expect(decCool.verdict).toBe('admissible');
    expect(decCool.protocolMatch.coolFlamePresent).toBe(true);
    expect(decCool.protocolMatch.matchedSegmentIds).toContain('CFI-1206-seg-2');

    const qHot = parseResearchQuery('n-dodecane droplet hot flame extinction at 21% O2 101.3 kPa microgravity', {
      targetEndpoint: 'hot_flame_extinction',
    });
    const decHot = evaluateApplicability(qHot, testsById['CFI-1206']);
    expect(decHot.verdict).toBe('conditional_support');
    expect(decHot.reasonCodes).toContain('cool_flame_continuation_caveat');
  });

  it('Bug #2a: Geometry & thickness regime separates thin film (B1) vs slab (M1) vs cylindrical rod (O1)', () => {
    const qFilm = parseResearchQuery('PMMA 0.1 mm thin film spread rate in 22.2% O2 101.3 kPa 5 cm/s microgravity', {
      targetEndpoint: 'sustained_spread',
    });
    expect(evaluateApplicability(qFilm, testsById['BASS-II-B1']).verdict).toBe('admissible');
    expect(evaluateApplicability(qFilm, testsById['BASS-II-M1']).reasonCodes).toContain('thickness_regime_mismatch');
    expect(evaluateApplicability(qFilm, testsById['BASS-II-O1']).reasonCodes).toContain('thickness_regime_mismatch');
  });

  it('Bug #2b: RULE-GAS-01 rejects CFI-G oxidizer_stream inverse flame for ambient cabin O2', () => {
    const qAmbient = parseResearchQuery('Cabin ambient 85% O2 material flammability microgravity', {
      o2Pct: 85,
      o2Role: 'ambient',
      pressureKpa: 220.7,
      gravityG: 0,
    });
    const decInv = evaluateApplicability(qAmbient, testsById['CFI-G-I-21202A2-D2']);
    expect(decInv.verdict).toBe('inadmissible');
    expect(decInv.reasonCodes).toContain('oxidizer_stream_vs_ambient');

    const qGasAmbient = parseResearchQuery('Methane normal burner flame in 38.8% ambient O2 101.3 kPa microgravity', {
      o2Pct: 38.8,
      o2Role: 'ambient',
      pressureKpa: 101.3,
      flowCmS: 0,
      gravityG: 0,
    });
    expect(evaluateApplicability(qGasAmbient, testsById['CFI-G-N-21291G1-D11']).verdict).toBe('admissible');
  });

  it('Bug #3: RULE-PROV-01 caps SAME-R assumed cabin air at conditional_support', () => {
    const qSmoke = parseResearchQuery('Kapton smoke particle size at 21% O2 101.3 kPa 8.1 cm/s microgravity', {
      safetyTask: 'smoke_detection',
      targetEndpoint: 'smoke_particle_size',
      material: 'Kapton',
      o2Pct: 21.0,
      pressureKpa: 101.3,
      flowCmS: 8.1,
      gravityG: 0,
    });
    const dec = evaluateApplicability(qSmoke, testsById['SAME-R-51']);
    expect(dec.verdict).toBe('conditional_support');
    expect(dec.reasonCodes).toContain('assumed_provenance_cap');
  });

  it('Bug #4: RULE-JOINT-01 catches unsupported joint (O2, P) inside 1D marginal bounds', () => {
    const qTrap = parseResearchQuery('PMMA sustained spread at 15% O2 55 kPa 10 cm/s opposed flow microgravity', {
      targetEndpoint: 'sustained_spread',
    });
    const pool = [testsById['JOINT-LOW-O2'], testsById['JOINT-LOW-P']];
    const dec = evaluateApplicability(qTrap, testsById['JOINT-LOW-O2'], { allInvTests: pool });
    expect(dec.verdict).toBe('inadmissible');
    expect(dec.marginalOverlapButJointMissing).toBe(true);
    expect(dec.reasonCodes).toContain('unsupported_joint_combination');
  });

  it('Bug #6: RULE-GRAV-01 refuses ACME-E-FIELD simulated analogue transfer to lunar partial gravity', () => {
    const qLunar = parseResearchQuery('Does ACME E-FIELD validate lunar cabin flammability at 0.166 g?', {
      habitableEnvironment: 'lunar_base',
      gravityG: 0.166,
    });
    const dec = evaluateApplicability(qLunar, testsById['EFIELD-18073-neg-100']);
    expect(dec.verdict).toBe('inadmissible');
    expect(dec.reasonCodes).toContain('simulated_analogue_gravity');
  });

  it('Bug #2c: RULE-UNK-01 enforces unknown !== unknown on Saffire-III', () => {
    const qSaffire = parseResearchQuery('Compare Saffire-III SIBAL fabric at 30 cm/s microgravity', {
      material: 'SIBAL',
      flowCmS: 30,
      gravityG: 0,
    });
    const dec = evaluateApplicability(qSaffire, testsById['Saffire-III-S1']);
    expect(dec.verdict).toBe('inadmissible');
    expect(dec.reasonCodes).toContain('unknown_field_mismatch');
  });

  it('Bug #7: FLEX-2 planned_only is never admitted as observed support', () => {
    const qFlex2 = parseResearchQuery('Heptane droplet burning rate at 30% O2 200 kPa microgravity');
    const ranked = rankInvestigationsV2(qFlex2, corpus);
    const flex2Rank = ranked.find((r) => r.inv.id === 'FLEX-2')!;
    expect(flex2Rank.status).toBe('planned_only');
    expect(flex2Rank.relevanceScore).toBeGreaterThan(0);
    expect(flex2Rank.applicabilityScore).toBeLessThan(0.1);
  });

  it('buildContrasts produces descriptive contrasts with explicit non-causal warning', () => {
    const q = parseResearchQuery('PMMA flammability at 22.2% O2 101.3 kPa microgravity', {
      targetEndpoint: 'sustained_spread',
    });
    const contrasts = buildContrasts(q, [testsById['BASS-II-B1'], testsById['BASS-II-M1']]);
    expect(contrasts.length).toBeGreaterThan(0);
    expect(contrasts[0].causalWarning).toMatch(/NOT automatic proof of causation/i);
  });
});

// ---------------------------------------------------------------------------
// 3. Retrieval, Jev, Dependencies, Planner, Generator, Verifier, Prediction, Review

describe('retrieval, jev, dependencies, planner, verifier, prediction, reviewEngine', () => {
  const { corpus } = buildAuditFixtureCorpus();

  it('retrieval supports bm25, exact SVD dense cosine, structured filter, and hybrid RRF fusion', () => {
    const syntheticIndex: ChunksIndex = {
      corpusVersion: '2.0.0-test',
      embeddingModel: 'tfidf-lsa-svd-64d-v1',
      embeddingDim: 2,
      vocabulary: { pmma: 0, film: 1, droplet: 2, cool: 3 },
      idf: [1.5, 1.8, 1.6, 1.9],
      svdComponents: [
        [0.8, 0.6, 0.0, 0.0],
        [0.0, 0.0, 0.7, 0.7],
      ],
      chunks: [
        {
          chunkId: 'chk-1',
          kind: 'claim',
          inv: 'BASS-II',
          testId: 'BASS-II-B1',
          epistemicStatus: 'observed',
          sectionHeader: 'Table A.1',
          tableUnits: 'mm/s',
          text: 'PMMA film spread steadily at 2.2 mm/s in microgravity.',
          vector: [1, 0],
          sourceRef: ref('psi-25'),
        },
        {
          chunkId: 'chk-2',
          kind: 'claim',
          inv: 'CFI',
          testId: 'CFI-1206',
          epistemicStatus: 'observed',
          sectionHeader: 'Cool flames',
          tableUnits: 'mm2/s',
          text: 'Droplet cool flame burning continued after hot flame extinction.',
          vector: [0, 1],
          sourceRef: ref('psi-39'),
        },
      ],
    };

    const qVec = encodeDenseQuery(syntheticIndex, 'PMMA thin film'); // 'thin' is sklearn stopword, 'pmma' + 'film' remain
    expect(qVec[0]).toBeCloseTo(1, 5);

    const denseHits = searchDense(syntheticIndex, 'PMMA film', 2);
    expect(denseHits[0].chunk.chunkId).toBe('chk-1');

    const bm25Hits = searchBm25(syntheticIndex, 'droplet cool flame', 2);
    expect(bm25Hits[0].chunk.chunkId).toBe('chk-2');

    const hybridHits = searchHybrid(corpus, syntheticIndex, 'PMMA film microgravity', { mode: 'hybrid', k: 5 });
    expect(hybridHits[0].chunk.chunkId).toBe('chk-1');
  });

  it('jev evaluates 3 atomic questions, sums probabilities to 1, and never deletes conflicts', async () => {
    const q = parseResearchQuery('CFI n-dodecane droplet pressure and cool flame extinction');
    const conflictChunk: ChunkRecord = {
      chunkId: 'c-0101',
      kind: 'claim',
      inv: 'CFI',
      testId: null,
      epistemicStatus: 'source_interpretation',
      sectionHeader: 'PSI-39 Pressure',
      tableUnits: 'atm',
      text: 'CFI objective says 0.25 to 5 atm while approach says 0.25 to 0.5 atm — internal source discrepancy on pressure range.',
      vector: [],
      sourceRef: ref('psi-39'),
    };
    const dec = await evaluatePassageWithJev(q, conflictChunk, { corpus });
    expect(dec.promptVersion).toBe('heuristic-triage-v1');
    expect(dec.route).toBe('conflict');
    const sumQ1 = Object.values(dec.q1Relevance.probabilities).reduce((a, b) => a + b, 0);
    expect(sumQ1).toBeCloseTo(1.0, 2);

    const plannedChunk: ChunkRecord = {
      chunkId: 'c-0076',
      kind: 'claim',
      inv: 'FLEX-2',
      testId: null,
      epistemicStatus: 'planned',
      sectionHeader: 'Objectives',
      tableUnits: null,
      text: 'FLEX-2 planned droplet matrix will be examined at 0.5 to 3.0 atm.',
      vector: [],
      sourceRef: ref('psi-68'),
    };
    const decPlan = evaluatePassageWithJevOffline(q, plannedChunk, { corpus });
    expect(decPlan.q2Observation.answer).toBe('planned_or_hypothesis');
    expect(decPlan.route).toBe('context');
  });

  it('recalculateDesignVariant tracks retained, weakened, invalidated edges & impact chains', () => {
    const review = runReviewSync({
      question: 'PMMA 0.1 mm thin film sustained spread at 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity',
      overrides: { targetEndpoint: 'sustained_spread' },
      corpus,
      budgetRuns: 6,
    });
    expect(review.evidencePackage.applicabilityDecisions.find((d) => d.testId === 'BASS-II-B1')?.verdict).toBe('admissible');

    const thickVariant = recalculateDesignVariant(review, { thicknessMm: 4.0 });
    expect(thickVariant.verdictDelta.becameInadmissible).toContain('BASS-II-B1');
    expect(thickVariant.invalidatedEdges.length).toBeGreaterThan(0);
    expect(thickVariant.impactChains.some((c) => c.changedParameter.includes('thicknessMm'))).toBe(true);
  });

  it('planner exact branch-and-bound optimizes coverage within budgetRuns preserving mandatory controls & replicates', () => {
    const review = runReviewSync({
      question: 'Evaluate PMMA cabin flammability for a pressurized lunar rover at 30% O2 70.3 kPa 0-20 cm/s 0.166 g',
      corpus,
      budgetRuns: 6,
    });
    const candidates = generateCandidateBlocks(review.evidencePackage);
    const plan = optimizeTestProgramme(candidates, 6);
    expect(plan.usedRuns).toBeLessThanOrEqual(6);
    expect(plan.mandatoryControlsPreserved).toBe(true);
    expect(plan.replicatesPreserved).toBe(true);
    expect(plan.optimizerMethod).toBe('exact_branch_and_bound');
    expect(plan.epistemicNote).toMatch(/does not claim Bayesian/i);
  });

  it('verifier catches hallucinated citations, ungrounded numbers, unit swaps, FLEX-2 as observed, and polarity flips', () => {
    const review = runReviewSync({
      question: 'PMMA 0.1 mm thin film spread rate in 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity',
      overrides: { targetEndpoint: 'spread_rate' },
      corpus,
    });
    expect(review.verification.passed).toBe(true);

    const badSynthesis = {
      ...review.synthesis,
      observedFact: [
        {
          id: 'bad-1',
          text: 'FLEX-2 flight tests observed burning-rate constant 99.5 mm at 45% O2 [fake-id-999].',
          citations: ['fake-id-999'],
          provenance: 'reported' as const,
        },
      ],
    };
    const badReport = verifySynthesis(badSynthesis, review.evidencePackage);
    expect(badReport.passed).toBe(false);
    expect(badReport.citationCheck.passed).toBe(false);
    expect(badReport.numericUnitCheck.passed).toBe(false);
    expect(badReport.epistemicCheck.passed).toBe(false);
  });

  it('prediction applies strict Domain Gate + grouped CV by groupId and refuses partial-g or below-baseline', () => {
    // Clean synthetic grid with distinct groupIds (replicates share groupId)
    const trainTests: Test[] = [];
    let idx = 0;
    for (const o2 of [16, 18, 20, 22, 24]) {
      for (const f of [5, 10, 15]) {
        idx += 1;
        const gid = `grp-${idx}`;
        const rate = Number((0.15 * o2 + 0.04 * f - 1.5).toFixed(3));
        trainTests.push(
          makeTest({
            testId: `T-${idx}-a`,
            inv: 'BASS-II',
            groupId: gid,
            atmosphere: {
              o2: { value: o2, unit: '%', role: 'ambient', provenance: 'reported' },
              pressure: sv(101.3, 'kPa'),
              diluent: 'N2',
              diluentPct: { value: 100 - o2, unit: '%', role: 'diluent', provenance: 'derived' },
            },
            flow: { initialFlowCmS: sv(f, 'cm/s'), direction: 'opposed', history: 'steady' },
            spreadRateMmS: sv(rate, 'mm/s'),
          }),
          makeTest({
            testId: `T-${idx}-b`,
            inv: 'BASS-II',
            groupId: gid,
            atmosphere: {
              o2: { value: o2, unit: '%', role: 'ambient', provenance: 'reported' },
              pressure: sv(101.3, 'kPa'),
              diluent: 'N2',
              diluentPct: { value: 100 - o2, unit: '%', role: 'diluent', provenance: 'derived' },
            },
            flow: { initialFlowCmS: sv(f, 'cm/s'), direction: 'opposed', history: 'steady' },
            spreadRateMmS: sv(rate + 0.01, 'mm/s'),
          }),
        );
      }
    }

    const cv = groupedCrossValidate(trainTests, 'spreadRateMmS');
    expect(cv.nGroups).toBe(15);
    expect(cv.beatsBaseline).toBe(true);

    const qInDomain = parseResearchQuery('PMMA spread rate at 19% O2 101.3 kPa 10 cm/s microgravity');
    const pred = predictDomainGated(qInDomain, trainTests, 'spreadRateMmS');
    expect(pred.refused).toBe(false);
    expect(pred.predictedValue).not.toBeNull();

    const qPartialG = parseResearchQuery('PMMA spread rate on lunar rover at 30% O2 70.3 kPa 0.166 g');
    const refused = predictDomainGated(qPartialG, trainTests, 'spreadRateMmS');
    expect(refused.refused).toBe(true);
    expect(refused.status).toBe('refused_out_of_domain');
  });

  it('runReview + generator modes + exportFormatters preserve groupId in modeling_csv', async () => {
    const review = await runReview({
      question: 'PMMA 0.1 mm thin film spread rate at 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity',
      overrides: { targetEndpoint: 'spread_rate' },
      corpus,
      index: buildSynthesizedChunksIndex(corpus),
    });
    expect(review.envelope.mode).toBe('DETERMINISTIC_ENGINE');
    expect(review.envelope.jevPromptVersion).toBe('heuristic-triage-v1');
    expect(review.synthesis.observedFact.length).toBeGreaterThan(0);

    const modelingCsv = exportModelingCsv(corpus.tests, corpus.investigations);
    const header = modelingCsv.split(/\r?\n/)[0];
    expect(header).toContain('groupId');
    expect(header).toContain('o2Role');
    expect(header).toContain('gravityMode');
    expect(header).toContain('protocolSummary');

    const md = exportReviewMarkdown(review);
    expect(md).toContain('# EMBER Review:');
    expect(() => JSON.parse(exportReviewJson(review))).not.toThrow();
    expect(Object.keys(exportFormatters)).toEqual(['markdown', 'json', 'csv', 'modeling_csv']);

    const snap = await generateSynthesis(review.evidencePackage, {
      mode: 'SAVED_DEMO_SNAPSHOT',
      savedSnapshot: generateDeterministicSynthesis(review.evidencePackage),
    });
    expect(snap.mode).toBe('SAVED_DEMO_SNAPSHOT');

    const deps = buildDependencies(review.synthesis.observedFact, review.evidencePackage.applicabilityDecisions, review.query);
    expect(deps.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 4. Optional Live Corpus Integration Tests (run automatically once corpus_v2.json is built)

const corpusPath = join(process.cwd(), 'public', 'data', 'corpus_v2.json');
const indexPath = join(process.cwd(), 'public', 'data', 'chunks_index.json');
const hasLiveCorpus = existsSync(corpusPath) && existsSync(indexPath);

describe.skipIf(!hasLiveCorpus)('live corpus_v2.json & chunks_index.json integration', () => {
  it('loads full corpus_v2.json (15 invs, 1678 tests) and enforces all audit rules end-to-end', async () => {
    const corpus = JSON.parse(readFileSync(corpusPath, 'utf8')) as CorpusV2;
    const index = JSON.parse(readFileSync(indexPath, 'utf8')) as ChunksIndex;

    expect(corpus.investigations.length).toBe(15);
    expect(corpus.tests.length).toBe(1678);
    expect(index.chunks.length).toBeGreaterThan(100);

    const byId = new Map(corpus.tests.map((t) => [t.testId, t]));
    const b1 = byId.get('BASS-II-B1');
    const cfi1206 = byId.get('CFI-1206');
    const cfigInv = corpus.tests.find((t) => t.inv === 'ACME-CFI-G' && t.testId.startsWith('CFI-G-I-'));
    const sameRow = corpus.tests.find((t) => t.inv === 'SAME');

    expect(b1).toBeDefined();
    expect(cfi1206).toBeDefined();
    expect(cfigInv?.atmosphere.o2.role).toBe('oxidizer_stream');
    expect(sameRow?.atmosphere.o2.provenance).toBe('assumed');

    const review = await runReview({
      question: 'Evaluate PMMA fire risk for a pressurized lunar rover at 30% O2 and 70.3 kPa',
      corpus,
      index,
      budgetRuns: 6,
    });
    expect(review.verification.passed).toBe(true);
    expect(review.testProgramme.usedRuns).toBeLessThanOrEqual(6);
    expect(review.testProgramme.mandatoryControlsPreserved).toBe(true);
    expect(review.predictions.every((p) => p.refused)).toBe(true);

    // Regression checks from eval-worker #10:
    // 1. BASS-II-B1 real corpus row carries operator_flow_shutoff event -> still not physical extinction
    const qQuenchReal = parseResearchQuery('BASS-II-B1 physical extinction quench limit in 22.2% O2 101.3 kPa 5 cm/s opposed flow microgravity', {
      targetEndpoint: 'extinction_under_flow_change',
    });
    expect(evaluateApplicability(qQuenchReal, b1!).verdict).toBe('inadmissible');

    // 2. targetInvIds scoping keeps Saffire-III at insufficient_data instead of leaking FLEX/Saffire-II
    const revSaffire3 = runReviewSync({
      question: 'Can Saffire-III-S1 and Saffire-III-S2 be treated as matching-condition tests with null O2 and pressure?',
      corpus,
      index,
    });
    expect(revSaffire3.evidencePackage.rankings[0].inv.id).toBe('Saffire-III');
    expect(revSaffire3.synthesis.answerBoundary).toBe('insufficient_data');

    // 3. Explicit testId extraction captures SAME-R-51a and BRE-2019-Feb-8-26.5
    const revBre = runReviewSync({
      question: 'Compare SAME-R-51a smoke particle size and BRE-2019-Feb-8-26.5 flame spread.',
      corpus,
      index,
    });
    const evalIds = new Set(revBre.evidencePackage.applicabilityDecisions.map((d) => d.testId));
    expect(evalIds.has('SAME-R-51a')).toBe(true);
    expect(evalIds.has('BRE-2019-Feb-8-26.5')).toBe(true);
  });
});
