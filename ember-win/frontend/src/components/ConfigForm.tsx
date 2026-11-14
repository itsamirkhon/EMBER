import { useEffect, useState } from 'react';
import type { Endpoint, Environment, QueryConfig, ResearchQuery } from '../api/types';
import { Field } from './ui';

export const ENVIRONMENTS: Environment[] = ['iss', 'gateway', 'lunar_base', 'mars_transit', 'rover', 'other'];
export const ENDPOINTS: Endpoint[] = ['ignition', 'flame_establishment', 'sustained_spread', 'extinction_under_flow_reduction', 'cool_burning', 'smoke_detection', 'suppression'];
const label = (s: string) => s.replace(/_/g, ' ');

function NumField({ id, label: l, value, onChange, unit, step = 'any' }: { id: string; label: string; value: number | null; onChange: (n: number | null) => void; unit: string; step?: string }) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => { setText((t) => (Number(t) === value && t !== '' ? t : value === null ? '' : String(value))); }, [value]);
  return (
    <Field id={id} label={`${l} (${unit})`} unknown={value === null} hint={value === null ? 'Unknown: left blank on purpose' : undefined}>
      <input id={id} inputMode="decimal" type="number" step={step} placeholder="unknown" value={text}
        onChange={(e) => { setText(e.target.value); const n = e.target.value === '' ? null : Number(e.target.value); onChange(n === null || Number.isNaN(n) ? null : n); }} />
    </Field>
  );
}
function TextField({ id, label: l, value, onChange, list, options }: { id: string; label: string; value: string | null; onChange: (s: string | null) => void; list?: string; options?: string[] }) {
  return (
    <Field id={id} label={l} unknown={value === null}>
      <input id={id} list={list} placeholder="unknown" value={value ?? ''} onChange={(e) => onChange(e.target.value.trim() === '' ? null : e.target.value)} />
      {list && <datalist id={list}>{options?.map((o) => <option key={o} value={o} />)}</datalist>}
    </Field>
  );
}
function SelectField({ id, label: l, value, options, onChange }: { id: string; label: string; value: string | null; options: string[]; onChange: (s: string | null) => void }) {
  return (
    <Field id={id} label={l} unknown={value === null}>
      <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}>
        <option value="">unknown</option>
        {options.map((o) => <option key={o} value={o}>{label(o)}</option>)}
      </select>
    </Field>
  );
}

export function ConfigForm({ query, onChange, idPrefix = 'cfg' }: { query: ResearchQuery; onChange: (q: ResearchQuery) => void; idPrefix?: string }) {
  const c = query.config;
  const setC = (patch: Partial<QueryConfig>) => onChange({ ...query, config: { ...c, ...patch } });
  const id = (s: string) => `${idPrefix}-${s}`;
  return (
    <div className="stack">
      <div className="fields">
        <Field id={id('env')} label="Environment" hint="Required by the backend">
          <select id={id('env')} value={query.environment} onChange={(e) => onChange({ ...query, environment: e.target.value as Environment })}>
            {ENVIRONMENTS.map((o) => <option key={o} value={o}>{label(o)}</option>)}
          </select>
        </Field>
        <SelectField id={id('endpoint')} label="Endpoint of interest" value={query.endpoint} options={ENDPOINTS} onChange={(v) => onChange({ ...query, endpoint: v as Endpoint | null })} />
        <SelectField id={id('topic')} label="Topic" value={query.topic} options={['prevention', 'detection', 'suppression']} onChange={(v) => onChange({ ...query, topic: v })} />
      </div>
      <div className="fields">
        <TextField id={id('material')} label="Material" value={c.material} list={id('materials')} options={['PMMA', 'silicone', 'cellulose']} onChange={(v) => setC({ material: v })} />
        <TextField id={id('shape')} label="Shape" value={c.shape} list={id('shapes')} options={['flat_sheet', 'cylinder', 'wire']} onChange={(v) => setC({ shape: v })} />
        <NumField id={id('thick')} label="Thickness" unit="mm" value={c.thickness_mm} onChange={(n) => setC({ thickness_mm: n })} />
        <NumField id={id('o2')} label="O2 fraction" unit="0 to 1" step="0.01" value={c.o2_fraction} onChange={(n) => setC({ o2_fraction: n })} />
        <NumField id={id('pressure')} label="Pressure" unit="kPa" value={c.pressure_kpa} onChange={(n) => setC({ pressure_kpa: n })} />
        <SelectField id={id('grav')} label="Gravity regime" value={c.gravity_regime} options={['microgravity', 'partial', 'normal']} onChange={(v) => setC({ gravity_regime: v })} />
        <SelectField id={id('flowdir')} label="Flow direction" value={c.flow_direction} options={['concurrent', 'opposed', 'quiescent']} onChange={(v) => setC({ flow_direction: v as QueryConfig['flow_direction'] })} />
        <NumField id={id('flowvel')} label="Flow velocity" unit="cm/s" value={c.flow_velocity_cm_s} onChange={(n) => setC({ flow_velocity_cm_s: n })} />
        <TextField id={id('ign')} label="Ignition" value={c.ignition} onChange={(v) => setC({ ignition: v })} />
        <SelectField id={id('o2role')} label="O2 role" value={c.o2_role} options={['ambient', 'oxidizer_stream']} onChange={(v) => setC({ o2_role: v as QueryConfig['o2_role'] })} />
        <TextField id={id('substrate')} label="Substrate / confinement" value={c.substrate} onChange={(v) => setC({ substrate: v })} />
        <SelectField id={id('flowhist')} label="Flow history" value={c.flow_history} options={['constant', 'stepwise_reduction', 'continuous_ramp']} onChange={(v) => setC({ flow_history: v as QueryConfig['flow_history'] })} />
      </div>
    </div>
  );
}
export const emptyQuery = (question = ''): ResearchQuery => ({
  question, environment: 'iss', topic: null, endpoint: null,
  config: { material: null, shape: null, thickness_mm: null, o2_fraction: null, pressure_kpa: null, gravity_regime: null, flow_direction: null, flow_velocity_cm_s: null, ignition: null, o2_role: null, substrate: null, flow_history: null },
});
