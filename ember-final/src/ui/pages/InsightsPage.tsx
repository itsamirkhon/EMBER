import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Claim, Direction, Investigation } from '../../core';
import { ProvenanceBadge, StatusPill } from '../components/StatusPill';
import { useEmber } from '../context/EmberContext';

interface DomainSynthesisConfig {
  id: Exclude<Direction, 'fundamental'>;
  title: string;
  subtitle: string;
  topicKeywords: string[];
  openQuestions: string[];
}

const DOMAIN_CONFIGS: DomainSynthesisConfig[] = [
  {
    id: 'prevention',
    title: 'Fire Prevention & Material Flammability',
    subtitle: 'Ignition limits, flame spread, sample thickness, flow direction, and atmospheric O2 / pressure envelopes.',
    topicKeywords: ['prevention', 'ignition', 'spread', 'flammability', 'thickness', 'flow', 'concurrent', 'opposed', 'extinction'],
    openQuestions: [
      'Partial gravity (0.166g lunar / 0.38g Mars) vs 0g/1g scaling has zero orbital/lunar flight flammability rows in PSI v2.',
      'Joint elevated-O2 / reduced-pressure operating corners (e.g., 30–34% O2 at 56.5–70.3 kPa) are sparsely covered even where 1D marginals overlap.',
      'Thin-film (<1 mm) vs thermally thick (>2–3 mm) slab spread inversions under concurrent vs opposed flow cannot be transferred without explicit thickness matching.',
    ],
  },
  {
    id: 'detection',
    title: 'Smoke & Early Fire Detection',
    subtitle: 'Smoke particle size distribution (nm), aging coagulation, smoke point length, and sensor response limits.',
    topicKeywords: ['detection', 'smoke', 'particle', 'aerosol', 'aging', 'ionization', 'photoelectric', 'smoke point'],
    openQuestions: [
      'SAME / SAME-R smoke-sizing runs report atmospheric O2 and pressure as assumed ambient cabin values rather than directly logged gas-sensor measurements.',
      'Nuisance dust vs pyrolysis aerosol discrimination in low-pressure dusty lunar rover/habitat cabins remains unverified.',
      'Saffire-III flight hardware / smoke diagnostic traces require external PSI payload record verification before numerical threshold setting.',
    ],
  },
  {
    id: 'suppression',
    title: 'Fire Suppression & Extinction',
    subtitle: 'Hot-flame blowoff/quench, low-temperature cool-flame continuation (CFI/FLEX), diluent/N2 injection, and ventilation cutoff.',
    topicKeywords: ['suppression', 'extinction', 'cool flame', 'cool-flame', 'diluent', 'nitrogen', 'suppressant', 'shutoff', 'flow reduction'],
    openQuestions: [
      'FLEX-2 exists only as a planned baseline matrix with 0 flight rows; do not treat planned objectives as observed extinction thresholds.',
      'Shutting off ventilation can extinguish hot visible flames while still allowing unseen cool-flame chemistry or post-cutoff re-ignition risks on thick/condensed fuels.',
      'ACME burner studies inject O2 or diluent via localized oxidizer streams (oxidizer_stream) that must not be equated with ambient cabin O2 percentages.',
    ],
  },
];

function classifyClaimsForDomain(
  cfg: DomainSynthesisConfig,
  invs: Investigation[],
  claims: Claim[],
): {
  domainInvs: Investigation[];
  observed: Claim[];
  interpretations: Claim[];
  implications: Claim[];
} {
  const domainInvs = invs.filter((i) => i.direction.includes(cfg.id));
  const invSet = new Set(domainInvs.map((i) => i.id));
  const matching = claims.filter((c) => {
    if (c.inv && invSet.has(c.inv)) return true;
    const textLower = `${c.text} ${c.topics.join(' ')}`.toLowerCase();
    return cfg.topicKeywords.some((kw) => textLower.includes(kw));
  });

  const observed = matching.filter((c) => c.epistemicStatus === 'observed');
  const interpretations = matching.filter(
    (c) =>
      c.epistemicStatus === 'source_interpretation' ||
      c.epistemicStatus === 'derived_interpretation' ||
      c.epistemicStatus === 'hypothesis' ||
      c.epistemicStatus === 'planned',
  );
  const implications = matching.filter((c) => Boolean(c.conditionsScope) || c.limitations.length > 0);
  return { domainInvs, observed, interpretations, implications };
}

export function InsightsPage() {
  const { investigations, corpus, corpusLoading, ensureCorpus, openSourceRef } = useEmber();
  const [selectedDomain, setSelectedDomain] = useState<'all' | Exclude<Direction, 'fundamental'>>('all');

  useEffect(() => {
    if (!corpus) {
      void ensureCorpus();
    }
  }, [corpus, ensureCorpus]);

  const claims = corpus?.claims ?? [];

  const sections = useMemo(() => {
    const activeConfigs =
      selectedDomain === 'all' ? DOMAIN_CONFIGS : DOMAIN_CONFIGS.filter((d) => d.id === selectedDomain);
    return activeConfigs.map((cfg) => ({
      cfg,
      ...classifyClaimsForDomain(cfg, investigations, claims),
    }));
  }, [selectedDomain, investigations, claims]);

  return (
    <div className="stack-lg">
      <div className="page-header">
        <div>
          <h1>Spacecraft Fire Safety Insights Synthesis</h1>
          <p className="page-lead">
            Every insight explicitly separates Observed Facts from Author Interpretations, Engineering Applicability Conditions, and Open Questions — never turning an experimental observation into an automatic hardware recommendation.
          </p>
        </div>

        <div className="btn-group" role="group" aria-label="Filter fire safety domain">
          {(['all', 'prevention', 'detection', 'suppression'] as const).map((d) => (
            <button
              key={d}
              type="button"
              className={`btn btn-sm ${selectedDomain === d ? 'btn-primary' : ''}`}
              onClick={() => setSelectedDomain(d)}
            >
              {d === 'all' ? 'All 3 Domains' : d[0].toUpperCase() + d.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {corpusLoading ? (
        <div className="card"><p className="muted">Loading corpus claims for insights synthesis…</p></div>
      ) : null}

      {sections.map(({ cfg, domainInvs, observed, interpretations, implications }) => (
        <section key={cfg.id} className="card stack-md" aria-labelledby={`insight-heading-${cfg.id}`}>
          <div className="card-header">
            <div>
              <h2 id={`insight-heading-${cfg.id}`} className="card-title">{cfg.title}</h2>
              <p className="muted" style={{ margin: '0.2rem 0 0', fontSize: '0.88rem' }}>{cfg.subtitle}</p>
            </div>
            <div className="pill-row">
              {domainInvs.map((inv) => (
                <Link key={inv.id} to={`/investigations/${encodeURIComponent(inv.id)}`} className="pill">
                  <span>{inv.id}</span>
                  {inv.epistemicStatus === 'planned_only' ? <span aria-hidden="true">◷</span> : null}
                </Link>
              ))}
            </div>
          </div>

          <div className="grid-2">
            {/* 1. Observed Facts */}
            <div className="card-elevated stack-sm">
              <div className="card-header" style={{ marginBlockEnd: '0.35rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.96rem' }}>1. Observed Facts ({observed.length})</h3>
                <ProvenanceBadge provenance="reported" />
              </div>
              {observed.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No verified observed claims loaded yet.</p>
              ) : (
                observed.slice(0, 8).map((c) => (
                  <article key={c.id} className="card" style={{ padding: '0.7rem' }}>
                    <div className="pill-row" style={{ justifyContent: 'space-between', marginBlockEnd: '0.35rem' }}>
                      <div className="pill-row">
                        <StatusPill tone="info" label={c.inv ?? 'PSI'} />
                        <span className="mono muted" style={{ fontSize: '0.76rem' }}>{c.id}</span>
                      </div>
                      {c.sourceRef?.sourceId ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openSourceRef(c.sourceRef)}
                        >
                          Source
                        </button>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{c.text}</p>
                  </article>
                ))
              )}
            </div>

            {/* 2. Author Interpretations & Context */}
            <div className="card-elevated stack-sm">
              <div className="card-header" style={{ marginBlockEnd: '0.35rem' }}>
                <h3 style={{ margin: 0, fontSize: '0.96rem' }}>
                  2. Author Interpretations &amp; Planned Context ({interpretations.length})
                </h3>
                <ProvenanceBadge provenance="interpretation" />
              </div>
              {interpretations.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No non-observational claims recorded in this slice.</p>
              ) : (
                interpretations.slice(0, 6).map((c) => (
                  <article key={c.id} className="card" style={{ padding: '0.7rem' }}>
                    <div className="pill-row" style={{ justifyContent: 'space-between', marginBlockEnd: '0.35rem' }}>
                      <div className="pill-row">
                        <StatusPill tone="accent" label={c.inv ?? 'Context'} />
                        <StatusPill tone="planned" label={c.epistemicStatus} />
                      </div>
                      {c.sourceRef?.sourceId ? (
                        <button
                          type="button"
                          className="btn btn-sm"
                          onClick={() => openSourceRef(c.sourceRef)}
                        >
                          Source
                        </button>
                      ) : null}
                    </div>
                    <p style={{ margin: 0, fontSize: '0.88rem' }}>{c.text}</p>
                  </article>
                ))
              )}
            </div>
          </div>

          <div className="grid-2">
            {/* 3. Engineering Implications & Applicability Conditions */}
            <div className="card-elevated stack-sm">
              <h3 style={{ margin: 0, fontSize: '0.96rem' }}>
                3. Engineering Implications &amp; Applicability Conditions (Non-Prescriptive)
              </h3>
              <ul style={{ margin: 0, paddingInlineStart: '1.15rem', fontSize: '0.88rem' }}>
                {implications.slice(0, 6).map((c) => (
                  <li key={c.id} style={{ marginBlockEnd: '0.4rem' }}>
                    <strong>[{c.inv ?? 'Scope'}]</strong> {c.conditionsScope}{' '}
                    {c.limitations.length > 0 ? `— Limitations: ${c.limitations.join('; ')}` : ''}
                  </li>
                ))}
              </ul>
              <p className="muted" style={{ margin: 0, fontSize: '0.8rem' }}>
                Epistemic boundary: experimental trends apply only inside tested material/thickness, flow-history, and gas-role envelopes.
              </p>
            </div>

            {/* 4. Open Questions */}
            <div className="card-elevated stack-sm">
              <h3 style={{ margin: 0, fontSize: '0.96rem' }}>4. Open Questions &amp; Verification Needs</h3>
              <ul style={{ margin: 0, paddingInlineStart: '1.15rem', fontSize: '0.88rem' }}>
                {cfg.openQuestions.map((oq, idx) => (
                  <li key={idx} style={{ marginBlockEnd: '0.4rem' }}>{oq}</li>
                ))}
              </ul>
              <div className="pill-row">
                <Link to="/planner" className="btn btn-sm">Open Test Programme Planner →</Link>
              </div>
            </div>
          </div>
        </section>
      ))}
    </div>
  );
}
