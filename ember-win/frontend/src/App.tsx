import { NavLink, Outlet, Route, Routes, Link } from 'react-router-dom';
import { api, MOCK } from './api/client';
import { Async, Disclaimer, useAsync } from './components/ui';
import { Landing } from './pages/Landing';
import { ReviewNew } from './pages/ReviewNew';
import { ReviewShell, Overview } from './pages/Review';
import { Insights, Compare, Design, Programme, ExportPage, ReplayPage } from './pages/ReviewViews';
import { Explorer, InvestigationPage, ProtocolPage } from './pages/Explorer';
import { EvalPage } from './pages/Eval';
import { SavedReviews } from './pages/SavedReviews';

function Layout() {
  const meta = useAsync(() => api.meta(), []);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="topbar">
        <div className="topbar-in">
          <Link to="/" className="brand" aria-label="EMBER home"><i aria-hidden />EMBER</Link>
          <nav className="nav" aria-label="Primary">
            <NavLink to="/review">New review</NavLink>
            <NavLink to="/explore">Experiments</NavLink>
            <NavLink to="/reviews">Saved reviews</NavLink>
            <NavLink to="/eval">Evaluation</NavLink>
          </nav>
        </div>
      </header>
      <main id="main">
        {MOCK && <Disclaimer tone="warn"><strong>Mock data layer (VITE_MOCK=1)</strong>All content is illustrative fixture data, not real evidence.</Disclaimer>}
        <Outlet />
      </main>
      <footer>
        <Async r={meta} label="Checking backend">{(m) => (
          <span>EMBER {m.version} · corpus {m.corpus_version} · rules {m.rules_version} · default mode {m.mode} · all corpus records provisional unless marked otherwise</span>
        )}</Async>
      </footer>
    </>
  );
}

export function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Landing />} />
        <Route path="review" element={<ReviewNew />} />
        <Route path="r/:id" element={<ReviewShell />}>
          <Route index element={<Overview />} />
          <Route path="insights" element={<Insights />} />
          <Route path="compare" element={<Compare />} />
          <Route path="design" element={<Design />} />
          <Route path="programme" element={<Programme />} />
          <Route path="export" element={<ExportPage />} />
          <Route path="replay" element={<ReplayPage />} />
        </Route>
        <Route path="explore" element={<Explorer />} />
        <Route path="investigations/:id" element={<InvestigationPage />} />
        <Route path="investigations/:id/protocol" element={<ProtocolPage />} />
        <Route path="reviews" element={<SavedReviews />} />
        <Route path="eval" element={<EvalPage />} />
        <Route path="*" element={<div className="card"><h2>Page not found</h2><Link to="/">Back to start</Link></div>} />
      </Route>
    </Routes>
  );
}
