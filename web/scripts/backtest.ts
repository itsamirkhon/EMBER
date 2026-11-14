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
  leaveOneInvestigationOut,
  leaveOneTestOut,
  usableTests,
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
const loio = leaveOneInvestigationOut(tests);

const validation: Validation = {
  generatedAt: new Date().toISOString(),
  dataset: fixtures ? 'fixtures' : 'public/data',
  method:
    'Outcomes collapsed to burn (burned, flame_spread, completed, disruption) vs no-burn (extinguished, self_extinguished, no_ignition); ' +
    'rows with other outcomes are skipped. Prediction = inverse-distance-weighted kNN (k=5, power 2) in normalized ' +
    'O2/pressure/flow space with fuel-phase, material and gravity penalties (src/lib/evidence.ts).',
  backtests: [
    {
      name: 'leave-one-test-out',
      description:
        'Each test is hidden in turn and its burn / no-burn outcome is predicted from all other tests (other tests of the same investigation included).',
      n: loto.n,
      correct: loto.correct,
      perInvestigation: loto.perInvestigation,
      byStatus: loto.byStatus,
      details: loto.details as unknown as Record<string, unknown>[],
    },
    {
      name: 'leave-one-investigation-out',
      description:
        'Hide an experiment: all tests of one investigation are removed and each is estimated from the other investigations only. ' +
        `An investigation passes when at least ${loio.passThreshold * 100}% of its tests are handled honestly: the outcome is predicted ` +
        'correctly, or the system flagged the point as Extrapolated instead of claiming knowledge.',
      n: loio.n,
      correct: loio.correct,
      passThreshold: loio.passThreshold,
      testLevel: { n: loio.tests.n, correct: loio.tests.correct, byStatus: loio.tests.byStatus },
      details: loio.details as unknown as Record<string, unknown>[],
    },
  ],
  physicsModel: null,
};
(validation as unknown as Record<string, unknown>).parameters = {
  k: DEFAULT_ESTIMATE_OPTIONS.k,
  power: DEFAULT_ESTIMATE_OPTIONS.power,
  scales: DEFAULT_ESTIMATE_OPTIONS.scales,
  tolerance: DEFAULT_ESTIMATE_OPTIONS.tolerance,
  localRadius: DEFAULT_ESTIMATE_OPTIONS.localRadius,
  maxInterpDistance: DEFAULT_ESTIMATE_OPTIONS.maxInterpDistance,
  rowsTotal: tests.length,
  rowsUsable: usable.length,
};

writeFileSync(outFile, JSON.stringify(validation, null, 2) + '\n');

console.log(`EMBER backtest — ${tests.length} rows, ${usable.length} with burn/no-burn outcome (${dataDir})`);
console.log(`  leave-one-test-out:          ${loto.correct}/${loto.n} correct (${pct(loto.correct, loto.n)})`);
for (const [s, v] of Object.entries(loto.byStatus)) console.log(`    ${s.padEnd(13)} ${v.correct}/${v.n} (${pct(v.correct, v.n)})`);
console.log(`  leave-one-investigation-out: ${loio.correct}/${loio.n} investigations pass`);
for (const d of loio.details) {
  console.log(
    `    ${d.inv.padEnd(16)} n=${String(d.n).padStart(3)} acc=${pct(d.predictionCorrect, d.n).padStart(6)} honest=${pct(d.honest, d.n).padStart(6)} ` +
      `[M ${d.statusCounts.measured} / I ${d.statusCounts.interpolated} / E ${d.statusCounts.extrapolated}]`,
  );
}
console.log(`wrote ${outFile}`);
