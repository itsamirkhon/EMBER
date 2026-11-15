import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useEmber } from '../context/EmberContext';
import { SourceModal } from './SourceModal';

/** The four screens a judge or engineer needs, always visible. */
const PRIMARY = [
  { to: '/map', label: 'Evidence map' },
  { to: '/lens', label: 'Mission lens' },
  { to: '/ask', label: 'Ask EMBER' },
  { to: '/trust', label: 'Trust' },
];

/** Research support, one click away. */
const MORE = [
  { to: '/investigations', label: 'Investigations', hint: 'Source records and methods' },
  { to: '/compare', label: 'Compare tests', hint: 'Recorded protocols, not inferred experiments' },
  { to: '/export', label: 'Download data', hint: 'Export verified source-linked records' },
  { to: '/earth', label: 'Back to Earth', hint: 'Research outcomes beyond spacecraft' },
  { to: '/review', label: 'Full review', hint: 'Advanced scientific workbench' },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="v3-logo-mark">
      <path d="M16 3c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 1 3 2 4 3 4 0-4 1-7 2-10z" fill="currentColor" />
    </svg>
  );
}

function Chevron() {
  return (
    <svg viewBox="0 0 12 12" aria-hidden>
      <path d="M2 4.5l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Layout({ children }: { children: ReactNode }) {
  const { announcement } = useEmber();
  const loc = useLocation();
  const home = loc.pathname === '/';
  const [navOpen, setNavOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const moreActive = MORE.some((m) => loc.pathname.startsWith(m.to));

  useEffect(() => {
    setNavOpen(false);
    setMoreOpen(false);
  }, [loc.pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moreRef.current?.contains(e.target as Node)) setMoreOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMoreOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [moreOpen]);

  return (
    <div className="app-shell v3">
      <a href="#main-content" className="skip-link visually-hidden">
        Skip to main content
      </a>
      <div className="visually-hidden" role="status" aria-live="polite">
        {announcement}
      </div>

      <header className="v3-top">
        <div className="v3-top-inner">
          <Link to="/" className="v3-logo" aria-label="EMBER home">
            <Logo />
            EMBER
          </Link>
          <button type="button" className="v3-burger" aria-expanded={navOpen} aria-controls="v3-nav" onClick={() => setNavOpen((v) => !v)}>
            Menu
          </button>
          <nav id="v3-nav" aria-label="Primary" className={`v3-nav${navOpen ? ' open' : ''}`}>
            {PRIMARY.map((item) => (
              <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {item.label}
              </NavLink>
            ))}
            <div className="v3-more" ref={moreRef}>
              <button type="button" className={moreActive ? 'active' : undefined} aria-expanded={moreOpen} aria-haspopup="true" onClick={() => setMoreOpen((v) => !v)}>
                More <Chevron />
              </button>
              {moreOpen && (
                <div className="v3-more-menu">
                  {MORE.map((item) => (
                    <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                      {item.label}
                      <span>{item.hint}</span>
                    </NavLink>
                  ))}
                </div>
              )}
            </div>
          </nav>
        </div>
      </header>

      <main id="main-content" className={`v3-main${home ? ' v3-main-full' : ''}`} tabIndex={-1} key={loc.pathname}>
        {children}
      </main>

      <footer className="v3-foot">
        <div className="v3-foot-inner">
          <span>
            EMBER — Evidence Map for Burn &amp; Extinction Risk · Team EMBER · NASA Space Apps Challenge 2026, “Flame in Freefall”. Data: NASA{' '}
            <a href="https://psi.nasa.gov/" target="_blank" rel="noreferrer">
              Physical Sciences Informatics
            </a>{' '}
            and NTRS. Not an official NASA product, not a certification tool.
          </span>
          <span className="v3-row">
            <Link to="/trust">Scientific limits</Link>
            <Link to="/export">Data and sources</Link>
          </span>
        </div>
      </footer>

      <SourceModal />
    </div>
  );
}
