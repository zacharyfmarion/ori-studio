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
 * Pass `--preview` for anything that is not the production deploy. A preview serves the
 * same marketing copy on a public hostname, so `prerender-landing.mjs` gives it a
 * `Disallow: /` robots.txt — which means the two deploys have deliberately *different*
 * correct answers, and a checker that knows only one of them fails the other. Mirrors
 * `ORI_SITE_ENV` on the build side, as a flag rather than an env var because this script
 * is also run by hand against arbitrary URLs, where an inherited variable would lie.
 *
 *   node scripts/seo-smoke.mjs https://346909ff.oristudio.pages.dev
 *   node scripts/seo-smoke.mjs https://0ba7d0df.oristudio.pages.dev --preview
 */

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const base = args.find((arg) => !arg.startsWith('--'))?.replace(/\/+$/, '');

if (!base) {
  console.error('usage: seo-smoke.mjs <deployment-url> [--preview]');
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
    // Production invites crawlers and names the sitemap; a preview must refuse them, or it
    // competes with the real site for the same copy on a hostname nobody meant to publish.
    // Asserting the preview case positively is the point — a preview that quietly shipped
    // the production robots.txt is the failure worth catching, and it looks like success.
    contains: preview
      ? ['User-agent: *', 'Disallow: /']
      : ['User-agent: *', 'Allow: /', 'Sitemap: https://oristudio.dev/sitemap.xml'],
    absent: preview ? ['Allow: /'] : ['Disallow: /'],
  },
  {
    name: 'sitemap.xml is a real file, not the SPA fallback',
    path: '/sitemap.xml',
    rejectHtml: true,
    contentType: 'xml',
    contains: [
      '<urlset',
      '<loc>https://oristudio.dev/</loc>',
      '<loc>https://oristudio.dev/download/</loc>',
      '<loc>https://oristudio.dev/zh-CN/</loc>',
      '<loc>https://oristudio.dev/zh-CN/download/</loc>',
    ],
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
    // Names the outcome, not the mechanism. Pages' SPA fallback serves `index.html` for an
    // unmatched path, and that file carries the same copy — so this cannot distinguish a
    // written `dist/welcome/index.html` from the fallback, and must not claim to. What it
    // does prove is the one thing that matters: the URL answers with the landing copy.
    name: '/welcome answers with the landing copy, however it is served',
    path: '/welcome',
    contains: ['id="seo-content"', 'crease pattern'],
  },
  {
    // A content page, through the same gate as the landing — and the one assertion the
    // landing cannot make. `index.html` hardcodes `canonical → /`; a content page that
    // shipped with it would deploy, serve and 200 exactly like this, and be consolidated
    // into the homepage rather than indexed as itself. The SPA fallback would also pass
    // every *other* check here, since it carries the landing's copy and `#seo-content`.
    name: '/download/ is its own page, with its own canonical',
    path: '/download/',
    contains: [
      '<link rel="canonical" href="https://oristudio.dev/download/" />',
      '<title>Download Ori Studio for macOS, Windows and Linux</title>',
      'id="seo-content"',
      'Every build',
    ],
    absent: ['<link rel="canonical" href="https://oristudio.dev/" />'],
  },
  {
    // A localized page, in its language. `lang` is what Baidu reads — it runs no JS and
    // ignores `hreflang` — and the words are what it indexes. A Chinese page still marked
    // `lang="en"`, or one whose canonical points at the English page, deploys and 200s and
    // is indexed as English or dropped as a duplicate. The SPA fallback would pass every
    // other check here, since it carries the English landing and `#seo-content`.
    name: '/zh-CN/ is the landing in Chinese, as its own page',
    path: '/zh-CN/',
    contains: [
      '<html lang="zh-CN">',
      '<link rel="canonical" href="https://oristudio.dev/zh-CN/" />',
      '<link rel="alternate" hreflang="en" href="https://oristudio.dev/" />',
      '<link rel="alternate" hreflang="x-default" href="https://oristudio.dev/" />',
      '折纸',
      'id="seo-content"',
    ],
    absent: ['<html lang="en">', '<link rel="canonical" href="https://oristudio.dev/" />'],
  },
  {
    name: '/ja/download/ is the download page in Japanese',
    path: '/ja/download/',
    contains: [
      '<html lang="ja">',
      '<link rel="canonical" href="https://oristudio.dev/ja/download/" />',
      'ダウンロード',
    ],
    absent: ['<link rel="canonical" href="https://oristudio.dev/download/" />'],
  },
  {
    name: 'the OpenGraph image is served',
    path: '/og-default.png',
    contentType: 'image/png',
  },
];

async function check({ name, path, rejectHtml, contentType, contains = [], absent = [] }) {
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
  for (const needle of absent) {
    if (body.includes(needle)) return `${name}: response should not contain ${JSON.stringify(needle)}`;
  }
  return null;
}

/**
 * One check per URL the deployed sitemap lists, derived rather than written.
 *
 * The named checks above pin a handful of pages to specific words. This is the guard for
 * every page — the registry grows in the app, the sitemap is generated from it, and any
 * page it lists has to be its own file on this host. Three things prove that, and the SPA
 * fallback fails all three: the crawler copy is present, the canonical names *this* URL
 * (the fallback's says the homepage), and `lang` matches the locale in the path (the
 * fallback's says English). Nine locales × every page, today 18, tomorrow whatever the
 * registry says — with no list to keep in step here.
 */
async function sitemapChecks() {
  const response = await fetch(`${base}/sitemap.xml`, { redirect: 'follow' });
  const xml = await response.text();
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc]) => loc);
  if (locs.length === 0) return [];
  return locs.map((loc) => {
    const url = new URL(loc);
    const [, first = ''] = url.pathname.split('/');
    const lang = /^[a-z]{2}(-[A-Z]{2})?$/.test(first) ? first : 'en';
    return {
      name: `${url.pathname} is its own page, in ${lang}`,
      path: url.pathname,
      contains: [
        'id="seo-content"',
        `<html lang="${lang}">`,
        `<link rel="canonical" href="https://oristudio.dev${url.pathname}" />`,
      ],
      absent: url.pathname === '/' ? [] : ['<link rel="canonical" href="https://oristudio.dev/" />'],
    };
  });
}

async function main() {
  const deadline = Date.now() + DEADLINE_MS;
  let failures = [];
  let checks = CHECKS;

  // A freshly-created per-deployment host can take a moment to serve consistently. A real
  // failure fails identically on every attempt, so retrying costs only the wait.
  for (;;) {
    const fromSitemap = await sitemapChecks().catch(() => []);
    checks = [...CHECKS, ...fromSitemap];
    if (fromSitemap.length === 0) {
      failures = ['sitemap.xml lists no URLs, so no page could be checked against it'];
    } else {
      failures = (await Promise.all(checks.map(check))).filter(Boolean);
    }
    if (failures.length === 0 || Date.now() >= deadline) break;
    await sleep(RETRY_DELAY_MS);
  }

  for (const failure of failures) console.error(`  ✗ ${failure}`);
  if (failures.length === 0) {
    console.log(
      `seo-smoke: ${checks.length} checks passed against ${base} (${preview ? 'preview' : 'production'})`
    );
  }
  process.exit(failures.length === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(`seo-smoke failed: ${error.message}`);
  process.exit(1);
});
