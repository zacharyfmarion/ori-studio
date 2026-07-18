import { create } from 'zustand';
import i18n from '../i18n';
import { DEFAULT_LOCALE, SUPPORTED_LOCALE_CODES } from '../i18n/locales';

/**
 * Reactive wrapper around i18next's active language.
 *
 * i18next (with the language detector) owns detection and localStorage persistence under
 * {@link LOCALE_STORAGE_KEY}; this store mirrors the active locale for the UI, keeps
 * `<html lang>` in sync, and exposes {@link setLocale}. It intentionally does not persist
 * separately — `changeLanguage` triggers the detector's cache.
 */

/** Map an arbitrary BCP-47 tag to the closest supported locale, else the default. */
export function normalizeLocale(code: string | undefined | null): string {
  if (!code) return DEFAULT_LOCALE;
  if (SUPPORTED_LOCALE_CODES.includes(code)) return code;
  const base = code.split('-')[0].toLowerCase();
  const exactBase = SUPPORTED_LOCALE_CODES.find((c) => c.toLowerCase() === base);
  if (exactBase) return exactBase;
  const byBase = SUPPORTED_LOCALE_CODES.find((c) => c.split('-')[0].toLowerCase() === base);
  return byBase ?? DEFAULT_LOCALE;
}

function applyHtmlLang(code: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

interface LocaleState {
  locale: string;
  setLocale: (code: string) => void;
}

export const useLocaleStore = create<LocaleState>()((set) => {
  const initial = normalizeLocale(i18n.resolvedLanguage ?? i18n.language ?? DEFAULT_LOCALE);
  applyHtmlLang(initial);

  // Reflect language changes from any source (e.g. changeLanguage elsewhere) into the store.
  i18n.on('languageChanged', (lng) => {
    const normalized = normalizeLocale(lng);
    applyHtmlLang(normalized);
    set({ locale: normalized });
  });

  return {
    locale: initial,
    setLocale: (code) => {
      void i18n.changeLanguage(normalizeLocale(code));
    },
  };
});
