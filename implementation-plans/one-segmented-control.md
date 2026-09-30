# One segmented control

## Goal

Every inline "pick one of a few" control in the app looks and behaves like the
Paper settings slot switch (Display / Export · linked): a padded track with
separate rounded pills inside it, the chosen pill tinted. One component draws
it, and no screen restyles it with CSS of its own.

## What is there today

**The two looks are already one component.** The Paper tab's switch and the
export dialog's SVG / PNG are both `SegmentedControl`
(`apps/web/src/components/ui/SegmentedControl.tsx`). The component's own style
(`theme.css` `.segmented`, ~line 1356) is the flush box divided by hairlines —
what the export dialog shows. The Paper tab gets its pills from an override
scoped to the tab (`.settings-paper .segmented`, ~line 3013), and the slot
switch is made larger by another (`.settings-paper__slot-row .segmented`). So
the look the user prefers exists only inside Settings ▸ Paper.

**Where `SegmentedControl` is used** (10 sites, all through the one component):

| Site | Choice | Layout today |
| --- | --- | --- |
| `settings/PaperSlotHeader.tsx` | Display / Export | pills, larger (28px pills) — *the target look* |
| `settings/PaperPenCard.tsx` | a pen's Cap | pills, stretched to its field |
| `paperExport/PaperExportOptions.tsx` | Format (SVG / PNG) | flush, stretched full width |
| `paperExport/PaperExportOptions.tsx` | This step / All steps | flush, stretched full width |
| `CreaseExportDialog.tsx` | Appearance; folded Side | flush, hugging |
| `share/ShareLinkModal.tsx` | folded Side | flush, hugging |
| `WorkspaceViewDrawer.tsx` | the phone view drawer's panes, when it has several | flush, hugging |
| `panels/CpContextToolPanel.tsx` | a tool's mode, in the context panel | flush, stretched to the column |
| `toolOptions/SquareToolOptions.tsx` | square tool options | flush, hugging |
| `properties/PropertySheetView.tsx` via `ui/fieldRows/SegmentedRow.tsx` | segmented property rows | flush, hugging, right-aligned |

**Context CSS that restyles it** (all in `theme.css`):
`.export-modal .segmented` (stretch), `.settings-paper .segmented` (pills),
`.settings-paper__slot-row .segmented` (size), `.settings-paper-pen__field
.segmented` (stretch + height), `.cp-context-panel__group .segmented`
(stretch), `.control-row__value--segmented` (alignment in a field row), and
`.simulator-view-settings .segmented__option` — which matches nothing any more
(no component renders that class) and is dead.

**Hand-built look-alikes** — the same interaction, not the component:

- The CP tool rail's line types (`panels/CpToolRail.tsx`, CSS
  `.cp-tool-rail__buttons[data-group='line-type']`): tool-rail buttons drawn
  as a flush divided group. Icon-only; each carries the rail's tooltip with its
  shortcut and the press-and-hold label on touch.
- The phone tool sheet's line types (`toolCatalog/CpToolPickerSheet.tsx`, CSS
  `.cp-tool-picker__types`): a hand-built radio group; picking one closes the
  sheet.
- ExplOri's Symmetry (`panels/ExploriQueryBar.tsx`, CSS
  `.explori-symmetry-group`): a flush divided group — but **multi-select**,
  each symmetry toggled on or off independently.
- The context panel's Fold direction (`foldAngle/DirectionHintControl.tsx`):
  Mountain / Valley / None as a row of `Chip`s, with nothing pressed on a
  mixed selection — exactly what `SegmentedControl`'s `value: null` means.

**Not this pattern** (left alone): the References mode switch and the Design
tab strip (navigation tabs, `design-tab-strip`); the fold-angle preset chips
and the crease-angle popover's chips (presets sitting beside an action chip
and a number field, deliberately not a group — see the note at the top of
`CreaseAnglePopover.tsx`); single on/off toggles (the viewport's symmetry
button, the CP detect overlays); Settings' theme cards.

## Approach

The control is the first component styled under the scoped-CSS convention
(`implementation-plans/scoped-css.md`): its CSS moves out of `theme.css` into
`SegmentedControl.module.css`, so no screen can restyle it again — which is
what made the two looks in the first place — and the variations those screens
wanted become props.

1. **The pill look becomes the component's own.** The track is a padded well
   (3px padding and gap, rounded) and each option a rounded pill; the chosen
   pill keeps today's accent tint, and hover gets a fainter tint of its own so
   hovering is no longer indistinguishable from choosing. The well's colour
   gets a general token, `--segmented-track` (today the Paper tab borrows the
   Settings-only `--settings-well`, which is `--bg-canvas`).
2. **Size and width are props, not context CSS.**
   - `size: 'sm' | 'md' | 'lg'` on the shared control scale
     (`CONTROL_SIZE_CLASSES`: 28 / 32 / 36px outer height), so a segmented
     control lines up with a button, input or select beside it. The pills are
     the track's height less its padding. The Paper slot switch is `lg` —
     exactly its look today (28px pills in a 36px track).
   - `fill` shares the container's width equally among the options, for the
     places that need a stretched control. Everything else hugs its options.
   - Every context override above is deleted; the dead
     `.simulator-view-settings` rule goes with them.
3. **Per-option extras the look-alikes need**, so they can move onto the one
   component rather than keep their own markup: an option `tooltip` (the app
   `Tooltip`, with the rail's hold-to-label on touch — `useTouchLabel`) for
   icon-only options, and per-option `disabled` (a line type the tool cannot
   take). The phone sheet's close-on-pick stays the caller's, in `onChange`.
4. **Semantics stay as they are**: a labelled `group` of `aria-pressed`
   buttons, one Tab stop each. No roving focus or arrow keys — the
   crease-angle popover rejected a roving group for its chips on purpose, and
   the shortcut rules in `AGENTS.md` keep key handling out of components. The
   phone sheet's radio roles give way to the group's pressed buttons.

## Affected Areas

- `apps/web/src/components/ui/SegmentedControl.tsx` (+ a test file), and
  `ui/fieldRows/SegmentedRow.tsx`
- `apps/web/src/styles/theme.css`: the `.segmented` rules, every context
  override listed above, the dead simulator rule, and the hand-built groups'
  CSS once they move
- The 10 call sites above (size and `fill` where needed)
- `panels/CpToolRail.tsx`, `toolCatalog/CpToolPickerSheet.tsx`,
  `panels/ExploriQueryBar.tsx`, `foldAngle/DirectionHintControl.tsx`
- Tests that read the segmented markup: `WorkspaceViewDrawer.test.tsx`,
  `fieldRows.test.tsx`, `PaperSettings.test.tsx`, `PropertySheetView.test.tsx`,
  `foldedFigureProperties.test.ts`, and the rail / picker / ExplOri / fold
  direction tests

## Open questions

1. **Stretch or hug in dialogs?** The export dialog's Format and Steps switches
   stretch across the column today; the Paper tab's hugs. Proposed: hug in
   dialogs and settings (as the Paper tab does), and `fill` only in the CP
   context panel's column, whose dense rows were built around a full-width
   control.
2. **The rail's line types** — move them onto the component (proposed, with
   the tooltip support in step 3), or leave them as tool-rail buttons in a
   restyled group?
3. **ExplOri's Symmetry is multi-select.** Give the component a
   `multiple` mode (value is a set, each pill toggles) so it uses the same
   control (proposed), or leave it out as a different interaction?
4. **Fold direction** (Mountain / Valley / None) — convert the chips
   (proposed), or keep chips there alongside the fold-angle presets?

## Checklist

### Phase 1 — The component takes the pill look; its sites follow

- [ ] The scoped-CSS setup lands first (`implementation-plans/scoped-css.md`)
- [ ] `SegmentedControl`: pill track and pills in `SegmentedControl.module.css`
      (its `theme.css` rules deleted), the `--segmented-track` token (light
      and dark), a distinct hover tint, `size` on the shared scale, `fill`
- [ ] The 10 sites: sizes and `fill` per the answers above; delete every
      context override and the dead simulator rule
- [ ] Tests: the component (size, fill, a `null` value presses nothing,
      disabled refuses), and every existing test that reads the markup —
      moved from `.segmented__option` to roles and pressed state
- [ ] Browser: each site in dark and light themes, and at phone width with a
      touch pointer (the coarse-pointer minimum height)
- [ ] Validate; commit

### Phase 2 — The line types onto the component

- [ ] Option `tooltip` (hold-to-label on touch) and per-option `disabled`
- [ ] The rail's line types and the phone sheet's through `SegmentedControl`;
      delete `.cp-tool-rail__buttons[data-group='line-type']` and
      `.cp-tool-picker__types`
- [ ] Tests; browser (rail tooltip with shortcut, touch hold, the sheet closing
      on a pick); validate; commit

### Phase 3 — The other look-alikes

- [ ] Fold direction chips → `SegmentedControl` (a mixed selection presses
      nothing)
- [ ] ExplOri Symmetry → `SegmentedControl` in `multiple` mode, if chosen;
      delete `.explori-symmetry-*`
- [ ] Tests; browser; validate; commit

### Phase 4 — Close out

- [ ] No `.segmented` rule outside the component's own; no hand-built
      segmented group left (grep for `border-right` / hairline groups)
- [ ] `git diff --check`; commit
