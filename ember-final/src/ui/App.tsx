import { useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';
import { Layout } from './components/Layout';
import { EmberProvider } from './context/EmberContext';
import { EvaluationPage } from './pages/EvaluationPage';
import { ExplorerPage } from './pages/ExplorerPage';
import { ExportPage } from './pages/ExportPage';
import { InsightsPage } from './pages/InsightsPage';
import { InvestigationDetailPage } from './pages/InvestigationDetailPage';
import { ModelingLabPage } from './pages/ModelingLabPage';
import { PlannerPage } from './pages/PlannerPage';
import { ProtocolComparePage } from './pages/ProtocolComparePage';
import { ReviewWorkspacePage } from './pages/ReviewWorkspacePage';
import { VariantDiffPage } from './pages/VariantDiffPage';

const ROUTE_TITLES: Array<[RegExp, string]> = [
  [/^\/$/, 'Review Workspace | EMBER v2'],
  [/^\/reviews\//, 'Review Snapshot | EMBER v2'],
  [/^\/explorer/, 'Experiment Explorer | EMBER v2'],
  [/^\/investigations\//, 'Investigation Dossier | EMBER v2'],
  [/^\/insights/, 'Fire Safety Insights | EMBER v2'],
  [/^\/protocol-compare/, 'Protocol & Comparison | EMBER v2'],
  [/^\/variants/, 'Design Variant Diff | EMBER v2'],
  [/^\/planner/, 'Test Programme Planner | EMBER v2'],
  [/^\/modeling/, 'Modeling & Replay Lab | EMBER v2'],
  [/^\/export/, 'Export & Modeling Dataset | EMBER v2'],
  [/^\/evaluation/, 'Evaluation Benchmark | EMBER v2'],
];

function RouteManager() {
  const location = useLocation();

  useEffect(() => {
    const matched = ROUTE_TITLES.find(([re]) => re.test(location.pathname));
    document.title = matched ? matched[1] : 'EMBER v2 | Spacecraft Fire Safety Scientific Workbench';
  }, [location.pathname]);

  return (
    <Layout>
      <Routes>
        <Route path="/" element={<ReviewWorkspacePage />} />
        <Route path="/reviews/:id" element={<ReviewWorkspacePage />} />
        <Route path="/explorer" element={<ExplorerPage />} />
        <Route path="/investigations/:id" element={<InvestigationDetailPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/protocol-compare" element={<ProtocolComparePage />} />
        <Route path="/variants" element={<VariantDiffPage />} />
        <Route path="/planner" element={<PlannerPage />} />
        <Route path="/modeling" element={<ModelingLabPage />} />
        <Route path="/export" element={<ExportPage />} />
        <Route path="/evaluation" element={<EvaluationPage />} />
        <Route path="*" element={<ReviewWorkspacePage />} />
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
