// Configuration for i18next-parser.
//
// The parser scans the source for `t('<ns>:<key.path>', 'English default')` calls and
// generates the English catalogs under public/locales/en/. English is the single source of
// truth — it always reflects the inline defaults (see `resetDefaultValueLocale`). Target
// locales get empty slots for new keys (filled per surface by the translation agent) and
// their existing values are preserved across runs.
//
// `i18n:check` re-runs this parser with I18N_OUTPUT_DIR pointing at a temp dir to prove the
// committed English catalog matches the source without mutating anything.

const OUTPUT_DIR = process.env.I18N_OUTPUT_DIR || 'public/locales';

export default {
  locales: ['en', 'ja', 'zh-CN', 'es', 'fr', 'de', 'pt-BR', 'ru', 'ko'],
  defaultNamespace: 'common',
  namespaceSeparator: ':',
  keySeparator: '.',
  contextSeparator: '__',
  pluralSeparator: '_',

  input: ['src/**/*.{ts,tsx}'],
  output: `${OUTPUT_DIR}/$LOCALE/$NAMESPACE.json`,

  // English is regenerated fresh from the inline defaults every run (i18n:extract deletes
  // the en catalog first), so it always matches source. Target locales keep their existing
  // translations across runs — when an English default changes, the old translation is
  // retained but flagged stale by `i18n:check` (via the source-hash sidecar), rather than
  // silently blanked. Hence no `resetDefaultValueLocale`.
  keepRemoved: false,
  createOldCatalogs: false,
  sort: true,
  indentation: 2,
  lineEnding: 'lf',

  // English default (the 2nd arg to `t`) is written only into the English catalog; every
  // target locale starts empty so `i18n:check` can flag it as untranslated.
  defaultValue: (locale, _namespace, _key, value) => (locale === 'en' ? (value ?? '') : ''),
};
