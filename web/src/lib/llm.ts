/**
 * Optional LLM synthesis for Ask EMBER. Uses either the key from web/.env through the dev/preview server
 * proxy (server/llmProxy.ts; the key never reaches the browser) or the user's own OpenAI key pasted in the
 * browser (never stored beyond memory / sessionStorage). The model only sees retrieved PSI claims and
 * must cite them; the UI then verifies every citation against the retrieved set.
 */
import { LLM_MODEL, NO_EVIDENCE } from './citations';
import type { Hit } from './retrieval';

const ENDPOINT = 'https://api.openai.com/v1/chat/completions';
const PROXY = 'api/llm/chat';

/** True when the dev/preview server holds an OPENAI_API_KEY from web/.env. False on static hosting. */
export async function serverKeyAvailable(): Promise<boolean> {
  try {
    const res = await fetch('api/llm/status');
    if (!res.ok || !res.headers.get('content-type')?.includes('json')) return false;
    return ((await res.json()) as { enabled?: boolean }).enabled === true;
  } catch {
    return false;
  }
}

const SYSTEM = `You are EMBER, a fire-safety evidence assistant for spacecraft and habitat engineers.
You answer ONLY from the numbered evidence items supplied by the user (claims extracted from NASA PSI combustion investigations and their reports).
Rules:
- Every sentence that states a fact must end with one or more citations in square brackets using the exact evidence ids, e.g. [c-0012] or [card:BASS-II].
- Do not use outside knowledge, do not invent numbers, and do not cite ids that are not in the evidence list.
- If the evidence does not answer the question, reply with exactly: ${NO_EVIDENCE}
- If the evidence answers only part of the question, answer that part and say plainly what is not covered.
- Flag when evidence comes from a different fuel phase, gravity level or pressure than the question asks about.
- Plain text, at most 150 words.`;

export function buildPrompt(question: string, hits: Hit[]): string {
  const evidence = hits
    .map((h) => `[${h.doc.id}] (investigation: ${h.doc.inv ?? 'n/a'}) ${h.doc.kind === 'card' ? h.doc.quote ?? h.doc.text : h.doc.text}`)
    .join('\n');
  return `Evidence:\n${evidence}\n\nQuestion: ${question}`;
}

export interface LlmResult {
  text: string;
  refused: boolean;
}

export class LlmError extends Error {
  constructor(
    readonly status: number | null,
    message: string,
  ) {
    super(message);
  }
}

/** `apiKey` null -> go through the server proxy, which adds the key from web/.env. */
export async function synthesize(apiKey: string | null, question: string, hits: Hit[], onText: (delta: string) => void): Promise<LlmResult> {
  let res: Response;
  try {
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: buildPrompt(question, hits) },
    ];
    res = apiKey
      ? await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ model: LLM_MODEL, stream: true, max_completion_tokens: 4000, messages }),
        })
      : await fetch(PROXY, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ messages }),
        });
  } catch (e) {
    throw new LlmError(null, String(e));
  }
  if (!res.ok || !res.body) {
    let msg = res.statusText;
    try {
      msg = ((await res.json()) as { error?: { message?: string } }).error?.message ?? msg;
    } catch {
      /* non-JSON error body */
    }
    throw new LlmError(res.status, msg);
  }

  // Server-sent events: lines of `data: {json}` terminated by `data: [DONE]`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let text = '';
  let refused = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.trim().replace(/^data:\s*/, '');
      if (!line.trim().startsWith('data:') || data === '[DONE]') continue;
      let chunk;
      try {
        chunk = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = chunk.choices?.[0]?.delta;
      if (delta?.refusal) refused = true;
      if (delta?.content) {
        text += delta.content;
        onText(delta.content);
      }
    }
  }
  return { text, refused: refused && !text };
}

export function describeError(e: unknown): string {
  if (!(e instanceof LlmError)) return String(e);
  switch (e.status) {
    case null:
      return 'Could not reach the OpenAI API (network or CORS).';
    case 401:
      return 'The API key was rejected (401). Check the key and try again.';
    case 403:
      return `This key does not have access to ${LLM_MODEL} (403).`;
    case 404:
      return `Model ${LLM_MODEL} was not found for this key (404).`;
    case 429:
      return `Rate limited or out of quota (429): ${e.message}`;
    case 400:
      return `Request rejected (400): ${e.message}`;
    default:
      return `API error ${e.status}: ${e.message}`;
  }
}
