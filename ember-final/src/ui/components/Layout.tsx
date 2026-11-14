import type { ReactNode } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { ENGINE_VERSION } from '../apiClient';
import { useEmber } from '../context/EmberContext';
import { SourceModal } from './SourceModal';
import { ModeBadge, StatusPill } from './StatusPill';

const NAV_ITEMS = [
  { to: '/', label: 'Review Workspace', end: true },
  { to: '/explorer', label: 'Explorer' },
  { to: '/insights', label: 'Insights' },
  { to: '/protocol-compare', label: 'Protocol & Compare' },
  { to: '/variants', label: 'Variant Diff' },
  { to: '/planner', label: 'Planner' },
  { to: '/modeling', label: 'Modeling Lab' },
  { to: '/export', label: 'Export' },
  { to: '/evaluation', label: 'Evaluation' },
];

export function Layout({ children }: { children: ReactNode }) {
  const { activeSnapshot, backendSource, announcement } = useEmber();

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>

      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className="site-header">
        <div className="header-inner">
          <div className="brand-group">
            <span className="brand-mark" aria-hidden="true">
              EMB
            </span>
            <div>
              <Link to="/" className="brand-title">
                EMBER v2 · Evidence-Grounded Spacecraft Fire Safety Workbench
              </Link>
              <span className="brand-subtitle">
                15 NASA PSI Investigations · Stage-Bound Protocols · Provenance & Refusal Gate
              </span>
            </div>
          </div>

          <div className="header-meta">
            {activeSnapshot ? (
              <ModeBadge mode={activeSnapshot.review.synthesis.mode} />
            ) : (
              <StatusPill tone="neutral" icon="○" label="No Active Review" />
            )}
            <StatusPill
              tone={backendSource === 'node_api' ? 'info' : 'warn'}
              icon={backendSource === 'node_api' ? '●' : '◈'}
              label={backendSource === 'node_api' ? 'Node API Connected' : 'Static Offline Fallback'}
            />
          </div>
        </div>

        <nav aria-label="Primary" className="primary-nav">
          <ul className="nav-list">
            {NAV_ITEMS.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.end}
                  className="nav-link"
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>
      </header>

      <main id="main-content" className="main-container" tabIndex={-1}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="footer-inner">
          <span>
            EMBER v2 ({ENGINE_VERSION}) — Scientific Evidence Workbench. Observed findings, author interpretations, and conceptual schematics are strictly separated.
          </span>
          <span className="mono muted">NASA PSI Corpus v2</span>
        </div>
      </footer>

      <SourceModal />
    </div>
  );
}
