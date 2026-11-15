import { Suspense, lazy, useEffect } from 'react';
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmberProvider } from './context/EmberContext';
import { HomePage } from './v3/pages/HomePage';
import { Loading } from './v3/ui';

// every route but the landing page loads on first visit, so the hero ships alone
const ExplorerPage = lazy(() => import('./pages/ExplorerPage').then((m) => ({ default: m.ExplorerPage })));
const ExportPage = lazy(() => import('./pages/ExportPage').then((m) => ({ default: m.ExportPage })));
const InvestigationDetailPage = lazy(() => import('./pages/InvestigationDetailPage').then((m) => ({ default: m.InvestigationDetailPage })));
const ProtocolComparePage = lazy(() => import('./pages/ProtocolComparePage').then((m) => ({ default: m.ProtocolComparePage })));
const ReviewWorkspacePage = lazy(() => import('./pages/ReviewWorkspacePage').then((m) => ({ default: m.ReviewWorkspacePage })));
const AskPage = lazy(() => import('./v3/pages/AskPage').then((m) => ({ default: m.AskPage })));
const EarthPage = lazy(() => import('./v3/pages/EarthPage').then((m) => ({ default: m.EarthPage })));
const LensPage = lazy(() => import('./v3/pages/LensPage').then((m) => ({ default: m.LensPage })));
const MapPage = lazy(() => import('./v3/pages/MapPage').then((m) => ({ default: m.MapPage })));
const TrustPage = lazy(() => import('./v3/pages/TrustPage').then((m) => ({ default: m.TrustPage })));

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, 'EMBER — Evidence Map for Burn & Extinction Risk'],
  [/^\/map/, 'Evidence map · EMBER'],
  [/^\/lens/, 'Mission lens · EMBER'],
  [/^\/ask/, 'Ask EMBER'],
  [/^\/investigations\/./, 'Investigation · EMBER'],
  [/^\/investigations/, 'Investigations · EMBER'],
  [/^\/compare/, 'Compare experiments · EMBER'],
  [/^\/export/, 'Data · EMBER'],
  [/^\/earth/, 'Back to Earth · EMBER'],
  [/^\/trust/, 'Trust · EMBER'],
  [/^\/review/, 'Full scientific review · EMBER'],
];

function RouteManager() {
  const location = useLocation();

  useEffect(() => {
    const matched = ROUTE_TITLES.find(([re]) => re.test(location.pathname));
    document.title = matched ? matched[1] : 'EMBER — Evidence Map for Burn & Extinction Risk';
    window.scrollTo(0, 0);
  }, [location.pathname]);

  return (
    <Layout>
      <Suspense fallback={<div className="v3-page"><Loading what="Loading…" /></div>}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/map" element={<MapPage />} />
        <Route path="/lens" element={<LensPage />} />
        <Route path="/ask" element={<AskPage />} />
        <Route path="/investigations" element={<ExplorerPage />} />
        <Route path="/investigations/:id" element={<InvestigationDetailPage />} />
        <Route path="/compare" element={<ProtocolComparePage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/earth" element={<EarthPage />} />
        <Route path="/trust" element={<TrustPage />} />
        <Route path="/review" element={<ReviewWorkspacePage />} />
        <Route path="/reviews/:id" element={<ReviewWorkspacePage />} />
        {/* old links */}
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/protocol-compare" element={<ProtocolComparePage />} />
        <Route
          path="*"
          element={
            <div className="v3-page">
              <h1>Page not found</h1>
              <p>
                <Link to="/map">Open the evidence map</Link>
              </p>
            </div>
          }
        />
      </Routes>
      </Suspense>
    </Layout>
  );
}

export function App() {
  return (
    <HashRouter>
      <EmberProvider>
        <RouteManager />
      </EmberProvider>
    </HashRouter>
  );
}
export default App;
