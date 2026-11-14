import type { ProtocolStep, TestEvent } from '../api/types';
import { Badge, Quote, Sv, pretty } from './ui';

type Item = { key: string; order: number; kind: 'step' | 'event'; title: string; label: string; time: ProtocolStep['time_s']; ref: ProtocolStep['source_ref'] };

/** Timeline of steps and events. Time is only displayed when known; otherwise the word "unknown". */
export function Timeline({ steps, events }: { steps: ProtocolStep[]; events: TestEvent[] }) {
  const items: Item[] = [
    ...steps.map((s): Item => ({ key: `s${s.order}`, order: s.order * 10, kind: 'step', title: s.description, label: s.kind, time: s.time_s, ref: s.source_ref })),
    ...events.map((e, i): Item => ({ key: `e${i}`, order: (e.step_order ?? 999) * 10 + 5, kind: 'event', title: pretty(e.kind), label: 'event', time: e.time_s, ref: e.source_ref })),
  ].sort((a, b) => a.order - b.order);
  if (!items.length) return <p className="muted">No protocol steps or events recorded.</p>;
  return (
    <ol className="timeline" aria-label="Protocol timeline">
      {items.map((it) => (
        <li key={it.key} className={`${it.kind}${it.time.kind === 'unknown' ? ' unk' : ''}`}>
          <div className="row"><strong>{it.title}</strong><Badge tone={it.kind === 'event' ? 'info' : ''}>{pretty(it.label)}</Badge></div>
          <div className="small muted">Time: <Sv v={it.time} showKind={false} /></div>
          {it.ref ? <Quote s={it.ref} /> : <div className="small dim">source: not cited</div>}
        </li>
      ))}
    </ol>
  );
}
