# Diagram: placing things on the page by hand

**Status: Phase 1 built 2026-10-07 (the model, the file and the clearing, no UI; as-built notes under Phase 1). Phase 1b is next. Decisions 1–6 are DECIDED: all A** (Zach, 2026-10-07: "in this case i agree with all the decision for the diagram page - you can go ahead and start building once the plan is up to date"). The same day he asked for flow pages to take a number of steps instead of rows and columns; that is Phase 1b.
Phase 1's review amended four things here, each marked *(amended in Phase 1)*: what a cell is (a page keeps its number or its first step), the frame's vertical part (stored across the rows in reading order), what a flow page's shape reads (Phase 1b), and step files laying out an unplaced diagram.
This builds on D10 (pages come from one pure layout; Fit each), D11 (export),
D22 (turn glyphs) and the flow lane in `implementation-plans/diagram-workspace.md`,
and on Revision 2's enlarged steps (16f, `implementation-plans/diagram-revision-2.md`).

Conventions:
- Paths are under `apps/web/src/` unless they say otherwise.
- Line numbers are at d7196a886 (HEAD). Other agents' uncommitted 16g edits
  under `diagram/**` may have shifted some of them.
- *Placed* means a step with any override. *Home* and *computed* mean where
  today's layout puts a thing.
- *(inferred)* marks a claim read from code but never run.

## Goal

Zach, 2026-10-07:

> I want to be able to control individual elements in the rendered pdf. For
> example, i want to be able to control the scale of the image of a step. or
> the placement of the text. Heres how im expecting it to behave
>
> * basically there is a default computed scale that is updated depending on
>   what steps are around. if an override exists, it stops getting recomputed
>   until that override is clear
> * Same with moving elements. Elements in a step are all moved relative to
>   their step frame, so if the step order changes or it gets moved to a new
>   page, they are still placed relative to it. These movement overrides can
>   also be cleared. This includes the step number, the step graphic, and the
>   text.
> * You should also be able to drag an entire step frame, again same
>   semantics apply (we should probably talk though exactly how this works,
>   eg. when i step gets re-ordered it should get cleared)
> * The flow ribbon should always be computed and follow a dragged step
>   frame. That way you can change the layout and the ribbon follows.

So:

1. **Scale.** A step's picture can be given a size of its own. Fit each keeps
   sizing every other picture from the steps around it. Once a picture is
   pinned, Fit each stops sizing it: adding or deleting steps around it,
   changing the paper, the margins or the steps per page, or re-posing a
   neighbour leaves it as set, until the pin is cleared (Reset Size).
   - What the pin holds is the paper's scale, not the printed box. Re-pose the
     pinned step itself and a flap that opens prints bigger, at the same scale,
     so it stays matched to its neighbours (Decision 4).
   - Every other picture sizes as if the pin were not there, so pinning and
     clearing change only that picture (Decision 2).
   - A pin bigger than its cell is honoured, its text moves down, and any
     overlap is flagged (Decision 3). The layout still holds it between 4 mm
     and the paper's printable side.
   - A pin sleeps while the picture is of another kind, and an enlarged step
     has its Size instead of a pin.
2. **Moving parts.** A step's number, picture and text can each be moved. A
   move is kept relative to the step's frame, so it rides along through a
   reorder or a move to another page. Each one clears on its own.
3. **Moving the frame.** A whole step can be dragged, everything in it moving
   with it. When that clears again is Decision 1.
4. **The ribbon.** The flow lane, the turn glyphs and the enlarge arrows are
   never stored. They are computed from the frames as finally placed, so the
   ribbon follows a dragged frame, live while it is dragged.
5. **One truth.** The Pages view, the PDF, Print and the single SVG all show
   the same placement. With nothing placed, every page is byte for byte what
   it is today.

6. **Flow: steps per page.** Zach, 2026-10-07: "I think it makes more sense
   for flow, instead of showing an option for the number of rows and cols, to
   just have an option for the number of steps to show. and that determines
   how the flow is rendered, roughly keeping the same winding behavior." See
   "Flow: steps per page" below; built as Phase 1b.

## Approach

### The shape of it

Every page is still laid out exactly as today: cells, text fitting, fits,
Fit each's runs, enlarged steps. A step may carry a small `place` record: a
pinned scale, and offsets for its frame, number, picture and text. The layout
applies it on top of the computed result, as the last thing before the lane
and the glyphs are built. Five rules follow:

- **Nothing placed, nothing changes.** Every new expression is today's
  expression plus a zero offset, or sits behind a "this step is placed"
  guard. A golden test holds every fixture's composed pages byte-identical,
  with no `place` and with an all-zero one.
- **A move never feeds back into a scale.** Rooms, text fitting, fits and the
  runs are all computed from the home cell. Moving text or a frame never
  resizes any picture, anywhere.
- **A pin replaces one picture's scale and nothing else** (Decision 2).
- **Everything after the cells reads the final cells**: lane stops, the
  spine, the lane, turn glyphs and the enlarge-arrow lift.
- **Collisions are shown, not prevented.** An overlap is outlined amber on the
  page, named in the Step pane and listed by the export dialog. Drags are
  clamped to the paper, nothing more.

### What a step stores

On the step, as a new optional field, next to `zoom`:

```ts
/** Hand placement on the printed pages. Every field optional; absent means computed. */
interface DiagramStepPlace {
  /** The whole step, away from its cell: mm along its row's reading direction, and across the rows toward the page's next one. */
  frame?: [along: number, across: number];
  /** Each part away from where the layout puts it inside the frame: mm, page axes (+x right, +y down). */
  number?: [dx: number, dy: number];
  picture?: [dx: number, dy: number];
  text?: [dx: number, dy: number];
  /** A pinned scale, in the measure Fit each uses for this kind of picture (Decision 4). */
  scale?: { mmPerUnit: number } | { frameMm: number };
}
// DiagramStep gains `place?: DiagramStepPlace` and `placeNewer?: Record<string, unknown>` (below).
```

- **Why on the step.** Overrides travel with the step through reorders and
  page moves, as Zach's rule asks. They go when the step is deleted, and undo
  restores them with the snapshot. A map keyed by step id would need its own
  clean-up on every delete, for no gain.
- **Units.** Print mm, never scaled with the cell. Pairs are `[x, y]` tuples,
  as the file writes every other point.
- **Parts in page axes.** A cell is laid out the same way in every row (the
  number top left, the text under the picture), so a part's offset is never
  mirrored.
- **The frame in the page's reading terms** *(amended in Phase 1)*. A frame
  offset is usually about the step's neighbours: room for a glyph between two
  steps or at a row break, a big picture beside it. Those flip sides when the
  page's reading order flips, so both parts are stored in reading terms:
  - the horizontal part along the row's reading direction:
    `dx = rightToLeft ? −along : along` (grid rows always read left to right);
  - the vertical part across the rows, toward the page's next row:
    `dy = up ? −across : across` (grid pages and most flow pages read
    downward; a flow page whose lane comes in at its spine reads its rows up
    from the foot, `flowLane.ts:126`).

  This keeps a frame where it belongs when a page flips without the step
  moving. With an even row count, appending a page turns the old last page's
  exit into the spine, and `flowPagePlan` then reverses every row on it
  (`flowLane.ts:123–125`). A First page Left/Right change, or a page added or
  removed before a page a page break holds, changes the page's side, which
  mirrors its rows top to bottom as well (`up`) and reverses them.
  - Phase 1's first version stored the vertical part down the page. Its
    review showed a side change moving a step from the bottom row to the top
    (`artifacts/page-overrides/po1/review/upflip.mjs`), where "down" points
    at the neighbour it was moved away from. Keying the cell by `up` instead
    would have cleared every frame on half the pages at a First page change,
    which Decision 1A keeps. No build writes `place` before Phase 3, so the
    meaning could still change at no cost.
- **Scale.** The pin has the `PictureMeasure` shape the layout already passes
  around: `mmPerUnit` for a picture that knows its paper, `frameMm` for a
  fitted one. The panes show it as printed mm (`printedFrameMm`). A pin
  applies only while the picture is of its kind. Otherwise it sleeps (see
  the clearing table).
- **Enlarged steps get no `place.scale`.** Their Size (`zoom.scale`, ×area)
  is already their pin. The scale handle and the pane edit Size there.
- **One set for both layouts.** Frame offsets clear on a grid↔flow switch
  (undo brings them back). Part offsets and pins apply in both.

**File** (`document/diagramFile.ts`):
- `place` joins `STEP_KEYS`. `writeStep` writes it only when it is non-empty,
  and each sub-field only when set.
- Offsets are rounded to 0.1 mm. One under 0.05 mm both ways is written as
  absent.
- The reader is lenient. A malformed sub-field drops that sub-field, and a pin
  must be finite and above zero. The pin's printed size is held to between
  4 mm and the paper's printable side by the layout, not the reader, which
  does not know the picture's units.
- **A sub-key this build does not know** keeps the whole record raw, as
  `placeNewer`. It is written back verbatim and never applied, so the step
  prints computed and stays editable. Its Step pane says "Placed in a newer
  version" and offers Reset Layout, which drops the record. Any other
  placement edit on that step is refused. This departs from the `zoom`
  precedent, which locks the step, on purpose: placement is presentation, and
  a locked step prints with no picture (`pictures/paintDiagramStep.ts:145`).
  - Its `frame` is a key this build knows, and it belongs to the step's cell,
    so it is the one part of the record this build changes *(amended in
    Phase 1)*: it goes home when the step changes cell, counted with this
    build's, and a duplicate does not copy it. Otherwise a newer build would
    apply it in a cell it was never set for. `duplicateStep` already rewrites
    a known field (`id`) inside an annotation's raw record.
- Never stored: positions in page mm, home cells, clashes, whether a pin
  applies, the ribbon.
- **No older reader exists yet.** `origin/main` holds 0 files under
  `apps/web/src/diagram/`, and the latest tag is v0.5.2. If the reader lands
  in #436 (Decision 6), the first release with diagrams already knows
  `place`.

**Layout input.** `diagramLayoutSteps` (`pages/diagramPages.ts:79`) copies
`place` onto `LayoutStep`. It never does so for a locked step or one with
`placeNewer`.

**Layout output.**
- `LayoutCell` gains:
  - `homeMm`: the computed cell origin, before the frame offset;
  - `numberMm`: the number's box, measured with `setter.line` (the layout
    already holds the setter), for hit targets and clash checks;
  - `placed?`, only on a placed step: which offsets were applied, whether
    the pin applied or sleeps (`'kind' | 'empty'`), and **`auto`**, the
    scale Fit each computed for it. That is the "auto 53 mm" read-out; today
    nothing could supply it, because `printedFrames` reads the drawn scale
    (`printedFrames.ts:39`);
  - `clashes?`, only on a placed step:
    `('step' | 'glyph' | 'margin' | 'paper' | 'path')[]`, with the steps it
    overlaps.
- `LayoutPage` gains the lane's inputs: its stops, plan and spine heights.
  The Pages view can then rebuild the lane during a drag.

**View state** (D14, in the slice outside history):
- `diagramPagesPart: 'frame' | 'number' | 'picture' | 'text' | null`, the
  selected part of the selected step. It joins `DIAGRAM_SCOPED_KEYS` and
  `discardDiagramState` (`store/workspaceStore/diagramState.ts:29`, `:220`).
  It resets when `diagramSelectedStepId` changes, and `travel()` drops it
  when its step is gone.
- `diagramPlacesSettled: { count; nonce; entry } | null`. It is set when an
  edit sends frames back to their cells, and the Diagram shows that as a
  toast. `entry` is the undo entry the edit landed in (null when the history
  cap kept none), so the toast's Undo can refuse once that entry is no longer
  the newest *(amended in Phase 1)*. Three paths make that real:
  - another edit made while the toast is up;
  - `duplicateLinkedStepAs` undoing its own duplicate when the capture
    fails, after the duplicate set the notice (`stepCaptureActions.ts`, which
    guards its own undo the same way);
  - a failed open restoring the old notice through `pickDiagramState`.

**Store** (`slices/diagramSlice.ts`). Each verb is one `commit` and one undo
entry:
- `setDiagramStepPlace(stepId, patch, { session?, loadId? })`. `session`
  folds a nudge sitting into one entry (`sessionFor`), while it sets the same
  fields on the same step. `loadId` drops a debounced nudge that outlived its
  diagram. `patch` sets each field to a value or clears it with `null`; a
  value that is no offset or pin at all (NaN, a pin of 0) changes nothing,
  so only `null` clears.
- `resetDiagramStepPlace(stepId, part)`, where `part` is
  `'frame' | 'number' | 'picture' | 'text' | 'scale' | 'position' | 'all'`.
  `position` is every offset (Reset Position). `all` is the only reset that
  also drops a newer build's record.
- `resetDiagramPlaces(pageIndex | null)`: one page, or the whole diagram.
- All three are refused on a read-only diagram and on a locked step.
- **`settlePlaces(before, after)` runs inside `commit`** after every edit,
  beside `withReferencedAssets`, which already runs there
  (`diagramSlice.ts:159`). It drops the frame offset of every step that is no
  longer in the cell it had (see the clearing rules) and reports how many it
  dropped. When no step has a frame offset, it returns `after` untouched.
  It is built on a pure `cellSlots(document)` in `pages/stepPlaces.ts`:
  `splitIntoPages` over the document's non-turn entries, exactly as
  `diagramLayoutSteps` lists them, by the layout's own `cellsPerPage`. A test
  holds it equal to the layout's cells on every fixture. `sameCell(was, now,
  id)` compares a step's two cells.

### How the layout uses it

All of this is inside `layoutDiagramPages` (`pages/diagramPageLayout.ts:908`),
in order. `diagramPageLayout.ts` imports nothing new and stays pure. The 16f
import cycle is why that matters.

1. **Cells, text and fits are unchanged.** `cellAt`, `slotBottom`, the
   caption shrink, `roomH` and `fitOf` (`:961–1038`) all run from the home
   cell. No override feeds into any slot, room, line count or fit.
2. **Scales.**
   - `scaleRuns` runs over every paper and every fitted picture, as today
     (`:1045–1057`). Pinned pictures are included, each with its computed fit,
     so their neighbours size exactly as if they were still computed
     (Decision 2, A).
   - Each pinned entry is then recorded as `auto` and overwritten with
     `{mmPerUnit | frameMm: pin, reduced: false}`. A pin of the other kind,
     or one on a step with no picture, sleeps.
   - All of this happens before `zoomScales` (`:1206`). An enlarged step
     whose area is pinned therefore measures against the area as it prints.
     `amongNeighbours` reads drawn scales too.
   - An enlarged step with a set Size is drawn at its window, not
     `min(window, own)` (Decision 3, A). Fill runs are unchanged.
   - If Zach picks 2B, pinned pictures are filtered out of the `scaleRuns`
     input instead.
3. **The measure passes** (`diagramPages.ts:277–347`).
   - A pinned picture is measured at its pin for drawing. `scalesOf` already
     reads the drawn scale.
   - `fitIn` (`largestHeld`) does not depend on the drawn scale.
   - The `atMost` loop (`:332–345`) measures a pinned step at its `auto`
     scale and its home draw size. It then sets the same `atMost` it would
     unpinned, so the neighbours' runs stay exactly as they were. Measured at
     the pin, it would shrink the picture's fit; skipped, it would drop a cap
     the step has unpinned. Either way the neighbours would drift.
4. **The default geometry of a pinned picture.** It is drawn at its own
   extent, anchored at its top centre, which is the layout's existing anchor.
   - `drawMm = {x: cellCentre − w/2, y: pictureTop, w: max(roomW, extent.w), h: extent.h}`.
     It is not clamped to `roomH` (`:1070`) and not floored at the box.
   - The text stays under it: `firstBaseline = home pictureTop + drawMm.h + 5`,
     with its lines unchanged.
   - So a pin never cuts or uncuts text. It only pushes the text down or
     pulls it up.
   - An unpinned step keeps today's formulas.
5. **Offsets, after the defaults.**
   - The frame offset translates `cellMm`, `pictureMm`, `drawMm`, `numberAt`
     and the text together.
   - Then each part's offset: the picture moves `pictureMm` and `drawMm`; the
     number moves `numberAt` and `numberMm`; the text moves `text.x` and
     `firstBaseline`.
   - A picture offset never moves the text, because the text's default comes
     from the home picture top. A pin's change of height does move it
     (Decision 5).
6. **Lane stops** (`:1095`). Each stop is `laneCentre` of the final cell: the
   picture's drawn centre after the frame and picture offsets. The stops of
   empty cells on a page that runs on to its spine stay at home. `spineAt`
   reads the final stops, so moving the first or last frame of a spread page
   moves the band on the facing page as well.
7. **`flowLane`, with three guards.** Each fires only when a stop on either
   side belongs to a placed step, so unplaced pages stay byte-identical. The
   lane is still computed with the path hidden, because glyphs use it.
   - **(a) Bend apex.** The apex goes outboard of both row ends:
     `x = outermost(before.x, next.x) ± bendReach`. Today `bendApex` reaches
     out from `before.x` only (`flowLane.ts:228`). Unmoved, the two are in
     the same column.
   - **(b) Heading.** A stop that lies behind its predecessor along its row
     takes the chord to its neighbours as its heading, instead of ±x. The
     lane then S-bends instead of looping.
   - **(c) Level rows.** The bend's half-pitch is floored at the band's
     half-width, so rows dragged level cannot fold the band.
   - When (b) or (c) fires, the step gets a `'path'` clash.
8. **`placeTurns`** (`:1317`) runs over the final cells, by today's rules.
   - A same-row glyph goes midway between the moved facing edges.
   - **At a flow row break**, the glyph's y is midway between the upper step's
     foot and the lower step's number top, now `cellMm.y + STEP_NUMBER_TOP_MM
     + number.dy` (`:1388`). Its x comes from `bendXAt` on the moved lane,
     with the existing fallback.
   - Leading and trailing edges come from the moved picture.
   - `slotBottom` stays computed at home. A frame moved into the room it
     keeps for glyphs is flagged, not reflowed.
9. **The arrow lift** (`zoomArrows.ts:56`).
   - The number band becomes `max(cellMm.y + PICTURE_TOP_MM + number.dy)`.
   - When the two pictures' vertical overlap cannot hold the arrow, which is
     possible only with overrides, the arrow keeps its `placeTurns` place.
     Today it would clamp under a number that is no longer there.
   - `liftable` is unchanged.
10. **Clashes, for placed steps only.** Their boxes (number, `drawMm`, text
    lines) are checked against:
    - the other steps' boxes on the page;
    - the glyph and arrow boxes;
    - the title tab and the page number;
    - the margin (soft) and the trim (hard).

    The cost is O(placed × cells on the page). Ink past `drawMm` (marks) is
    not counted: an unplaced picture's marks are held inside its room
    already.

**Pagination never changes.** `splitIntoPages` counts cells. A frame is
clamped to its own paper and cannot be dragged onto another page. Moving a
step to another page stays a reorder (Alt+arrows, Move to).

**Downstream.**
- The composer reads cells, so it is unchanged. It gains `omit` and `only`
  options for the drag preview; they filter what is drawn, and with neither
  the output is byte-identical.
- `printedFrames` picks up pins, so the ED10 print-size read-outs stay right.
  It also publishes `auto`.
- Step files (`export/stepFiles.ts`) have their own one-scale layout and
  ignore placement. They also lay the pages out, to read an enlarged step's
  window from its cell (`frameMm`), and an enlarged step's size follows its
  area's pin (step 2 above). So `prepareStepFiles` lays out
  `unplacedDiagram(document)` (`document/stepPlace.ts`), which leaves every
  `place` out *(amended in Phase 1, where it is built)*. A test holds a
  pinned, moved area's files equal to the unplaced ones.

### The Pages view

The behaviour lives in a hook, `pages/usePagesPlacement.ts`, beside
`usePagesView`. Following `useAnnotateCanvas`, the gesture sits in a ref with
a local draft, and the store is written once, on release. The presentation is
a child, `components/diagram/DiagramPagesPlacement.tsx`, with its own module
CSS: targets, handles, home ghosts, amber outlines and chips.
`DiagramPagesView` only mounts it.

**Selecting.**
- A press on a step selects it, as today (`diagramPagesPart` null).
- A click on the number, picture or text of the selected step selects that
  part. Cmd/Ctrl-click selects the part under the pointer on any step.
- Double-click still opens Pose, or the area on an enlarge arrow.
- Escape steps out: a drag first (`registerDiagramGestureCancel`), then the
  part, then the step, then the existing `runDiagramCancel` ladder.
- Part targets are pointer-only (`aria-hidden`), like the enlarge arrows,
  because a listbox option cannot contain interactive children. They are
  found by `data-place-part`.
- Part targets are rendered only for the selected step, with an explicit
  z-order: cells < turn targets < arrow targets < the selected step's parts
  < handles. Today a turn target is probably half covered by the next step's
  cell *(inferred from DOM order)*. Check that in the browser; the z-order
  fixes it if so.

**Moving** (mouse and pen).
- A press-drag past 4 px on any step selects it and moves its frame, as in
  Figma. On a selected part, it moves that part. After a frame drag, `'frame'`
  stays selected so the arrows nudge it next.
- Shift keeps the drag to one axis. Alt/Option turns snapping off.
- It snaps (about 6 screen px) to:
  - home: dropping there clears the override;
  - the neighbours' row and column centre lines, for a frame;
  - the same part of the row's other steps (number baselines, first text
    baselines), for a part.
- Clamped to the paper. A drag never reorders.
- Space-drag and middle-drag still pan.

**Live preview.** The page is one composed `<img>`, so the preview is layered:
- On press, before the slop, compose the page without the dragged thing
  (`omit`) and the thing alone (`only`), cached per layout, step and part.
  Until they are ready, show an outline.
- Each pointer move only sets a CSS transform on the lifted layer. For a
  frame or picture drag it also rebuilds the lane from `LayoutPage`'s stops
  with the one stop moved, on this page and, through the spine, on the
  facing page. `flowLane` is pure and cheap, and `DiagramPageBand` already
  draws apart from the image.
- Turn glyphs and arrows re-place on drop.
- One commit on release. Nothing reaches the store mid-drag: `pathColorPick`
  measured 120 relayouts and about 6 s of catch-up for a 2 s drag that wrote
  on every move.
- The preview stays up until `useDiagramPages` delivers the pages of the
  committed document, so nothing snaps back.

**Scaling.**
- A selected picture shows handles on its two bottom corners and its bottom
  edge. A drag scales about the picture's top centre: the layout's own
  anchor, so the preview matches the result. The text layer moves with the
  change in height.
- A chip reads "64 mm · auto 53 mm".
- It snaps to auto, which clears the pin, and to the size of each same-kind
  picture on the page ("= step 6"). Pinning to match a neighbour is how a
  picture joins a run under Decision 2A.
- On an enlarged step the same handles set Size (×1.25–6).

**Keyboard** (through the registry; no `keydown` listener).
- A new scope, `'diagram-place'`, sits ahead of `'diagram'`, as
  `'diagram-path'` does (`keyboard/shortcuts.ts:649–656`). It is live only
  while a part is selected in the Pages view, and declines otherwise, so the
  arrows fall through to step navigation.
- Arrows nudge 0.5 mm; Shift+arrows nudge 5 mm. Each id is a
  `diagram.nudgePlacement*`.
- Delete and Backspace are claimed as no-ops, so they never delete the step
  whose text is selected.
- Nudges fold into one undo entry per part per sitting. The preview moves at
  once, and the commit is debounced (about 200 ms) so key repeat never runs a
  relayout per press.
- The keyboard path to a part is the Step pane's Select buttons (below).

**Touch.**
- iPad: one finger on the selected step or one of its parts drags it. Those
  targets go in the panning `excluded` list. One finger anywhere else pans;
  two fingers pan and zoom.
- On coarse pointers, handles are `--touch-target` sized.
- Phones stay a read-only pager (D17): no handles, but placements still
  print.

**Indicators.** All are screen-only and never enter the composed SVG.
- A selected step with a moved frame shows a dashed outline of its home cell
  and a hairline from home to the frame.
- A moved part shows a faint home tick.
- A pinned picture's selection box carries a pin mark.
- A clashing step gets an amber outline with an "Overlaps" tab. It is always
  visible, like "Text doesn't fit".
- A placed step's card in the Steps grid gets a small glyph in its meta.

**Undo.** One entry per drag, handle drag, pane edit, reset or nudge sitting.
An automatic clear lands in the entry of the edit that caused it.

### The panes, menus and notices

**Step pane, "On the page".** This is a child component,
`DiagramStepPlacement`, with a hook, `useStepPlacement`, so
`DiagramStepPanel` (202 lines) stays a composition site.
- **Size**: a `NumberRow` in printed mm, the frame's longer side. Its
  placeholder is the auto value, and it gains `onReset` once pinned, the
  `pathWidthMm` pattern (`DiagramPagePanel.tsx:133–143`).
  - With no picture, it is disabled and says why.
  - On an enlarged step, the section points to its Size.
  - On a sleeping pin, it reads "Kept for a crease pattern" and offers Reset.
- **Position**: a row each for Frame, Number, Picture and Text.
  - Each reads "Auto" or "Moved", with a **Select** button and a reset.
  - Select switches to Pages if needed and sets `diagramPagesPart`. This is
    the keyboard path to nudging.
  - The selected part's row shows X and Y in mm.
- **Reset Layout**, when anything is set.
- **An amber Notice** for clashes ("Overlaps step 6", "Runs off the page",
  "Outside the margin", "Over a turn", "Out of reading order").
  - When a placed step runs into a later step on its page, or past the
    page's foot, the Notice offers **Start step N on a new page**, using the
    existing `breakBefore`.
  - That moves later steps, so their frame offsets clear, with the toast.

**Step menu.** The step action catalog (`diagram/actions/diagramActions.ts`,
`buildDiagramStepActions`) gains Reset Size, Reset Position and Reset Layout,
each shown only when there is something to reset.

**Page pane.** A line, "Placed by hand: 4 steps", with **Reset This Page** and
**Reset All**, shown only when any step is placed. It is a child component,
so `DiagramPagePanel` stays under its cap.

**Toast.** When an edit sends frames back to their cells, a sonner toast (as
`stepCaptureActions` uses) says "2 moved steps went back to their cells" and
offers Undo. A small hook reads `diagramPlacesSettled` to show it.
- The hook remembers the highest `nonce` it has shown, so a notice restored
  by a failed open is never shown twice.
- Undo undoes only while `diagramPlacesSettled.entry` is still the newest
  undo entry (`diagramHistory.past.at(-1)`), the identity check
  `duplicateLinkedStepAs` uses. Otherwise it does nothing and the toast
  closes.

**Export dialog.**
- Its Notice lists clashing and off-paper steps, next to "Text doesn't fit".
- When the step-files format is picked and any step is placed, it says in
  one line that hand placement applies to the pages only.

### Flow: steps per page

A flow page takes a number of steps, and the layout chooses its rows. Grid
pages keep Columns and Rows.
- **Model.** `DiagramPageSetup` gains `stepsPerPage` (2–24), used by flow
  only. The Page pane shows "Steps per page" in place of Columns and Rows
  while the layout is flow.
- **Shape.** A pure `flowShape(stepsPerPage, printable area)` picks the column
  count whose cells come closest to square on the page's printable area, with
  `rows = ceil(steps / columns)`: it minimises `|ln(cellWidth / cellHeight)|`,
  ties going to fewer columns. On A4 portrait, 9 steps give 3×3, 6 give 2×3
  and 12 give 3×4. Orientation and paper size feed it, so landscape gets
  wider rows.
  - The printable area is the paper inside its margins, *not* less the
    title's header and the page-number footer *(decided in Phase 1)*. Typing
    a title or turning page numbers on then never re-cuts a page, moves steps
    between pages or sends frames home. It also lets `pageGrid(setup)` keep
    reading the setup alone, with no title, for every caller (the layout,
    `cellSlots`, `useDiagramPageSetup` and `DiagramPanel`'s page counts). The
    A4 shapes above are the same either way.
  - **The seam is built** (Phase 1): every count of a page's cells reads
    `pageGrid(setup)` and `cellsPerPage(setup)` in `diagramPageLayout.ts`.
    That covers `pageCellMm`, `layoutDiagramPages` (`perPage`, `cellAt`,
    `slotBottom`, the lane stops, `placeTurns`), `cellSlots`,
    `useDiagramPageSetup` and `DiagramPanel`. Phase 1b changes those two
    functions: `pageGrid` returns `flowShape`'s columns and rows for flow, and
    `cellsPerPage` returns `stepsPerPage` for flow, which a short last row
    makes fewer than columns × rows. Then check the lane's empty-cell stops
    on a spine page (`k < perPage`): whether they run to the steps per page
    or to the full grid.
- **Short rows.** Steps fill rows in reading order and the last row may be
  short, as the last page of a diagram is today (crane page 3: 25, 26): 7
  steps are 3·3·1, not a balanced 3·2·2. DECIDED (Zach, 2026-10-07: "use your recs and include the enlarged steps follow ups in the branch").
- **Winding.** Unchanged: `flowPagePlan` takes the derived row count, rows
  alternate direction, the lane turns at row ends and runs across a spread's
  spine.
- **Files.** `stepsPerPage` is written for flow only. A flow file without it
  reads as `columns × rows`, so every existing flow page keeps its count. Its
  shape then follows the rule, which matches the old one wherever the old
  one was the squarest; a wide shape (4 columns × 2 rows on A4 portrait)
  becomes 2 × 4. Grid files are unchanged.
- **Cells.** `cellSlots` reads the derived shape, and a change of steps per
  page sends moved frames home like a change of columns or rows (below). So
  does a change of paper size, orientation or margin that changes a flow
  page's derived shape: the cell changed shape (Decision 1A).
- **Analytics.** `diagram page setup changed` gains the setting
  `steps_per_page`, beside `columns` and `rows` (which setting, never its
  value).

### When an override clears

One rule decides the frame. A step's **cell** is its place among its page's
steps (`k`), on its page, at given columns and rows (a flow page's derived
from its steps per page) and layout (grid or flow). The frame offset is kept
while that cell is unchanged, and cleared automatically when it changes,
whatever caused it. That is Decision 1, A.

A page is the same page while it keeps its number **or** the step it starts
with *(amended in Phase 1)*:
- **Its first step.** A step inserted earlier can add a page, renumbering
  every later page while a page break keeps their contents exactly as they
  were. By number alone, all of those would clear; by first step, none do.
- **Its number.** A reorder can change the step a page starts with while
  every other step on it stays where it was. By first step alone, a single
  Move Earlier on a page's second step sent home every moved frame on the
  page (seven of nine on a 3×3 grid,
  `artifacts/page-overrides/po1/review/firstswap.mjs`), and moving a step
  from page one to page two sent home a step that stayed in page two's
  fourth cell. By number, only the steps that changed place go.
- Either is enough, because each one alone is the same physical page: same
  number, same paper; or the same steps from the same first one, with only
  its number and side changed, which the frame's reading-terms storage
  follows. The review's other candidate (a step identified by the set of
  steps before it on its page) still cleared the page-two step above.
- A randomised test over moves, inserts, deletes and page breaks on a grid
  holds the rule to the printed pages. A frame goes home exactly when its
  step prints in another cell of its page, or on a page that is neither its
  own number nor its own page renumbered.

The clearing is done centrally, once, by `settlePlaces` inside `commit`, never
in each verb. It lands in the same undo entry as the edit, and the toast
offers Undo.

| Edit | Scale pin | Number, picture, text offsets | Frame offset |
| --- | --- | --- | --- |
| Its own move: Alt+arrows, Move to, Move Earlier/Later, a Steps-grid reorder | kept | kept | **cleared**, with the steps it passed; a swap that changes the step a page starts with clears only the two |
| A step added, inserted, duplicated, uploaded, pulled from References, deleted or made into a turn **before it** | kept | kept | **cleared** where the shift reaches it (a page that ends in a page break stops the shift) |
| Steps added, deleted or moved **after it**, staying after it | kept | kept | kept |
| A turn added, removed or moved (turns take no cell) | kept | kept | kept |
| Start a New Page set or cleared at or before it on its page, or where the shift reaches it | kept | kept | **cleared** |
| Start a New Page on a later step | kept | kept | kept |
| Columns or rows (grid), steps per page (flow) | kept | kept | **cleared** (the cell changed shape) |
| Grid ↔ flow | kept | kept | **cleared** |
| First page Left/Right; a page added or removed after its page, or before it where a page break holds it | kept | kept | kept (stored along the row and across the rows in reading order, it follows a page whose rows reverse or read upward) |
| Paper size, orientation, margin | kept | kept | kept, unless it changes a flow page's derived shape (Phase 1b): then the cell changed shape, and it is **cleared**, as for columns and rows. Anything now off the paper is flagged |
| Title, page numbers | kept | kept | kept (a flow page's shape is read from the paper inside its margins, without the header and footer) |
| Path width or colour, style | kept | kept | kept |
| Caption edits | kept | kept | kept (moved text never uncuts) |
| Picture refreshed, re-posed, recaptured, frame edited, annotated (same kind) | kept: the paper scale holds, so the printed size follows the model | kept | kept |
| Picture removed (empty step) | **sleeps** until a picture of its kind returns | kept (the picture offset moves the placeholder) | kept |
| Picture changes kind (an upload over a crease pattern, Show as) | **sleeps** while the kind differs; Show as back restores it | kept | kept |
| The step becomes enlarged | sleeps (Size is its pin) | kept | kept |
| Duplicate: the copy | copied | copied | not copied (a new step has no cell to keep); a newer build's record (`placeNewer`) is copied without its `frame` |
| A newer build's record (`placeNewer`), on any edit above | carried as it came | carried as it came | its `frame` **cleared** where this build's would be, and counted |
| Delete, make into a turn: the step itself | goes with it | goes with it | goes with it |
| Undo, redo | whole snapshots, nothing settles | | |
| Reset Size / Position / Layout / This Page / All; dragged or snapped home | clears what it names | clears what it names | clears what it names |

**On "when a step gets re-ordered it should get cleared".** The instinct is
right. The trigger should be the outcome rather than the verb.
- Keyed on the verb, the rule misses inserts, deletes and page breaks before
  the step, which move it just as surely.
- It also clears too often. Moving a turn, or a step after it, never changes
  its cell.
- Keyed on the cell, one rule catches every case, and no verb added later can
  forget it.

### Edge cases

- **An empty step.** A picture offset moves the "No picture yet" placeholder.
  Size is disabled, and a pin set earlier sleeps.
- **No text.** Text has no target. An existing text offset is kept and
  applies once there is text.
- **Cut text.** Moving the text or the frame never uncuts it, because fitting
  is done from the home cell. The pane says so, rather than implying a move
  helps.
- **A pin taller than its room** pushes its text past the cell's foot. That is
  flagged as a `step` or `margin` clash, and the Notice offers the page
  break. The layout holds a pin to the paper's printable side.
- **A frame dragged past its row neighbour.** Guard (b): the lane S-bends
  rather than loops, and the step is flagged "Out of reading order".
- **A frame dragged level with the next row.** Guard (c), flagged.
- **The first or last step of a spread page.** The spine height comes from
  the moved stops, so the facing page's band moves too. The preview redraws
  both bands.
- **An enlarged step's area pinned or moved.**
  - The enlarged steps resize, being ×N of the area as it prints.
  - Their arrow moves with `placeTurns`. If the moved pictures no longer
    overlap vertically, the arrow stays at its gutter place.
- **An enlarged step.** Its handle sets Size, from 1.25 to 6. A different Size
  already breaks its run, so its Fill neighbours are untouched.
- **A frame moved into a turn glyph's room.** That room stays computed at
  home, so it is flagged as a `glyph` clash, not reflowed.
- **A frame dropped on another step.** It overlaps (amber). It never swaps or
  reorders.
- **A smaller paper, the other orientation, a bigger margin.** Offsets are
  kept, and whatever now crosses the margin or the trim is flagged and listed
  at export. Nothing is clamped silently at print.
- **Right-to-left rows and pages that read upward.** Part offsets stay in page
  axes. The frame's horizontal offset runs along the row, and its vertical
  one across the rows toward the next, up a page that reads upward.
- **Two-digit and three-digit numbers.** The number's offset is from its left
  baseline origin, so it still grows to the right, as today.
- **Locked steps.** Carried verbatim; this build never applies or clears
  their placement.
- **`placeNewer` steps.** They print computed, and offer only Reset Layout.
  Their `frame` goes home when the step changes cell, and a duplicate does
  not copy it.
- **A patch value that is no value.** A Size typed as 0, or an offset of NaN,
  changes nothing; only a reset or `null` clears.
- **Read-only diagrams.** No handles, but placements still print.
- **Step files.** Unaffected. The export dialog says so.
- **Undo during a drag** cancels the drag first.
- **A relayout still running after a drop.** The preview stays up until it
  lands.
- **Zero offsets.** An offset under 0.05 mm, or one snapped home, is stored as
  absent. An empty `place` is not written.

### Analytics

Hand-placed, through `analytics/trackDiagram.ts`, with rows in
`docs/analytics.md`. Properties are enums and buckets only, never mm (D18).
- `diagram step placed`:
  - `part`: `frame|number|picture|text|size`;
  - `via`: `drag|keys|pane`;
  - `layout`: `grid|flow`.

  Sent once per commit; a nudge sitting counts once.
- `diagram placement reset`:
  - `part`: `frame|number|picture|text|size|step`;
  - `scope`: `step|page|diagram`;
  - `via`: `pane|menu|drag_home`.
- `diagram placements reflowed` with `count_bucket`: frames sent home by an
  edit. If these are common, Decision 1 is revisited.
- `diagram exported` gains `placed_step_bucket` and `clash_bucket`.

### i18n

Every new string goes in all 9 catalogs, through `i18n:extract`, then
`i18n:stamp`, checked by `i18n:check`. The strings:
- the section and its rows: "On the page", Size, Position, Frame, Number,
  Picture, Text, Select, Auto, Moved;
- the resets: Reset Size, Reset Position, Reset Layout, Reset This Page,
  Reset All;
- "Placed by hand: {{count}} steps";
- the toast: "{{count}} moved steps went back to their cells", with Undo;
- the clash sentences;
- "Start step {{number}} on a new page";
- the chips: "auto {{mm}} mm", "= step {{number}}";
- "Kept for a crease pattern" and its fitted-picture twin;
- "Placed in a newer version";
- the export lines;
- the nudge shortcut labels.

### Tests

- **File:**
  - a round trip;
  - absent when empty;
  - the 0.1 mm rounding and the under-0.05 mm drop;
  - a malformed sub-field dropped;
  - an unknown sub-key carried as `placeNewer`, byte for byte, and not
    applied;
  - a locked step untouched.
- **`cellSlots`** equals the layout's cells on every fixture: grid and flow,
  page breaks, turns, enlarged steps and locked steps.
- **`settlePlaces`**, one test per row of the clearing table, including:
  - an insert on an earlier page whose shift a page break stops;
  - an append that flips the old last page's rows (kept);
  - a swap that changes the step a page starts with (only the two clear);
  - a newer build's `frame` sent home;
  - one undo entry, with the count and the entry reported;
  - a randomised walk on a grid, held to the printed cells.
- **Layout:**
  - **The golden.** Every fixture with no `place`, and with an all-zero
    `place`, gives byte-identical composed pages and identical existing
    `LayoutPage` fields. Every fixture page's digests (the page, the Pages
    view's page, its arrows) are committed as they print before placement
    (Phase 1, checked equal to the layout at 6f7792459), so a layout edit is
    held to today's pages, not only to itself.
  - **Pins.** A pin keeps its neighbours' scales, and clearing it restores
    the page exactly. A pin past its room widens `drawMm` and pushes the
    text down without cutting it. `atMost` is measured at `auto`. A sleeping
    pin is ignored. An enlarged step follows its pinned area, and a set Size
    can pass its room under 3A.
  - **Moves.**
    - Part offsets survive a reorder and a new page.
    - The frame carries its parts.
    - `along` flips with the row, and `across` with a page that reads upward
      (a First page side change, and a page renumbered by a page break).
  - **Lane.**
    - Stops sit at the moved centres.
    - The facing page's spine follows.
    - Guards (a), (b) and (c) each fire, and only near placed stops.
    - A randomised property test: no self-intersection unless a `'path'`
      clash is reported, and `bendXAt` keeps its fallback.
  - **Glyphs, arrows and clashes.** Glyph places and the arrow band follow
    offsets, and every clash kind is found.
  - **Scoping.** The existing invariant tests are scoped to unplaced steps
    (`diagramPageLayout.test.ts:462`, `:910`, `:1225`;
    `composeDiagramPage.test.ts:271`). New tests pin the override semantics,
    so the scoping hides nothing.
- **Composer.** `omit` and `only`; with neither, the output is identical.
- **Store.**
  - The verbs and their sessions.
  - Refusal when read-only or locked, and on `placeNewer`.
  - `diagramPagesPart` reconciled after undo.
- **Keyboard.**
  - The scope claims the arrows only while a part is selected.
  - Delete does nothing.
  - The Escape ladder.
- **Pages view:**
  - targets found by `data-place-part`, and the z-order;
  - one commit per drag;
  - the preview held until the relayout lands;
  - snapping home clears.
- **Panes:** rows, resets, Select, and the Notice's page-break action.
- **Analytics** helpers.

## Decisions for Zach

All DECIDED: A (Zach, 2026-10-07: "in this case i agree with all the decision for the diagram page - you can go ahead and start building once the plan is up to date").

**1. When does a dragged step frame go back to its cell? DECIDED: A.** (You
flagged this one to talk through.)
- **A.** Whenever the step lands in a different cell, for any reason:
  - its own move;
  - a step inserted, duplicated or deleted before it;
  - a page break at or before it;
  - a change of columns, rows or grid↔flow.

  It is checked once per edit, in that edit's undo entry, with a toast "2
  moved steps went back to their cells · Undo". It is kept through:
  - paper, margin and orientation (on a flow page, once Phase 1b derives its
    shape from them, unless they change that shape: then the cell changed
    shape, as with columns and rows);
  - First page Left/Right;
  - turns;
  - anything after it.
- **B.** Only when that step itself is moved: Alt+arrows, Move to, the menu.
  This is your words taken literally. An insert or delete before it carries
  the offset into the next cell over.
- **C.** Never cleared automatically. The offset sleeps while the step is out
  of the cell it was set in, and comes back if the step returns there.
- **D.** The offset belongs to the cell, not the step: whichever step is in
  page 2's fourth cell is drawn moved.
- **Recommendation: A.**
  - A frame offset fixes one spot on one page: room for a big neighbour, a
    glyph, the ribbon's bend. An insert before the step moves it out of that
    spot as surely as a reorder does. Under B, a gutter fix ends up in the
    middle of a row.
  - C keeps stale offsets that reappear after an unrelated delete.
  - D breaks your rule that a step's things move with the step.
  - A has one trigger in one place. A page break stops it from reaching
    further pages, and Undo brings the offset back.
  - Its cost: an insert early in a run of full pages sends every moved frame
    after it home, up to the next page break. The toast says how many.

**2. When one picture's scale is pinned, do the other steps react? DECIDED: A.**
- **A.** No. They size exactly as if it were still computed, so pinning and
  clearing touch only that picture.
- **B.** Yes. The pinned picture leaves Fit each's runs, and the rest re-run
  without it, so its run may grow or split anywhere in the diagram.
- **Recommendation: A.**
  - Direct manipulation should change only what you drag, and clearing a pin
    should give back exactly the page you had.
  - Runs are diagram-wide and join across pages (`FIT_SAME`), so under B one
    handle drag can resize steps several pages away.
  - B's upside is that a step holding its run down stops doing so once you
    take it over. Under A you get that by snapping the others to it ("= step
    6"). A later "Use this size for its run" verb could make it one click.

**3. A pin bigger than the room its cell gives it: honour it, or hold it to
the room? DECIDED: A.**
- **A.** Honour it. The picture is drawn at the pin, and its text moves down
  under it and keeps every line. Whatever it then runs into is outlined amber
  and listed at export, with a one-click page break offered. An enlarged
  step's set Size is honoured past its room the same way.
- **B.** Hold it to the room, as Size works today. The pane reads "asked
  80 mm · prints 64 mm".
- **Recommendation: A.**
  - You asked to control the scale. Under B the handle stops at an invisible
    wall exactly when you need it: a tall model that wants more room than its
    cell has.
  - Under A nothing is cut, every collision is visible and named, and you fix
    it by moving the text or the frame.
  - The cost: 16f's "Size is held to its room" changes for a set Size, so
    the two rules agree. Fill is unchanged.

**4. What does a pin hold when the picture changes (re-posed, recaptured, its
frame edited)? DECIDED: A.**
- **A.** The paper's scale: mm per pattern unit for a picture that knows its
  paper, the frame's mm for a fitted one. The pane shows it as printed mm.
- **B.** The printed size: the frame's longer side in mm, whatever the
  picture.
- **Recommendation: A.**
  - It is the unit Fit each keeps equal from step to step. A pin set to match
    a neighbour stays matched after a re-pose.
  - When the model unfolds, its print grows, as a reader expects. Under B, a
    re-pose that opens a flap would quietly shrink the paper.
  - The cost: a pin set on a crease pattern means nothing on an uploaded
    image. It sleeps while the kinds differ, and comes back if Show as goes
    back.

**5. Is a moved number, picture or text a nudge from its computed place, or a
fixed spot in the frame? DECIDED: A.**
- **A.** A nudge. Text moved 3 mm right still sits under its picture when the
  picture grows.
- **B.** A fixed spot in the frame, whatever the picture does.
- **Recommendation: A.**
  - Computed places move inside the frame. A picture's scale can re-run from
    an edit pages away, and the text follows the picture's height. Under A
    your nudge rides along and nothing ends up under the picture.
  - Zero means "not moved", so snapping home and resetting are trivial.
  - B is truer to "I put it there", but an edit elsewhere could bury this
    step's text under its own picture without this step being touched.

**6. Where does it land? DECIDED: A.**
- **A.** Phase 1 (the model, the file and the clearing, with no UI) goes into
  #436 before it merges. The layout and the UI come in a PR of their own on
  main after #436 merges, as you chose for the simulator work.
- **B.** All of it in #436.
- **C.** All of it after #436 merges.
- **Recommendation: A.**
  - Phase 1 is small, and it means the first release with diagrams already
    reads `place`. A file from a later build opens there with its pictures,
    prints computed, and keeps its placements for the next save.
  - Under C, that release would lock every placed step and print it with no
    picture.
  - B holds #436 for the biggest new surface since Annotate.
  - Either way, Phase 1 waits for 16g, which is editing `diagramFile.ts` and
    `diagramSlice.ts` now.

### Small calls made here

Decided, not pending. Say if any is wrong.
- A press-drag on any step moves its frame, as in Figma, including an
  unselected step. A frame drag selects the step, and its home ghost and
  hairline then show what moved.
- Collisions are flagged, never prevented. Drags are clamped to the paper.
- A frame cannot be dragged onto another page. Moving a step to another page
  stays a reorder.
- Delete with a part selected does nothing.
- There is one set of placements for grid and flow.
- A pin of the other kind sleeps rather than clearing (rule above).
- Part offsets are in page axes; the frame's are in the page's reading terms,
  along its row and across its rows.
- Step files ignore placement: they lay out `unplacedDiagram(document)`.
- A flow page's derived shape reads the paper inside its margins, not less
  the header and footer (Phase 1b).

## Alternatives considered

- **Pinned frames: steps pinned to a page slot, with the page flowing around
  them.** Not chosen. Frames never overlap, but:
  - a frame drag becomes slot reassignment, with neighbours hopping between
    slots and gaps opening, which is not the offset Zach described;
  - pins that wait come back later beside different neighbours;
  - its lane keeps each stop within a quarter cell of its slot centre, so a
    frame moved further than that loses the ribbon behind it. That fails
    point 4.
  - It adds a slot walk with restarts, spans and room checks to the busiest
    file in the workspace.

  It contributed:
  - storing the frame offset along the row;
  - snapping a scale to a neighbour;
  - the page-break offer on a clash;
  - per-part Select buttons;
  - Reset This Page;
  - the card badge;
  - the rule that layout data never blanks a step in an older build.
- **A document-level `placements` map.** In an older build it opens the whole
  diagram read-only, where it prints correctly. Not needed: the format has
  not shipped, and carrying unknown sub-keys raw gives a better fallback
  without a second home for step data.
- **Clearing in each verb** (`moveDiagramStep` and the rest). Not chosen. It
  misses inserts, deletes and breaks before the step, and a later verb could
  forget it.
- **The cell keyed by page number alone.** Not chosen. A page added earlier
  would clear every frame on every later page, even where a page break keeps
  those pages' contents unchanged.
- **The page keyed by its first step alone** (Phase 1's first version). Not
  chosen: a reorder that changes the step a page starts with cleared every
  frame on the page. See "When an override clears".
- **The cell keyed by the page's `up`**, so a page that turns upward clears.
  Not chosen: a First page Left/Right change would clear every frame on half
  the pages, which Decision 1A keeps. The frame is stored in reading terms
  instead.
- **Taking a pinned picture out of the runs** (2B), **holding a pin to its
  room** (3B), **a printed-size pin** (4B), **fixed spots** (5B). See the
  decisions.
- **A held lane**, with stops kept near their slot centre to protect
  `flowLane`'s assumptions. Not chosen: the ribbon must follow the frame.
  Guards (a)–(c) protect the same assumptions only where a step is placed.
- **A relayout and recompose per pointer move.** Ruled out by
  `pathColorPick`'s numbers.

## Risks

- **The lane under arbitrary moves.** `flowLane`, `knotHandles` and
  `bendXAt`'s monotone bisection assume stops that run along their row, with
  bends past the row's end. Guards (a)–(c) cover reversal, lopsided bends and
  level rows, but an extreme drag can still draw an ugly S. The property test
  is the gate.
- **Parity.** Each generalised expression must be today's plus a zero offset,
  or sit behind a placed guard. An algebraically equal rewrite can still
  differ in the last bit. The golden test is the gate.
- **Merge conflicts with 16g** in `diagramPageLayout.ts` (`zoomScales`),
  `diagramFile.ts`, `diagramSlice.ts` and `zoomArrows.ts`. Start each phase
  only once 16g has landed and `git status` is clean under `diagram/**`.
- **Surprise clears.** An insert early on can send frames home pages later,
  up to the next page break. The toast with Undo and
  `diagram placements reflowed` mitigate it, and Decision 1 is revisited if
  it is common.
- **Preview cost.** Composing the `omit` and `only` layers for a heavy folded
  picture may take more than 100 ms. They start composing on press, before
  the slop. If that is still slow, fall back to an outline with the live
  band.
- **Key repeat.** Without the local preview and the debounced commit, each
  nudge is a whole-document relayout: `pathColorPick`'s backlog again.
- **Hit testing.** A new part selection, new targets and handles. It needs
  the explicit z-order and tests by data attribute.
- **Overlapping or off-paper output is possible by design.** The amber
  outline, the pane Notice and the export Notice have to be impossible to
  miss.
- **Decision 3A amends 16f's rule** for a set Size. Record it in
  `diagram-revision-2.md` when built.
- **Panel caps.** `DiagramStepPanel` and `DiagramPagePanel` are near or at
  their caps. The new sections are child components with hooks, and the
  verbs go in the step catalog.
- **Accessibility.** Part targets are pointer-only. The Step pane (Size,
  Select, X and Y) must stay a complete keyboard path.

## Affected Areas

- **Model and file:**
  - `diagram/document/diagramDocument.ts` (`DiagramStep.place`,
    `placeNewer`; `duplicateStep` drops `frame`);
  - `diagram/document/diagramFile.ts` (`STEP_KEYS`, `readStep`, `writeStep`);
  - `diagram/document/stepPlace.ts` (new: the kept shape and the edits,
    `unplacedDiagram`);
  - `diagram/export/stepFiles.ts` (lays out the unplaced diagram).
- **Clearing:**
  - `diagram/pages/stepPlaces.ts` (new: `cellSlots`, `sameCell`,
    `settlePlaces`);
  - `diagram/pages/diagramPageLayout.ts` (`pageGrid`, `cellsPerPage`), and
    their callers `useDiagramPageSetup.ts` and `DiagramPanel.tsx`;
  - `store/workspaceStore/slices/diagramSlice.ts` (`commit`, the verbs);
  - `store/workspaceStore/diagramState.ts`, `store/workspaceStore/types.ts`.
- **Layout:**
  - `diagram/pages/diagramPageLayout.ts`, `flowLane.ts`, `diagramPages.ts`
    (`diagramLayoutSteps`, the measure passes), `zoomArrows.ts`,
    `printedFrames.ts`;
  - `composeDiagramPage.ts` (`omit` and `only`).
- **Pages view:**
  - `diagram/pages/usePagesPlacement.ts` (new);
  - `components/diagram/DiagramPagesPlacement.tsx` and its module CSS (new);
  - `components/diagram/DiagramPagesView.tsx`, `DiagramPageBand.tsx`,
    `diagram/pages/usePagesView.ts` (the panning exclusions).
- **Keys:**
  - `keyboard/shortcuts.ts` (`'diagram-place'`);
  - `diagram/useDiagramShortcuts.ts`;
  - `diagram/actions/diagramShortcuts.ts` (the Escape ladder);
  - `i18n/shortcutLabels.ts`.
- **Panes and menus:**
  - `components/diagram/DiagramStepPlacement.tsx` and
    `useStepPlacement.ts` (new);
  - `components/panels/DiagramStepPanel.tsx`;
  - the Page pane's summary child and `components/panels/DiagramPagePanel.tsx`;
  - `diagram/actions/diagramActions.ts`;
  - `components/diagram/DiagramStepCard.tsx` (the badge);
  - the toast hook;
  - `components/diagram/DiagramExportModal.tsx` and
    `diagram/export/useDiagramExport.ts`.
- **Analytics and i18n:**
  - `analytics/trackDiagram.ts`, `analytics/events.ts`, `docs/analytics.md`;
  - `public/locales/*` (9 catalogs).
- **Plans:**
  - this plan;
  - an as-built note in `diagram-workspace.md` (D10);
  - `diagram-revision-2.md` (16f's Size rule, under 3A).

## Checklist

Every phase gets:
- tests near what changed;
- analytics and i18n for what it adds;
- browser before/after shots with a confidence level for each claim;
- the dev-server link;
- a gate: green checks and evidence shared before the next phase.

Vitest runs in the web workspace under Node 22.

### Phase 0: decisions

- [x] ~~A throwaway prototype,~~ Not needed: Zach decided without it. It would have been `artifacts/page-overrides/page-overrides.html`,
  gitignored. It shows one flow spread at print size, where Zach can:
  - drag frames and watch the ribbon follow live across the spine;
  - pin a scale and see the neighbours hold (2A) or re-run (2B);
  - pin past the room (3A against 3B);
  - insert a step to see frames go home under 1A, 1B and 1C.
- [x] Zach answers Decisions 1–6; record each here with his words. All A: "in this case i agree with all the decision for the diagram page".

### Phase 1: model, file and clearing, no UI (into #436 under 6A, after 16g lands)

- [x] `DiagramStepPlace`, `place` and `placeNewer` on `DiagramStep`.
  `duplicateStep` keeps the pin and part offsets and drops `frame`, a newer
  build's included.
- [x] Reader and writer:
  - `place` in `STEP_KEYS`;
  - written only when set;
  - 0.1 mm rounding;
  - malformed sub-fields dropped;
  - unknown sub-keys carried raw;
  - tests.
- [x] `cellSlots`, `sameCell` and `settlePlaces` (`pages/stepPlaces.ts`), and
  the `commit` hook with `diagramPlacesSettled`. A test per row of the
  clearing table, `cellSlots` checked against the layout on every fixture,
  and a randomised walk held to the printed grid.
- [x] The store verbs: set, reset part, reset page or all. Refused when
  read-only, locked or `placeNewer`. Sessions for nudges. Tests.
- [x] `diagramLayoutSteps` copies `place` onto `LayoutStep`. The layout
  ignores it until Phase 2.
- [x] The golden, with the fixture pages' digests committed as they print
  before placement (moved here from Phase 2's first item, by review).
- [x] Step files lay out `unplacedDiagram(document)`.
- [x] Gate, on a clone holding only HEAD and this phase: `lint:web`,
  typecheck, `i18n:check` and the whole vitest suite under Node 22, without
  the `pre*` hooks. No UI, so no browser shots; the evidence is through the
  app's store and file paths instead (below).

**As built (Phase 1).** Where it differs from the plan above, or adds to it:
- **Reset parts** add `'position'` (every offset), for Reset Position.
  `'all'` alone also drops `placeNewer`.
- **`setDiagramStepPlace(stepId, patch, { session, loadId })`.** `patch`
  sets each field or clears it with `null`. A value that is not one (an
  offset of NaN, a pin of 0) changes nothing. `loadId` drops a debounced
  nudge that outlived its diagram (Phase 4). A session folds edits only while
  they set the same fields on the same step: one undo entry per part per
  sitting.
- **One shape** (`normalizeStepPlace`), on read as well as on write: tenths
  of a mm, offsets of none and an empty `place` left out.
- **The `pageGrid` / `cellsPerPage` seam** in `diagramPageLayout.ts`. Every
  count of a page's cells reads it: the layout, the page counts and
  `cellSlots`. Phase 1b changes those two functions and nothing that calls
  them.
- **Two amendments** made in review under "default to my recommendations",
  each marked *(amended in Phase 1)* above:
  - **The cell rule.** A page keeps its number or its first step
    (`sameCell`), not its first step alone.
  - **The frame's second component.** It is `across`, toward the page's next
    row, not down. Phase 2 converts it with `dy = up ? −across : across`.
- **A newer build's `frame`** goes home with this build's and is counted. A
  duplicate drops it.
- **`diagramPlacesSettled`** is `{count, nonce, entry}`. `entry` is the undo
  entry the frames went home in, for Phase 3's Undo.
- **Step files** lay out `unplacedDiagram(document)`.
- **The golden.** `placeGolden.test.ts` checks that an all-zero `place`
  prints like no `place`. It holds the 16 page digests of the 8 fixtures to
  the layout at 6f7792459, checked through HEAD's copies of the two layout
  modules (`artifacts/page-overrides/po1/fixes/head-digests.txt`).
- **No analytics or i18n.** There is no UI. The undo labels are internal
  English like the rest of the slice. The events come with Phase 3, and
  `diagramPagesPart` with Phase 4.

**Verified (Phase 1)** through the running app, with its own Open and Save
(`artifacts/page-overrides/po1/po1-evidence.txt`):
- **Zach's four diagrams.**
  - Crane and chipmunk save back byte for byte.
  - Reference Diagrams and heart save exactly as HEAD's code saves them.
    Their differences from the files are older and outside the steps: a
    stale fold artifact and the legacy `page.scale`; a crease pattern's
    references view state.
  - All four compose byte for byte as HEAD's layout does.
- **A hand-edited crane** with a pin, part offsets, a frame offset and all
  three:
  - It saves back byte for byte.
  - The store holds each placement as written.
  - Its pages are identical to the plain crane's.
- **A newer build's sub-keys** are kept verbatim as `placeNewer`:
  - The steps stay editable; the setter refuses them.
  - An insert before one sends only its `frame` home.
  - One undo restores it, and the file saves back byte for byte.
- **The clearing rules, through the store on the crane.**
  - **Sent home:** an insert, a delete or a move before the step; its own
    move; columns; grid; Start a New Page on it.
  - **Kept:** a swap of two steps before it on its page; an insert after
    it; paper, orientation, margin and First page side; a break on a later
    step.
  - Every edit was one undo entry, and one undo restored the whole diagram.

### Phase 1b: flow steps per page (into #436, after Phase 1)

- [ ] `stepsPerPage` on `DiagramPageSetup`: clamped, default 9, reader and
  writer (flow only; a flow file without it reads `columns × rows`), tests.
- [ ] `pageGrid` and `cellsPerPage` (the seam Phase 1 built) take the flow
  shape and the steps per page; nothing that calls them changes.
- [ ] `flowShape` with tests: A4 and Letter, portrait and landscape, 2–24
  steps, ties, the default.
- [ ] The flow layout and `cellSlots` take the derived shape; every existing
  flow fixture composes identically where its old shape was the squarest.
- [ ] Page pane: Steps per page for flow, Columns and Rows for grid; i18n in
  all 9 catalogs; the `steps_per_page` setting in analytics.
- [ ] Browser: before/after of the crane and the heart in flow at 6, 9 and 12
  steps, on a spread with First page Left and Right; light and dark; 375 px.
- [ ] Gate: lint, typecheck, `test:web`, `i18n:check`.

### Phase 2: the layout (its own PR on main under 6A)

- [x] Golden fixtures first, before any layout edit: composed pages of every
  fixture, with no `place` and with an all-zero `place`, and their digests
  as they print today. Built in Phase 1 (`placeGolden.test.ts`); a digest
  that changes is a page that changed.
- [ ] Pins:
  - in the per-kind loop after `scaleRuns` (or filtered out, under 2B);
  - `auto` recorded, and sleeping pins;
  - before `zoomScales`; set Size at its window (3A);
  - `atMost` measured at `auto`;
  - a pinned picture's `drawMm` and text default.
- [ ] Offsets: the frame, with `along` converted by the row's direction and
  `across` by the page's (`up`), then the parts. `homeMm`, `numberMm` and
  `placed`.
- [ ] A test that step files are unchanged by a pin on an enlarged step's
  area once the layout reads pins (Phase 1's guard passes trivially until
  then).
- [ ] Lane stops from the final cells, `spineAt`, guards (a)–(c), and
  `LayoutPage` carrying the lane's inputs.
- [ ] `placeTurns`' number top and the arrow band as plus-offset forms; the
  arrow's no-overlap fallback.
- [ ] Clashes.
- [ ] `printedFrames` publishes `auto`.
- [ ] Composer `omit` and `only`.
- [ ] Tests:
  - every case listed under Tests;
  - the randomised lane property test;
  - the existing invariant tests scoped to unplaced steps.
- [ ] Browser, with a document edited by hand or a fixture:
  - before/after of a flow spread with one frame, one pin and one text moved;
  - the same page in the Pages view, the PDF, Print and the single SVG.

### Phase 3: panes, menus and notices (the keyboard path before the canvas)

- [ ] `DiagramStepPlacement` and `useStepPlacement`:
  - Size, with its auto placeholder and Reset;
  - the four Position rows, with Select and Reset, and X and Y for the
    selected part;
  - Reset Layout;
  - the clash Notice with the page-break action;
  - the "newer version" state.
- [ ] Step catalog: Reset Size, Reset Position and Reset Layout.
- [ ] Page pane summary: Reset This Page and Reset All.
- [ ] Steps-grid badge.
- [ ] The settled toast with Undo: shown once per `nonce` (the hook keeps
  the highest it has shown), and Undo only while `entry` is the newest undo
  entry.
- [ ] Export dialog: the clash list and the step-files line.
- [ ] Analytics events and `docs/analytics.md` rows. i18n in all 9 catalogs.
- [ ] Browser:
  - a pin and an offset set from the pane, then each reset;
  - an insert before a moved frame, showing the toast, then Undo.

### Phase 4: direct manipulation in the Pages view

- [ ] `diagramPagesPart`: registered in the scoped keys and discard, reset on
  selection, reconciled in `travel()`.
- [ ] `usePagesPlacement` and `DiagramPagesPlacement`:
  - part targets with the explicit z-order;
  - frame and part drags, with slop, Shift and Alt;
  - snapping home and to neighbours;
  - the layered preview, with the live lane on both spread pages;
  - the preview held until the relayout lands;
  - bottom-corner and bottom-edge scale handles with the chip and the
    "= step N" snaps;
  - Size handles on enlarged steps;
  - home ghosts, ticks, pin marks and amber outlines.
- [ ] The `'diagram-place'` scope: nudges, debounced commits,
  Delete/Backspace claimed, and the Escape ladder.
- [ ] iPad: one-finger drag on the selected step and its parts, panning
  exclusions, and touch-sized handles. Phones stay read-only.
- [ ] Check the turn-target overlap. If it is real, the z-order fixes it;
  before/after.
- [ ] Browser:
  - before/after of a frame drag with the ribbon following, across a spine;
  - a scale drag snapping to auto and to a neighbour;
  - a part nudged by keys;
  - a reorder sending a frame home;
  - the WebKit lane and the iPad touch lane.

### Phase 5: close-out

- [ ] As-built notes here and in `diagram-workspace.md` (D10), and the 16f
  Size amendment under 3A.
- [ ] Full gate: lint, typecheck, `test:web`, `build:web`.
- [ ] PR notes with any skipped checks and why.
