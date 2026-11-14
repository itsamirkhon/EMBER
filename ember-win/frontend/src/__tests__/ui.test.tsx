import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { Timeline } from '../components/Timeline';
import { Sv } from '../components/ui';
import { EvalBody } from '../pages/Eval';
import { App } from '../App';
import { api } from '../api/client';
import { unknownSV } from '../api/parse';
import { loadDemoReviewId } from '../pages/Landing';

const FORBIDDEN = /\b(caused by|causes|proves?|proven|due to the change)\b/i;

describe('behaviour', () => {
  it('renders unknown ScientificValue as the word unknown', () => {
    render(<Sv v={unknownSV()} />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
  it('timeline shows time only when known', () => {
    render(<Timeline
      steps={[{ order: 1, kind: 'ignition', description: 'Ignite', time_s: { kind: 'reported', value: 2, unit: 's', role: null, source_ref: null }, source_ref: null },
        { order: 2, kind: 'flow_change', description: 'Flow down', time_s: unknownSV(), source_ref: null }]} events={[]} />);
    expect(screen.getByText(/2 s/)).toBeInTheDocument();
    expect(screen.getAllByText('unknown').length).toBeGreaterThanOrEqual(1);
  });
  it('eval page says "not measured" and shows the preliminary disclaimer', () => {
    render(<EvalBody d={{ status: 'not_measured', metrics: [{ name: 'Recall', status: 'not_measured' }, { name: 'Other' }] }} />);
    expect(screen.getAllByText('not measured').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/Preliminary team evaluation/)).toBeInTheDocument();
  });
  it('picks the saved example for the demo', () => {
    expect(loadDemoReviewId([{ id: 'a', mode: 'deterministic' }, { id: 'b', mode: 'saved_example' }])).toBe('b');
    expect(loadDemoReviewId([])).toBeNull();
  });
  it('causation wording is absent from contrast statements and the comparison page', async () => {
    const rev = await api.review('rev_example_bass2');
    for (const c of rev.contrasts) expect(c.statement).not.toMatch(FORBIDDEN);
    render(<MemoryRouter initialEntries={['/r/rev_example_bass2/compare']}><App /></MemoryRouter>);
    await waitFor(() => expect(screen.getByText('Contrasts')).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(FORBIDDEN);
    expect(screen.getAllByText('Allowed contrast').length + screen.queryAllByText('Not allowed').length).toBeGreaterThan(0);
  });
  it('shows error envelopes visibly', async () => {
    render(<MemoryRouter initialEntries={['/r/does-not-exist']}><App /></MemoryRouter>);
    expect(await screen.findByRole('alert')).toHaveTextContent(/not_found/);
  });
});
