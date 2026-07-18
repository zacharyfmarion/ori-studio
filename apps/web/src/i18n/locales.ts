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
  'cpVocab',
] as const;

export type I18nNamespace = (typeof I18N_NAMESPACES)[number];

export const DEFAULT_NAMESPACE: I18nNamespace = 'common';

/** localStorage key holding the user's chosen locale (shared with the language detector). */
export const LOCALE_STORAGE_KEY = 'treemaker-web-locale';
