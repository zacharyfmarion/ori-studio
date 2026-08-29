# Active Crease Angle and Insert Menu

## Goal

Two changes that share the crease-pattern bottom toolbar.

**1. An active crease angle.** Today a non-flat crease can only be authored
after the fact: draw it classic, select it, then set the angle from the context
panel's `FoldAngleControl`. The Discord request ("Draw a non-flat crease") is
for the angle to be part of *drawing*, so non-flat hinges can be laid down
directly and so it works across every draw tool rather than one of them.

Add a pen-style **active crease angle**: a single `|ρ|` that every newly drawn
mountain or valley crease inherits. Default 180° (classic), so nothing changes
until it is moved off 180. Exposed as a numeric field in the CP bottom viewport
toolbar and reachable on `Shift+A`.

Non-goals for V1: it does not touch edge or auxiliary lines (they cannot carry
an angle), it does not persist across sessions or into `.osf`, and it does not
change the existing selection-scoped `CreaseSetFoldAngle` path — the two are
siblings, not replacements.

**2. An Insert menu.** Move insertion off the bottom toolbar and into a new
top-level **Insert** menu in the menu bar. The `Insert image...` button leaves
the bar entirely, freeing its slot for the crease-angle field; the menu picks up
Text alongside Image, which today is only reachable by arming the Text tool from
the rail.

`Import (Add)...` stays in the File menu. It reads a file off disk, which is
what the File menu is for; Insert is for placing something onto the canvas.

## Approach

### Part 1 — Active crease angle

#### Kernel: where the angle gets stamped

The existing fold-angle model is already a native Ori Studio extension over the
Oriedita port — Oriedita creases are always a full ±180, so there is no upstream
behaviour to match here and no oracle to satisfy. Direction lives in the line
colour and magnitude in `LineSegment::fold_magnitude`
([line_segment.rs:219](crates/oristudio-cp/src/geometry/line_segment.rs:219)),
with `None` meaning classic.

Three pieces:

1. **Payload field.** `CreasePatternCommandPayload` gains
   `active_fold_magnitude_degrees: Option<f64>`
   ([lib.rs:108](crates/oristudio-cp/src/lib.rs:108)). Deliberately *not* the
   existing `fold_magnitude_degrees` at
   [lib.rs:130](crates/oristudio-cp/src/lib.rs:130), which is
   `CreaseSetFoldAngle`'s operand — one field means "set this on the lines I
   named" and the other means "give this to whatever you draw", and a reader
   that conflates them would apply the wrong one to the wrong set.

2. **Command-scoped pen.** `CreasePatternModel`
   ([model/mod.rs:471](crates/oristudio-cp/src/model/mod.rs:471)) gains
   `#[serde(skip)] pen_fold_magnitude: Option<FoldMagnitude>`. It is `None` at
   rest, which is what keeps the derived `PartialEq` honest for parity
   comparisons.

   Arming it is a **wrapper**, not the RAII guard first sketched here: a guard
   would have to hold the `&mut CreasePatternModel` that the dispatch body needs
   for its whole run. So `execute_command` becomes a five-line wrapper that arms
   the pen, calls the renamed `dispatch_command` (the entire previous body,
   untouched), and disarms — which covers the `?` paths inside the match without
   restructuring any of it. Verified by
   `the_pen_is_disarmed_after_a_failed_command`.

   The field ended up `pub` rather than private. Two things needed it: an
   integration test builds the model with `..Default::default()`, and
   `share::v1`'s exhaustive destructure — the guard that stops a new model field
   being silently dropped from a share link — must be able to name it, so the
   "not carried, and why" decision is recorded there instead of hidden behind
   `..`. It costs nothing, because `execute_command` overwrites the pen before
   dispatching, so a value set from outside is never observed.

3. **The stamp seam.** `add_line_segment_like_worker`
   ([operations/arrangement.rs:274](crates/oristudio-cp/src/operations/arrangement.rs:274))
   is the single insertion path for a *drawn* crease — 40-odd call sites across
   `construction.rs`, `generators.rs`, `point.rs`, `transform.rs` and
   `native/square.rs` all funnel through it. Stamp there, on the segment being
   appended, and only when:

   - the segment is a folding crease (`Red1` / `Blue2`), and
   - it carries no magnitude of its own — so a caller that already decided
     (a solver, an inherited colour) wins over the pen.

   Stamping here is correct across splits, and that is the reason to pick this
   line rather than any other. The worker appends first and *then* runs
   `divide_line_segment_with_new_lines`, and `with_coordinates` copies
   `fold_magnitude` through `..*self`
   ([line_segment.rs:269](crates/oristudio-cp/src/geometry/line_segment.rs:269)).
   So the drawn line's pieces inherit the pen, while an existing 180° crease it
   crosses is split into two pieces that keep *their* 180°.

**Rejected alternative, worth stating in the PR.** The type-safe version is to
widen `active_line_color(&command)` — 53 call sites in `lib.rs` — and the ~46
ported operation signatures that take a bare `LineColor` into a
`CreaseStyle { color, fold_magnitude }`. The compiler would then find every
site. It was not chosen because it changes the signature of a large slice of
ported Oriedita code for a feature Oriedita does not have, which makes every
future `upstream-drift` diff noisier. A reviewer who weighs that differently
should say so — the stamp seam is the smaller change, not the obviously
correct one.

**Also rejected:** diffing the segment list before and after the command. Split
halves of a crossed crease are new segments by any geometric identity, so the
diff would retag a crossed 180° crease to the pen angle.

#### Kernel: which operations get the pen

The frontend decides, in the branch of `cpCommandPayloadDefaults`
([CreasePatternPanel.tsx:291](apps/web/src/components/panels/CreasePatternPanel.tsx:291))
that already sets `payload.line_color` under `cpCommandUsesActiveLineColor`
([oristudioCpCommands.ts:1148](apps/web/src/lib/oristudioCpCommands.ts:1148)).

"Draws in the active colour" and "should take the active angle" are *not* the
same question, so this needs its own predicate rather than reusing that one.
Add a second set beside it and a
`cpCommandUsesActiveCreaseAngle(operationId)` = uses the active colour **and**
is not in the keep-classic set. Both sets in one file, so the difference between
them is readable in one screen.

**The keep-classic set:**

| Operation | Why |
| --- | --- |
| `DrawBlintz`, `DrawFishBase`, `DrawDoveBase`, `DrawBirdBase`, `DrawFrogBase` | The classical bases are flat-foldable constructions. Their creases are ±180 by definition, and that is what someone reaching for "Bird base" wants. |
| `VertexMakeAngularlyFlatFoldable`, `FoldableLineDraw`, `FoldableLineInput` | Same principle, applied further: these tools exist to *make a vertex flat-foldable*, which a non-180 crease at that vertex contradicts. Called out separately because it is an inference from the rule above rather than something explicitly asked for — easy to drop from the set if the judgment is wrong. |
| `LengthenCreaseSameColor` | Extends a crease keeping the crease's own colour, so it must keep the crease's own angle too. Its sibling `LengthenCrease` (the `Current(active)` variant at [lib.rs:3160](crates/oristudio-cp/src/lib.rs:3160)) does take the pen. |

Everything else that draws in the active colour takes the pen — the free and
restricted lines, the angle-restricted family, the symmetric and reflected
draws, the axioms, `PolygonSetNoCorners`, `VoronoiCreate`. Those are drawing
tools, not flat-foldability constructions.

`SquareGenerate` needs no entry: with the default `squareLineType: 'edge'` it
draws `Black0` lines, which the kernel's "folding crease only" condition already
skips, and in `'active'` mode taking the pen is the wanted behaviour.

**Previews get the pen from the surface, not the kernel** — fixed after the
first browser pass, where a 90° drag drew a flat 180° stroke and then committed
a 90° crease.

`preview_command` ([lib.rs:3974](crates/oristudio-cp/src/lib.rs:3974)) is not
the seam: it takes `&CreasePatternDocument` and builds its candidates on its own
path, never through `add_line_segment_like_worker`. The seam is
`toolPreviewColor` in the panel, which is the single fallback ink for "the
crease the active tool would draw" — used by the drag path
([CreasePatternWebglCanvas.tsx:3687](apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx:3687))
and, as `candidatePreviewGroups`' `fallback`, by the kernel-sequence path too.

It resolved only the *colour* half of the active crease. That was complete while
every crease was a full fold and stopped being so when the pen arrived, so it now
passes the ink through `foldAngleInk` — the same entry point the document's
stroke builder uses, so a candidate follows the View panel's fold-angle display
mode instead of inventing a second appearance for one fact.

Gated on `cpCommandUsesActiveCreaseAngle`, the predicate that decides the
*payload*, which extends the invariant that memo already documented ("what you
see while dragging is what gets committed") to the second half of the crease. A
tool whose creases are ±180 by construction previews flat because it commits
flat. `creaseAnglePreviewMagnitude` is defined *through*
`creaseAnglePayloadDegrees` so the two cannot disagree about whether the pen is
doing anything.

No wasm-bridge signature change is needed — the payload is deserialized whole
(`from_js`) — but the bridge **must be rebuilt**, since a body-only kernel edit
is invisible to lint, typecheck and vitest (AGENTS.md, "WASM bridge").

#### Frontend: state, control, shortcut

**State.** `activeCpCreaseAngle` as panel `useState`, beside `activeCpLineColor`
([CreasePatternPanel.tsx:568](apps/web/src/components/panels/CreasePatternPanel.tsx:568)).
The pen is the same kind of thing the active line colour is, and it belongs in
the same place. Explicitly *not* added to `OristudioCpToolOptions` — it is not a
tool setting, it is selection-independent authoring state, and putting it there
would tie it to the tool-settings reset.

**Modules.** Per AGENTS.md the panel composes and does not accumulate, so:

- `cp-workspace/foldAngle/activeCreaseAngle.ts` — React-free: validation
  (`0..=180`, finite), the "is this classic" predicate, the status label. Unit
  tested.
- `cp-workspace/foldAngle/CreaseAngleField.tsx` — the toolbar control.
- `cp-workspace/foldAngle/CreaseAnglePopover.tsx` — the popup.

`FOLD_ANGLE_PRESETS`
([foldAngleActions.ts:28](apps/web/src/cp-workspace/foldAngle/foldAngleActions.ts:28))
feeds both, rather than either restating the list.

**The toolbar control.** A field plus a disclosure caret — `ZoomReadout` is
already "a value that opens a preset list"
([ViewportToolbar.tsx:93](apps/web/src/components/panels/ViewportToolbar.tsx:93))
and `RotationField` is already "an editable numeric readout"
([ViewportToolbar.tsx:144](apps/web/src/components/panels/ViewportToolbar.tsx:144));
this is both. Take `RotationField`'s editing model verbatim: a draft string
while focused so partial input is not overwritten, commit on Enter and blur,
Escape reverts, `onFocus` selects so typing replaces. The caret opens the
popup. Digits typed in the field cannot reach the canvas shortcuts —
`isShortcutEditingTarget` bails on any input at the capture-phase listener.

Add it to `viewportGroups`
([CreasePatternPanel.tsx:2822](apps/web/src/components/panels/CreasePatternPanel.tsx:2822))
as its own group, with the same fine/coarse split `RotationField` and
`rotate-reset` already use:

- `kind: 'node'`, `only: 'fine'` for the field. A node cannot collapse into the
  overflow menu by design — its rows are `role="menuitem"` with typeahead, which
  a text field cannot be.
- `kind: 'action'`, `only: 'coarse'` — a single row that opens the popup,
  carrying `opensDialog` so the Radix menu's focus restore does not land behind
  it. One row, not six preset rows: the popup already *is* the touch-friendly
  form of this control, and six rows would crowd the menu with a control that
  has a better home.

**The popup.** A small floating panel: a numeric input and a row of preset
chips.

- **Frame.** Portaled, `role="dialog"` + `aria-modal`, anchored to the toolbar
  field. `FloatingToolbar`
  ([components/ui/FloatingToolbar.tsx](apps/web/src/components/ui/FloatingToolbar.tsx))
  already does the anchoring, collision-flipping, portalling and wheel
  passthrough against a plain `FloatingAnchorRect`, so pass the field's
  `getBoundingClientRect()`. Where there is no field to anchor to — the phone
  layout, or Shift+A pressed while the bar is collapsed — fall back to the
  centred frame, which is the same call `FoldedFigureModal` makes and for the
  same reason
  ([FoldedFigureModal.tsx:1-20](apps/web/src/cp-workspace/folded/FoldedFigureModal.tsx:1)).
- **Keyboard.** Focus opens on the input with its value selected, so typing
  replaces. The chips are ordinary `<button>`s in DOM order, so `Tab` walks
  input → chips and `Enter` activates whichever is focused — deliberately *not*
  a roving-tabindex composite, which would make Tab skip past the chips
  entirely. `Enter` in the input commits the typed value. `Escape` closes
  without changing anything. Selecting a chip or committing the input closes the
  popup.
- **Focus restore.** Capture `document.activeElement` at open and restore on
  close. Shift+A can fire from anywhere, so there is no fixed trigger to hand
  focus back to.
- **Dismiss on outside press** uses `pointerdown`, not `mousedown` — the canvas
  cancels `pointerdown` on essentially every press, which suppresses the
  compatibility mouse events, and that is what made the bar's popovers
  undismissable on an iPad ([ViewportToolbar.tsx:31-44](apps/web/src/components/panels/ViewportToolbar.tsx:31)).

The two share one value: the field is the at-a-glance readout and the
click-to-edit path, the popup is the keyboard path. Both write the same panel
state.

**Shortcut.** `Shift+A` as requested, which means moving the binding it
currently holds.

- `a1Action` (the three-point angle measure) moves from `'shift A'` to
  `'shift N'` ([shortcuts.ts:193](apps/web/src/keyboard/shortcuts.ts:193)). This
  breaks the deliberate Shift+M / Shift+A measure pairing, so the comment at
  [shortcuts.ts:184-193](apps/web/src/keyboard/shortcuts.ts:184) must be
  rewritten rather than left describing a layout that no longer exists.
- The comment at
  [shortcuts.ts:147-151](apps/web/src/keyboard/shortcuts.ts:147) explains that
  `OriStudioSetFoldAngle` took Shift+F *because* Shift+A belonged to `a1Action`.
  That reasoning is now obsolete; Shift+F stays where it is (it is the
  selection-scoped action, and moving it would churn muscle memory for no gain),
  but the comment needs to say the current reason.
- The new binding goes in `MENU_SHORTCUTS`, not `ORIEDITA_DEFAULTS`:
  `ORIEDITA_DEFAULTS` is keyed by Oriedita `upstreamAction` and drives CP *tool*
  actions, and this is not a tool — it has no kernel operation and arms nothing.
  A `menuShortcut('cp.setActiveCreaseAngle', …, { shift: true, key: 'a' })`
  entry routes it through `handleMenuAction`, which is focus-independent and
  gets the `command invoked` analytics event for free.
- `shortcuts.test.ts` should already fail on a duplicate chord; confirm it
  covers the `MENU_SHORTCUTS` × `ORIEDITA_DEFAULTS` cross-product, and add the
  case if it does not.

**What the shortcut does.** Opens the popup, focus in the input. So the flow is
`Shift+A`, type, Enter — or `Shift+A`, Tab to a chip, Enter. That is what the
Discord thread landed on ("a set crease angle action that just pops up an input
you can type into and press enter"), with the chips covering the common angles
without typing.

It reaches the panel through the surface-request channel described under the
Insert menu below — one channel, two kinds.

### Part 2 — Insert menu

**Bottom bar.** Delete the `image` group from `viewportGroups`
([CreasePatternPanel.tsx:2822-2835](apps/web/src/components/panels/CreasePatternPanel.tsx:2822)).
The hidden `<input type="file">`
([CreasePatternPanel.tsx:3303](apps/web/src/components/panels/CreasePatternPanel.tsx:3303))
stays — it is still the picker, it just gets clicked from somewhere else now.

**Menu.** A new top-level `Insert` in `getMenuBarDef`
([menus/menuDefinition.ts](apps/web/src/menus/menuDefinition.ts)), between Edit
and View:

| Item | Action id | Dispatch |
| --- | --- | --- |
| Image... | `insert.image` | surface request, below |
| Text | `insert.text` | `requestOristudioCpAction('Text')` |

`Import (Add)...` stays in File. It is a file-reading verb, and two menu homes
for one action is the kind of duplication that goes stale.

- `MENU_ACTION_IDS`
  ([commands/menuActions.ts:34](apps/web/src/commands/menuActions.ts:34)) gains
  both ids.
- `WorkspaceCapabilityId`
  ([lib/workspaceCapabilities.ts](apps/web/src/lib/workspaceCapabilities.ts))
  gains them, gated to an editable crease pattern. `menuHasVisibleItems` then
  drops the whole Insert menu outside a CP surface, the same way Design and
  Crease Pattern already vanish.
- **Text** needs no new plumbing: `Text` is a registered operation
  ([oristudioCpCommands.ts:707](apps/web/src/lib/oristudioCpCommands.ts:707)),
  so it goes through `CP_CONTEXT_ACTIONS` →
  `deps.workspace.requestOristudioCpAction`
  ([menuActions.ts:447](apps/web/src/commands/menuActions.ts:447)) and arms the
  tool; the next canvas click places the box.
- **Image** needs a new channel. `addImageFromFile` closes over `overlayView`
  and `viewportRef`
  ([useCpAnnotations.ts:161](apps/web/src/cp-workspace/annotations/useCpAnnotations.ts:161)),
  so it cannot be lifted out of the panel.

#### The surface-request channel

Two things now need to ask the mounted CP panel to do something that is not a
kernel operation: open the image picker, and open the crease-angle popup. One
channel, not two near-identical ones:

```ts
type CpSurfaceRequestKind = 'insert-image' | 'crease-angle';
oristudioCpSurfaceRequest: { id: number; kind: CpSurfaceRequestKind } | null
requestOristudioCpSurface(kind: CpSurfaceRequestKind): void
```

Copy the id-bump and clear-by-id pattern from `requestOristudioCpAction`
([creasePatternSlice.ts:1962](apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts:1962))
— the id is what makes a repeated request fire twice. The panel grows one
effect beside the existing action-request effect
([CreasePatternPanel.tsx:1524](apps/web/src/components/panels/CreasePatternPanel.tsx:1524))
that switches on `kind` and clears by id.

Keeping this store-backed rather than reading the published `cpToolSurface`
registry keeps `menuActions.ts` store-shaped, which is what its `deps` interface
already is.

**What comes free.** The native macOS menu is generated from `menuDefinition`,
so it picks the menu up with no separate wiring (verify with
`npm run check:desktop` and the Tauri dev app). Analytics is covered by the
`handleMenuAction` chokepoint — `analyticsCommandGroup`
([menuActions.ts:736](apps/web/src/commands/menuActions.ts:736)) derives the
group from the `insert` prefix, so no hand-placed `track` call is wanted.

### i18n

New strings in `menu` (the Insert menu and its items) and `tools` (the
crease-angle field label, its aria-label, the preset rows). Inline English
defaults, then `i18n:extract` → translate all 8 locales → `i18n:stamp` →
`i18n:check`.

## Affected Areas

**Kernel**
- `crates/oristudio-cp/src/lib.rs` — payload field, RAII pen guard in
  `execute_command`
- `crates/oristudio-cp/src/model/mod.rs` — `pen_fold_magnitude` + accessors
- `crates/oristudio-cp/src/operations/arrangement.rs` — the stamp in
  `add_line_segment_like_worker`

**Web — crease angle**
- `apps/web/src/engine/oristudioCpTypes.ts` — payload field mirror
- `apps/web/src/components/panels/CreasePatternPanel.tsx` — pen state,
  `cpCommandPayloadDefaults`, toolbar group, image-request effect
- `apps/web/src/cp-workspace/foldAngle/activeCreaseAngle.ts` *(new)*
- `apps/web/src/cp-workspace/foldAngle/CreaseAngleField.tsx` *(new)*
- `apps/web/src/cp-workspace/foldAngle/CreaseAnglePopover.tsx` *(new)*
- `apps/web/src/lib/oristudioCpCommands.ts` — the keep-classic set and
  `cpCommandUsesActiveCreaseAngle`
- `apps/web/src/keyboard/shortcuts.ts` — `a1Action` move, new menu shortcut,
  two comment blocks
- `apps/web/src/styles/theme.css` — field styling beside
  `.viewport-toolbar__rotation-input`, and the popover

**Web — Insert menu**
- `apps/web/src/menus/menuDefinition.ts`
- `apps/web/src/commands/menuActions.ts`
- `apps/web/src/lib/workspaceCapabilities.ts`
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts`,
  `.../types.ts`
- `apps/web/public/locales/*/menu.json`, `.../tools.json`

## Checklist

### Kernel
- [x] Add `active_fold_magnitude_degrees` to `CreasePatternCommandPayload`, with
      a doc comment saying how it differs from `fold_magnitude_degrees`
- [x] Add the command-scoped `pen_fold_magnitude` to `CreasePatternModel` and
      the RAII guard in `execute_command`
- [x] Stamp in `add_line_segment_like_worker`, gated on folding-crease + no
      existing magnitude
- [x] Unit tests: pen applies to a drawn mountain; does not apply to edge or
      aux; a crossed classic crease keeps 180 on both halves; a segment that
      arrives with its own magnitude is untouched; the pen is `None` after a
      command that returns `Err`
- [x] `cargo fmt --check`, `cargo clippy --workspace --all-targets -- -D
      warnings`, `cargo test --workspace`

### Crease angle — web
- [x] Mirror the payload field in `oristudioCpTypes.ts`
- [x] `activeCreaseAngle.ts` with validation + label, unit tested
- [x] Keep-classic set + `cpCommandUsesActiveCreaseAngle` in
      `oristudioCpCommands.ts`, with a test asserting the five bases, the three
      flat-foldable tools and `LengthenCreaseSameColor` are excluded while
      `DrawCreaseFree` / `DrawCreaseAngleRestricted` / `SymmetricDraw` are not
- [x] `activeCpCreaseAngle` panel state; send it from
      `cpCommandPayloadDefaults` under the new predicate
- [x] `CreaseAngleField.tsx` + the fine/coarse toolbar entries, with a test that
      the coarse row reaches the overflow menu and carries `opensDialog`
- [x] `CreaseAnglePopover.tsx`: anchored frame with the centred fallback, Tab
      order input → chips, Enter commits, Escape closes, focus restored to
      wherever it came from
- [x] Rebuild the CP wasm bridge —
      `npm --workspace @treemaker/web run build:oristudio-cp-wasm`

### Shortcut
- [x] Move `a1Action` to `'shift N'`; rewrite the measure comment block
- [x] Add the `cp.setActiveCreaseAngle` menu shortcut on `{ shift, key: 'a' }`
- [x] Rewrite the obsolete "Shift+A belongs to a1Action" comment on
      `OriStudioSetFoldAngle`
- [x] Confirm `shortcuts.test.ts` catches a duplicate chord across
      `MENU_SHORTCUTS` and `ORIEDITA_DEFAULTS`; add the case if not
- [x] Wired through `handleMenuAction` → `requestOristudioCpSurface`, not a
      panel `keydown` listener

### Surface-request channel
- [x] `oristudioCpSurfaceRequest` + `requestOristudioCpSurface(kind)` in
      `creasePatternSlice.ts` / `types.ts`, id-bump and clear-by-id
- [x] One panel effect switching on `kind`, with a test that the same request
      twice in a row fires twice

### Insert menu
- [x] Remove the `image` group from `viewportGroups`; keep the file input
- [x] Add the Insert menu, two action ids, two capability ids
- [x] `insert.text` → `requestOristudioCpAction('Text')`
- [x] `insert.image` → `requestOristudioCpSurface('insert-image')`
- [x] `Import (Add)...` left untouched in the File menu
- [x] Menu hides entirely outside a CP surface — extend
      `menuDefinition.test.ts`

### i18n and validation
- [x] `i18n:extract`, translate 8 locales, `i18n:stamp`, `i18n:check`
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] `npm run check:desktop`; confirm Insert appears in the native macOS menu
- [x] Browser verification: set 90° via `Shift+A`, draw with Draw Line, Angle
      Restricted Line and Reflect Across Creases, and confirm the fold-angle
      badges (`CpFoldAngleLayer`) read 90 on all three; confirm a crossed
      classic crease still reads 180; confirm Bird base still draws entirely at
      180 with the pen at 90

## Follow-ups (not V1)

- Persist the pen across sessions, and/or round-trip it through `.osf`
  document metadata the way the Oriedita active line colour is restored.
- Consider whether `viewport-status-readout`
  ([CreasePatternPanel.tsx:3353](apps/web/src/components/panels/CreasePatternPanel.tsx:3353)),
  which already reports the active line type, should also report the pen angle
  — probably not while the field itself is on the bar.
