# Controls and cards on the one radius

## Goal

Every control and every card wears `--radius` (8px). The first styling pass
(`styling-refinements.md`) applied the rule to floating chrome only. Its
decision 1 left inputs, number fields and modal internals for later, so today:

- In the same View-pane row, a number field and its −/+ buttons are 4px
  beside an 8px select.
- The Settings theme cards are 6px under an 8px select.

## Approach

### The rule, extended (decisions settled 2026-10-01)

1. **Scope: controls and cards.**
   - **A control → `--radius`**: anything you type into, pick from or press, at
     any size. That covers inputs, number fields and their steppers, selects,
     buttons, the outer edge of a joined group, and segmented controls.
   - **A card → `--radius`**: a bordered box that groups content. That covers
     cards and tiles, option cards, notices, metric boxes, tables and preview
     wells.
   - **A floating surface the first pass missed** gets it too: the toasts, and
     the BP packing d-pad's canvas buttons.
2. **A small detail inside a card keeps `--radius-sm` (4px):** swatches,
   thumbnails, samples, badges and index chips. Two details are 6px today and
   come down to 4px: Paper's erode picture and pen sample.
3. **Inner parts are concentric** with the control they sit in: the control's
   radius less the inset.
   - A colour input's swatch: 8px less its 1px border.
   - A segmented pill: 8px less 3px.
   - The BP sheet menu's segment buttons: 8px less 2px.
   - The measure value's "copied" overlay: 8px less 1px.
   - The square tool's anchor cells: 8px less the 2px padding, 6px. (Phase 2
     subtracted the border too, 5px; phase 5 put them on the padding rule
     menus and the segmented control already follow.)
4. **Unchanged:**
   - Rows inside a surface, which follow the concentric rule rather than this one.
   - Pills (switches, chips, counters), checkboxes and focus rings.
   - Canvas labels and badges, the 3D view cube, and scrollbars.

### Inventory (sweep of every stylesheet, 2026-10-01)

**Shared blocks, edited in place.** They are listed in `scoped-css.md`, or
another component restyles or looks them up. The rules allow an in-place edit
of an existing rule, never a new one.

| Area | Rules | Today → after |
| --- | --- | --- |
| Rows and fields | `.control-row__input`, `.control-row__reset`, `.field-row input`, `.collapsible-section__action` | 4 → 8 |
| Number field | `.number-field__step` (Paper restyles `NumberField`, so it is shared) | 4 → 8 |
| Colour field | `.color-field__input` (its swatch 3 → 7), `.color-field__clear`; Paper's override 6 → 8 | 4 → 8 |
| Export dialogs | `.export-modal__input`, `__select` 4 → 8; `__pattern-card`, `__preview` 6 → 8 | |
| Settings › Paper | `__card`, `__banner`, `-preset__apply` 9 → 8; the pen width group 7 → 8; erode picture and pen sample 6 → 4 | |
| Settings › Shortcuts | search, filter, key capture 4 → 8; the table 6 → 8 | |
| Tool card (`cp-context-panel`) | fields, preset, apply, secondary, measure value, the unavailable notice 4 → 8; copied overlay 4 → 7 | |
| BP sheet and symmetry popovers | inputs, preset and flip buttons 4 → 8; segment and transform tracks 4 → 8, their buttons 3 → 6 | |
| Cards | `.sheet-card`, `.references-card` 6 → 8; `.cp-panel__unopened-reason` 6 → 8; `.error-fallback__report-text` 6 → 8 | |
| Toasts (`sonner.css`, third-party) | toast 6 → 8, its button 4 → 8 | |
| Share dialog (`share-link-modal`) | field and URL 6 → 8. Shared: its root and footer wear `simple-modal`'s classes and its rules override them, so it moves with `simple-modal` | |
| Help and About (`help-modal`, `about-modal`) | icon tile, acknowledgement cards 6 → 8. Shared: its root is in the safe-area rule `safeAreaOverlays.test.ts` pins | |

**Module-owned, edited directly:**

- `SegmentedControl`: the `sm` track 7 → 8 and its pills 4 → 5; the `lg` pills 6 → 5.
- `WorkspaceTabStrip`: close button and rename field 4 → 8.
- `CpContextToolReset`: 3 → 8.
- `PaperDashMenu`: trigger 7 → 8, custom field 6 → 8.

**One owner: moved into a module first, then restyled:**

| Component | What changes |
| --- | --- |
| `ConditionsPanel` | number inputs, action buttons, condition items 4 → 8 |
| `BpOptimizerModal` | count input 4 → 8 |
| `ExploriQueryBar` | count input, symmetry group 6 → 8 |
| `CreaseAngleField`, `CreaseAnglePopover` | input and caret, popover input 4 → 8 |
| `SquareToolOptions` | anchor picker 4 → 8, cells 2 → 6 |
| `CpViewControlsPanel` | grid reset button 4 → 8 |
| `BpPackingPanel` | d-pad buttons 6 → 8 |
| Settings theme card (`SettingsModal`'s `ThemeCard`) | card 6 → 8; swatches stay 4 |
| `DesignMethodChooser` (`App.css`) | card 10 → 8, icon tile 9 → 8 |
| `CommandDialogModal` | choice options 6 → 8 |
| `DiagnosticsPanel` | metric cards 6 → 8 |
| `ExploriResultsPanel` | result cards 6 → 8 |

### Not in this pass

- **The CP detection dialog** (`CpDetectImportModal.css`). Its notices and image
  frames are 6px, but the whole 500-line stylesheet is one block, so moving it
  is a change of its own. The radius goes with that move.
- **The share dialog's embed preview**, a picture of a chat app's link
  preview rather than one of our cards. It already resolves to 8px:
  `var(--radius-lg, 10px)`, and `--radius-lg` is `--radius`.
- **Rows:** `.control-row--button`, `.design-pane-sheet__item`,
  `.references-finding`, `.cp-tool-picker__row`, the measure rows.
- **Settings' phone tab strip**, which uses underline tabs.
- **Landing and site pages**, which change only under the prerender rules.
- **Canvas labels and badges**, the folded-figure toolbar's notice (it has no
  ground or border, so its radius never shows), and the file drop overlay.

### Phases

Each move is a commit of its own in which nothing on screen changes. Proof is
the moved elements' computed styles, snapshotted in the browser before and
after. The restyle follows as the phase's last commit.

## Affected Areas

- `apps/web/src/styles/theme.css`, `App.css` and `styles/sonner.css` (in-place
  edits, and the rules each move deletes)
- New modules beside the moved components, plus `ThemeCard.tsx` extracted from
  `SettingsModal.tsx`
- `components/ui/SegmentedControl.module.css`,
  `WorkspaceTabStrip.module.css`, `panels/CpContextToolReset.module.css`,
  `settings/PaperDashMenu.module.css`
- Tests that query the moved classes (they move to roles, names or data
  attributes), and `src/styles/globalStylesheets.test.ts` (the ratchet)
- `apps/web/docs/styling.md` › "Radius": the categories

## Checklist

### Phase 1 — Shared and module-owned controls

- [x] The in-place control rules above, and the four modules
- [x] Browser: the View pane's rows, the tool card (its fields, ratio presets
      and Reset), Settings › Paper and Shortcuts, the export dialog, the BP
      sheet and mirror popovers, the tab strip's close button
- [x] Validate; commit

### Phase 2 — One-owner controls

- [x] Moves: `ConditionsPanel`, `BpOptimizerModal`, `ExploriQueryBar`,
      `CreaseAngleField`, `CreaseAnglePopover`, `SquareToolOptions`,
      `CpViewControlsPanel`, `BpPackingPanel`'s d-pad (now `BpPackingDPad`);
      computed styles unchanged (desktop, and touch where a block has touch
      rules; the popover as a replica in both its frames, since it cannot
      mount in a hidden pane); ratchet lowered to 6254; commit
- [x] Restyle; browser; validate; commit

### Phase 3 — Shared cards, and the toasts

- [x] The in-place card rules above, the details at 4px, the toasts
- [x] Browser: Settings › Paper (cards, preset cards, the pen sample and
      erode picture at 4px) and Shortcuts (the table), a toast and its
      action; validate; commit

### Phase 4 — One-owner cards

- [x] Moves: theme cards (into `ThemeCard`), `DesignMethodChooser`,
      `CommandDialogModal`, `DiagnosticsPanel`, `ExploriResultsPanel`;
      computed styles unchanged (ExplOri with five results and a detail open);
      ratchets App.css 780, theme.css 5919; commit. `ShareLinkModal` and
      `HelpModal` turned out to be shared (above) and are edited in place
- [x] Restyle; browser; validate; commit

### Phase 5 — Close out

- [x] `docs/styling.md` › "Radius": control, surface, detail, pill, and the
      concentric parts; `AGENTS.md`'s one-line rule says cards and details
- [x] Browser: an audit of the computed radius of every visible control and
      bordered box in Design (and its Conditions, Diagnostics and Inspector
      tabs), every Settings tab, and Edit's View pane with six tool cards. The
      only values off 8px were the rule's own: a split button's joined half,
      the toolbars' concentric 12px, rows, details and the anchor's cells.
      Radii do not change with the theme. The screenshot pass in a light theme
      did not happen: the Browser pane stayed hidden
