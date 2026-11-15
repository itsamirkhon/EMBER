import type { Mission } from '../../core';
import { fmt, type Cliff, type Row } from './data';

interface Props {
  rows: Row[];
  missions: Mission[];
  cliff: Cliff;
}

/**
 * Accessible, static, scientifically scoped fallback when WebGL is unavailable.
 * Draws source-reported O2/pressure from solid-material flight experiments.
 * No invented jitter, outcome prediction, or implied flammability curve.
 */
export function EvidenceFallback({ rows, missions, cliff }: Props) {
  const observations = rows.filter(
    (r) =>
      r.phase === 'solid' &&
      r.gravityMode === 'actual_flight' &&
      r.o2 !== null && r.kPa !== null &&
      r.o2Prov !== 'assumed' && r.kPaProv !== 'assumed' &&
      r.o2 >= 10 && r.o2 <= 45 && r.kPa >= 30 && r.kPa <= 112,
  );

  const m = missions.find((x) => x.id === 'lunar-rover');
  const view = { left: 58, top: 50, width: 506, height: 278 };
  const x = (oxygen: number) => view.left + ((oxygen - 10) / 35) * view.width;
  const y = (pressure: number) => view.top + ((112 - pressure) / 82) * view.height;
  const marker = m?.o2Pct !== null && m?.o2Pct !== undefined && m?.pressureKpa !== null && m?.pressureKpa !== undefined
    ? { x: x(m.o2Pct), y: y(m.pressureKpa) }
    : null;

  return (
    <figure className="v3-focus-fallback" aria-label="Solid-material flight evidence versus a proposed lunar scenario">
      <svg viewBox="0 0 640 408" role="img"
        aria-label={'Recorded solid-material flight tests by oxygen and pressure. Reported oxygen ends at ' + fmt(cliff.o2Max) + ' percent in this subset; the lunar-rover scenario lies beyond it.'}>
        {([40, 70, 100] as const).map((pressure) => (
          <g key={pressure}>
            <line x1={view.left} x2={view.left + view.width}
              y1={y(pressure)} y2={y(pressure)} stroke="var(--v3-grid)" strokeWidth="1" />
            <text x="47" y={y(pressure) + 4} textAnchor="end" className="v3-focus-svg-tick">{pressure}</text>
          </g>
        ))}
        {([10, 20, 30, 40] as const).map((oxygen) => (
          <g key={oxygen}>
            <line x1={x(oxygen)} x2={x(oxygen)}
              y1={view.top} y2={view.top + view.height} stroke="var(--v3-grid)" strokeWidth="1" />
            <text x={x(oxygen)} y={view.top + view.height + 22} textAnchor="middle" className="v3-focus-svg-tick">{oxygen}</text>
          </g>
        ))}
        <text x={view.left} y="27" className="v3-focus-svg-tick">PRESSURE · kPa</text>
        <text x={view.left + view.width} y="386" textAnchor="end" className="v3-focus-svg-tick">OXYGEN · % BY VOLUME</text>

        {observations.map((r, i) => (
          <circle key={r.inv + '-' + r.testId + '-' + i} cx={x(r.o2 as number)} cy={y(r.kPa as number)}
            r="3.1" fill="var(--v3-solid)" opacity="0.48">
            <title>{r.inv + ' · ' + r.testId + ': ' + fmt(r.o2) + '% O₂ at ' + fmt(r.kPa) + ' kPa'}</title>
          </circle>
        ))}

        <line x1={x(cliff.o2Max)} x2={x(cliff.o2Max)}
          y1={view.top} y2={view.top + view.height}
          stroke="var(--v3-cliff-text)" strokeWidth="1.5" strokeDasharray="5 5" />
        <text x={x(cliff.o2Max) + 7} y={view.top + 10} className="v3-focus-svg-boundary">
          {fmt(cliff.o2Max)}% observed max
        </text>

        {marker && (
          <g>
            <circle cx={marker.x} cy={marker.y} r="8" fill="var(--v3-surface)"
              stroke="var(--v3-text)" strokeWidth="2" />
            <circle cx={marker.x} cy={marker.y} r="2.3" fill="var(--v3-text)" />
            <text x={marker.x + 13} y={marker.y - 12} className="v3-focus-svg-scenario">
              Lunar scenario
            </text>
            <text x={marker.x + 13} y={marker.y + 5} className="v3-focus-svg-tick">
              not a flight test
            </text>
          </g>
        )}
      </svg>
      <figcaption>
        <b>{observations.length} plottable solid-material flight records.</b>{' '}
        Points can overlap. Only reported atmospheric conditions are shown; omitted records
        have missing or assumed values. The dashed line is a data boundary, not a fire limit.
      </figcaption>
    </figure>
  );
}
