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

Do **not** hand-edit `public/locales/en/*.json` — every English catalog is generated, the
parser-managed ones by `i18n:extract` and `en/cpVocab.json` by `cpVocab.gen.test.ts`.

**Target-locale files are hand-written, `cpVocab.json` included, and safe to edit directly.** Only
the *English* cpVocab catalog is generated; `extract.mjs` snapshots each target's cpVocab before the
parser runs and restores it through `mirrorStructure()`, which preserves existing translations and
only adds empty slots for new keys. So a fix to `ja/cpVocab.json` survives `i18n:extract`. The one
constraint is that a target's cpVocab keys must mirror English exactly — `mirrorStructure()` prunes
target-only keys.

Keep `{{interpolation}}` placeholders and `<Trans>` markup identical across locales; `i18n:check`
enforces this. A translation may additionally use `{{count}}` on a plural-suffixed key even when the
English form spells the number out (`"This changes 1 shortcut."` → `"Esto cambia {{count}} atajos."`),
because i18next always supplies `count` to a plural key.

**Editing an existing translation needs no re-stamp.** `.hashes.json` stores a hash of the *English*
value, so it only detects English drifting out from under a translation. Rewording a target-locale
string cannot desync it, and `i18n:stamp` is only for after you translate a new or reworded key.
