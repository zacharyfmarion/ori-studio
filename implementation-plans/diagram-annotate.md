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
- [ ] Geometry and model: shared `path-arrow` primitive and golden; `path` in
  model, file and clean; `arcToPath`; carry, move, degenerate; an unshaped
  arrow paints byte-identical markup to today's.
- [ ] Edit Path on desktop: tool, gestures, modifiers, node stepper, Delete
  routing, Escape, Step pane verbs, nudging (Q6).
- [ ] Touch and Pencil.
- [ ] Browser: a 3–4 node arrow shaped with mouse, Alt and Shift; Reset; a PDF
  export beside the canvas.

### 14d. Snapping and circles
- [ ] `pictureSnap.ts` per picture kind; `LineHitIndex` in-reach query; kind
  `circle`; hover and press-time previews; override; Step pane toggle; arrow
  ends snapping (Q9).
- [ ] Browser: crease-pattern capture, flat fold, References step; a PDF with a
  circle and a landing arrow.

### 14e. Right-angle marks
- [ ] Shared primitive and golden; kind; ray-based corner detection; drag
  fallback; Turn 90°.
- [ ] Browser: a box-pleated capture, a References step, an upload with drawn
  lines, a PDF.

### 14f. White arrows
- [ ] Flatten-and-offset geometry, joins, loop removal, head, tails, mitre
  limit; shared primitive and golden; kind and presets; Edit Path reuse.
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
