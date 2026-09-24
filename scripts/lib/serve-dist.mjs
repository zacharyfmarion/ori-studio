/**
 * A stand-in for Cloudflare Pages over a built `apps/web/dist`: brotli, the cross-origin
 * isolation headers from `_headers`, directory indexes, and the SPA fallback. `vite preview`
 * does none of the first three, and every measurement or screenshot taken against it is of a
 * page no visitor gets. Shared by `lighthouse.mjs` and `static-paint-check.mjs`.
 *
 * `trickleHtml` sends documents in pieces, uncompressed, with a pause between them — the
 * way a slow network does, and the only way a local server gets a browser to render frames
 * of a document it has only partly parsed.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { brotliCompressSync, constants } from 'node:zlib';

const MIME = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
};
const COMPRESSIBLE = new Set(['.css', '.html', '.js', '.json', '.svg', '.wasm', '.webmanifest', '.txt', '.xml']);

export function servePagesLike(dist, { trickleHtml = null } = {}) {
  const compressed = new Map();
  const resolveFile = (pathname) => {
    const direct = path.join(dist, decodeURIComponent(pathname));
    if (existsSync(direct) && statSync(direct).isFile()) return direct;
    const index = path.join(direct, 'index.html');
    if (existsSync(index)) return index;
    return path.join(dist, 'index.html');
  };
  const server = createServer((req, res) => {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    const file = resolveFile(pathname);
    const ext = path.extname(file);
    const headers = {
      'Content-Type': MIME[ext] ?? 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': pathname.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    };
    let body = readFileSync(file);
    if (trickleHtml && ext === '.html' && req.method !== 'HEAD') {
      res.writeHead(200, headers);
      const { chunkBytes, delayMs } = trickleHtml;
      const send = (offset) => {
        if (offset >= body.length) return res.end();
        res.write(body.subarray(offset, offset + chunkBytes));
        setTimeout(() => send(offset + chunkBytes), delayMs);
      };
      send(0);
      return;
    }
    if (COMPRESSIBLE.has(ext) && /\bbr\b/.test(String(req.headers['accept-encoding'] ?? ''))) {
      if (!compressed.has(file)) {
        // Cloudflare's edge compresses at a middling level, not the maximum.
        compressed.set(file, brotliCompressSync(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 5 } }));
      }
      body = compressed.get(file);
      headers['Content-Encoding'] = 'br';
      headers.Vary = 'Accept-Encoding';
    }
    res.writeHead(200, headers);
    res.end(req.method === 'HEAD' ? undefined : body);
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ url: `http://localhost:${port}/`, close: () => new Promise((done) => server.close(done)) });
    });
  });
}
