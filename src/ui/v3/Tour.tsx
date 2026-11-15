import { Link, useLocation, useNavigate } from 'react-router-dom';

/** A two-minute guided path through the four screens a judge needs. Steps live in the URL (?tour=n). */
export const TOUR_STEPS: { path: string; title: string; text: string }[] = [
  {
    path: '/map',
    title: 'The finding',
    text: 'Every NASA PSI flight test placed by oxygen and pressure. No solid-material flight test ran above the red line; the cabins planned for the Moon sit to its right.',
  },
  {
    path: '/lens?mission=lunar-rover&material=PMMA',
    title: 'One cabin, one material',
    text: 'A PMMA lining in a pressurized lunar rover (30% O₂, 70.3 kPa, 0.166 g). EMBER runs all records through nine applicability rules and says plainly whether any flight test covers it.',
  },
  {
    path: '/lens',
    title: 'The nearest real tests',
    text: 'Instead of a guess, the three closest flight records, the gap on every axis, and a link to the exact row in the NASA PSI table.',
  },
  {
    path: '/lens',
    title: 'The evidence still needed',
    text: 'Which gap is largest, measured in rule tolerances, and what kind of test would close it. A pointer to missing data, not a test procedure.',
  },
  {
    path: '/trust',
    title: 'How far to trust it',
    text: 'The same rules checked against held-out NASA tests next to a simple baseline, including where EMBER does worse.',
  },
];

export const TOUR_ANCHORS: Record<number, string> = { 3: 'near-h', 4: 'next-h' };

export function tourHref(step: number): string {
  const s = TOUR_STEPS[step - 1];
  return `${s.path}${s.path.includes('?') ? '&' : '?'}tour=${step}`;
}

export function useTourStep(): number | null {
  const loc = useLocation();
  const raw = new URLSearchParams(loc.search).get('tour');
  const n = raw ? Number(raw) : NaN;
  return Number.isInteger(n) && n >= 1 && n <= TOUR_STEPS.length ? n : null;
}

export function TourBar() {
  const step = useTourStep();
  const nav = useNavigate();
  if (!step) return null;
  const s = TOUR_STEPS[step - 1];
  const last = step === TOUR_STEPS.length;
  return (
    <aside className="v3-tour" aria-label="Judges’ tour">
      <div className="v3-tour-inner">
        <div className="v3-tour-step">
          Tour · step {step} of {TOUR_STEPS.length}
        </div>
        <div className="v3-tour-body">
          <b>{s.title}.</b> {s.text}
        </div>
        <div className="v3-tour-actions">
          {step > 1 && (
            <button type="button" className="v3-btn v3-btn-ghost" onClick={() => nav(tourHref(step - 1))}>
              Back
            </button>
          )}
          {last ? (
            <Link to="/trust" className="v3-btn v3-btn-primary" replace>
              End tour
            </Link>
          ) : (
            <button type="button" className="v3-btn v3-btn-primary" onClick={() => nav(tourHref(step + 1))}>
              Next
            </button>
          )}
        </div>
      </div>
    </aside>
  );
}
