# What the Layer order dialog should share with the Fold workspace

Reference for the dialog's design phase. Answers the owner's question: "if
possible, share how we render a cross-section of layers and select stacks with
the Fold workspace; if they do two different things, don't over-abstract."

**Short answer.** They overlap in the parts that do the same thing, and differ
in the parts that carry meaning:

- Fold's cross-section picker answers "which flaps move with this fold line?"
- The dialog's Layers here answers "which face is on top at this spot, and
  which pairs are forced?"

So share four pieces:

1. The pure "stack under the pointer" hit test.
2. A "light these faces / cells over the paper" fill helper, with Fold's alpha
   ladder.
3. A small listbox shell, `LayerStackList`, that owns the box, the "Top"
   caption, the row frame, hover, focus and keyboard.
4. The pane component, generalised over its hit type.

Keep the models separate. Fold's model is flaps, display layers, extents along
a line, brackets and seeds. The dialog's model is faces at a cell, forced or
free, reasons, and constraints.

## Evidence and limits

- **Code read at `eb4b51c54`** (PR #476, `claude/fold-solver-perf`), extracted
  read-only with `git archive`:
  - `FoldCrossSectionPicker.tsx/.module.css/.test.tsx`
  - `fold/tools/crossSection.ts`
  - `fold/canvas/foldPicking.ts`, `foldPaneOverlays.ts`, `useFoldCanvasPaint.ts`,
    `useFoldCanvasInks.ts`, `foldCanvasModel.ts` (refused inks)
  - `components/fold/canvas/FoldCanvas.tsx`, `FoldPane.tsx`,
    `FoldCanvas.module.css`
  - `components/fold/orders/*`, `fold/orders/*`
  - `components/fold/import/*`
  - `FoldToolWindow.tsx/.module.css`, `FoldFlapChips.*`
  - `cp-workspace/surface/useCpSurface.ts`
  - `implementation-plans/fold-workspace.md` (D8, D13, D14)
- **Seen live.** I looked at the already-running dev server of the
  `fold-workspace-launch-b42eba` worktree (port 5341). Its working tree has no
  diff from `eb4b51c54` in the picker, cross-section, overlay or orders files. I
  did not edit or build anything there.
  - Steps: Fold → Import Sample → Square Base, then a valley fold from the
    top-left corner to the bottom-right corner. The picker appeared with 4 rows
    and 2 flaps.
  - I measured computed styles with `getComputedStyle` and hovered a row.
  - Then I cancelled the fold and undid the import.
  - That browser profile uses a One Dark–like theme, so the measured colours
    below are that theme's. **Mockups must use the tokens, not the hex values.**
- **Not seen live, read from code only:**
  - "Inspect layer stacks" (`FoldOrderStacks`) and the order chooser;
  - phone and coarse-pointer sizes;
  - a woven section.
- **No tests run.**

---

## 1. What Fold has today that touches layer stacks

| # | Piece | Where | What it is for |
|---|---|---|---|
| A | **Cross-section layer picker** | `components/fold/FoldCrossSectionPicker.tsx` with its model in `fold/tools/crossSection.ts` | Picks which **flaps** a located fold moves. A listbox of display layers along the fold line. |
| B | Flap chips | `components/fold/FoldFlapChips.tsx` (on `ui/Chip`) | The keyboard and touch path for the same flap picks |
| C | Order chooser and "Inspect layer stacks" | `components/fold/orders/FoldOrderChooser.tsx`, `FoldOrderStacks.tsx`, `fold/orders/useFoldOrderInspection.ts` | Steps through whole layer orders: ‹ Order n of m ›. Lists every multi-layer cell as text. |
| D | Canvas lighting | `fold/canvas/foldPaneOverlays.ts` (`foldMovingTint`, `foldTargetsTint`, `foldRegionTint`); `foldCanvasModel.ts` (`refusedFaceInks`) | Accent fills over the paper for moving, hovered, targeted or changed cells. Danger tint on refused faces. |
| E | Picking | `fold/canvas/foldPicking.ts` | Points, creases and free points on both panes. Holds the private `stackAt` over `subfaces` and `foldStackAt` / `topSheetPointAt` / `sheetToScene`. |
| F | Two-pane canvas | `FoldCanvas.tsx` → two `FoldPane`s on `cp-workspace/surface/useCpSurface.ts` | The folded form and the crease pattern, each with its own camera |

**The spec is out of date on one point.** §7.5 says "its Import dialog's
order cards". There are no order cards at `eb4b51c54`. Commit `50d94c4bb`
(2026-10-18) removed them, and the import now hands off to the full Fold
canvas:

- `FoldImportOrderChooser`, in a `ToolHintWindow` titled "Choose layer order";
- one "Region n" button per independent part;
- ‹ "Order n of m" ›, "Find more orders", Back and "Use this order";
- `FoldOrderStacks` under all of that.

The compound-fold stepper uses the same `FoldOrderChooser` inside
`FoldToolWindow` while `preview.orderResolution.active`. §7.5 should say
"its order chooser (compound folds and Import CP)".

---

## 2. The cross-section picker, exactly (piece A)

It is a **list and a side-view drawing at once**:

- each row is one display layer;
- each row draws a thin bar where that layer meets the fold line, so the bars
  together form a schematic side view along the line;
- SVG brackets join two rows where a bend connects them.

There is no separate drawing.

### 2.1 Where it sits

It is inside the Fold tool window, which is a `ToolHintWindow` at the bottom
right of the viewport.

- **The window:**
  - measured 288 px wide;
  - background a step lighter than the canvas, measured
    `color(srgb .13 .15 .17)` in that theme;
  - 1 px border (`#3e4452` measured), radius 8 px;
  - shadow `0 8px 24px rgba(0,0,0,.55)`.
- **The layers section** comes after the Fold / Moving side rows, behind a
  1 px `--border-subtle` divider with 8 px top padding. Its layout is a grid
  with a 7 px gap:
  1. **Header line** (flex, baseline, space-between):
     - "LAYERS": 0.58rem, weight 800, uppercase, `--text-muted`;
     - right-aligned "2 of 4 layers moving": 0.7rem, `--text-secondary`,
       tabular numbers.
  2. **The picker box** (below).
  3. **Help:** "Click a layer to include or exclude its flap. Brackets show
     where a fold joins two layers." Set in 0.7rem, `--text-tertiary`,
     line-height 1.35.
  4. **Flap chips:** "Flap 1 · 2 layers" (pressed, accent) and "Flap 2 · 2
     layers".

### 2.2 Markup

```
div.section [data-woven]                       ← the box
  div.top  aria-hidden  "Top"                  ← caption over the tag column
  div.stack (position: relative)
    div.rows role=listbox aria-label="Layers at the fold line, top to bottom"
             aria-multiselectable aria-orientation=vertical
             data-own-arrows data-fold-layer-pick
             onMouseLeave → onHover(null)
      div.row role=option aria-label="Layer 3, Flap 2" aria-selected
              tabIndex=0|-1 data-state=picked|added|excluded
              [data-needed] [data-unordered] [aria-disabled]
              onMouseEnter → onHover(flap); onClick → onToggle(flap)
        span.track (position: relative)
          span.bar  style="left: from%; width: (to-from)%"
        span.tag  aria-hidden  "Flap 2" | ""   ← only on the first row of a run of one flap
    svg.brackets aria-hidden viewBox="0 0 100 <rowCount>" preserveAspectRatio=none
      path d="M x y1 C x±4 y1, x±4 y2, x y2" data-state vector-effect=non-scaling-stroke
```

### 2.3 Numbers

Measured on the 4-row Square Base fold; they match the module.

| Part | Value |
|---|---|
| Box | 1 px solid `--border-subtle`; radius `--radius-sm` (4 px); background `--bg-primary`; padding 6 px 0; grid gap 2 px. Measured 270 × 99 px for 4 rows: 1 + 6 + 11 (caption) + 2 + 4 × 18 + 6 + 1. |
| "Top" caption | padding 0 8 px; 0.58rem (9.28 px); weight 800; uppercase; right-aligned over the tag column; `--text-muted`. |
| Row | grid `minmax(0,1fr) 52px` (measured 192 px + 52 px); column gap `--space-2` (8 px); padding 0 8 px; **height 18 px** (`--row-height`); no gap between rows, so the bracket SVG can count in rows. |
| Row on a coarse pointer | height 28 px. The comment says "the chips under the picker are the full-size path", so the rows are **not** a 44 px touch target. |
| Bar | absolutely placed at 50 % of the track and centred vertically; **3 px tall**, min-width 3 px, radius 999 px (a pill). `left` and `width` are the layer's span along the line, as a fraction of the section. |
| Unordered row (lies beside the row above, not under it) | 1 px `--border-subtle` hairline on top of its track |
| Tag | 0.66rem (10.56 px); right-aligned; ellipsis; `--text-tertiary`; `--text-secondary` when the row is picked or added |
| Brackets | SVG over the bars' column only: `left: 8px`, `width: 100% − 16px − 52px − 8px`. Stroke 1.5 px, no fill, `pointer-events: none`. A cubic from the upper row's middle to the lower row's middle at the bend's x, bulging 4 % of the track past the end, or before the start when the bend is in the first half. |
| Hover | row background `--bg-surface`. None when `aria-disabled`. |
| Focus | `outline: 2px solid --accent-primary; outline-offset: -2px` (inset ring) |

### 2.4 Inks by state

The rule, from the module's own comment: **every line is solid**. A dashed line
reads as a valley fold and a dotted one as a hidden edge, so state is told by
ink alone.

| `data-state` | Meaning | Bar and bracket ink | Measured (One Dark) |
|---|---|---|---|
| `picked` | Its flap is in the seed: it moves | `--accent-primary` | `rgb(97,175,239)` |
| `added` | Not picked, but the closure moves it anyway | `--moved-along` = `color-mix(accent 55%, --bg-primary)` | — |
| `excluded` | Left behind | `--left-behind` = `color-mix(--text-muted 60%, transparent)` | `srgb(.36 .39 .44 / .6)` |
| `[data-needed]` | A refusal says this flap is in the way | `--status-danger`, bar only | — |

The tag also uses ink only: `--text-secondary` when picked or added,
`--text-tertiary` otherwise. Selection is never a filled row background.

### 2.5 The live sample, in words

The box is 270 × 99 px with a dark well background and a faint 1 px border
with 4 px corners:

- "TOP" in tiny heavy grey capitals sits at the top right.
- Below it are four 18 px rows. Each has a 3 px rounded bar running the full
  192 px of the left column, because all four layers span the whole fold line.
- **Rows 1–2:** bright accent bars. Row 1 carries "Flap 1" at the right in
  light grey.
- **Rows 3–4:** dim grey bars. Row 3 carries "Flap 2" in darker grey.
- At the **left** end of the bars, two small 1.5 px curved brackets bulge
  leftward 4 % of the track: one joining rows 1–2 in accent, one joining rows
  3–4 in grey. The bend that joins each pair lies at the start of the line.
- Hovering row 3 lightens its background to `--bg-surface`.
- On the canvas, the moving triangle of the folded form turns from a pale
  accent wash (α 0.30) to a strong one (an extra α 0.50 layer over the
  cells of Flap 2's faces, clipped to the moving side).
- **The crease-pattern pane does not react.**

### 2.6 Keyboard and hover linking

- **One tab stop** (roving tabindex): the row last moved to, else the first
  picked, else the top.
- ↑ / ↓ move and stop at the ends; Home and End jump to the ends.
- **Space** toggles the row's flap.
- **Enter is not handled**: it bubbles to the workspace, which commits the
  fold.
- The handler returns early if `event.defaultPrevented`, so a key the
  workspace's keyboard already acted on is ignored.
- The `data-own-arrows` marker makes the workspace's own arrow shortcuts
  stand down while the list has focus.
- The `data-fold-layer-pick` marker makes Enter still commit while focus is
  in the picker or the chips.
- **Hover links one way only.** Row → `onHover(flap)` → `toolState.hoveredFlap`
  → `useFoldCanvasPaint` lights that flap on the **folded pane**. Hovering the
  canvas never highlights a row; the one exception is a woven section, whose
  rows switch to the interval under the pointer. Nothing lights on the
  crease-pattern pane, and keyboard focus does not light the canvas.
- Accessible names are whole sentences per case, so a locale can reorder them:
  "Layer 5, Flap 2, moves with the fold, beside layer 4".

### 2.7 "Inspect layer stacks" (piece C), from code

- A `<details>` (0.75rem, max-height 180 px, scrolls) with the summary
  "Inspect layer stacks" in `--text-secondary`.
- Then a note: "Select a region to highlight it. Layers are listed from front
  to back; highlighted differences are relative to the first preview."
- Then one ghost `Button size="sm"` per cell with more than one face. Its text
  is "Region 7: 3 → 1 → 12", with face ids + 1 and a trailing " •" when the
  stack changed since the first preview. It has `aria-pressed` and toggles
  selection.
- **On the canvas** (`FoldCanvas`, `orderTint`), with no region selected,
  every changed cell is lit, and so is every cell holding one of the part's
  undecided pairs. With a region selected, only that cell is lit. Both use
  `foldRegionTint` at **α 0.42** in the accent.

This is the closest existing thing to the dialog's "Layers here" plus
"open spots". It is a crude stand-in, so it should be **replaced by the
dialog** (decision 6), not shared.

---

## 3. Units and what a pick means: Fold versus the dialog

| | Fold's cross-section picker | Dialog's Layers here (§6.3–6.4) |
|---|---|---|
| **Where** | Along a fold line: a 1-D section, intervals with lengths | At a spot (one cell, `subface`): a 0-D section with no length |
| **Row unit** | A **display layer**: faces joined across flat creases, which share one isometry. "Rows… are display layers, never faces" (D14 §2). | A **face**: a piece of paper between creases (spec §5) |
| **Row count** | Every display layer on the moving side that meets the line. Rows can lie *beside* each other (`unordered`). Woven sections switch to per-interval stacks. | Exactly the cell's `faces_top_to_bottom`. Inside one cell every face covers the whole cell, so there is nothing "beside" and no extent. |
| **What a row's drawing encodes** | Where that layer meets the line (bar from–to) and bends joining rows (brackets) | Nothing positional. All bars would be full width, so a bar carries no information here. |
| **Selection unit** | A **flap** (several rows at once); multi-select toggle | **One face** ("On top here", single choice), or **an ordered pair** ("Above / below": A then B) |
| **What the pick does** | Changes **which layers move** in the fold being built (the seed). The closure may add more ("added"). | Adds a **constraint** on the order. Nothing moves; the preview re-solves. |
| **Row states** | picked, added, excluded, plus needed (a refusal) | free; **forced** with a reason ("always under X: set by the creases"); chosen on top; pair A or B; part of a conflict |
| **Disabled rows** | Only the whole list while the engine is held | Per row: forced rows are `aria-disabled` but stay focusable and say why |
| **Side of paper** | Not shown | Shown per row (colour or white) |
| **Hover link** | Row → folded pane only | Row ↔ both panes, and pane → row (spec §6.2) |
| **Enter / Space** | Space toggles; Enter commits the fold | Enter chooses (spec §6.10); Space should do the same; Escape belongs to the dialog |
| **Touch** | 28 px rows, because the chips are the touch path | No chips, so rows must be **≥ 44 px** (`--touch-target`) on coarse pointers |

**Display layers versus faces at a spot.** Two faces of one display layer are
coplanar pieces of the same layer and never overlap. So at a single cell, each
display layer contributes at most one face, and the stack of faces and the
stack of display layers are the same length, one to one. The difference only
shows when you **light** a row's paper: one face, or the whole precreased
layer.

This needs a decision for the dialog. "Face A above face B wherever they
overlap" is a different relation when A is half of a precreased layer.

**Recommendation:** follow Fold's rule. Rows and labels name the display layer,
and constraints store a paper point inside the face, which spec §8.1 already
does. The solver works in faces underneath.

**Conclusion.** The *data* and the *meaning* differ: line versus point,
display layer versus face, flap toggle versus constraint, moving versus
ordering. The *chrome* is the same: a vertical stack of layers listed top
first in an inset well, with the same keyboard model and the same "ink, never
dashes" rules.

---

## 4. Recommendation

### 4.1 Share as-is: already shared, use directly

1. **`useCpSurface`** (`cp-workspace/surface/useCpSurface.ts`).
   - It is already generic over `Hit` and already used by References and Fold.
   - The dialog's two panes are built on it: renderer lifecycle, camera, fit,
     pan, pinch, wheel, click versus drag, the hover probe.
2. **The shared paper painter and its per-face ink.**
   - `paperSceneToFoldedGeometry(scene, style, { policy, faces })` from
     `cp-workspace/adapters/cpFoldedToScene.ts`.
   - `FoldedFaceInk { tint?, alpha? }` covers X-ray (per-face `alpha`) and
     conflict faces.
   - Fold's `refusedFaceInks` uses this with `--status-danger` at **α 0.32**,
     which is the look for "these faces clash".
   - **Note:** per-face ink tints only what is painted, so hidden parts stay
     hidden. To light a face *including the parts under other layers* (spec
     §6.2), use the overlay fill channel (4.2-B), not face ink.
3. **The renderer's overlay fill channel** (`setDiagnosticFills`), drawn above
   the paper. Fold lights everything through it.
4. **UI primitives Fold already uses:**
   - `useModalDialog` (the Import dialog's modal and shortcut barrier);
   - `PaneToggle` (phone pane switch);
   - `Chip`;
   - `Notice` with the danger tone (refusal and conflict, as
     `FoldRefusalNotice` does).

### 4.2 Extract into shared modules, with the dialog as the second user

Each extraction is its own commit on the dialog's branch, which is off #476,
and must change nothing in Fold. Fold's tests find elements by role and name,
so they gate it.

**A. The stack under the pointer: share it. It is the same thing.**

Fold's private `stackAt` over the scene's `subfaces`, and its `IndexedSubface`
(polygon, bbox, stack), read `{ polygon, faces_top_to_bottom }`. That is the
kernel's `OristudioCpFoldedPaperSubface`. Fold's `FoldScene` extends the same
`OristudioCpFoldedPaperScene` that Edit's figure carries.

Proposed module: `apps/web/src/cp-workspace/picking/stackHitIndex.ts`, beside
`lineHitIndex.ts`. It is pure, with no React and no store.

```ts
export interface StackCell { polygon: readonly Point[]; faces_top_to_bottom: readonly number[] }
export interface StackHitIndex { cells: readonly IndexedCell[] }      // polygon, bbox, stack
export function indexStacks(cells: readonly StackCell[]): StackHitIndex;
/** The cell under p and its faces, top first; null off the paper. */
export function stackAt(index: StackHitIndex, p: Point, epsilon = 0): { cell: number; faces: readonly number[] } | null;
/** The face whose sheet outline holds a sheet point (from `sheetToScene`'s loop): the CP pane's face pick, and how a saved paper point resolves to a face. */
export function faceAtSheetPoint(scene: Pick<OristudioCpFoldedPaperScene, 'faces' | 'sheet_points'>, p: Point): number | null;
```

- Fold's `foldPickIndex` keeps `subfaces` as a `StackHitIndex`.
  `foldStackAt`, `topSheetPointAt`, `foldMovingTint` and `foldTargetsTint`
  then read it, and `sheetToScene` calls `faceAtSheetPoint`.
- The dialog needs **the cell id** (the spot's identity), which Fold's
  version throws away. That is why `stackAt` returns `{ cell, faces }`.
- **Caveat: convexity.** Fold's overlay is convex by construction (D8), so
  `insideConvex` is right there. Oriedita's subfaces and large faces need not
  be convex (spec §13).
  - The shared version should use a general point-in-polygon test, or state
    that it needs convex cells.
  - Hit-test the scene the **solver** produced, not Oriedita's scene, so spots
    and faces are already in constraint terms and pointer moves never cross
    the face bridge.
- **Budget** (D14 tier 1): ≤ 4 ms per pointer move. It is a linear scan with a
  bbox reject. That is fine at Fold's sizes, but check it on the 850-face
  iguana's cell count before relying on it.

**B. Lighting cells and faces over the paper, with one alpha ladder.**

`foldPaneOverlays.ts` repeats the same convex-ring fan triangulation into a
`FillGeometry` three times. The dialog would add at least five more:

- the hovered face, including its hidden parts;
- the selected spot;
- open spots;
- changed spots;
- a constraint's faces, the overlap groups, and conflict faces.

Proposed module: `apps/web/src/cp-workspace/renderer/fillTint.ts`.

```ts
export const TINT = { faint: 0.16, hover: 0.26, moving: 0.30, picked: 0.42, emphasis: 0.50 } as const; // Fold's existing numbers, named
export function ringsFill(rings: readonly (readonly Point[])[], rgba: Rgba, alpha: number): FillGeometry | null;
/** Every cell whose stack holds one of `faces`, whole: a face shown including the parts under other layers. */
export function cellsHoldingFill(index: StackHitIndex, faces: ReadonlySet<number>, rgba: Rgba, alpha: number): FillGeometry | null;
export function joinFills(a: FillGeometry | null, b: FillGeometry | null): FillGeometry | null; // moved from foldPaneOverlays
```

Fold's `foldTargetsTint`, `foldRegionTint` and `foldMovingTint` become thin
wrappers. They keep their own lineage-id mapping and line clipping, which are
Fold's.

**Why share the alpha ladder.** Two surfaces that do not know about each other
must agree on what "hovered" and "picked" look like over paper. By the styling
rules' own test, that makes the ladder a shared value.

**C. `LayerStackList`: the stack-list shell (`components/ui/`).**

This is the shareable part of "how we render a cross-section". The listbox and
its chrome are the same, and the rows' content is not.

```tsx
<LayerStackList
  label="Layers here, top to bottom"   // the listbox's accessible name
  topLabel="Top"                        // caption over the trailing column; omit for none
  density="compact" | "regular"         // 18 px rows (Fold) | 32 px rows (dialog); coarse: 28 | 44
  rows={rows}                           // { key, label (aria), selected, disabled?, state? (data-state passthrough) }[]
  multiple={boolean}
  disabled={boolean}                    // the whole list held (Fold's engine wait)
  activateKeys={[' ']}                  // Fold: Space only (Enter is the workspace's); dialog: ['Enter', ' ']
  onActivate={(index) => …}
  onHover={(index | null) => …}         // pointer enter / list leave
  onFocusRow={(index) => …}             // optional: keyboard focus lights the panes too (dialog)
  linked={index | null}                 // optional: a row lit from a pane hover (dialog's pane → row link)
  renderRow={(row, index) => <… />}     // the caller's content, styled in the caller's module
  overlay={<svg … />}                   // optional, drawn over the rows (Fold's brackets)
  {...dataMarkers}                      // e.g. data-fold-layer-pick, passed to the listbox
/>
```

- **The shell owns:**
  - the box (border, radius, well background, padding);
  - the "Top" caption;
  - the row frame (grid with a 52 px trailing column, height by density,
    padding, no gaps between rows);
  - hover background, inset focus ring and `aria-disabled` look;
  - the roving tab stop, ↑ / ↓ / Home / End, `defaultPrevented` respect and
    `data-own-arrows`;
  - `role="listbox"` / `role="option"` with `aria-selected` and
    `aria-multiselectable`;
  - the coarse-pointer bump.
- **The shell does not know about:** flaps, faces, extents, paper sides,
  forced reasons or constraints. Per the styling rules, a parent never styles a
  child's insides. Each caller's row content and its state inks stay in the
  caller's module.
- `FoldCrossSectionPicker` becomes: model → `rows` + `renderRow` (track, bar,
  tag) + `overlay` (brackets). Its computed styles must match before and after;
  that is the "moves change nothing" proof the styling guide asks for.

**D. `FoldPane` generalised over its hit type.**

`FoldPane` is about 150 lines over `useCpSurface`:

- the paper through the painter on the folded channel;
- a crease pattern on the stroke channel;
- tint plus fills on the overlay fill channel, and points and preview strokes;
- the hover callback, cursor, focus on press, and an SVG `layers` slot.

The dialog's two panes need all of that. Only Fold-specific parts would
change:

- `FoldHit` and `sameFoldHit` become `Hit` and `sameHit`;
- the `FOLD_UNITS_PER_CP_UNIT` radius scale becomes a `radiusScale` prop;
- `posedScene` playback becomes optional, as it already is.

If the dialog folds through the Fold engine, as decision 1 (route C)
recommends, its scenes are in Fold units already.

Proposal: `cp-workspace/surface/PaperPane.tsx`, with `FoldPane` a thin
specialisation. This has the most risk of the four:

- `FoldPane` sits in open PRs #475 and #476;
- it carries playback.

So do it only once the dialog's pane would otherwise copy most of it, which
I expect it would. The 10-line split layout (`.panes[data-split]` as
`1fr 1fr`, with a 1 px `--border-subtle` divider) stays in each parent's own
module. Layout is a parent's job.

### 4.3 Keep separate: they do different things

- **`crossSection.ts`** (the picker model: `flapNumbers`, seed states, extents,
  brackets, woven intervals, "n of m layers moving"). The dialog gets its own
  React-free, store-free model, e.g. `layer-order/layersHereModel.ts`. It
  should follow the same *pattern*:
  - `(t, data, state) → { label, rows[{ key, label, state, … }] }`;
  - whole-sentence labels per case.
  - It should not share code with `crossSection.ts`.
- **Flap chips.** The dialog has no flaps in v1. "Flap in front of flap" is a
  *Could*.
- **The bar and bracket drawing.** It encodes *extent along a line* and
  *bends joining rows*. At a spot every bar would be full width and there are
  no bends, so it would carry no information. The dialog's rows put a
  paper-side mark in that place instead (§5).
- **`FoldOrderStacks` and `useFoldOrderInspection`.** These are
  superseded rather than shared: when Fold adopts the dialog (decision 6,
  "Later" phase), delete them and open the dialog from the order chooser.
- **`FoldOrderChooser`** (‹ Order n of m ›, Back, "Use this order"). It steps
  through raw orders of one part. The dialog's §6.6 steps through *looks* that
  fit the constraints, alongside a background count. The shape is similar but
  the semantics and status differ. Revisit when the dialog replaces it in Fold.
- **`useFoldCanvasInks`.** It reads three CSS variables. Calling
  `readCssVarColor` is simpler than extracting a hook named for Fold.

### 4.4 The over-abstraction risk, concretely

- **The shell is the place it could go wrong.** It stays right only while it
  holds no meaning. Watch for these signs:
  - a `variant="fold" | "dialog"` prop;
  - a shell-level state vocabulary that lists both surfaces' states;
  - the shell growing "reason" or "side" slots;
  - a prop count past roughly 10.

  If any of these appears, stop and keep two components with a shared
  keyboard hook (`useRovingListbox`), which is the fallback.
- **"Stack here" (Phase 3) adds drag-to-reorder rows.** Fold has no use for
  it. Build it in the dialog's wrapper, unless Fold gains a reorder.
- **Directional hover linking** (`linked`, `onFocusRow`) is dialog-only at
  first. Both are optional props that cost Fold nothing. Fold could later
  adopt pane → row linking for flaps.
- **Sequencing.** Build the dialog's Layers here *with* the shell, then move
  Fold's picker onto it in a separate no-visual-change commit. Do not extract
  ahead of the second user.

### 4.5 Things for the designer to settle (found while comparing)

1. **Which pane is on the left.**
   - Fold puts the **folded form left** and the crease pattern right ("the
     folded form first as the design has it", `FoldCanvas.module.css`).
   - Spec §6.2 puts the **crease pattern left**.

   If the panes are shared, pick one convention for both. My lean is Fold's
   order: it is the existing two-pane precedent, and the folded figure is
   where Layers here is opened.
2. **Camera.**
   - Fold: wheel, pinch and pan are per pane, but the toolbar zoom and Fit
     drive **both** panes together.
   - Spec: "each pane pans and zooms on its own, and Fit frames both". This
     matches, except that toolbar zoom is joint in Fold.
3. **Touch size.** Fold's rows are 28 px on coarse pointers because its chips
   are the touch path. The dialog has no such fallback, so its rows must be
   44 px.
4. **Lighting needs more than one hue.** Fold lights only in the accent, plus
   danger on refused faces. The dialog's "always above / always below /
   either" groups (§6.3) need three distinguishable treatments with no dashes.
   That is new design work. The alpha ladder in 4.2-B gives the levels, not
   the hues.

---

## 5. Visual spec: the shared stack row the dialog's mockups must reuse

### 5.1 Shared frame: Fold's exact numbers (`LayerStackList`)

All tokens; the hex values are the default dark theme in `theme.css`.

- **Box**
  - 1 px solid `--border-subtle` (rgba(232,237,240,.08));
  - radius `--radius-sm` (4 px): an inset well inside a surface;
  - background `--bg-primary` (#101417);
  - padding 6 px 0; gap 2 px between the caption and the rows.
- **"TOP" caption**
  - 0.58rem, weight 800, uppercase, `--text-muted` (#5e6a72);
  - right-aligned over the trailing column; padding 0 8 px.
  - Nothing at the bottom: Fold has no "Bottom" label.
- **Row**
  - grid `[leading 1fr] [trailing 52px]`, column gap 8 px, padding 0 8 px;
  - rows touch, with no gap and no dividers between them;
  - an "unordered" or "beside" relation is drawn as a 1 px `--border-subtle`
    hairline on the row's leading cell.
- **Height**
  - compact (Fold): 18 px, and 28 px on a coarse pointer;
  - regular (dialog, *proposed*): 32 px, and 44 px on a coarse pointer
    (`--touch-target`).
- **States of the frame**
  - hover: background `--bg-surface` (#26313c);
  - keyboard focus: 2 px `--accent-primary` (#5fb3a5) outline, inset
    (offset −2 px);
  - `aria-disabled`: default cursor and no hover fill. The row stays visible,
    named and focusable.
- **Selection is ink, never fill.**
  - The selected row's marks and text go to `--accent-primary`, and its
    trailing text to `--text-secondary`.
  - An unselected row's trailing text is `--text-tertiary` (#78858e).
- **Ink vocabulary:**
  - **accent:** chosen, or acted on;
  - **softer accent:** `color-mix(in srgb, var(--accent-primary) 55%, var(--bg-primary))`,
    meaning "follows from what is chosen";
  - **grey:** `color-mix(in srgb, var(--text-muted) 60%, transparent)`,
    meaning "not part of it";
  - **danger:** `--status-danger` (#e06c75), meaning "in the way / conflicts".
- **Solid lines only.** No dashed or dotted state marks anywhere: dashes are
  valley folds and dots are hidden edges.
- **Trailing column (52 px)**
  - 0.66rem, right-aligned, ellipsis;
  - holds a short tag only on the first row of a run (Fold: "Flap 2").
- **Marks inside rows**
  - a mark that stands for a layer is a 3 px tall, fully rounded pill
    (min-width 3 px);
  - a connector between two rows (Fold's bracket) is a 1.5 px solid curve in
    the upper row's ink.

### 5.2 The dialog's row content inside that frame (proposal for the mockups)

**Leading cell, left to right:**

1. **A paper-side mark.** Fold's 3 px pill, 20 px long, in the figure's own
   `PaperStyle.paper.front` or `.back` colour, for the side the face shows the
   viewer. Read it as the layer seen edge-on, in the colour it shows.
   - Give it a 1 px `--border-strong` outline when the paper colour is close
     to the well (white paper on a light theme).
   - Never colour it by state: in this row, state is told by text and the
     trailing mark.
2. **The face's label.** The same short label both panes print (§6.2,
   "Labels"), in 0.75rem `--text-primary`, or accent when chosen.
3. **For a forced row, its reason.** One line in 0.66rem `--text-tertiary` with
   an ellipsis, e.g. "always under C · creases", with the full sentence in the
   accessible name. A lock glyph in grey ink may lead the reason.

**Trailing cell (52 px):**

- "Top" for the face chosen on top here (accent);
- "A" or "B" pills for an Above / below pair being picked (accent, 3 px-radius
  badges, `--radius-sm`);
- "×" in danger for a face in a conflict.

**Spacing and keys:**

- The rows are a `LayerStackList` with `density="regular"`,
  `activateKeys={['Enter', ' ']}`, `onHover` / `onFocusRow` lighting both
  panes, and `linked` for the pane → row direction.
- There is **no** bracket overlay and no extent bar: a spot has neither.

**What the mockups must not do:**

- fill the selected row's background;
- use dashed or dotted lines for open, forced, changed or conflicting;
- invent a second focus ring;
- put state in the paper-side mark's colour.
