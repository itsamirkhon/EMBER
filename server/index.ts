import { existsSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApiHandler } from './api';
import { DEFAULT_ROOT_DIR } from './store';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export interface ServerOptions {
  port?: number;
  host?: string;
  rootDir?: string;
  storePath?: string;
}

function getSafeDistFile(distDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  const rel = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
  const candidate = resolve(distDir, rel);
  const rootPrefix = distDir.endsWith(sep) ? distDir : `${distDir}${sep}`;
  if (candidate !== distDir && !candidate.startsWith(rootPrefix)) {
    return null;
  }
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return candidate;
  }
  return null;
}

async function serveStaticDist(req: IncomingMessage, res: ServerResponse, distDir: string): Promise<void> {
  if (!existsSync(distDir)) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        status: 'error',
        error: {
          code: 'DIST_NOT_BUILT',
          message: 'Static dist/ directory not built yet. Query /api/* or run npm run build.',
        },
      }),
    );
    return;
  }

  const method = (req.method ?? 'GET').toUpperCase();
  if (method !== 'GET' && method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ status: 'error', error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET or HEAD.' } }));
    return;
  }

  const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
  let filePath = getSafeDistFile(distDir, pathname);

  if (!filePath && !extname(pathname)) {
    const fallback = join(distDir, 'index.html');
    if (existsSync(fallback) && statSync(fallback).isFile()) {
      filePath = fallback;
    }
  }

  if (!filePath) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.end('Not Found');
    return;
  }

  const contentType = MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  const body = await readFile(filePath);
  res.statusCode = 200;
  res.setHeader('Content-Type', contentType);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (method === 'HEAD') {
    res.end();
    return;
  }
  res.end(body);
}

export function createStandaloneServer(options: ServerOptions = {}): Server {
  const rootDir = options.rootDir ? resolve(options.rootDir) : DEFAULT_ROOT_DIR;
  const distDir = join(rootDir, 'dist');
  const apiHandler = createApiHandler(rootDir, { storePath: options.storePath });

  return createServer((req, res) => {
    const pathname = (req.url ?? '/').split('?')[0];
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      void apiHandler(req, res);
      return;
    }
    void serveStaticDist(req, res, distDir).catch((err) => {
      if (!res.headersSent) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.end(err instanceof Error ? err.message : 'Static server error');
      }
    });
  });
}

export async function startServer(options: ServerOptions = {}): Promise<{ server: Server; port: number; host: string }> {
  const port = options.port ?? Number(process.env.PORT || 8787);
  const host = options.host ?? process.env.HOST ?? '0.0.0.0';
  const server = createStandaloneServer(options);

  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(port, host, () => {
      server.off('error', rejectListen);
      resolveListen();
    });
  });

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  return { server, port: actualPort, host };
}

function isMainEntry(): boolean {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(fileURLToPath(import.meta.url)) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (isMainEntry()) {
  startServer()
    .then(({ server, port, host }) => {
      console.log(`EMBER v2 server listening on http://${host}:${port}`);
      const shutdown = () => {
        server.close(() => process.exit(0));
      };
      process.once('SIGINT', shutdown);
      process.once('SIGTERM', shutdown);
    })
    .catch((err) => {
      console.error('Failed to start EMBER v2 server:', err);
      process.exit(1);
    });
}
