/**
 * Local dev server (NOT used in production — Netlify serves the real thing).
 *
 * Serves the built SPA from web/dist and routes /api/* to the same Netlify
 * function handlers, adapting Node's req/res to the Web Request/Response the
 * handlers expect. Avoids `netlify dev`'s monorepo prompt and esbuild bundling.
 *
 * Run: set BLOB_DIR + subgraph URLs, then `tsx scripts/dev-server.ts`.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import lookup from '../netlify/functions/lookup.mts';
import profile from '../netlify/functions/profile.mts';
import status from '../netlify/functions/status.mts';

const PORT = Number(process.env.PORT ?? 8888);
const DIST = path.resolve('web/dist');

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
};

const routes: Record<string, (req: Request) => Promise<Response>> = {
  '/api/lookup': lookup,
  '/api/profile': profile,
  '/api/status': status,
};

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(`http://localhost:${PORT}${req.url}`, {
    method: req.method,
    headers: req.headers as Record<string, string>,
    body: hasBody ? Buffer.concat(chunks) : undefined,
  });
}

async function sendWebResponse(res: ServerResponse, web: Response): Promise<void> {
  res.writeHead(web.status, Object.fromEntries(web.headers));
  res.end(Buffer.from(await web.arrayBuffer()));
}

async function serveStatic(res: ServerResponse, pathname: string): Promise<void> {
  // SPA: unknown non-file routes fall back to index.html.
  const rel = pathname === '/' || !path.extname(pathname) ? 'index.html' : pathname.slice(1);
  try {
    const body = await readFile(path.join(DIST, rel));
    res.writeHead(200, {
      'Content-Type': CONTENT_TYPES[path.extname(rel)] ?? 'application/octet-stream',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
}

const server = createServer((req, res) => {
  void (async () => {
    const pathname = new URL(req.url ?? '/', `http://localhost:${PORT}`).pathname;
    const handler = routes[pathname];
    try {
      if (handler) await sendWebResponse(res, await handler(await toWebRequest(req)));
      else await serveStatic(res, pathname);
    } catch (err) {
      console.error(`error handling ${pathname}:`, err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: false, code: 'INTERNAL', message: String(err) }));
    }
  })();
});

server.listen(PORT, () => {
  console.log(`dev server ready: http://localhost:${PORT}`);
});
