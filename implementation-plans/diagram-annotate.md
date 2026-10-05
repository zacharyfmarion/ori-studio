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
  (Q9). (Arrows no longer snap — decision 9, changed 2026-10-05; one stops at
  a ring wherever in it its end is drawn.)
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

### 6. Repeat behind (Zach, 2026-10-04)

A callout, as diagrams mark "repeat behind" or "repeat on the other flap":
a line from a point on the picture to a box with words in it. Kind
`callout`: `from` the point the line touches (it snaps, as 14d's ends do),
`to` where the box sits; `text`, edited as a label's is, "Repeat behind" when
placed. The line is the annotation pen's, thin and plain, stopping at the
box's edge; the box a rectangle hugging its text (a pad round it), filled
page white and outlined in the arrow pen, so it reads over the picture. One
undo step per gesture; the box and the point each drag on their own, the
body (the line) moves both. A shared primitive with a golden, as every mark
(D8). Text in the diagram's fonts, Han in its style, as labels are.

### 7. The tool hint window (Zach, 2026-10-04)

Every Annotate tool says what it does in the shared tool hint window main
gained (`components/ui/tools/ToolHintWindow`, the bottom-right window Edit and
the Simulator use) rather than in the Step pane: its name, a line on how to
use it, and its modifiers (Shift, Alt, ⌘ to place freely). The Step pane
keeps the selected annotation's verbs. On a phone the window gives way as it
does in Edit.

*Amended after review (2026-10-04, awaiting Zach):* Select has no window, as
Edit's Box Select and the Simulator's orbit have none. Select is where
Annotate rests, so its window was up whenever Annotate was open, and at
1280–1440 px it lay over the Step pane's last fields: a click meant for the
instruction landed in the window, and the words typed went to the canvas's
tool keys. Select's help line stays in the rail's tooltip; its two keys (⌘
to place freely, Shift-drag a right angle's far corner) lose their place on
screen.

*Amended again after the fourth review (2026-10-05, awaiting Zach):* every
other tool's window lay over the Instruction too, and a drawing tool stays
in hand after it draws, so drawing an arrow and then typing the step's words
did the same. Annotate's window keeps to the canvas's side of the seam, its
right edge 12 px in from it (`ToolHintWindow`'s `inside`); Edit's and the
Simulator's still overhang it. It covers a corner of the canvas instead,
which pans, and it collapses.

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
   *Changed by Zach, 2026-10-05:* arrows do not snap. "Usually they are not
   drawn directly on corners so they should just be free drawn." Every tool in
   the Arrows group — fold, push and white arrows, with turn-over and rotate,
   which never snapped — is drawn where it is drawn, its ends dragged where
   they are let go, with no snap target shown and no ⌘ key in its window.
   Lines, circles, right angles and a callout's point still snap. Nor is an
   arrow's end a point another mark snaps to (the fifth review): drawn a few
   px off the point it shows, it would pull a circle put on that point onto
   itself.
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
- [x] `pictureSnap.ts` per picture kind; `LineHitIndex` in-reach query; kind
  `circle`; hover and press-time previews; override; Step pane toggle; arrow
  ends snapping (Q9).
  - Kind as built:
    - **Model.** `circle` is a point kind (`from` its centre, `to` the same),
      created with nothing more (no letter, decision 8; no axis), moved,
      carried and cleaned as the other point kinds are. Not shaped, not
      flipped.
    - **Drawing.** Compiled to References' own `point` primitive in its
      highlight style — no new glyph geometry: the ring, its 3.07-ink radius
      and its 0.75 × arrow-pen stroke already exist. The annotation drawing's
      mark ink is now its arrow ink, so the ring is the annotation pen in
      width and colour (decision 7; References rings in the edge ink, which
      only differs from the arrows' in a coloured style). `annotationReach`
      takes its outer edge. Arrows land on it by the existing rule: a
      one-way arrow's tip stops a rim short (`foldArrowLanding`); its tail
      is not trimmed, as References' never is (a fold-and-unfold arrow's
      always is). The glyph golden gains one ring, front and back, and
      nothing else in it moves.
    - **File.** Read and written with the base fields; a field (a letter),
      or a point past reach, is a newer build's. 18eee51a0's reader keeps a
      circle verbatim and writes it back unchanged (checked by running that
      reader).
    - **Hit.** By its ring, not its inside (`circleRadius(ink)`): an arrow
      drawn into it ends inside it, and a press there is the arrow's. Selected, it washes its ring and offers no ends.
    - **Tool.** Its own rail group, Marks; key O (`diagram.toolCircle`,
      free in every scope the Diagram pushes); "Click a point to circle it."
      Annotate's key set is a record now, so a tool key cannot be left out.
  - Snapping as built:
    - **What.** `annotateSnap.ts` (pure): `snapsWhenPlaced` (a switch) — the
      circle and every line kind (every arrow kind too until Zach, 2026-10-05,
      decision 9); `placePoint` over
      `pictureSnapTarget`; `snapOutcome` for the event. In the canvas
      (`placeInHand`): a drawing's start on the press, its end on each move
      and on release; a line's end or a callout's point dragged with
      Select, never onto itself (`ignore`), an arrow's end left where it is
      let go; a circle moved whole, its centre, the press
      keeping its offset, landing on the target exactly. Edit Path never
      snaps (decision 9), its end nodes included.
    - **Radius.** `useAnnotateSnap`: `cpSnapRadius` × `CP_MODEL_TO_CSS`
      CSS px over (overlay CTM `a` × `layout.unit`) screen px per picture
      unit — the same on screen at any zoom, as the hit reach is. Edit's
      coarse-pointer default (15 → 22 px) comes with the setting.
    - **Override and switch.** ⌘ (Ctrl elsewhere: `isPrimaryModifier`)
      places freely, read from each pointer event; a key pressed or let go
      with the pointer still re-runs the last move through
      `subscribeHeldModifiers`. The Snap switch is a persisted preference
      (`settingsStore.diagramAnnotateSnap`, key `diagram-annotate-snap`, on
      by default), not per session: the store already keeps such switches
      (References' auto-play) and it is not a property of a diagram. The
      Step pane shows it as "Snap to Picture" while annotating.
    - **Previews.** Hover with a tool that snaps (not Select, not Edit Path,
      not a finger, not with a button down or Space held) shows the target a
      press would land on; a press shows its start's at once (a finger's
      before its slop); a drag shows each end's. Drawn over the marks in the
      fixed selection colour on a white halo, by kind (`SnapTargets`). The
      targets are canvas state, changed only when what is shown changes; the
      marks are never drawn again for them (counted in a test).
    - **Keys.** A modifier alone makes no chord (`keyChordFromKeyboardEvent`),
      so ⌘ held mid-drag runs nothing; a dispatcher test pins it.
    - **Analytics.** `diagram annotation added` gains `snap` (`snapped` /
      `free` / `off` / `nothing_near` / `none`); `diagram annotate snap
      changed` {`enabled`} for the switch.
    - **Proof.** Fail-before: the kind's sources at 18eee51a0, 15 tests fail
      in 8 files; the snapping's at the kind's commit, 12 fail in 2 files.
      Mutants (no `ignore`, a radius not scaled by zoom) each fail a test.
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
- [x] Browser: crease-pattern capture, flat fold, References step; a PDF with a
  circle and a landing arrow.
  - As built (`artifacts/diagram-annotate/14d/snap.mjs`, desktop 1440×900,
    light and dark, crane-zach.osf's steps 3, 7 and 2): hover 7.8 px off a
    vertex, a References mark or a fold's corner shows it; circles clicked
    5–8 px off land on the point exactly; an arrow dragged from near one to
    near the other lands on both centres, its tip drawn a rim short (14.7
    px against a 14.5 px ring); ⌘ held hides the target and places at the
    pointer, and the target comes back when ⌘ is let go; the switch off
    shows nothing and places at the pointer. The page's PDF, rasterised,
    shows the circles and the landing arrows beside the canvas
    (`canvas-beside-pdf-light.png`). iPad WebKit and a real finger are not
    done here (14d's touch path is the press-time preview, tested in jsdom).

- [x] Review (14d and the 14d/14e/14f geometry), every finding put to a
  skeptic, fixed by hand with a test that fails before:
  - **Geometry (7):** a line drawn along a split crease found phantom
    crossings in its middle (stored scenes round to 0.01 px; collinear is
    now a distance, not an angle); a crease cut in pieces was indexed once
    per piece (its free end a vertex); aux lines the style hides gave snap
    targets and rays (`pictureGeometry` takes the style, as the painters
    decide); a 3D picture's own lines crossing drawn ones hid a drawn right
    angle; a flat fold's buried edges split visible right angles and lent
    legs to invented ones (the paint order is kept: a ray a later face
    covers is no way out); a white arrow's tail handle a hair backwards
    drew a cap and a wedge, and a hook at a short leg's corner dropped the
    leg (`withoutHooks`; no loop cut drops the tail) —
    `review-fixes/white-arrow-hooks.png`.
  - **14d (5):** an arrow landing on a circle took every press on its ring
    (its head is pressed where it is drawn; a circle is taken before other
    marks); an arrow ending in a ring off its middle stopped a full rim back
    (`backToRing`: on the ring, the near side; at the middle a rim, as
    References' — `review-fixes/landing-annotate.png`); a clicked or tapped
    circle was snapped again from where the pointer lifted (it lands where
    the press showed); the hover target went stale under a camera move.

### 14e. Right-angle marks
- [x] Shared primitive and golden; kind; ray-based corner detection; drag
  fallback; Turn 90°.
  - As built:
    - **Primitive.** `{kind: 'right-angle', at, toward}`: the corner, and any
      point along the diagonal into the angle (only its direction is read,
      measured after projecting, so it mirrors with the paper). Its shape is
      `rightAngleDrawn` (`stepDiagramGeometry.ts`): an open square, the two
      sides that do not lie on the lines, 7 ink a side
      (`DIAGRAM_RIGHT_ANGLE_INK`), legs 45° either side of the diagonal.
      Drawn as a ring is — a mark that can leave the paper, twice through
      the clip pair — in the ring's pen (`markRingWidth`, three quarters of
      the arrow's; decision 7's "annotation pen") and the mark's ink, solid,
      `stroke-linecap="butt"` (the legs end on the lines) and
      `stroke-linejoin="miter"` set on the element. `rightAngleReach`: half
      the pen past its ends, √2 of that past its mitred corner.
      `diagramInModel` and `symbolAnchor` carry it; References' stored-model
      reader does not read one (a newer build's, as a path arrow is).
      Goldens: `referencesRightAnglesGolden.json` (front and back through the
      export) and `annotate/__fixtures__/rightAngleGolden.json` (card, page
      and canvas, five cases), both checked by eye
      (`artifacts/diagram-annotate/14e/golden-*.png`).
    - **Kind.** `right-angle`, shape `corner` (`CORNER_KINDS`): `from` the
      corner, `to` `RIGHT_ANGLE_DIAGONAL` (0.02) along the diagonal — only
      its direction read: a spread carries the corner by a point just inside
      its angle (so with the face it is drawn in) and the direction as the
      turn takes it, never the two apart (review: two faces carried them, and
      a mark turned up to 180°). Every
      edit writes `to` that far (`rightAngleAt`, `cleanAnnotation`); at
      reach's edge the corner is drawn in rather than the direction turned;
      a corner put on a point stays on it to the bit. Moves whole; its corner
      moves it with its direction kept; its other end turns it
      (`moveAnnotationEnd`). Carried by mapping both points and writing `to`
      again (a mirror turns it over, a turn turns it). `turnRightAngle`: a
      quarter clockwise on the page about its corner.
    - **File.** Base fields only; a field, or a point past reach, is a newer
      build's; `to` at its corner (it opens no way) does not read; any other
      distance reads as written. a34d74086's reader keeps it verbatim and
      writes it back unchanged (checked by running that reader).
    - **Hit.** Its legs, and 0 anywhere in its square (its corner included).
      Selected, it offers `corner` (its corner) and `direction` (the square's
      far corner) — the grip parts 14b set aside — instead of ends.
    - **Placing** (`rightAnglePlacement.ts`, decision 12). Hover with the tool:
      `rightAngleCorner` at the snap radius — the vertex, and the right angle
      the pointer is in — shown as a ghost of the mark in the selection colour
      over the marks (`RightAngleGhost`, canvas state, never drawn into the
      marks) with the vertex's snap target; a click puts the mark there.
      Otherwise the corner is the point the press snapped to (14d's
      `placePoint`, ⌘ and the switch as there), and: a drag at least
      `MIN_ANNOTATION_LENGTH` opens into a right angle at the corner the drag
      points into (`draggedOpening`), else toward the pointer, Shift holding it
      to 45°; a click opens into the right angle at the corner nearest the way
      to the frame's middle, else that way held to a diagonal (`towardMiddle`;
      up and to the right from the middle). The hover shows exactly what a
      click would do, found or not. 3D and simulated pictures give no rays of
      their own, so only the corner snaps there. Moving one by its body or its
      corner onto a snapped point opens it into the right angle there nearest
      the way it opened (`squaredOpening`); dragging its far corner turns it,
      squared into a right angle the pointer points into, Shift 45°.
    - **Tool and verb.** Marks group, after the circle; key Q (R is
      Rotate's), checked free in every scope the Diagram pushes; its glyph two
      lines meeting square and the open square between them. **Turn 90°**
      (`turn-right-angle` in `annotationActions.ts`): a right angle's verb in
      the Step pane, one undo step. No key (Reset Shape has none) and no
      context menu: the canvas has no annotation context menu to join.
    - **Analytics.** `diagram annotation added` gains `tool: right_angle`; a
      click in a right angle counts `snap: snapped`.
    - **Proof.** Fail-before: the touched sources at a34d74086 under the new
      tests — 30 tests fail and three suites do not load. Fifteen mutants (the
      reach without its mitre, no mitre on the element, the arrow's pen, the
      diagonal read before projecting, `to` not rewritten on a carry, reach
      kept by clamping `to`, Turn 90° anticlockwise, ends instead of the
      corner and direction grips, legs only, a reader taking `to` at the
      corner, a drag squared into the first right angle whichever way it
      points, no dead-zone squaring on a click, a click placing nothing, a
      moved mark not squared, no ghost) each fail a test; the dead-zone one
      survived the first set, and a test was added for it.
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
- [x] Browser: a box-pleated capture, a References step, an upload with drawn
  lines, a PDF.
  - As built (`artifacts/diagram-annotate/14e/rightangle.mjs`, Chromium
    1440×900, light and dark): box_90's crease pattern linked as a capture,
    crane.osf's first References step, and an upload with a valley, a
    mountain and a hidden line drawn on it with the line tools. On each:
    hovering 9 px into a right angle shows the ghost and the vertex; the
    click puts the mark on the vertex exactly, opening along that angle's
    diagonal; a drag from 2 px off a second vertex, 15° off its diagonal,
    lands on the vertex squared into that angle; a Shift drag in the open
    holds 45°; a press on a leg selects it with its corner and far-corner
    grips; Turn 90° turns it a quarter clockwise, four times round. The
    crane's pages exported to PDF and rasterised (`pdf-light-1.png`,
    `pdf-zoom-1.png`): the marks print mitred, in the arrows' ink. iPad
    WebKit and a real finger are not done here.

### 14f. White arrows
- [x] Flatten-and-offset geometry, joins, loop removal, head, tails, mitre
  limit; shared primitive and golden; kind and presets; Edit Path reuse.
  - Kind as built (`claude/diagram-14f-white-arrows`):
    - **Primitive.** `{kind: 'white-arrow', path: DiagramCubic[], width,
      tail}`; `whiteArrowDrawn` is the one place its drawn shape is decided
      (as `pushArrowDrawn` is a push's): the outline of the projected path at
      its width's size in the drawing's ink, flattened to
      `WHITE_ARROW_FLATTEN_INK` (0.01 ink; see the deep-zoom fix below).
      Drawn as the push is — filled with the paper's face (an annotation's is
      the page's white), outlined in the arrow pen, solid, mitred — but
      stroked to its own limit (`stroke-miterlimit="1.5"`). It can leave the
      paper, maps into a model by every control point, anchors at its tail;
      References' stored-model reader does not read one (a newer build's),
      as with `path-arrow`. Golden `referencesWhiteArrowsGolden.json`, front
      and back: every width and tail (regular pointed on an arc, narrow
      square on an S, wide cleft straight, regular square round a corner
      node), checked by eye; the other goldens do not move.
    - **Model.** Kind `white-arrow` (shape `path`), always a path: a drag
      lays it straight — two nodes, no handles (`straightPath`) — and one
      written without a path is laid straight between its ends
      (`cleanAnnotation`), so nothing takes it for the default arc. `width`
      (`narrow`/`regular`/`wide`) and `tail` (`pointed`/`square`/`cleft`); a
      new one, and one a file leaves unsaid, is the template's
      (`DEFAULT_WHITE_ARROW`: regular, pointed). `canBeShaped` and `flipsArc`
      say yes (Flip mirrors it across its chord, the shaped fold arrows'
      rule). `isShapedArrow` — a fold arrow made a path, a white arrow no
      longer the straight one it was laid as (`isStraightPath`) — decides
      Reset's offer with Select and the shaped event. Reset lays it straight
      again (`resetPath`), and is off while it is straight. Carries, moves and
      ends as a shaped fold arrow does, every node and handle mapped.
    - **File.** Fields `path`, `width`, `tail`. Damage: no path, a path that
      does not read, a preset that is not a string, ends that are not the
      path's. Newer: a preset string it has no name for, a `bend`, any other
      field, a point past reach — told before damage. a34d74086's reader,
      run on a document holding one, carries it verbatim and writes it back
      unchanged.
    - **Reach.** Its outline's corners with their mitres as its stroke draws
      them: `mitredCornerReach` takes a limit (SVG's 4 by default) and the
      white arrow passes 1.5, so a narrow head's 64° tip reaches the half pen
      its bevel does, not 1.89 half-pens. The push/rotate/turn-over reach
      test builds a white arrow's ink independently (offset-edge mitres to
      1.5) at the default and 12 pt pens; a second test holds the narrow tip
      to exactly the half pen.
    - **Hit.** `outlineDistance` on its outline in picture units, cached per
      annotation and ink: anywhere in its hollow, as wide as its width draws
      it, a pointed tail narrow at its start.
    - **Canvas and tool.** Rail after the push (Arrows), key W
      (`diagram.toolWhiteArrow`, free in every scope the Diagram pushes), a
      hollow curved glyph; its ends neither snap nor are snapped to (decision
      9, as changed 2026-10-05); the selection washes its centreline; a double-click with Select
      picks Edit Path up, which shapes it with every fold-arrow gesture and
      verb, unforked. Edit Path's and Select's help say white arrows are
      shaped too.
    - **Step pane.** Width and Tail as icon segmented controls
      (`DiagramWhiteArrowControls`, `FieldRow` + `SegmentedControl`
      `iconsOnly`), each option the small arrow it draws, named by tooltip and
      accessible name; each change one undo step (`setWhiteArrowLook`).
    - **Analytics.** `diagram annotation added` `tool` gains `white_arrow`;
      `diagram arrow shaped` `kind` gains `white_arrow`, counted once when a
      straight one is first shaped (a node added counts; moving a straight
      one's end does not) and again after a Reset.
    - **Proof.** Every behaviour has a test; 19 mutants (hit by spine only,
      reach at SVG's limit, no reach, the compile ignoring width, the reader
      filling no default / telling damage before news / not checking ends,
      the writer dropping the look, any path counted as shaped, Reset making
      an arc, Reset offered when straight, no snapping, no snap points, no
      look on a new arrow, a pathless one left pathless, not shaped, the
      event's kind lost, the pane not applying the look, coarse runs) each
      fail one.
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
- [x] Browser: the template's white arrow beside ours at the same printed
  size; deep zoom; iPad; a PDF.
  - As built (`artifacts/diagram-annotate/14f/`, dev server :5297, the
    crane's step 7): `white.mjs` draws three with W and the mouse, sets each
    width and tail from the Step pane, shapes one with Edit Path by the mouse
    alone (a curve bend, a click adding a node, a node drag, an Alt handle
    drag making a corner), bends the others, selects one by a press in its
    hollow; light and dark; the card, the page and its PDF
    (`canvas-beside-pdf-light.png`). `template.mjs`/`measure.py`/`compare.mjs`:
    one regular pointed arrow along `path4649`'s own centreline (fitted
    within 0.06 mm), exported to PDF, found as the difference from the same
    export without it, rasterised at 600 dpi beside the template's outline
    at the same scale and over it (`template-vs-ours.png`): 12.91 × 8.09 mm
    printed against the template's 12.77 × 8.18, the outlines coinciding.
    `zoom.mjs` at 1200%: the sides showed their runs' corners (3°, ~250 px
    apart) — fixed by flattening to 0.01 ink (`zoom-deep-before-after.png`).
    `ipad.mjs` (WebKit, 1180 × 820, mouse): the pane's Width and Tail words
    were cut short — fixed with the icon options
    (`ipad-pane-before-after.png`). Real touch was not driven (not scriptable
    in headless WebKit), as for 14a.

### 14g. Repeat behind
- [x] Kind `callout`: model, file and round trips, hit test (line, box, text),
  the shared primitive and golden, text editing as a label's, snapping of its
  point; a rail tool and its key; i18n; analytics through the
  annotation-added event.
  - As built:
    - **Model.** `callout` is its own shape (`ANNOTATION_SHAPES`): `from` the
      point its line touches, `to` the middle of its box, `text` its words.
      A drag from the point draws one; a click — or a drag shorter than a
      slip — puts its box beside the point (`calloutBeside`): out from the
      frame's middle diagonally (up and right from the middle itself), its
      near corner `CALLOUT_GAP` (0.08) out each way. Never degenerate: its
      box is drawn wherever it sits. New predicates, each a switch over kinds:
      `carriesText` (label, callout: the Step pane's field, the page's
      fonts, Select back in hand and the field focused once placed),
      `annotationEnds` (the dots a selected annotation offers: a callout only
      its point) and `placedByClick`.
    - **Words.** "Repeat behind" in the author's language when it is made
      (`panels:diagram.annotations.repeatBehind`, passed to
      `createAnnotation`): stored as typed, so they print as the author read
      them and do not change for a reader in another language — they are the
      diagram's words, not the app's. Edited as a label's (one line, 80
      characters, `cleanLabelText`).
    - **Shape, one place** (`calloutShape`, picture units): the box round
      `to`, as wide as its words are set by the advance table a label's reach
      uses (`textEms`, now shared; never narrower than a label with nothing
      in it), `CALLOUT_PAD_EMS` (0.5 em) past each side, and
      `CALLOUT_HALF_HEIGHT_EMS` (0.85 em) above and below its words' middle;
      the line from the point toward the box's middle, stopped at its
      outline, none when the point is in the box. Its words are a label's
      size (`CALLOUT_TEXT_SIZE` = `LABEL_SIZE`), centred on `to` as a label's
      are on its point.
    - **Drawing.** An annotation primitive, not a References one: References
      knows nothing of the diagram's fonts or advance table.
      `AnnotationDrawing.callouts`, drawn by `calloutElement` over the marks
      and under the labels: the line in the annotation pen (a ring's, 0.75 of
      the arrow pen), round-capped; the box filled with the page's white and
      outlined in the arrow pen, mitred; the words as a label's
      (`labelElement`, each script's font, Han under the key a page swaps for
      the diagram's style). A callout with no words draws nothing, as a label
      does. `annotationTextRuns` sets its words, so a page loads and embeds
      their faces (the PDF embeds the CJK face; checked with `pdffonts`).
    - **Golden.** `calloutsGolden.json`: eight cases (each side, a corner,
      the point under the box, off the frame, Han, kana, mixed, one letter,
      80 characters) on a card, a page and the canvas, checked by eye in the
      diagram's fonts before freezing (`artifacts/diagram-annotate/14g/
      golden-sheet.png`).
    - **Reach.** Exactly the box with half its outline's pen round it and the
      line's round ends — read back off the painted markup at the default
      and a 12 pt pen. The words inside the box are checked apart, by their
      glyphs' own outlines (HarfBuzz, Noto Sans and the CJK fixtures): every
      Latin glyph the table counts, tall and stacked marks, Han, kana,
      Hangul, at a 40 mm frame and the canvas's.
    - **Hit.** The box, its words in it, is `box` — a new grip part — and
      moves alone by the pointer's travel from wherever it was pressed; the
      line is `body` and moves both; selected, the dot at its point is
      `from`. Hit order as drawn: labels over callouts over circles over the
      other marks over lines.
    - **Snapping.** Its point snaps when put down and when dragged
      (`snapsEnd`), never its box; others snap to its point.
    - **Carry.** With the face under its point: the point moves as a point
      does, the box goes the way the picture turned and mirrored its offset
      (`PictureMove.vector`, which a spread now gives from its turn), never
      spread with the face under the box. Words stay upright, so the box
      does: it keeps its line's length rather than its offset (`keptBeside`),
      or a quarter turn could put the point inside a box wider than tall and
      lose the line (review). Exactly undone by the move back.
    - **File.** `text` read as a label's; a field it has no name for, words
      over 80 or a point past reach are a newer build's; no words, or words
      not a string, drop it. a34d74086's reader keeps one verbatim and writes
      it back unchanged (checked by running that reader).
    - **Tool.** In Text beside Label, a glyph of a dot, a line and a box; key
      C (`diagram.toolCallout`, free in every scope the Diagram pushes).
      Analytics: `callout` in `diagram annotation added`'s `tool`.
    - **Proof.** The new tests against a34d74086's sources: 41 fail. Mutants
      (reach without the box pen or the line, the line in the arrow pen, no
      pad, a capital-high box, a box not from the advance table, the line to
      the box's middle, the box taken as the body, the hit order swapped, the
      box's middle offered as an end, the box jumping to the pointer, the box
      snapping, no click placement, a click putting the box on the point,
      English words always, no field after placing, carried point by point, a
      spread with no direction, words off the page's fonts, the reader
      without the kind, no Step pane field, an empty box drawn) each fail a
      test.
- [x] Browser: placed on a crane step, its text edited, dragged by box and by
  point, on a page and in a PDF.
  - As built (`artifacts/diagram-annotate/14g/callout.mjs`, crane.osf step 8,
    desktop 1440×900, light and dark): C picks the tool; hovering by the
    bottom tip shows its vertex; a drag from 5 px off it lands the point on
    it exactly, one undo step, the field focused with "Repeat behind"
    selected; typed over in Latin, then 裏側も同様に, then mixed; the box
    dragged off its middle moves by the pointer's travel, the point staying;
    the point dragged near the right corner snaps to it, the box staying; the
    line dragged moves both; each one undo step. On its page (Pages view),
    and in the PDF the export writes (its own `diagramPdfInput` and writer):
    `pdftotext` reads "Repeat behind 裏側も同様に", `pdffonts` lists
    NotoSansJP-Regular embedded (`canvas-beside-pdf-light.png`). The CJK
    fonts are a build output (`apps/web/public/fonts/diagram/`); a worktree
    without them refuses the PDF for a label or a callout alike.

### 14h. The tool hint window
- [x] Main merged in; every Annotate tool's hint in `ToolHintWindow` (Select,
  Edit Path, each drawing tool, circles, right angles, white arrows,
  callouts), the Step pane's help line retired; phone behaviour as Edit's.
  As built: the window is `components/diagram/DiagramAnnotateToolWindow`,
  mounted by the canvas beside (not inside) its view and anchored to it, so
  it overhangs the seam with the Step pane as Edit's does over View; its
  collapse is its own preference (`diagramToolHintCollapsed`). What it says
  is `annotateToolHint` in `annotateTools.ts`: the tool's name, its help
  line (moved from the Step pane; the rail's tooltip keeps it too, as
  Edit's does), and its keys as the canvas honours them — ⌘/Ctrl to put
  what snaps down anywhere, Shift's 45° steps for right angles and Edit
  Path's nodes and 15° for its handles, Option/Alt to break a smooth node —
  in the platform's names (`altModifierLabel` joins `primaryModifierLabel`).
  A finger gets no keys, as the Simulator's Pin window gives it none. The
  heading-and-list look is `ui/tools/ToolHintInstructions`, extracted from
  the Simulator's window (computed styles identical before and after). The
  label's and callout's help said "type it here", meaning the Step pane; it
  says "in the Step pane" now. Not shown on a diagram that cannot change, as
  Edit's is not. On a phone Annotate is "Annotate on a larger screen", so
  there is no canvas and no window; Edit's window on a phone stays up,
  clamped to the screen over its toolbar, which the shared placement would
  give Annotate too if it ever comes to phones.
- [x] Browser: each tool's window, light and dark, desktop and phone.
  `artifacts/diagram-annotate/14h/` (`tool-window.mjs`): all 16 tools on a
  1440×900 desktop (name, help, keys; portaled to the body, outside the
  view, 12 px above the view's bottom beside the zoom pill, overhanging the
  seam by 50 px) and on a coarse-pointer 1180×820 tablet (no keys, clamped
  to the screen's right edge), light and dark; a 390×844 phone shows the
  larger-screen note and no window, and its Step drawer no help line.
- [x] Review: no window for Select, Annotate's resting tool (decision 7,
  amended): it covered the Step pane's instruction field at 1280–1440 px.
  `annotateToolHint` is null for Select, and the window draws nothing then.
- [x] Review of 14h and the 14e–g fixes (12 findings, all confirmed),
  fixed, each failing on the code before it: the window as above (and with
  it Select's key line); a touch tablet's label and callout lines naming the
  Settings sheet's Step tab; a turn under a depth spread carrying each mark
  with its face; corners found within the stored grid's rounding; woven
  patches carried with their whole face; a selected circle taken by its
  ring under a hollow arrow, and a hidden one passed over; a callout taken
  and washed along its outline as drawn; labels as wide as Noto Sans sets
  its whole cmap, decomposed Greek and emoji included; a pointed tail's knot
  cut. Found while verifying: a mark on a corner stays with that corner's
  face when another comes over it (six turns and six back bring it home).
  Before/after: `artifacts/diagram-annotate/review-14h/compare-*.png`.
- [x] Fourth review (14 findings, all confirmed; the Annotate ones here, the
  layout ones in `diagram-workspace.md`), fixed, each failing on the code
  before it:
  - The carry: a deeper face's edge no longer takes a mark inside the face
    over it (the corner pass first, then the topmost face the mark is in or
    on); a right angle goes with the face it is a corner of and opens into,
    though another has come over its angle (`PictureMove.corner`); and a
    carry remembers, per picture it carried marks to, each point's place on
    its face (`placesOnFaces`, for the session; held by picture object, so
    undo keeps it): a mark a nearer face slid over, or on a face a picture
    with no spread leaves out, comes home. On Oriedita's sample and the
    kabuto, folded by the kernel, every circle and right angle comes home
    through every spread and turn round trip (65 of 261 circles were up to
    15.7 px off).
  - Labels: ⸺ ⸻ in the CJK table, and a character its run's font lacks
    counted in the other's, as a page sets it.
  - The tool window on the canvas's side of the seam (decision 7, amended
    again above).
  - Spread: an undo of another step keeps the slides waiting and the drag
    shown.
  - The header's cog renamed App Settings, so the Settings a touch help
    names is one button.
  - Open for Zach: a mark snapped to a corner covered by the face it shows
    on follows that corner when the spread changes (the snap offers covered
    corners, for hidden lines); a circle placed there incidentally slides
    across the face it shows on.
  Before/after: `artifacts/diagram-annotate/review-4/compare-*.png`.
- [x] Arrows drawn free (Zach, 2026-10-05; decision 9 changed), and its
  review — the fifth (8 findings, all confirmed, three distinct), fixed:
  - An arrow's end is no snap target: drawn a few px off a point, it pulled
    a circle put on that point onto itself (crane step 4: 9 px off the
    corner; on the corner now).
  - The Snap help names ⌘ straight after the marks it frees; the arrows
    sentence between them made its pronoun the arrows in most languages.
  - The comments, the analytics type and the plan's as-built notes that
    still said arrows snap.
  Before/after: `artifacts/diagram-annotate/arrows-free/compare-*.png`,
  `snap-help-{before,after}.txt`.

## Risks

1. The offset geometry (white arrows, the derived return) at tight curls and
   corner nodes.
2. The mountain half-head's side flipping near an inflection of an S-curve.
3. 14a moves the canvas's listeners, which carry pinch and the touch guard.
4. Snap targets on large crease patterns (computed once per picture;
   crossings kept local).
5. Phase 13: whether a spread carries annotations decides whether arcs and the
   right-angle mark's diagonal are enough, or need storing as paths and legs.
