/**
 * Builds public/data/trust.json: a grouped leave-out backtest of EMBER's plain-language status labels.
 *
 * For every flight test whose record says whether a flame was established (yes / no), its whole
 * replicate group (groupId) is hidden. The test's own conditions are then sent to the same
 * applicability engine the app uses, against the remaining tests of the same fuel phase:
 *   Measured            = at least one remaining test passes every rule -> majority outcome of those tests
 *   Data nearby         = only conditional tests remain                 -> majority outcome of those tests
 *   Beyond the evidence = nothing applies                               -> outcome of the nearest test (shown, not claimed)
 * Baseline: always guess the most common outcome of the remaining same-phase tests.
 * Liquid droplets are excluded: every droplet record with an outcome ignited, so there is nothing to predict.
 *
 *   npx tsx scripts/build-trust.mts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { evaluateApplicability, parseResearchQuery, type CorpusV2, type Test } from '../src/core';

const corpus = JSON.parse(readFileSync('public/data/corpus_v2.json', 'utf8')) as CorpusV2;
const invById = new Map(corpus.investigations.map((i) => [i.id, i]));

const YES = new Set(['ignited_flame_spread', 'ignited_burned', 'burned', 'hot_flame_ignited', 'hot_ignition', 'jet_flame_established']);
const NO = new Set(['self_extinguished', 'no_ignition']);
const label = (t: Test): 'yes' | 'no' | null => (YES.has(t.initialOutcome) ? 'yes' : NO.has(t.initialOutcome) ? 'no' : null);

type Status = 'measured' | 'nearby' | 'beyond';
interface Bucket { n: number; correct: number; baselineCorrect: number }
const empty = (): Bucket => ({ n: 0, correct: 0, baselineCorrect: 0 });

const phases = ['solid', 'gas'] as const;
const result: Record<string, { all: Bucket; byStatus: Record<Status, Bucket>; baselineClass: Record<string, number>; excluded: number }> = {};
const t0 = Date.now();

for (const phase of phases) {
  const pool = corpus.tests.filter((t) => t.fuelPhase === phase && t.gravity.mode === 'actual_flight');
  const labelled = pool.filter((t) => label(t) !== null && t.atmosphere.o2.provenance !== 'assumed');
  const all = empty();
  const byStatus: Record<Status, Bucket> = { measured: empty(), nearby: empty(), beyond: empty() };
  const baselineClass: Record<string, number> = { yes: 0, no: 0 };
  for (const t of labelled) {
    const truth = label(t)!;
    const train = pool.filter((x) => x.groupId !== t.groupId);
    const trainLabelled = train.filter((x) => label(x) !== null);
    const yes = trainLabelled.filter((x) => label(x) === 'yes').length;
    const baseline: 'yes' | 'no' = yes >= trainLabelled.length - yes ? 'yes' : 'no';
    baselineClass[baseline] += 1;

    const q = parseResearchQuery(
      '',
      {
        habitableEnvironment: 'custom',
        fuelPhase: phase,
        material: t.fuel,
        o2Pct: t.atmosphere.o2.value,
        pressureKpa: t.atmosphere.pressure.value,
        flowCmS: t.flow.initialFlowCmS.value,
        gravityG: t.gravity.gravityG.value,
        safetyTask: 'material_screening',
        targetEndpoint: null,
        geometry: t.geometry,
        thicknessMm: t.thicknessMm.value,
        diameterMm: t.diameterMm.value,
        targetInvIds: [],
      },
      { applyEnvironmentDefaults: false },
    );
    const byInv = new Map<string, Test[]>();
    for (const x of train) (byInv.get(x.inv) ?? byInv.set(x.inv, []).get(x.inv)!).push(x);
    const decisions = trainLabelled.map((x) => ({ x, d: evaluateApplicability(q, x, { investigation: invById.get(x.inv), allInvTests: byInv.get(x.inv) }) }));
    const adm = decisions.filter((e) => e.d.verdict === 'admissible');
    const cond = decisions.filter((e) => e.d.verdict === 'conditional_support');
    const status: Status = adm.length ? 'measured' : cond.length ? 'nearby' : 'beyond';
    let guess: 'yes' | 'no';
    const vote = (list: typeof decisions) => (list.filter((e) => label(e.x) === 'yes').length * 2 >= list.length ? 'yes' : 'no');
    if (status === 'measured') guess = vote(adm);
    else if (status === 'nearby') guess = vote(cond);
    else {
      const ranked = decisions.filter((e) => e.d.jointDistance !== null).sort((a, b) => (a.d.jointDistance as number) - (b.d.jointDistance as number));
      guess = ranked.length ? label(ranked[0].x)! : baseline;
    }
    for (const b of [all, byStatus[status]]) {
      b.n += 1;
      if (guess === truth) b.correct += 1;
      if (baseline === truth) b.baselineCorrect += 1;
    }
  }
  result[phase] = { all, byStatus, baselineClass, excluded: pool.length - labelled.length };
  console.log(phase, JSON.stringify(result[phase]), `${((Date.now() - t0) / 1000).toFixed(0)} s`);
}

const liquid = corpus.tests.filter((t) => t.fuelPhase === 'liquid');
writeFileSync(
  'public/data/trust.json',
  JSON.stringify(
    {
      generatedAt: new Date().toISOString(),
      corpusVersion: corpus.corpusVersion,
      method:
        'Grouped leave-out: each flight test with a recorded flame / no-flame outcome is hidden together with its replicate group, then its conditions are run through the applicability engine against the remaining tests of the same fuel phase. Assumed-atmosphere records (SAME / SAME-R) are not scored.',
      outcome: 'Flame established (ignited, burned, spread, hot ignition, jet flame) vs not (no ignition, went out by itself).',
      phases: result,
      liquidExcluded: { rows: liquid.length, withNegativeOutcome: liquid.filter((t) => NO.has(t.initialOutcome)).length },
    },
    null,
    1,
  ),
);
