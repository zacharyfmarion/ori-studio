import { createInstance, type i18n as I18n, type Resource, type ResourceLanguage } from 'i18next';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { StaticRouter } from 'react-router-dom';
import { desktopDownloadCtaLabel } from '../components/download/desktopBuildLabels';
import { DEFAULT_LOCALE, I18N_NAMESPACES } from '../i18n/locales';
import { ServerPhoneSurface } from '../platform/serverPhoneSurface';
import { SITE_PAGE_CONTENT } from '../site/sitePageContent';
import { sitePageDescription, sitePageTitle } from '../site/sitePageLabels';
import { LANDING_PAGE, PAGE_LOCALES, pagePath, SITE_PAGES, type SitePage } from '../site/sitePages';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, PRESET_THEMES, themeCssVariables } from '../themes';
import { escapeForScriptTag } from './jsonLd';
import {
  buildPageHtml,
  entryScriptPath,
  outputFilesForPage,
  type PageMeta,
  type StaticPaint,
} from './prerenderHtml';
import { SEO_CONTENT_ID } from './siteMeta';
import type { StaticPaintBodyConfig, StaticPaintHeadConfig } from './staticPaint';

/** `apps/web/public/locales`, resolved from this file so it holds under Vite SSR and Vitest. */
const LOCALES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'public', 'locales');

/**
 * The catalogs for one locale, read from disk.
 *
 * From disk and not through the app's `i18n` module: that one installs an HTTP backend and
 * reads `import.meta.env.BASE_URL`, neither of which means anything under Node. The files
 * are the same ones the running app fetches, so the prerendered Chinese and the Chinese a
 * reader gets after the JS arrives are the same strings — which is the invariant every bit
 * of this depends on.
 */
export function loadLocaleResources(locale: string): Resource {
  const namespaces: ResourceLanguage = {};
  for (const ns of I18N_NAMESPACES) {
    namespaces[ns] = JSON.parse(readFileSync(join(LOCALES_DIR, locale, `${ns}.json`), 'utf8')) as ResourceLanguage[string];
  }
  return { [locale]: namespaces };
}

/**
 * An i18next instance for one locale.
 *
 * **English has no resources at all**, and that looks wrong and is exactly right. Every
 * `t()` call in this codebase carries an inline English default (see `apps/web/CLAUDE.md`),
 * and i18next returns that default whenever the key is missing — which, with no catalogs
 * loaded, is always. So English renders precisely the words a browser shows before any
 * locale JSON arrives, and cannot drift from the source, because the source *is* the
 * default. Loading `public/locales/en/*.json` instead would be strictly worse: those files
 * are generated *from* these defaults by `i18n:extract`, so it would add a build-order
 * dependency and a chance to disagree, in exchange for nothing.
 *
 * **Every other locale loads its catalogs**, because for those the catalog is the source.
 * A key with no translation falls back to the inline English, the same as the app does.
 */
function createPrerenderI18n(locale: string): I18n {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: locale,
    fallbackLng: DEFAULT_LOCALE,
    resources: locale === DEFAULT_LOCALE ? {} : loadLocaleResources(locale),
    ns: I18N_NAMESPACES,
    defaultNS: 'common',
    returnEmptyString: false,
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
  });
  return instance;
}

/**
 * A site page as static HTML in one locale, with no React runtime attached to it.
 *
 * Inside a `StaticRouter` at the page's own localized path, because the nav is made of
 * `Link`s that mark the current page and link within the current locale — the same markup
 * the live route renders, which is the point.
 */
export function renderPageMarkup(
  page: SitePage,
  locale: string = DEFAULT_LOCALE,
  { phone = false }: { phone?: boolean } = {}
): string {
  const i18n = createPrerenderI18n(locale);
  const Content = SITE_PAGE_CONTENT[page.id];
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <StaticRouter location={pagePath(page, locale)}>
        <ServerPhoneSurface.Provider value={phone}>
          <Content />
        </ServerPhoneSurface.Provider>
      </StaticRouter>
    </I18nextProvider>
  );
}

/**
 * Whether a page's copy can be its own first paint (`staticPaint.ts`). The English landing
 * only, for now: it is the page PageSpeed measures, and `scripts/static-paint-check.mjs`
 * holds it to zero differing pixels. Every other copy is removed before it paints.
 */
export function paintsStatically(page: SitePage, locale: string): boolean {
  return page.id === LANDING_PAGE.id && locale === DEFAULT_LOCALE;
}

/** The paths a page's files are served at, as the router sees them: no trailing slash. */
function servedPaths(page: SitePage, locale: string): string[] {
  return outputFilesForPage(page, locale).map(
    (file) => `/${file.replace(/(^|\/)index\.html$/, '')}`.replace(/\/$/, '') || '/'
  );
}

/** Everything the two static-paint scripts need to know about a page that only the build knows. */
export function staticPaintConfig(
  page: SitePage,
  locale: string = DEFAULT_LOCALE,
  entry = '/assets/index.js'
): { head: StaticPaintHeadConfig; body: StaticPaintBodyConfig } {
  const { t } = createPrerenderI18n(locale);
  const themes = [DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME];
  return {
    head: {
      paths: servedPaths(page, locale),
      locale,
      themes: Object.fromEntries(
        themes.map((theme) => [theme.name, { type: theme.type, variables: themeCssVariables(theme) }])
      ),
      presetNames: PRESET_THEMES.map((theme) => theme.name),
      defaultThemes: { dark: DEFAULT_DARK_THEME.name, light: DEFAULT_LIGHT_THEME.name },
    },
    body: {
      downloadLabels: {
        macos: desktopDownloadCtaLabel(t, 'macos'),
        windows: desktopDownloadCtaLabel(t, 'windows'),
        linux: desktopDownloadCtaLabel(t, 'linux'),
        none: desktopDownloadCtaLabel(t, null),
      },
      entry,
    },
  };
}

/**
 * `staticPaintHead.ts` and `staticPaintBody.ts`, each bundled as an IIFE that defines
 * `__oriStaticPaint` (see `scripts/prerender-landing.mjs`).
 */
export interface StaticPaintScripts {
  head: string;
  body: string;
}

/** A bundle called with its config, wrapped so `__oriStaticPaint` stays local to its script. */
function callBundle(bundle: string, fn: string, config: unknown): string {
  return `(function(){${bundle}\n__oriStaticPaint.${fn}(${escapeForScriptTag(JSON.stringify(config))})})()`;
}

function staticPaintFor(page: SitePage, locale: string, scripts: StaticPaintScripts, entry: string): StaticPaint {
  const config = staticPaintConfig(page, locale, entry);
  return {
    phoneMarkup: renderPageMarkup(page, locale, { phone: true }),
    headScript: callBundle(scripts.head, 'decideStaticPaint', config.head),
    bodyScript: callBundle(scripts.body, 'finishStaticPaint', config.body),
  };
}

/** The title and description a page carries in a locale — what its `<head>` says. */
export function pageMeta(page: SitePage, locale: string = DEFAULT_LOCALE): PageMeta {
  const { t } = createPrerenderI18n(locale);
  return { title: sitePageTitle(t, page.id), description: sitePageDescription(t, page.id) };
}

/** The English landing alone — what the smoke tests and the older call sites ask for. */
export function renderLandingMarkup(): string {
  return renderPageMarkup(LANDING_PAGE);
}

/** One finished file for the build script to write. */
export interface PrerenderedFile {
  /** `dist`-relative path. */
  file: string;
  html: string;
  page: SitePage;
  locale: string;
}

/**
 * Every file the prerender writes, from the built `index.html`: each page, in each locale.
 *
 * The whole site in one call, so the script that writes files has nothing to decide: which
 * pages exist, which languages, what each one's head says, where each one lands — all of it
 * is answered here from the registry, and all of it is testable without a Vite server.
 */
export function prerenderSite(template: string, paintScripts?: StaticPaintScripts): PrerenderedFile[] {
  // A painted page's body script is what starts the app, so a template it cannot find the
  // entry in must stop the build rather than ship a page that never boots.
  const entry = paintScripts ? entryScriptPath(template) : null;
  if (paintScripts && !entry) throw new Error('index.html has no module entry script for the body script to start');
  return PAGE_LOCALES.flatMap((locale) =>
    SITE_PAGES.flatMap((page) => {
      const paint =
        paintScripts && entry && paintsStatically(page, locale)
          ? staticPaintFor(page, locale, paintScripts, entry)
          : undefined;
      const html = buildPageHtml(
        template,
        page,
        locale,
        renderPageMarkup(page, locale),
        pageMeta(page, locale),
        paint
      );
      return outputFilesForPage(page, locale).map((file) => ({ file, html, page, locale }));
    })
  );
}

export { SEO_CONTENT_ID };
