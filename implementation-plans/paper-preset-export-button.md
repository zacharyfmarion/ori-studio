# Paper preset Export button

## Goal

Settings ▸ Paper can import a preset file from a button under the list, but the
only way to export one is a download icon that appears while a card is hovered,
and users do not find it. Add a visible **Export…** beside **Import…**, and
rename the slot switch to **Display style** / **Export style** so the switch no
longer reads as a second export button.

## Approach

- **Export… writes the style the slot is showing.** While that style is a
  preset's, unedited, the preset itself goes, exactly as its card's download
  writes it — one press, no questions. A style with unsaved edits (changed since
  its preset was applied, or nobody's) has no preset to carry it, and a preset
  file needs a name: the button opens the in-place name field "Save current as…"
  already uses, in an export mode — prefilled (and selected) with the applied
  preset's name when there is one, a line saying why it asks, and Export /
  Cancel. Exporting never adds to the list; saving stays "Save current as…"'s
  job.
- `usePaperSettings` gets `exportStyle(name)` (the slot's style, as a preset
  called `name`, normalised like a save) beside `exportPreset(row, source)`.
  Which of the two the button takes is the section's call, as naming already is.
- **Rename** in `PaperSlotHeader`: "Display style", "Export style", "Export style ·
  linked". Sentence case, matching the export dialog's style picker, which
  already names this slot "Export style · …".
- **Analytics:** `paper preset exported { slot, source: button | card, preset,
  unsaved }`, fired from the hook after a save actually writes. `source` answers
  whether the hover-only icon was ever the way people exported; `unsaved` whether
  the name step earns its place. The file service's `file exported` still fires.
- i18n: three new keys, three reworded ones, all eight locales translated from
  each locale's own sibling strings, then stamped.
- **Layout.** Three buttons side by side are wider than a phone's column, and a
  flex row that cannot wrap holds the section's grid column at its own width —
  the cards went past the edge with it. The row wraps. That is a change to the
  presets section's styles, so its block moved into
  `PaperPresetsSection.module.css` first, in a commit of its own, proven
  identical (computed styles of every element, three states, two widths, two
  themes: 0 differences).

## Affected Areas

- `apps/web/src/components/settings/PaperPresetsSection.tsx` (+ new
  `PaperPresetsSection.module.css`) — Export… button, name field export mode,
  wrapping verbs row.
- `apps/web/src/components/settings/usePaperSettings.ts` — `exportStyle`,
  `exportPreset(row, source)`, analytics.
- `apps/web/src/components/settings/PaperSlotHeader.tsx` — slot labels.
- `apps/web/src/styles/theme.css`, `globalStylesheets.test.ts` — the moved rules,
  the lowered ceiling.
- `apps/web/src/analytics/events.ts`, `analytics/index.ts`, `docs/analytics.md` —
  the new event.
- `apps/web/public/locales/*/dialogs.json`, `.hashes.json` — strings.
- Tests: `usePaperSettings.test.tsx`, `PaperSettings.test.tsx`.

## Checklist

- [x] `exportStyle` + `exportPreset(row, source)` with the analytics event; hook tests
- [x] Export… button and the name field's export mode; component tests
- [x] Slot switch renamed; tests updated
- [x] Analytics docs row; i18n extract, eight locales translated, stamped, `i18n:check`
- [x] Presets section's CSS moved into its module (own commit, proven unchanged); verbs wrap
- [x] Browser: export in one press, export with a name, re-import the file, rename shown,
      export slot, phone width and every locale fit
- [x] lint, typecheck, unit tests (full web suite); draft PR

## Follow-ups

- With the longer switch labels, a saved preset with edits shows Update and
  Revert on a second line under the switch. The slot row already wrapped like
  this for longer preset names. Keeping the chip and its verbs together needs
  the slot header's styles in a module, and its Update / Revert look is an
  override of the shared `Chip`, which moves in a PR of its own
  (`apps/web/docs/styling.md`).
