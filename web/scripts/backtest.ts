/**
 * EMBER backtests -> validation.json (see docs/DATA_CONTRACT.md).
 *
 *   npm run backtest                 # reads public/data, writes public/data/validation.json
 *   npm run backtest -- --fixtures   # reads fixtures/data, writes fixtures/data/validation.json
 *   npx tsx scripts/backtest.ts --data <dir> --out <file>
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_ESTIMATE_OPTIONS,
  dataCoverage,
  leaveOneInvestigationOut,
  leaveOneOutNumeric,
  leaveOneTestOut,
  NUMERIC_TARGETS,
  targetValue,
  usableTests,
  type ClassMetrics,
  type NumericBacktest,
} from '../src/lib/evidence.ts';
import type { TestRow, Validation } from '../src/lib/types.ts';
import { parseJsonLenient } from '../src/lib/json.ts';
import { normalizeTest } from '../src/data/normalize.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = resolve(here, '..');
const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const opt = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const fixtures = flag('--fixtures');
const dataDir = resolve(opt('--data') ?? join(webRoot, fixtures ? 'fixtures/data' : 'public/data'));
const outFile = resolve(opt('--out') ?? join(dataDir, 'validation.json'));
const testsPath = join(dataDir, 'tests.json');

if (!existsSync(testsPath)) {
  console.error(`No tests.json in ${dataDir}. Run the data pipeline first, or use --fixtures.`);
  process.exit(1);
}

const parsed = parseJsonLenient(readFileSync(testsPath, 'utf8'));
if (parsed.repaired) console.warn(`warning: tests.json had ${parsed.repaired} NaN/Infinity values (invalid JSON) — treated as null`);
const tests = (parsed.value as TestRow[]).map(normalizeTest);
const usable = usableTests(tests);
const pct = (c: number, n: number) => (n ? `${((100 * c) / n).toFixed(1)}%` : 'n/a');

const loto = leaveOneTestOut(tests);
const lotoG = leaveOneTestOut(tests, {}, { grouped: true });
const loio = leaveOneInvestigationOut(tests);
const numeric: NumericBacktest[] = [];
for (const target of NUMERIC_TARGETS) {
  if (!tests.some((t) => targetValue(t, target) !== null)) continue;
  numeric.push(leaveOneOutNumeric(tests, target));
  numeric.push(leaveOneOutNumeric(tests, target, {}, { grouped: true }));
}
const coverage = dataCoverage(tests);

const acc = (m: ClassMetrics) => ({ n: m.n, correct: m.correct, accuracy: m.accuracy, baseline: m.baseline.accuracy, flaggingRate: m.flaggingRate });
const pick = (r: { perInvestigation: Record<string, ClassMetrics> }, id: string) => (r.perInvestigation[id] ? acc(r.perInvestigation[id]) : null);

const validation: Validation = {
  generatedAt: new Date().toISOString(),
  dataset: fixtures ? 'fixtures' : 'public/data',
  method:
    'Outcomes collapsed to burn (burned, flame_spread, completed, disruption) vs no-burn (extinguished, self_extinguished, no_ignition); ' +
    'rows with other outcomes are skipped. Prediction = inverse-distance-weighted kNN (k=5, power 2) in normalized ' +
    'O2/pressure/flow space with fuel-phase, material and gravity penalties (src/lib/evidence.ts). Every accuracy is reported with ' +
    'a majority-class baseline (always predict the most common outcome of the same set of tests) and its n. Numeric targets use the ' +
    'same distance and status rules (kNN regression).',
  backtests: [
    {
      name: 'leave-one-test-out',
      description:
        'Each test is hidden in turn and its burn / no-burn outcome is predicted from all other tests, including near-identical ' +
        'replicates of the same investigation (which is why most answers are "Measured").',
      n: loto.n,
      correct: loto.correct,
      overall: loto.overall,
      perInvestigation: loto.perInvestigation,
      byPhase: loto.byPhase,
      byStatus: loto.byStatus,
      details: loto.details as unknown as Record<string, unknown>[],
    },
    {
      name: 'leave-one-test-out-grouped',
      description:
        'As leave-one-test-out, but when a test is hidden, every test of the same investigation within the Measured tolerance ' +
        '(same phase and material, ±0.6% O2, ±3 kPa, ±2 cm/s) is hidden with it, so the model cannot copy a replicate.',
      n: lotoG.n,
      correct: lotoG.correct,
      overall: lotoG.overall,
      perInvestigation: lotoG.perInvestigation,
      byPhase: lotoG.byPhase,
      byStatus: lotoG.byStatus,
      replicates: lotoG.replicates,
      details: [], // per-test rows omitted to keep validation.json small (same shape as leave-one-test-out)
    },
    {
      name: 'leave-one-investigation-out',
      description:
        'Hide an experiment: all tests of one investigation are removed and each is estimated from the other investigations only. ' +
        'Strict accuracy counts correct predictions only. Flagging rate = share of the wrong answers that the system had labelled ' +
        'Extrapolated (it warned you). Baselines: majority outcome of the hidden tests (pooled) and majority outcome of the other investigations.',
      n: loio.overall.n,
      correct: loio.overall.correct,
      investigations: loio.investigations,
      overall: loio.overall,
      trainMajority: loio.trainMajority,
      byPhase: loio.byPhase,
      testLevel: { n: loio.tests.n, correct: loio.tests.correct, byStatus: loio.tests.byStatus },
      details: loio.details as unknown as Record<string, unknown>[],
    },
  ],
  numeric: numeric.map(({ details: _details, ...rest }) => rest) as unknown as Record<string, unknown>[],
  coverage: coverage as unknown as Record<string, unknown>,
  headline: {
    withinExperiment: acc(loto.overall),
    withinExperimentGrouped: acc(lotoG.overall),
    acrossExperiments: { ...acc(loio.overall), trainMajorityBaseline: loio.trainMajority.accuracy },
    solids: {
      loto: loto.byPhase.solid ? acc(loto.byPhase.solid) : null,
      grouped: lotoG.byPhase.solid ? acc(lotoG.byPhase.solid) : null,
      bass2: { loto: pick(loto, 'BASS-II'), grouped: pick(lotoG, 'BASS-II') },
      bass: { loto: pick(loto, 'BASS'), grouped: pick(lotoG, 'BASS') },
    },
  },
  physicsModel: null,
  parameters: {
    k: DEFAULT_ESTIMATE_OPTIONS.k,
    power: DEFAULT_ESTIMATE_OPTIONS.power,
    scales: DEFAULT_ESTIMATE_OPTIONS.scales,
    tolerance: DEFAULT_ESTIMATE_OPTIONS.tolerance,
    localRadius: DEFAULT_ESTIMATE_OPTIONS.localRadius,
    maxInterpDistance: DEFAULT_ESTIMATE_OPTIONS.maxInterpDistance,
    rowsTotal: tests.length,
    rowsUsable: usable.length,
    rowsInNoEstimate: coverage.total.none,
  },
};

writeFileSync(outFile, JSON.stringify(validation, null, 2) + '\n');

const f = (m: ClassMetrics) =>
  `${pct(m.correct, m.n).padStart(6)} (${m.correct}/${m.n}) baseline ${pct(m.baseline.correct, m.n).padStart(6)}  ` +
  `[M ${m.byStatus.measured.n} / I ${m.byStatus.interpolated.n} / E ${m.byStatus.extrapolated.n}] wrong flagged ${pct(m.wrongFlagged, m.wrong)} (${m.wrongFlagged}/${m.wrong})`;
console.log(`EMBER backtest — ${tests.length} rows, ${usable.length} with burn/no-burn outcome, ${coverage.total.none} in no estimate (${dataDir})`);
for (const [label, r] of [['leave-one-test-out', loto], ['grouped leave-one-test-out', lotoG]] as const) {
  console.log(`  ${label.padEnd(28)} ${f(r.overall)}`);
  for (const [ph, m] of Object.entries(r.byPhase)) console.log(`    ${ph.padEnd(26)} ${f(m)}`);
  for (const id of ['BASS-II', 'BASS']) if (r.perInvestigation[id]) console.log(`    ${id.padEnd(26)} ${f(r.perInvestigation[id])}`);
}
console.log(`  grouped: ${lotoG.replicates?.testsWithReplicates} of ${lotoG.n} held-out tests had replicates (${lotoG.replicates?.removedTotal} rows removed in total)`);
console.log(`  leave-one-investigation-out  ${f(loio.overall)}; other-investigations-majority baseline ${pct(loio.trainMajority.correct, loio.overall.n)}`);
for (const d of loio.details) console.log(`    ${d.inv.padEnd(26)} ${f(d)} train-majority ${pct(d.trainMajority.correct, d.n)}`);
const e = (s: { n: number; mae: number | null; medianAbsPctErr: number | null }) =>
  `MAE ${s.mae === null ? 'n/a' : s.mae.toPrecision(3)} medAPE ${s.medianAbsPctErr === null ? 'n/a' : `${(100 * s.medianAbsPctErr).toFixed(0)}%`} (n=${s.n})`;
for (const nb of numeric) {
  const o = nb.overall;
  console.log(`  ${nb.target}${nb.grouped ? ' grouped' : ''} [${nb.unit}] rows ${o.n}, predicted ${o.nPredicted}: model ${e(o.model)} | inv-mean ${e(o.baselineInvMean)} | global-mean ${e(o.baselineGlobalMean)}`);
}
console.log(`wrote ${outFile}`);
