/** Lightweight helpers for Ask EMBER (kept separate so the SDK can be lazy-loaded). */
export const LLM_MODEL = 'gpt-6-luna';
export const NO_EVIDENCE = 'No evidence in PSI corpus.';

/** Split text into plain segments and [id] citations; mark citations not in `allowed`. */
export function parseCitations(text: string, allowed: Set<string>): { text: string; cite?: string; valid?: boolean }[] {
  const out: { text: string; cite?: string; valid?: boolean }[] = [];
  const re = /\[([^\]\s]+(?:\s*,\s*[^\]\s]+)*)\]/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) });
    for (const id of m[1].split(/\s*,\s*/)) out.push({ text: id, cite: id, valid: allowed.has(id) });
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
