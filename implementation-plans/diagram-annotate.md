# Diagram Annotate: shaped arrows, a white stage, circles, right angles, white arrows

**Status: decided (2026-10-04) — Zach accepted every recommendation below;
being built on `claude/diagram-annotate`, merged phase by phase into the
diagram branch.** Phase 14 of `implementation-plans/diagram-workspace.md`.
The research behind it (four readers, a synthesis and a critic) is not in the
repo; what matters is here. Paths are under `apps/web/src/` unless they say
otherwise.

## Goal

Zach's five asks (2026-10-04):
1. Fine-grained control of every Bézier point of an arrow — move, add,
   remove, as in Affinity — "often for clarity arrows are shaped carefully".
2. Annotate's whole background white: an arrow past the picture's bounds is
   hard to see in a dark theme.
3. Circles around points, as References draws them, snapping to a vertex
   within an epsilon, otherwise where the press lands.
4. Right-angle marks.
5. White (hollow) arrows, as books draw them, with their Bézier under the same
   control.

Everything keeps printing through the one painter that cards, pages and the
PDF share (`annotationDrawing` → `paintAnnotations` → usvg/krilla).

## Approach

### Where Annotate stands

- An annotation is `{id, kind, from, to, bend?, text?, rotate?, axis?}` in
  picture units (frame's longer side = 1, y down), ten kinds
  (`diagramDocument.ts`). Arrows are **circular arcs**: `bend` is the sagitta
  over the chord; there is no handle for it — Flip Arc is the only way to
  change a curve.
- The file reader allows a fixed field set per kind; an unknown kind, field or
  out-of-range value is carried verbatim as **a newer build's** annotation —
  kept, not drawn, locking the step's upload pose and annotation carry. The
  format is provisional until this branch merges, but PR previews have served
  earlier builds, so saved `bend` files may exist.
- The canvas (`useAnnotateCanvas`): draw by drag (click for point kinds),
  Select hit-tests ends then bodies; grips are only body/from/to; no snapping,
  no hover, no modifier keys; one undo entry per gesture; the stage is
  `var(--bg-secondary)`; phones get "Annotate on a larger screen".
- Printing already handles cubic `C` paths (the turn-over glyph), quadratics,
  arcs, and a white fill under a black outline (the push arrow).
- D8: a new glyph is a shared References primitive, with its geometry in
  `stepDiagramGeometry.ts` and an entry in the glyph golden.
- Places a new kind or primitive falls through **silently** (grep, the
  compiler won't): `primitiveOf` (`default: null`), `diagramPrimitiveShape`
  (ends `return null`), `annotationReach` (crops), `bodyDistance` (straight
  line), the canvas `Selection` (straight line), `diagramInModel` (drops),
  `ANNOTATE_TOOL_GROUPS` (rail), and Flip's `isArrowKind` gate (Step pane, F).
  And five sites fill `bend` with `?? ARROW_BEND`, which would turn a path
  arrow back into the default arc: `flipAnnotationArc`, two in
  `annotationHit.ts`, `annotationPrimitives.tsx`, and the reader.

### 1. Bézier control of arrows

**Model.** A shaped arrow carries a `path`: nodes `{at, in?, out?, type?:
'corner'}` in absolute picture units, tail first (`from`/`to` = its ends).
Absolute handles carry under any affine move by mapping each point — no flag
flips on a mirror. An arrow never reshaped keeps `bend` and stays an exact arc
(Q2). The reader: `path` comes before the `bend` default; a file with both is a
newer build's; fewer than 2 nodes, a non-record node or a bad `at` is damage;
an unknown node field, a `type` other than `corner`, more than 24 nodes, or a
point past reach is a newer build's. "Smooth" is an editing constraint, never
checked on read.

**From arc to path** (first reshape; Reset goes back): sweep θ = 4·atan(2|bend|),
split into ⌈θ/90°⌉ cubics, handles (4/3)·tan(θ/4n)·r — under a micron of error
on a default 15 mm arrow.

**Editing — Edit Path** (Q3): a tool (A, or double-click an arrow) showing
nodes (smooth circles, corner squares) and the handles near the selected node.
Drag a node to move it (Shift: 0/45/90°); drag a handle (a smooth node's
opposite handle turns with it; Alt breaks it into a corner; Shift: 15°); drag
the curve to bend that segment; click the curve to add a node (de Casteljau
split: the shape doesn't change); double-click a node for sharp ↔ smooth
(guarding the click that would first add a node); Delete removes the node, its
neighbours keeping their outer handles (Q5), and a two-node arrow's last node
deletes the arrow; Escape: drop the drag → deselect the node → put Edit Path
down → the existing ladder. Keyboard: a Previous/Next node stepper in the Step
pane, Smooth/Corner, Delete Node, Add Node, Flip, Reset — and nudging a
selected node with the arrows (Q6). Touch/Pencil: larger grips, double-tap,
tap-to-add with care, node verbs in a `CanvasContextBar`; touch pointers
ignored while a pen is down (a palm today turns a stroke into a pinch).

**Drawing.** A shared primitive `path-arrow` (valley / mountain /
fold-and-unfold heads), with arc-length tables, trim, tangent and `C` path data
in `stepDiagramGeometry.ts`; heads at the shaft's end tangent; ring landing
along the path; the fold-and-unfold tail trim copied exactly (it is
unconditional); a golden. Two caveats: heads and the return are sized by the
tail-to-tip chord, so a looping path gets a tiny head (size by path length
instead); and the fold-and-unfold return as a derived offset (Q4) can cusp on
tight curves, as the white arrow can.

**Store and undo.** `diagramSelectedPathNode`, checked for validity rather than
cleared at each site; one undo entry per gesture; a drag dropped if the arrow's
representation (arc ↔ path, node count) changed under it. A React-free verbs
catalog (`annotationActions.ts`) for Flip, Reset, Add/Delete Node, Smooth/
Corner — retiring Flip's second copy.

**Performance.** Every pointer move recompiles every annotation today. Cache
each annotation's compiled geometry by identity and scale it; keep hover
previews out of the drawn state.

### 2. A white Annotate stage

- `.view` white in every theme; the picture keeps a ring on the frame (today's
  ring is on the painted picture, which can be larger than the frame).
- Selection and handles in a fixed on-paper colour (a theme accent on white
  can fall to 1.5:1), not the accent.
- Presses reach the whole stage (annotations may reach 4 frames out; today the
  overlay covers the picture plus a quarter frame): listen on `.view`, map
  through the overlay's matrix, skip the zoom pill, clamp to reach;
  `touch-action: none` on `.view`; the one-finger touch guard as a
  **capture-phase** listener (the camera listens on its own wrapper inside
  `.view`).
- Pose is already white wherever a picture shows. Print does not change.

### 3. Circles around points

- Kind `circle`, a point kind, compiled to References' `point` primitive in
  its highlight style: radius 3.07 ink (~1.0 mm printed), the annotation pen
  (Q7). Arrows already stop at rings; snapping their ends makes that reliable
  (Q9).
- **Snapping** — a pure module `pictureSnap.ts`, cached per picture: targets
  by picture kind — a crease-pattern capture (line ends, paper corners,
  crossings computed near the cursor, since segments are not split there; a
  new `LineHitIndex` method returning every segment in reach), a flat fold
  (face-ring corners and whole-crease ends; covered corners included in v1),
  3D/simulated (projected vertices), a References step (its model's points,
  line ends, sheet corners, crossings, through the sheet-to-picture map, which
  mirrors on the back), uploads (none) — plus existing annotations' points.
  Radius 14 px fine / 22 px coarse (Edit's defaults at 100%; or Edit's own
  setting, Q10). Hold ⌘ (Ctrl elsewhere) to place freely; a Snap toggle in the
  Step pane for touch. A preview at press time on touch (today nothing shows
  before a 10 px slop).
- Hover is new: today `onPointerMove` returns with no gesture in hand.

### 4. Right-angle marks

- Kind `right-angle`: `from` the corner, `to` along the diagonal into the
  angle (direction only), with care that the normalised `to` stays in reach.
  Carries under similarity moves; under an affine distortion the legs would
  stop following the lines (Phase 13 question).
- Placing (Q12): hover a vertex where two **rays** meet at 90° (±1°) — the
  sector between them, never the reflex side at a paper corner, with a dead
  zone at the vertex — and click; otherwise press at the corner and drag into
  the angle (Shift: 45° steps; below today's minimum length, a click places
  the default size). 3D and simulated pictures snap the corner only: a
  projected right angle is not 90°.
- Drawing (Q11): an open square of two legs in the mark ink, mitre join set on
  the element (the canvas and painter wrap marks in round joins), no fill;
  side ~7 ink (~2.3 mm). A shared primitive with a golden.

### 5. White arrows

- Q13: a new kind `white-arrow`, always a path, with Width (Narrow / Regular /
  Wide, in ink: a fixed print size like every mark) and Tail (Pointed / Square
  / Cleft) — or the push arrow gains a path, which is closest to the wording
  "as a push arrow is drawn in books".
- Geometry: flatten the centreline to a tolerance, offset both sides by an
  eased width, mitre-limited joins outside and intersected runs inside, cut
  the inner loops where the radius is under half the width, a straight-backed
  head at the neck's tangent, the tail; one closed polygon filled page white
  and outlined in the arrow pen with a set mitre limit — the push arrow's own
  drawing and hit test (an even-odd test that handles concave outlines, not
  self-overlapping ones). An arrow that crosses itself is not supported in v1
  (books draw those in two pieces). Sizes from the Origami House template's
  white arrow: neck ~3.6 mm, head ~7.9 × 4.0 mm.
- Edit Path shapes it as in 1; Flip needs a predicate beyond `isArrowKind`.

## Affected Areas

`diagram/annotate/*`; `diagram/document/diagramDocument.ts`, `diagramFile.ts`;
`components/diagram/DiagramAnnotate*`, `DiagramStepAnnotations.tsx`;
`cp-workspace/references/stepDiagramGeometry.ts`,
`referenceFinderDiagramToPrimitives.ts`, `referenceFinderStepInModel.ts`,
`diagram/DiagramPrimitives.tsx`, the glyph golden;
`cp-workspace/picking/lineHitIndex.ts`; `diagram/pictures/paintStepDiagram.ts`;
`store/workspaceStore/types.ts`, `slices/diagramSlice.ts`;
`commands/menuActions.ts` (Delete routing); `diagram/actions/diagramShortcuts.ts`,
`diagram/useDiagramShortcuts.ts`, `keyboard/shortcuts.ts`,
`i18n/shortcutLabels.ts`; `analytics/events.ts`, `docs/analytics.md`; i18n.

## Decisions

All fourteen settled on the recommendation (Zach, 2026-10-04: "I feel good
about the annotation plan"): shaped fold arrows and white arrows only; arcs
stay arcs until reshaped; an Edit Path tool; the return derived from the path;
Affinity's node delete; arrow keys nudge a selected node; circles in the
annotation pen, no letter; circles, right-angle corners and arrow and line ends
snap; Edit's snap setting; an open-square right angle, hover-and-click else
drag; the white arrow a new kind with width presets in ink.


1. **Which marks can be shaped?** The three fold arrows and the white arrow;
   push arrows and lines stay straight. *Recommended.* (Or lines and pushes
   too; or valley and mountain only.)
2. **Today's arcs:** stay exact arcs until first reshaped (Reset goes back) —
   *recommended*: untouched arrows stay identical to References' — or convert
   every arrow to a path now, while the format is unreleased (settle before the
   branch merges).
3. **How node editing is entered:** an Edit Path tool (A, or double-click an
   arrow) — *recommended* — or handles always shown on the selected arrow
   (move and bend collide), or a Step pane button only.
4. **The fold-and-unfold return on a shaped arrow:** derived from the path —
   *recommended* — or its own editable path, or such arrows can't be shaped.
5. **Deleting a node:** neighbours keep their handles (Affinity) —
   *recommended* — or refit the merged segment (Figma's heal), or both.
6. **Nudging a selected node with the arrow keys** (they step between steps
   today; Edit Path with a node selected could claim them first): yes, or no.
   *Recommend yes.*
7. **A circle's stroke:** the annotation pen — *recommended*, consistent with
   annotation arrows (which are already lighter than a References picture's;
   a separate look) — or the References picture's heavier ring.
8. **Does a circle carry a letter?** Not in v1, use a label — *recommended* —
   or a letter laid out as References does (a second label style).
9. **What snaps:** circles and right-angle corners, plus arrow and line ends —
   *recommended* (arrows then land on circles reliably) — or circles only, or
   Bézier nodes too.
10. **Snap radius:** fixed 14/22 px, or Edit's snap setting. *Recommend
    Edit's setting, so there is one.*
11. **The right-angle mark's look:** an open square (what you described) —
    *recommended* — or the Origami House template's quarter arc with a dot
    (whose own legend symbol also draws two legs), or either per diagram style.
12. **Placing a right-angle mark:** hover a perpendicular corner and click,
    else press and drag into the angle — *recommended* — or always two clicks,
    or three.
13. **What a white arrow is:** a new kind, curved, tapered, presets —
    *recommended*, different in shape and use from the push arrow — or the
    push arrow gains a path (closest to "as a push arrow is drawn in books").
14. **A white arrow's width:** presets in ink, a fixed print size —
    *recommended* — or scaling with the picture, or a width handle.

## Checklist

Every phase carries its reader, writer and round trips (including "an older
build keeps it verbatim"), analytics (an event when an arrow is first
reshaped, not per gesture), i18n, shortcut labels, before/after browser
screenshots (light and dark, desktop and iPad WebKit), and a review.

### 14a. White stage
- [x] White `.view`; fixed selection colour; presses across the stage;
  `touch-action`; capture-phase touch guard.
  - As built: `.view` is `#ffffff` with `touch-action: none`; the frame's
    hairline is its own element on `layout.frame` (the painted box no longer
    carries one); the wash and grips are `--annotate-selection` (#4078f2, the
    default light accent, 4:1 on white; the dark presets' accents are 1.5–3.7:1)
    with white grips. The handlers moved to `.view` and a press counts when it
    lands on the camera's wrapper (`instance.wrapperComponent`, the camera's
    own test), so the pill and anything floating over the stage keep theirs;
    `toPicture` clamps to reach; the one-finger guard is a capture listener on
    `.view`. The cursor rules moved to the wrapper (`wrapperClass`).
- [x] Tests: a press beyond the old margin draws (clamped); the zoom pill
  doesn't; pinch and Space-pan unchanged. iPad finger and Pencil before 14c.
  - As built: four canvas tests, all failing on the base; mutants (no stage
    gate, a bubble-phase guard) each fail one. Browser
    (`artifacts/diagram-annotate/{stage,touch}.mjs`): desktop Chromium and
    iPad-sized WebKit, light and dark, before and after; real finger, pen and
    pinch through CDP in Chromium at iPad size (a finger or pen past the old
    margin now draws instead of panning or doing nothing; a pinch there now
    zooms; Space and the middle button pan as before). Real WebKit touch is not
    scriptable headless; WebKit was driven by mouse.

### 14b. Prep
- [x] The grip union (`body | from | to | node | handle | segment | corner |
  direction`), the verbs catalog (`annotationActions.ts`), compiled-geometry
  caching, the five `?? ARROW_BEND` sites and the silent fall-throughs made
  explicit.
  - As built, nothing visible changed:
    - **Grips.** `AnnotationGripPart` is the eight parts, with a node index, a
      handle's node and side, and a segment's index and `t`; nothing produces
      the last five yet, and the canvas's move names each.
    - **Catalog.** `annotationActions.ts` has Flip arc and Delete: whether an
      annotation offers each (`flipsArc`, a switch over kinds), the edit
      (`annotationActionEdit`), and the pane's descriptors. The Step pane, F
      and `edit.delete` all make the catalog's edit, which retires Flip's
      second copy and Delete's. The key state's `selectedIsArrow` is now
      `canFlipArc`.
    - **Caching.** `perAnnotation` keeps a value per annotation object in a
      WeakMap. `compiledAnnotation` compiles each annotation once in picture
      units, and every drawing (canvas, card, page) scales it;
      `arrowPolyline` is cached the same way. `DiagramAnnotationLayer` is
      memoised, so zoom and selection no longer redraw the marks. Measured on
      200 annotations: a drawing with one changed went from 0.42 to 0.16 ms.
      Rendering the marks' shapes costs about 5 ms and is still redone on
      every drag move. Memoising it per annotation needs a render context
      that stays stable across drawings; that is left until 14c or 14f needs
      it.
    - **Bend.** `arrowBend` is the one place an absent bend becomes
      References' 60°. The model, the hit test, the compile and the reader go
      through it.
    - **Exhaustive sites.**
      - Over kinds: the compile, `bodyDistance`, the canvas's `Selection`,
        the reader's switch, `flipsArc`, and the tool glyph (by its return
        type).
      - Over the primitives an annotation compiles to: `annotationReach`.
      - Over References' primitives: `diagramPrimitiveShape` and
        `diagramInModel`.
      - Records over kinds: the kind sets and `ANNOTATION_KINDS`
        (`ANNOTATION_SHAPES`), and the rail's groups (`TOOL_GROUP`).
      - Checked: adding a kind fails to compile at 13 sites, and adding a
        primitive at the References and reach sites.

### 14c. Bézier arrows
- [x] Geometry and model: shared `path-arrow` primitive and golden; `path` in
  model, file and clean; `arcToPath`; carry, move, degenerate; an unshaped
  arrow paints byte-identical markup to today's.
  - As built (14c-1; the editor is 14c-2):
    - **Curves.** `lib/cubicBezier.ts`: point, velocity, tangent (a handle on
      its node takes the next control point's direction), de Casteljau split,
      an arc-length table (64 runs a segment), trim by length, flatten to a
      tolerance and a longest run, nearest point, and the signed area against
      the chord that says which side a path bulges to. Tuple points, any
      units, either handedness. The turn-over glyph's private cubic helpers
      are left alone, so its golden does not move.
    - **Model.** `DiagramPathNode {at, in?, out?, type?: 'corner'}`, absolute
      picture units; a missing handle lies on its node; no tail `in` or tip
      `out`. `arrowBend` is gone: `arrowShape` (`arc` with its bend, or
      `path`) is the one place an absent bend becomes 60°, and every caller
      switches on it. `canBeShaped` (a switch) says the three fold arrows.
      `withPath` sets `path`, `from`/`to` (the ends) and drops `bend`
      together. `cleanAnnotation` → `cleanPath`: nodes clamped, a handle past
      reach drawn in along itself (`handleWithinReach`, so a smooth node
      stays smooth), stray tail/tip handles dropped, past 24 nodes the middle
      ones dropped (no edit makes more), fewer than two → an arc again.
      `moveAnnotation` bounds the shift by every node and handle;
      `moveAnnotationEnd` moves the end node with its handle
      (`movePathNodeTo`); `isDegenerate` measures along the path, so a loop
      ending by its tail is an arrow; `carryAnnotation` maps every point (a
      mirror needs nothing); Flip arc mirrors every point across the chord —
      exactly an arc's flip for a path made from one — and leaves a path whose
      ends meet.
    - **Editing (`annotationPath.ts`, for 14c-2).** Every edit takes the
      arrow, arc or path, and shapes an arc first. `arcToPath`: θ =
      4·atan(2|bend|), ⌈θ/90°⌉ cubics, handles (4/3)·tan(θ/4n)·r — 0.36 µm off
      the arc on a default 15 mm arrow, 2.0 µm on a half circle. `resetPath`
      (frame): 60° on the side the path lies on of its chord, toward the
      frame's middle when it lies on neither; a path whose ends meet stays.
      `movePathNode`, `movePathHandle` (a smooth node's other handle turns in
      line, keeping its length; a corner's stays), `bendPathSegment` (the
      point at `t` follows the pointer exactly by the least change of the two
      inner handles, `o_i = δ·b_i/(b1²+b2²)`; smooth neighbours turn with
      them), `splitPathSegment` (de Casteljau; the curve unchanged; stops at
      24), `deletePathNode` (neighbours keep their handles; an end's
      neighbour loses its outer one; **null** for a two-node arrow: delete
      the arrow), `setPathNodeType`/`togglePathNodeType` (interior nodes only;
      smoothing turns both handles onto the mean direction, a handle on its
      node drawn out a third of the way to its neighbour), `pathNodesOf`,
      `nearestPathPoint` (segment and `t` for a press on the curve).
    - **File.** Arrows read `path` before the bend default. Newer: `path` and
      `bend` both, more than 24 nodes, a field a node has no name for, a
      `type` string other than `corner`, a tail `in` or tip `out`, a point
      past reach, and (unchanged) `path` on a push or a line. Damage: not a
      list, fewer than two nodes, a node not a record, a node's or handle's
      point not two numbers, a non-string `type`, and `from`/`to` that are not
      the path's ends. Smoothness is never checked. HEAD's reader (an older
      build) carries a path arrow verbatim and writes it back unchanged
      (checked against HEAD's `diagramFile.ts`).
    - **Primitive.** `{kind: 'path-arrow', path: DiagramCubic[], fold:
      'valley' | 'mountain' | 'fold-unfold'}`, drawn by `pathArrowGeometry`
      (via `pathArrowDrawn`) by the arc arrows' rules along the path: landing
      a rim short of a ring, measured along it; a one-way shaft stopped at its
      head's notch, the head at the shaft's tangent where it stops; a
      fold-and-unfold shaft starting a rim in from the tail, always. Head and
      return opening are capped by a share of the **path's length**, not the
      chord (`pathArrowSizes`). A mountain's barb stands outside the turn
      over the head's last two lengths, or, where the shaft runs straight
      there, away from the side the whole path bulges to (risk 2: near an
      inflection the turn near the head wins). The shaft is cubic `C` data;
      the return is runs (`L`). An arc made a path draws its head within
      0.01 px of the arc arrow's.
    - **The return (Q4).** An offset of the landed path on the side it bulges
      to (chord area), kept the whole way, so on an S it crosses neither way;
      its distance tapers from the opening at the tail to nothing at the tip
      and bows out between by 0.07 of the length, capped at the opening
      (References' 90°-over-60° stands off about that in its middle). Round a
      bend on its outside it is joined round; where the path bends tighter
      than the loop is wide on its inside the offset would fold into a
      swallowtail, and the fold is cut where the runs cross (within eight
      widths of travel), leaving a sharp inner corner. An arrow drawn over
      itself on purpose keeps its far crossings.
    - **Exhaustive sites.** `diagramPrimitiveShape`, `diagramInModel` (every
      control point mapped), `symbolAnchor`, `annotationReach` (exactly the
      drawn strokes and head, padded a head) and `canLeavePaper`.
      References' stored-model reader does not read `path-arrow`: no
      References step makes one, and a stored one reads as a newer build's.
    - **Hit and selection.** `arrowPolyline` is the flattened path (cached per
      annotation); `bodyDistance` measures the path, a fold-and-unfold's
      return and its head by the drawing's own geometry in picture units,
      cached per annotation and ink. The canvas selects, washes, moves and
      drags the ends of a path arrow as it does an arc's.
    - **Proof.** `arcArrowParity.test.ts` holds every arrow kind at seven
      bends and lengths (and every other kind) to the card, page and canvas
      markup and the press polyline recorded at 565360b45, byte for byte. The
      `path-arrow` golden (`referencesPathArrowsGolden.json`, front and back:
      an S valley, a looping mountain, a C and a dipped fold-and-unfold) was
      checked by eye before it was frozen; the existing goldens are
      unchanged. Mutants (no loop cut, sizing by chord, the hit test or the
      compile taking a path for the default arc, the reader filling a bend
      beside a path) each fail a test. Browser
      (`artifacts/diagram-annotate/14c/shaped.mjs`): the three beside their
      arcs on the canvas, card and page, light and dark, moved by body and
      end with the mouse, and the page's PDF rasterised.
- [x] Edit Path on desktop: tool, gestures, modifiers, node stepper, Delete
  routing, Escape, Step pane verbs, nudging (Q6).
  - As built (14c-2):
    - **Tool.** `EDIT_PATH` (`'edit-path'`) is a tool beside Select on the
      rail (Lucide's spline pointer), key A (`diagram.toolEditPath`), and a
      double-click on a fold arrow with Select picks it up. `AnnotateTool` is
      kind | Edit Path | Select, and `drawingKind` is the one place a tool is
      asked whether it draws. Only `canBeShaped` arrows are shaped: with any
      other selected the Step pane says so and presses there only select.
    - **Showing.** `PathSelection` draws a hairline along the curve, every
      node (smooth a circle, corner a square, the selected one filled) and
      `visiblePathHandles` — the selected node's two and its neighbours'
      facing ones, none on their node — in `--annotate-selection`, screen-
      sized (larger on a coarse pointer). An arc shows `pathNodesOf`'s nodes
      (now cached per annotation) and stays an arc until an edit.
    - **Presses** (`useAnnotateCanvas`, `hitPathGrip`, `editPathGesture.ts`).
      Handles and nodes first, nearest wins and a handle takes a tie, then
      the curve (`nearestPathPoint`), all within the 8/18 px reach. A node is
      selected as it is pressed. Drags move the part by the pointer's travel
      from where it was taken hold of (no jump): a node with its handles
      (Shift: the nearest of eight directions, by projection), a handle
      (a smooth node's other turns with it; Alt makes the node a corner first,
      so the other stays; Shift: 15° about the node), the curve
      (`bendPathSegment` at the pressed `t`). A click on the curve splits it
      there and selects the new node. A double-click on a node turns it
      smooth ↔ corner. The canvas counts presses itself (500 ms, 6 px; 16 on
      touch): a pointer event's `detail` is not a click count in every
      browser. The guard: the second press of a double-click on the curve
      lands on the node its first click added, which it does not turn. Off
      the arrow's grips a press selects what is there and moves nothing; on
      empty stage it lets the node go first, then the arrow.
    - **Store and undo.** `diagramSelectedPathNode` is `{annotationId, node,
      nodes}`; `selectedDiagramPathNode` reads it as none unless annotating
      with Edit Path on that arrow with that many nodes, so an undo, Reset or
      another arrow lets it go and no edit clears it. `editDiagramAnnotations`
      takes `selectPathNode`. A drag is one undo step (a click-to-add one, a
      double-click one, a nudge one per key press, repeats included). A drag
      records the arrow's `pathRepresentation` (arc or path, node count) and is
      dropped on its next move — and never lands — once the store's arrow is
      something else (an undo mid-drag). Edits land on the arrow as the store
      has it.
    - **Verbs** (`annotationActions.ts`): Previous/Next Node (view state),
      Smooth, Corner, Add Node (halfway along the segment after the node, or
      before the tip; selects it), Delete Node (selects the node before, so
      Delete again goes on along the arrow; a two-node arrow's goes with the
      arrow), Flip Arc, Reset Shape (`resetPath` with the step's picture
      frame) and Delete; `deleteKeyEdit` and `nudgePathNodeEdit`. Every
      surface makes them through `applyAnnotationEdit`. Reset is also offered
      with Select on an arrow already shaped (deviation: the plan listed it
      under Edit Path only).
    - **Keys.** Delete/Backspace go through `edit.delete`, which deletes the
      node while one is selected and the arrow otherwise; a focused field
      keeps both (the dispatcher's form-control rule). Escape: drag → node →
      Edit Path down (Select, the arrow still selected) → the existing
      ladder. Nudges are eight verbs (`diagram.nudgeNode{Left,…}` and
      `…Large` on Shift, 0.001 and 0.01 of the frame) in a new conditional
      scope, `diagram-path`, ahead of `diagram` on the same executor: one
      scope cannot hold them beside the step keys (the dispatcher takes a
      scope's first match), and this one claims only with a node selected,
      declining otherwise so the arrows walk the steps.
    - **Step pane.** `DiagramPathNodeControls`: "Node 2 of 4" between
      Previous and Next, Smooth | Corner, Add Node and Delete Node; Edit
      Path's help says what it shapes, or that nothing else is shaped.
    - **Analytics.** `diagram arrow shaped` {`kind`, `gesture`}, once when an
      arc becomes a path, counted in `applyAnnotationEdit`.
    - **Proof.** Tests for every gesture and verb; fail-before (the touched
      sources at 5c7628cb2: 49 tests fail and two suites do not load) and
      fourteen mutants, each failing a test. Browser
      (`artifacts/diagram-annotate/14c2/editpath.mjs`, light and dark).
- [ ] Touch and Pencil.
- [x] Browser: a 3–4 node arrow shaped with mouse, Alt and Shift; Reset; a PDF
  export beside the canvas.
  - As built: a default valley arrow drawn with V, shaped into a four-node S
    with the mouse alone (two clicks on the curve, two node drags, an Alt and
    a Shift handle drag, a Shift node drag, two double-clicks, three nudges),
    undone back to the arc in twelve presses and redone to the same S, Reset
    and undone, a node deleted with Backspace, the Escape ladder walked; the
    page's PDF beside the canvas (`canvas-beside-pdf-light.png`).

### 14d. Snapping and circles
- [ ] `pictureSnap.ts` per picture kind; `LineHitIndex` in-reach query; kind
  `circle`; hover and press-time previews; override; Step pane toggle; arrow
  ends snapping (Q9).
  - Analysis as built (pure; no kind, file or canvas yet):
    - **Geometry** (`pictureGeometry.ts`), read once per picture object:
      points (`point` a References mark, `corner` the paper's, `vertex` where
      lines meet, `end` a line meeting nothing) and whole segments, in picture
      units, each in a `LineHitIndex`; points within 5e-5 of the frame are one.
      A crease-pattern capture: line ends and the rim (corners where it turns,
      vertices along its sides), crossings found near the pointer. A flat
      fold: every ring's corners, covered ones too, and each line's `whole`
      ends; no crossings of its own lines (v1 — whole faces cross where one is
      buried). 3D and simulated: line ends (`whole` where cut), which are the
      only projected vertices a stored scene keeps — its rings are the
      painter's cut pieces. References: sheet corners and edges, line ends
      (not `arrow`), marks and crossings, through `stepDiagramToPicture`, the
      painter's own map (mirrored on the back). Uploads, fixed: nothing.
    - **Snap**: `pictureSnapTarget(step, assets, point, radius, {annotations?,
      ignore?})` → `{at, kind} | null`, the nearest of the nearest picture
      point, the annotations' arrow and line ends (signs and labels offer
      none; `ignore` is the one being dragged) and crossings — of the
      picture's lines, and of annotation lines with anything, on any picture.
      Two on one point report the picture's own kind. `segmentsNear` returns
      every segment in reach; crossings pair the 64 nearest, exact for any
      crossing nearer than the 64th.
    - **Radius**: Edit's setting × `CP_MODEL_TO_CSS` is CSS px (10 → 14.7,
      coarse 15 → 22), over screen px per picture unit.
    - **Proof**: hand fixtures (a square and its diagonals, a T, a pinch, a
      cut crease, 3D, an upload, References front and back) and real pictures
      (`__fixtures__/snapPictures.json`: crane-zach's capture, three flat folds
      and two References steps; box_90's pattern and 3D), scanned on a grid
      against the picture read the long way. Of 19 mutants across 14d/14e,
      one survives: crossings at a segment's end, which the tie rule hides.
    - **Timing** (local, Node 22): the index 8 ms on the Langerak crane's
      pattern (1933 segments), 10 ms on the arowana's (3624); a query 6–12 µs
      at a fitted frame's radius, 100–350 µs at a quarter of the frame; flat
      folds under 15 µs.
- [ ] Browser: crease-pattern capture, flat fold, References step; a PDF with a
  circle and a landing arrow.

### 14e. Right-angle marks
- [ ] Shared primitive and golden; kind; ray-based corner detection; drag
  fallback; Turn 90°.
  - Analysis as built (`rightAngles.ts`, pure; no kind or canvas yet): rays,
    not lines — one from a line ending at the vertex, two from one running
    through it, rays within 0.5° one; a sector between consecutive rays is a
    right angle at 90° ± 1°, so an eight-way box-pleat vertex has none and a
    paper corner's reflex side never is one.
    `rightAngleCorner(step, assets, point, radius, {annotations?, ignore?,
    deadZone?})` takes the vertex nearest the pointer within the radius
    (picture points, annotation line ends, crossings) and the sector the
    pointer is in; null within the dead zone (a quarter of the radius by
    default). It returns `{at, legs, diagonal}`: the legs' unit directions
    clockwise on the page, the diagonal between them, along which a mark's
    `to` goes. `rightAnglesAt(step, assets, at)` lists every one at a point.
    A 3D or simulated picture's own lines give no rays; annotation lines do
    on any picture, an upload's included. Tests: a square with a diagonal,
    a waterbomb vertex split and whole, grid, eight-way and one-diagonal
    box-pleat vertices, a sector round past +x, ±1°, References mirrored, an
    upload's drawn lines, 3D; on the real pictures box_90's 16, counted by
    hand. Timing as 14d.
- [ ] Browser: a box-pleated capture, a References step, an upload with drawn
  lines, a PDF.

### 14f. White arrows
- [ ] Flatten-and-offset geometry, joins, loop removal, head, tails, mitre
  limit; shared primitive and golden; kind and presets; Edit Path reuse.
  - 14f geometry (as built; no kind, primitive, file or canvas yet):
    - **Outline.** `whiteArrowOutline(path, {neck, headLength, headWidth},
      'pointed' | 'square' | 'cleft', tolerance)` in `stepDiagramGeometry.ts`
      (D8's home for glyph geometry, beside `pushArrowOutline` and
      `pathReturn`, whose offsetter it shares): one closed polygon from the
      tip, or null for no length or no size. The head is straight-backed
      across the path's tangent `headLength` short of its end, the tip that far
      on along it (the fold arrows' rule). The shaft is flattened and offset by
      `offsetRuns`, which now takes a join rule: round outside a smooth bend
      (the curve's own offset, and still the return's), mitred to
      `WHITE_ARROW_MITER_LIMIT` (1.5, the template's) outside a corner node and
      bevelled past it. The whole ring then goes through `cutLoops` (eight
      necks of travel), which takes out a tight bend's swallowtail, a sharp
      inner corner's overlap and a shaft bent across its own head. A path
      shorter than its head and 1.5 necks draws the same shape smaller, as a
      short push does. `outlineDistance` is the press test: even–odd inside,
      else the distance to the nearest edge.
    - **Taper.** The template's pointed arrows taper the whole shaft; its even
      ones do not. A pointed tail is `1 − (1 − u)^1.2` of the neck at a share
      `u` of the way (`path4649` fits within 2%); square and cleft are the neck
      the whole way; a cleft is the push's depth for its width.
    - **Widths** (`DIAGRAM_WHITE_ARROW_INK`, ink at 0.331 mm): regular is
      `path4649` (neck 3.58 mm, head 3.95 × 7.94 mm), narrow is the push
      arrow's shaft and head (2.12 mm; the template's even arrows are 2.0–2.1),
      wide is regular × 1.4 (5.0 mm, a choice: the template has nothing wider).
    - **Not supported (v1).** A path that crosses itself, or legs nearer than
      the arrow's width (including its head): drawn as offset, overlapping; a
      loop under eight necks of travel is cut instead. The template's
      over-and-around arrow (`path4657`) twists its band; an offset cannot.
    - **Proof.** `whiteArrowGeometry.test.ts` (19): exact straight outlines
      for each tail, the head at the neck's tangent, sides half a neck off a
      gentle arc and an S with the area of the band, a hairpin bent at a fifth
      of the neck with no point nearer the centreline than half the neck and
      its inner corner where the legs' offsets meet, mitre/bevel either side of
      the limit, a smooth bend rounded, shrink, stacked nodes and handles on
      nodes, 150 random paths with no non-finite point, and the press test.
      Eight mutants each fail a test. Pictures in
      `artifacts/diagram-annotate/14f/` (`sheet-cases`, `sheet-stress`,
      `sheet-template`): `path4649` and ours coincide when laid over each
      other.
- [ ] Browser: the template's white arrow beside ours at the same printed
  size; deep zoom; iPad; a PDF.

## Risks

1. The offset geometry (white arrows, the derived return) at tight curls and
   corner nodes.
2. The mountain half-head's side flipping near an inflection of an S-curve.
3. 14a moves the canvas's listeners, which carry pinch and the touch guard.
4. Snap targets on large crease patterns (computed once per picture;
   crossings kept local).
5. Phase 13: whether a spread carries annotations decides whether arcs and the
   right-angle mark's diagonal are enough, or need storing as paths and legs.
