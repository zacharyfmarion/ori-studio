#!/usr/bin/env node
/**
 * Put every site page into `dist` as real HTML, and generate the two files search engines
 * read.
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
 * The markup comes from the same components the app renders, so the two cannot describe
 * a page differently. Which pages exist, what each one's `<head>` says and where each one
 * lands are all answered by `src/site/sitePages.ts` through `prerenderSite` — this script
 * only loads the template and writes what it is handed. That split is what makes the
 * assembly testable: the failure it guards against (a page carrying the homepage's
 * canonical) deploys and serves without a sound.
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

async function main() {
  const template = await readFile(resolve(dist, 'index.html'), 'utf8');

  const { files, paths, meta } = await withVite(async (load) => {
    const entry = await load('/src/seo/prerenderEntry.tsx');
    const pages = await load('/src/site/sitePages.ts');
    return {
      files: entry.prerenderSite(template),
      paths: pages.SITEMAP_PATHS,
      meta: await load('/src/seo/siteMeta.ts'),
    };
  });
  const { SITE_ORIGIN, siteUrl } = meta;

  for (const { file, html, page } of files) {
    // A render that silently produced nothing would sail through every later check: the
    // file would still be valid HTML, still deploy, still 200. Only the words would be
    // gone, which is the one thing nothing downstream inspects.
    const size = html.length - template.length;
    if (size < 1000) fail(`${page.path} rendered only ${size} bytes of markup — expected a page`);
    const target = resolve(dist, file);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, html);
  }

  const urls = paths.map((path) => `  <url>\n    <loc>${siteUrl(path)}</loc>\n  </url>`).join('\n');
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

  const written = files.map(({ file }) => file).join(', ');
  console.log(
    `prerender-landing: wrote ${files.length} file(s) (${written}), ` +
      `sitemap with ${paths.length} url(s), robots.txt ${isProduction ? 'allowing' : 'disallowing'} crawlers`
  );
}

main().catch((error) => fail(error.stack ?? String(error)));
