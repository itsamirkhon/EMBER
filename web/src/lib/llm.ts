/**
 * Optional LLM synthesis for Ask EMBER. Runs entirely in the browser with the user's own key
 * (never stored beyond memory / sessionStorage). The model only sees retrieved PSI claims and
 * must cite them; the UI then verifies every citation against the retrieved set.
 */
import Anthropic from '@anthropic-ai/sdk';
import { LLM_MODEL, NO_EVIDENCE } from './citations';
import type { Hit } from './retrieval';

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

export async function synthesize(apiKey: string, question: string, hits: Hit[], onText: (delta: string) => void): Promise<LlmResult> {
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const stream = client.messages.stream({
    model: LLM_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium' },
    system: SYSTEM,
    messages: [{ role: 'user', content: buildPrompt(question, hits) }],
  });
  stream.on('text', onText);
  const msg = await stream.finalMessage();
  if (msg.stop_reason === 'refusal') return { text: '', refused: true };
  const text = msg.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
  return { text, refused: false };
}

export function describeError(e: unknown): string {
  if (e instanceof Anthropic.AuthenticationError) return 'The API key was rejected (401). Check the key and try again.';
  if (e instanceof Anthropic.PermissionDeniedError) return 'This key does not have access to the model (403).';
  if (e instanceof Anthropic.NotFoundError) return `Model ${LLM_MODEL} was not found for this key (404).`;
  if (e instanceof Anthropic.RateLimitError) return 'Rate limited (429). Wait a moment and retry.';
  if (e instanceof Anthropic.BadRequestError) return `Request rejected (400): ${e.message}`;
  if (e instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API (network or CORS).';
  if (e instanceof Anthropic.APIError) return `API error ${e.status ?? ''}: ${e.message}`;
  return String(e);
}

