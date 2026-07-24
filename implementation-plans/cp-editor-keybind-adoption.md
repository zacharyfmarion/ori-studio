# CP Editor Keybinding Adoption (Brandon Wong / Oriedita layout)

## Goal

Adopt the Oriedita-optimized default keybindings Brandon Wong recommended in his
Ori Studio feedback as the CP editor's defaults. The design principle is his:
**the left hand rests on the home row and drives all frequent mode / tool /
line-type switches; the right hand stays on the mouse.**

This is a **coordinated remap** of the current single-letter CP bindings, not an
additive change — several of Brandon's keys currently belong to other tools, so
they move together. The bulk of the work is data (the shortcut registry); a small
tail needs custom canvas handling; a few items are blocked on missing features.

**Relationship to other plans:** the pan *hand-tool* mechanics and the
cross-platform `isPrimaryModifier` helper are specified in
[`viewport-pan-zoom-controls.md`](viewport-pan-zoom-controls.md). This plan
depends on that helper and only assigns pan's *keybind*. Zoom-to-cursor was
dropped (the wheel already does it).

## How the registry works (the levers)

- CP tool keys come from `ORIEDITA_DEFAULTS` in `keyboard/shortcuts.ts:54` — a
  map of `upstreamAction` → Oriedita keystroke string, parsed with
  `ctrlAsPrimary: true` (so `"ctrl X"` becomes a `Primary` chord). `buildCpShortcutDefinitions()`
  (`:174`) matches each `ORISTUDIO_CP_ACTIONS` entry's `upstreamAction` against it,
  **deduping first-come** (a later action wanting an already-used chord silently
  gets no default).
- Menu/global keys are `MENU_SHORTCUTS` (`:92`), viewport keys `VIEWPORT_SHORTCUTS`
  (`:120`). Menu accelerators are pulled from the same registry, so **changing a
  default automatically updates the menu label and Settings → Shortcuts** (single
  source of truth).
- Line types are `colRedAction` (Mountain), `colBlueAction` (Valley), plus
  edge/aux color actions.
- `getShortcutRegistryDiagnostics()` (`:239`) already reports duplicate default
  chords and reserved-key collisions — the invariant we test against.

So "wire up Brandon's layout" = edit `ORIEDITA_DEFAULTS` values, add entries for
commands that currently have none, plus a little custom handling for the two
held-modifier behaviors.

## Master mapping

Legend — **Change**: `noop` already correct · `remap` edit an existing
`ORIEDITA_DEFAULTS` value · `add` new binding for a command that has none ·
`custom` needs canvas handling beyond a registry chord · `blocked` missing
functionality.

| Key | Action | Command (upstreamAction) | Current default | Change |
|---|---|---|---|---|
| Esc | deselect | (hardcoded) | Esc | noop |
| E | extend same-color | `lengthenCrease2Action` | E | noop |
| B | angle bisector | `angleBisectorAction` | B | noop |
| C | change M/V of selection | `senbun_henkan2Action` | C | noop |
| Q | select | select (CreaseSelect) | — | add |
| W | move | `creaseMove…` (CreaseMove) | — | add |
| 2 | clone | clone (CreaseCopy) | — | add |
| A | line type → Mountain | `colRedAction` | M | remap (frees M) |
| S | line type → Valley | `colBlueAction` | V | remap (frees V) |
| D | line type → Edge | edge color action | — | add |
| F | line type → Auxiliary | aux color action | (F = fold today) | remap |
| Z | free line | `drawCreaseFreeAction` | L | remap (frees L) |
| X | change M/V along a line (ridges) | `creaseMakeMv` / `CreasesAlternateMv` | — | add |
| Y | perpendicular line | `perpendicularDrawAction` | P | remap (frees P) |
| T | flat-foldable line | flat-foldable draw (ready variant) | N | remap (frees N) |
| R | radial snapping | `DrawCreaseAngleRestricted` | R = Mirror today | remap |
| G | fold | `foldAction` | F | remap |
| H | grid fill (fish-bone) | `fishBoneDrawAction` | G | remap |
| 5 / 6 | zoom out / in | `viewport.zoomOut/In` | Primary+- / Primary+= | add (bare keys, keep existing) |
| 1 | pan | pan hand-tool | — | add (after pan tool lands) |
| Alt (hold) | toggle M/V while drawing | (color flip) | — | custom (Alt, not Ctrl) |
| Space | restricted / grid-snap draw | `drawCreaseRestricted…` | — | custom |
| 3 / 4 | rotate view left / right | — | — | blocked (no camera rotation) |
| grid mode toggle | — | grid config (UI-only) | — | blocked (no bindable action) |
| − / + | grid size down / up | `setOristudioCpGridSize` (UI-only) | — | blocked (no bindable action) |
| Backspace | stop calculation | — | — | out of scope (punted; also = Delete) |

**Net freed keys** after the remap: `M`, `V`, `L`, `P`, `N`. See "Orphaned tools".

## Cross-platform modifier policy (settled)

- **Primary/accel = Cmd (macOS) / Ctrl (Win/Linux)** for all standard shortcuts —
  already the `"Primary"` token. Never hard-code `metaKey`/`ctrlKey`.
- **Alt/Option is the third modifier** for Brandon's hold-to-modify behaviors
  (the M/V toggle) — same physical key on both platforms, never the accel.
- **Never bind bare Ctrl.** Route canvas pan through `isPrimaryModifier` (from the
  pan plan), which frees Ctrl on macOS for the Alt/Ctrl scheme.

## Approach (phased)

### Phase A — Foundation
- Land `isPrimaryModifier` (shared with the pan plan) if not already present.
- Add a registry invariant test (see Validation) **before** remapping, so the
  remap can't silently drop a binding.

### Phase B — The discrete remap (bulk, data-only)
Edit `ORIEDITA_DEFAULTS` and add entries so every "add"/"remap"/`noop` row above
resolves:
- Reassign line types: `colRedAction` M→A, `colBlueAction` V→S, add edge→D,
  aux→F.
- Reassign draw/construct: `drawCreaseFreeAction` L→Z, `perpendicularDrawAction`
  P→Y, flat-foldable N→T, `symmetricDrawAction`(Mirror) off R.
- Add the radial-snap command on R (`DrawCreaseAngleRestricted`).
- The F/G/H rotation (do together): aux→F, `foldAction` F→G, `fishBoneDrawAction`
  G→H.
- Add select→Q, move→W, clone→2, ridges→X (new `ORIEDITA_DEFAULTS` entries keyed
  by each command's `upstreamAction`).
- Confirm `foldAction`'s special routing (`CreasePatternPanel.tsx:2206`) keys off
  the action id, not the letter, so moving F→G needs no handler change.
- Verify diagnostics: zero duplicate default chords in the `crease-pattern`
  scope, no hard-reserved keys.

### Phase C — Held-modifier behaviors (custom canvas handling)
These are **not** registry chords — they're modes/held modifiers, like the
existing pan gesture.
- **Alt-hold = toggle M/V while drawing.** First read Oriedita's semantics in
  `third_party/oriedita` (is it "flip the color being drawn while held" vs "flip
  selection"?). Implement as an Alt-held modifier read in the canvas draw path;
  do **not** use Ctrl.
- **Space = restricted/grid-snap draw.** Confirm whether Oriedita treats this as a
  held modifier (snap the current draw to grid while held) or a sticky tool mode,
  then mirror it. **Contention:** the pan plan floated Space-hold as an optional
  hand-tool shortcut — pick one owner for Space (recommend: Space = restricted
  draw per Brandon; pan stays button-only). Decision needed before building.

### Phase D — Additive view keys
- Add bare `5`/`6` as extra `VIEWPORT_SHORTCUTS` chords for zoom out/in (keep
  `Primary+-`/`Primary+=`).
- Add `1` → pan once the pan hand-tool from the pan plan exists.

### Phase E — Blocked (track, don't build here)
- `3`/`4` rotate view — needs the camera-rotation feature (separate plan).
- Grid-mode toggle and grid-size `−`/`+` — need bindable actions surfaced from
  `CpViewControlsPanel` (today they're UI-only). Small enabling task, then a
  registry add.
- Backspace stop-calculation — punted (and Backspace = Delete here).

## Orphaned tools (decision)

Brandon's set doesn't cover every Ori Studio tool, so the remap frees `M V L P N`
and displaces one bare-key tool: **Mirror (`symmetricDrawAction`) loses R**. The
`Primary`-modified tools (`ctrl B` rabbit ear, `ctrl R` continuous symmetric,
`ctrl G` double symmetric, `ctrl M` reflect) do **not** conflict with Brandon's
bare keys and **stay**.

Policy (recommended): keep all non-conflicting existing binds; leave Mirror
without a default (still available in the rail/menu) rather than inventing a key.
Optionally reassign orphaned tools to freed keys (e.g. Mirror→M) — **flag for your
call**; default is to stay faithful to Brandon's clean layout and let power users
rebind.

## Edge cases & risks

- *Silent dedup drops a binding*: `buildCpShortcutDefinitions` drops a later
  duplicate to `null`. Mitigation: the invariant test (zero duplicates) is
  Phase-A, and the remap is reviewed as one table.
- *Hard-reserved / browser keys*: verify none of `Q W A S D F Z X Y T R G H` +
  `1 2 5 6` classify as hard-reserved (`classifyReservedKey`). Add to the test.
- *`foldAction` routing*: fold has a bespoke path; confirm it follows the action
  id when F→G (expected) so the fold key keeps working.
- *Muscle memory / discoverability*: menu accelerators + Settings auto-update from
  the registry, so the UI stays consistent for free. Worth a one-line "shortcuts
  changed" note for existing users — though per project state there are none, so
  no override migration is needed (`shortcutStore` keeps overrides per-action).
- *Space contention*: unresolved until the Phase-C decision (restricted-draw vs
  pan-hold). Do not implement Space twice.
- *Alt on macOS*: Option composes special characters in text inputs;
  `isShortcutEditingTarget` already ignores shortcuts while typing, and the M/V
  toggle is a canvas-draw modifier (not a text context), so this is contained —
  but verify Alt-drag on canvas doesn't trigger OS/browser gestures.
- *International keyboards*: Brandon's core letters are layout-stable; only the
  `= / -` zoom keys are layout-dependent, and those stay as-is.
- *Number keys*: bare `2` (clone) in `crease-pattern` scope and bare `1/5/6` in
  `viewport` scope must not collide with `Primary+0/1` (they won't — different
  modifiers/scope). Covered by the duplicate test.

## Validation

Tool-checkable (self-verified):
- New unit test over `getShortcutRegistryDiagnostics()`: **zero**
  `duplicateDefaultChords` for `crease-pattern` and `viewport`; **zero**
  hard-reserved default chords; and every Brandon key resolves to a command whose
  `uiStatus` is `ready`.
- `cd apps/web && npx tsc --noEmit`, `npm run lint:web`, `npm run test:web`.

Browser checklist (author-owned):
- Each home-row line-type key (A/S/D/F) sets the right color; Q/W/2 select/move/
  clone; Z free line, Y perpendicular, T flat-foldable, R radial, X ridges.
- G folds; H does fish-bone fill; former keys (M/V/L/P/N) no longer fire.
- Alt-hold flips M/V while drawing; Space does the restricted/grid-snap draw.
- Menu accelerators and Settings → Shortcuts show the new keys.

## Checklist

- [x] Phase A: `isPrimaryModifier` present; registry invariant test added first
- [x] Phase B: line-type remap (A/S/D/F) + free-line Z + perpendicular Y +
      flat-foldable T + Mirror off R + radial on R
- [x] Phase B: F/G/H rotation (aux→F, fold→G, fish-bone→H)
- [x] Phase B: add select Q, move W, clone 2, ridges X
- [x] Phase B: diagnostics clean (no dup/reserved); fold routing verified
- [ ] Phase C: Alt-hold M/V toggle — **BLOCKED, see below**
- [ ] Phase C: Space restricted-draw — **BLOCKED, see below**
- [x] Phase D: bare 5/6 zoom; hand tool + `1` → pan
- [ ] Phase E tracked separately: rotate view (3/4), grid toggle + size ±,
      stop-calc
- [x] Orphaned-tool policy: Mirror left unbound (available from the rail)
- [x] tsc / lint / test:web / i18n:check green; browser checklist pending

## Phase C blocker (needs a decision)

Reading the vendored Oriedita source, neither held-modifier behavior in
Brandon's diagram matches what that code actually does:

- **"toggle mv: ctrl"** — Ctrl-hold sets `CanvasModel.toggleLineColor`
  (`App.java:210`, `Canvas.java:245`), but its only behavioral consumer is
  `MouseHandlerSelectLasso.java:25`, where it flips lasso select ↔ unselect.
  The draw handlers pick their color purely from `d.getLineColor()` /
  `getAuxLineColor()` (`MouseHandlerDrawCreaseFree.java:58,70`) — **no
  M/V toggle path exists**. Separately, `BaseMouseHandlerLineSelect.java:51`
  uses Ctrl-hold for *angle-system snapping*.
- **"restricted line: space"** — there is **no Space handler at all** in the
  vendored source; the only `VK_SPACE` reference disables Swing's default
  space-activates-button behavior (`KeyStrokeUtil.java:21`).

So both would be *invented* behavior, which the repo's porting discipline
warns against. Worse for Space: `spacePressed` already drives
`allowLeftClickPan` in `BpPackingPanel` and `DesignPanel` — **Space-hold =
pan is this app's existing cross-panel convention**, and `CreasePatternPanel`
still carries a vestigial `data-space-pan` hook from the SVG era (it no
longer pans in the WebGL canvas). Giving Space to restricted-draw in the CP
editor would break that consistency.

Options, in rough preference order:
1. Ask Brandon what his Oriedita build actually does for these two.
2. Adopt app-consistent semantics instead: Space-hold = pan everywhere
   (restoring CP to match BP/Design), and put restricted-draw on a
   discrete key.
3. Implement Brandon's labels as new behavior: Alt-hold flips the active
   line color while drawing; Space-hold snaps the draw to the grid.
