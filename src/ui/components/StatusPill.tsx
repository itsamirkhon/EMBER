import type { AnswerBoundary, ApplicabilityVerdict, GasRole, Provenance, SynthesisMode } from '../../core';

type Tone = 'ok' | 'warn' | 'danger' | 'info' | 'planned' | 'accent' | 'neutral';

export interface StatusPillProps {
  tone?: Tone;
  icon?: string;
  label: string;
  title?: string;
}

export function StatusPill({ tone = 'neutral', icon, label, title }: StatusPillProps) {
  const cls = tone === 'neutral' ? 'pill' : `pill pill-${tone}`;
  return (
    <span className={cls} title={title}>
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      <span>{label}</span>
    </span>
  );
}

export function ModeBadge({ mode }: { mode: SynthesisMode | string }) {
  if (mode === 'LIVE_AI') {
    return <StatusPill tone="info" icon="⚡" label="Model text, checked" title="Model-written synthesis kept only after EMBER's source checks passed" />;
  }
  if (mode === 'SAVED_DEMO_SNAPSHOT') {
    return (
      <StatusPill
        tone="accent"
        icon="◈"
        label="Saved example"
        title="Pre-computed deterministic benchmark snapshot"
      />
    );
  }
  return (
    <StatusPill
      tone="ok"
      icon="⚙"
      label="Rule-based"
      title="Applicability rules, passage triage and verification run without an AI model"
    />
  );
}

export function VerdictBadge({ verdict }: { verdict: ApplicabilityVerdict }) {
  switch (verdict) {
    case 'admissible':
      return <StatusPill tone="ok" icon="✓" label="Applies" />;
    case 'conditional_support':
      return <StatusPill tone="warn" icon="⚠" label="Applies with caveats" />;
    case 'planned_only':
      return <StatusPill tone="planned" icon="◷" label="Planned, no results yet" />;
    case 'inadmissible':
      return <StatusPill tone="danger" icon="✕" label="Does not apply" />;
  }
}

export function AnswerBoundaryBadge({ boundary }: { boundary: AnswerBoundary }) {
  switch (boundary) {
    case 'sufficient_observed':
      return <StatusPill tone="ok" icon="✓" label="Answered from observed data" />;
    case 'conditional_or_partial':
      return <StatusPill tone="warn" icon="⚠" label="Partly answered" />;
    case 'insufficient_data':
      return <StatusPill tone="danger" icon="∅" label="Not established by the data" />;
    case 'invalid_premise':
      return <StatusPill tone="danger" icon="!" label="Premise not supported" />;
  }
}

export function ProvenanceBadge({ provenance }: { provenance: Provenance | 'planned' | 'interpretation' }) {
  switch (provenance) {
    case 'reported':
      return <StatusPill tone="ok" icon="●" label="Reported" />;
    case 'series_level':
      return <StatusPill tone="info" icon="◐" label="Series-Level" />;
    case 'derived':
      return <StatusPill tone="info" icon="fx" label="Derived" />;
    case 'assumed':
      return <StatusPill tone="warn" icon="?" label="Assumed" />;
    case 'planned':
      return <StatusPill tone="planned" icon="◷" label="Planned Only" />;
    case 'interpretation':
      return <StatusPill tone="accent" icon="§" label="Interpretation" />;
    default:
      return <StatusPill tone="neutral" icon="–" label="Unknown" />;
  }
}

export function GasRoleBadge({ role }: { role: GasRole | string }) {
  if (role === 'oxidizer_stream') {
    return (
      <StatusPill
        tone="danger"
        icon="⊘"
        label="O₂ in burner stream, not cabin air"
        title="NOT cabin ambient atmosphere — localized oxidizer stream around burner/injector"
      />
    );
  }
  if (role === 'ambient') {
    return <StatusPill tone="ok" icon="○" label="O₂ in cabin air" />;
  }
  return <StatusPill tone="info" icon="○" label={`Role: ${role}`} />;
}
