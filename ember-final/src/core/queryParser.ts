/**
 * Natural-language + structured override parser producing a typed ResearchQuery.
 * Never blocks search solely because thicknessMm is unknown (records it in unknownFields).
 */
import type {
  EnclosureScale,
  FlowDirection,
  FlowHistory,
  FuelPhase,
  GasRole,
  GravityMode,
  GravityPlatform,
  GravityRegime,
  HabitableEnvironment,
  ResearchQuery,
  SafetyTask,
  TargetEndpoint,
} from './types';

export const KPA_PER_PSI = 6.894757;
export const KPA_PER_ATM = 101.325;
export const KPA_PER_MMHG = 0.133322;

interface EnvironmentPreset {
  habitableEnvironment: HabitableEnvironment;
  o2Pct: number | null;
  pressureKpa: number | null;
  flowCmS: number | [number, number] | null;
  gravityG: number | null;
  gravityRegime: GravityRegime;
  platform: GravityPlatform | null;
  enclosureScale: EnclosureScale | null;
}

const ENVIRONMENT_PRESETS: Record<Exclude<HabitableEnvironment, 'custom'>, EnvironmentPreset> = {
  iss: {
    habitableEnvironment: 'iss',
    o2Pct: 21,
    pressureKpa: 101.3,
    flowCmS: [5, 20],
    gravityG: 0,
    gravityRegime: 'microgravity',
    platform: 'ISS',
    enclosureScale: 'large_enclosure',
  },
  spacecraft: {
    habitableEnvironment: 'spacecraft',
    o2Pct: 21,
    pressureKpa: 101.3,
    flowCmS: [5, 20],
    gravityG: 0,
    gravityRegime: 'microgravity',
    platform: 'Cygnus',
    enclosureScale: 'large_enclosure',
  },
  lunar_base: {
    habitableEnvironment: 'lunar_base',
    o2Pct: 34,
    pressureKpa: 56.5,
    flowCmS: [5, 20],
    gravityG: 0.166,
    gravityRegime: 'partial_gravity',
    platform: null,
    enclosureScale: 'large_enclosure',
  },
  lunar_rover: {
    habitableEnvironment: 'lunar_rover',
    o2Pct: 30,
    pressureKpa: 70.3,
    flowCmS: [0, 20],
    gravityG: 0.166,
    gravityRegime: 'partial_gravity',
    platform: null,
    enclosureScale: 'large_enclosure',
  },
  mars_base: {
    habitableEnvironment: 'mars_base',
    o2Pct: 34,
    pressureKpa: 56.5,
    flowCmS: [5, 20],
    gravityG: 0.38,
    gravityRegime: 'partial_gravity',
    platform: null,
    enclosureScale: 'large_enclosure',
  },
  eva_suit: {
    habitableEnvironment: 'eva_suit',
    o2Pct: 100,
    pressureKpa: 29.6,
    flowCmS: null,
    gravityG: 0.166,
    gravityRegime: 'partial_gravity',
    platform: null,
    enclosureScale: 'chamber',
  },
};

const MATERIAL_PATTERNS: Array<{ re: RegExp; material: string; phase: FuelPhase }> = [
  { re: /\bpmma\b|acrylic|polymethyl/i, material: 'PMMA', phase: 'solid' },
  { re: /\bsibal\b|cotton[-\s]*fiberglass/i, material: 'SIBAL', phase: 'solid' },
  { re: /\bnomex\b/i, material: 'Nomex', phase: 'solid' },
  { re: /\bultem\b/i, material: 'Ultem', phase: 'solid' },
  { re: /\bkapton\b/i, material: 'Kapton', phase: 'solid' },
  { re: /\bteflon\b|\bptfe\b/i, material: 'Teflon', phase: 'solid' },
  { re: /\bsilicone\b/i, material: 'silicone', phase: 'solid' },
  { re: /\bcellulose\b|\bpaper\b|\bcotton\b/i, material: 'cotton', phase: 'solid' },
  { re: /\bparaffin\b|\bwax\b|\bcandle\b/i, material: 'wax', phase: 'solid' },
  { re: /\bpyrell\b|\bfoam\b/i, material: 'Pyrell', phase: 'solid' },
  { re: /\bn[-\s]?dodecane\b|\bdodecane\b/i, material: 'n-dodecane', phase: 'liquid' },
  { re: /\biso[-\s]?dodecane\b/i, material: 'iso-dodecane', phase: 'liquid' },
  { re: /\bheptane\b/i, material: 'heptane', phase: 'liquid' },
  { re: /\bmethanol\b/i, material: 'methanol', phase: 'liquid' },
  { re: /\bn[-\s]?alkane\b|\balkane\b/i, material: 'n-alkane', phase: 'liquid' },
  { re: /\bethylene\b|\bc2h4\b/i, material: 'ethylene', phase: 'gas' },
  { re: /\bmethane\b|\bch4\b/i, material: 'methane', phase: 'gas' },
  { re: /\bethane\b|\bc2h6\b/i, material: 'ethane', phase: 'gas' },
  { re: /\bpropane\b|\bc3h8\b/i, material: 'propane', phase: 'gas' },
  { re: /\bbutane\b|\bc4h10\b/i, material: 'butane', phase: 'gas' },
  { re: /\bpropylene\b|\bc3h6\b/i, material: 'propylene', phase: 'gas' },
];

export interface QueryParserOptions {
  applyEnvironmentDefaults?: boolean;
}

export function normalizeGravityRegime(gravityG: number | null | undefined): GravityRegime | null {
  if (gravityG === null || gravityG === undefined || Number.isNaN(gravityG)) return null;
  if (gravityG <= 0.05) return 'microgravity';
  if (gravityG < 0.85) return 'partial_gravity';
  return 'normal_gravity';
}

function detectEnvironment(text: string, overrideEnv?: HabitableEnvironment | string | null): { env: HabitableEnvironment; explicitlyMentioned: boolean } {
  if (overrideEnv && overrideEnv !== 'custom') {
    const o = overrideEnv.toLowerCase();
    if (/lunar\s+rover/.test(o) || o === 'lunar_rover') return { env: 'lunar_rover', explicitlyMentioned: true };
    if (/lunar\s+base/.test(o) || o === 'lunar_base') return { env: 'lunar_base', explicitlyMentioned: true };
    if (/mars/.test(o) || o === 'mars_base') return { env: 'mars_base', explicitlyMentioned: true };
    if (/eva/.test(o) || o === 'eva_suit') return { env: 'eva_suit', explicitlyMentioned: true };
    if (/iss/.test(o)) return { env: 'iss', explicitlyMentioned: true };
    if (/spacecraft|cygnus|orion/.test(o)) return { env: 'spacecraft', explicitlyMentioned: true };
  }
  if (overrideEnv === 'custom') return { env: 'custom', explicitlyMentioned: false };
  const t = text.toLowerCase();
  if (/lunar\s+rover|pressurized\s+rover|rover\s+cabin/.test(t)) return { env: 'lunar_rover', explicitlyMentioned: true };
  if (/lunar\s+(base|habitat|surface|outpost)|moon\s+(base|habitat)|artemis\s+habitat/.test(t)) return { env: 'lunar_base', explicitlyMentioned: true };
  if (/mars\s+(base|habitat|surface|mission)/.test(t)) return { env: 'mars_base', explicitlyMentioned: true };
  if (/eva\s+suit|spacesuit/.test(t)) return { env: 'eva_suit', explicitlyMentioned: true };
  if (/\biss\b|international\s+space\s+station/.test(t)) return { env: 'iss', explicitlyMentioned: true };
  if (/cygnus|orion|spacecraft\s+cabin|capsule/.test(t)) return { env: 'spacecraft', explicitlyMentioned: true };
  return { env: 'custom', explicitlyMentioned: false };
}

function detectSafetyTask(text: string, overrideTask?: SafetyTask | string | null): SafetyTask {
  if (overrideTask) {
    const o = overrideTask.toLowerCase();
    if (o === 'prevention') return 'material_screening';
    if (o === 'suppression') return 'fire_suppression';
    if (o === 'detection') return 'smoke_detection';
    if (o === 'fundamental') return 'general_comparison';
    if (
      o === 'material_screening' ||
      o === 'ventilation_setting' ||
      o === 'smoke_detection' ||
      o === 'fire_suppression' ||
      o === 'atmosphere_selection' ||
      o === 'general_comparison'
    ) {
      return o as SafetyTask;
    }
  }
  const t = text.toLowerCase();
  if (/smoke\s+detector|particle\s+size|smoke\s+detection|aerosol|same\b/.test(t)) return 'smoke_detection';
  if (/suppress|extinguish|co2\s+dilut|helium|n2\s+jet|quench|blowoff/.test(t)) return 'fire_suppression';
  if (/ventilation|airflow|air\s+flow|fan\s+speed|flow\s+velocity|cm\/s/.test(t)) return 'ventilation_setting';
  if (/atmosphere|o2\s+concentration|oxygen\s+level|psia|kpa|cabin\s+air/.test(t)) return 'atmosphere_selection';
  if (/compare|versus|\bvs\b|difference\s+between|comparable/.test(t)) return 'general_comparison';
  return 'material_screening';
}

function detectTargetEndpoint(text: string, overrideEp?: TargetEndpoint | null): TargetEndpoint | null {
  if (overrideEp !== undefined) return overrideEp;
  const t = text.toLowerCase();
  if (/cool[-\s]*flame/.test(t)) return 'cool_flame_continuation';
  if (/hot[-\s]*flame\s+extinct/.test(t)) return 'hot_flame_extinction';
  if (/smoke\s+point|luminous\s+flame\s+length/.test(t)) return 'smoke_point_length';
  if (/particle\s+size|smoke\s+particle|m1\/m0|same-?r?/.test(t)) return 'smoke_particle_size';
  if (/burning[-\s]*rate\s+constant|k\s*[=:]|droplet\s+burn/.test(t)) return 'burning_rate_constant';
  if (/spread\s+rate|flame\s+spread\s+speed/.test(t)) return 'spread_rate';
  if (/blow[-\s]*off/.test(t)) return 'blowoff_limit';
  if (/quench\s+limit|quenching\s+speed|low[-\s]*flow\s+extinct/.test(t)) return 'quench_limit';
  if (/extinguish.*flow|flow.*extinguish|extinction\s+under\s+flow|flow\s+reduction|extinction\s+limits?|extinction\s+results?/.test(t)) {
    return 'extinction_under_flow_change';
  }
  if (/suppressant|co2\s+extinct|n2\s+jet|loi\b|limiting\s+oxygen/.test(t)) return 'suppressant_extinction';
  if (/sustained\s+spread|flame\s+spread/.test(t)) return 'sustained_spread';
  if (/ignit|flammab|flame\s+establishment/.test(t)) return 'flame_establishment';
  return null;
}

function detectMaterialAndPhase(
  text: string,
  overrideMat?: string | null,
  overridePhase?: FuelPhase | null,
): { material: string | null; fuelPhase: FuelPhase | null } {
  let material = overrideMat ?? null;
  let fuelPhase = overridePhase ?? null;

  if (!material) {
    for (const entry of MATERIAL_PATTERNS) {
      if (entry.re.test(text)) {
        material = entry.material;
        if (!fuelPhase) fuelPhase = entry.phase;
        break;
      }
    }
  } else if (!fuelPhase) {
    const matched = MATERIAL_PATTERNS.find((m) => m.material.toLowerCase() === material!.toLowerCase() || m.re.test(material!));
    if (matched) fuelPhase = matched.phase;
  }

  if (!fuelPhase) {
    const t = text.toLowerCase();
    if (/\bsolid\b|\bfabric\b|\bslab\b|\bfilm\b|\brod\b|\bpanel\b|\blining\b/.test(t)) fuelPhase = 'solid';
    else if (/\bliquid\b|\bdroplet\b|\bdrop\b/.test(t)) fuelPhase = 'liquid';
    else if (/\bgas\b|\bgaseous\b|\bburner\b|\bjet\s+flame\b|\binverse\s+flame\b/.test(t)) fuelPhase = 'gas';
  }
  return { material, fuelPhase };
}

function detectGeometry(text: string, overrideGeom?: string | null): string | null {
  if (overrideGeom !== undefined) return overrideGeom;
  const t = text.toLowerCase();
  if (/thin\s+film|\bfilm\b/.test(t)) return 'thin film';
  if (/\brod\b|\bcylinder\b/.test(t)) return 'cylinder (rod)';
  if (/\bslab\b/.test(t)) return 'slab';
  if (/\bfabric\b|\bcloth\b|\btextile\b/.test(t)) return 'fabric sheet';
  if (/\bsphere\b/.test(t)) return 'sphere';
  if (/\bdroplet\b/.test(t)) return 'droplet';
  if (/inverse\s+flame/.test(t)) return 'spherical porous burner, inverse flame';
  if (/porous\s+burner/.test(t)) return 'porous burner';
  if (/co[-\s]*flow\s+jet|jet\s+flame/.test(t)) return 'co-flow jet burner';
  return null;
}

function extractNumericsFromText(text: string): {
  o2Pct: number | null;
  pressureKpa: number | null;
  flowCmS: number | [number, number] | null;
  thicknessMm: number | null;
  diameterMm: number | null;
  gravityG: number | null;
} {
  let o2Pct: number | null = null;
  const o2Match = text.match(/(\d+(?:\.\d+)?)\s*%\s*(?:o2|o₂|oxygen)/i) ?? text.match(/(?:o2|o₂|oxygen)\s*(?:of|at|=|:)?\s*(\d+(?:\.\d+)?)\s*%/i);
  if (o2Match) o2Pct = Number(o2Match[1]);

  let pressureKpa: number | null = null;
  const kpaMatch = text.match(/(\d+(?:\.\d+)?)\s*kpa\b/i);
  const psiMatch = text.match(/(\d+(?:\.\d+)?)\s*psia?\b/i);
  const atmMatch = text.match(/(\d+(?:\.\d+)?)\s*atm\b/i);
  if (kpaMatch) pressureKpa = Number(kpaMatch[1]);
  else if (psiMatch) pressureKpa = Number((Number(psiMatch[1]) * KPA_PER_PSI).toFixed(1));
  else if (atmMatch) pressureKpa = Number((Number(atmMatch[1]) * KPA_PER_ATM).toFixed(1));

  let flowCmS: number | [number, number] | null = null;
  const flowRange = text.match(/(\d+(?:\.\d+)?)\s*(?:to|-|–)\s*(\d+(?:\.\d+)?)\s*cm\/s\b/i);
  const flowSingle = text.match(/(\d+(?:\.\d+)?)\s*cm\/s\b/i);
  const flowMms = text.match(/(\d+(?:\.\d+)?)\s*mm\/s\b(?:\s*(?:air|flow|ventilation))?/i);
  if (flowRange) flowCmS = [Number(flowRange[1]), Number(flowRange[2])];
  else if (flowSingle) flowCmS = Number(flowSingle[1]);
  else if (flowMms && /air|flow|ventilation/i.test(text)) flowCmS = Number(flowMms[1]) / 10;
  else if (/quiescent|zero\s+flow|no\s+forced\s+flow|fan[-\s]*off/i.test(text)) flowCmS = 0;

  let thicknessMm: number | null = null;
  const thickMm = text.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:thick|thickness|slab|film|pmma|sheet)/i)
    ?? text.match(/thickness\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*mm/i);
  const thickUm = text.match(/(\d+(?:\.\d+)?)\s*(?:µm|um|micron)\s*(?:thick|film|pmma)?/i);
  if (thickMm) thicknessMm = Number(thickMm[1]);
  else if (thickUm) thicknessMm = Number(thickUm[1]) / 1000;

  let diameterMm: number | null = null;
  const diamMm = text.match(/(\d+(?:\.\d+)?)\s*mm\s*(?:diameter|rod|droplet|burner)/i)
    ?? text.match(/diameter\s*(?:of|=|:)?\s*(\d+(?:\.\d+)?)\s*mm/i);
  if (diamMm) diameterMm = Number(diamMm[1]);

  let gravityG: number | null = null;
  const gMatch = text.match(/(\d+(?:\.\d+)?)\s*g\b/i);
  if (gMatch) gravityG = Number(gMatch[1]);
  else if (/microgravity|zero[-\s]*g|\b0g\b|iss\b|freefall/i.test(text)) gravityG = 0;
  else if (/lunar|moon/i.test(text)) gravityG = 0.166;
  else if (/mars|martian/i.test(text)) gravityG = 0.38;
  else if (/normal\s+gravity|earth\s+gravity|ground\s+test/i.test(text)) gravityG = 1;

  return { o2Pct, pressureKpa, flowCmS, thicknessMm, diameterMm, gravityG };
}

function detectFlowMeta(text: string): { direction: FlowDirection | null; history: FlowHistory | null } {
  const t = text.toLowerCase();
  let direction: FlowDirection | null = null;
  if (/opposed[-\s]*flow|opposed\s+spread/.test(t)) direction = 'opposed';
  else if (/concurrent[-\s]*flow|concurrent\s+spread/.test(t)) direction = 'concurrent';
  else if (/axial\s+stagnation|stagnation\s+flow/.test(t)) direction = 'axial_stagnation';
  else if (/co[-\s]*flow|coflow/.test(t)) direction = 'coflow';
  else if (/quiescent|no\s+flow/.test(t)) direction = 'quiescent';

  let history: FlowHistory | null = null;
  if (/stepped[-\s]*down|step\s+down|reduced\s+flow/.test(t)) history = 'stepped_down';
  else if (/stepped[-\s]*up|step\s+up/.test(t)) history = 'stepped_up';
  else if (/shut\s*off|turned\s+off|abrupt\s+cutoff/.test(t)) history = 'abrupt_cutoff';
  else if (/steady\s+flow|constant\s+flow/.test(t)) history = 'steady';

  return { direction, history };
}

function detectGasRole(text: string, overrideRole?: GasRole): GasRole {
  if (overrideRole) return overrideRole;
  const t = text.toLowerCase();
  if (/oxidizer\s+stream|inverse\s+flame\s+o2|burner\s+o2/.test(t)) return 'oxidizer_stream';
  if (/fuel\s+stream/.test(t)) return 'fuel';
  if (/diluent\s+stream/.test(t)) return 'diluent';
  return 'ambient';
}

function detectPlatformAndMode(text: string, gravityRegime: GravityRegime | null): {
  platform: GravityPlatform | null;
  requestedMode: GravityMode | null;
  enclosureScale: EnclosureScale | null;
} {
  const t = text.toLowerCase();
  let platform: GravityPlatform | null = null;
  let requestedMode: GravityMode | null = null;
  let enclosureScale: EnclosureScale | null = null;

  if (/saffire|cygnus/.test(t)) {
    platform = 'Cygnus';
    enclosureScale = 'large_enclosure';
  } else if (/\biss\b|bass|flex\b|cfi\b|same\b|acme|spice|slice/.test(t)) {
    platform = 'ISS';
  } else if (/drop\s+tower/.test(t)) {
    platform = 'DropTower';
    requestedMode = 'actual_flight';
  } else if (/parabolic/.test(t)) {
    platform = 'ParabolicFlight';
    requestedMode = 'actual_flight';
  } else if (/1\s*g|ground|nasa-std-6001/.test(t)) {
    platform = 'Ground1g';
    requestedMode = 'ground_1g';
  }

  if (/e-field|electric\s+field|simulated\s+analogue/.test(t)) {
    requestedMode = 'simulated_analogue';
    if (!platform) platform = 'SimulatedAnalogue';
  } else if (!requestedMode && gravityRegime) {
    requestedMode = gravityRegime === 'normal_gravity' ? 'ground_1g' : 'actual_flight';
  }

  if (!enclosureScale) {
    if (/small\s+duct|msg\s+duct|flow\s+duct/.test(t)) enclosureScale = 'small_duct';
    else if (/large\s+enclosure|cabin|habitat|rover|cygnus/.test(t)) enclosureScale = 'large_enclosure';
    else if (/chamber|cir\b|mdca\b/.test(t)) enclosureScale = 'chamber';
  }

  return { platform, requestedMode, enclosureScale };
}

function collectUnknownAndWarnings(q: Omit<ResearchQuery, 'unknownFields' | 'validationWarnings'>): {
  unknownFields: string[];
  validationWarnings: string[];
} {
  const unknownFields: string[] = [];
  if (q.material === null) unknownFields.push('material');
  if (q.fuelPhase === null) unknownFields.push('fuelPhase');
  if (q.thicknessMm === null && (q.fuelPhase === 'solid' || q.fuelPhase === null)) unknownFields.push('thicknessMm');
  if (q.o2Pct === null) unknownFields.push('o2Pct');
  if (q.pressureKpa === null) unknownFields.push('pressureKpa');
  if (q.flowCmS === null) unknownFields.push('flowCmS');
  if (q.gravityG === null) unknownFields.push('gravityG');

  const validationWarnings: string[] = [];
  if (q.gravityRegime === 'partial_gravity') {
    validationWarnings.push(
      'No actual partial-gravity (lunar 0.166 g / Martian 0.38 g) combustion tests exist in the PSI corpus; 0 g and 1 g tests require explicit gravity-gap caveats (no unvalidated 4% O2 margin or E-FIELD transfer).',
    );
  }
  if (q.o2Role === 'oxidizer_stream') {
    validationWarnings.push('O2 role is oxidizer_stream (burner feed), not spacecraft cabin ambient O2.');
  }
  if (/e-field/i.test(q.rawQuestion) && q.gravityRegime === 'partial_gravity') {
    validationWarnings.push('ACME E-FIELD Flames uses an electric-field analogue in microgravity gas burners and cannot validate partial-gravity cabin material flammability.');
  }
  if (/rocket|propellant/i.test(q.rawQuestion)) {
    validationWarnings.push('Rocket propulsion and propellant fire safety are outside EMBER spacecraft cabin fire-safety scope.');
  }
  return { unknownFields, validationWarnings };
}

const INV_MENTION_PATTERNS: Array<{ id: string; re: RegExp }> = [
  { id: 'ACME-CFI-G', re: /\b(?:acme[-\s]*)?cfi[-\s]*g\b/i },
  { id: 'ACME-E-FIELD', re: /\b(?:acme[-\s]*)?e[-\s]*field\b/i },
  { id: 'ACME-BRE', re: /\b(?:acme[-\s]*)?bre\b/i },
  { id: 'BASS-II', re: /\bbass[-\s]*(?:ii|2)\b/i },
  { id: 'BASS', re: /\bbass\b(?![-\s]*(?:ii|2))/i },
  { id: 'Saffire-III', re: /\bsaffire[-\s]*(?:iii|3)\b/i },
  { id: 'Saffire-II', re: /\bsaffire[-\s]*(?:ii|2)\b/i },
  { id: 'Saffire-I', re: /\bsaffire[-\s]*(?:i|1)\b/i },
  { id: 'SAME-R', re: /\bsame[-\s]*r\b/i },
  { id: 'SAME', re: /\bsame\b(?![-\s]*r)/i },
  { id: 'FLEX-2', re: /\bflex[-\s]*(?:ii|2)\b/i },
  { id: 'FLEX', re: /\bflex\b(?![-\s]*(?:ii|2))/i },
  { id: 'CFI', re: /\bcfi\b(?![-\s]*g)/i },
  { id: 'SPICE', re: /\bspice\b/i },
  { id: 'SLICE', re: /\bslice\b/i },
];

function detectTargetInvIds(text: string, overrideIds?: string[]): string[] | undefined {
  if (overrideIds !== undefined) return overrideIds;
  const matched = INV_MENTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.id);
  return matched.length > 0 ? matched : undefined;
}

export function parseResearchQuery(
  rawQuestion: string,
  overrides: Partial<ResearchQuery> = {},
  options: QueryParserOptions = {},
): ResearchQuery {
  const { env, explicitlyMentioned } = detectEnvironment(rawQuestion, overrides.habitableEnvironment);
  const preset = env !== 'custom' ? ENVIRONMENT_PRESETS[env] : null;
  const usePresetDefaults = options.applyEnvironmentDefaults ?? explicitlyMentioned;

  const parsedNum = extractNumericsFromText(rawQuestion);
  const { material, fuelPhase } = detectMaterialAndPhase(rawQuestion, overrides.material, overrides.fuelPhase);
  const flowMeta = detectFlowMeta(rawQuestion);

  const o2Pct = overrides.o2Pct !== undefined ? overrides.o2Pct : parsedNum.o2Pct ?? (usePresetDefaults ? preset?.o2Pct ?? null : null);
  const pressureKpa =
    overrides.pressureKpa !== undefined ? overrides.pressureKpa : parsedNum.pressureKpa ?? (usePresetDefaults ? preset?.pressureKpa ?? null : null);
  const flowCmS = overrides.flowCmS !== undefined ? overrides.flowCmS : parsedNum.flowCmS ?? (usePresetDefaults ? preset?.flowCmS ?? null : null);
  const gravityG =
    overrides.gravityG !== undefined ? overrides.gravityG : parsedNum.gravityG ?? (usePresetDefaults ? preset?.gravityG ?? null : null);
  const gravityRegime = overrides.gravityRegime ?? normalizeGravityRegime(gravityG) ?? (usePresetDefaults ? preset?.gravityRegime ?? null : null);
  const platMode = detectPlatformAndMode(rawQuestion, gravityRegime);

  const base: Omit<ResearchQuery, 'unknownFields' | 'validationWarnings'> = {
    rawQuestion,
    habitableEnvironment: env,
    safetyTask: detectSafetyTask(rawQuestion, overrides.safetyTask),
    targetEndpoint: detectTargetEndpoint(rawQuestion, overrides.targetEndpoint),
    fuelPhase,
    material,
    geometry: detectGeometry(rawQuestion, overrides.geometry),
    thicknessMm: overrides.thicknessMm !== undefined ? overrides.thicknessMm : parsedNum.thicknessMm,
    diameterMm: overrides.diameterMm !== undefined ? overrides.diameterMm : parsedNum.diameterMm,
    o2Pct,
    o2Role: detectGasRole(rawQuestion, overrides.o2Role),
    pressureKpa,
    flowCmS,
    flowDirection: overrides.flowDirection !== undefined ? overrides.flowDirection : flowMeta.direction,
    flowHistory: overrides.flowHistory !== undefined ? overrides.flowHistory : flowMeta.history,
    gravityG,
    gravityRegime,
    platform: overrides.platform !== undefined ? overrides.platform : platMode.platform ?? preset?.platform ?? null,
    requestedMode: overrides.requestedMode !== undefined ? overrides.requestedMode : platMode.requestedMode,
    enclosureScale: overrides.enclosureScale !== undefined ? overrides.enclosureScale : platMode.enclosureScale ?? preset?.enclosureScale ?? null,
    targetInvIds: detectTargetInvIds(rawQuestion, overrides.targetInvIds),
  };

  const { unknownFields, validationWarnings } = collectUnknownAndWarnings(base);
  return {
    ...base,
    unknownFields: overrides.unknownFields ?? unknownFields,
    validationWarnings: overrides.validationWarnings ?? validationWarnings,
  };
}
