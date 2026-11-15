import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';
import './ui/v3/v3.css';

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('Root mount element #root was not found.');
}

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
