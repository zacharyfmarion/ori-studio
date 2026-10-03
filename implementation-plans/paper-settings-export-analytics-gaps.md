# Paper settings and export: close the analytics gaps

## Goal

A day-one read of Settings ▸ Paper and the paper export dialog in PostHog
(2026-10-02, about 29 hours after #417 shipped) could not answer its own
question. These were the gaps:

- **No denominator.** Nothing counts people who open Settings ▸ Paper:
  section views are not tracked, and the toolbar gear does not go through
  `command invoked`.
- **No source on edits.** `paper style changed` fires from Settings ▸ Paper and
  from the Simulate pane alike, and nothing on the event says which.
- **Untracked preset verbs.** "Save current as…", "Import…" and the Export
  style's Detach / Follow display send nothing. Downloading a preset is now
  counted, by #428's `paper preset exported`.
- **Silent export outcomes.** The export dialog reports neither a dismissed
  save dialog nor a failed save. A failure is shown inline and reaches neither
  PostHog nor Sentry. So "opened, never exported" cannot be split into
  "changed their mind" and "it broke".
- **No population view.** Events only count the people who changed a style,
  not the style everyone is running.

Close all of them, so that a re-read can answer the question.

## Approach

- **`settings section viewed { section }`**
  - Fires from the Settings dialog whenever the section on show changes,
    including the section it opens on.
  - It is a tested `use*Event` hook in `analytics/`, called from the view
    component.
  - It counts every way into Settings (the gear, File ▸ Settings, the shortcut)
    without touching how Settings opens.
  - The section list is written out in the taxonomy, like
    `PAPER_STYLE_FIELD_NAMES`. A test pins it to the store's `SettingsTab` in
    both directions.
- **`source` on `paper style changed`.** Three values:
  - `settings`: Settings ▸ Paper.
  - `simulator-view-controls`: the Simulate options pane, docked or in the
    touch View drawer. This is the name `view drawer opened`'s `pane` already
    uses.
  - `simulator`: the Simulate viewport's own verbs, meaning its lighting key
    binding and context-menu row.

  `useSimulatorPaperStyle(source)` takes the value from its two callers.
- **The untracked preset verbs:**
  - `paper preset saved { slot }`: "Save current as…", and the save the
    unsaved-changes prompt leads to.
  - `paper preset imported { slot, succeeded, reason }`: a file was read.
    `reason` is the parser's own `invalid-json` / `not-a-preset`, sent on a
    failure only. A cancelled picker counts nothing. An import that is then
    applied also counts as `paper preset applied { preset: custom }`, as it
    already did.
  - `paper export link changed { linked }`: Detach (`false`) or Follow display
    (`true`).
- **Export outcomes:**
  - `paper export dismissed { surface, scope, last_save }`: the reader closed
    the dialog without writing a file. `last_save` is how the last press of
    Export ended:
    - `none`: never pressed;
    - `cancelled`: the save dialog was dismissed;
    - `failed`: the save threw;
    - `stopped`: closed while a ZIP's pages were still painting.

    Fired by a `dismiss` verb on the binding, which the modal's close and
    Cancel use. A save that succeeds still closes through `close`, so every
    dialog the reader ends is exactly one `paper exported` or one
    `paper export dismissed`.
  - `paper export failed { surface, format, scope }`: every save that throws.
    The error itself goes to Sentry through `reportError`, with
    `surface: 'paper-export'`.
- **Super properties `paper_display_style` and `paper_export_style`:**
  - Values: `default`, `diagram`, `custom` (a preset the user saved or
    imported, unedited) or `unsaved` (no saved preset holds the style: #428's
    word). The export slot reads `linked` while it follows display.
  - Computed from the settings store by a pure function beside the analytics
    layer.
  - `AnalyticsRuntimeProvider` registers them the way it registers `locale`,
    but only when a value changes, since a colour drag writes the store on
    every pointer move.
- **Docs:** the events table and the super-property paragraph in
  `docs/analytics.md`.
- **Names checked against PostHog.** Property types are project-wide:
  `source`, `section` and `reason` are String and `succeeded` is Boolean. The
  new names `linked`, `last_save`, `paper_display_style` and
  `paper_export_style` were unused across 70 days of events.

## Affected Areas

- `apps/web/src/analytics/` — `events.ts`, `index.ts`, `runtime.tsx`, a new
  `useSettingsSectionViewedEvent.ts` and `paperStyleProperties.ts`, and tests.
- `apps/web/src/components/SettingsModal.tsx` — calls the section hook.
- `apps/web/src/components/settings/usePaperSettings.ts` — `source`, saved,
  imported, link changed.
- `apps/web/src/simulator/useSimulatorPaperStyle.ts`, its two callers in
  `components/panels/` (one argument each).
- `apps/web/src/paperExport/usePaperExportDialog.ts`,
  `components/paperExport/PaperExportModal.tsx` — `dismiss`, failed.
- `docs/analytics.md`.

## Checklist

- [x] Plan
- [x] `settings section viewed`: hook and test, wired into the Settings dialog, dialog test
- [x] `paper style changed { source }`: both hooks, both panels' arguments, tests updated
- [x] `paper preset saved`, `paper preset imported`, `paper export link changed`, with tests
- [x] `paper export failed` (and Sentry) and `paper export dismissed`, with tests
- [x] `paper_display_style` / `paper_export_style` super properties, with tests
- [x] `docs/analytics.md`
- [x] Browser: every event and both super properties, seen leaving the app
  (posthog-js debug mode against a dead local host). Import and the three save
  endings — cancelled, failed, stopped — are left to the unit tests, since
  they need a file picker or a real download.
- [x] lint, typecheck, unit tests, i18n check
- [x] Draft PR

## Follow-ups

- A "Paper style & export" PostHog dashboard once this ships, with:
  - opened → exported or dismissed (by `last_save`), per surface;
  - section views → paper edits by `source`;
  - the population by `paper_display_style` and `paper_export_style`.
