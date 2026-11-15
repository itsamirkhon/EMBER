import type {FuelPhase} from './types';

/** Material identities are not interchangeable merely because their names overlap. */
export const MATERIAL_PATTERNS: Array<{ re: RegExp; material: string; phase: FuelPhase }> = [
  { re: /\bpmma\b|\bacrylic\b|\bpolymethyl\s+methacrylate\b/i, material: 'PMMA', phase: 'solid' },
  { re: /\bsibal\b|cotton[-\s]*fiberglass/i, material: 'SIBAL', phase: 'solid' },
  { re: /\bnomex\b/i, material: 'Nomex', phase: 'solid' },
  { re: /\bultem\b/i, material: 'Ultem', phase: 'solid' },
  { re: /\bkapton\b/i, material: 'Kapton', phase: 'solid' },
  { re: /\bteflon\b|\bptfe\b/i, material: 'Teflon', phase: 'solid' },
  { re: /\bsilicone\b/i, material: 'silicone', phase: 'solid' },
  { re: /\bpolyethylene\b/i, material: 'polyethylene', phase: 'solid' },
  { re: /\bpolypropylene\b/i, material: 'polypropylene', phase: 'solid' },
  { re: /\bcellulose\b/i, material: 'cellulose', phase: 'solid' },
  { re: /\bpaper\b/i, material: 'paper', phase: 'solid' },
  { re: /\bcotton\b|\blampwick\b/i, material: 'cotton', phase: 'solid' },
  { re: /\bparaffin\b|\bwax\b|\bcandle\b/i, material: 'wax', phase: 'solid' },
  { re: /\bpyrell\b/i, material: 'Pyrell', phase: 'solid' },
  { re: /\biso[-\s]?dodecane\b.*\bn[-\s]?dodecane\b|\bn[-\s]?dodecane\b.*\biso[-\s]?dodecane\b/i, material: 'dodecane-blend', phase: 'liquid' },
  { re: /\biso[-\s]?dodecane\b/i, material: 'iso-dodecane', phase: 'liquid' },
  { re: /\bn[-\s]?dodecane\b|\bdodecane\b/i, material: 'n-dodecane', phase: 'liquid' },
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

export function normalizeMaterialName(raw: string | null | undefined): string {
  const text = (raw ?? '').toLowerCase().trim();
  return MATERIAL_PATTERNS.find(entry => entry.re.test(text))?.material.toLowerCase() ?? text;
}
