import { parsePartialJson } from 'ai';
import { buildSynthesisContext, enforceDescriptiveBoundary, parseSynthesisClaims, validateAuthorAttribution } from '../src/core/synthesisContract';
import { verifySynthesis } from '../src/core/verifier';
import { readSseData, type ClaimSection, type ReviewProgress } from '../src/core/reviewStream';
import type { EvidencePackage, GeneratedSynthesis } from '../src/core/types';

/** Only completed, individually checked claims leave the server. Whole-answer checks still run at EOF. */
export async function consumeSynthesisStream(response: Response, pkg: EvidencePackage, draft: GeneratedSynthesis, emit: (event: ReviewProgress) => void): Promise<string> {
  // Compatibility with older proxies and injected non-streaming test providers.
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? '';
  }
  if (!response.body) throw new Error('Missing synthesis stream');
  const allowed = buildSynthesisContext(pkg, draft).allowedCitationIds;
  const sent = new Set<string>();
  let raw = '';
  let finished = false;
  async function preview() {
    const parsed = await parsePartialJson(raw);
    if (!parsed.value || typeof parsed.value !== 'object' || Array.isArray(parsed.value)) return;
    const data = parsed.value as Record<string, unknown>;
    const keys = Object.keys(data);
    for (const section of ['observedFact', 'authorInterpretation', 'engineeringImplication'] as ClaimSection[]) {
      const list = data[section];
      if (!Array.isArray(list)) continue;
      // A repaired final item might still have an unfinished string or object.
      // Only items followed by another item/top-level key, or a complete JSON document, are candidates.
      const closed = parsed.state === 'successful-parse' || keys.indexOf(section) < keys.length - 1;
      for (const candidate of closed ? list : list.slice(0, -1)) {
        const key = `${section}:${JSON.stringify(candidate)}`;
        if (sent.has(key)) continue;
        sent.add(key);
        try {
          const [claim] = parseSynthesisClaims([candidate], allowed, new Set(), section);
          const synthesis: GeneratedSynthesis = { ...draft, mode: 'LIVE_AI', observedFact: [], authorInterpretation: [], engineeringImplication: [], rawSummary: '', [section]: [claim] };
          validateAuthorAttribution(synthesis, pkg);
          enforceDescriptiveBoundary(synthesis);
          if (verifySynthesis(synthesis, pkg).passed) emit({ type: 'claim', section, claim });
        } catch {
          // Invalid partial claims remain private; final parsing determines the fallback.
        }
      }
    }
  }
  for await (const data of readSseData(response.body, 1_000_000)) {
    if (data === '[DONE]') { finished = true; break; }
    const chunk = JSON.parse(data);
    if (chunk.error) throw new Error('Provider stream failed');
    const choice = chunk.choices?.[0];
    if (choice?.finish_reason && choice.finish_reason !== 'stop') throw new Error('Incomplete synthesis');
    const delta = choice?.delta?.content;
    if (typeof delta !== 'string') continue;
    raw += delta;
    if (raw.length > 1_000_000) throw new Error('Synthesis exceeds limit');
    if (/[}\],]/.test(delta)) await preview();
  }
  if (!finished) throw new Error('Synthesis stream interrupted');
  await preview();
  return raw;
}
