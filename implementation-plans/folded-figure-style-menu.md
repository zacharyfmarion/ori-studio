# Folded-figure Style menu

## Goal

Move every folded-model setting that lives in the viewport bar's **Folded
models** dropdown — and in its phone twin, `FoldedFigureModal` — onto the
figure's own contextual surfaces:

- The floating toolbar's display-style dropdown (the `Layers` button) becomes a
  **Style** menu behind a paintbrush, holding a **Render as ▸** submenu
  (Paper / Wireframe / X-ray), a **Side ▸** submenu (Front / Back), the three
  colour rows (front, back, line) and a **Shadow** check row.
- The right-click menu gets the same content as a **Style ▸** submenu, rendered
  from the same catalog, so the two surfaces still cannot drift.
- The viewport-bar dropdown, the phone modal, and the active-figure-bound
  bindings behind them are deleted.

This reverses one earlier call, and it is worth saying why.
`folded-figure-contextual-toolbar.md` kept the colour swatches off the bar
because "three colour pickers is a panel, not a bar". Behind a menu they are
rows, not pills, so the width argument no longer applies — and the argument
*for* moving is the same one every other verb already moved on: the global
dropdown acts on the **active** figure, which after a fold is a fallback to the
most recently folded one, while the contextual surfaces act on the figure you
clicked.

## What moves, what goes

| Control | Today (viewport-bar dropdown / phone modal) | After |
| --- | --- | --- |
| Figure list (select active, status subtitle) | `FoldedFigureControls` | **Removed** — Decision 1 |
| Display — `<select>` Paper / Transparent / Wire | `FoldedFigureControls` | Style ▸ **Render as ▸** Paper / Wireframe / X-ray. The toolbar already carries this choice; it moves one level down and keeps its labels |
| Side — segmented Front / Back | `FoldedFigureControls` | Style ▸ **Side ▸** Front / Back, radio rows. Disabled on a 3D figure — Decision 2 |
| Front / Back / Line colour — `ColorField` | `FoldedFigureControls` | Style ▸ three **colour rows**, each a swatch that opens the native picker |
| Shadow — `Toggle` | `FoldedFigureControls` | Style ▸ **Shadow** check row, stays open on toggle; disabled with its hint on 3D, exactly as today |
| Fold button | viewport bar `cp-folded-figure-actions` | **Stays** on the bar; it is a crease-pattern verb, not a figure setting |

The bar after: `[notice] Flip · (Reset view · Set upright) · Style │ Another ·
Refold │ Export │ Duplicate · Delete`. Same slots as today — only the icon and
what is behind it change.

## Decisions

1. **The viewport-bar button goes entirely, not just its settings.** With the
   settings gone the dropdown would be a figure list under a header, and
   everything the list did has another home: selecting a figure is a click on
   the canvas; *Folding…* is the fold-run toast; *Stale* is the Refold button on
   the bar; a 3D verdict is the notice chip; a failed fold is discarded rather
   than listed (`creasePatternSlice.ts:2443`). The one readout with no other
   surface is *Case N*, and "Another solution" / "Back to first solution"
   already say what the next press does. The alternative — keep a list-only
   dropdown — is a small restyle instead of a deletion; flip this decision if the
   list is wanted.

2. **Side on a 3D figure is offered disabled, because it is inert today.**
   `model.state` seeds a 3D figure's *default* camera at fold time
   (`folded3dReproject.ts:70`, `creasePatternSlice.ts:2184`), and every 3D figure
   is stamped with a camera at fold — so `updateOristudioCpFoldedFigureModel`
   re-projects a `state` write at `figure.camera` and nothing changes on screen.
   That is the enabled-and-inert state `folded-figure-appearance-options.md`
   exists to make unreachable. `foldedAppearanceSupport(figure, 'side')` returns
   `'unsupported'` for a 3D figure, and the row carries the hint *"A 3D model is
   turned with Other side"* — the same shown-disabled-says-why treatment the
   Shadow row already gets, per the rule that a control which disappears between
   figure kinds reads as a bug.

3. **One item renderer for both surfaces.** `ContextMenu.tsx` gains the two new
   row kinds and exports its item renderer; the toolbar's menus render
   `ContextMenuItem[]` through it. The alternative is a colour row written twice
   — once in Radix markup for the toolbar, once as a `ContextMenuItem` — which is
   the drift the catalog exists to prevent, one level down.

4. **Colour rows are menu items, not embedded fields.** The `RegionImageMenu`
   pattern (a `<label>` holding a native control inside the menu) is unreachable
   from the keyboard: Radix blocks Tab inside a menu and its roving focus visits
   items only. A colour row is therefore a `DropdownMenu.Item` whose select
   (click or Enter) focuses a visually-hidden native `<input type="color">` and
   opens it (`showPicker()`, falling back to `click()`); the visible swatch is a
   span painted from the value. The commit protocol is unchanged — per-move
   `set`, commit on blur — plus **commit on unmount**, because closing the menu
   can unmount the input without a blur, and an uncommitted scope would be
   silently overwritten by the next verb's `beginFoldedFigureGesture`.

5. **Two exclusive picks, two submenus.** Render as ▸ and Side ▸ are both
   `FoldedFigureChoice`s with `exclusive: true`, so they map to submenus of radio
   rows by one rule. It also keeps "Front" / "Back" from sitting as bare rows
   beside "Front colour" / "Back colour", and needs no group-label item kind.

## Menu design

```
[ 🖌 Style ]
  Render as        ▸    Paper ✓ / Wireframe / X-ray
  Side             ▸    Front ✓ / Back            (disabled + hint on 3D)
  ────────────
  Front colour     ■
  Back colour      ■
  Line colour      ■
  ────────────
  ✓ Shadow                                        (disabled + hint on 3D)
```

Labels: **Style** (new), **Render as** (replaces the `displayStyle` key —
"Display style" under a menu called Style reads as a stutter), **Side** (new
key), the colour labels from `foldedColorLabel`, **Shadow** from
`panels:creasePattern.shadow`, the 3D shadow hint from `shadowUnsupported3d`.

Gating, all in the catalog: the whole group is disabled until the figure is
`ready`; the model rows additionally need `capabilities.editModel` (true for
both kinds since the 3D write path landed) and `foldedAppearanceEnabled` for
their option. A legacy display style (`Development1` / `Development4` /
`None0`) shows nothing checked under Render as — already the toolbar's
documented behaviour; the dropdown's "keep the legacy value selectable"
affordance goes with it, since picking any offered style is the way out either
way.

## Approach

### Phase 1 — Catalog

`apps/web/src/cp-workspace/folded/foldedFigureActions.ts` stays React-free and
store-free; it grows one group kind and two row kinds.

```ts
export interface FoldedFigureColorOption {
  kind: 'color';
  id: 'front-color' | 'back-color' | 'line-color';
  label: string;
  /** `#rrggbb` — what a colour input takes, converted here so no renderer converts. */
  value: string;
  disabled: boolean;
  /** Per-move. The first call opens the undo gesture. */
  set: (hex: string) => void;
  /** Close the gesture as one undo entry. A no-op when none is open. */
  commit: () => void;
}

export interface FoldedFigureToggleOption {
  kind: 'toggle';
  id: 'shadow';
  label: string;
  checked: boolean;
  disabled: boolean;
  /** Why the row is disabled, when it is. */
  hint?: string;
  toggle: () => void;
}

export type FoldedFigureStyleItem =
  | FoldedFigureChoice
  | FoldedFigureColorOption
  | FoldedFigureToggleOption
  | FoldedFigureSeparator;

export interface FoldedFigureGroup {
  kind: 'group';
  id: 'style';
  label: string;
  icon: FoldedFigureActionIcon; // 'style' → Paintbrush
  disabled: boolean;
  items: FoldedFigureStyleItem[];
}
```

- `FoldedFigureAction` gains `FoldedFigureGroup`; the group takes the slot the
  `display-style` choice holds today (after Flip / the 3D view verbs, before
  the `after-appearance` separator). `FoldedFigureChoice.id` widens to
  `'display-style' | 'side' | 'export'`; `icon` becomes optional on it, since
  Side has no glyph. `FoldedFigureActionIcon` gains `'display-style'` (`Layers`,
  which `'style'` used to be) and `'style'` becomes the paintbrush.
- `FoldedFigureActionDeps` gains two **required** bindings, mirroring the hook's
  existing active-figure pair but addressed by figure:
  `updateModel(figure, update: Partial<OristudioCpFoldedFigureModel>, scope?: string)`
  and `endModelGesture(scope: string, label: string)`. Colour rows use scope
  `color:<key>` and the existing `changeFoldedColor` label; Side and Shadow pass
  no scope and record immediately, as today.
- The model read `figure.snapshot?.model ?? figure.folded3d?.model` moves from
  `FoldedFigureControls` into a `foldedFigureModel(figure)` helper in
  `foldedFigureState.ts` — the one file that already knows a figure has two
  kinds. Colour fallbacks come from `FOLDED_COLOR_FIELDS`; hex conversion from
  `lib/rgbColor.ts`.
- `foldedFigureAppearance.ts`: `side` → `'unsupported'` for a 3D figure
  (Decision 2); its exhaustiveness test updates.
- The scope bookkeeping behind `updateModel` / `endModelGesture` moves out of
  the hook's bare `useRef` into a pure `foldedModelGestureLedger.ts` (`open`,
  `isOpen`, `close`, `closeAny`), and `runFoldedFigureAction` /
  `beginFoldedFigureGesture` close any open scope before starting — De-risking
  §2. `commit` with no open scope is a no-op; a second commit for one drag
  records nothing.

Tests (`foldedFigureActions.test.ts`): the group sits where the display-style
choice sat; its items are in the order above with separators between the
sections; Render as is exclusive with the current style checked; Side is
exclusive, checked from `model.state`, and disabled with a hint on a 3D figure;
each colour row's `value` is the model colour as hex and its `set` calls
`updateModel` with the RGB patch under its scope; `commit` calls
`endModelGesture` with that scope and the colour label; Shadow's `toggle` writes
`display_shadows` with no scope and is disabled with the hint on 3D; nothing in
the group is enabled on a figure that is not ready. Ledger tests: a scope
opened and then pre-empted by another gesture lands as one entry with its own
label; `commit` with nothing open records nothing; blur-then-unmount records
once.

### Phase 2 — Menu primitives

`apps/web/src/components/ui/contextMenuTypes.ts` gains:

```ts
| { kind: 'checkbox'; id: string; label: string; checked: boolean;
    disabled?: boolean; hint?: string; onToggle: () => void }   // menu stays open
| { kind: 'color'; id: string; label: string; value: string;      // #rrggbb
    disabled?: boolean; onChange: (hex: string) => void; onCommit: () => void }
```

and the existing `radio` kind gains `keepOpen?: boolean`, honoured with
`preventDefault` in `onSelect`, so a style pick leaves the menu up while the
export submenu's one-shot rows still close it.

`ContextMenu.tsx`:

- `checkbox` renders as `DropdownMenu.CheckboxItem` with `preventDefault` in
  `onSelect` so the menu stays open — the pattern `RegionImageMenu` and
  `SuppressionRegionChip`'s check-class menu already use — with `title` for the
  hint, as `action` does.
- `color` renders through a new `ContextMenuColorItem` (`components/ui/`): a
  `DropdownMenu.Item` containing the label, a swatch span, and a native colour
  input laid over the swatch at `opacity: 0; pointer-events: none` (so Chrome's
  popup anchors beside the swatch, and a click reaches the item's `onSelect`
  rather than opening the picker twice). `onSelect` prevents default, focuses
  the input and calls `showPicker()` inside a try/catch that falls back to
  `click()`. `onChange` → per-move; `onBlur` → commit; an effect cleanup →
  commit. The input's keys are **not** shielded from Radix: an arrow key must
  move focus to the next row (which blurs the input), and Escape must close the
  menu — see De-risking §1 for the measurement behind this.
- Export `renderContextMenuItems(items: ContextMenuItem[]): ReactNode` — the
  existing `items.map(renderItem)` — so a toolbar dropdown renders the same
  markup the context menu does.
- CSS: `.context-menu__swatch` (14×14, `--radius-sm`, 1px `--border-default`,
  background from an inline style), `.context-menu__color-input` (the overlay).

Tests (`ContextMenu.test.tsx`): a checkbox row toggles and the menu stays open;
a colour row paints its swatch from `value`; selecting it calls `showPicker` (a
spy on the prototype) and focuses the input; a change reaches `onChange`; blur
reaches `onCommit`; unmounting the open menu reaches `onCommit`.

### Phase 3 — Surfaces

- `foldedFigureMenuItems.tsx`: extract the choice-to-submenu mapping into
  `choiceMenuItem(choice)`, add `styleMenuItems(group): ContextMenuItem[]`
  (choice → submenu of radios, `color` → `color`, `toggle` → `checkbox`,
  separator → separator), and map the top-level `group` case to
  `{ kind: 'submenu', id: 'style', icon: Paintbrush, items: styleMenuItems(group) }`.
  Export `styleMenuItems` and `choiceMenuItem`.
- `CpFoldedFigureToolbar.tsx`: a `GroupMenu` renders the Style group as
  `DropdownMenu.Root` → `MenuIconButton` (paintbrush, tooltip "Style") →
  `Content.context-menu` → `renderContextMenuItems(styleMenuItems(action))`.
  The existing `ChoiceMenu` (Export) goes through the same renderer via
  `choiceMenuItem`, deleting its hand-written item markup — one renderer, two
  menus.
- `foldedFigureActionIcons.tsx`: `'style'` → `Paintbrush`, `'display-style'` →
  `Layers`.
- Context menu: nothing to wire. `useCpCanvasContextMenu` already builds from
  `foldedFigureMenuItemsWith`, so Style ▸ appears there, and the
  `viewport.contextMenu` chord reaches it from the keyboard.
- `useFoldedFigures.ts`: the deps memo gains `updateModel` / `endModelGesture`,
  built from the bodies of `handleFoldedModelUpdate` / `endFoldedModelGesture`
  parameterised by figure (the scope ref is shared, which is right — one
  gesture at a time). The active-figure-bound `setDisplayStyle`, `updateModel`
  and `endModelGesture` leave the hook's return value; nothing else reads them.
- Test fixtures gain the two deps: `CpFoldedFigureToolbar.test.tsx`,
  `foldedFigureMenuItems.test.tsx`, `foldedFigureActions.test.ts`,
  `foldedFigureCapabilities.test.ts`.

Tests (`CpFoldedFigureToolbar.test.tsx`): the bar shows a Style trigger with a
tooltip and no Layers button; opening it shows Render as, Side, the three colour
rows and Shadow; Render as opens a submenu with the current style checked;
Shadow toggles through `updateModel` without closing; Export still lists SVG and
PNG. `foldedFigureMenuItems.test.tsx`: the Style submenu holds two submenus,
three colour items and one checkbox, in that order.

### Phase 4 — Retire the viewport-bar surface

- `CreasePatternPanel.tsx`: delete `FoldedFigureMenuButton` (`:493–568`), the
  phone overflow item and its comment (`:3111–3137`, leaving Fold as the one
  action), `foldedModalOpen` (`:1221`), the modal mount (`:3600–3611`), and
  `ListChecks` if nothing else imports it. The `cp-folded-figure-actions` node
  then holds Fold alone; fold it into a plain `IconButton` if the wrapper has
  no other reason to exist. The panel's counted total goes **down**; no cap
  change.
- Delete `FoldedFigureControls.tsx` and `FoldedFigureModal.tsx`. Trim
  `foldedFigureControlOptions.ts` to what survives (`foldedStateLabel`,
  `FOLDED_COLOR_FIELDS`, `foldedColorLabel`); `FOLDED_DISPLAY_STYLE_OPTIONS` and
  `foldedDisplayStyleLabel` go — they were a second label set for the same
  enum, and the catalog's `foldedDisplayStyleChoiceLabel` is the one that stays.
- `foldedFigureSubtitle` (`foldedFigureNotice.ts:223`) loses its only caller;
  delete it with its tests. `foldedFigureNotice` itself stays.
- `theme.css`: `.folded-figure-menu*` (`:7062–7211`, `:6520`, the touch-target
  and 16px-input entries at `:9717` and `:9845`), `.folded-figure-modal*`
  (`:1473–1485`).
- i18n orphans, each grep-verified before removal:
  `panels:creasePattern.foldedModels`, `.none`, `.display`,
  `.foldedDisplayStyle`, `.side`, `.foldedModelSide`, `.foldedStyle.*`,
  `.showFoldedModelShadow`, `.foldedModelControls`, `.closeFoldedModels`,
  `.case`, `.foldedModelStatus.*`. `.stale`, `.shadow`, `.shadowUnsupported3d`,
  `.foldedState.*`, `.foldedColor.*` and `.changeFolded*` stay in use.

### Phase 5 — Analytics, i18n, validation

- `ANALYTICS_EVENTS.foldedFigureStyled = 'folded figure styled'`, properties
  `option` (`display_style | side | front_color | back_color | line_color |
  shadow`) and `figure_kind` (`flat | 3d`). Fired from the hook's model-write
  bindings **once per adjustment**: discrete options on the call, a colour drag
  when it opens — never per pointer move, and never with the colour, which is
  the user's work. A pure `foldedFigureStyleOptions(update)` helper
  maps a model patch to option names and is the unit-tested piece, since
  `useFoldedFigures` has no test harness. Row in `docs/analytics.md`.
- i18n per `apps/web/CLAUDE.md`: inline defaults, `npm run i18n:extract`, the
  8 locales, `npm run i18n:stamp`, `npm run i18n:check`.
- `npm run lint:web`, `npm run typecheck:web`, `npm run test:web` (Node 22, run
  from the web workspace), `npm run i18n:check`.
- Browser pass, in the dev server, on a flat and a 3D figure: the paintbrush
  opens the menu anchored to the bar; Render as and Side switch and show the
  current value; each swatch opens the native picker and the figure recolours
  live; a colour drag lands as **one** undo entry whether the picker is closed
  by blur, by picking another row, or by clicking the canvas with the menu
  open; Shadow toggles without closing; Side and Shadow are disabled with their
  hints on the 3D figure; right-click ▸ Style ▸ shows the same rows; the
  viewport bar shows Fold and nothing else for figures; the phone layout's
  overflow menu shows Fold only and the contextual bar's Style menu fits the
  screen. Desktop shell (WKWebView) covered for the picker — see Risks.

## Affected Areas

**New**
- `apps/web/src/components/ui/ContextMenuColorItem.tsx` (+ coverage in
  `ContextMenu.test.tsx`)
- `apps/web/src/cp-workspace/folded/foldedModelGestureLedger.ts` (+ test)

**Edited**
- `apps/web/src/cp-workspace/folded/foldedFigureActions.ts` (+ test) — group,
  colour and toggle kinds; figure-addressed model deps
- `apps/web/src/cp-workspace/folded/foldedFigureActionIcons.tsx` — paintbrush,
  `display-style`
- `apps/web/src/cp-workspace/folded/foldedFigureMenuItems.tsx` (+ test) —
  `styleMenuItems`, `choiceMenuItem`, the `group` case
- `apps/web/src/cp-workspace/folded/CpFoldedFigureToolbar.tsx` (+ test) —
  `GroupMenu`; `ChoiceMenu` on the shared renderer
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts` — figure-addressed
  `updateModel` / `endModelGesture` in the deps; active-bound trio removed
- `apps/web/src/cp-workspace/folded/foldedFigureState.ts` — `foldedFigureModel`
- `apps/web/src/cp-workspace/folded/foldedFigureAppearance.ts` (+ test) — side
  unsupported on 3D
- `apps/web/src/cp-workspace/folded/foldedFigureControlOptions.ts` — trimmed
- `apps/web/src/cp-workspace/folded/foldedFigureNotice.ts` (+ test) —
  `foldedFigureSubtitle` removed
- `apps/web/src/cp-workspace/folded/foldedFigureCapabilities.test.ts` — deps
  fixture
- `apps/web/src/components/ui/contextMenuTypes.ts`,
  `apps/web/src/components/ui/ContextMenu.tsx` (+ test) — `checkbox` and
  `color` kinds, exported renderer
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — the four deletions
- `apps/web/src/analytics/events.ts`, `docs/analytics.md` — the event
- `apps/web/src/styles/theme.css` — swatch styles in; menu and modal styles out
- `apps/web/public/locales/*/panels.json` — new keys in, orphans out

**Deleted**
- `apps/web/src/cp-workspace/folded/FoldedFigureControls.tsx`
- `apps/web/src/cp-workspace/folded/FoldedFigureModal.tsx`

**Reused unchanged**
- `FloatingToolbar`, `MenuIconButton`, `useCanvasObjectAnchor`,
  `foldedFigureBox`, `foldedFigureCapabilities`, `lib/rgbColor`,
  `lib/foldedFigureSides`, the store's `updateOristudioCpFoldedFigureModel` and
  `setOristudioCpFoldedFigureDisplayStyle`, the hook's gesture bracket

**Not touched** — no Rust, no wasm, no store actions, no `.osf` shape, no
`FoldedFigureModel` field. Everything here is presentation and binding.

## Checklist

Planned as two pull requests — Phases 1–3 and 5 first, Phase 4 after the menu
had been used (De-risking §3) — and landed as one, at Zach's call after trying
the menu on the dev server: the old dropdown and its code go with the same PR.

### Phase 1 — Catalog
- [x] `group` / `color` / `toggle` kinds; Style group in the display-style slot
- [x] `updateModel` / `endModelGesture` on `FoldedFigureActionDeps`
- [x] `foldedFigureModel(figure)` in `foldedFigureState.ts`
- [x] `foldedModelGestureLedger.ts` (+ test); open scope closed by the next
      gesture; idempotent commit
- [x] Side `'unsupported'` on 3D in `foldedFigureAppearance.ts`; test updated
- [x] Catalog tests listed under Phase 1

### Phase 2 — Menu primitives
- [x] `checkbox` and `color` item kinds in `contextMenuTypes.ts`
- [x] `ContextMenuColorItem`: hidden input over the swatch, `showPicker` →
      `click` fallback, commit on blur and on unmount, keys left to Radix
- [x] `radio.keepOpen`
- [x] `renderContextMenuItems` exported
- [x] Swatch and overlay styles
- [x] `ContextMenu.test.tsx` cases listed under Phase 2

### Phase 3 — Surfaces
- [x] `styleMenuItems` / `choiceMenuItem`; `group` → Style ▸ submenu
- [x] Toolbar `GroupMenu` behind the paintbrush; `ChoiceMenu` on the shared
      renderer
- [x] Icons: `style` → `Paintbrush`, `display-style` → `Layers`
- [x] Hook deps gain the figure-addressed pair (the active-bound trio stays
      until Phase 4 — the dropdown still binds it)
- [x] Test fixtures and toolbar / menu-item tests listed under Phase 3

### Phase 4 — Retire the viewport-bar surface
- [x] `FoldedFigureMenuButton`, phone overflow item, `foldedModalOpen`, modal
      mount removed from the panel
- [x] `FoldedFigureControls.tsx`, `FoldedFigureModal.tsx` deleted;
      `foldedFigureControlOptions.ts` trimmed; `foldedFigureSubtitle` removed
- [x] `.folded-figure-menu*` / `.folded-figure-modal*` CSS removed
- [x] Orphaned keys removed from all 9 locales, each grep-verified

### Phase 5 — Analytics, i18n, validation
- [x] `folded figure styled` event + `foldedFigureStyleOptions` helper (+ test);
      `docs/analytics.md` row
- [x] `i18n:extract`, 8 locales, `i18n:stamp`, `i18n:check`
- [x] `lint:web`, `typecheck:web`, `test:web`
- [ ] Browser pass, flat and 3D, per the list under Phase 5 and the De-risking gates
- [ ] Desktop shell pass for the native picker under WKWebView

## De-risking

The risks in this plan split three ways, and each gets a different treatment:
questions about browser engines are **measured** with a throwaway spike before
any production code; the undo protocol is **hardened** so it cannot depend on
which UI event happens to fire; and the UX bet is **sequenced** so the old
surface is still there until the new one has been used.

### 1. Measured: a native colour picker inside a Radix menu (spike, 2026-09-14)

A throwaway page mounted the exact structure this plan proposes — a modal Radix
`DropdownMenu` on the app's real `MenuIconButton` and `.context-menu` classes,
two `Sub`s of radio rows, three colour rows (an `Item` holding a hidden native
`<input type="color">` opened by `showPicker()`), and a `CheckboxItem` — with
every event logged, and was driven in two engines. The spike is deleted; nothing
from it is to be reused (spike code is reference only).

| Question | Chromium 152 (desktop app pane) | WebKit 605 (iOS 17.2 Safari, simulator) |
| --- | --- | --- |
| `showPicker()` from a click on the row | ok, no throw | ok — the native Colors sheet opened |
| `showPicker()` from **Enter** on the focused row | ok (keyboard activation counts) | not driven |
| Menu still mounted while the picker is up | yes at +500 ms and +2 s; input is `activeElement`, `document.hasFocus()` true | yes at +500 ms and +2 s |
| Picker → page | synthetic `input` events reached the handler, swatch repainted live | **real** tap on the sheet's blue swatch → `input` + `change` `#285ff4`; swatch and figure repainted |
| Closing the picker | n/a (popup not capturable) | menu stayed open; `blur` fired on dismiss — the commit point |
| Escape with the input focused | menu closed; **no `blur`**, only the unmount | not driven |
| Outside click with the input focused | `blur` → `onOpenChange(false)` → unmount | `onOpenChange(false)` → unmount (blur had already fired on picker dismiss) |
| Radio in a `Sub` with `preventDefault` | menu and sub stay open, check moves | not driven |
| `CheckboxItem` with `preventDefault` | menu stays open, state toggles | not driven |
| Fits a phone | n/a | 8 rows at touch-target height, under half the screen |

Three things the spike settled that the first draft had guessed:

- **Commit on unmount is load-bearing, not belt-and-braces.** Escape closes the
  menu in Chromium without a `blur` on the focused colour input. A design that
  committed only on blur would drop that undo entry.
- **Do not shield the input's `keydown`.** With `stopPropagation` on the input,
  arrow keys were dead after a colour was picked (focus stayed on the input, so
  Radix's roving focus never saw them). Escape still worked, because Radix
  listens for it on `document`. Without the shield an arrow should reach the
  content's roving-focus handler and move to the next row, blurring the input —
  a natural commit. That half is inferred from how Radix handles arrows, not
  measured; it is one keyboard step in the browser pass. Typeahead on a colour
  input has nothing to eat.
- **StrictMode double-invokes the unmount cleanup on mount**, so in dev every
  colour row "commits" once as the menu opens. Harmless because `commit` is a
  no-op with no scope open — which is now a tested requirement, not an
  assumption.

**Still reasoned rather than measured: desktop WKWebView.** The Tauri shell
opens `NSColorPanel`, a separate window, where iOS opens an in-process sheet.
Two reasons to expect the same result: the viewport bar's current dropdown
already opens `NSColorPanel` from inside a `role="menu"` container in the
desktop app, so the picker-to-page path is in production use; and Radix's
dismiss and focus layers react only to events *in* the document — its
`FocusScope` explicitly ignores a `focusout` whose `relatedTarget` is null,
which is what focus leaving to another window produces. It cannot be driven
unattended because `showPicker()` needs a real user activation. It is the one
row on the browser checklist that has to be the desktop app, and it goes first.

### 2. Hardened: the undo protocol does not depend on UI events

Today a scoped colour gesture is closed only by the control that opened it. If
anything else calls `beginFoldedFigureGesture` while a scope is open — the next
verb, from any surface — the pre-gesture snapshot is overwritten and the colour
change silently leaves the undo stack. That hazard exists now; the new menu just
adds ways to reach it. Two changes make it unreachable:

- **An open scope is committed by whatever comes next.** `runFoldedFigureAction`
  and `beginFoldedFigureGesture` first close any open model scope with its own
  label. The scope bookkeeping moves out of a bare `useRef` into a small pure
  ledger (`foldedModelGestureLedger.ts`: `open`, `isOpen`, `close`, `closeAny`)
  so this is unit-tested rather than trusted: opening a scope, then beginning
  another gesture, records exactly one entry for the first.
- **Commit is idempotent and label-safe.** `commit()` on a colour row with no
  scope open records nothing (the StrictMode case above); two commits for one
  drag (blur, then unmount) record one entry. Both are catalog tests.

The browser check then has three ways of closing a menu mid-drag — Escape,
outside click, picking another row — and one undo entry each time is the
acceptance criterion.

### 3. Sequenced: the old surface stays until the new one is proven

*(Overtaken: after the browser pass Zach chose to land everything in one PR.
Kept as the reasoning it was.)* Land this as **two pull requests**, not one:

1. Phases 1–3 and 5: the Style menu on the toolbar and the context menu, with
   the viewport-bar dropdown and phone modal left exactly as they are. Both
   surfaces write the same store actions, so nothing can disagree. Use it for a
   while on real documents, on desktop and in the browser.
2. Phase 4: retire the dropdown, the modal, the active-figure bindings, the CSS
   and the orphaned keys.

If the menu turns out worse to use, PR 1 reverts cleanly and PR 2 never opens.
Nothing in PR 1 is a one-way door: no store, file-format or kernel change.

Two UX calls to make deliberately in PR 1, both one-line flips if they read
wrong in use:

- **Every row inside the toolbar's Style menu keeps it open** — Render as and
  Side radios and the Shadow row alike, through a `keepOpen` flag — because
  style settings are adjusted together. The **context menu's** Style rows close
  on a pick, as a context menu's picks do everywhere: its rows are built once
  at open (`useContextMenuController` builds on demand, by design), so a row
  kept open there would go on showing the check it was built with — which the
  browser pass caught. The colour swatch follows the picker on its own for the
  same reason.
- **The Style menu is the only path to colours**; there is no inline swatch on
  the bar. That is the width argument from the earlier plan, kept.
- **The toolbar's menus are non-modal.** Radix's default modal menu blocks
  pointer events outside it, so the press that dismissed the Style menu never
  reached the canvas and the figure stayed selected — caught in the browser
  pass. Non-modal, the press dismisses the menu and then does what it would
  have done (deselect, or select something else), which is how the viewport
  bar's hand-rolled dropdown always behaved. The right-click menu stays modal:
  a context menu's outside click only dismisses, everywhere.
- **While a colour picker is open, one press outside closes only the picker.**
  The engine closes its picker on any press outside it and that press then
  lands on the page, where — non-modal — it would dismiss the menu and deselect
  the figure. The picker is the topmost thing on screen, so `ContextMenuColorItem`
  keeps an invisible shield over the page (below the menu, above everything
  else) from `showPicker()` until the input blurs or a press lands on it; the
  press that closes the picker stops there. A picker closed from its own
  keyboard leaves no trace on the page, so the shield can outlive it by one
  press, which then only takes the shield down — the one wart, accepted.
- **Labels share one column per list.** `renderContextMenuItems` reserves the
  leading slot for every row when any sibling draws an icon or a check, so the
  glyph-less Side row sits under Render as. Menus with no icons at all — every
  other context menu today — keep their labels at the edge.

### 4. Browser pass so far (Chromium, dev server, 2026-09-14)

On a four-crease quarter fold (flat): the paintbrush opens the Style menu with
Render as ▸, Side ▸, three swatches painted from the model and a Shadow row;
Shadow toggles through the model binding (one entry, "Change folded model")
with the menu still open; a colour row focuses its input and `showPicker()`
returns, a four-step synthetic drag recolours the figure live, and **Escape
lands it as exactly one entry** ("Change folded model color") through the
unmount commit; ⌘Z restores the colour. Right-click ▸ Style ▸ Render as ▸
Wireframe, walked from the keyboard, re-renders the figure as wireframe and
closes the menu. Not driven here: a real picker window, a 3D figure, and the
desktop shell — those are the gates below.

### 5. Remaining gates before Phase 4

- [ ] Desktop app (WKWebView): open a swatch from the Style menu, pick in
      `NSColorPanel`, close the panel — menu still open, figure recoloured, one
      undo entry. **First thing to check, since it is the one engine the spike
      could not drive.**
- [ ] Firefox: the same sequence once (its picker is a GTK/Cocoa dialog; the
      `click()` fallback path is the one worth seeing).
- [ ] Flat and 3D figure, per the Phase 5 browser list.
