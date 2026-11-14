import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { AnswerStatus, FindingStatus } from '../lib/evidence';
import { kpaToPsi } from '../lib/evidence';
import type { Investigation, Range, Source } from '../lib/types';

// ---------------------------------------------------------------- formatting

export function fmtNum(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return String(Math.round(v * 10) / 10);
  return v.toFixed(digits);
}
export function fmtRange(r: Range | undefined, unit = ''): string {
  if (!r) return 'not documented';
  const u = unit ? ` ${unit}` : '';
  return r[0] === r[1] ? `${fmtNum(r[0])}${u}` : `${fmtNum(r[0])}–${fmtNum(r[1])}${u}`;
}
export function fmtPct(p: number | null | undefined): string {
  return p === null || p === undefined ? '—' : `${Math.round(p * 100)}%`;
}
export function fmtPressure(kpa: number | null | undefined): string {
  if (kpa === null || kpa === undefined) return '—';
  return `${fmtNum(kpa)} kPa (${kpaToPsi(kpa).toFixed(1)} psi)`;
}
export function fmtGravity(g: number | null | undefined): string {
  if (g === null || g === undefined) return '—';
  if (g <= 0.01) return 'µg';
  return `${g.toFixed(g < 1 ? 2 : 1)} g`;
}

// ---------------------------------------------------------------- glossary

export const GLOSSARY: Record<string, { term: string; def: string }> = {
  o2: { term: 'O₂', def: 'Oxygen concentration by volume, in %. Earth air is 20.9%. Planned lunar habitats may use 30–34% at reduced pressure, which makes materials more flammable.' },
  kpa: { term: 'kPa', def: 'Kilopascal, the pressure unit EMBER uses everywhere. Sea level is 101.3 kPa (14.7 psi). 1 psi = 6.895 kPa.' },
  psi: { term: 'psi', def: 'Pounds per square inch. NASA habitat specs are often in psi: 14.7 psi = 1 atm = 101.3 kPa; 10.2 psi = 70.3 kPa; 8.2 psi = 56.5 kPa.' },
  flow: { term: 'flow', def: 'Air velocity past the sample (cm/s). In microgravity there is no buoyant convection, so ventilation flow is the main oxygen supply to a flame.' },
  ug: { term: 'µg', def: 'Microgravity (≈0 g): the near-weightless condition on the ISS or in a free-flying spacecraft.' },
  g: { term: 'g', def: 'Gravity level relative to Earth (1 g). Moon ≈ 0.17 g, Mars ≈ 0.38 g. PSI has no combustion data at partial gravity yet.' },
  psiRepo: { term: 'PSI', def: 'NASA Physical Sciences Informatics: the public repository of ISS physical-science experiment data used as EMBER’s source.' },
  phase: { term: 'fuel phase', def: 'Solid (fabrics, plastics), liquid (droplets) or gas (burner flames). Results transfer between phases only qualitatively.' },
  normdist: { term: 'normalized distance', def: 'Distance in condition space where 1 unit ≈ 3% O₂, 15 kPa or 8 cm/s flow. Different fuel phase adds 4 units, different material 1 unit, an unreported value 1 unit.' },
};

export function Term({ k, children }: { k: keyof typeof GLOSSARY | string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const g = GLOSSARY[k];
  if (!g) return <>{children}</>;
  return (
    <span className="term" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button
        type="button"
        aria-describedby={open ? id : undefined}
        aria-expanded={open}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => e.key === 'Escape' && setOpen(false)}
      >
        {children ?? g.term}
      </button>
      {open && (
        <span role="tooltip" id={id} className="tip">
          <strong>{g.term}</strong> — {g.def}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- status badges

function Icon({ kind }: { kind: 'check' | 'half' | 'warn' | 'question' | 'dot' }) {
  const common = { className: 'ico', viewBox: '0 0 20 20', 'aria-hidden': true } as const;
  switch (kind) {
    case 'check':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="9" fill="var(--good)" />
          <path d="M5.5 10.5l3 3 6-7" stroke="#06140a" strokeWidth="2.2" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'half':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--warning)" strokeWidth="2" />
          <path d="M10 2a8 8 0 0 1 0 16z" fill="var(--warning)" />
        </svg>
      );
    case 'warn':
      return (
        <svg {...common}>
          <path d="M10 1.8l8.6 15.4H1.4z" fill="var(--serious)" />
          <path d="M10 7v5" stroke="#1a0b05" strokeWidth="2" strokeLinecap="round" />
          <circle cx="10" cy="14.6" r="1.1" fill="#1a0b05" />
        </svg>
      );
    case 'question':
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="8" fill="none" stroke="var(--neutral)" strokeWidth="2" strokeDasharray="3 2" />
          <text x="10" y="14" textAnchor="middle" fontSize="11" fontWeight="700" fill="var(--text)">?</text>
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="10" cy="10" r="5" fill="var(--neutral)" />
        </svg>
      );
  }
}

const ANSWER: Record<AnswerStatus, { label: string; cls: string; icon: 'check' | 'half' | 'warn'; help: string }> = {
  measured: { label: 'Measured', cls: 'status-good', icon: 'check', help: 'A real test was run at these conditions.' },
  interpolated: { label: 'Interpolated', cls: 'status-warning', icon: 'half', help: 'Between real tests; estimate with uncertainty.' },
  extrapolated: { label: 'Extrapolated', cls: 'status-serious', icon: 'warn', help: 'Outside the data; nearest tests and distance shown.' },
};
const FINDING: Record<FindingStatus, { label: string; cls: string; icon: 'check' | 'half' | 'question'; help: string }> = {
  known: { label: 'Known', cls: 'status-good', icon: 'check', help: 'Mission conditions are inside the tested range.' },
  extrapolating: { label: 'Extrapolating', cls: 'status-warning', icon: 'half', help: 'Near, but outside, the tested range.' },
  unknown: { label: 'Unknown', cls: 'status-neutral', icon: 'question', help: 'Different fuel phase, undocumented, or far from tested conditions.' },
};

export function AnswerBadge({ status, large }: { status: AnswerStatus; large?: boolean }) {
  const s = ANSWER[status];
  return (
    <span className={`status ${s.cls} ${large ? 'lg' : ''}`} title={s.help}>
      <Icon kind={s.icon} />
      {s.label}
    </span>
  );
}
export function FindingBadge({ status }: { status: FindingStatus }) {
  const s = FINDING[status];
  return (
    <span className={`status ${s.cls}`} title={s.help}>
      <Icon kind={s.icon} />
      {s.label}
    </span>
  );
}
export const answerHelp = (s: AnswerStatus) => ANSWER[s].help;
export const findingHelp = (s: FindingStatus) => FINDING[s].help;

// ---------------------------------------------------------------- misc

export function DirectionTags({ dirs }: { dirs: string[] }) {
  return (
    <>
      {dirs.map((d) => (
        <span key={d} className={`tag dir-${d}`}>
          {d}
        </span>
      ))}
    </>
  );
}

export function InvLink({ inv, id }: { inv?: Investigation; id: string }) {
  return <Link to={`/investigations/${encodeURIComponent(id)}`}>{inv?.name ?? id}</Link>;
}

export function SourceLink({ source, fallback }: { source?: Source | null; fallback?: string }) {
  if (!source) return fallback ? <span className="muted">{fallback}</span> : null;
  return (
    <a href={source.url} target="_blank" rel="noreferrer">
      {source.label}
    </a>
  );
}

/** Resolve a sourceId from an investigation's sources (or any investigation). */
export function findSource(sourceId: string | null | undefined, invs: Investigation[], prefer?: Investigation): Source | undefined {
  if (!sourceId) return undefined;
  return prefer?.sources.find((s) => s.id === sourceId) ?? invs.flatMap((i) => i.sources).find((s) => s.id === sourceId);
}

export function Meter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div className="meter" title={hint}>
      <span className="lab">{label}</span>
      <span className="track" role="meter" aria-valuemin={0} aria-valuemax={1} aria-valuenow={Number(pct.toFixed(2))} aria-label={label}>
        <span className="fill" style={{ display: 'block', width: `${Math.max(2, pct * 100)}%` }} />
      </span>
      <span className="val">{pct.toFixed(2)}</span>
    </div>
  );
}

export function PageHead({ eyebrow, title, children }: { eyebrow?: string; title: string; children?: ReactNode }) {
  return (
    <header className="page-head">
      {eyebrow && <div className="eyebrow">{eyebrow}</div>}
      <h1>{title}</h1>
      {children}
    </header>
  );
}

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
