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
 *     (fold cancellation needs SharedArrayBuffer — the engine itself does not, its wasm
 *     memory is unshared), and that the SPA fallback still resolves — adding a custom
 *     404.html would break exactly this
 *
 * Point it at the **immutable per-deployment host** `wrangler pages deploy` prints
 * (`Take a peek over at https://<hash>.oristudio.pages.dev`), not at a branch alias or the
 * production hostname. That host is created with the deployment, so it answers for the
 * deployment that was just uploaded and only that one. The alternatives both lie: a branch
 * alias is a *new* hostname on a branch's first deploy and serves inconsistently for a few
 * seconds after it appears, and the production hostname keeps serving the previous
 * deployment until the new one propagates — so checks against it can pass without ever
 * touching the build under test.
 *
 * `--alias` additionally waits for a hostname to answer at all. That is the link people are
 * handed (the PR comment, the public site), so it is worth knowing it resolves; it is a
 * reachability probe, not a second run of the checks.
 *
 *   node scripts/share-smoke.mjs https://346909ff.oristudio.pages.dev
 *   node scripts/share-smoke.mjs https://346909ff.oristudio.pages.dev --alias https://pr-7.oristudio.pages.dev
 */

const args = process.argv.slice(2);
const positional = args.filter((arg) => !arg.startsWith('--'));
const aliasIndex = args.indexOf('--alias');
const trimUrl = (url) => url?.replace(/\/+$/, '');

const base = trimUrl(positional[0]);
const alias = aliasIndex === -1 ? null : trimUrl(args[aliasIndex + 1]);

if (!base || (aliasIndex !== -1 && !alias)) {
  console.error('usage: share-smoke.mjs <deployment-url> [--alias <url>]');
  process.exit(2);
}

/** A syntactically valid id that will never exist. */
const ABSENT_ID = 'aaaaaaaaaa';

/**
 * How long to keep retrying, and how long to wait between attempts.
 *
 * Sized from a measurement, not a guess: a cold per-deployment host took 22 attempts over
 * 68s to serve its Functions consistently, while `GET /` answered on the first one. Three
 * minutes is that with room to spare. A real failure fails identically on every attempt and
 * only costs this long to report. Overridable so a local run against a URL that is simply
 * wrong does not sit there for minutes.
 */
const DEADLINE_MS = Number(process.env.SHARE_SMOKE_TIMEOUT_MS) || 180_000;
const RETRY_DELAY_MS = 3_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function json(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Whether the origin serves anything at all, so "wrong URL" reads differently from "broken". */
async function answers(url) {
  try {
    return (await fetch(`${url}/`, { redirect: 'follow' })).ok;
  } catch {
    return false;
  }
}

/**
 * Run every check once against `target`, returning results rather than printing them.
 *
 * Nothing is printed from in here because an attempt that is about to be retried should not
 * narrate failures that the next attempt resolves — that is what made a transient race read
 * as a binding regression in the logs.
 */
async function runChecks(target) {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: Boolean(ok), detail });

  // 1. The Functions are deployed at all.
  {
    const response = await fetch(`${target}/api/cp/not-an-id`);
    const body = await json(response);
    check(
      'malformed id is rejected by the Worker',
      response.status === 400 && body?.code === 'bad_id',
      `got ${response.status} ${response.headers.get('content-type')} — 200 text/html means the ` +
        'Functions did not upload and Pages served the SPA fallback; 404 means this host is not ' +
        'serving this deployment',
    );
  }

  // 2. SHARE_KV is bound.
  {
    const response = await fetch(`${target}/api/cp/${ABSENT_ID}`);
    const body = await json(response);
    check(
      'absent share 404s, so SHARE_KV is bound',
      response.status === 404 && body?.code === 'not_found',
      `got ${response.status} — a 500 here means env.SHARE_KV is undefined`,
    );
  }

  // 3. SHARE_R2 is bound and the default card shipped.
  {
    const response = await fetch(`${target}/api/cp/${ABSENT_ID}/thumbnail`);
    check(
      'thumbnail falls back to the default card, so SHARE_R2 and og-default.png are present',
      response.ok && (response.headers.get('content-type') || '').includes('image/png'),
      `got ${response.status} ${response.headers.get('content-type')}`,
    );
  }

  // 4. The meta-injection route runs, stays isolated, and still reaches the SPA.
  {
    const response = await fetch(`${target}/s/${ABSENT_ID}`);
    const type = response.headers.get('content-type') || '';
    const served = response.ok && type.includes('text/html');
    check(
      'share route serves the SPA',
      served,
      `got ${response.status} ${type} — a 404 page here would replace every share link`,
    );
    check(
      'share route keeps cross-origin isolation',
      response.headers.get('cross-origin-opener-policy') === 'same-origin' &&
        response.headers.get('cross-origin-embedder-policy') === 'require-corp',
      served
        ? 'COOP/COEP missing — no SharedArrayBuffer, so a fold started from this entry path ' +
            'cannot be stopped. Pages does not apply _headers to Function responses, so the ' +
            'Function must set them itself'
        : 'the route did not serve, so its headers say nothing — see the check above',
    );
  }

  return results;
}

/**
 * Run the checks until they all pass, or until the deadline.
 *
 * The whole suite is retried rather than gated behind one readiness probe. A single `GET /`
 * proves nothing about Function routing: the static-asset layer answers it while the routes
 * are still cold, and on a cold hostname two requests to the *same* route seconds apart can
 * be served by machines that disagree about whether the deployment exists. One-shot checks
 * behind that gate failed ~10% of first deploys on green builds; the first run of this loop
 * needed 22 attempts on a deploy that was fine.
 */
async function smoke(target) {
  const deadline = Date.now() + DEADLINE_MS;
  let attempts = 0;
  let reachable = false;
  let results = null;

  for (;;) {
    attempts += 1;
    if (await answers(target)) {
      reachable = true;
      results = await runChecks(target);
      if (results.every((result) => result.ok)) break;
    }
    if (Date.now() >= deadline) break;
    await sleep(RETRY_DELAY_MS);
  }

  if (!reachable) {
    console.error(
      `${target} never answered within ${DEADLINE_MS / 1000}s. The deploy itself failed, or the ` +
        'URL is wrong.',
    );
    return false;
  }

  for (const result of results) {
    console.log(result.ok ? `  ok   ${result.name}` : `  FAIL ${result.name} — ${result.detail}`);
  }
  const failures = results.filter((result) => !result.ok);
  const tries = attempts === 1 ? '' : ` (${attempts} attempts)`;
  console.log('');
  if (failures.length) {
    console.error(`share smoke FAILED: ${failures.length} of ${results.length} checks${tries}`);
    return false;
  }
  console.log(`share smoke passed: ${results.length} checks${tries}`);
  return true;
}

async function main() {
  console.log(`share smoke: ${base}\n`);
  let ok = await smoke(base);

  if (alias) {
    const deadline = Date.now() + DEADLINE_MS;
    let resolved = false;
    while (!(resolved = await answers(alias)) && Date.now() < deadline) {
      await sleep(RETRY_DELAY_MS);
    }
    console.log(
      resolved
        ? `  ok   ${alias} resolves`
        : `  FAIL ${alias} never resolved — the link handed to people does not load`,
    );
    ok = ok && resolved;
  }

  process.exit(ok ? 0 : 1);
}

main().catch((error) => {
  console.error(`share smoke errored: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
