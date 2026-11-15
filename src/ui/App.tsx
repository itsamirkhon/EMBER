import { useEffect } from 'react';
import { HashRouter, Link, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmberProvider } from './context/EmberContext';
import { ExplorerPage } from './pages/ExplorerPage';
import { ExportPage } from './pages/ExportPage';
import { InvestigationDetailPage } from './pages/InvestigationDetailPage';
import { ProtocolComparePage } from './pages/ProtocolComparePage';
import { ReviewWorkspacePage } from './pages/ReviewWorkspacePage';
import { AskPage } from './v3/pages/AskPage';
import { EarthPage } from './v3/pages/EarthPage';
import { HomePage } from './v3/pages/HomePage';
import { LensPage } from './v3/pages/LensPage';
import { MapPage } from './v3/pages/MapPage';
import { TrustPage } from './v3/pages/TrustPage';

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
