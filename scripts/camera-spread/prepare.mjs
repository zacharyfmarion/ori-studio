// Private corpus stays in ignored artifacts. Re-run with a corpus path; no machine-specific paths in source.
import { readdir, readFile, writeFile, mkdir, symlink, lstat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
const run = promisify(execFile);
const corpus = process.argv[2];
if (!corpus)
  throw new Error(
    'Usage: node scripts/camera-spread/prepare.mjs <cpoogle-directory> [extra.cp|extra.fold ...]'
  );
const out = path.resolve('artifacts/camera-spread');
await mkdir(out, { recursive: true });
const mount = path.resolve('apps/web/src/generated/camera-spread');
await mkdir(path.dirname(mount), { recursive: true });
if (!(await lstat(mount).catch(() => null)))
  await symlink(path.relative(path.dirname(mount), out), mount, 'dir');
const catalog = [];
for (const name of (await readdir(corpus)).sort()) {
  try {
    const file = path.join(corpus, name, 'truth.fold');
    const data = JSON.parse(await readFile(file, 'utf8'));
    catalog.push({
      id: name,
      edges: data.edges_vertices.length,
      vertices: data.vertices_coords.length,
      file,
      source: 'corpus',
    });
  } catch {
    /* Non-model files. */
  }
}
catalog.sort((a, b) => a.edges - b.edges || a.id.localeCompare(b.id));
const selected = new Map();
// Twenty-four deterministic size quantiles, plus named regressions from the old spread study.
for (let i = 0; i < 24; i++) {
  const m = catalog[Math.round((i * (catalog.length - 1)) / 23)];
  selected.set(m.id, m);
}
for (const m of catalog)
  if (
    /frog-frog-by-gen-hagiwara|rain-frog|crane-crane-by-jordan|lizard-lizard-by-jason|bird-base-bird-base|baby-lizard|frog-frog-by-juanfran|lizard-v2/.test(
      m.id
    )
  )
    selected.set(m.id, m);
const extra = process.argv.slice(3).map((file) => ({
  file,
  id: path
    .basename(file, path.extname(file))
    .replace(/[^a-z0-9]+/gi, '-')
    .toLowerCase(),
  label: path.basename(file),
  source: 'example',
}));
const pending = [...selected.values(), ...extra];
if (new Set(pending.map((m) => m.id)).size !== pending.length) throw new Error('Duplicate example id');
const results = [];
async function worker() {
  while (pending.length) {
    const model = pending.shift();
    const { file, ...metadata } = model;
    const started = performance.now();
    try {
      const { stdout } = await run(
        process.execPath,
        ['scripts/camera-spread/fold-one.mjs', file, path.join(out, model.id + '.json')],
        { timeout: 12000, maxBuffer: 1024 * 1024 }
      );
      const result = {
        ...metadata,
        status: 'solved',
        ...JSON.parse(stdout.trim()),
      };
      results.push(result);
      console.log('solved', model.id, result.faces);
    } catch (error) {
      results.push({
        ...metadata,
        status: error.killed ? 'timeout' : 'refused',
        ms: performance.now() - started,
        reason: String(error.stderr || error.message).slice(-1400),
      });
      console.log('refused', model.id);
    }
  }
}
await Promise.all([worker(), worker()]);
results.sort((a, b) => a.edges - b.edges || a.id.localeCompare(b.id));
await writeFile(
  path.join(out, 'manifest.json'),
  JSON.stringify(
    {
      total: catalog.length,
      selection:
        '24 edge-count quantiles plus 8 named regressions; optional additional examples; 12s timeout per fold; no exactization',
      models: results,
    },
    null,
    2
  )
);
console.log(
  'Finished',
  results.length,
  'attempts;',
  results.filter((x) => x.status === 'solved').length,
  'solved'
);
