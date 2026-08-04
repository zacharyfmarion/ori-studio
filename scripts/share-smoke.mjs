#!/usr/bin/env node
/**
 * Post-deploy smoke test for the crease-pattern share endpoints.
 *
 * A Pages deploy that uploads no Functions **reports success**. The first symptom is a share
 * link that unfurls as nothing, discovered by whoever pasted it. This makes that failure
 * loud, at the moment it happens.
 *
 * Every check is read-only, so it costs nothing against the 1,000-writes/day free tier and
 * leaves no junk records behind. Each is chosen so its failure mode distinguishes a specific
 * cause rather than just "something is wrong":
 *
 *   - a malformed id 400s only if the Function ran at all (without Functions, Pages' SPA
 *     fallback answers 200 text/html)
 *   - a well-formed but absent id 404s only if SHARE_KV is bound (an unbound binding throws)
 *   - the thumbnail fallback needs SHARE_R2 bound *and* og-default.png in the deploy
 *   - /s/<id> proves the meta-injection Function ran, that cross-origin isolation survives it
 *     (the wasm engine needs SharedArrayBuffer), and that the SPA fallback still resolves —
 *     adding a custom 404.html would break exactly this
 *
 *   node scripts/share-smoke.mjs https://oristudio.pages.dev
 */

const base = process.argv[2]?.replace(/\/+$/, '');
if (!base) {
  console.error('usage: share-smoke.mjs <deployment-url>');
  process.exit(2);
}

/** A syntactically valid id that will never exist. */
const ABSENT_ID = 'aaaaaaaaaa';

const failures = [];
let checked = 0;

function check(name, condition, detail) {
  checked += 1;
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    console.log(`  FAIL ${name} — ${detail}`);
    failures.push(name);
  }
}

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Wait for the deployment to start answering before asserting anything about it.
 *
 * `wrangler pages deploy` returns as soon as Cloudflare accepts the upload, and the branch
 * alias can take a few seconds longer to resolve — CI ran these checks 0.1s after the
 * deploy completed and got 404 on everything, including the SPA itself.
 *
 * The gate is deliberately narrow: it waits only for the origin to serve *something*. A
 * deploy that uploaded no Functions still serves its SPA, so this cannot mask the failure
 * the checks below exist to find — that case reaches them and fails on the first check, as
 * it should.
 */
async function waitForDeployment(timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'no response';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${base}/`, { redirect: 'follow' });
      if (response.ok) return;
      lastStatus = `HTTP ${response.status}`;
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : String(error);
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000));
  }
  console.error(
    `share smoke: ${base} never became reachable (last: ${lastStatus}). ` +
      'The deploy itself failed, or the URL is wrong.'
  );
  process.exit(1);
}

async function main() {
  console.log(`share smoke: ${base}\n`);
  await waitForDeployment();

  // 1. The Functions are deployed at all.
  {
    const response = await fetch(`${base}/api/cp/not-an-id`);
    const body = await json(response);
    check(
      'malformed id is rejected by the Worker',
      response.status === 400 && body?.code === 'bad_id',
      `got ${response.status} ${response.headers.get('content-type')} — a 200 text/html here ` +
        'means the Functions did not upload and Pages served the SPA fallback'
    );
  }

  // 2. SHARE_KV is bound.
  {
    const response = await fetch(`${base}/api/cp/${ABSENT_ID}`);
    const body = await json(response);
    check(
      'absent share 404s, so SHARE_KV is bound',
      response.status === 404 && body?.code === 'not_found',
      `got ${response.status} — a 500 here means env.SHARE_KV is undefined`
    );
  }

  // 3. SHARE_R2 is bound and the default card shipped.
  {
    const response = await fetch(`${base}/api/cp/${ABSENT_ID}/thumbnail`);
    check(
      'thumbnail falls back to the default card, so SHARE_R2 and og-default.png are present',
      response.ok && (response.headers.get('content-type') || '').includes('image/png'),
      `got ${response.status} ${response.headers.get('content-type')}`
    );
  }

  // 4. The meta-injection route runs, stays isolated, and still reaches the SPA.
  {
    const response = await fetch(`${base}/s/${ABSENT_ID}`);
    const type = response.headers.get('content-type') || '';
    check(
      'share route serves the SPA',
      response.ok && type.includes('text/html'),
      `got ${response.status} ${type} — a 404 page here would replace every share link`
    );
    check(
      'share route keeps cross-origin isolation',
      response.headers.get('cross-origin-opener-policy') === 'same-origin' &&
        response.headers.get('cross-origin-embedder-policy') === 'require-corp',
      'COOP/COEP missing — the wasm engine cannot start on this entry path. Pages does not ' +
        'apply _headers to Function responses, so the Function must set them itself'
    );
  }

  console.log('');
  if (failures.length) {
    console.error(`share smoke FAILED: ${failures.length} of ${checked} checks`);
    process.exit(1);
  }
  console.log(`share smoke passed: ${checked} checks`);
}

main().catch((error) => {
  console.error(`share smoke errored: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
