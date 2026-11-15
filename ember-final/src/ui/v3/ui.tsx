import type { ReactNode } from 'react';
import { safeExternalUrl } from '../safeUrl';
import { PLAIN, fmt, kpaToPsi, type AxisGap, type Plain } from './data';

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="v3-head">
      {eyebrow && <div className="v3-eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {children && <div className="v3-lede">{children}</div>}
    </header>
  );
}

function StatusIcon({ s }: { s: Plain }) {
  if (s === 'measured')
    return (
      <svg viewBox="0 0 20 20" aria-hidden className="v3-ico">
        <circle cx="10" cy="10" r="9" fill="currentColor" />
        <path d="M5.6 10.4l2.9 2.9 5.9-6.6" stroke="#04140a" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (s === 'nearby')
    return (
      <svg viewBox="0 0 20 20" aria-hidden className="v3-ico">
        <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
        <path d="M10 2a8 8 0 0 1 0 16z" fill="currentColor" />
      </svg>
    );
  return (
    <svg viewBox="0 0 20 20" aria-hidden className="v3-ico">
      <circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" strokeWidth="2" strokeDasharray="3 2.4" />
      <path d="M7 10h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function PlainBadge({ status, large }: { status: Plain; large?: boolean }) {
  return (
    <span className={`v3-status v3-status-${status}${large ? ' lg' : ''}`} title={PLAIN[status].help}>
      <StatusIcon s={status} />
      {PLAIN[status].label}
    </span>
  );
}

export function GapChips({ gaps }: { gaps: AxisGap[] }) {
  return (
    <div className="v3-gaps">
      {gaps.map((g) => (
        <span key={g.axis} className={`v3-gap v3-gap-${g.size}`}>
          <span className="v3-gap-k">{g.label}</span> {g.text}
        </span>
      ))}
    </div>
  );
}

/** Dalton's law to scale: how much of the cabin pressure is oxygen, against sea-level air. */
export function AtmosphereBar({ o2, kPa }: { o2: number; kPa: number }) {
  const po2 = (o2 * kPa) / 100;
  const max = Math.max(101.325, kPa);
  const Row = ({ label, o, p }: { label: string; o: number; p: number }) => (
    <div className="v3-atm-row">
      <span>{label}</span>
      <div className="v3-atm-bar" style={{ width: `${(p / max) * 100}%` }}>
        <div style={{ width: `${o}%` }} className="v3-atm-o2" />
      </div>
    </div>
  );
  return (
    <div className="v3-atm" role="img" aria-label={`Oxygen ${fmt(o2)}% of ${fmt(kPa)} kPa: oxygen partial pressure ${fmt(po2)} kPa, ${(po2 / 21.2).toFixed(2)} times sea level.`}>
      <Row label="This cabin" o={o2} p={kPa} />
      <Row label="Sea level" o={20.95} p={101.325} />
      <p className="v3-small v3-muted">
        <span className="v3-dot" style={{ background: 'var(--v3-accent)' }} /> oxygen {fmt(po2)} kPa ({(po2 / 21.2).toFixed(2)}× sea level) ·{' '}
        {fmt(kPa)} kPa total ({kpaToPsi(kPa).toFixed(1)} psi) · O₂ fraction {fmt(o2)}% vs 20.9% in air
      </p>
    </div>
  );
}

export function ScaleBar({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const v = Math.max(0, Math.min(1, value));
  return (
    <div className="v3-scale" title={hint}>
      <span className="v3-scale-l">{label}</span>
      <span className="v3-scale-t" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(v.toFixed(2))} aria-label={label}>
        <span style={{ width: `${Math.max(2, v * 100)}%` }} />
      </span>
      <span className="v3-scale-v">{v.toFixed(2)}</span>
    </div>
  );
}

export function Ext({ href, children }: { href: string | null | undefined; children: ReactNode }) {
  const safe = safeExternalUrl(href);
  if (!safe) return <>{children}</>;
  return (
    <a href={safe} target="_blank" rel="noreferrer noopener">
      {children}
    </a>
  );
}

export function Loading({ what }: { what: string }) {
  return (
    <div className="v3-loading" role="status">
      <span className="v3-spinner" aria-hidden /> {what}
    </div>
  );
}

/** Plain-language definitions for the jargon a judge meets first. */
export const GLOSSARY = {
  o2: ['Oxygen (O₂ %)', 'Share of the cabin air that is oxygen. Air on Earth is 20.9%. More oxygen makes materials burn more easily.'],
  kpa: ['Pressure (kPa)', 'Total cabin pressure in kilopascals. Sea level is 101.3 kPa; lunar cabins plan 56–70 kPa to make spacewalk prep easier.'],
  po2: ['Oxygen partial pressure (pO₂)', 'How much of the pressure is oxygen: O₂ fraction × total pressure. 21.2 kPa matches sea-level air.'],
  psi: ['NASA PSI', 'Physical Sciences Informatics: NASA’s public database of results from experiments flown on the ISS and other spacecraft.'],
  ug: ['Microgravity', 'Near-weightless conditions in orbit. Flames have no buoyancy, so hot gas does not rise and they burn as spheres.'],
  cliff: ['Evidence cliff', 'The highest oxygen level at which any solid material has been flight-tested in NASA PSI. Past it, there is no flight data.'],
  g: ['Gravity (g)', '1 g is Earth. The Moon is 0.166 g, Mars 0.38 g. Every fire test in PSI ran in orbit, near 0 g.'],
} as const;

export function Term({ k, children }: { k: keyof typeof GLOSSARY; children: ReactNode }) {
  const [title, body] = GLOSSARY[k];
  return (
    <span className="v3-term" tabIndex={0}>
      {children}
      <span className="v3-term-tip" role="tooltip">
        <b>{title}</b>
        {body}
      </span>
    </span>
  );
}
