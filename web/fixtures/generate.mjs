// Generates small synthetic fixture data following docs/DATA_CONTRACT.md.
import { writeFileSync, mkdirSync } from 'node:fs';
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
let seed = 42;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const r1 = (x) => Math.round(x * 10) / 10;
const FIX = 'FIXTURE — synthetic values for UI development, not NASA data.';

const psi = (n) => `https://psi.nasa.gov/physci/repo/data/investigations/PSI-${n}`;
const inv = (o) => ({
  doiVerified: false, earthRelevance: null, dataNotes: [FIX], varied: [], constant: [], diagnostics: [],
  keyFindings: [], years: null, ...o,
});

const investigations = [
  inv({ id: 'BASS-II', name: 'Burning and Suppression of Solids – II', psi: 'PSI-25', psiUrl: psi(25), doi: '10.60555/4qc4-de67', doiVerified: true,
    family: 'MSG-SPICE', hardware: 'Microgravity Science Glovebox, BASS flow duct', platform: 'ISS', fuelPhase: 'solid',
    direction: ['prevention'], safetyConsequence: 3,
    objective: 'Measure flame spread and extinction limits of thin and thick solid fuels in a low-speed flow in microgravity.',
    fuel: { types: ['PMMA', 'cotton-fiberglass (SIBAL)'], geometry: 'flat sheets, cylinders', size: '1–10 cm samples' },
    conditions: { o2Pct: [15, 21], pressureKpa: [50, 101.3], flowCmS: [0, 40], gravityG: [0, 1], diluents: ['N2'] },
    varied: ['O2 concentration', 'flow velocity', 'sample thickness'], constant: ['diluent N2'],
    diagnostics: ['color video', 'radiometer', 'thermocouples'],
    resultSummary: 'Fixture summary: flames on thin fuels survived to lower oxygen in a gentle forced flow than in quiescent conditions; very low flows starved the flame.',
    keyFindings: [{ text: 'Fixture: a weak opposed flow of a few cm/s lowers the oxygen needed to sustain flame spread.', sourceId: 'fx-psi-25' }],
    nTests: 0, flight: true, rawDataAvailable: true, years: '2012–2013',
    earthRelevance: 'Informs material flammability screening and ventilation design.',
    sources: [{ id: 'fx-psi-25', label: 'PSI-25 investigation page', url: psi(25), type: 'psi' }] }),
  inv({ id: 'Saffire-II', name: 'Spacecraft Fire Safety Experiment II', psi: 'PSI-99', psiUrl: psi(99), doi: null,
    family: 'Saffire-Cygnus', hardware: 'Saffire flow unit in Cygnus cargo vehicle', platform: 'Cygnus', fuelPhase: 'solid',
    direction: ['prevention'], safetyConsequence: 3,
    objective: 'Large-scale ignition and flame spread over spacecraft materials after the vehicle leaves the ISS.',
    fuel: { types: ['SIBAL', 'Nomex', 'PMMA'], geometry: 'large sheets', size: '~5 × 30 cm' },
    conditions: { o2Pct: [21, 21], pressureKpa: [101.3, 101.3], flowCmS: [20, 25], gravityG: [0, 0], diluents: ['N2'] },
    varied: ['material'], constant: ['air at 1 atm', 'flow ~20 cm/s'], diagnostics: ['video', 'O2/CO2 sensors', 'radiometers'],
    resultSummary: 'Fixture summary: some materials burned, others failed to ignite at ambient conditions.',
    keyFindings: [{ text: 'Fixture: large-sample flames reached steady spread rates in concurrent flow.', sourceId: 'fx-psi-99' }],
    nTests: 0, flight: true, rawDataAvailable: false, years: '2016',
    sources: [{ id: 'fx-psi-99', label: 'PSI-99 investigation page', url: psi(99), type: 'psi' }] }),
  inv({ id: 'FLEX', name: 'Flame Extinguishment Experiment', psi: 'PSI-69', psiUrl: psi(69), doi: '10.60555/mbq8-0451', doiVerified: true,
    family: 'MDCA-CIR', hardware: 'Multi-user Droplet Combustion Apparatus in CIR', platform: 'ISS', fuelPhase: 'liquid',
    direction: ['suppression'], safetyConsequence: 3,
    objective: 'Burn isolated fuel droplets in diluted atmospheres to find suppressant concentrations that extinguish flames.',
    fuel: { types: ['heptane', 'methanol'], geometry: 'droplets', size: '1.5–4 mm' },
    conditions: { o2Pct: [15, 30], pressureKpa: [50, 101.3], flowCmS: [0, 0], gravityG: [0, 0], diluents: ['N2', 'CO2', 'He'] },
    varied: ['O2', 'diluent', 'droplet diameter'], constant: ['quiescent'], diagnostics: ['backlit video', 'radiometer'],
    resultSummary: 'Fixture summary: higher CO2 dilution led to flame extinction; some heptane droplets showed cool-flame burning.',
    keyFindings: [{ text: 'Fixture: CO2 dilution extinguished droplet flames at lower O2 than N2 dilution.', sourceId: 'fx-psi-69' }],
    nTests: 0, flight: true, rawDataAvailable: true, years: '2009–2012',
    dataNotes: [FIX, 'FLEX burning-rate column header says mm but the unit is mm²/s — corrected.'],
    sources: [{ id: 'fx-psi-69', label: 'PSI-69 investigation page', url: psi(69), type: 'psi' }] }),
  inv({ id: 'SAME', name: 'Smoke Aerosol Measurement Experiment', psi: 'PSI-102', psiUrl: psi(102), doi: '10.60555/gd4k-8h62', doiVerified: true,
    family: 'SAME-MSG', hardware: 'Microgravity Science Glovebox, SAME smoke rig', platform: 'ISS', fuelPhase: 'solid',
    direction: ['detection'], safetyConsequence: 3,
    objective: 'Characterize smoke particle sizes from overheated spacecraft materials to design smoke detectors.',
    fuel: { types: ['Teflon', 'Kapton', 'silicone rubber', 'cellulose'], geometry: 'heated samples', size: null },
    conditions: { o2Pct: [21, 21], pressureKpa: [101.3, 101.3], flowCmS: null, gravityG: [0, 0], diluents: null },
    varied: ['material', 'heating temperature', 'aging time'], constant: ['cabin air'], diagnostics: ['particle counters', 'thermal precipitator'],
    resultSummary: 'Fixture summary: smoke particles differed in size from ground tests, affecting detector response.',
    keyFindings: [{ text: 'Fixture: microgravity smoke particles were larger than in 1g for some materials.', sourceId: 'fx-psi-102' }],
    nTests: 0, flight: true, rawDataAvailable: true, years: '2007–2008',
    sources: [{ id: 'fx-psi-102', label: 'PSI-102 investigation page', url: psi(102), type: 'psi' }] }),
  inv({ id: 'ACME-BRE', name: 'ACME Burning Rate Emulator', psi: 'PSI-20', psiUrl: psi(20), doi: null,
    family: 'ACME-CIR', hardware: 'ACME insert in Combustion Integrated Rack', platform: 'ISS', fuelPhase: 'gas',
    direction: ['prevention', 'fundamental'], safetyConsequence: 2,
    objective: 'Emulate burning of condensed fuels with a porous gas burner to measure flammability in quiescent atmospheres.',
    fuel: { types: ['ethylene', 'methane'], geometry: 'porous sphere burner', size: '25 mm' },
    conditions: { o2Pct: [17, 25], pressureKpa: [50, 101.3], flowCmS: [0, 0], gravityG: [0, 0], diluents: ['N2'] },
    varied: ['fuel flow', 'O2', 'pressure'], constant: ['quiescent'], diagnostics: ['video', 'radiometers'],
    resultSummary: 'Fixture summary: emulated condensed-fuel flames were more flammable at reduced pressure with elevated O2.',
    keyFindings: [{ text: 'Fixture: extinction occurred at lower heat of gasification in quiescent microgravity.', sourceId: 'fx-psi-20' }],
    nTests: 0, flight: true, rawDataAvailable: true, years: '2017–2019',
    sources: [{ id: 'fx-psi-20', label: 'PSI-20 investigation page', url: psi(20), type: 'psi' }] }),
  inv({ id: 'ACME-E-FIELD', name: 'ACME Electric-Field Effects on Laminar Diffusion Flames', psi: 'PSI-22', psiUrl: psi(22), doi: null,
    family: 'ACME-CIR', hardware: 'ACME insert in Combustion Integrated Rack', platform: 'ISS', fuelPhase: 'gas',
    direction: ['fundamental'], safetyConsequence: 1,
    objective: 'Use an electric field to create an ionic wind that mimics buoyant convection (partial gravity analogue).',
    fuel: { types: ['methane', 'ethylene'], geometry: 'coflow burner', size: null },
    conditions: { o2Pct: [21, 30], pressureKpa: [101.3, 101.3], flowCmS: [5, 15], gravityG: [0, 0], diluents: ['N2'] },
    varied: ['field strength', 'fuel flow'], constant: ['1 atm'], diagnostics: ['video', 'ion current'],
    resultSummary: 'Fixture summary: the electric field changed flame shape similar to weak buoyancy.',
    keyFindings: [{ text: 'Fixture: an applied field produced flame-length changes comparable to fractional-g buoyancy.', sourceId: 'fx-psi-22' }],
    nTests: 0, flight: true, rawDataAvailable: false, years: '2017–2018',
    sources: [{ id: 'fx-psi-22', label: 'PSI-22 investigation page', url: psi(22), type: 'psi' }] }),
  inv({ id: 'CFI-G', name: 'ACME Cool Flames Investigation with Gases', psi: 'PSI-159', psiUrl: psi(159), doi: null,
    family: 'ACME-CIR', hardware: 'ACME insert in Combustion Integrated Rack', platform: 'ISS', fuelPhase: 'gas',
    direction: ['fundamental'], safetyConsequence: 1,
    objective: 'Study cool and inverse diffusion flames over a wide oxygen range, up to very high O2.',
    fuel: { types: ['n-butane', 'dimethyl ether'], geometry: 'spherical burner', size: '6 mm' },
    conditions: { o2Pct: [21, 40], pressureKpa: [70, 101.3], flowCmS: [0, 0], gravityG: [0, 0], diluents: ['N2'] },
    varied: ['O2', 'fuel'], constant: ['quiescent'], diagnostics: ['video', 'thermocouples'],
    resultSummary: 'Fixture summary: gaseous flames at high O2; transfer to solid materials is limited.',
    keyFindings: [{ text: 'Fixture: at elevated O2 some gas flames persisted to very low fuel flow.', sourceId: 'fx-psi-159' }],
    nTests: 0, flight: true, rawDataAvailable: true, years: '2021–2022',
    sources: [{ id: 'fx-psi-159', label: 'PSI-159 investigation page', url: psi(159), type: 'psi' }] }),
];

// synthetic limiting-O2 rule for thin solids
const loi = (flow, p, g) => {
  if (g >= 0.9) return 18 + 0.04 * (101.3 - p); // buoyant flow
  return 16.5 + 5 * Math.exp(-flow / 3) + 0.12 * Math.max(0, flow - 25) + 0.05 * (101.3 - p);
};
const tests = [];
const add = (o) => tests.push({
  fuel: null, fuelPhase: null, geometry: null, thicknessMm: null, diameterMm: null, o2Pct: null, pressureKpa: null,
  flowCmS: null, gravityG: 0, diluent: 'N2', diluentPct: null, outcome: 'unknown', outcomeRaw: null,
  spreadRateMmS: null, burningRateMm2S: null, particleSizeNm: null, extra: {}, ...o,
});

let row = 2;
const bassPts = [];
for (let i = 0; i < 18; i++) {
  const o2 = r1(15 + rnd() * 6);
  const p = [101.3, 101.3, 101.3, 70.3, 50][Math.floor(rnd() * 5)];
  const flow = [0, 2, 5, 10, 20, 30, 40][Math.floor(rnd() * 7)];
  bassPts.push([o2, p, flow]);
}
bassPts.forEach(([o2, p, flow], i) => {
  const burns = o2 > loi(flow, p, 0) + (rnd() - 0.5) * 0.8;
  add({ inv: 'BASS-II', testId: `BASS-II-${String(i + 1).padStart(3, '0')}`, fuel: 'PMMA', fuelPhase: 'solid', geometry: 'flat sheet',
    thicknessMm: [0.25, 1, 2][i % 3], o2Pct: o2, pressureKpa: p, flowCmS: flow, gravityG: 0,
    outcome: burns ? 'flame_spread' : 'extinguished', outcomeRaw: burns ? 'flame spread to end' : 'extinguished before end',
    spreadRateMmS: burns ? r1(0.05 + 0.03 * (o2 - 15) * 10) / 10 : null,
    source: { sourceId: 'fx-psi-25', file: 'FIXTURE_BASS-II_test_matrix.xlsx', row: row++ } });
});
// 1g ground references (NASA-STD-6001 Test 1 style), up to 40% O2
[[21, 101.3], [24, 70.3], [27, 70.3], [30, 70.3], [34, 56.5], [40, 56.5], [17, 101.3], [19, 101.3]].forEach(([o2, p], i) => {
  const burns = o2 > loi(0, p, 1);
  add({ inv: 'BASS-II', testId: `BASS-II-G${i + 1}`, fuel: 'PMMA', fuelPhase: 'solid', geometry: 'flat sheet (upward burning, ground)',
    thicknessMm: 1, o2Pct: o2, pressureKpa: p, flowCmS: 0, gravityG: 1,
    outcome: burns ? 'burned' : 'self_extinguished', outcomeRaw: burns ? 'burned full length' : 'self-extinguished',
    spreadRateMmS: burns ? r1(0.5 + 0.08 * (o2 - 18)) : null,
    extra: { note: 'ground reference' }, source: { sourceId: 'fx-psi-25', file: 'FIXTURE_ground_reference.csv', row: i + 2 } });
});
[['SIBAL', 'burned', 2.1], ['Nomex', 'no_ignition', null], ['PMMA', 'burned', 1.4], ['SIBAL', 'burned', 2.3]].forEach(([fuel, out, rate], i) => {
  add({ inv: 'Saffire-II', testId: `Saffire-II-${i + 1}`, fuel, fuelPhase: 'solid', geometry: 'large sheet', thicknessMm: 0.3,
    o2Pct: 21, pressureKpa: 101.3, flowCmS: 20 + (i % 2) * 5, gravityG: 0, outcome: out, outcomeRaw: out === 'burned' ? 'burned' : 'did not ignite',
    spreadRateMmS: rate, source: { sourceId: 'fx-psi-99', file: 'FIXTURE_Saffire-II_summary.pdf', row: i + 1 } });
});
[[15, 101.3, 20], [17, 101.3, 10], [21, 101.3, 0], [21, 70.3, 15], [18, 50, 25], [16, 101.3, 30]].forEach(([o2, p, co2], i) => {
  const burns = o2 - co2 * 0.12 > 15.2;
  add({ inv: 'FLEX', testId: `FLEX-${i + 1}`, fuel: 'heptane', fuelPhase: 'liquid', geometry: 'droplet', diameterMm: r1(2 + rnd() * 2),
    o2Pct: o2, pressureKpa: p, flowCmS: 0, gravityG: 0, diluent: co2 > 0 ? 'CO2' : 'N2', diluentPct: co2,
    outcome: burns ? 'completed' : 'extinguished', outcomeRaw: burns ? 'burned to completion' : 'radiative extinction',
    burningRateMm2S: burns ? r1(0.6 + 0.02 * o2) : null, source: { sourceId: 'fx-psi-69', file: 'FIXTURE_FLEX_tests.xlsx', row: i + 2 } });
});
[[17, 50], [19, 70.3], [21, 101.3], [23, 50], [25, 70.3]].forEach(([o2, p], i) => {
  add({ inv: 'ACME-BRE', testId: `BRE-${i + 1}`, fuel: 'ethylene', fuelPhase: 'gas', geometry: 'porous sphere', diameterMm: 25,
    o2Pct: o2, pressureKpa: p, flowCmS: 0, gravityG: 0, outcome: o2 >= 19 ? 'burned' : 'extinguished',
    outcomeRaw: o2 >= 19 ? 'steady flame' : 'extinction', source: { sourceId: 'fx-psi-20', file: 'FIXTURE_BRE_matrix.csv', row: i + 2 } });
});
[[21, 5], [25, 10], [30, 15]].forEach(([o2, flow], i) => {
  add({ inv: 'ACME-E-FIELD', testId: `EF-${i + 1}`, fuel: 'methane', fuelPhase: 'gas', geometry: 'coflow', o2Pct: o2, pressureKpa: 101.3,
    flowCmS: flow, gravityG: 0, outcome: 'burned', outcomeRaw: 'flame stabilized', extra: { fieldKVcm: 1 + i },
    source: { sourceId: 'fx-psi-22', file: 'FIXTURE_EFIELD.csv', row: i + 2 } });
});
[[21, 101.3], [30, 101.3], [35, 70.3], [40, 70.3]].forEach(([o2, p], i) => {
  add({ inv: 'CFI-G', testId: `CFI-G-${i + 1}`, fuel: 'n-butane', fuelPhase: 'gas', geometry: 'spherical burner', diameterMm: 6,
    o2Pct: o2, pressureKpa: p, flowCmS: 0, gravityG: 0, outcome: 'burned', outcomeRaw: o2 > 30 ? 'hot flame' : 'cool flame',
    source: { sourceId: 'fx-psi-159', file: 'FIXTURE_CFI-G.csv', row: i + 2 } });
});
for (const i of investigations) i.nTests = tests.filter((t) => t.inv === i.id).length || (i.id === 'SAME' ? 154 : 0);

const S = (label, url) => [{ label, url }];
const missions = [
  { id: 'iss', label: 'International Space Station', o2Pct: 21, pressureKpa: 101.3, flowCmS: [5, 20], gravityG: 0, notes: 'Sea-level-like cabin air with forced ventilation.', assumption: false, sources: S('Fixture source', 'https://www.nasa.gov/') },
  { id: 'spacecraft', label: 'Crew spacecraft (exploration atmosphere)', o2Pct: 34, pressureKpa: 56.5, flowCmS: [5, 20], gravityG: 0, notes: '8.2 psi / 34% O2 exploration atmosphere.', assumption: true, sources: S('Fixture source', 'https://ntrs.nasa.gov/') },
  { id: 'lunar-base', label: 'Lunar surface habitat', o2Pct: 34, pressureKpa: 56.5, flowCmS: [0, 15], gravityG: 0.166, notes: 'Exploration atmosphere assumed.', assumption: true, sources: S('Fixture source', 'https://ntrs.nasa.gov/') },
  { id: 'lunar-rover', label: 'Pressurized lunar rover', o2Pct: 30, pressureKpa: 70.3, flowCmS: [0, 20], gravityG: 0.166, notes: '30% O2 at 10.2 psi per challenge text.', assumption: false, sources: S('Challenge text', 'https://www.spaceappschallenge.org/') },
  { id: 'mars-base', label: 'Mars surface habitat', o2Pct: 26.5, pressureKpa: 70.3, flowCmS: [0, 15], gravityG: 0.38, notes: 'Not given by the challenge — assumption.', assumption: true, sources: S('Fixture source', 'https://ntrs.nasa.gov/') },
  { id: 'eva-suit', label: 'EVA suit', o2Pct: 100, pressureKpa: 29.6, flowCmS: [0, 30], gravityG: 0, notes: 'Pure O2 at 4.3 psi.', assumption: false, sources: S('Fixture source', 'https://www.nasa.gov/') },
];

const claims = [
  ['BASS-II', 'Fixture: thin PMMA sheets stopped spreading flame below about 17% O2 at moderate opposed flow.', ['prevention', 'oxygen', 'flow']],
  ['BASS-II', 'Fixture: at flows under 2 cm/s, oxygen starvation extinguished flames that would burn in stronger flow.', ['flow', 'extinction']],
  ['BASS-II', 'Fixture: reduced pressure raised the oxygen concentration needed for sustained flame spread.', ['pressure', 'oxygen']],
  ['Saffire-II', 'Fixture: large SIBAL samples burned with steady flame spread in 20 cm/s concurrent flow at 21% O2.', ['prevention', 'material']],
  ['Saffire-II', 'Fixture: Nomex samples did not ignite at ambient spacecraft conditions.', ['material', 'ignition']],
  ['FLEX', 'Fixture: carbon dioxide dilution extinguished heptane droplet flames at lower diluent fractions than nitrogen.', ['suppression', 'droplet', 'co2']],
  ['FLEX', 'Fixture: some heptane droplets continued to burn with an invisible cool flame after radiative extinction.', ['droplet', 'cool flame']],
  ['SAME', 'Fixture: smoke particles from overheated materials in microgravity were larger than in normal gravity.', ['detection', 'smoke', 'particle']],
  ['SAME', 'Fixture: smoke detectors tuned on ground smoke can underestimate microgravity smoke concentration.', ['detection', 'smoke']],
  ['ACME-BRE', 'Fixture: emulated condensed fuels were more flammable at reduced pressure with elevated oxygen.', ['pressure', 'oxygen']],
  ['ACME-E-FIELD', 'Fixture: an electric field generated ionic wind that mimicked weak buoyant convection, an analogue for partial gravity.', ['gravity', 'partial gravity']],
  ['CFI-G', 'Fixture: gaseous flames were studied up to 40% oxygen; results transfer only qualitatively to solid materials.', ['oxygen', 'high oxygen']],
].map(([inv, text, topic], i) => {
  const src = investigations.find((x) => x.id === inv).sources[0];
  return { id: `c-${String(i + 1).padStart(4, '0')}`, inv, text, quote: `${text.replace('Fixture: ', '')} (fixture quote)`, sourceId: src.id, sourceUrl: src.url, topic, extractedBy: i % 3 ? 'llm' : 'manual' };
});

const extraction_eval = {
  method: 'Fixture: 6 claims hand-labelled against source text; verdict per claim.',
  n: 6, correct: 4, partial: 1, wrong: 1,
  items: claims.slice(0, 6).map((c, i) => ({ claimId: c.id, goldText: c.text, llmText: i === 5 ? 'Fixture: wrong paraphrase.' : c.text,
    verdict: i < 4 ? 'correct' : i === 4 ? 'partial' : 'wrong', note: i === 4 ? 'missed a qualifier' : null })),
};
const earth = [
  { id: 'smoke-detectors', title: 'Better smoke detectors', summary: 'Fixture: microgravity smoke studies informed detector design that also applies on Earth.', linkedInvestigations: ['SAME'], sources: S('NASA Spinoff (fixture link)', 'https://spinoff.nasa.gov/') },
  { id: 'water-mist', title: 'Water-mist suppression', summary: 'Fixture: droplet flame extinction studies relate to fine-water-mist extinguishers.', linkedInvestigations: ['FLEX'], sources: S('NASA (fixture link)', 'https://www.nasa.gov/') },
  { id: 'firefighter-gear', title: 'Firefighter air tanks and attire', summary: 'Fixture: lightweight composite air tanks and protective fabrics.', linkedInvestigations: [], sources: S('NASA Spinoff (fixture link)', 'https://spinoff.nasa.gov/') },
];
const history = [
  { id: 'apollo-1', title: 'Apollo 1 (1967)', year: 1967, summary: 'Fixture: a cabin fire in a pure-oxygen atmosphere during a ground test killed three astronauts.', linkedInvestigations: [], sources: S('NASA history (fixture link)', 'https://www.nasa.gov/') },
  { id: 'mir-1997', title: 'Mir fire (1997)', year: 1997, summary: 'Fixture: an oxygen-generator canister fire filled the station with smoke.', linkedInvestigations: ['SAME'], sources: S('NASA history (fixture link)', 'https://www.nasa.gov/') },
];
const manifest = { generatedAt: '2026-11-14T00:00:00Z', files: [] };

const w = (n, d) => writeFileSync(`${OUT}/${n}.json`, JSON.stringify(d, null, 2) + '\n');
w('investigations', investigations); w('tests', tests); w('missions', missions); w('claims', claims);
w('extraction_eval', extraction_eval); w('earth', earth); w('history', history); w('datasets_manifest', manifest);
console.log('tests', tests.length, tests.filter(t=>['flame_spread','burned','completed'].includes(t.outcome)).length, 'burned');
