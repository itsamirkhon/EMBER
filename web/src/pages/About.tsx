import { Link } from 'react-router-dom';
import { useData } from '../data/context';
import { PageHead } from '../components/ui';

export default function About() {
  const { investigations, tests, claims, missions, manifest, fixtureFiles, missingFiles } = useData();
  return (
    <>
      <PageHead eyebrow="About" title="About EMBER and its data">
        <p>
          EMBER (Evidence Map for Burn &amp; Extinction Risk) turns NASA microgravity combustion experiments into answers to
          fire-safety design questions, and says honestly where the data ends. Built for NASA Space Apps Challenge 2026, “Flame in
          Freefall”.
        </p>
      </PageHead>
      <div className="grid grid-2">
        <section className="card">
          <h2>Data sources</h2>
          <ul style={{ paddingLeft: 18 }}>
            <li>
              <a href="https://psi.nasa.gov/" target="_blank" rel="noreferrer">NASA Physical Sciences Informatics (PSI)</a>: investigation
              metadata, test matrices and data files (CC0-1.0 for reviewed records).
            </li>
            <li>
              <a href="https://ntrs.nasa.gov/" target="_blank" rel="noreferrer">NASA Technical Reports Server (NTRS)</a>: reports and papers
              used for claims and key findings.
            </li>
            <li>NASA Glenn combustion science pages, the ISS Researcher’s Guide to combustion science, and NASA Spinoff (Back to Earth).</li>
          </ul>
          <p className="small muted">
            Current dataset: {investigations.length} investigations, {tests.length} test rows, {claims.length} claims, {missions.length} mission
            profiles{manifest ? `, manifest generated ${manifest.generatedAt}` : ''}.
          </p>
          {fixtureFiles.length > 0 && <p className="small">Fixture (synthetic) files in use: {fixtureFiles.join(', ')}.</p>}
          {missingFiles.length > 0 && <p className="small">Missing files: {missingFiles.join(', ')}.</p>}
          <h3>Investigations</h3>
          <ul className="small" style={{ paddingLeft: 18, columns: 2 }}>
            {investigations.map((i) => (
              <li key={i.id}>
                <Link to={`/investigations/${encodeURIComponent(i.id)}`}>{i.id}</Link>
                {i.psiUrl && (
                  <>
                    {' '}
                    (<a href={i.psiUrl} target="_blank" rel="noreferrer">{i.psi}</a>)
                  </>
                )}
              </li>
            ))}
          </ul>
        </section>
        <section className="card">
          <h2>Principles</h2>
          <ul style={{ paddingLeft: 18 }}>
            <li>Unknown values stay empty. Nothing is invented; every fact traces to a PSI or NTRS source.</li>
            <li>Every answer carries a status: Measured, Interpolated or Extrapolated; every finding is Known, Extrapolating or Unknown.</li>
            <li>AI extracts and summarizes, and never answers without a citation. Ranking is a transparent formula, not AI.</li>
            <li>EMBER checks itself in public: see <Link to="/trust">How far to trust us</Link>.</li>
          </ul>
          <h3>Units</h3>
          <p className="small">
            O₂ in % by volume, pressure in kPa (psi shown alongside), flow in cm/s, flame spread in mm/s, droplet burning-rate constant in
            mm²/s, diameters in mm, gravity in g (0 = microgravity).
          </p>
          <h3>Out of scope</h3>
          <p className="small">Rocket propulsion and propellant fire safety (excluded by the challenge). EMBER is not a certification tool.</p>
        </section>
      </div>
    </>
  );
}
