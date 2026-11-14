import { useEffect } from 'react';
import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { useEmber } from './data/context';
import Home from './pages/Home';
import Investigations from './pages/Investigations';
import InvestigationDetail from './pages/InvestigationDetail';
import Compare from './pages/Compare';
import Families from './pages/Families';
import WhatIf from './pages/WhatIf';
import Gravity from './pages/Gravity';
import Ask from './pages/Ask';
import Export from './pages/Export';
import Earth from './pages/Earth';
import Trust from './pages/Trust';
import Physics from './pages/Physics';
import About from './pages/About';

const NAV: [string, string][] = [
  ['/', 'Mission lens'],
  ['/investigations', 'Investigations'],
  ['/compare', 'Compare'],
  ['/what-if', 'What-if'],
  ['/gravity', 'Gravity bracket'],
  ['/ask', 'Ask EMBER'],
  ['/export', 'Export'],
  ['/earth', 'Back to Earth'],
  ['/trust', 'Trust'],
];

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden>
      <path d="M16 3c2 6 9 9 9 17a9 9 0 0 1-18 0c0-5 3-7 4-11 1 3 2 4 3 4 0-4 1-7 2-10z" fill="var(--brand)" />
      <path d="M16 15c1 3 4 4 4 8a4 4 0 0 1-8 0c0-2 1-3 2-5 .5 1 1 1.5 1.5 1.5 0-2 .2-3 .5-4.5z" fill="var(--bg)" />
    </svg>
  );
}

export default function App() {
  const { data, error } = useEmber();
  const loc = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc.pathname]);

  return (
    <>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>
        Skip to content
      </a>
      <header className="topbar">
        <div className="topbar-inner">
          <Link to="/" className="logo" aria-label="EMBER home">
            <Logo />
            EMBER <small>Evidence Map for Burn &amp; Extinction Risk</small>
          </Link>
          <nav className="nav" aria-label="Main">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : undefined)}>
                {label}
              </NavLink>
            ))}
          </nav>
        </div>
      </header>
      {data && data.fixtureFiles.length > 0 && (
        <div className="banner fixture" role="note">
          <div className="banner-inner">
            <strong>Fixture data.</strong>
            <span>
              Synthetic development data is shown for: {data.fixtureFiles.join(', ')}. Real PSI data has not been published to{' '}
              <code>data/</code> yet. Numbers on this page are not NASA results.
            </span>
          </div>
        </div>
      )}
      {error && (
        <div className="banner error" role="alert">
          <div className="banner-inner">Could not load data: {error}</div>
        </div>
      )}
      <main id="main" tabIndex={-1}>
        {!data && !error && <p className="muted">Loading evidence…</p>}
        {data && (
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/investigations" element={<Investigations />} />
            <Route path="/investigations/:id" element={<InvestigationDetail />} />
            <Route path="/compare" element={<Compare />} />
            <Route path="/families" element={<Families />} />
            <Route path="/what-if" element={<WhatIf />} />
            <Route path="/gravity" element={<Gravity />} />
            <Route path="/ask" element={<Ask />} />
            <Route path="/export" element={<Export />} />
            <Route path="/earth" element={<Earth />} />
            <Route path="/trust" element={<Trust />} />
            <Route path="/physics" element={<Physics />} />
            <Route path="/about" element={<About />} />
            <Route path="*" element={<p>Page not found. <Link to="/">Go to the mission lens</Link>.</p>} />
          </Routes>
        )}
      </main>
      <footer className="footer">
        <div className="footer-inner">
          <span>
            EMBER · NASA Space Apps 2026 · “Flame in Freefall”. Data: NASA{' '}
            <a href="https://psi.nasa.gov/" target="_blank" rel="noreferrer">Physical Sciences Informatics</a> (CC0) and NTRS.
            Not an official NASA product.
          </span>
          <span className="row">
            <Link to="/about">About &amp; data sources</Link>
            <Link to="/families">Hardware families</Link>
            <Link to="/physics">Flame illustration</Link>
            <Link to="/trust">How far to trust us</Link>
          </span>
        </div>
      </footer>
    </>
  );
}
