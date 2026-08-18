import { readString, storageKey, STORAGE_KEYS } from '../lib/storage';

/**
 * Supported UI locales.
 *
 * `en` is the source of truth: English strings are authored inline in the code as
 * `t('key', 'English default')` and extracted into `public/locales/en/*.json`. The target
 * locales are translated (per surface) into `public/locales/<code>/*.json` and lazy-loaded
 * at runtime, so they never enter the JS bundle.
 */
export interface LocaleDescriptor {
  /** BCP-47 code, also the `public/locales/<code>` directory name. */
  code: string;
  /** Name in English (for docs / tooling). */
  englishName: string;
  /** Name in the language itself (shown in the language picker). */
  nativeName: string;
}

export const DEFAULT_LOCALE = 'en';

export const SUPPORTED_LOCALES: LocaleDescriptor[] = [
  { code: 'en', englishName: 'English', nativeName: 'English' },
  { code: 'ja', englishName: 'Japanese', nativeName: '日本語' },
  { code: 'zh-CN', englishName: 'Chinese (Simplified)', nativeName: '简体中文' },
  { code: 'es', englishName: 'Spanish', nativeName: 'Español' },
  { code: 'fr', englishName: 'French', nativeName: 'Français' },
  { code: 'de', englishName: 'German', nativeName: 'Deutsch' },
  { code: 'pt-BR', englishName: 'Portuguese (Brazil)', nativeName: 'Português (Brasil)' },
  { code: 'ru', englishName: 'Russian', nativeName: 'Русский' },
  { code: 'ko', englishName: 'Korean', nativeName: '한국어' },
];

/** Locale codes only, in display order. */
export const SUPPORTED_LOCALE_CODES: string[] = SUPPORTED_LOCALES.map((l) => l.code);

/**
 * i18next namespaces, one JSON file per surface area. `cpVocab` is generated from the
 * crease-pattern tool data module (see src/i18n/cpVocab.ts) rather than extracted from
 * inline `t()` calls.
 */
export const I18N_NAMESPACES = [
  'common',
  'menu',
  'panels',
  'dialogs',
  'tools',
  'toasts',
  'errors',
  'landing',
  'cpVocab',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

export const DEFAULT_NAMESPACE: I18nNamespace = 'common';

/** localStorage key holding the user's locale preference (a locale code or SYSTEM_LOCALE). */
export const LOCALE_STORAGE_KEY = storageKey(STORAGE_KEYS.locale);

/**
 * Sentinel preference meaning "follow the OS/browser locale" rather than a pinned language.
 * Stored in {@link LOCALE_STORAGE_KEY} when the user chooses "System default".
 */
export const SYSTEM_LOCALE = 'system';

/** A stored locale preference: a specific supported code, or "follow system". */
export type LocalePreference = string;

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

/** The supported locale that best matches the OS/browser language. */
export function detectSystemLocale(): string {
  const nav = typeof navigator !== 'undefined' ? navigator.language : undefined;
  return normalizeLocale(nav);
}

/**
 * The stored preference: a specific supported locale code the user pinned, or
 * {@link SYSTEM_LOCALE} when they follow the OS (also the default when nothing is stored).
 */
export function readStoredPreference(): LocalePreference {
  const stored = readString(LOCALE_STORAGE_KEY);
  return stored && SUPPORTED_LOCALE_CODES.includes(stored) ? stored : SYSTEM_LOCALE;
}

/** The language a stored preference resolves to: the pinned code, or the detected system locale. */
export function resolveLanguage(preference: LocalePreference): string {
  return preference === SYSTEM_LOCALE ? detectSystemLocale() : normalizeLocale(preference);
}

/** The language i18next should start in: the pinned code, or the detected system locale. */
export function resolveInitialLanguage(): string {
  return resolveLanguage(readStoredPreference());
}
