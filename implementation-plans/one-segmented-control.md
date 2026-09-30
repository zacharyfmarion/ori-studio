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
- The context panel's Fold direction (`foldAngle/DirectionHintControl.tsx`):
  Mountain / Valley / None as a row of `Chip`s, with nothing pressed on a
  mixed selection — exactly what `SegmentedControl`'s `value: null` means.

**Not this pattern** (left alone): ExplOri's Symmetry
(`panels/ExploriQueryBar.tsx`), which looks like one but is multi-select —
each symmetry toggles on its own — and is a different component; the References mode switch and the Design
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
   - `fill` stretches the control to its container, for the places that need
     it: each option takes its label's width and an equal share of the room
     left over. Split into equal widths, a longer label was cut while a shorter
     one had room to spare (a pen card's Cap, 99px wide, cut "Round" to
     "Ro…"). Everything else hugs its options — the track is
     `width: fit-content`, so it hugs even in a grid or flex column that would
     stretch it (the export dialog's groups did).
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

## Decisions (2026-09-30)

1. **Hug in dialogs and settings**, as the Paper tab does; `fill` only in the
   CP context panel's column.
2. **The rail's line types move onto the component**, with option tooltips.
3. **ExplOri's Symmetry stays its own component**: multi-select is a different
   interaction, not a mode of this one.
4. **Fold direction becomes a segmented control.**

### Follow-up (2026-09-30)

- A labelled control sits on one row, label left and control right, like the
  rows around it: the export dialog's Format and step scope (labelled Steps,
  the name it already had for a screen reader) and the crease export's Side
  on `export-modal__field-row`, and the context panel's mode switches (Extend
  color, Divide mode) on the same `SegmentedToolOption` row the Square tool's
  options use, in place of a group title above a full-width control.
- The context panel's controls are `md` (32px): at `sm` the pills read short.
- The export dialogs' Style picker takes the same row, its select as wide as
  the style it names (`PaperStylePicker.module.css`), so every labelled
  control in the paper export dialog lines up on the right.
- The chosen pill's background is one element that slides to a new choice
  (160ms), and jumps rather than slides when only the layout changes. A choice
  shows at once (`useOptimistic`), with the owner's update run as a
  transition: the context panel's owner re-renders the whole crease-pattern
  panel, and the pill used to wait ~100ms for it in development.

## Checklist

### Phase 1 — The component takes the pill look; its sites follow

- [x] The scoped-CSS setup lands first (`implementation-plans/scoped-css.md`)
- [x] `SegmentedControl`: pill track and pills in `SegmentedControl.module.css`
      (its `theme.css` rules deleted), the `--segmented-track` token (light
      and dark), a distinct hover tint, `size` on the shared scale, `fill`
- [x] The 10 sites: sizes and `fill` per the decisions above; delete every
      context override and the dead simulator rule. `lg` for the Paper slot
      switch; `sm` with `fill` for the pen cards' Cap and the context panel
      (mode switches, the Square tool's options); `sm` in property rows; the
      dialogs and the phone drawer at the default `md`, hugging
- [x] Tests: the component (size, fill, a `null` value presses nothing,
      disabled refuses), and every existing test that reads the markup —
      moved from `.segmented__option` to roles and pressed state
- [x] Browser: each site in dark and light themes, and at phone width with a
      touch pointer (the coarse-pointer minimum height). Known limit, not new:
      a pen card's Cap field is 99px, and the Russian and Portuguese labels
      (Плоский / Круглый, Reto / Arredondado) do not fit it at any padding —
      they now end in an ellipsis where they used to be clipped
- [x] Validate; commit

### Phase 2 — The line types onto the component

- [x] Option `tooltip` (hold-to-label on touch) and per-option `disabled`
      (`aria-disabled`, so the option stays focusable and its tooltip can say
      why — the whole control's `disabled` stays native and inert), and
      `iconsOnly` for options whose icon is the whole label
- [x] The rail's line types and the phone sheet's through `SegmentedControl`,
      each letter a `CpLineTypeMark` in its creases' ink (its own module);
      the rail's and the sheet's hand-built group CSS deleted, and the dead
      `.cp-line-type-toolbar__button` with it. The sheet's letters were
      `action.railLabel` and are now localized, like the rail's
- [x] Tests; browser (rail tooltip with shortcut, touch hold, the sheet closing
      on a pick); validate; commit

### Phase 3 — The other look-alikes

- [x] Fold direction chips → `SegmentedControl` (a mixed selection presses
      nothing), `sm` and `fill` like the rest of the context panel. Each
      option's accessible name is now its visible label, with the longer
      description as its title — the chips named themselves by the description
- [x] Tests (the control had none: pressed state, None, mixed, the verb);
      browser (an undecided crease, hinted from the panel); validate; commit

### Phase 4 — Close out

- [x] No `.segmented` rule outside the component's own; no hand-built
      segmented group left. Every other `aria-pressed` control is on the "not
      this pattern" list above (on/off toggles, theme and preset cards, the
      angle presets, ExplOri's multi-select), and the one radio group left is
      the Square tool's 3×3 anchor picker, a two-dimensional choice
- [x] `git diff --check`; commit
