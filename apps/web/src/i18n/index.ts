import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import {
  DEFAULT_LOCALE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  resolveInitialLanguage,
  SUPPORTED_LOCALE_CODES,
} from './locales';

/**
 * i18next initialization.
 *
 * The initial language is resolved by {@link resolveInitialLanguage}: a pinned locale the
 * user chose, otherwise the OS/browser locale. Persistence is owned by `store/localeStore.ts`
 * (not the language detector), so choosing "System default" keeps following the OS instead of
 * silently pinning the first detected language.
 *
 * Every `t()` call carries an inline English default, so components render correct English
 * immediately even before a namespace JSON loads — no Suspense fallback, no missing-text
 * flash. Target-locale catalogs are fetched on demand from `public/locales/<lng>/<ns>.json`
 * and stay out of the JS bundle.
 */
export const i18nReady = i18n
  .use(HttpBackend)
  .use(initReactI18next)
  .init({
    lng: resolveInitialLanguage(),
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALE_CODES,
    nonExplicitSupportedLngs: true,
    load: 'currentOnly',
    ns: I18N_NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    // Any untranslated key (empty-string seed) falls back to the inline English default
    // instead of rendering blank. (During Phase 3 translation this was temporarily `true` so
    // untranslated surfaces showed blank as a progress marker.)
    returnEmptyString: false,
    interpolation: {
      // React already escapes rendered values.
      escapeValue: false,
    },
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
    },
    react: {
      // Inline English defaults cover the pre-load window, so Suspense is unnecessary.
      useSuspense: false,
    },
  });

export default i18n;
