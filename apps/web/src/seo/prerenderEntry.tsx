import { createInstance } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { StaticRouter } from 'react-router-dom';
import { SITE_PAGE_CONTENT } from '../site/sitePageContent';
import { LANDING_PAGE, SITE_PAGES, type SitePage } from '../site/sitePages';
import { buildPageHtml, outputFilesForPage } from './prerenderHtml';
import { SEO_CONTENT_ID } from './siteMeta';

/**
 * An i18next instance with **no resources at all**.
 *
 * This looks wrong and is exactly right. Every `t()` call in this codebase carries an
 * inline English default (see `apps/web/CLAUDE.md`), and i18next returns that default
 * whenever the key is missing — which, with no catalogs loaded, is always. So this
 * renders precisely the English a browser shows before any locale JSON arrives, and it
 * cannot drift from the source, because the source *is* the default.
 *
 * Loading `public/locales/en/*.json` instead would be strictly worse: those files are
 * generated *from* these defaults by `i18n:extract`, so it would add a build-order
 * dependency and a chance to disagree, in exchange for nothing.
 *
 * A private instance rather than `src/i18n` — that module installs an HTTP backend and
 * reads `import.meta.env.BASE_URL`, neither of which means anything under Node.
 */
function createPrerenderI18n() {
  const instance = createInstance();
  void instance.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    resources: {},
    react: { useSuspense: false },
    interpolation: { escapeValue: false },
  });
  return instance;
}

/**
 * A site page as static HTML, with no React runtime attached to it.
 *
 * Inside a `StaticRouter` at the page's own path, because the nav is made of `Link`s and
 * marks the current page — the same markup the live route renders, which is the point.
 */
export function renderPageMarkup(page: SitePage): string {
  const i18n = createPrerenderI18n();
  const Content = SITE_PAGE_CONTENT[page.id];
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <StaticRouter location={page.path}>
        <Content />
      </StaticRouter>
    </I18nextProvider>
  );
}

/** The landing alone — what the smoke tests and the older call sites ask for. */
export function renderLandingMarkup(): string {
  return renderPageMarkup(LANDING_PAGE);
}

/** One finished file for the build script to write. */
export interface PrerenderedFile {
  /** `dist`-relative path. */
  file: string;
  html: string;
  page: SitePage;
}

/**
 * Every file the prerender writes, from the built `index.html`.
 *
 * The whole site in one call, so the script that writes files has nothing to decide: which
 * pages exist, what each one's head says, where each one lands — all of it is answered
 * here from the registry, and all of it is testable without a Vite server.
 */
export function prerenderSite(template: string): PrerenderedFile[] {
  return SITE_PAGES.flatMap((page) => {
    const html = buildPageHtml(template, page, renderPageMarkup(page));
    return outputFilesForPage(page).map((file) => ({ file, html, page }));
  });
}

export { SEO_CONTENT_ID };
