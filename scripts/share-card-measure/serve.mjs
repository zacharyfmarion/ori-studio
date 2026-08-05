#!/usr/bin/env node
/**
 * Static server for the share-card measurement harness.
 *
 * A plain file:// page cannot fetch the SVGs, and the app's own dev server must not be
 * used — worktrees share its port, so a parallel agent's Vite can end up serving your
 * measurement. This pins an unusual port and serves exactly one directory.
 *
 *   node scripts/share-card-measure/serve.mjs <dir> [port]
 */

import { createServer } from 'node:http';
import { readFile, appendFile, writeFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const root = process.argv[2];
const port = Number(process.argv[3] || 8931);
if (!root) throw new Error('usage: serve.mjs <dir> [port]');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
};

createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://localhost');

  // Results are appended as they are measured, not collected in the page. Rasterizing the
  // corpus takes ~15 minutes and a dropped tab loses everything held in memory — the first
  // attempt at this died at 526/563.
  if (request.method === 'POST' && url.pathname === '/row') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    await appendFile(join(root, 'rows.jsonl'), `${Buffer.concat(chunks).toString()}\n`);
    response.writeHead(204).end();
    return;
  }

  // Save a rendered card to disk, so a real 1200x630 PNG can be inspected rather than
  // described. `?name=` picks the filename.
  if (request.method === 'POST' && url.pathname === '/png') {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const name = (url.searchParams.get('name') || 'card').replace(/[^a-zA-Z0-9_-]/g, '');
    await writeFile(join(root, `${name}.png`), Buffer.concat(chunks));
    response.writeHead(204).end();
    return;
  }

  const relative = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
  const path = join(root, relative === '/' ? 'index.html' : relative);
  try {
    const body = await readFile(path);
    response.writeHead(200, { 'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream' });
    response.end(body);
  } catch {
    response.writeHead(404).end('not found');
  }
}).listen(port, () => {
  console.log(`serving ${root} at http://localhost:${port}`);
});
