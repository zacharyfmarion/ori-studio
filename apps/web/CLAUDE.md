# apps/web — agent notes

## Internationalization (i18n)

User-facing strings are localized with react-i18next. **English is the single source of
truth, authored inline** as `t('<namespace>:<key.path>', 'English default')` (see
`docs/i18n.md` for the full architecture).

**When you add or change any user-facing string:**

1. Write it as `t('<ns>:<key>', 'English default')` (or, for a data-module label, a
   render-site helper with literal-key `t()` calls — the extractor only sees literals).
   Namespaces: `common`, `menu`, `panels`, `dialogs`, `tools`, `toasts`, `errors`, and the
   generated `cpVocab`.
2. Run **`npm run i18n:extract`** to regenerate the English catalogs from your inline
   defaults, then translate the new/changed keys for all 8 locales (ja, zh-CN, es, fr, de,
   pt-BR, ru, ko) in `public/locales/<lng>/<ns>.json`, and run **`npm run i18n:stamp`**.
3. Run **`npm run i18n:check`** — it must pass. CI runs it too, so a PR that adds an English
   string without translations (or lets English drift from source) fails.

Do **not** hand-edit `public/locales/en/*.json` or `public/locales/*/cpVocab.json` — they are
generated (`i18n:extract` / `cpVocab.gen.test.ts`). Keep `{{interpolation}}` placeholders and
`<Trans>` markup identical across locales.
