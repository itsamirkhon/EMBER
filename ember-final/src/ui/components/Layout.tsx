import type { ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useEmber } from '../context/EmberContext';
import { SourceModal } from './SourceModal';

const NAV_ITEMS = [
  { to: '/map', label: 'Evidence map' },
  { to: '/lens', label: 'Mission lens' },
  { to: '/ask', label: 'Ask EMBER' },
  { to: '/investigations', label: 'Investigations' },
  { to: '/compare', label: 'Compare' },
  { to: '/export', label: 'Data' },
  { to: '/earth', label: 'Back to Earth' },
  { to: '/trust', label: 'Trust' },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="v3-logo-mark">
      <path d="M16 3c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 1 3 2 4 3 4 0-4 1-7 2-10z" fill="#ff9f0a" />
      <path d="M16 15c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-5 .5 1 1 1.5 1.5 1.5 0-2 .2-3 .5-4.5z" fill="#000" opacity=".5" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { announcement } = useEmber();
  const loc = useLocation();
  // the full-screen intro page keeps its own minimal chrome
  const home = loc.pathname === '/';

  return (
    <div className="app-shell v3">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className={`v3-top${home ? ' v3-top-home' : ''}`}>
        <div className="v3-top-inner">
          <Link to="/" className="v3-logo" aria-label="EMBER home">
            <Logo />
            EMBER
          </Link>
          <nav aria-label="Primary" className="v3-nav">
            {NAV_ITEMS.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {item.label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>

      <main id="main-content" className="v3-main" tabIndex={-1} key={loc.pathname}>
        {children}
      </main>

      <footer className="v3-foot">
        <div className="v3-foot-inner">
          <span>
            EMBER · Evidence Map for Burn &amp; Extinction Risk · NASA Space Apps Challenge 2026, “Flame in Freefall”. Data: NASA{' '}
            <a href="https://psi.nasa.gov/" target="_blank" rel="noreferrer">
              Physical Sciences Informatics
            </a>{' '}
            and NTRS. Not an official NASA product, not a certification tool.
          </span>
          <span className="v3-row">
            <Link to="/trust">How far to trust it</Link>
            <Link to="/review">Full scientific review</Link>
            <a href="./intro.html">3D intro</a>
          </span>
        </div>
      </footer>

      <SourceModal />
    </div>
  );
}
