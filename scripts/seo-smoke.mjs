#!/usr/bin/env node
/**
 * Post-deploy smoke test for the files search engines read.
 *
 * The failure this exists to catch is silent by construction. Cloudflare Pages answers
 * every unmatched path with `index.html` at **200 text/html** — the SPA fallback that
 * `public/_headers` warns against breaking. So a robots.txt that was never deployed does
 * not 404: it serves a cheerful 200 with a full HTML document, and every status-code check
 * in the pipeline agrees the site is fine. That is exactly how this repo shipped for months
 * with no robots.txt and no sitemap, and nothing said a word.
 *
 * The rule that follows: **never assert on status here.** Assert on content type and on
 * bytes that only the real file can contain.
 *
 * Point it at the immutable per-deployment host, for the reason share-smoke.mjs documents
 * at length — the production hostname keeps serving the previous deployment until this one
 * propagates, so a check against it can pass without touching the build under test.
 *
 *   node scripts/seo-smoke.mjs https://346909ff.oristudio.pages.dev
 */

const base = process.argv[2]?.replace(/\/+$/, '');

if (!base) {
  console.error('usage: seo-smoke.mjs <deployment-url>');
  process.exit(2);
}

const DEADLINE_MS = Number(process.env.SEO_SMOKE_TIMEOUT_MS) || 120_000;
const RETRY_DELAY_MS = 3_000;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The checks, each phrased so its failure names a cause.
 *
 * `rejectHtml` is the load-bearing flag: it is what separates "the file is missing and you
 * are looking at the SPA fallback" from "the file is there but wrong".
 */
const CHECKS = [
  {
    name: 'robots.txt is a real file, not the SPA fallback',
    path: '/robots.txt',
    rejectHtml: true,
    contentType: 'text/plain',
    contains: ['User-agent:', 'Sitemap: https://oristudio.dev/sitemap.xml'],
  },
  {
    name: 'sitemap.xml is a real file, not the SPA fallback',
    path: '/sitemap.xml',
    rejectHtml: true,
    contentType: 'xml',
    contains: ['<urlset', '<loc>https://oristudio.dev/</loc>'],
  },
  {
    name: 'the root page carries its canonical and card metadata',
    path: '/',
    contains: [
      '<link rel="canonical" href="https://oristudio.dev/" />',
      'property="og:image"',
      'name="twitter:card"',
    ],
  },
  {
    // The whole point of the prerender. Without it this returns a valid, 200, correctly
    // canonicalised page with no words in it — which every other check here would pass.
    name: 'the landing copy is in the HTML, not just in the JavaScript',
    path: '/',
    contains: ['id="seo-content"', 'crease pattern', 'application/ld+json', '<h1'],
  },
  {
    name: '/welcome is a real prerendered file too',
    path: '/welcome',
    contains: ['id="seo-content"', 'crease pattern'],
  },
  {
    name: 'the OpenGraph image is served',
    path: '/og-default.png',
    contentType: 'image/png',
  },
];

async function check({ name, path, rejectHtml, contentType, contains = [] }) {
  const response = await fetch(`${base}${path}`, { redirect: 'follow' });
  const type = response.headers.get('content-type') ?? '';
  const body = await response.text();

  if (rejectHtml && (type.includes('text/html') || body.trimStart().startsWith('<!doctype'))) {
    return `${name}: got the SPA fallback (${type || 'no content-type'}) — the file is missing from the deploy`;
  }
  if (contentType && !type.includes(contentType)) {
    return `${name}: content-type is "${type || 'absent'}", expected ${contentType}`;
  }
  for (const needle of contains) {
    if (!body.includes(needle)) return `${name}: response does not contain ${JSON.stringify(needle)}`;
  }
  return null;
}

async function main() {
  const deadline = Date.now() + DEADLINE_MS;
  let failures = [];

  // A freshly-created per-deployment host can take a moment to serve consistently. A real
  // failure fails identically on every attempt, so retrying costs only the wait.
  for (;;) {
    failures = (await Promise.all(CHECKS.map(check))).filter(Boolean);
    if (failures.length === 0 || Date.now() >= deadline) break;
    await sleep(RETRY_DELAY_MS);
  }

  for (const failure of failures) console.error(`  ✗ ${failure}`);
  if (failures.length === 0) console.log(`seo-smoke: ${CHECKS.length} checks passed against ${base}`);
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`seo-smoke failed: ${error.message}`);
  process.exit(1);
});
