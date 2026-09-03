#!/usr/bin/env node
/**
 * Post-deploy smoke test for the model store (`/models/*`).
 *
 * A deploy whose Function uploaded, but whose bucket binding is missing, or
 * whose registry was never published, reports success and then fails the
 * first user who opens Detect. This asks the deployed origin the three
 * questions that user's browser will: is there a registry, does it name a
 * current model whose manifest is served, and does the model's first byte
 * come back with the headers the page needs (a ranged 206, the total size,
 * and a cross-origin resource policy that satisfies `require-corp`).
 *
 * Read-only, three small requests, no model download.
 *
 * Usage: models-smoke.mjs <deployment-url>
 */

const base = process.argv[2]?.replace(/\/+$/, '');
if (!base) {
  console.error('usage: models-smoke.mjs <deployment-url>');
  process.exit(2);
}

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

const registryResponse = await fetch(`${base}/models/registry.json`);
const registry = registryResponse.ok ? await registryResponse.json().catch(() => null) : null;
check(
  'the registry is served',
  registryResponse.ok && registry?.schema === 'oristudio/cp-detect-model-registry/v1',
  `got ${registryResponse.status} ${registryResponse.headers.get('content-type')} — 200 text/html means the Function ` +
    'did not upload; 404 JSON means registry.json was never published (scripts/cp-detect/publish-model.mjs); ' +
    '500 means MODELS_R2 is not bound'
);

const family = registry?.families?.['cp-detector'];
const current = family?.versions?.find((version) => version.id === family.current);
check('the registry names a current cp-detector', Boolean(current), `current=${family?.current ?? 'none'}`);

if (current) {
  const manifestResponse = await fetch(new URL(current.manifest_url, `${base}/models/registry.json`));
  const manifest = manifestResponse.ok ? await manifestResponse.json().catch(() => null) : null;
  check(
    'the current manifest is served and matches',
    manifest?.id === current.id && manifest?.model?.sha256 === current.sha256,
    `got ${manifestResponse.status}`
  );

  const modelUrl = new URL(current.model_url, `${base}/models/registry.json`);
  const probe = await fetch(modelUrl, { headers: { Range: 'bytes=0-0' } });
  const total = Number(/\/(\d+)$/.exec(probe.headers.get('content-range') ?? '')?.[1] ?? 0);
  check(
    'the model answers a first-byte probe with its size and the isolation headers',
    probe.status === 206 &&
      total === current.size_bytes &&
      probe.headers.get('cross-origin-resource-policy') === 'cross-origin' &&
      (probe.headers.get('cache-control') ?? '').includes('immutable'),
    `got ${probe.status}, content-range ${probe.headers.get('content-range')}, CORP ${probe.headers.get('cross-origin-resource-policy')}`
  );
}

let failed = 0;
for (const result of results) {
  console.log(`${result.ok ? 'ok  ' : 'FAIL'} ${result.name}${result.ok ? '' : `\n     ${result.detail}`}`);
  if (!result.ok) failed += 1;
}
process.exit(failed === 0 ? 0 : 1);
