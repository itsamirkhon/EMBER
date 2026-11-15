import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import { useEmber } from '../context/EmberContext';
import { SourceModal } from './SourceModal';

/** The three things a judge or engineer does first, always visible. */
const PRIMARY = [
  { to: '/map', label: 'Evidence map' },
  { to: '/lens', label: 'Check a cabin' },
  { to: '/ask', label: 'Ask EMBER' },
];

/** Reference material, one click away. Back to Earth lives on the home page and in the footer instead. */
const MORE = [
  { to: '/investigations', label: 'Investigations', hint: 'The 15 NASA experiments' },
  { to: '/compare', label: 'Compare tests', hint: 'Two protocols side by side' },
  { to: '/export', label: 'Data', hint: 'Download with a source row per record' },
  { to: '/trust', label: 'How far to trust it', hint: 'Backtest, checks and limits' },
];

function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden className="v3-logo-mark">
      <path d="M16 3c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 1 3 2 4 3 4 0-4 1-7 2-10z" fill="#ff6a2b" />
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
            EMBER · Evidence Map for Burn and Extinction Risk · NASA Space Apps Challenge 2026, “Flame in Freefall”. Data: NASA{' '}
            <a href="https://psi.nasa.gov/" target="_blank" rel="noreferrer">
              Physical Sciences Informatics
            </a>{' '}
            and NTRS. Not an official NASA product, not a certification tool.
          </span>
          <span className="v3-row">
            <Link to="/earth">Back to Earth</Link>
            <Link to="/trust">How far to trust it</Link>
            <a href="./intro.html">Flame chamber</a>
          </span>
        </div>
      </footer>

      <SourceModal />
    </div>
  );
}
