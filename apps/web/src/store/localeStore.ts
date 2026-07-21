import { create } from 'zustand';
import i18n from '../i18n';
import { writeString } from '../lib/storage';
import {
  detectSystemLocale,
  LOCALE_STORAGE_KEY,
  normalizeLocale,
  readStoredPreference,
  SYSTEM_LOCALE,
  type LocalePreference,
} from '../i18n/locales';

/**
 * Owns the user's language preference and keeps i18next + `<html lang>` in sync.
 *
 * The preference is either a pinned locale code or {@link SYSTEM_LOCALE} ("follow the OS").
 * This store — not the i18next language detector — persists it to {@link LOCALE_STORAGE_KEY},
 * so "System default" keeps tracking the OS locale across reloads instead of pinning the
 * first detected language.
 */

// Re-exported for existing importers/tests.
export { normalizeLocale };

function applyHtmlLang(code: string): void {
  if (typeof document !== 'undefined') document.documentElement.lang = code;
}

function persistPreference(preference: LocalePreference): void {
  writeString(LOCALE_STORAGE_KEY, preference);
}

interface LocaleState {
  /** The active (resolved) locale code i18next is currently using. */
  locale: string;
  /** The stored preference: a locale code, or `SYSTEM_LOCALE` to follow the OS. */
  preference: LocalePreference;
  /** Pick a locale, or `SYSTEM_LOCALE` to follow the OS/browser locale. */
  setLocale: (preference: LocalePreference) => void;
}

export const useLocaleStore = create<LocaleState>()((set) => {
  const initialPreference = readStoredPreference();
  const initial = normalizeLocale(i18n.resolvedLanguage ?? i18n.language ?? SYSTEM_LOCALE);
  applyHtmlLang(initial);

  // Reflect language changes from any source into the store.
  i18n.on('languageChanged', (lng) => {
    const normalized = normalizeLocale(lng);
    applyHtmlLang(normalized);
    set({ locale: normalized });
  });

  return {
    locale: initial,
    preference: initialPreference,
    setLocale: (preference) => {
      if (preference === SYSTEM_LOCALE) {
        persistPreference(SYSTEM_LOCALE);
        set({ preference: SYSTEM_LOCALE });
        void i18n.changeLanguage(detectSystemLocale());
        return;
      }
      const code = normalizeLocale(preference);
      persistPreference(code);
      set({ preference: code });
      void i18n.changeLanguage(code);
    },
  };
});
