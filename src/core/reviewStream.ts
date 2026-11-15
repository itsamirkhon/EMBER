import type { SynthesisClaimItem } from './types';

export type ClaimSection = 'observedFact' | 'authorInterpretation' | 'engineeringImplication';
export type ReviewProgress =
  | { type: 'stage'; stage: string }
  | { type: 'claim'; section: ClaimSection; claim: SynthesisClaimItem };

/** SSE framing shared by provider consumption and the browser; preserve UTF-8 across reads. */
export async function* readSseData(body: ReadableStream<Uint8Array>, maxFrameLength = 32_000_000): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (buffer.length > maxFrameLength) throw new Error('Event stream frame exceeds limit');
      let match: RegExpExecArray | null;
      while ((match = /\r?\n\r?\n/.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
        if (data) yield data;
      }
      if (done) {
        if (buffer.trim()) throw new Error('Incomplete event stream');
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
