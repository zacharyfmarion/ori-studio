#!/usr/bin/env node
/**
 * Put the landing page into `dist/index.html` as real HTML, and generate the two files
 * search engines read.
 *
 * Google does execute JavaScript, so the SPA is indexable in principle. In practice
 * crawling and rendering are separate queues: the HTML is fetched immediately, and the
 * page then waits in a budgeted render queue that may take days. This page asks that pass
 * to parse ~1MB of JS under COEP before a single word appears. Prerendering removes the
 * dependency on a queue we do not control, and fixes every crawler that renders nothing
 * at all — Bing, most social unfurlers, the LLM crawlers.
 *
 * Runs as `postbuild`, not as a deploy step, for the reason `apps/web/src/generated/`
 * exists as a build output: an artifact the deploy produces but a local build does not is
 * an artifact nobody can reproduce or debug. See AGENTS.md.
 *
 * The markup comes from the same `WelcomeLanding` component the app renders, so the two
 * cannot describe the product differently.
 */
import { createServer } from 'vite';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(webRoot, 'dist');

/**
 * Production is opt-in.
 *
 * PR previews serve the same marketing copy on a public hostname, which is duplicate
 * content on a crawlable host. Absence means "not production", matching the firewall the
 * PostHog and Sentry config already use: a misconfigured build de-indexes itself rather
 * than competing with the real site.
 */
const isProduction = process.env.ORI_SITE_ENV === 'production';

function fail(message) {
  console.error(`prerender-landing: ${message}`);
  process.exit(1);
}

/**
 * Run `fn` against a Vite module loader, so `.tsx`, CSS imports and `import.meta.env` all
 * resolve the way they do in the app.
 *
 * `configFile: false` on purpose. The app's config carries the Sentry plugin (which
 * uploads sourcemaps when a token is present — and one *is* present on the production
 * deploy) and a dev-only middleware plugin that `middlewareMode` would activate. None of
 * it has anything to do with rendering a component to a string, and all of it could act.
 */
async function withVite(fn) {
  const vite = await createServer({
    root: webRoot,
    configFile: false,
    appType: 'custom',
    server: { middlewareMode: true },
    logLevel: 'warn',
    // The entry and its tree use the automatic runtime — no `import React` anywhere.
    esbuild: { jsx: 'automatic' },
    // Nothing here runs in a browser, so there is nothing to pre-bundle for one. Left on,
    // the scanner crawls the entire app looking for imports to optimize — which means an
    // unrelated broken module (a stale `packages/origami-simulator/dist`, say) surfaces as
    // a scary esbuild error in the middle of a prerender that does not import it.
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  try {
    return await fn((path) => vite.ssrLoadModule(path));
  } finally {
    await vite.close();
  }
}

function injectIntoHead(html, snippet) {
  if (!html.includes('</head>')) fail('dist/index.html has no </head>');
  return html.replace('</head>', `  ${snippet}\n  </head>`);
}

/**
 * The markup goes *before* `#root`, as a sibling.
 *
 * Not inside it: `createRoot().render()` clears the container on mount, which would work
 * but makes React's first commit responsible for removing content it did not create.
 * A sibling is removed explicitly by `main.tsx`, in one place, where it can be read.
 */
function injectContent(html, id, markup) {
  const anchor = '<div id="root"></div>';
  if (!html.includes(anchor)) fail(`dist/index.html has no ${anchor}`);
  return html.replace(anchor, `<div id="${id}">${markup}</div>\n    ${anchor}`);
}

async function main() {
  const { entry, meta } = await withVite(async (load) => ({
    entry: await load('/src/seo/prerenderEntry.tsx'),
    meta: await load('/src/seo/siteMeta.ts'),
  }));
  const { SEO_CONTENT_ID, renderLandingMarkup, landingJsonLdScript } = entry;
  const { SITEMAP_PATHS, SITE_ORIGIN, siteUrl } = meta;

  const markup = renderLandingMarkup();
  // A render that silently produced nothing would sail through every later check: the
  // file would still be valid HTML, still deploy, still 200. Only the words would be
  // gone, which is the one thing nothing downstream inspects.
  if (markup.length < 1000) fail(`rendered markup is only ${markup.length} bytes — expected the landing page`);

  const source = await readFile(resolve(dist, 'index.html'), 'utf8');
  let html = injectContent(source, SEO_CONTENT_ID, markup);
  html = injectIntoHead(
    html,
    `<script type="application/ld+json">${landingJsonLdScript()}</script>`
  );

  if (!html.includes(`id="${SEO_CONTENT_ID}"`)) fail('content injection produced no marker');

  await writeFile(resolve(dist, 'index.html'), html);
  // `/welcome` holds the same page and canonicalises to `/`. Writing it as a real file
  // means a crawler that follows a link there gets the content directly rather than the
  // SPA fallback plus a client-side redirect.
  await mkdir(resolve(dist, 'welcome'), { recursive: true });
  await writeFile(resolve(dist, 'welcome/index.html'), html);

  const urls = SITEMAP_PATHS.map((path) => `  <url>\n    <loc>${siteUrl(path)}</loc>\n  </url>`).join('\n');
  await writeFile(
    resolve(dist, 'sitemap.xml'),
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );

  await writeFile(
    resolve(dist, 'robots.txt'),
    isProduction
      ? `User-agent: *\nAllow: /\n\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`
      : `# Not the production deploy (ORI_SITE_ENV is unset), so this host must not be\n# indexed — it serves the same copy as the real site on a public preview hostname.\nUser-agent: *\nDisallow: /\n`
  );

  console.log(
    `prerender-landing: ${markup.length} bytes of landing markup, ` +
      `sitemap with ${SITEMAP_PATHS.length} url(s), robots.txt ${isProduction ? 'allowing' : 'disallowing'} crawlers`
  );
}

main().catch((error) => fail(error.stack ?? String(error)));
