import { Link } from 'react-router-dom';
import { useData } from '../data/context';
import { DirectionTags, PageHead } from '../components/ui';

const FAMILIES: { id: string; title: string; text: string }[] = [
  { id: 'ACME-CIR', title: 'ACME in the Combustion Integrated Rack', text: 'Advanced Combustion via Microgravity Experiments: gaseous-fuel flames on one modular insert (e.g. Burning Rate Emulator, CFI-G, E-FIELD Flames).' },
  { id: 'MDCA-CIR', title: 'MDCA in the Combustion Integrated Rack', text: 'Multi-user Droplet Combustion Apparatus: isolated burning droplets of liquid fuel (FLEX, FLEX-2, CFI).' },
  { id: 'MSG-SPICE', title: 'Microgravity Science Glovebox with the SPICE flow duct', text: 'Solid and gaseous fuels in a small flow duct with controlled velocity (BASS, BASS-II, SPICE, SLICE).' },
  { id: 'Saffire-Cygnus', title: 'Saffire in Cygnus', text: 'Large-scale spacecraft fire experiments flown in an uncrewed Cygnus vehicle after it leaves the ISS.' },
  { id: 'SAME-MSG', title: 'SAME smoke experiments in the glovebox', text: 'Smoke Aerosol Measurement Experiment: particle size from overheated materials, for detector design (SAME, SAME-R).' },
  { id: 'other', title: 'Other hardware', text: 'Investigations that do not belong to one of the challenge’s hardware families.' },
];

export default function Families() {
  const { investigations } = useData();
  const known = new Set(FAMILIES.map((f) => f.id));
  const extra = [...new Set(investigations.map((i) => i.family))].filter((f) => !known.has(f));
  const all = [...FAMILIES, ...extra.map((id) => ({ id, title: id, text: '' }))];
  return (
    <>
      <PageHead eyebrow="Module 4.3" title="Hardware families">
        <p>
          Results from the same apparatus are directly comparable: same sample holders, flow control and diagnostics. Across families,
          compare trends, not numbers.
        </p>
      </PageHead>
      <div className="grid grid-2">
        {all.map((f) => {
          const members = investigations.filter((i) => i.family === f.id);
          if (!members.length && f.id === 'other') return null;
          return (
            <section key={f.id} className="card">
              <div className="eyebrow">{f.id}</div>
              <h2>{f.title}</h2>
              {f.text && <p className="small muted">{f.text}</p>}
              {members.length === 0 ? (
                <p className="small muted">No investigations from this family in the current dataset.</p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {members.map((m) => (
                    <li key={m.id} className="row" style={{ padding: '6px 0', borderTop: '1px solid var(--border)' }}>
                      <Link to={`/investigations/${encodeURIComponent(m.id)}`}>{m.id}</Link>
                      <span className="small muted">{m.fuelPhase ?? '?'} · {m.nTests ?? '?'} tests</span>
                      <DirectionTags dirs={m.direction} />
                    </li>
                  ))}
                </ul>
              )}
              {members.length >= 2 && (
                <p className="small" style={{ marginTop: 8, marginBottom: 0 }}>
                  <Link to={`/compare?ids=${members.slice(0, 3).map((m) => encodeURIComponent(m.id)).join(',')}`}>Compare within family →</Link>
                </p>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}
