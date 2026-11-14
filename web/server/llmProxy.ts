/**
 * Vite dev/preview middleware that lets Ask EMBER use an OpenAI key from `web/.env` (OPENAI_API_KEY)
 * without the key ever reaching the browser or the static build.
 *
 *   GET  /api/llm/status  -> { enabled, model }
 *   POST /api/llm/chat    -> forwards { messages } to OpenAI Chat Completions and streams the reply back
 *
 * The proxy fixes the model and caps the output length, so it cannot be used as a general OpenAI relay
 * (relevant when the dev server is exposed, e.g. through ngrok). GitHub Pages has no server, so the
 * deployed site keeps the paste-your-own-key field.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { Plugin } from 'vite';
import { loadEnv } from 'vite';
import { LLM_MODEL } from '../src/lib/citations';

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const MAX_BODY_BYTES = 64 * 1024;
const MAX_COMPLETION_TOKENS = 4000;

type Next = (err?: unknown) => void;

function sendJson(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function handler(apiKey: string | undefined) {
  return async (req: IncomingMessage, res: ServerResponse, next: Next) => {
    const path = req.url?.split('?')[0];
    if (path === '/api/llm/status' && req.method === 'GET') {
      return sendJson(res, 200, { enabled: !!apiKey, model: LLM_MODEL });
    }
    if (path !== '/api/llm/chat') return next();
    if (req.method !== 'POST') return sendJson(res, 405, { error: { message: 'POST only' } });
    if (!apiKey) return sendJson(res, 503, { error: { message: 'OPENAI_API_KEY is not set in web/.env' } });

    let messages: unknown;
    try {
      messages = (JSON.parse(await readBody(req)) as { messages?: unknown }).messages;
    } catch (e) {
      return sendJson(res, 400, { error: { message: String(e) } });
    }
    if (!Array.isArray(messages)) return sendJson(res, 400, { error: { message: 'messages must be an array' } });

    const upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: LLM_MODEL, stream: true, max_completion_tokens: MAX_COMPLETION_TOKENS, messages }),
    }).catch((e: unknown) => e as Error);
    if (upstream instanceof Error) return sendJson(res, 502, { error: { message: upstream.message } });

    res.statusCode = upstream.status;
    res.setHeader('Content-Type', upstream.headers.get('content-type') ?? 'application/json');
    if (!upstream.body) return res.end();
    Readable.fromWeb(upstream.body as import('node:stream/web').ReadableStream).pipe(res);
  };
}

export function llmProxy(): Plugin {
  let apiKey: string | undefined;
  return {
    name: 'ember-llm-proxy',
    configResolved(config) {
      // Empty prefix loads non-VITE_ variables too; they stay server-side and are never injected into the bundle.
      apiKey = loadEnv(config.mode, config.envDir || config.root, '').OPENAI_API_KEY || undefined;
    },
    configureServer(server) {
      server.middlewares.use(handler(apiKey));
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler(apiKey));
    },
  };
}
