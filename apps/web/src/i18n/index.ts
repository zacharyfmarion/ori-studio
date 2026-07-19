import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import HttpBackend from 'i18next-http-backend';
import LanguageDetector from 'i18next-browser-languagedetector';
import {
  DEFAULT_LOCALE,
  DEFAULT_NAMESPACE,
  I18N_NAMESPACES,
  LOCALE_STORAGE_KEY,
  SUPPORTED_LOCALE_CODES,
} from './locales';

/**
 * i18next initialization.
 *
 * Every `t()` call in the app carries an inline English default, so components render
 * correct English immediately even before a namespace JSON has loaded — no Suspense
 * fallback and no missing-text flash. Target-locale catalogs are fetched on demand from
 * `public/locales/<lng>/<ns>.json` and therefore stay out of the JS bundle.
 */
export const i18nReady = i18n
  .use(HttpBackend)
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    fallbackLng: DEFAULT_LOCALE,
    supportedLngs: SUPPORTED_LOCALE_CODES,
    nonExplicitSupportedLngs: true,
    load: 'currentOnly',
    ns: I18N_NAMESPACES,
    defaultNS: DEFAULT_NAMESPACE,
    // DURING PHASE 3 (translation): keep `true` so untranslated keys (empty-string seeds)
    // render BLANK — a visible marker of what still needs translating, surface by surface.
    // BEFORE MERGE: flip to `false` so empty keys fall back to the inline English default in
    // production. See the "Pre-merge verification" phase in
    // implementation-plans/translations-localization.md.
    returnEmptyString: true,
    interpolation: {
      // React already escapes rendered values.
      escapeValue: false,
    },
    backend: {
      loadPath: `${import.meta.env.BASE_URL}locales/{{lng}}/{{ns}}.json`,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LOCALE_STORAGE_KEY,
      caches: ['localStorage'],
    },
    react: {
      // Inline English defaults cover the pre-load window, so Suspense is unnecessary.
      useSuspense: false,
    },
  });

export default i18n;
