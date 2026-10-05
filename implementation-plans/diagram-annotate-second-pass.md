# Diagram Annotate, second pass: flaps, line types, bisectors, pleat and solid arrows, close-ups

**Status: for discussion (2026-10-05).** Zach's Diagramming note
(`Oristudio/Diagramming.md` in his notes), five requests with five
screenshots from published diagrams. Phase 15 of
`implementation-plans/diagram-workspace.md`, after Phase 14
(`implementation-plans/diagram-annotate.md`), whose model, painter and canvas
this builds on. Built by me, by hand, phase by phase — no workflows (Zach,
2026-10-05). Paths are under `apps/web/src/` unless they say otherwise. The
visual decisions, drawn on Zach's crane:
https://claude.ai/artifact/UWMQk6D3E1XVTieSpXk6WQ (source:
`artifacts/diagram-second-pass/build-page.mjs`, gitignored).

## Goal

Zach's five asks (2026-10-05), and what each screenshot shows:

1. **Behind and in front of flaps.** "Ability to put arrows behind / in front
   of flaps, automatically change to dotted line when an annotation is behind
   a flap." No screenshot.
2. **A line type, and an angle bisector.** "Angle bisector tool that basically
   works like the bisector tool in edit mode. Basically I want a line type
   select like in edit mode with mountain, valley or dotted. Then it just
   becomes a line tool, and the bisector tool just uses the active line type."
   The screenshot (a book's step 125, "Crimp outside") shows a valley line
   bisecting the angle between an edge and a mountain fold, with an arc
   across the angle at its vertex and ticks on each half: the two halves are
   equal.
3. **Crimp and pleat arrows.** "Be able to specify the number of lightning
   bolt type kinks in the arrow." Step 129 ("push in, pleating") shows two
   thin arrows, each with one Z in its shaft and a filled head; step 92
   ("pleat using the creases") one with two Zs.
4. **A solid arrow.** "Like push but flat bottom. Should be able to make it
   have black fill or no fill. And should be able to control length with
   spline tools." Step 129's black block arrow: straight sides, a square
   tail, a head about twice the shaft's width.
5. **Close-ups.** "Ability to circle zoom in on a certain area, display at a
   large size (so basically render at larger mm, then only show the circled
   area)." A Triceratops step 73: a small circle on the picture, a line to a
   larger circle beside it, and in it that area drawn larger, its lines at
   their usual weight, a dotted arrow included.

(The note's folder holds a sixth image it does not embed: another crop of
step 125.)

Everything keeps printing through the one painter that cards, pages, step
files and the PDF share (`annotationDrawing` → `paintAnnotations` → usvg and
krilla), so the canvas and the page never disagree.

## Approach

### Where Annotate stands (what matters here)

- **A tool is a kind.** `AnnotateTool = DiagramAnnotationKind | 'edit-path' |
  null` (`annotate/annotateTools.ts`): the rail's groups, the keys, the tool
  window's help and modifiers, the glyphs and the `diagram annotation added`
  event's `tool` are all keyed by kind. Request 2 wants a tool (Line) that
  draws whichever of three kinds the line type says, and a tool (Angle
  Bisector) that draws a line and a mark; request 4 a tool that lays a
  preset of an existing kind. Tools need ids of their own.
- **Every kind is exhaustive.** A new kind fails to compile at 13 sites
  until each says what it does (14b): the compile, the hit test, the
  canvas's selection, the reader, `flipsArc`, the glyph, the reach, the kind
  sets, the rail's records. A new References primitive fails at
  `diagramPrimitiveShape`, `diagramInModel` and `markReach`.
- **Drawing is picture-blind.** `annotationDrawing(annotations, frame,
  framePx, style)` and `compiledAnnotation` (cached per annotation object)
  know nothing of the picture under the marks. Request 1 needs the picture's
  layers; request 5 needs the picture painted again.
- **A flat fold already knows its layers.** `pictureGeometry(…).layers`
  (`annotate/pictureGeometry.ts`, built for snapping): every face as painted,
  back to front, its ring, its paint order and its box. The stored scene is
  whole faces in painter's order (`foldedFlatScene.ts`: a topological order
  of the stacks, patched where flaps weave), spread where the pose spreads
  it. No other picture has layers: a crease pattern, a References step, a 3D
  or simulated picture, an upload.
- **The white arrow is most of a solid arrow.** It is a path, shaped and
  lengthened by Edit Path; its Narrow width is the push arrow's shaft and
  head; its Square tail is a flat bottom. Only its fill is fixed (the page's
  white).
- **Edit's Angle Bisector is Oriedita's `SQUARE_BISECTOR_7`**
  (`crates/oristudio-cp/src/operations/construction.rs`,
  `square_bisector_*`; the canvas's `feedSquareBisector`): three points (the
  vertex second) or two lines, then the line it runs to. From three points
  the bisector is the vertex's line through the triangle's incentre; from two
  lines that meet, the same at their crossing, of the angle their far ends
  span; from two parallel lines, the midline between them, which then needs
  two lines for its ends. It refuses a first point on the line through the
  other two, and a destination parallel to the bisector.
- **Edit's line types** are a segmented control across the top of its rail
  (`CpToolRail`'s `CpLineTypeControl`), and the tools that draw read the
  active type; A/S/D/F pick them. In Annotate, A is Edit Path and F is Flip
  Arc.

### 1. A line type and one Line tool (15a)

- **Tools get ids.** `AnnotateToolId`: Select, Edit Path, one per drawn kind
  except the three lines, `line`, `angle-bisector`, and (15d) `solid-arrow`.
  One record per tool says its group, key, name, help, modifiers, glyph and
  what it draws — `(lineType) => {kind, preset}` — so the rail, the keys, the
  tool window and the canvas read one place. Kinds in the file do not change:
  a line is still `valley-line`, `mountain-line` or `hidden-line`.
- **The line type** is a preference (`settingsStore`, beside the Snap
  switch; storage key `diagram-annotate-line-type`), Valley by default:
  Valley, Mountain, Hidden (the "dotted" line). On the rail, a segmented
  control heads the Lines group, as Edit's heads its rail, each option drawn
  as a short stroke in its own dash — dashed, dash-dot, dotted — rather than
  Edit's coloured letters (decision 5). Lines group: Line, Angle Bisector.
- **Keys.** Shift+V, Shift+M and H, today's three line tools, set the type;
  each picks Line too unless a line tool is already in hand, as Edit's type
  keys never change its tool. The shortcut ids stay, so a rebinding carries
  over. B picks Angle Bisector, as in Edit.
- **A selected line's type** is a Type row in the Step pane (Valley,
  Mountain, Hidden), one undo step, the line keeping its id and ends
  (decision 6). The rail's control is the pen for what is drawn next.
- **Analytics.** A line drawn with Line is still `tool: valley_line`
  (`mountain_line`, `hidden_line`), so the event's history reads on.

### 2. Angle Bisector (15b)

- **As Edit's, on the picture.** The first press decides: a point within the
  snap radius (a vertex, a corner, a line's end, a crossing — the targets a
  circle snaps to) starts the three-point way; else a line of the picture or
  a drawn line under the press starts the two-line way.
  - Three points, the vertex second, each snapped as a circle is (⌘ puts one
    down freely); then a press on the line it runs to: the bisector goes
    from the vertex to where its line meets that one. A press on no line
    ends it there, projected onto the bisector — an Ori Studio addition, as
    an upload has no lines (decision 9).
  - Two lines that meet: the bisector of the angle their far ends span, from
    their crossing (on the paper or not), then the line it runs to.
  - Two parallel lines: the midline between them, shown to aim at, then the
    two lines its ends run to.
  - The canvas shows the points picked, the lines picked, and the bisector
    to the line under the pointer. Escape takes back the last pick, then
    puts the tool down. The tool window says each step, the current one
    marked, as Edit's instructions do.
- **Geometry.** `annotate/angleBisector.ts`: the kernel's `square_bisector_*`
  ported to picture units, refusals included (the window says why), with
  unit tests that mirror the kernel's. Not a new algorithm: Oriedita's,
  where Edit's already is.
- **What it draws.** A line of the active type from the vertex to its end,
  and — decision 8 — the equal-angle mark step 125 shows: a new kind,
  `angle-mark`, put down with it in one undo step ("Bisect Angle").
  - The mark: the vertex (`from`), a point on each arm (`to` and a new
    `other`), `ticks` (1, 2 or 3; 1 by default). Drawn as one arc across the
    whole angle at a fixed print radius (about 2.5 mm), with that many ticks
    across each half's middle, in the annotation pen. A shared References
    primitive (`angle-mark`) with a golden, as every mark is (D8).
  - It is a mark of its own: selected, moved and deleted on its own, offered
    on its own in the Marks group (three clicks: arm, vertex, arm), and
    carried like a right angle, with the face it is drawn in
    (`PictureMove.corner`).
- **Analytics.** `diagram annotation added`, `tool: angle_bisector`, once per
  bisector, its `snap` its points' (the mark is not counted again).

### 3. Pleat arrows (15c)

- **A new kind**, `pleat-arrow`, in the Arrows group, key Z (zig-zag). Drawn
  straight from tail to tip, never snapped (arrows are drawn where they are
  drawn); `kinks`, how many Zs its shaft has (1 to 5; decision 10 says the
  default), and `mirrored` (which side its Zs step to).
- **Its shape: a lightning bolt.** The shaft runs on, steps back across
  itself and runs on again, once per Z — two kinks each — its runs parallel;
  the head is the valley arrow's filled head at the tip, along the last run.
  The runs lean a little off the tail-to-tip line, so the bolt starts at the
  tail and its head lands at the tip exactly. Each Z is a fixed print size,
  in ink, as every mark is, centred on the shaft; an arrow too short for its
  Zs draws them smaller, as a short push does.
- A shared References primitive (`pleat-arrow`, `pleatArrowDrawn` in
  `stepDiagramGeometry.ts`) with a golden; its reach is its polyline and
  head (`markReach`); its hit is the distance to its polyline.
- **Step pane:** Kinks (a stepper), Flip (F, as Flip Arc: mirrors the side
  its Zs step to). A mirror carries it over (`mirrored` toggles). Not shaped
  by Edit Path in v1.
- Analytics: `tool: pleat_arrow`.

### 4. Solid arrows (15d)

Recommended (decision 11): the white arrow gains a fill, and a tool lays the
solid one.

- **`fill`** on `white-arrow`: absent is white (every arrow today), `black`
  the arrow's ink. Drawn the same outline, filled with ink instead of the
  page's white, outlined in the same pen, so a black arrow and a white one of
  a width are one size. The reader knows `black`; another value is a newer
  build's.
- **A Solid Arrow tool** (Arrows group, key S) lays a white arrow Narrow (the
  push's proportions), with a Square tail (the flat bottom), filled Black,
  straight from tail to tip — then shaped and lengthened by Edit Path as any
  white arrow ("control length with spline tools").
- **Step pane:** the white arrow's controls gain Fill (White, Black). The
  annotation list names one by its look: a black one is a "Solid Arrow".
- Analytics: `tool: solid_arrow`.

### 5. Behind flaps (15e)

- **What a mark stores.** `behind?: { from?: number; to?: number }`: for each
  end that is behind, how many of the layers at that end lie over it (1 is
  the top one). Absent: in front, as every mark is today. On fold arrows
  (arc or path), pleat arrows, crease lines (not the hidden line, already
  dotted) and circles (`from`, its centre). Not on push, white or solid
  arrows, signs, labels or callouts in v1.
- **What it means** (decision 1). For each end that is behind, the faces
  over it are the top `n` faces at that point as painted, and every face
  over those: painted later and overlapping one of them, and so on. From
  that end, along the mark, the stretch until it first comes out from under
  all of them is drawn dotted; the rest is drawn as ever. So an arrow whose
  tail starts under a flap is dotted until it comes out, then solid even
  where it crosses the paper again in front — the crimp arrow of step 125.
  An end on no face has nothing over it. A circle is dotted along the arcs
  that lie under the faces over its centre.
- **Where.** On a flat fold only: the one picture that knows its layers.
  Elsewhere the controls are off, with "Only a folded picture knows its
  flaps"; a mark that has `behind` keeps it and is drawn in front.
- **How it is drawn** (decisions 2 and 3): the dotted stretch in the mark's
  own pen, dotted as a hidden line is (dots one pen apart, two pens on);
  heads stay solid, as the dotted arrow in the Triceratops close-up's is.
- **Geometry**, `annotate/behindFlaps.ts`, pure: the faces at a point
  (rings against `layers.covers`, top down), the faces over them (overlap
  of rings, box-prefiltered; general polygons, since a depth spread can bend
  a face), and the stretches of the mark's centreline under them, as
  intervals of its length. An end exactly on a face's edge (a snapped
  corner) is read a hair inside, along the mark, as a right angle's carry
  does. Cached per picture geometry and annotation object.
- **Threading the picture through.** `annotationDrawing` takes the step's
  layers (`pictureGeometry(step, assets, style).layers`), passed by every
  caller — the canvas, `paintAnnotations` (card and page), the step files —
  so print and screen are one compile. The arrow primitives gain an
  optional `hidden` (stretches along their shaft, never set by References);
  a line becomes a drawn piece and a hidden-line piece, one dash phase across
  both; a circle's ring becomes arcs.
- **Step pane:** arrows: Tail and Tip, each In Front | Behind; lines and
  circles: Behind, on or off; with any end behind, Under (a stepper, 1 to 9
  layers, for every end that is behind).
- Analytics: `diagram annotation behind` {`kind`, `ends`
  (`tail`/`tip`/`both`/`whole`), `layers` (`1`/`2`/`3+`)} when a mark is
  first put behind.

### 6. Close-ups (15f)

- **A new kind**, `close-up`, in the Marks group (key I, for inset): `from`
  the centre of the area shown larger (a point on the picture), `to` the
  close-up's centre, `radius` the area's (picture units), `scale` (1.25 to 6,
  2 by default); the close-up's radius is `radius × scale`.
- **What it draws** (decision 12): a ring round the area and one round the
  close-up, in the annotation pen (a circle's), a line between them along
  their centres from rim to rim, as Triceratops 73 draws it; inside the
  close-up, the page's white, then the picture painted again at `scale` × its
  size — its pens at their pt widths, so its lines keep their weight ("render
  at larger mm") — and the step's other marks enlarged with it (never
  another close-up), all clipped to the ring.
- **Painting the inside** needs the picture, so each surface paints it, at
  `scale` × the size it draws the picture at:
  - the canvas: an `<image>` of the picture painted larger, clipped in the
    overlay (cached by picture and scale; a move only shifts it);
  - a card: `annotatedPicture` gets a way to paint the source larger;
  - a page: `cellPicture` draws the source again at `scale` × the cell's mm
    per unit, its ids under a prefix of their own, its text counted for the
    fonts — and so the PDF and the step files, through the page markup (a
    clip path, which usvg resolves).
  - A captured scene and a References step are painted afresh, so lines,
    letters and arrowheads keep their size. An uploaded SVG is drawn larger,
    its own strokes with it; a bitmap's pixels are enlarged.
- **Placing.** Drag out the area — press at its centre, drag its radius; on
  release the close-up appears at ×2 beside it, on the side with more room
  off the picture. Drag either circle by its inside to move it, by its rim to
  resize it: the area's rim its radius, the close-up's its scale (Shift: to
  halves). Step pane: Scale (×1.5, ×2, ×3, ×4, and the exact value).
- **Room on the page.** Its rings and line are its reach (`annotationReach`),
  so the page leaves room for a close-up beside the picture, as for an arrow
  that starts off it.
- **Carry.** `from` goes with the face under it, as a callout's point does;
  the close-up keeps its place beside it, turned and mirrored with the
  picture, as a callout's box does (`PictureMove.vector`); radius and scale
  stay.
- **Hit:** either ring and its inside, and the line; grips: each centre (to
  move it) and each rim (a new grip part).
- **Pose** ghosts annotations over the picture being posed: a close-up there
  shows its rings only, as its inside would show the picture before the
  pose.
- Analytics: `tool: close_up`.

### Every phase

Reader and writer, with round trips and "an older build keeps it verbatim"
(a new kind or field is a newer build's to an older one); `cleanAnnotation`;
carry; hit and grips; the canvas; the Step pane; the tool window; the rail,
keys and shortcut labels; analytics with `docs/analytics.md`; i18n in all nine
catalogs; unit and canvas tests, each failing before its change; a golden for
each new primitive; before and after in the browser (light and dark,
desktop Chromium and iPad-sized WebKit) beside the screenshot it answers; a
review of the phase by me; then the gate (lint, typecheck, i18n check, the
whole vitest suite) and a push.

## Affected Areas

`diagram/annotate/*` (new: `angleBisector.ts`, `behindFlaps.ts`);
`diagram/document/diagramDocument.ts`, `diagramFile.ts`;
`components/diagram/DiagramAnnotate*`, `DiagramStepAnnotations.tsx`,
`DiagramWhiteArrowControls.tsx`, new Step pane rows for line type, kinks,
behind and scale; `cp-workspace/references/stepDiagramGeometry.ts`,
`referenceFinderDiagramToPrimitives.ts`, `diagram/DiagramPrimitives.tsx`,
`diagram/markReach.ts`, the glyph golden; `diagram/annotate/paintAnnotations.ts`,
`diagram/pages/pagePictures.ts`, `diagram/export/stepFiles.ts`,
`diagram/pictures/paintDiagramStep.ts` (painting at a scale);
`store/settingsStore.ts`, `lib/storage.ts`, `store/workspaceStore/types.ts`,
`slices/diagramSlice.ts`; `keyboard/shortcuts.ts`, `i18n/shortcutLabels.ts`,
`diagram/useDiagramShortcuts.ts`; `analytics/events.ts`, `docs/analytics.md`;
`public/locales/*`.

## Decisions (for Zach)

1. **What "behind" means.** Recommended: each end can be behind; from that
   end the mark is dotted until it comes out from under the flap at that end
   and whatever lies over it, then drawn as ever — so a crimp arrow that
   starts behind and crosses back over in front reads right. Or: pick a flap
   by clicking it, and the whole mark is dotted wherever it lies under that
   flap (simpler, but the crimp arrow's front stretch goes dotted too); or:
   dotted wherever the mark lies over the paper at all (no layers; an arrow
   coming out from under the top flap onto a lower one stays dotted).
2. **A head at an end that is behind:** solid, as the Triceratops close-up's
   dotted arrow has — recommended — or drawn dotted as an outline.
3. **The dots:** as a hidden line's, in the mark's own pen — recommended —
   or dashed (which reads as a valley fold).
4. **Behind on a picture with no layers** (a crease pattern, a References
   step, 3D, an upload): not offered — recommended — or a manual "dotted
   from here" on any picture.
5. **The line type control:** on the rail, heading the Lines group, its
   options drawn as short strokes in their dashes — recommended — or Edit's
   letters (V, M, H).
6. **Changing a line's type:** a Type row in the Step pane for the selected
   line — recommended — or the rail's control retyping the selection.
7. **Keys:** Shift+V, Shift+M and H set the type (and pick Line unless a line
   tool is in hand); B is Angle Bisector, as in Edit; Z Pleat Arrow; S Solid
   Arrow; I Close-Up.
8. **The bisector's equal-angle mark** (step 125's arc and ticks): drawn with
   every bisector as its own selectable mark, and offered alone in Marks —
   recommended — or an option off by default, or not at all.
9. **Where a bisector ends:** on the line pressed, as in Edit, and where the
   press is when it is on no line — recommended, an addition for uploads,
   which have no lines — or only on a line, as in Edit.
10. **Pleat arrow:** a lightning bolt (step 129's and 92's) — recommended — or
    an even zig-zag either side of a straight line; two Zs by default (step
    92), or one (step 129).
11. **What the solid arrow is:** the white arrow with a Fill, and a Solid
    Arrow tool that lays it Narrow, Square and Black — recommended, one arrow
    to shape and size, no fill being today's white arrow — or a new kind of
    its own; or a fill and a tail on the push arrow (which stays straight).
12. **Close-up:** one line between the circles along their centres, as
    Triceratops 73 — recommended — or two lines tangent to both (a cone), or
    none; the ×2 default; rings in the annotation pen.
13. **Where this goes:** on this branch and PR #436, as the Diagram is not on
    main yet — recommended — or a new branch after #436 merges.
14. **Order:** 15a line type → 15b bisector → 15c pleat → 15d solid → 15e
    behind → 15f close-ups: the small and contained first, the two that touch
    the painter last. Or the order that matters most to the diagram you are
    drawing now.

## Checklist

### 15a. Line type and the Line tool
- [ ] Tool ids: one record per tool (group, key, name, help, modifiers,
  glyph, what it draws for a line type); the rail, keys, tool window,
  canvas and analytics read it. Kinds and the file unchanged.
- [ ] The line type preference (Valley default, persisted); the rail's
  control heading Lines; Line and Angle Bisector's slots (the bisector greyed
  until 15b).
- [ ] Keys: Shift+V, Shift+M, H set the type (and pick Line); labels.
- [ ] Step pane: a selected line's Type, one undo step.
- [ ] Tests (tools record, keys, the rail, a line drawn in each type, Type
  retyping), i18n, before/after.

### 15b. Angle Bisector
- [ ] `angleBisector.ts`: three points, two lines, parallel lines, the
  destination; refusals; tests mirroring the kernel's.
- [ ] The canvas's pick sequence, previews, Escape; the tool window's steps.
- [ ] `angle-mark`: kind, file, carry, hit, primitive, golden, Step pane
  (Ticks), alone in Marks.
- [ ] One undo step for line and mark; analytics; i18n; before/after beside
  step 125.

### 15c. Pleat arrows
- [ ] `pleat-arrow`: kind, file, carry (mirror), primitive and golden, reach,
  hit; the canvas; Step pane (Kinks, Flip); analytics; i18n; before/after
  beside steps 92 and 129.

### 15d. Solid arrows
- [ ] White arrow `fill`; reader/writer; drawn filled; Step pane Fill; the
  Solid Arrow tool's preset; the list's name by look; analytics; i18n;
  before/after beside step 129.

### 15e. Behind flaps
- [ ] `behindFlaps.ts`: faces at a point, over them, the stretches under
  them; edge cases (an end on an edge, woven patches, a spread face); tests
  on real folds (the crane's, Oriedita's sample).
- [ ] `annotationDrawing` takes the layers from every caller; arrows' `hidden`
  stretches drawn dotted; lines split; circles in arcs; one dash phase.
- [ ] `behind` in the model, file, clean; Step pane; the canvas preview;
  analytics; i18n; before/after on the crane, a tail under a flap.

### 15f. Close-ups
- [ ] `close-up`: kind, file, carry (as a callout), hit and rim grips, reach.
- [ ] Painting at a scale for each surface: canvas, card, page (ids, fonts),
  step files and PDF; uploads.
- [ ] Placing and resizing on the canvas; Step pane Scale; Pose shows rings
  only; analytics; i18n; before/after beside Triceratops 73, on screen and
  in the PDF.

## Risks

1. **Behind, at the edges of the picture's knowledge.** Inside woven flaps
   the stored scene is patched, not ordered, so "over" can be wrong there;
   an end exactly on a fold edge must be read inside the right face.
2. **The tool refactor** touches every tool site at once; it lands first, on
   its own, with nothing visible changing but the line control.
3. **Close-ups paint the picture twice** — on the canvas a large flat fold
   costs a second paint per scale (cached), and on a page its ids and text
   must not collide with the first copy's. krilla's clip paths are to be
   checked against a real PDF early in 15f.
4. **The bisector's math** is Oriedita's, ported a second time (TS beside the
   kernel's Rust); its tests mirror the kernel's to keep the two alike.
5. **Every phase adds to the file format** (kinds `angle-mark`,
   `pleat-arrow`, `close-up`; fields `other`, `ticks`, `kinks`, `mirrored`,
   `fill`, `behind`, `radius`, `scale`): each read by the newer-build rule,
   so an older build keeps them verbatim and does not draw them.
