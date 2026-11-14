import { useMemo } from 'react';
import { scenarioFromMission, useData, useEmber, type Scenario } from '../data/context';
import { kpaToPsi } from '../lib/evidence';
import type { FuelPhase } from '../lib/types';
import { AtmosphereBar } from './Charts';
import { fmtGravity, fmtNum, SourceLink, Term } from './ui';

const ORDER = ['iss', 'spacecraft', 'lunar-base', 'lunar-rover', 'mars-base', 'eva-suit'];

export function flowText(s: Pick<Scenario, 'flowMin' | 'flowMax'>) {
  return s.flowMin === s.flowMax ? `${fmtNum(s.flowMin)} cm/s` : `${fmtNum(s.flowMin)}–${fmtNum(s.flowMax)} cm/s`;
}

export default function ScenarioEditor() {
  const { scenario: s, setScenario } = useEmber();
  const { missions, tests } = useData();
  const sorted = useMemo(
    () => {
      const rank = (id: string) => (ORDER.includes(id) ? ORDER.indexOf(id) : 99);
      return [...missions].sort((a, b) => rank(a.id) - rank(b.id));
    },
    [missions],
  );
  const mission = missions.find((m) => m.id === s.missionId);
  const materials = useMemo(() => {
    const set = new Set<string>();
    for (const t of tests) if (t.fuel && (s.fuelPhase === 'any' || t.fuelPhase === s.fuelPhase)) set.add(t.fuel);
    return [...set].sort();
  }, [tests, s.fuelPhase]);
  const set = (patch: Partial<Scenario>) => setScenario((p) => ({ ...p, ...patch }));
  const setCustom = (patch: Partial<Scenario>) => setScenario((p) => ({ ...p, ...patch, missionId: 'custom' }));
  const num = (v: string, fallback: number) => (v.trim() === '' || Number.isNaN(Number(v)) ? fallback : Number(v));

  return (
    <section className="card" aria-labelledby="env-h">
      <h2 id="env-h">1. Environment</h2>
      <div className="mission-grid" role="group" aria-label="Habitat environment">
        {sorted.map((m) => (
          <button
            key={m.id}
            type="button"
            className="mission-btn"
            aria-pressed={s.missionId === m.id}
            onClick={() => setScenario((p) => scenarioFromMission(m, p))}
          >
            <span className="m-label">{m.label}</span>
            <span className="m-sub">
              {fmtNum(m.o2Pct)}% O₂ · {m.pressureKpa !== null ? `${kpaToPsi(m.pressureKpa).toFixed(1)} psi` : '—'}
            </span>
          </button>
        ))}
        <button type="button" className="mission-btn" aria-pressed={s.missionId === 'custom'} onClick={() => set({ missionId: 'custom' })}>
          <span className="m-label">Custom</span>
          <span className="m-sub">set conditions</span>
        </button>
      </div>

      {mission && (
        <div className="small" style={{ marginTop: 10 }}>
          {mission.assumption && (
            <span className="tag" style={{ marginRight: 6, color: 'var(--warning)' }}>
              assumed values
            </span>
          )}
          <span className="muted">{mission.notes}</span>{' '}
          {mission.sources.map((src, i) => (
            <span key={i}>
              {i > 0 && ' · '}
              <SourceLink source={src} />
            </span>
          ))}
        </div>
      )}

      <div className="inline-fields" style={{ marginTop: 12 }}>
        <label>
          <span className="small muted">
            <Term k="o2">O₂</Term> %
          </span>
          <input type="number" step="0.5" min="0" max="100" value={s.o2Pct} onChange={(e) => setCustom({ o2Pct: num(e.target.value, s.o2Pct) })} />
        </label>
        <label>
          <span className="small muted">
            Pressure <Term k="kpa">kPa</Term>
          </span>
          <input type="number" step="0.1" min="1" max="200" value={s.pressureKpa} onChange={(e) => setCustom({ pressureKpa: num(e.target.value, s.pressureKpa) })} />
        </label>
        <label>
          <span className="small muted">
            <Term k="flow">Flow</Term> min cm/s
          </span>
          <input type="number" step="1" min="0" value={s.flowMin} onChange={(e) => setCustom({ flowMin: num(e.target.value, s.flowMin) })} />
        </label>
        <label>
          <span className="small muted">Flow max cm/s</span>
          <input type="number" step="1" min="0" value={s.flowMax} onChange={(e) => setCustom({ flowMax: num(e.target.value, s.flowMax) })} />
        </label>
        <label>
          <span className="small muted">
            Gravity <Term k="g">g</Term>
          </span>
          <input type="number" step="0.01" min="0" max="1" value={s.gravityG} onChange={(e) => setCustom({ gravityG: num(e.target.value, s.gravityG) })} />
        </label>
      </div>
      <p className="small muted" style={{ marginTop: 6, marginBottom: 0 }}>
        = {fmtNum(s.o2Pct)}% O₂ at {kpaToPsi(s.pressureKpa).toFixed(1)} <Term k="psi">psi</Term>, flow {flowText(s)}, {fmtGravity(s.gravityG)}
      </p>

      <div style={{ marginTop: 14 }}>
        <AtmosphereBar o2Pct={s.o2Pct} pressureKpa={s.pressureKpa} />
      </div>

      <h2 style={{ marginTop: 26 }}>2. Material</h2>
      <div className="inline-fields">
        <label>
          <span className="small muted">
            <Term k="phase">Fuel phase</Term>
          </span>
          <select value={s.fuelPhase} onChange={(e) => set({ fuelPhase: e.target.value as FuelPhase | 'any', material: '' })}>
            <option value="solid">Solid (fabric, plastic, lining)</option>
            <option value="liquid">Liquid (droplets, fluids)</option>
            <option value="gas">Gas (burner flames)</option>
            <option value="any">Any phase</option>
          </select>
        </label>
        <label>
          <span className="small muted">Material in the tests</span>
          <select value={s.material} onChange={(e) => set({ material: e.target.value })}>
            <option value="">Any {s.fuelPhase === 'any' ? '' : s.fuelPhase} material</option>
            {materials.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span className="small muted">Your label</span>
          <input type="text" value={s.materialLabel} onChange={(e) => set({ materialLabel: e.target.value })} />
        </label>
      </div>
    </section>
  );
}
