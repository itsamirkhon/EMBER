import * as P from './parse';
import type * as T from './types';
import { mockTransport } from './mock';

export const MOCK = import.meta.env.VITE_MOCK === '1';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface RawResponse { status: number; body: unknown; text?: string; contentType?: string }
type Transport = (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<RawResponse>;

const httpTransport: Transport = async (method, path, body, headers) => {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch (e) {
    throw new ApiError(0, 'network', `Cannot reach the EMBER backend (${(e as Error).message}). Is it running on :8000?`);
  }
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  let parsed: unknown = null;
  if (contentType.includes('json')) {
    try { parsed = JSON.parse(text); } catch { parsed = null; }
  }
  return { status: res.status, body: parsed, text, contentType };
};

const transport: Transport = MOCK ? mockTransport : httpTransport;

async function call<X>(parse: P.P<X>, method: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<X> {
  const res = await transport(method, path, body, headers);
  if (res.status >= 400) {
    const env = P.errorEnvelope(res.body);
    throw new ApiError(res.status, env?.code ?? `http_${res.status}`, env?.message ?? `Request failed (HTTP ${res.status}).`);
  }
  try {
    return parse(res.body, path);
  } catch (e) {
    if (e instanceof P.ParseError) throw new ApiError(res.status, 'bad_response', e.message);
    throw e;
  }
}

const qs = (o: Record<string, string | undefined>) => {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(o)) if (v) u.set(k, v);
  const s = u.toString();
  return s ? `?${s}` : '';
};

export interface Filters { q?: string; topic?: string; material?: string; platform?: string; family?: string }
export type ExportFormat = 'report' | 'json' | 'csv' | 'dataset';

export const api = {
  meta: () => call(P.meta, 'GET', '/api/meta'),
  investigations: (f: Filters = {}) => call(P.investigationList, 'GET', `/api/investigations${qs({ ...f })}`),
  investigation: (id: string) => call(P.investigationFull, 'GET', `/api/investigations/${encodeURIComponent(id)}`),
  source: (id: string) => call(P.sourceManifest, 'GET', `/api/sources/${encodeURIComponent(id)}`),
  parseQuery: (b: { text?: string; config?: T.ResearchQuery }) => call(P.parsedQuery, 'POST', '/api/queries/parse', b),
  createReview: (query: T.ResearchQuery, idempotencyKey?: string) =>
    call(P.runCreated, 'POST', '/api/reviews', { query }, idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined),
  run: (id: string) => call(P.runStatus, 'GET', `/api/runs/${encodeURIComponent(id)}`),
  reviews: () => call(P.reviewList, 'GET', '/api/reviews'),
  review: (id: string) => call(P.review, 'GET', `/api/reviews/${encodeURIComponent(id)}`),
  variant: (id: string, config_patch: Partial<T.QueryConfig>) =>
    call(P.variantResult, 'POST', `/api/reviews/${encodeURIComponent(id)}/variants`, { config_patch }),
  programme: (id: string, budget_runs: number, must_cover?: string[]) =>
    call(P.programme, 'POST', `/api/reviews/${encodeURIComponent(id)}/test-programmes`, { budget_runs, ...(must_cover?.length ? { must_cover } : {}) }),
  replay: (id: string, testId: string) => call(P.replay, 'GET', `/api/reviews/${encodeURIComponent(id)}/replay/${encodeURIComponent(testId)}`),
  revisions: (id: string) => call(P.revisions, 'GET', `/api/reviews/${encodeURIComponent(id)}/revisions`),
  rules: () => call(P.rules, 'GET', '/api/rules'),
  evalSummary: () => call(P.evalSummary, 'GET', '/api/eval/summary'),
  exportUrl: (id: string, format: ExportFormat) => `/api/reviews/${encodeURIComponent(id)}/export?format=${format}`,
  /** Fetches export text (used for preview and for mock-mode downloads). */
  exportText: async (id: string, format: ExportFormat): Promise<string> => {
    const res = await transport('GET', `/api/reviews/${encodeURIComponent(id)}/export?format=${format}`);
    if (res.status >= 400) {
      const env = P.errorEnvelope(res.body);
      throw new ApiError(res.status, env?.code ?? `http_${res.status}`, env?.message ?? 'Export failed.');
    }
    return res.text ?? JSON.stringify(res.body, null, 2);
  },
};
