import { createInstance } from 'i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { landingJsonLdScript } from './jsonLd';
import { SEO_CONTENT_ID } from './siteMeta';
import { StaticLanding } from './StaticLanding';

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

/** The landing page as static HTML, with no React runtime attached to it. */
export function renderLandingMarkup(): string {
  const i18n = createPrerenderI18n();
  return renderToStaticMarkup(
    <I18nextProvider i18n={i18n}>
      <StaticLanding />
    </I18nextProvider>
  );
}

export { landingJsonLdScript, SEO_CONTENT_ID };
