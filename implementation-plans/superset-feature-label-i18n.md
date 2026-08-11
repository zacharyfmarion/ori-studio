# Superset-feature label i18n

## Goal

Stop the export-loss confirmation from showing English in a non-English locale.
The names of the features an export would drop (`Images`, `Rich text
formatting`, …) live as plain `label` strings in a data module, so the i18n
extractor never sees them and `i18n:check` passes while they ship untranslated
in all eight locales ([#237](https://github.com/zacharyfmarion/ori-studio/issues/237)).

## Approach

Follow the shape `apps/web/CLAUDE.md` already prescribes for this case — "for a
data-module label, a render-site helper with literal-key `t()` calls" — the same
pattern as `i18n/enumLabels.ts` and `i18n/paletteLabels.ts`.

1. Give `supersetFeatures.ts` a `SupersetFeatureId` union and **drop `label`
   from the data table** entirely. Leaving an untranslated English string in the
   record is what leaked in the first place; removing it makes the localized
   helper the only way to name a feature.
2. Add `i18n/supersetFeatureLabels.ts`: `supersetFeatureLabel(t, id)` as an
   exhaustive switch of literal-key `t()` calls, plus `describeExportLoss(t,
   warnings)` (moved out of the data module, which stays React- and
   translator-free). The switch has no `default`, so under `strict` a new id
   added without a translation is a **type error** — the next superset feature
   cannot ship untranslated.
3. Translate the surrounding dialog copy too. The labels reach the user inside
   the export-loss confirmation, whose title, message, and buttons are also
   hard-coded English in `projectSlice.ts`; translating only the labels would
   render a mixed-language sentence, which is not the outcome the issue asks
   for. `projectSlice.ts` already imports `i18n` for the close-design dialog.
4. Extract, translate all 8 locales, stamp, check.

Only the five features on `main` are covered. [#235](https://github.com/zacharyfmarion/ori-studio/pull/235)
is still open and adds two more; with this in place that branch adds one `case`
each, and the compiler will insist.

## Affected Areas

- `apps/web/src/lib/supersetFeatures.ts` (+ test)
- `apps/web/src/i18n/supersetFeatureLabels.ts` (new, + test)
- `apps/web/src/store/workspaceStore/slices/projectSlice.ts`
- `apps/web/public/locales/*/dialogs.json` (9 locales)
- `apps/web/docs/superset-features.md`

## Checklist

- [x] `SupersetFeatureId` union; `label` removed from the data table
- [x] `i18n/supersetFeatureLabels.ts` with exhaustive literal-key switch
- [x] `describeExportLoss` moved and localized
- [x] Export-loss dialog copy in `projectSlice.ts` routed through `i18n.t`
- [x] Tests updated/added
- [x] `i18n:extract` → translate 8 locales → `i18n:stamp` → `i18n:check`
- [x] Docs updated
- [x] lint / typecheck / unit tests

The compiler obligation is verified, not assumed: adding a sixth id to the union
without a `case` fails with `TS2366 … lacks ending return statement`, pointed at
the helper.
