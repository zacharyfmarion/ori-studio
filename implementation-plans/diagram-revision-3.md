# Diagram, Revision 3: stars, shapes, short divisions, an eye, X-ray

**Status: planned 2026-10-08, with Zach's first answers the same day.
18a (equal divisions) built and gated 2026-10-08, committed and pushed
(PR #446). 18b (stars, the transform box, and 18a's follow-up hint)
built, gated and committed 2026-10-08, not yet pushed (18b, As
built). 18c (the eye) built, reviewed, gated and committed 2026-10-08,
not yet pushed (18c, As built). 18a–18d pushed (PR #446). 18d (shapes, and 18c's follow-ups)
built, reviewed, gated and committed 2026-10-08 (18d, As built), and its two follow-ups (a
finger's handles on the transform box, and the turn's rounding) the same day (Follow-ups to 18d).
18.0 (the X-ray spike) run 2026-10-08 on `claude/diagram-xray`: go, with three changes to what
18e builds (18.0 results). 18e (X-ray: model, canvas, tool and Layers) built 2026-10-08 on
`claude/diagram-xray`, reviewed, its findings fixed, gated and committed 2026-10-09 (18e, As
built). 18f (X-ray on every other surface, and three of 18e's follow-ups) built 2026-10-09 on
`claude/diagram-xray`, reviewed, its findings fixed, gated and committed the same day, not yet pushed (18f, As
built). 18g (X-ray peels the window: R3-34 A replaces R3-13 A) built and gated 2026-10-09 on
`claude/diagram-xray` (`implementation-plans/diagram-xray-peel.md`).** His answers, each recorded under its decision:

- **R3-1 A, R3-2 A** (short dividers: one switch on each mark, 1.65 mm
  either side of the line): "should just be all interior ones, not per
  mark", "yep"; asked to confirm one switch on each mark that shortens all
  its interior dividers, "a".
- **R3-3 B** (the count's weight), on "the division count's number stays
  bold": "no, should not be bold".
- **R3-4 C, R3-5 A** (one Star tool with a Fill control; an outlined star
  white inside): "yep, for now".
- **The transform box** (The transform box, below): "for shapes, i want to
  be able to rotate and scale them. This goes for stars too (not lines /
  arrows / stuff that is path based). ui should be like the UI when you
  select an image in the edit canvas." It supersedes R3-6a, R3-6b, R3-9a
  and R3-11c.
- **R3-7 A, R3-9b A, and the transform box on the eye**: "yes".
- **R3-10a A** (ovals and rectangles now, polygons and freehand later):
  "yes".
- **R3-12 A, R3-13 A, R3-14 A, R3-15a A, R3-15b (ii), R3-16b A, R3-27 B**
  (X-ray): "sounds good".
- **R3-25 A** (rail groups and keys): "sure. Im probably going to do a
  shortcut pass before merge, those are fine for now".
- **R3-26 A** (the pens): "yeah sounds right".
- **The prototype**: "Yes skip prototype, build directly".
- **Everything 18b uses** (2026-10-08): "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Built as recommended,
  each recorded DECIDED under its decision: R3-23 A (no colour on the new
  marks), R3-24 A (a star snaps as a Circle does), R3-28 A (a free turn,
  Shift for 15°), R3-29a A (proportions always kept, corners only),
  R3-29b A (scaled about the centre), R3-30a A (0.5× to 4×), R3-30c B (the
  box at least 24 screen px), R3-32 A (a carry keeps a star's angle) and
  R3-33 A (a Rotation row in Layers); and 18a's two follow-ups (18a, For
  Zach): a hint that Short Dividers shows only once the line is more than
  1.65 mm out, and the count kept in the regular weight.
- **Everything 18c uses** (2026-10-08), under the same instruction: R3-8 A
  (the eye laid by a drag from the viewer toward what they look at, Shift
  for 15° steps, a click looking at the picture's middle), recorded
  DECIDED under it.
- **Everything 18d uses** (2026-10-08), under the same instruction: R3-10b
  A (separate Oval and Rectangle tools), R3-11a A (no fill), R3-11b A
  (square corners), R3-11d B (painted under every line and mark), R3-29c A
  (a free resize, Shift keeping the proportions, Alt about the centre),
  R3-30b A (the enlarge area's sides' range) and R3-31 A (a press inside a
  selected shape moves it unless a mark is under it), each recorded DECIDED
  under it; and 18c's two questions for Zach (18c, For Zach), settled the
  same way: the eye draws in the ring pen (0.5625 pt in the Diagram preset),
  not the aux pen, to match his sketch — an amendment to R3-26's
  application, recorded under R3-26 — and F on an eye is Flip Horizontal
  (mirrored across, so it stays as upright as it was and looks the other
  way), not a half turn, recorded under R3-9b.
- **18d's two follow-ups** (2026-10-08), under the same instruction: a
  finger's transform-box handles a touch target apart, with targets, on
  both canvases; and one rule for keeping a turn. Recorded under
  Follow-ups to 18d.

- **Everything 18e uses** (2026-10-08), under the same instruction:
  R3-16c A, R3-17 B, R3-18a A, R3-18b A, R3-19 A, R3-20 B, R3-21 A and
  R3-22 B, each recorded DECIDED under it; and R3-16a amended to A after
  18.0, on its evidence: each face's side is worked out from its outline,
  not stored (R3-16a, with the numbers).
- **18e's follow-ups** (2026-10-09), under the same instruction, built in
  18f: the X-Ray tool's icon a ring with rows of the Hidden Line's short
  dashes inside (the ring round an M read as the Mountain tool); the
  x-ray's Anchor row named "Point" in its own key (Enlarge's "Anchor" is
  "anchor face" in Japanese, Chinese and Korean), with its own picking
  hint; and on a touch device the Settings sheet steps aside while a pick
  armed from it is made on the canvas, and comes back when it ends —
  Enlarge's pick too. Recorded under 18e's For Zach, (3) to (5). 18f's
  review, the same way: the sheet comes back only when the pick ends where
  it was made; a bar on the canvas says what a touch pick waits for, with
  Cancel; the icon's dashes longer and staggered; the reset hint "Count the
  layers at the window's centre again" (18f, As built).

**R3-37 resolved, 2026-10-10:** A, the recommendation already built,
under Zach's instruction to resolve routine launch choices. R3-25's current
keymap is accepted for launch, with action ids unchanged. The linked-fold
Turn Over carry fork and X-ray contrast still need his visual review; see
`diagram-launch-hardening.md`.


Phase 18 of `implementation-plans/diagram-workspace.md`, after Phase 17
(`implementation-plans/diagram-references-annotations.md`). It is built on
`claude/diagram-revision-3`, stacked on #436
(`claude/diagram-workspace-plan-ceb4f2`), cut at 568e02a60, which already
has #442 (References marks) merged. X-ray comes in a second PR, stacked on
this one (R3-27 B). It is built by hand, phase by phase, as Revision 2 was.
Paths are under `apps/web/src/` unless they say otherwise. Line numbers are
at 568e02a60.

**Files outside the repository.**

- **Zach's crane** is `~/Documents/open source/origami-designer/test_files/diagrams/crane.osf`,
  the copy Revision 2's scripts open (`artifacts/revision-2/spike/common.mjs:14`).
  Zach still edits it: it was 2.49 MB at 16c and is 2.81 MB now. 18.0 copies
  it into `artifacts/revision-3/crane.osf`, and every comparison in this plan
  ("the crane") is against that copy. His heart, chipmunk and Reference
  Diagrams sit in the same folder.
- **Artifacts** are gitignored. This plan's go in `artifacts/revision-3/` of
  this worktree (`.claude/worktrees/diagram-revision-3/`). Revision 2's,
  whose scripts 18.0 reuses (`spike/common.mjs`, `16c/paperFacesBudget.mjs`),
  are in #436's worktree,
  `.claude/worktrees/diagram-workspace-plan-ceb4f2/artifacts/revision-2/`;
  this worktree has no copy.

The decisions, as things to try: the prototype
(`artifacts/revision-3/revision-3-marks.html`) is skipped. Zach: "Yes skip
prototype, build directly". What is left to judge by eye is judged in each
phase's before and after in the browser. The X-ray spike's renders (18.0)
of Zach's crane still go in `artifacts/revision-3/xray-spike/`, for him.

**How the text reads.** As in Revision 2. The parts are written as they
would be built under the options Zach chose, and under the recommended
ones where he has not answered. Where the text depends on a decision, it
names it, as "(R3-4 C)", and that decision says what another option would
change.

## Goal

Zach's Diagramming note (`Oristudio/Diagramming.md` in his notes), section
"Revison 3", read on 2026-10-08. Quoted as written, with the pictures
between the lines left out:

> I want to be able to draw stars, either outlines or filled in
>
> * I want the ability to create arbitrary shapes (rectangle, circle). Example of a diagram using ovals:
>
> * For equal lengths, there should be an option to not draw lines for the interior segments that show the divisons, and just have them be dashes instead of being drawn all the way down the the source line. Somtimes having them drawn interfers with actually showing the crease, as in this case:
>
> * Also for equal lengths, everything should be drawn in the width of the aux crease, its too thick rn
>
> * I want to be able to add an X-ray view, which allows for showing layers underneath the top layer. You specify the number of layers you want to drill into and it shows the result.
>
> I want to be able to draw a stylized eye

His pictures, measured:

- **Star** (`Diagramming-1791483020299`, step 12 of a Japanese-style
  diagram). A small solid five-pointed star sits on a crease, where the
  crease from the top corner passes through its centre. A dashed line runs
  right from it. It has no ring and no halo, and it covers the crease under
  it. It is about the size of an arrowhead.
- **Ovals** (`Diagramming-1791481514199`, "Turtle" step 41, captioned
  "Repeat 36-40 on the other five areas."). Five upright ellipses, about
  0.75 wide to 1 high, ring the five areas still to fold. They are black
  outlines with nothing inside, about the edges' weight, and lie over the
  creases with no knockout. The area already folded is not ringed.
- **Equal divisions** (`Diagramming-1791481939064`, Zach's own canvas, the
  mark selected). A diagonal in three parts, its dimension line set well
  off it into the paper. The first interior divider runs from the diagonal
  along the dashed valley line it locates, and draws over it. The dividers
  and ticks are visibly heavier than the dimension line.
- **X-ray** (`Diagramming-1791483201873`, a folded model). The caption is
  cut off, but a fragment shows, "...and closed sinks can be indicated by",
  so this is a convention for a closed sink. A circle is cut into the front
  flap. Inside it the front layer is gone, and a strip of the paper's other
  colour shows, with the sunk layers' lines in an M down it and a line down
  its middle. At this size those lines could be edges or creases. The rim
  is the edges' weight or a little more. Nothing removed is drawn dotted.
- **Eye** (`Diagramming-1791483257858`). A profile eye: two straight lids
  meeting at a point on the right, a cornea arc closing the open left side,
  a small iris arc inside it. Thin lines, outline only. It looks left.

So:

1. **Equal divisions** (a fix and an option). Every stroke in the aux
   crease's width. And a switch that draws the interior dividers as short
   strokes across the dimension line, not down to the measured line.
2. **Stars**, filled or outlined, on a point.
3. **The eye**, placed and turned to say where the next view is from.
4. **Shapes**: ovals and rectangles round an area (R3-10a A: no other shape
   yet).
5. **X-ray**: a window that shows the picture without its top N layers.
6. **The transform box**: stars, the eye and shapes, once selected, are
   scaled and turned by handles, as an image is on the Edit canvas.

Revision 2's "Before merging" and "Sidelined" sections are not part of
this plan. Neither is the "Repeat symbols" item in the workspace plan's
Later list. The turtle's ovals are a use of a plain shape; a repeat symbol
with a count and a link to the steps it repeats is its own feature.

## Approach

### Common ground

- **Pens.** The Diagram preset (`lib/paper/paperPresets.ts:49-59`) draws
  edges at 0.5 pt, aux creases at 0.25 pt and arrows at 0.75 pt, all in
  #231f20. The ring pen (`markRingWidth`, `labelLayout.ts:130`) is ¾ of the
  arrow pen, 0.5625 pt. It draws a Circle, a close-up's ring, an enlarge
  area's outline and a callout's line. The edges' pen draws an enlarged
  step's cut (`zoomEdgePen`, `zoom/paintZoomed.ts:131`). The Default preset
  has 0.5 pt grey aux creases, 1.05 pt arrows and a 0.7875 pt ring
  (`lib/paper/paperStyle.ts:177-181`). Since Zach's ink review of 16a
  (2026-10-06), the right angle draws in the aux pen's width and the marks'
  ink (`rightAnglePen`,
  `cp-workspace/references/stepDiagramGeometry.ts:2601`). 1 ink is
  0.331 mm (`ANNOTATION_INK_MM`). Which pen each new mark takes is one
  rule, R3-26.
- **Kinds.** Five new kinds: `star`, `eye`, `oval`, `rectangle` and
  `x-ray`, and three new shape classes in `ANNOTATION_SHAPES`
  (`diagram/annotate/annotationModel.ts:91`): `sight` (the eye), `area`
  (oval and rectangle) and `x-ray`. A star is a `point`. Each kind is a
  compile error at every exhaustive switch until it says what it does: the
  kind union (`diagram/document/diagramDocument.ts:607`),
  `ANNOTATION_SHAPES`, `ANNOTATION_FIELDS`
  (`diagram/document/diagramFile.ts:1062`), the writer, `flipsOver`,
  `kindFromOtherSide`, the rail's records (`annotateTools.ts:170`, `:208`)
  and the analytics record (`annotationEventKind.ts`).
- **Kinds the compiler does not check.** These places test the kind by
  hand, so a new kind falls through them silently. Each gets a test that
  fails before its change:
  - `markExtent` (`diagram/zoom/stepView.ts:166`) decides which marks an
    enlarged step's window holds and which are badged. It knows a
    close-up's rings, an enlarge area's outline and a `radius`; anything
    else is its points. A shape, an x-ray, a star or an eye has `from` and
    `to` on its centre, so one reaching into a window from outside could be
    dropped or badged wrongly. Shapes and x-rays give it their outline's
    box, and a star or an eye its turned box at its scale.
  - `readAnnotationOfKind` (`diagramFile.ts:1156`):
    `isPointKind(kind) || kind === 'zoom'` decides whether `to` is read
    from the file or set to `from`. A star is a point kind. Shapes, the eye
    and x-rays join `zoom` here.
  - `placedByClick` (`annotationModel.ts:1293`) puts a standard size down
    on a click for `shape === 'zoom'` only. `area` and `x-ray` join it.
  - `applyAnnotationEdit` (`diagram/annotate/applyAnnotationEdit.ts:36`,
    `:55`) counts deleted enlarge areas, by `kind === 'zoom'`, for
    `diagram enlargement changed`. It stays `zoom` only: deleting a shape or
    an x-ray is not an enlargement event.
  - The anchor's plumbing is `zoom` only: `useAnchorPick.ts:58` and `:66`,
    and the canvas's area drag (`useAnnotateCanvas.ts:1380-1394`), with its
    undo label "Change enlarge area" and its event. X-ray, Layers, says what
    changes.
  - The hit order (`annotationHit.ts:839-845`): its `under` set and its
    `drawn` list are filtered by kind.
  - The grips' moves. The `corner` grip's move runs the right angle's
    `opening()` (`useAnnotateCanvas.ts:971-974`), and the `direction`
    grip's placement searches for a right angle's openings when the kind
    snaps (`:717-720`). The eye uses neither: it takes the transform box
    (The transform box).
- **Glyphs and areas.** A star and an eye are glyphs drawn at a print
  size, times their own `scale`, turned by their own `angle` (The transform
  box). They become shared References primitives (a `mark`), as the right
  angle and
  equal divisions are: the type in `referenceFinderDiagramToPrimitives.ts`,
  the drawing in `diagram/DiagramPrimitives.tsx`, the reach in
  `diagram/markReach.ts` (whose `never` default forces it),
  `fold/foldSymbolFade.ts` and `referenceFinderStepInModel.ts`, all under
  `cp-workspace/references/`. References never emits them, so its parity is
  untouched. Both are drawn as paths, never as a ★ character, so a PDF does
  not depend on a font having the glyph. Ovals, rectangles and x-ray
  windows are areas. They are kept in lists of their own in
  `AnnotationDrawing` (`annotationPrimitives.tsx:659`): shapes painted where
  R3-11d puts them, an x-ray's rim with the enlarge areas' outlines.
  Shapes reuse the enlarge area's corner-to-corner drag
  (`zoomAreaFromCorners`, `zoomModel.ts:180`) and its carry (`carryZoom`,
  `annotationModel.ts:1714`); selected, they take the transform box, not
  the enlarge area's grips. An x-ray window takes those grips
  (`diagram/zoom/zoomGrips.ts`). They do not reuse the
  `zoom` kind or `DiagramZoomShape`: Enlarge's Shape row offers that union
  (`components/diagram/DiagramZoomControls.tsx:44`).
- **The file.** New kinds and fields follow the newer-build rule
  (`diagramFile.ts:1062-1086`, `:1153`). A build before Revision 3 keeps
  them verbatim and does not draw them. A divisions mark with the new field
  becomes, whole, a newer build's mark there. `DIAGRAM_FORMAT_VERSION`
  stays 1; the Diagram is unreleased (#436 is open). After every phase, the
  crane loads with every mark known and saves back byte-identical.
- **Every surface.** Marks are painted through `annotationMarks`
  (`annotationPrimitives.tsx:1055`) and `paintAnnotations.ts`, so they reach
  every surface that draws a step's marks:
  - the Annotate canvas;
  - the step cards (`annotatedStepUrl`,
    `pictures/useStepPictureUrl.ts:198-213`), and an enlarged step's card
    (`zoomedCardPicture`, `zoom/paintZoomed.ts:300`);
  - Pose's ghost of the marks: the card at `POSE_ANNOTATION_OPACITY`
    (`components/diagram/DiagramStepDetail.tsx:171-172`; under an opacity
    below 1 nothing is painted inside a close-up, only its ring), and the
    live 3D and simulated ghosts (`poseGhostMarkup`,
    `zoom/paintZoomed.ts:503`, in `DiagramPose3dView.tsx:130` and
    `DiagramPoseSimulatedView.tsx:82`);
  - the pages, through `cellPicture` (`pages/pagePictures.ts:511`) inside
    `composeDiagramPage`: the page view, print, the PDF
    (`export/diagramPdf.ts`) and the one-sheet SVG
    (`export/diagramSheet.ts`);
  - the ZIP's step files (`export/stepFiles.ts`), through `cellPicture`,
    cropped by `annotationReach`.

  A star, an eye or a shape is on all of them by being a mark. An x-ray's
  inside is painted by each surface's own painter, as a close-up's is
  (X-ray, Surfaces). `annotationReach` (`annotationPrimitives.tsx:849`) is
  what Fit each and step files crop by. The compiler does not check it for a
  list of its own, so shapes and x-rays each get a reach test.
- **Analytics.** `diagram annotation added` gains the tools `star`, `eye`,
  `oval`, `rectangle` and `x_ray` (`analytics/events.ts:77`,
  `docs/analytics.md:347`). A star also sends `fill`. One new event,
  `diagram mark styled` (`kind`, `option`, `value`), counts the new
  per-mark options changed in Layers: Short Dividers, a star's Fill, an
  x-ray's Depth and Anchor; and a resize or a turn by the transform box, or
  a Rotation row typed. Enums and buckets only, never a place, a size or an
  angle.
  An x-ray's edits never send `diagram enlargement changed`.
- **i18n.** Tool names in `tools:diagram.*`, help in
  `panels:diagram.annotate.*`, rows in `panels:diagram.annotations.*`.
  English is extracted, eight locales translated, stamped and checked. A
  count in a sentence is a `{{count}}` plural key: `_one` and `_other`, and
  Russian's `_few` and `_many`, in all nine catalogs.
- **Decisions** are numbered R3-1 to R3-33 and grouped by part, the shared
  ones last, then the transform box's (R3-28 to R3-33, added with Zach's
  first answers). A decision that held several choices is split into
  lettered parts (R3-11a to R3-11d), so each pick is one line. Each says
  whether it is DECIDED, PENDING or SUPERSEDED.

### Order

- **18.0, the X-ray spike** (nothing merges). It runs first, or alongside
  18a, so Zach decides X-ray on renders of his own crane.
- **Before 18a**: Zach's answers. The prototype is skipped ("Yes skip
  prototype, build directly").
- **18a, equal divisions.** The aux-pen commit needs no decision. Short
  Dividers needed only R3-3, the count's weight: regular, not bold (R3-3
  B).
- **18b, stars**, then **18c, the eye**: both glyphs on the same path, the
  star first. 18b's first commits build the transform box, which the eye
  and shapes then use.
- **18d, shapes**: new outline geometry on the enlarge area's machinery,
  selected through the transform box.
- **18e, X-ray: model, canvas, tool and Layers**, then **18f, X-ray on every
  other surface**: last, and only if 18.0 passes. If it fails, X-ray leaves
  this plan for one of its own, and the rest lands without it. They are a
  second PR, on `claude/diagram-xray`, stacked on this one (R3-27 B).

The phases share `annotateTools.ts`, `annotationHit.ts`,
`annotationPrimitives.tsx`, `DiagramAnnotateCanvas.tsx`,
`DiagramAnnotateToolGlyph.tsx`, `diagramFile.ts` and the catalogs, so they
land one at a time, each rebased on the last.

### The transform box: stars, the eye and shapes

Zach, 2026-10-08: "for shapes, i want to be able to rotate and scale them.
This goes for stars too (not lines / arrows / stuff that is path based). ui
should be like the UI when you select an image in the edit canvas." Asked
whether the eye takes it too: "yes".

So a selected star, eye, oval or rectangle shows a box with handles that
scale and turn it. Every other mark keeps its grips: the lines, the arrows,
the signs, labels and callouts, the Circle and the measuring marks; and
enlarge areas, enlarged steps' frames, close-ups and x-ray windows, which a
turn would not change.

**The Edit canvas's box, at 568e02a60.** A reference image, a text box, a
suppression region and a folded figure all go through one overlay,
`cp-workspace/CanvasObjectOverlay.tsx`, an SVG over the WebGL canvas. It
knows each only as a `TransformableCanvasObject`
(`cp-workspace/canvasObjects/transformableObject.ts:23-59`): a turned box,
the space it is in, `locked`, `hidden`, an aspect policy, and whether a
crease under it outranks it. The math is pure and has no camera in it
(`cp-workspace/annotations/annotationTransform.ts`). A selected image
shows, and does:

- **The box**: a 1.5 px outline in `--accent-primary` along the turned box
  (`CanvasObjectOverlay.tsx:756-786`).
- **Scale handles**: 8 px squares, filled `--bg-primary` and stroked in the
  accent (`HANDLE_SIZE_PX`, `:64`; drawn at `:935-955`), at the four
  corners and the four edges' middles; corners only for an object that
  always keeps its proportions (`:891-897`). A drag holds the opposite
  corner or edge (`resizeAnnotationBox`, `annotationTransform.ts:146-207`).
  There is no Alt.
- **Turn handles**: a round handle, 5 px in radius, 18 px out from each
  corner along the line from the centre, "Affinity-style"
  (`ROTATE_OFFSET_PX`, `:62`; drawn at `:899-934`). The turn follows the
  pointer's angle about the centre from where it took hold (`:492-518`,
  `:621-625`). Crop mode hides them.
- **Keys held**: Shift holds a turn to 15° steps
  (`IMAGE_ROTATION_SNAP_RADIANS`, `cp-workspace/images/cpImage.ts:40`;
  `snapAngle`, `annotationTransform.ts:235`). On a resize, Shift flips the
  aspect by the object's policy (`resizeAspectLock`, `:220-232`;
  `annotationAspectLockPolicy`, `cp-workspace/annotations/annotation.ts:73-82`):
  an image keeps its proportions and Shift frees them (`default-on`); a
  text box is free and Shift keeps them (`default-off`); a folded figure
  always keeps them (`always`, `transformableObject.ts:151`). On a touch
  device the rail's Shift latch stands in for the key
  (`cp-workspace/touchModifiers/shiftLatch.ts`, read at `:616` and `:624`).
- **The body**: a press anywhere inside the box selects it on the press and
  drags it (`:409-457`); under 1 px is not a move (`:593`). A crease drawn
  over an image or a text box outranks its body (`yieldsPressToCreases`,
  `surfaceClaiming`, `:142-151`); a handle is never outranked
  (`:157-165`). A secondary press only selects, for the context menu
  (`:434-438`).
- **Cursors**: `move` on the body; the canvas's own cursor where a crease
  would take the press, asked once a frame (`:531-558`); `grab` everywhere
  while a pan is armed (`:777-784`); `pointer` on a scale handle (`:947`);
  `grab` on a turn handle (`:927`).
- **Undo**: the bracket opens on the first move, not the press, so a click
  records nothing (`:575-587`); one step per gesture, by kind (`:647-660`).
  A pinch that takes over puts the box and the selection back (`:685-704`).
- **Keys pressed**: Escape leaves crop mode, else deselects (`:370-390`).
  Delete is `viewport.delete` (`keyboard/shortcuts.ts:783`). There are no
  arrow-key nudges for an object: the canvas's arrows step through
  fold-angle solutions (`:778-781`).
- **An image only**: a double-click toggles crop mode, the box dashed amber
  (`:810-820`).
- **Properties**: Opacity, and Rotation in degrees
  (`cp-workspace/images/imageProperties.ts:56-67`). Width and height wait
  "on settled units" (`:14-17`).

**The Diagram canvas today.** One handler on the stage takes every press
(`useAnnotateCanvas.ts:798-805`) and asks `hitAnnotation`, in picture
units (`annotationHit.ts:793`), the selected mark's grips first
(`:800-829`). The grips are drawn, not pressed: inert circles inside
react-zoom-pan-pinch's transformed world, their size divided by the zoom
(`HANDLE_PX`, `components/diagram/DiagramAnnotateCanvas.tsx:65`; `.handle`,
`DiagramAnnotateCanvas.module.css:98-104`, `pointer-events: none`). A
grip's drag is `moved` (`useAnnotateCanvas.ts:938-995`), committed as one
undo step on release (`:1383-1393`). The stage's cursor is only default,
crosshair or grab (`DiagramAnnotateCanvas.module.css:28-40`).

**Why the overlay is not shared whole.** Three things tie it to the Edit
canvas:

1. **Its presses.** Each handle is a pointer target of its own, with
   capture, the crease pattern's touch arbiter (`cpSurfaceGestures`), its
   press registry (`cpSurfacePress`, `cpSurfacePanPress`) and the
   annotation layer's undo bracket (`claimSurfacePress`, `:180-209`). The
   Diagram's grips take no presses: one stage handler does, so the tool in
   hand, snapping, Edit Path and a pinch are decided in one place. Mounting
   the overlay there would split that.
2. **Its space.** It draws in CSS pixels through a `CpOverlayView` affine,
   outside any transform (`objectCornersCss`, `:211-217`). The Diagram
   draws its grips inside the camera's transformed world, in picture units
   times `layout.unit`.
3. **Its look.** Inline styles in the Edit canvas's accent. The Diagram's
   selection is its own module's `.selection` and `.handle`, in
   `--annotate-selection` (`DiagramAnnotateCanvas.module.css:11`), and a
   component never imports another's module.

**What is shared, so nothing is copied.** The smallest piece both canvases
need is pure:

- **The box math** moves out of
  `cp-workspace/annotations/annotationTransform.ts` into a new
  `lib/transformBox.ts`: `AnnotationBox` (as `TransformBox`), the handle
  names, `HANDLE_SIGNS`, `CORNER_RESIZE_HANDLES`, `MIN_BOX_EXTENT`,
  `boxCornersModel`, `resizeAnnotationBox`, `AspectLockPolicy`,
  `resizeAspectLock`, `snapAngle` and `boxContainsModelPoint`, with their
  tests. None of it touches the crease pattern; only the `CpOverlayView`
  projections above it do, and they stay. `annotationTransform.ts`
  re-exports what moved, so its 40 importers do not change. AGENTS.md puts
  code another surface reuses in `src/lib/`. `resizeAnnotationBox` gains
  one option, about the centre, which the Edit canvas does not pass
  (R3-29b A, R3-29c A).
- **The handle layout**, new in the same module: `transformHandles(box,
  aspectLock, rotateOffset)` gives each scale handle's and each turn
  handle's place. (As built it takes the box's four corners as a canvas
  draws them and `{ cornersOnly, rotateOffset }`: 18b, As built, says why.) It is the layout `SelectionHandles` works out inline
  today (`CanvasObjectOverlay.tsx:877-909`), and `SelectionHandles` draws
  from it in the same commit, so the two canvases cannot drift. The sizes
  move with it as named constants (8 px squares, 18 px out) with the 15°
  step, which `IMAGE_ROTATION_SNAP_RADIANS` then names.
- **Each canvas keeps its own chrome and its own presses**, built on those
  two pieces.

That commit changes nothing on the Edit canvas: its tests pass unchanged,
and a selected image's handles are compared in the browser before and
after.

**The model.** Path-based marks do not change.

- **A star** gains `angle?` (degrees clockwise, unsaid 0, one point up) and
  `scale?` (times its print size, unsaid 1). Its angle is its turn on the
  page, and no carry turns it (R3-32 A).
- **The eye** gains the same two. Its `angle` is the way it looks, in
  degrees clockwise from looking right, unsaid 0. It replaces `to` as the
  eye's direction: `to` is written as `from`, and `EYE_REACH`, `eyeGrips`
  and the `look` grip part are gone. Every mark with a box then has one
  shape: a centre, an angle, and a scale or a size.
- **An oval or a rectangle** keeps `size: [w, h]`, its box in picture
  units, and `angle?`, now written by a turn as well as by a carry, within
  [0, 180) (`rectangleAngle`, `annotationModel.ts:1649`).
- One adapter, `transformBoxOf(annotation)` in a new
  `diagram/annotate/transformGrips.ts`, gives each its box in picture
  units: a shape's `size` about `from`; a glyph's drawn extent at its
  `scale`, in ink units times `INK_UNITS`. It is a switch over the four
  kinds, so a fifth has to say. It is the Diagram's
  `annotationAsTransformable` (`transformableObject.ts:71-97`).

**The file.** `ANNOTATION_FIELDS.star` = `fill`, `angle`, `scale`; `.eye` =
`angle`, `scale`; `.oval` and `.rectangle` = `size`, `angle`. An `angle` is
read as an enlarge area's (`readZoomArea`, `diagramFile.ts:1467`): any
finite number, normalized (a star's and an eye's to [0, 360), as
`normalizeDegrees` does, `:948`; a shape's by `rectangleAngle`); one that
does not read is dropped alone. A `scale` is read as a close-up's
(`readCloseUpScale`, `:1453`): a positive number; past R3-30a's range, a
newer build's, so the mark is kept verbatim and not drawn; anything else,
damage. A shape's `size` past R3-30b's range is a newer build's in the
same way (`readZoomSize`, `:1500`). A build before Revision 3 keeps all
four kinds verbatim already, as kinds it does not know.

**On the canvas.**

- **Drawn**: the box's outline in the selection's ink at 1.5 screen px;
  scale squares at the corners and the edges' middles, corners only for a
  star or an eye (R3-29a A); a round turn handle 18 screen px out from each
  corner. 8 px squares and 5 px circles, filled white and stroked as the
  Diagram's grips are, their sizes divided by the zoom (as `HANDLE_PX`). A
  new `TransformBoxSelection` in `DiagramAnnotateCanvas.tsx`, beside
  `ZoomOutlineSelection`, draws them from `transformHandles`, with two new
  rules in its own module. None on a diagram that cannot change
  (`movable`). Round a star or an eye the box is at least 24 screen px
  across, about its centre (R3-30c B).
- **Pressed**: `hitAnnotation`'s branch for the selected mark
  (`annotationHit.ts:800-829`) asks `transformGripAt` first. It answers a
  new grip part, `{ part: 'transform'; handle: TransformHandle }`: a scale
  handle, or a corner's turn handle. The squares' 8 px and the turn
  handles' 18 px become picture units by the factor `hitSizes` already
  uses (`useAnnotateCanvas.ts:548-552`). Then the body: the glyph itself;
  or, for a selected shape, anywhere in its box, behind every mark
  (R3-31 A).
- **Dragged**: `moved` (`useAnnotateCanvas.ts:938-995`) gains `transform`.
  A scale handle runs `resizeAnnotationBox`, held to R3-30's range: a glyph
  about its centre (R3-29b A), so a star stays on the point it names, its
  new box setting `scale`; a shape with R3-29c A's keys. A turn handle
  follows the pointer's angle about the centre from where it took hold,
  Shift for 15° steps (R3-28 A). A body drag moves it, as now. One undo
  step each: "Move annotation", "Resize annotation" or "Rotate annotation"
  (the Edit canvas's own label, `cp-workspace/images/imageProperties.ts:26`).
- **Cursors**: over a selected box with Select in hand, the Edit canvas's:
  `move` on the body, `pointer` on a scale square, `grab` on a turn handle.
  `hover` (`useAnnotateCanvas.ts:1004`) asks `transformGripAt` and sets
  `data-transform-hover` on the view, read by rules in
  `DiagramAnnotateCanvas.module.css`. Space's `grab` wins, as an armed pan
  does on the Edit canvas.
- **Keys**: Escape and Delete as for any selection. No nudges: the Edit
  canvas has none for an object, and the Diagram's arrows step through the
  steps (`keyboard/shortcuts.ts:588-606`). Zach plans a shortcut pass
  before merge.
- **Layers**: a Rotation row for each of the four, in degrees, wrapped as
  an image's is (R3-33 A).
- **Analytics**: a resize or a turn by the box sends `diagram mark styled`
  (`option: size | rotation`, `value: handle`); a Rotation typed in Layers
  sends `option: rotation`, `value: field`.

### 1. Equal divisions: the aux pen and short dividers

#### The aux pen (the fix)

The note settles this one: "everything should be drawn in the width of the
aux crease". Today the dimension line is in the aux pen already. The
dividers and ticks are in the ring pen
(`DIAGRAM_DIVISIONS_INK.pens = { line: 'crease', marks: 'ring' }`,
`cp-workspace/references/diagram/diagramInk.ts:180`, ED9 B), and
Annotate's projector loads the style's aux pen as `crease`
(`annotationPrimitives.tsx:642-644`). So in the Diagram preset the dividers
and ticks are 0.5625 pt beside a 0.25 pt line. In the Default preset they
are 0.7875 pt beside 0.5 pt.

What changes, and nothing else:

- **Every stroke in the aux pen's width**: the line, the dividers and the
  ticks. `rightAnglePen`, which reads `project.pens.aux`, is renamed
  `auxMarkPen` and drawn by both marks. The line is drawn in `pens.crease`
  today. The two are one pen wherever a style gives an aux pen
  (`canvasDiagramPens`, `diagramInk.ts:392-409`) and in the table (0.75 ink
  each), so the line does not change in either preset. Dividers and ticks
  go from 0.5625 to 0.25 pt in the Diagram preset, and from 0.7875 to
  0.5 pt in the Default.
- **The ink stays the marks'** (`ink.mark`). This follows Zach's 16a ink
  review, which put the right angle in the aux pen's width and kept the
  marks' ink, because the Default preset's grey aux would make the mark read
  as a crease (`diagram-revision-2.md`, RA5, revised 2026-10-06). It is the
  same call for the other mark the note puts in the aux pen. If divisions
  should take the aux ink instead, that is a word from Zach.
- **One pen, so one path.** `DivisionsPen` (`diagramInk.ts:184`) and the
  table's `pens` go. `DivisionsDrawn.pens` becomes `pen`
  (`stepDiagramGeometry.ts:2843-2880`). `divisionsPathData` returns one
  `d`. `DiagramPrimitives.tsx:975` draws one `<path>`. `markReach.ts:209`
  pads every stroke end by half the one pen.
- **The crowding floors keep their printed size.** `spacingFloor` stays
  two ring pens. `divisionsDrawn` takes it from `pens.marks` today
  (`stepDiagramGeometry.ts:2874`); with `pens` gone it reads
  `markRingWidth(project)` directly. So "Too many parts to print clearly"
  warns exactly where it does today. The hit-test twin
  (`annotationHit.ts:599`) measures it that way already; only its table
  lookup goes.
- **The count** is set in the regular weight, not bold (R3-3 B): its
  `fontWeight` is 400 where it was 700, written as such, so a page reads it
  as Noto Sans Regular and embeds that face's digits (`setUploadText` reads
  the weight off the markup). Its size (2.4 mm), its place and its box do
  not change: Noto Sans's digits are 0.572 em in either weight, under the
  0.62 em the box is measured by.
- **Comments** that name ED9's pens are rewritten: `diagramInk.ts:157-159`,
  `stepDiagramGeometry.ts:2849-2857`, `annotationPrimitives.tsx:642`,
  `DiagramPrimitives.tsx:976-978`, `markReach.ts:210-212`.
- **Existing diagrams.** Every divisions mark reprints lighter, which is the
  point. Its reach shrinks by a few hundredths of a millimetre at each
  stroke end. A step whose Fit-each scale its divisions set can print a
  hair larger, so pages are compared for reflow.
- **Goldens** re-recorded and checked by eye:
  `diagram/annotate/__fixtures__/divisionsGolden.json` with
  `divisions.test.ts`; `diagramInk.test.ts`, `stepDiagramGeometry.test.ts`,
  `paintAnnotations.test.ts`.
- `diagram-revision-2.md`, ED9: marked "Revised by Revision 3".

#### Short dividers

ED4 A runs every divider from the measured line to 1.65 mm past the
dimension line. Its option C, short interior dividers, was not taken. The
note's screenshot shows why it is wanted now: when the mark sits on the
same side as the fold it locates, an interior divider draws over that fold.

- **Model.** `shortDividers?: true`, only ever written true. Unsaid, the
  dividers are full, as every mark's are now (R3-1 A).
- **Geometry.** `DivisionsLook` gains `shortDividers`. In `divisionsShape`
  (`stepDiagramGeometry.ts:2793`), dividers 1 to parts − 1 run from
  `offset − overshoot` to `offset + overshoot`: 1.65 mm either side of the
  line (R3-2 A). The two end dividers run to the measured line as today, so
  the mark stays tied to its line. At an offset of 1.65 mm or less, every
  divider already straddles the line this way, so the switch changes
  nothing there.
- **Snapping does not change.** The division points on the measured line
  stay snap targets, so a Line still lands on the first third, though no
  divider reaches it.
- **File.** `ANNOTATION_FIELDS.divisions` gains the field. It is read as
  `numbered` is (`diagramFile.ts:1271`): unsaid or false is off, true is
  on, anything else is damage.
- **Model code.** `cleanDivisions` (`annotationModel.ts:642`) keeps it only
  when true. `divisionsFootprint` (`:687`) is untouched: no flip changes
  it. The primitive gains the field
  (`referenceFinderDiagramToPrimitives.ts:222-231`). The compile
  (`annotationPrimitives.tsx:525`) and the hit-test twin
  (`annotationHit.ts:593`) pass it on.
- **Layers.** A Short Dividers switch under Number in
  `DiagramDivisionsControls`, with the help "Draw the dividers between the
  ends as short strokes across the line." It is one undo step through
  `useStepAnnotations` (`setShortDividers`, beside `setNumbered`).
- **Carry, flip, Flip (F), paste and enlarged steps** do not change. The
  flag goes wherever the mark goes; a same-step paste still stacks 2.5 mm
  further out (ED12).
- **Analytics.** `diagram mark styled` with `kind: divisions`,
  `option: short_dividers`, `value: on | off`. This is the event's first use.
- **i18n.** The row's label and help.

#### Decisions: equal divisions

**R3-1. How is Short Dividers offered? DECIDED: A.** Zach, 2026-10-08, on
"a per-mark switch, off by default": "should just be all interior ones, not
per mark", then "yep". Asked to confirm one switch on each mark that
shortens all its interior dividers: "a".
- A. A switch on each mark in Layers, off for every mark, new ones
  included. Unsaid in the file means off, so every diagram draws as it does
  now.
- B. The same switch, on for new marks: Equal Divisions lays short dividers
  from now on, and old marks keep full ones.
- C. Always short, with no switch. ED4 A's full dividers go.
- **Recommended: A.** The note asks for "an option". ED4 chose full
  dividers because Revision 2's sketch draws them, and a divider that
  reaches the line says which point of it it marks. That still holds
  wherever nothing runs under the divider. B changes what the tool lays
  without being asked; C removes the sketch's look.

**R3-2. How long is a short divider? DECIDED: A.** Zach, 2026-10-08, on
"Each runs 1.65 mm either side of the line": "yep".
- A. 1.65 mm either side of the dimension line: the end dividers' overshoot
  past it, so every divider's outer end lines up. It is the template's
  |\|\| symbol, which any offset under 1.65 mm already draws.
- B. A tick's length, 1 mm either side, square to the line.
- C. Only past the line, 0 to 1.65 mm out, away from the measured line.
- Not offered: the full divider drawn dashed. "Dashes" could be read that
  way, but a dashed stroke running into the paper reads as a valley line,
  the very kind of line the switch is there to keep clear.
- **Recommended: A.** One length for the outer half of every divider, and
  the switch then draws the symbol ED4 draws at no offset. B is easily
  read as a fourth tick. C reads as a ruler's graduations.

**R3-3. The count's weight. DECIDED: B.** Zach, 2026-10-08, on "R3-3: the
division count's number stays bold": "no, should not be bold".
- A. As before: bold, 2.4 mm. It is lettering, not a stroke.
- B. Regular weight, to sit with the thinner strokes.
- Recommended was A: "too thick" was read as about the strokes, and thin
  regular digits beside 0.25 pt strokes were thought faint on a grey paper
  side. Zach took B. 18a's before and after shows the regular count on the
  Diagram preset's grey back (`artifacts/revision-3/18a/18a-evidence.png`,
  and `18a-before-after.png`, A1 to A3).

### 2. Stars

A star names a point. Japanese diagrams use a solid ★ and an outlined ☆
as a pair, as in "bring ★ to ☆", or to carry the same point across steps.
That usage is from general knowledge and Zach's sample; no source on it was
checked. Lang labels points with letters instead. His "Origami Diagramming
Conventions" (langorigami.com) was checked on 2026-10-08 through a fetch
that summarizes the page, not read in full: Part I's example is "fold flap
A to point C", and no part mentions a star.

- **Model.** Kind `star`, a point kind (`ANNOTATION_SHAPES` `point`,
  `POINT_KINDS`): `from` is its centre, and `to` is written as it again.
  `fill?: 'black'` is the white arrow's field with the same meaning
  (`diagramDocument.ts:864`): `'black'` is filled with ink, and unsaid is an
  outline whose inside is the page's white (R3-5 A). `angle?` and
  `scale?` as The transform box says.
- **File.** `ANNOTATION_FIELDS.star` = `fill`, `angle`, `scale`. `fill` is
  read by `readFill` (`diagramFile.ts:1415`); any other fill value is a
  newer build's. `angle` and `scale` as The transform box says.
- **Drawing.** A primitive `{kind: 'star', at, fill, angle, scale}`, its
  `fill` `white` or `black` as a white arrow's primitive has it
  (`annotationPrimitives.tsx:476-490`). `starDrawn(at, angle, scale,
  project)` in `stepDiagramGeometry.ts` gives a regular five-pointed star,
  one point up at angle 0, its inner radius 0.382 of its outer.
  `DIAGRAM_STAR_INK` in `diagramInk.ts` sets the outer radius at 4.5 ink,
  3 mm across, at `scale` 1. It is turned by `angle` on the page: the
  projector's own turn or mirror is not applied to it, as the ticks' lean
  is not. Filled, it is a filled path in `ink.mark`. Outlined, its
  inside is the page's white and its outline is in the ring pen (R3-26 A),
  with mitred tips. It is drawn on and off the paper (`onAndOffPaper`).
- **Tool.** Star, in Marks after Circle, key K (R3-25 A). Click a point. It
  snaps as a Circle does, ⌘ puts it down anywhere, and the Snap switch
  turns snapping off (R3-24 A). While Star is in hand, a Fill control sits
  under the Marks group, as Text Style sits under Text for the Label tool
  (R3-4 C): Filled or Outline, drawn as small stars, remembered as Line
  Type is (`diagramAnnotateStarFill` in `store/settingsStore.ts`). It starts
  at Filled. The tool stays in hand. Help: "Click a point to mark it with a
  star." The ⌘ line reuses `circleFreeKey`.
- **Selected**, it shows the transform box with corner squares only
  (R3-29a A), which scale it about its centre (R3-29b A), and four turn
  handles. A press on the star drags it whole, snapping as when it was put
  down.
- **Snap target.** Its centre is a `point` target, as a Circle's is
  (`pictureSnap.ts:130-160`), so the sample's dashed line starts on it.
- **Hit.** Inside its outer radius at its scale, plus half a pen.
- **Layers.** The row's glyph is a star in its own fill. Selected, a Fill
  row (Filled | Outline, drawn as stars), in a new `DiagramStarControls`
  on the white arrow's pattern (`DiagramWhiteArrowControls.tsx:12`), and
  the Rotation row (R3-33 A).
- **Carry.** The centre moves with the face under it; its angle and scale
  stay as they were (R3-32 A). No Flip row (`flipsOver` false, as for a
  Circle). Turn Over keeps it as it is. A paste lands `PASTE_OFFSET` down
  and right. On an enlarged step it keeps its print size at its scale, and
  a copy into the window lands at the same place on the picture (Revision
  2, decision 7).
- **Pages.** It is a `mark` primitive, so every surface draws it, and
  `markReach` takes its tips, mitred, turned and scaled, as far as their
  ink reaches.
- **Analytics.** `tool: star` with `snap`, and `fill` (`filled` |
  `outline`). A Fill change, and a resize or a turn by its box or its
  Rotation row, sends `diagram mark styled`.
- **i18n.** Tool name, help, the Fill row and its two options, the rail
  control's label, the Rotation row and the undo labels (The transform
  box).

#### Decisions: stars

**R3-4. How is filled or outlined chosen? DECIDED: C.** Zach, 2026-10-08:
"yep, for now".
- A. One Star tool that lays a filled star, as the sample's is, and a Fill
  row in Layers to make it an outline.
- B. Two tools, Star and Outline Star, as the Solid Arrow pairs with the
  White Arrow.
- C. One Star tool with a Fill control (Filled | Outline) on the rail while
  it is in hand, remembered as Line Type is, and the same Fill row in Layers.
- **Recommended: C.** ★ and ☆ are used as a pair, so both often go on one
  step. C lays each with one click and no trip to Layers, for one rail slot.
  A doubles the work for every outline star. B costs two slots and two keys.
  C departs from the code's own precedent: a fill is chosen today by tool,
  the Solid Arrow being a second tool that lays a white arrow with
  `fill: 'black'` (`SOLID_ARROW`, `annotateTools.ts:37-42`; `drawingKind`,
  `:91`). C also adds a saved setting, `diagramAnnotateStarFill`. If C is
  taken, White Arrow and Solid Arrow could later become one tool with the
  same control; that is not in this revision.

**R3-5. What is inside an outlined star? DECIDED: A.** Zach, 2026-10-08:
"yep, for now".
- A. The page's white, as a white arrow's and a hollow push's insides are.
  Lines under it stop at its outline.
- B. Nothing: the lines under it show through.
- **Recommended: A.** A star usually sits on a crossing. Under B the
  crossing's lines run through it and it stops reading as a star. On a
  References step's coloured face it is still white, as a white arrow is.

**R3-6a. A star's size. SUPERSEDED** by the transform box (Zach,
2026-10-08): a star is 3 mm across at `scale` 1, and its corner squares
scale it within R3-30a's range. The options were:
- A. One print size, about 3 mm across.
- B. Three sizes (Small, Medium, Large), as a white arrow has widths.

**R3-6b. Does a star turn with the picture? SUPERSEDED** by the transform
box (Zach, 2026-10-08): a star has an angle of its own, set by its turn
handles. Whether a carry turns that angle is R3-32. The options were:
- A. No: it stands upright on the page however the picture turns or
  mirrors, as the ticks' lean does. It is notation.
- B. Yes: it turns and mirrors with the picture, as the paper under it does.

### 3. The eye

Lang's "next view from here" is in Part VI of his conventions (checked as
in Stars, through a summary): "a stylized eye" placed where the observer
stands. The text, as summarized, does not say which way it faces or whether
an arrow goes with it, and its figure (Figure 42) was not seen. The note's
eye is described above; its open side faces the way it looks. The Origami
House template (`~/Documents/art/origami/misc/origami_house_template.svg`,
Zach's own reference) draws it with curved lids, a white fill, a solid
crescent iris and a short solid arrow, 4.5 × 5.2 mm at 0.75 pt. Montroll's
form was not checked.

- **Model.** Kind `eye`, in a new shape class, `sight`. `from` is the eye's
  centre, and `to` is written as it again. `angle?` is the way it looks,
  in degrees clockwise from looking right, and `scale?` its size (The
  transform box). It is not `corner`: `isCornerKind` would run the right
  angle's corner search on a click (`createAnnotation`, `:1333`). Nor is it
  a point kind: a drag puts it down, not only a click.
- **File.** `angle` and `scale`, read as The transform box says; `to` is
  set to `from`, as for `zoom` (`diagramFile.ts:1156`).
- **Drawing.** A primitive `{kind: 'eye', at, angle, scale}`.
  `eyeDrawn(at, angle, scale, project)` draws the lids, the cornea arc and
  the iris arc as one path (R3-7 A), turned so its open side faces its
  `angle`. The glyph is symmetric about the way it looks, so it is never
  mirrored as a glyph. Its direction is measured after projecting, so a
  mirrored picture turns it with the paper. `DIAGRAM_EYE_INK` sets it about
  5 mm long at `scale` 1, in the ring pen (R3-26 A, amended for the eye
  after 18c: built first in the aux pen), in `ink.mark`, with no fill.
- **Tool (R3-8 A).** Eye, in Marks after Equal Divisions, key Y (R3-25 A).
  Drag from where the viewer stands toward what they look at: the drag
  sets `angle`, and Shift holds it to 15° steps (R3-28 A). A click lays it
  looking toward the picture's middle. It is put down freely, as a sign is
  (R3-24 A). Help: "Drag from where the viewer stands toward what they look
  at, or click to look at the middle."
- **Selected**, it shows the transform box with corner squares only
  (R3-29a A), which scale it about its centre (R3-29b A); its turn handles
  turn the way it looks, Shift for 15° steps. A press on the glyph drags it
  whole (`body`). It offers no `corner` or `direction` grip (Common ground,
  Kinds the compiler does not check): `corner`'s move would square the
  mark into a right angle's opening.
- **Hit.** Inside its turned box at its scale, plus the press's tolerance
  (`boxContainsModelPoint`).
- **Layers.** The row; the Flip row (Horizontal, Vertical) about its centre
  (R3-9b A), `flipsOver` true and `flipCentre` its `from`, Horizontal
  setting its angle to 180° less it and Vertical to its negative — F is
  the row's Horizontal (R3-9b, amended after 18c); and the Rotation row
  (R3-33 A).
- **Carry.** Its centre goes with the face under it, and its `angle` turns
  with the picture, as `carryZoom` turns an area's
  (`annotationModel.ts:1714-1740`); a mirror reflects the way it looks. Its
  scale stays. Turn Over mirrors its direction with the paper. A paste is
  offset. On an enlarged step it keeps its print size at its scale.
- **Analytics.** `tool: eye`, `snap: none`. A resize or a turn by its box,
  or its Rotation row, sends `diagram mark styled`.
- **i18n.** Tool name, help, the Shift line.

#### Decisions: the eye

**R3-7. Which eye? DECIDED: A.** Zach, 2026-10-08: "yes".
- A. The note's: straight lids meeting at a point behind, a cornea arc
  across the open side and a small iris inside it. Outline only, no arrow.
- B. The template's: curved lids crossing behind, a white fill, a solid
  crescent iris, and a short solid arrow the way it looks, about 9.8 mm in
  all.
- C. A, with an Arrow switch in Layers, off by default, that adds B's arrow.
- **Recommended: A.** It is the eye the note draws, and its open side
  already says which way it looks. C can follow if a step needs the arrow.

**R3-8. How is it put down? DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Built in 18c. Once selected, the transform box
turns it whatever is picked here (Zach, 2026-10-08); this is only how the
tool lays it. Revised for the box: option A no longer has a dot that turns
it, and B no longer offers eight directions in Layers.
- A. Drag from the viewer toward what they look at, at any angle, Shift for
  15° steps. A click looks toward the picture's middle.
- B. A click lays it looking left; its turn handles then turn it.
- **Recommended: A.** One gesture puts it down looking the right way. B
  costs a second drag on every eye that does not look left.

**R3-9a. The eye's size. SUPERSEDED** by the transform box (Zach,
2026-10-08): about 5 mm long at `scale` 1, scaled by its corner squares
within R3-30a's range. The options were:
- A. One print size, about 5 mm long. The template's eye alone is
  4.5 × 5.2 mm.
- B. Three sizes (Small, Medium, Large).

**R3-9b. Does the eye have a Flip row? DECIDED: A.** Zach, 2026-10-08:
"yes".
- A. Yes, Horizontal and Vertical about its centre, and Flip (F): one
  click turns a left-looking eye to look right.
- B. No: it is turned only by its dot. The glyph is symmetric about the
  way it looks, so a flip is only ever a turn.
- **Recommended: A.** Looking the other way is the common change, and F
  already does it for every mark that has a way it points.
- **What F does, amended 2026-10-08 after 18c** (18c, For Zach; Zach,
  2026-10-08: "go with your recs from now on unless there is a large fork
  in the design to be figured out, until i say otherwise"): F on an eye is
  its Flip row's Horizontal — mirrored across, so a level eye stays level
  and an eye looking down and right looks down and left (30° to 150°) — not
  the half turn 18c built (30° to 210°). It is the row's own verb, so the
  eye has no Flip of its own beside the row, F's chord names Horizontal,
  and it is counted as the row's flips are (`diagram annotation flipped`,
  `horizontal`). Looking straight up or down, F changes nothing and the key
  falls through.

### 4. Shapes: ovals and rectangles

The turtle's ovals say where a repeat applies. They are marks sized to an
area. A Circle (`circle`, key O) is a fixed ring about 2 mm across round a
point; an enlarge area marks what a later step shows enlarged. Neither is
this.

- **Model.** Two kinds, `oval` and `rectangle` (R3-10a A, R3-10b A), in the
  new shape class `area`. `from` is the centre, and `to` is written as it
  again. `size: [w, h]` in picture units, always written, so a shape rings
  the same part of the picture at any print size. `angle?` in degrees
  clockwise, within [0, 180), is written by a turn handle or by a carry
  that turns it, and unsaid at 0, as an enlarge area's is (The transform
  box).
- **File.** `ANNOTATION_FIELDS.oval` and `.rectangle` = `size`, `angle`,
  read as The transform box says; `to` is set to `from`, as for `zoom`
  (`diagramFile.ts:1156`).
- **Geometry.** A new pure module, `diagram/annotate/areaOutline.ts`: an
  ellipse's and a square-cornered rectangle's outline points and rim
  distance, turned by `angle`. An ellipse's rim distance has no closed
  form; a few Newton steps find it. The circle and rounded rectangle stay
  in `zoomModel.ts`.
- **Drawing.** A list, `areas`, drawn as `<ellipse>` or `<rect>` turned by
  `angle`. The ring pen (R3-26 A) and `ink.mark`, no fill (R3-11a A) and no
  casing, since the sample's ovals lie over the creases. They are painted
  under every line and mark drawn on the step (R3-11d B): before
  `drawing.lines` in `DiagramAnnotationLayer.tsx:61-67`, and first among
  `paintAnnotations.ts`'s items. `annotationReach` takes each outline's
  extent plus half its pen, and a test fails if the list is left out.
  `markExtent` takes the outline's box.
- **Tool.** Oval and Rectangle, in a new Shapes group after Marks, keys
  Shift+O and R (R3-25 A). Drag from corner to corner; Shift makes a circle
  or a square; Alt draws from the middle, as Enlarge in Frame does. A
  click puts down a standard size, as an enlarge area's click does
  (`placedByClick`). Shapes are put down freely (R3-24 A). The tool stays
  in hand. Help: "Drag from corner to corner round an area to ring it.
  Click for a standard size." (the second sentence added in 18d's review).
  The Shift and Alt lines reuse Enlarge in Frame's.
- **Selected**, it shows the transform box: eight squares resize it, free,
  Shift keeping its proportions and Alt about its centre (R3-29c A), held
  to R3-30b's range; four turn handles turn it, Shift for 15° steps. An
  oval is held by its box's. A press on the outline, or anywhere in its box
  where no mark is (R3-31 A), moves it.
- **Hit.** The rim only, pressed in the `under` order beside close-ups and
  enlarge areas (`annotationHit.ts:840`), so the marks inside stay
  pressable. A press inside an unselected oval selects what is under the
  press; inside a selected one, R3-31 says.
- **Layers.** The row, with a glyph by kind, and the Rotation row
  (R3-33 A).
- **Carry.** `carryZoom`'s math, pulled out as `carryArea` and shared: the
  centre goes with the face under it, the size by the move's scale, the
  angle by its turn, and a mirror negates the angle. No Flip row, as for an
  enlarge area: a flip of an oval or a rectangle is only a turn, which its
  turn handles make. Turn Over
  carries it the same way. A paste is offset. Copied into an enlarged
  step's window it grows with the window, so it rings the same part of the
  picture, up to R3-30b's largest side (18d, As built). On an enlarged step a shape reaching out of the frame is drawn
  whole, and badged only when it lies wholly outside.
- **Analytics.** `tool: oval | rectangle`, `snap: none`. A deleted shape is
  not counted as an enlargement (`applyAnnotationEdit`). A resize or a turn
  by its box, or its Rotation row, sends `diagram mark styled`.
- **i18n.** Two tool names, the Shapes group's name, the help.

#### Decisions: shapes

**R3-10a. Which shapes? DECIDED: A.** Zach, 2026-10-08, asked whether
"arbitrary shapes" means ovals and rectangles now, polygons and freehand
later: "yes". The note asks for "arbitrary shapes (rectangle, circle)".
- A. Ovals (a circle with Shift) and rectangles, any size and proportion.
- B. A, and a polygon, clicked corner by corner.
- C. A, and a freeform shape drawn as a path and shaped with Edit Path.
- **Recommended: A.** The note names a rectangle and a circle, and its
  sample uses ovals. This reads "arbitrary" as any size and proportion, not
  any outline; Zach should confirm that reading. B and C can follow if a
  step needs them.

**R3-10b. Which tools, and their names. DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Built in 18d.
- A. Two tools, **Oval** and **Rectangle**, each dragged corner to corner,
  Shift for a circle or a square. Circle (O) stays the ring round a point.
- B. One **Shape** tool with Oval | Rectangle on the rail while it is in
  hand, and a Shape row in Layers to change a drawn one.
- C. The oval folded into Circle: a click puts down today's ring, a drag
  draws an oval. Rectangle is a tool of its own.
- D. Circle renamed Ring, and the new tool called Circle.
- **Recommended: A.** These are the tools Affinity and Illustrator have,
  each with a key. No existing name, tool or file changes, and Circle and
  Oval do different jobs. B hides one shape behind the other. C makes a
  short drag ambiguous. D renames a tool people already use.

**R3-11a. A shape's fill. DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Built in 18d.
- A. None.
- B. A Fill row, None | White.
- **Recommended: A.** The sample's ovals have none and lie over the
  creases. A white fill hides the part of the picture the shape is there to
  point at.

**R3-11b. A rectangle's corners. DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Built in 18d.
- A. Square only.
- B. A Rounded switch, using the enlarge area's 0.22.
- **Recommended: A.** A rounded rectangle is Enlarge in Frame's look, and
  could be taken for one.

**R3-11c. Does a shape turn? SUPERSEDED** by the transform box (Zach,
2026-10-08: "for shapes, i want to be able to rotate and scale them"): four
turn handles, as an image has on the Edit canvas. The options were:
- A. Upright, turned only when the picture turns.
- B. A turn handle.

**R3-11d. Where a shape is painted. DECIDED: B.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Built in 18d. `annotationMarks` paints
the primitives, then enlarge areas' outlines and close-ups' rings over
them; the step's lines (Valley, Mountain, Hidden, Solid) are painted before
all of it (`DiagramAnnotationLayer.tsx:61-67`).
- A. Over the lines, under the marks: first in `annotationMarks`.
- B. Under every line and mark drawn on the step: before the lines.
- C. Over the marks, with the enlarge areas' outlines.
- **Recommended: B.** With no fill the order shows only where strokes
  cross, and there a ring round an area should be the one that gives way.
  A would draw an oval over a Valley Line, and C over arrows and labels. B
  also matches the hit order, where a shape is pressed last (`under`).

### 5. X-ray

The note's picture is a cut-away, there showing a closed sink (its
caption's fragment). Lang's Part III ("More on mountain folds; Unfolding;
X-ray lines; Manipulations", checked as in Stars, through a summary) has
two conventions for what is hidden: x-ray lines, a dotted line for hidden
edges or creases; and cut-away views, "a heavy circle (or arc of a circle)"
with the hidden layers drawn inside it (his Figure 16, not seen). His Part V
marks a closed sink with a filled sink arrow, not a cut-away. Randlett's
dotted x-ray line is already here as the Hidden Line, and a mark behind a
flap dots itself (15e).

Zach chose to store every flat step's faces (Z11, 2026-10-06) with this in
mind: "being able to hide specific faces and show the faces underneath".

**What a step stores, and what it could.** At 568e02a60:

- A flat step's stored scene keeps whole faces, painted back to front, but
  only those that show somewhere: `flatPicture` marks the rest hidden when
  there is no spread (`diagram/capture/captureFolded.ts:234`), and
  `storableScene` drops them (`captureGeometry.ts:73`). With a spread,
  every face is kept.
- `paperFaces` (`diagramDocument.ts:533-556`, since 16c) keeps every face:
  its ring on the paper and on the unspread picture, and its `level`, the
  longest chain of faces over it (`layerLevels`,
  `cp-workspace/folded/foldedLayerSpread.ts:394-424`). Sorting the faces
  under a point by level gives that point's stack, top first; woven pairs
  are the exception (`foldedLayerSpread.ts:409`).
- The kernel's paper scene, which capture already reads
  (`folded_figure_paper_scene`, `engine/oristudioCpTypes.ts:529-586`), has
  more: each face's side (`front_up`), its edges' kinds (`border`, `fold`),
  each overlap cell's stack top to bottom with the cell's polygon
  (`subfaces[].faces_top_to_bottom`), and each face's own aux creases
  (`aux_lines`, each naming its `face`). `capturePaperFaces`
  (`capture/capturePaperFaces.ts:80-93`) keeps none of them: only the
  points, the rings and the levels.
- So a face's side can be stored, about one character a face, or worked out
  by comparing the turn of its ring on the paper and on the picture,
  calibrated on a face whose scene item names its `side` (untested; 18.0
  tests it). Which one is R3-16a; creases and stacks are R3-16b and R3-16c.
- **What storing costs (Z11).** The budget is the whole file's: with every
  flat step refreshed, the `.osf` grows by at most 1% for its faces.
  Measured at 16c (`artifacts/revision-2/16c/paperFacesBudget.json`): the
  crane +0.84% (21.0 kB of faces on 2.49 MB, about 3.9 kB short of 1%),
  the heart +0.67%, the chipmunk +0.18%, Reference Diagrams +0.26%. Past the
  cap, "the numbers go to Zach" (`diagram-revision-2.md`, The budget). A
  face costs about 50 bytes today (16.0's crane captures: 44 to 52 faces in
  2.0 to 2.7 kB), so the crane's 18 flat steps hold about 420 faces, and a
  side each, as a string of 0s and 1s, is under 1 kB. An aux crease is four
  numbers and a face, about 30 to 40 bytes; about 100 of them would use the
  crane's whole margin. Overlap cells carry polygons of their own and
  would cost far more. 18.0 measures each. (**Raised 2026-10-09:** the
  budget is a whole file under 100 MB now, not 1%; `diagram-revision-2.md`,
  The budget.)
- **A new key in `paperFaces` is a newer build's.** An older build locks the
  step (`NEWER_PAPER_FACES`, `document/paperFacesFile.ts:44`). The Diagram
  is unreleased (#436 is open), so that falls only on Zach's own builds of
  #436 from before Revision 3, not on users.
- **Old steps.** A flat step captured before Revision 2 has no
  `paperFaces`, and `stepWithPaperFaces` (`capture/stepPaperFaces.ts:72`)
  fetches them while the link is current. It returns at once for a step
  that has `paperFaces` (`:79`), so a step stored before a new key would
  never get it. It must also fetch when the key is missing, or such a step
  needs a Refresh. (Under R3-16a A, as amended after 18.0, there is no new
  key: only a step with no `paperFaces` at all is fetched for, as it is
  today — 14 of the crane's 21 flat steps, and every flat step of the
  heart and Reference Diagrams.)

**Under the recommendations:**

- **Model (R3-14 A).** Kind `x-ray`, in its own shape class, `x-ray`. A
  circle (R3-15a A): `from` is the centre, and `to` again; `radius` in
  picture units. `anchor?`, a point on the paper as an enlarge area's is;
  unsaid, the window's centre. `depth`, a whole number from 1, always
  written.
- **File.** Those fields. A depth under 1 or not whole is damage. There is
  no upper limit: the Depth stepper stops at the stack under the anchor,
  and a depth past the stack draws at the deepest layer, so a larger number
  means nothing new.
- **What capture stores (R3-16a A, amended after 18.0).** Nothing new: a
  face the stored scene draws keeps its own side, and a face it dropped is
  given its side by how its ring turns on the paper and on the picture,
  calibrated on a face the scene names (agreed with the kernel on all 834
  faces of Zach's four diagrams). `paperFaces` is unchanged, so no older
  build of #436 locks a step for it. A flat step captured before faces were
  kept gets them through `stepWithPaperFaces` as an x-ray is laid on it, in
  the same undo step, as an enlarge area's step does
  (`giveDiagramStepPaperFaces`).
- **What it removes (R3-13 A).** The top `depth` faces at the anchor, and
  every face over those, across the whole window: 15e's rule
  (`behindFlaps.ts:65` `facesAt`, `:135` `facesOver`), on stacks built from
  `paperFaces`' levels (R3-16c A), not from `PictureLayers.covers`, which
  lack buried faces.
- **What it draws (R3-12 A).** A new pure module,
  `diagram/xray/xrayScene.ts`, turns the faces, the window, the anchor and
  the depth into a `PaperScene` of the faces left, back to front by level,
  each filled with its stored side's colour and outlined in the edge pen,
  with no creases (R3-16b A). Its places come from `paperFaces` with no
  spread and from the stored scene's face items with one. Each surface
  clips to the window (`zoomClipShape`, `zoom/paintZoomed.ts:118`), lays the
  page's white, paints that scene through `paperSceneSvgBody`, then draws
  the rim at 1.5 × the edges' pen (R3-15b (ii)). The step's marks are drawn
  over it. A mark behind a flap stays dotted (R3-17 B). (**Amended by 18f's
  review:** "the page's white" is laid only where there was paper — over the
  faces the window takes away, as the picture draws them, their outlines
  too — and nothing off the paper, so a page's band, a selected cell's tint
  or a transparent step file shows through the window there as it does round
  it. Laid across the whole circle, it printed a white disc wherever a window
  crossed the paper's edge. On the canvas, whose page is white, nothing
  changes.)
- **Surfaces.** Each painter gets a hook shaped like the close-up's. 18e:
  the canvas (as `annotate/useCloseUpInsides.ts`). 18f: the card
  (`pictures/useStepPictureUrl.ts:212`); the page's `cellPicture`
  (`pages/pagePictures.ts:611`), which print, the PDF, the one-sheet SVG and
  the ZIP's step files all go through; and an enlarged step's card and page
  (`zoom/paintZoomed.ts:307`). Pose's ghosts draw the rim only (R3-19 A). A
  close-up over a window paints the picture plain inside it (R3-20 B).
  Until 18f lands, no surface but the canvas draws an x-ray, rim included,
  so nothing prints a window that shows nothing. A parity test is copied
  from `closeUps.surfaces.tsx`. A PDF prints a clip path already, through
  close-ups. (**As built in 18f:** not a hook per surface but one pure
  painter, `xray/xrayPaint.ts`, which each surface hands `paintAnnotations`
  as a callback; importing it there would make an import cycle through
  `paintZoomed`. 18f, As built.)
- **Tool.** X-Ray, in Marks after Enlarge in Frame, key X (R3-25 A). Drag
  out from the middle of an area, as Enlarge does; a click puts down a
  standard size (`placedByClick`). Then the Depth field takes the focus, as
  equal divisions' Parts does (ED5 A): type 2, press Enter. On a picture
  with no layers the tool is held, saying why (R3-18a A,
  `annotateToolBlocker`).
- **Selected**, it has the enlarge area's circle grips from `zoomGrips`: the
  centre's dot moves it, and the rim resizes it.
- **Hit.** The rim only, pressed in the `under` order with enlarge areas and
  shapes (`annotationHit.ts:839-845`), so the marks inside stay pressable.
- **Snapping (R3-22 B).** Inside each window the removed faces' corners and
  edges stop being snap targets, and the revealed faces' corners and edges
  become targets, read from the same `xrayScene` (`pictureSnap.ts`).
- **Layers.** `DiagramXRayControls`: Depth (a stepper from 1 to the layers
  at its anchor less one) and Anchor. The Anchor row moves out of
  `DiagramZoomControls` into a component of its own, `DiagramAnchorRow`,
  used by both, with `useAnchorPick`. The move needs, each tested:
  - **Its styles.** `.anchor` and `.anchorRule` move from
    `DiagramZoomControls.module.css` (lines 7-19) into
    `DiagramAnchorRow.module.css`, as a commit of their own that changes
    nothing on screen: the row's computed styles compared before and after.
  - **The pick by kind.** `useAnchorPick` edits an area only when
    `kind === 'zoom'` (`:58`), and always sends `diagram enlargement
    changed` with `on: area` (`:66`). It takes `x-ray` too and sends by
    kind: an x-ray's pick sends `diagram mark styled` (`kind: x_ray`,
    `option: anchor`, `value: picked | auto`), and its undo step is
    "Change X-ray".
  - **The drag by kind.** The canvas's area drag
    (`useAnnotateCanvas.ts:1380-1394`) labels a drag "Change enlarge area"
    and sends the enlargement event when `kind === 'zoom'`. An x-ray's drag
    is "Change X-ray" and sends nothing, as a mark's move does.
  - **Its own Auto wording.** The frame's rule reads "The backmost face
    outside the frame" (`anchorAutoHint`, with `anchorResetHint`). An
    x-ray's Auto is "The window's centre", and its reset "Anchor to the
    window's centre again".
- **Carry.** As an enlarge area (`carryZoom`, with its anchor); the depth is
  kept. After a Refresh or a refold the stack at its anchor can change: a
  depth past it is drawn at the deepest, with a notice on the Depth row
  ("Only {{count}} layers here", a plural key). Turn Over carries the
  window with its face, depth kept, and it then looks through the other
  side's stack from its new top (R3-21 A). (**Amended by 18e's review:**
  Turn Over of a linked flat fold carries no mark — it is "the other side
  of a fold", which `annotationCarry.ts` leaves where it was — so the x-ray
  stays where it was, as every mark does; see R3-21.) No Flip row. A paste lands as an
  enlarge area's does. On an enlarged step it uses that step's own scene
  and faces.
- **A step that loses its layers (R3-18b A).** Show As Crease Pattern, 3D or
  Simulated; Duplicate As one of those; Replace with an upload; a Refresh
  into a fold with no layer order (a see-through development); or a step
  whose faces `stepWithPaperFaces` answers with `refresh`. The x-ray is
  kept in the step, as every mark is, and listed in Layers, but no surface
  draws it until the step has layers again. Selected from Layers it shows
  its grips on the canvas. Its Depth row is disabled with the reason: "This
  picture has no layers to x-ray", or "Refresh step {{n}} to x-ray it".
  Shown back as a flat fold, it draws as before.
- **Analytics.** `tool: x_ray`. Depth (`1` | `2` | `3+`) and Anchor changes
  send `diagram mark styled`.
- **i18n.** Tool name, help, the held reasons, Depth, the notice, the
  disabled reasons, "Refresh step {{n}} to x-ray it", the Auto and reset
  wording.

**Risks.**

- Buried faces exist only in `paperFaces` (and the kernel's scene). An
  X-ray built from the stored scene or `PictureLayers` alone shows page
  white where they are.
- With a spread, `paperFaces`' places are unspread and the picture is
  spread. The window must draw the scene's face items there, or it shows
  faces in the wrong place.
- A side worked out from ring turns (R3-16a A) may flip on a sliver face,
  whose paper coordinates are rounded to a fixed step. A stored side cannot.
- Woven regions: levels leave out the pairs the paint order broke
  (`foldedLayerSpread.ts:409`), so a window there can reveal the wrong
  layer. 15e has the same caveat.
- A face the kernel could not name has an empty ring
  (`capture/capturePaperFaces.ts:92`) and cannot be drawn.
- Several painters must agree. 18f's parity test holds them together.

#### Decisions: X-ray

**R3-12. What does an X-ray show? DECIDED: A.** Zach, 2026-10-08: "sounds good".
- A. A cut-away window, as the note's picture and Lang's cut-away view:
  inside a rim the picture is drawn without its top N layers, the layers
  beneath in their own side's colour with their edges; outside, nothing
  changes.
- B. X-ray lines: no window, and the edges of the N layers under the top
  one drawn dotted over it.
- C. Both, with a Look row on the mark.
- **Recommended: A.** It is the note's picture. Single dotted edges are
  already drawn by hand with the Hidden Line.

**R3-13. What do N layers remove? DECIDED: A.** Zach, 2026-10-08: "sounds good".
(**Superseded by R3-34 A, 2026-10-09**, after Zach's report on #447 that a
window across two flaps x-rayed only one of them: a window is now peeled,
read inside it, a face a step and the whole top layer first. See
`implementation-plans/diagram-xray-peel.md`, 18g.)
- A. The flap at a point: the top N layers at the window's anchor, its
  centre unless picked, and every layer over those, removed across the
  whole window. 15e's "behind N layers" rule.
- B. A true drill: at every point in the window, the top N layers there.
- C. By level: every face with fewer than N faces stacked over it anywhere.
- D. Faces picked by hand.
- **Recommended: A**, on what it shows. It sees through the flap the window
  sits on and leaves the layers beside it alone, as the note's picture
  does: inside the circle the front flap is gone, and nothing else is.
  Under B a window that crosses a flap's edge drills into the flap beside
  it too, so the inside changes depth across that edge. A is exact at the
  anchor and draws whole faces back to front. B's cost is not the reason:
  its cells do not depend on the window (the kernel already computes them,
  `subfaces`), so they could be worked out once a step and kept, leaving
  only the clip to the window on each frame. 18.0 measures that rather than
  this plan asserting it. C can remove nothing at a spot whose top face lies
  deeper elsewhere. D can come later as an override.

**R3-14. Where does it live? DECIDED: A.** Zach, 2026-10-08: "sounds good".
- A. A mark in Annotate, drawn with an X-Ray tool: several per step, with
  no recapture, and on enlarged steps too.
- B. A Pose setting, as Spread is: refolded through the kernel and exact
  everywhere, but every change needs a current link and a refold.
- C. A Depth row on a close-up or an enlarge area.
- **Recommended: A.** A window is placed by eye, as every area is, and A
  works from what the step stores. C could follow, so a close-up can show
  its area x-rayed.

**R3-15a. The window's shape. DECIDED: A.** Zach, 2026-10-08: "sounds good".
- A. A circle only.
- B. A circle or a rounded rectangle, the enlarge area's two, with a Shape
  row reusing Enlarge's strings.
- **Recommended: A.** The note and Lang show only a circle. B can follow;
  it adds `size`, a Shape row and that row's analytics.

**R3-15b. The rim. DECIDED: (ii).** Zach, 2026-10-08: "sounds good".
- (i) The edges' pen, as an enlarged step's frame draws its cut
  (`zoomEdgePen`).
- (ii) Heavier: 1.5 × the edges' pen, 0.75 pt in the Diagram preset.
- (iii) The ring pen, as a close-up's ring.
- **Recommended: (ii).** Lang asks for "a heavy circle", and the note's
  rim is the edges' weight or a little more. (i) matches the enlarged
  frame's cut, which is the case for it.

**R3-16a. Where an X-ray gets each face's side. DECIDED: A**, amended
after 18.0 under Zach's standing instruction (2026-10-08: "go with your
recs from now on unless there is a large fork in the design to be figured
out, until i say otherwise"). 18.0 found A agrees with the kernel's
`front_up` on all 834 faces of Zach's four diagrams (no sliver, no empty
ring), and that B leaves the crane 223 bytes under Z11's 1% (0.992%, its
faces alone 0.958%), so a flat step or two more breaks the budget with
`sides` where it would not without. A face the stored scene draws keeps the
side its item names (exact by construction); only a face the scene dropped
is worked out, calibrated on one the scene names. Nothing is stored, so no
older build locks a step, and no step needs a Refresh for a key. B stays
the way if a sliver ever flips.
- A. Worked out from how each face's ring turns on the paper and on the
  picture, calibrated on a face whose scene item names its side. Nothing
  new is stored.
- B. Stored: capture keeps the kernel's `front_up` in `paperFaces` as
  `sides`, about one character a face (under 1 kB on the crane, inside its
  3.9 kB margin). Older builds of #436 lock such a step; a step stored
  before it gets the key through `stepWithPaperFaces`, extended to fetch
  when it is missing, or by Refresh.
- **Recommended: B**, if 18.0's size check passes (before 18.0). It is
  exact, cheap, and what Z11 stores faces for. A is untested and can flip
  on a sliver. If B breaks the budget on any of the four diagrams, the
  numbers go to Zach. (18.0 then tested A, and found it exact; above.)

**R3-16b. Whether the revealed layers carry creases. DECIDED: A**, for
now. Zach, 2026-10-08: "sounds good". A step's
stored scene has the creases of the faces that show, cut where they are
covered, and nothing of the faces wholly buried.
- A. No: faces in their side's colour with their edges, and no creases
  inside the window. A crease there is drawn by hand with a Line.
- B. Yes: each face's own aux creases (the kernel's `aux_lines`, with their
  face) stored in `paperFaces` and drawn inside the window. About 30 to 40
  bytes a crease; 18.0 counts them.
- **Recommended: A** now; B if 18.0 finds that revealed faces carry creases
  that matter and their size fits the budget. The note's own case is a
  closed sink: its M of lines could be the sunk layers' edges, which A
  draws, or creases, which A leaves to a Line.

**R3-16c. Where an X-ray gets each point's stack. DECIDED: A**, under the
standing instruction (2026-10-08): 18.0's stack check passed, 597 of 597
against the kernel's `faces_top_to_bottom`, read on the paper with "over"'s
tolerance (18.0 results, 1 and 2).
- A. From `paperFaces`' levels: the faces under the anchor, sorted by
  level. Woven pairs are the exception, as in 15e.
- B. Stored: the kernel's overlap cells (`subfaces`), each a polygon and
  its stack. Exact everywhere, and what R3-13 B would draw from; far larger
  than the faces.
- **Recommended: A**, if 18.0's stack check passes outside woven patches.
  B only if it fails, with its measured size.

**R3-17. A mark behind a flap the window removes. DECIDED: B**, under the
standing instruction (2026-10-08).
- A. Drawn solid inside the window, since nothing covers it there.
- B. Left dotted, as set.
- **Recommended: B** in this revision. A compares every mark's behind count
  with the window's depth along it, which is a piece of work of its own.

**R3-18a. The X-Ray tool on pictures with no layers. DECIDED: A**, under
the standing instruction (2026-10-08). A crease
pattern, a 3D or simulated capture, an upload, a see-through development
and a References step.
- A. The tool is held there, saying "X-ray works on flat folds", as Enlarge
  is held on an enlarged step. A flat step from before Revision 2 gets its
  faces while its link is current; otherwise the tool says "Refresh step N
  to x-ray it".
- B. Allowed, drawing only a rim, to annotate by hand.
- **Recommended: A.** B draws a cut that shows nothing.

**R3-18b. An X-ray on a step that loses its layers. DECIDED: A**, under
the standing instruction (2026-10-08). Show As
Crease Pattern, 3D or Simulated; Duplicate As one of those; Replace with an
upload; a Refresh into a fold with no layer order; faces in the `refresh`
state.
- A. Kept and listed in Layers, drawn on no surface until the step has
  layers again, its Depth row disabled with the reason.
- B. Kept and drawn as its rim only, on every surface, the picture plain
  inside.
- C. Removed by the change, which says so in its undo label.
- **Recommended: A.** B prints a cut that shows nothing, for R3-18a's
  reason. Show As is often a trip there and back, and under A the window
  comes back as it was.

**R3-19. An X-ray in Pose. DECIDED: A**, under the standing instruction
(2026-10-08); built in 18f (on Pose's card and an enlarged step's, and kept
while a spread is dragged, whose preview is captured without faces; a live
3D or simulated view mounts only for a 3D or simulated capture, which has
no layers, so there R3-18b draws nothing, and since 18f's review its ghost
is given no x-ray painter at all). Pose ghosts the step's marks over
the live fold at 0.3 opacity, and a close-up there shows only its ring.
- A. Its rim only.
- B. Nothing.
- **Recommended: A.** Its inside is the stored picture's, which a live pose
  is not, and A treats it as a close-up is treated there.

**R3-20. A close-up whose area takes in a window. DECIDED: B**, under the
standing instruction (2026-10-08).
- A. Its inside is x-rayed too: the picture as the step draws it, window
  and all. That is X-ray in three more painters (the card's, the page's and
  the canvas's close-up insides).
- B. Its inside shows the picture plain in this revision, the flap the
  window removed included; A later.
- **Recommended: B.** A close-up over a window is rare, and A triples the
  painter work before anyone has used an X-ray.

**R3-21. An X-ray after Turn Over. DECIDED: A**, under the standing
instruction (2026-10-08).
- A. Carried with its face, depth kept: it then looks through the other
  side's stack from its new top.
- B. Carried, its depth set to show the same face it showed, now from
  behind, where the stack allows.
- C. Dropped from the turned picture.
- **Recommended: A.** A window is placed for the view it is in, and A is
  what an enlarge area does. B guesses at intent; C loses work.
- **As built (18e review, 2026-10-09): the code proves A's premise wrong.**
  Turn Over of a linked flat fold refolds it: the turned picture is another
  fold's, and `annotationCarry.ts` leaves every mark where it was on "the
  other side of a fold", with Annotate's "The picture changed" banner. So an
  x-ray stays where it was in the picture, as every mark does, its depth
  kept, and looks at what is there now (the crane's index 22: 2 of 44 faces
  taken away before, 11 after). `carryZoom`'s x-ray path (depth and anchor
  kept) runs only for the moves the app applies itself — a quarter turn, an
  upload's flip, a References turn-over — none of which can hold an x-ray.
  Carrying marks through a linked fold's Turn Over would be a new carry for
  every mark, not an x-ray change: **for Zach**, a fork, not built here.

**R3-22. Snapping inside a window. DECIDED: B**, under the standing
instruction (2026-10-08): 18.0's spread check passed.
- A. Unchanged: the picture's own targets, the removed faces' edges
  included; nothing revealed snaps.
- B. Inside each window, the removed faces' corners and edges stop
  snapping, and the revealed faces' corners and edges snap, from the same
  `xrayScene`.
- **Recommended: B**, if 18.0's spread check passes. Under R3-16b A a
  revealed crease is drawn with a Line, which needs the revealed corners to
  land on. A would snap that Line to an edge nobody can see.

### Decisions: all the new marks

**R3-23. Do the new marks take a colour? DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. No. They are drawn in the arrows' ink, as every mark but a solid line
  and Text is (RM3; Annotate's decision 7).
- B. Stars, ovals and rectangles get the Color row a solid line has: the
  palette plus Custom (`annotationColors.ts:28-35`, `DiagramColorSelect`).
  The eye and the x-ray stay in ink.
- **Recommended: A.** Nothing asks for colour, and the samples are black. B
  is one `carriesColor` case and the existing row each, if a coloured ring
  is wanted later.

**R3-24. What snaps? DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. A star snaps where it is put, to the picture's corners, vertices,
  crossings and other marks' points, as a Circle does, and lines and arrows
  snap to its centre. Ovals, rectangles, the eye and x-ray windows are put
  down freely, as enlarge areas and signs are.
- B. Nothing new snaps.
- C. As A, and an oval's or rectangle's corners snap as they are dragged.
- **Recommended: A.** A star names a point, and the sample's dashed line
  starts on it. An area's outline is judged by eye, and C would pull it to
  vertices that have nothing to do with it.

**R3-25. Rail groups and keys. DECIDED: A**, accepted for launch on
2026-10-10 under Zach's instruction to resolve routine recommendations.
Action ids remain stable. Earlier discussion: Zach, 2026-10-08:
"sure. Im probably going to do a shortcut pass before merge, those are fine
for now". The keys may change in that pass.
- A. Marks: Circle, Star, Right Angle, Equal Angles, Equal Divisions, Eye,
  Close-Up, Enlarge, Enlarge in Frame, X-Ray. A new Shapes group after
  Marks: Oval, Rectangle. Keys: Star K, Eye Y, Oval Shift+O (paired with
  Circle's O, as Shift+E pairs with E), Rectangle R, X-Ray X. Each is free
  in the Diagram's scope (`keyboard/shortcuts.ts:612-645`). Elsewhere R is
  only the simulator's and ⌘R, and X only ⌘X.
- B. All five in Marks.
- C. As A, with no key for the Eye and X-Ray, as Equal Angles has none.
- **Recommended: A**, checked at phone width and on an iPad. Marks grows
  from 7 tools to 10; B would make it 12. The two drawing tools in a group
  of their own read as Affinity's rail does.

**R3-26. The new marks' pens, as one rule. DECIDED: A.** Zach,
2026-10-08: "yeah sounds right". Today the ring pen
(0.5625 pt in the Diagram preset) draws rings round something (a Circle, a
close-up, an enlarge area); the aux pen (0.25 pt) draws the right angle, by
Zach's 16a review, and equal divisions after 18a; the edges' pen (0.5 pt)
draws an enlarged step's cut. In the Diagram preset:
- A. By what the stroke does: strokes that point or measure (the right
  angle, equal divisions, the eye) in the aux pen; outlines round something
  (a Circle, an outlined star, an oval, a rectangle) in the ring pen. Star
  outline 0.5625, eye 0.25, shapes 0.5625.
- B. By size: small glyphs (an outlined star, the eye) in the aux pen;
  outlines round an area (an oval, a rectangle) in the ring pen. Star
  outline 0.25, eye 0.25, shapes 0.5625.
- C. Every new mark in the aux pen: 0.25 each.
- D. Each mark on its own, from the prototype, which also shows the eye at
  the template's 0.75 pt and shapes in the edges' pen.

The x-ray's rim is a cut, not a mark, and is R3-15b's.
- **Recommended: A.** It is the rule the shipped marks already follow, so
  nothing drawn today changes, and both of Zach's asks for the aux pen (the
  right angle, then equal divisions) were for strokes that measure the
  lines beside them. Under B and C a 0.25 pt
  outline round a white 3 mm star reads as a hole in the picture more than
  a mark on it. Under A an oval is about the edges' weight, as the sample's
  are.
- **Amended for the eye, 2026-10-08, after 18c** (18c, For Zach; Zach,
  2026-10-08: "go with your recs from now on unless there is a large fork
  in the design to be figured out, until i say otherwise"): the eye draws
  in the ring pen, 0.5625 pt in the Diagram preset and 0.7875 pt in the
  Default, as an outlined star does. In the aux pen (0.25 pt) it read as a
  hairline beside the creases and arrows, much lighter than the eye in
  Zach's sketch (`18c/note-vs-ours.png`). Before and after on a page:
  `artifacts/revision-3/18d/eye/eye-before-after.png`. The right angle and
  equal divisions keep the aux pen.

**R3-27. X-ray's PR. DECIDED: B.** Zach, 2026-10-08: "sounds good". He
works one PR per feature.
- A. One PR: 18a to 18f on `claude/diagram-revision-3`.
- B. Two: 18a to 18d on `claude/diagram-revision-3`; X-ray (18e, 18f) on
  `claude/diagram-xray`, stacked on it and opened after 18.0 passes.
- **Recommended: B.** X-ray is the one part with a spike gate, a file
  question (R3-16) and two phases. The four marks need not wait for it, and
  its review is easier alone.

**R3-37. Where a paste from another picture's whole step lands on an
enlarged step. DECIDED: A, 2026-10-10** (numbered R3-34 until 2026-10-09, when the peel
plan's first decision took that number; raised by 18d's review, 2026-10-08; built as A,
which changes nothing Zach decided). Revision 2's decision 7, which Zach
confirmed, lands such a paste at the same place on the picture: "On the
crane, 22 → 23 lands outside 23's window". That serves a paste from the
step whose area the enlarged step shows, whose picture is framed as the
next one's is. From any other step the same place on the picture is
somewhere else on the model, and the paste often lands beside the window:
of 25 places on the crane's step 1 pasted onto step 24, the review found 4
inside the window, 16 beside it and 5 so far off that 18d keeps them in
the window. One beside the window is drawn on the canvas, badged in
Layers, and not printed until it is moved in. Changing that changes the
16g review case "a mark across the model and a small frame"
(`diagramClipboard.test.ts`), which is why it is Zach's call.
- A. As decision 7, with 18d's two changes: a mark the window would draw
  nowhere keeps its place in the window, and the canvas steps back to show
  the paste.
- B. A paste none of which touches the window (`marksTouchingWindow`)
  keeps its place in the window, as a paste between two windows does. The
  16g line, beside a small window, would land across it instead.
- C. Through the picture only from the step whose area the enlarged step
  shows, or from its own picture; from any other step, its place in the
  window. The clipboard would remember the step a copy came from.
- **Recommended: A.** The paste is now seen where it lands, and moving it
  in is one drag. B and C each guess which steps' pictures line up; C's
  guess is the better one, and can follow if pastes from far steps keep
  landing beside the window in use.

### Decisions: the transform box

Raised by Zach's ask for the transform box (2026-10-08). Each is for stars
(18b), the eye (18c) and shapes (18d) unless it names fewer.

**R3-28. The turn's snap. DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. Free; Shift holds it to 15° steps, as an image's turn on the Edit
  canvas (`IMAGE_ROTATION_SNAP_RADIANS`, `cp-workspace/images/cpImage.ts:40`)
  and a handle's in Edit Path (`annotationPath.ts:166`).
- B. In 15° steps; Shift frees it.
- C. Free; Shift for 45° steps.
- **Recommended: A.** It is the Edit canvas's, which Zach asked for, and
  the Diagram's own Shift on a turn. An oval laid along a 22.5° flap needs
  the free turn, so the steps are the ones that cost a key.

**R3-29a. Does a star or an eye keep its proportions? DECIDED: A.** (18b, 18c) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. Always: one `scale`, and four corner squares only, as a folded figure
  on the Edit canvas (`aspectLock: 'always'`, `transformableObject.ts:151`;
  `CanvasObjectOverlay.tsx:891-897`).
- B. Kept, and Shift frees them, as a reference image (`default-on`):
  eight squares, and `scale` becomes a width and a height.
- **Recommended: A.** A squashed star or eye is not a symbol diagrams use,
  and A keeps one number in the file.

**R3-29b. What a star or an eye scales about. DECIDED: A.** (18b, 18c) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. Its centre: a corner square moves every corner, so a star stays on
  the point it names.
- B. The opposite corner, held, as on the Edit canvas
  (`resizeAnnotationBox`, `annotationTransform.ts:146-207`).
- **Recommended: A.** A star is put down on a point, snapped there
  (R3-24 A), and lines snap to its centre. Under B every resize slides it
  off that point. A is `resizeAnnotationBox`'s about-the-centre option, the
  one R3-29c A gives Alt.

**R3-29c. A shape's resize keys. DECIDED: A.** (18d) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. Free; Shift keeps its proportions, as a text box's on the Edit canvas
  (`default-off`); Alt resizes it about its centre, as Enlarge in Frame's
  grips do (`zoomGrips.ts:45-49`).
- B. As the Edit canvas exactly: free, Shift keeps its proportions, and the
  opposite side is always held. No Alt.
- C. As an image: proportions kept, Shift frees them.
- **Recommended: A.** A shape is sized to an area, so a free drag is the
  usual one, and Shift and Alt are what the Oval and Rectangle tools' own
  drag uses. Nothing on the Edit canvas's handles uses Alt, so A adds to
  its rule without changing it.

**R3-30a. How small and how large a star or an eye goes. DECIDED: A.**
(18b, 18c) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". `scale` is times the print size: at 1 a star is 3 mm across and an
eye about 5 mm long.
- A. 0.5 to 4: a star 1.5 to 12 mm across, an eye 2.5 to 20 mm long.
- B. 0.5 to 2.
- C. No bounds but a floor that keeps it from vanishing, as the Edit
  canvas's `MIN_BOX_EXTENT` (`annotationTransform.ts:113`).
- **Recommended: A.** An outlined star 1.5 mm across is already mostly its
  0.2 mm outline, and 4 is well past any size the samples show. A range
  lets a larger value in a file read as a newer build's, as a close-up's
  scale does (`diagramFile.ts:1453`). Under C a drag can leave a glyph
  nobody can find.

**R3-30b. How small and how large a shape goes. DECIDED: A.** (18d) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. An enlarge area's sides' range: from a slip (`MIN_ANNOTATION_LENGTH`,
  0.015 picture units) to twice the picture's frame (`ZOOM_SIDE`,
  `annotationModel.ts:1630`), held as a drag goes, as `zoomSideWithin`
  holds an area.
- B. No upper bound.
- **Recommended: A.** A ring more than twice the picture's size rings
  nothing in it, and one range for both kinds of area keeps one rule in the
  reader.

**R3-30c. A star or an eye smaller on screen than its handles. DECIDED:
B.** (18b, 18c) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Measured in 18b: a 3 mm
star is 34 screen px across at the canvas's fit of the crane (57%), so A
and B draw the same there; below about 40% B's floor shows. At a zoom where a 3 mm star is under about 24 screen px across,
its four 8 px corner squares cover most of it, and a press on the star
takes a handle instead.
- A. As the Edit canvas: the box is the glyph's, however small; zoom in to
  take hold of it.
- B. The box is drawn at least 24 screen px across, about the glyph's
  centre, so the squares stand clear of it. The glyph does not change.
- **Recommended: B.** Stars and eyes are the smallest things the Diagram
  gives a box, smaller than anything the Edit canvas boxes. 18b first
  measures a 3 mm star on screen at the canvas's usual zoom; if it is well
  over 24 px, A and B draw the same there.

**R3-31. A press inside a selected shape. DECIDED: A.** (18d) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". Unselected, a
shape is pressed by its outline only, so the marks inside stay pressable
(Shapes, Hit). On the Edit canvas a selected image is moved from anywhere
inside its box.
- A. Selected, a press anywhere inside its box moves it, but a mark or a
  line under the press is taken first, as a crease drawn over a reference
  image is (`yieldsPressToCreases`, `transformableObject.ts:40-58`).
- B. Its outline only, selected or not.
- C. Anywhere inside, over the marks, while it is selected.
- **Recommended: A.** It is the Edit canvas's rule, and the marks inside
  stay pressable. Under B a thin outline is the one place to move a large
  oval; under C every mark inside a selected oval is out of reach until it
  is let go.

**R3-32. Does a carry turn a star? DECIDED: A.** (18b) Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise". A carry turns and
mirrors a mark with the picture under it. A shape and the eye turn with it
in this plan: they ring an area of the paper, or look along it.
- A. No: a star keeps the angle it was given. Only its centre is carried.
- B. Yes, as a shape is.
- **Recommended: A.** A star's turn says nothing about the paper. Carried
  with a quarter-turned picture, an upright star would land 18° off upright
  (90° is 72°, a fifth of a turn that changes nothing, and 18° more)
  without anyone turning it.

**R3-33. A Rotation row in Layers. DECIDED: A.** Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise".
- A. Yes, for stars, the eye and shapes: degrees, wrapped, as an image's
  Rotation in the Edit canvas's Properties
  (`cp-workspace/images/imageProperties.ts:56-67`).
- B. No: the box alone.
- **Recommended: A.** It is the Edit canvas's, and the one way to set a
  turn back to exactly 0 without Shift. A Size row waits, as the Edit
  canvas's width and height do (`imageProperties.ts:14-17`).

### Small calls made here

1. **Two shape kinds, not one with a field.** A tool draws its kind, and
   the analytics tool is the kind, so nothing needs telling apart.
2. **Stars and the eye are paths**, never text glyphs.
3. **Shapes share only the enlarge area's math**, not its kind or
   `DiagramZoomShape`.
4. **Equal divisions' floors keep their printed size** (two ring pens), so
   the crowding warning does not move.
5. **Equal divisions keep the marks' ink**, on the right angle's precedent
   from Zach's 16a ink review (The aux pen, above).
6. **One new analytics event**, `diagram mark styled`, rather than one per
   option, and an x-ray's edits never count as enlargement events.
7. **The eye's direction is an `angle`, not a `to`**, so every mark with
   the transform box has one shape: a centre, an angle, and a scale or a
   size.
8. **The transform box shares pure code, not a component**:
   `lib/transformBox.ts`, with each canvas drawing and pressing its own
   (The transform box).

### Not in this revision

Behind-flap dotting for the new marks. Filled, dashed, coloured or rounded
shapes (unless R3-11a, R3-11b or R3-23 says otherwise); polygons and
freeform shapes, later (R3-10a A). A repeat symbol. X-ray on pictures with
no layers, and a close-up showing a window x-rayed (unless R3-18a or R3-20
says otherwise); a per-point drill, a rounded window and a Depth on
close-ups (R3-13 A, R3-15a A, R3-14 A). The transform box on any other
mark. A Size row. Arrow-key nudges, left to Zach's shortcut pass. A Shift
latch for the Diagram on touch, as the Edit canvas has
(`cp-workspace/touchModifiers/shiftLatch.ts`): without one a finger cannot
hold a turn to 15° steps or a shape's proportions.

### Found while planning (not this plan's)

15e's "behind N layers" counts only the faces that show somewhere:
`sceneGeometry` builds `PictureLayers.covers` from the stored scene
(`annotate/pictureGeometry.ts:196-206`), which has no buried faces. Where a
wholly buried face lies between, it can name a different Nth layer than
the paper has. X-ray's stacks from `paperFaces` would fix it too. Left for
a follow-up.

18.0 found that 15e's `facesOver` (`behindFlaps.ts`), run on
`paperFaces`' rings, takes two faces that meet along a fold as overlapping
where their stored corners cross by about 1e-5 of the picture (heart #14 to
#16). X-ray reads "over" with a tolerance instead (18.0 results, 2).
Whether 15e's own marks meet the same on the stored scene was not checked.
Left for the same follow-up.

## Affected Areas

**Equal divisions.** `cp-workspace/references/diagram/diagramInk.ts`
(`DIAGRAM_DIVISIONS_INK.pens` and `DivisionsPen` gone),
`cp-workspace/references/stepDiagramGeometry.ts` (`divisionsShape`,
`divisionsDrawn`, `divisionsPathData`; `rightAnglePen` renamed
`auxMarkPen`), `cp-workspace/references/diagram/DiagramPrimitives.tsx`,
`cp-workspace/references/diagram/markReach.ts`,
`cp-workspace/references/referenceFinderDiagramToPrimitives.ts`;
`diagram/document/diagramDocument.ts`, `diagramFile.ts`;
`diagram/annotate/annotationModel.ts`, `annotationPrimitives.tsx`,
`annotationHit.ts`, `useStepAnnotations.ts`;
`components/diagram/DiagramDivisionsControls.tsx`; goldens
`diagram/annotate/__fixtures__/divisionsGolden.json` with
`divisions.cases.ts` and `divisions.test.ts`, and `diagramInk.test.ts`,
`stepDiagramGeometry.test.ts`, `paintAnnotations.test.ts`.

**The transform box.** New `lib/transformBox.ts` with its tests (the box
math out of `cp-workspace/annotations/annotationTransform.ts`, which
re-exports it, and `transformHandles`);
`cp-workspace/CanvasObjectOverlay.tsx` (`SelectionHandles` draws from
`transformHandles`; nothing on screen changes);
`cp-workspace/images/cpImage.ts` (`IMAGE_ROTATION_SNAP_RADIANS` names the
shared step); new `diagram/annotate/transformGrips.ts` (`transformBoxOf`,
`transformGripAt`, the drag) with its tests; `annotationHit.ts` (the
`transform` grip part), `useAnnotateCanvas.ts` (its drag, the hover
cursors, the undo labels); `components/diagram/DiagramAnnotateCanvas.tsx`
(`TransformBoxSelection`) and `DiagramAnnotateCanvas.module.css` (the
handles' and the cursors' rules); `DiagramLayers.tsx` and a new
`DiagramRotationRow.tsx` (R3-33 A); `analytics/events.ts`,
`analytics/trackDiagram.ts`, `docs/analytics.md`.

**Stars and the eye.** The shared primitive's five References modules
named in "Common ground"; `stepDiagramGeometry.ts` (`starDrawn`,
`eyeDrawn`, each with an angle and a scale), `diagramInk.ts`
(`DIAGRAM_STAR_INK`, `DIAGRAM_EYE_INK`);
`diagram/annotate/annotationModel.ts` (shapes, `POINT_KINDS`,
`createAnnotation`, carry, `flipsOver`), `annotationPrimitives.tsx`,
`annotationHit.ts`, `annotateSnap.ts`, `pictureSnap.ts`,
`annotateTools.ts`, `useAnnotateCanvas.ts`, `annotationEventKind.ts`,
`useStepAnnotations.ts`; `diagram/document/diagramFile.ts` (`angle`,
`scale`); `store/settingsStore.ts` (`diagramAnnotateStarFill`);
`components/diagram/DiagramAnnotateCanvas.tsx`, `DiagramAnnotateRail.tsx`,
`DiagramAnnotateToolGlyph.tsx`, `DiagramLayers.tsx`, new
`DiagramStarControls.tsx`; new goldens `stars.cases.ts` and
`eyes.cases.ts` with their fixtures.

**Shapes.** New `diagram/annotate/areaOutline.ts`;
`annotationModel.ts` (`carryArea` out of `carryZoom`, `placedByClick`),
`annotationPrimitives.tsx` (`areas`, reach), `paintAnnotations.ts` and
`components/diagram/DiagramAnnotationLayer.tsx` (the paint order),
`annotationHit.ts`, `useAnnotateCanvas.ts`, `applyAnnotationEdit.ts`
(tested, not changed); `diagram/zoom/stepView.ts` (`markExtent`);
`diagramFile.ts` (`to`, `angle`, `size`);
`components/diagram/DiagramAnnotateCanvas.tsx`; new golden
`areas.cases.ts`. `diagram/zoom/zoomGrips.ts` does not change: shapes take
the transform box.

**X-ray.** New `diagram/xray/xrayScene.ts`, `useXRayInsides.ts`,
`xray.surfaces.tsx`, golden `xray.cases.ts`; a new
`diagram/annotate/faceOverlap.ts` beside `behindFlaps.ts` (18.0 results,
2); no change to `paperFaces` (R3-16a A, amended), its faces fetched for an
older step through `giveDiagramStepPaperFaces`; `diagram/annotate/paintAnnotations.ts`,
`pictures/useStepPictureUrl.ts`, `pages/pagePictures.ts`,
`zoom/paintZoomed.ts` (`zoomedCardPicture`, `poseGhostMarkup`),
`export/stepFiles.ts` (read); `annotate/pictureSnap.ts` (R3-22 B);
`annotateTools.ts` (the held reasons); `diagram/zoom/useAnchorPick.ts`,
`useAnnotateCanvas.ts` (the area drag by kind), `diagram/zoom/stepView.ts`;
`components/diagram/DiagramZoomControls.tsx` and
`DiagramZoomControls.module.css` (the Anchor row out), new
`DiagramAnchorRow.tsx` with `DiagramAnchorRow.module.css`, and
`DiagramXRayControls.tsx` with its module if it needs styles. No kernel
change: the kernel's scene already carries everything R3-16 could store.

**All.** `keyboard/shortcuts.ts`, `diagram/actions/diagramShortcuts.ts`,
`i18n/shortcutLabels.ts`; `analytics/events.ts`, `analytics/trackDiagram.ts`,
`docs/analytics.md`; `public/locales/*` (nine catalogs);
`implementation-plans/diagram-workspace.md` (Phase 18) and
`implementation-plans/diagram-revision-2.md` (ED4 and ED9 revised).

## Checklist

**Every phase.** Reader and writer, with round trips and "an older build
keeps it verbatim"; `cleanAnnotation`; carry, flip, Turn Over and paste;
hit and grips; the canvas; the Layers pane; the tool window, the rail, keys
and shortcut labels; analytics with `docs/analytics.md`; i18n in all nine
catalogs. A test for each place in "Kinds the compiler does not check" the
phase's kinds touch. Tests that fail before their change, and a golden for
each new mark on card, page and canvas. New components styled by their own
CSS modules, and no rule added to a shared block. Before and after in the
browser, beside the note's picture it answers, on every surface the change
reaches: the canvas, a step card, an enlarged step's card, Pose's ghost
(the card, and the live 3D or simulated view), the page, print, the PDF at
print size and ×3, the one-sheet SVG and a ZIP step file; light and dark,
desktop Chromium and iPad-sized WebKit; each fix shown on its own with its
confidence and evidence. The crane loading with every mark known and
saving back byte-identical. A review of the phase. Nearby tests on each
commit, and the full gate at the end of each phase before its push: lint,
typecheck, the i18n check and the whole vitest suite (Node 22, run in the
web workspace). The builder owns every gate, the browser's included, and
shares the proof with Zach. What was built is written under each phase's
checklist.

### 18.0 The X-ray spike (nothing merges)

Whether R3-13 A can be drawn from what a step stores, and what storing more
would cost, measured on Zach's diagrams before anything is built. Output in
`artifacts/revision-3/xray-spike/`.

- [x] **The crane copied** into `artifacts/revision-3/crane.osf`.
- [x] **Depth 0.** The window's inside built from `paperFaces` with nothing
  removed (sides, places, outline roles, back to front by level), against
  the stored picture's own render in the same window, on every flat step of
  the crane, with and without a spread. Pass: pixel for pixel. This one
  check holds the sides, the spread's places and the outlines together.
- [x] **Stacks at an anchor.** On three flat crane steps, four anchors each,
  depth 1 to 3: the faces A removes, against the kernel's
  `faces_top_to_bottom` at the anchor, read from the linked pattern's
  paper scene (`engine/oristudioCpTypes.ts:529-586`). Pass: identical
  everywhere outside a woven patch (R3-16c).
- [x] **Across the window.** The share of each window where A's top face
  differs from a true drill's (R3-13 B). Evidence for R3-13; no pass mark.
- [x] **Sides.** Every face's side worked out from its rings (R3-16a A),
  against the kernel's `front_up`, on every flat step of Zach's four
  diagrams: the crane, the heart, the chipmunk and Reference Diagrams.
  Pass: all agree. Slivers listed. (Not box_90:
  `tests/fixtures/fold-angle-3d/box_90.osf` holds no diagram, so it has no
  flat steps.)
- [x] **Spread.** With an affine spread on, the inside drawn from the
  scene's face items lines up with the picture round it within 0.1 px.
- [x] **Speed.** On every frame of a window's drag on the crane's busiest
  step, in Chromium: A's inside rebuilt; and B's, its cells worked out once
  for the step and only clipped to the window per frame. Pass for A: under
  4 ms a frame. B's number is evidence for R3-13.
- [x] **Creases.** How many revealed faces carry `aux_lines` in the
  kernel's scene, and what storing them would weigh (R3-16b).
- [x] **Size (Z11).** Every key 18.0 would store (`sides` under R3-16a B;
  aux creases or cells if R3-16b or R3-16c turns to B), weighed on the four
  diagrams with every flat step refreshed and written as the app writes a
  file: Revision 2's `artifacts/revision-2/16c/paperFacesBudget.mjs` (in
  #436's worktree), copied here and extended to write the key. Pass: each
  file within 1% with the key. Otherwise the numbers go to Zach.
- [x] **Old steps.** A flat step from before Revision 2 gets its faces
  through `stepWithPaperFaces` while linked, and, with `sides`, a step
  stored before the key gets it the same way.
- [x] **Renders.** The crane's windows at depth 1 to 3, at print size,
  beside the note's picture, for Zach (the prototype is skipped).

Result: a pass builds 18e and 18f as planned. If the sides check fails,
R3-16a B is the only way. If a size check fails, the numbers go to Zach. If
the stacks fail, R3-16c B is put to Zach with its measured size, or X-ray
leaves this plan for one of its own.

#### 18.0 results

**Run 2026-10-08** on `claude/diagram-xray` (cut from #446 at
`3ea485fa5`), against its dev server on :5314. Scripts in
`artifacts/revision-3/18.0/`, output in `artifacts/revision-3/xray-spike/`,
both in `.claude/worktrees/diagram-xray/` and gitignored; nothing merges.
Each flat step is folded again as `captureStep` folds it (the store's
`createCpCaptureRuntime`, `openFold`, `foldToCase`, `readFoldedPicture`)
and its picture made by the real `flatPicture`. The X-ray is
`18.0/xraySpike.js`, what `xrayScene.ts` would be, calling the app's
`facesAt`, `facesOver`, `paperSceneToSvg` and `paperSceneSvgBody`. The four
diagrams hold 38 flat steps (crane 21, heart 8, chipmunk 8, Reference
Diagrams 1) and 834 faces. 36 steps have an affine spread; chipmunk #13 and
#15 have none, and every step was also refolded with none. Every refold
draws the stored picture but heart #15 (its link is stale) and Reference
Diagrams #5 (it folds to another picture now), checked on their refreshed
pictures. No step has a woven component, so the woven caveat is untested.

**Go.** Every check passes. Three pass only with a change to how 18e
builds A (1 to 3 below); none changes the design, and nothing found is a
large fork.

- **Depth 0: go.** 138 windows on the 36 spread steps (the whole picture,
  and three of the click's size, r 0.15, at checked anchors): drawn in the
  stored scene's order, the inside is pixel for pixel the stored picture's
  own items through the same clip, 138 of 138, and the whole-picture window
  is identical to the bare picture, 36 of 36. Drawn by level alone, 32 of
  138 differ (1,445 px, on 10 crane steps and 7 heart steps), all on
  strokes, where two faces with no order between them share an edge. Sides,
  places and outline roles (every stored face item draws its own outline,
  `outline: edge`) hold. Refolded with no spread, the inside differs on
  strokes only (144 windows, 0 px off a stroke): a buried face's outline
  lies on a visible edge and is drawn twice there. Any clip changes stroke
  edges in Chromium by up to 45/255 away from the rim, which the rim does
  not hide, so the comparison is against the stored items through the same
  clip, not the bare picture.
- **Stacks at an anchor: go.** Every flat step of all four, up to six
  anchors each, depth 1 to 3: 597 checks. The stack from `paperFaces`'
  levels is the kernel's `faces_top_to_bottom`, 597 of 597. What A removes
  matches the kernel's (the top N and every face over them in any cell),
  597 of 597, once "over" has a tolerance (2 below); with 15e's
  `facesOver` as it is, 590 (heart #14 to #16, 15 faces too many). On the 36
  spread steps (576 checks), read on the paper (1 below): 576 of 576; read on
  the drawn faces: 554 (crane #14, #16, #28, 44 faces too many).
- **Across the window** (evidence for R3-13). 597 windows of the click's
  size: A's top face differs from a true drill's (B) over a median 30% of
  a window (crane 44%), 90th percentile 71%, most 95%; the same in 69. A
  shows the page's white somewhere in 39 windows, at most 29% of one, where
  every layer at a point lies over the removed ones; B never does.
- **Sides: go.** Worked out from the turns of each ring (R3-16a A) against
  `front_up`: 834 of 834 agree, no sliver (the smallest face is 641 scene
  px² on the picture), no empty ring. Every stored face item's side is its
  face's `front_up` (1,019 items). So B is exact by construction, and A
  would work too.
- **Spread: go.** On all 36 spread steps every face is in the stored scene
  whole, corner for corner with its `paperFaces` ring; drawn from those
  items the inside is the picture's own pixels through the clip (0 px off).
  Drawn from `paperFaces`' unspread places it would be up to 62 scene px
  off (28 CSS px on a card).
- **Speed: go.** Crane #28 (52 faces, 28 cells, stacks to 24) and #20 (44
  faces, stacks to 36), a 120-frame drag with the click's window, depth 1
  to 3, A built as 1 to 3 below: a frame's inside, removal and markup
  (`paperSceneSvgBody`) take a median 0.05 to 0.075 ms, at most 0.47 ms;
  the step's own set-up once 0.15 to 0.54 ms; setting the markup into the
  page and laying it out 0.10 to 0.15 ms. At 4× CPU throttling, at most
  2.2 ms (95th percentile 0.91). B, its cells worked out once, 0.005 to
  0.01 ms a frame; it was never the cost.
- **Creases** (R3-16b). Faces nothing shows, which a window can reveal,
  carry aux creases: crane 41 creases on 41 of 518 such faces (18 of 21
  steps, 1 to 4 each), heart 120 on 50 of 108, chipmunk 40 on 10 of 18,
  Reference Diagrams none. Storing every face's aux creases would take the
  crane to 1.068% and the heart to 1.156%: over Z11. R3-16b A stands.
- **Size (Z11): go**, the crane with 223 bytes left. Each file with every
  flat step refreshed, against the same with no faces: crane +0.958% for
  `paperFaces`, +0.992% with `sides` (945 B for 630 faces); heart +0.669%,
  +0.691% (279 B); chipmunk +0.355%, +0.367% (162 B); Reference Diagrams
  +0.258%, +0.274% (18 B). Cells (R3-16c B) would be 2.201%, 1.714%,
  0.686%, 0.592%: not needed, and over Z11 on two.
- **Old steps: go.** Each flat step with `paperFaces` taken off, handed to
  the real `stepWithPaperFaces`: 36 of 38 get them back (crane 21, heart 7,
  chipmunk 8), byte for byte the stored ones where there were any (15 of
  15); heart #15 says Refresh (stale), Reference Diagrams #5 Refresh
  (redrawn). Its early return hands back every step that has faces (15 of
  15), so 18e extends it to fetch when `sides` is missing, as planned.
  (**Amended, see R3-16a:** 18e stores no `sides`, so the early return
  stands and nothing is extended.)
- **Renders.** `artifacts/revision-3/xray-spike/renders.png`, beside the
  note's picture, at print size (29 to 52 mm wide, drawn at 216 dpi), each
  tile's SVG in `xray-spike/svg/`: crane #10, #19, #25 and #28 at depth 1,
  2 and 3; #19 and #28 again in the note's colours (cream in front, tan
  behind); heart #14 and #16 in its own colours. Depth 1 takes off 1 to 5
  faces; depth 3 on #25 takes 34 of 44, its anchor's stack being 4. In the
  note's colours a window reads as the note's does: the rim, the layers
  under in the other side's colour, their edges.

**What 18e takes from it.**

1. **Stacks on the paper.** The `anchor` is a point on the paper, as the
   model says: a window's centre on a spread picture goes back to the paper
   through the face seen on top there (that face's drawn ring onto its
   unspread one, corner for corner), and the stack and "every face over"
   are read on `paperFaces`' unspread places. Never on the drawn faces,
   where the spread pushes flaps into one another.
2. **"Over" with a tolerance.** Two faces are over one another when they
   share a part wider than 1e-4 of the picture (its area over half its
   perimeter, about three of the stored 0.01 px steps), not by 15e's
   `facesOver` as it is: its crossing and hair tests take two faces meeting
   along a fold, whose stored corners cross by about 1e-5, as overlapping
   (heart #16's pair: 1.1e-5, where a true overlap is 0.086). A pure helper
   beside `behindFlaps.ts`, tested on the heart's pair. Whether 15e's own
   behind-flap marks meet the same false overlap on the stored scene is
   left with "Found while planning".
3. **The stored order.** The faces left are drawn in the stored scene's
   order (its whole face items, those with no `group`), and a face it
   dropped (no spread) by level among them, not by level alone.
4. Places from the stored scene's whole face items with a spread, from
   `paperFaces` with none.
5. The page's white inside a window, where A removes every layer at a
   point, is A's, not a gap; the tests expect it. (18f's review: on the
   paper only. Off it a window lays nothing, and what is under the picture
   shows through.)
6. Pixel tests compare a window with the stored scene's own items through
   the same clip, never with the bare picture.
7. With no spread, a revealed face's outline is drawn twice where it lies on
   a visible edge (2 of 38 steps have no spread); left as it is.

18f takes 6 for its parity test, and nothing else new.

**For Zach** (none of it a large fork):

- **The crane's budget.** It holds at 0.992%, 223 bytes under the cap. Its
  faces alone are 0.958% now (21 flat steps; 0.84% at 16c with 18), so a
  flat step or two more breaks Z11 on the crane with or without `sides`.
  `sides` costs it 0.034%. Built as recommended (R3-16a B) unless he says
  otherwise (**amended, see R3-16a:** decided A under his standing
  instruction, nothing stored, for the 223 bytes); R3-16a A, which stores nothing, agreed on all 834 faces, and a
  hex digit for four faces would cost a quarter.
  **Answered (2026-10-09):** "i don't care about this budget, please raise
  it or remove it … limit to 100mb or something". Z11 is a whole file under
  100 MB now, so no flat step breaks it. A stays: it is exact and stores
  nothing. Where R3-16b and R3-16c turned down storing aux creases or cells
  as over Z11, that reason has gone; they stand on their other grounds
  until one is reopened.
- **Creases inside a window.** Under R3-16b A a window draws no crease, even
  on a face it keeps, so a crease that runs into a window stops at its rim.
  The stored scene already holds the creases of every face that shows;
  carried with their faces, a window that removes nothing is the stored
  picture exactly (138 of 138), at no cost in the file. Only the creases of
  faces nothing showed (above) would be missing. A change to R3-16b A if
  he wants it; 18e does not need it.
- **White paper.** The Diagram preset's front is white like the page, so on
  the crane a revealed front-up layer reads as a hole and only its edges
  tell it apart (renders, rows 1 to 4). In the note's colours (rows 5 and
  6) it reads as the note does.

### Before 18a: the decisions (the prototype skipped; nothing merges)

The prototype is skipped. Zach, 2026-10-08: "Yes skip prototype, build
directly". What it would have shown is judged in each phase's before and
after in the browser, beside the note's pictures.

- Skipped: `artifacts/revision-3/revision-3-marks.html`, its "Copy picks"
  text, and its check against this plan.
- [x] Decisions R3-1 to R3-33 are recorded under each decision (the old
  list of unanswered choices was stale). R3-37 is accepted as A on
  2026-10-10. R3-21's later linked-fold carry fork and X-ray contrast are
  explicitly still for visual review, not silently resolved by this checkbox.

### 18a Equal divisions

- [x] **The aux pen**, a commit of its own: one pen (`auxMarkPen`), one
  path, `DivisionsPen` gone, the floors in ring pens (`markRingWidth` read
  directly), the comments. Tests:
  every stroke at the aux width in both presets; the line's width
  unchanged; the floor and the crowding warning unchanged at 32 parts on
  25 mm; reach.
- [x] Goldens re-recorded and checked by eye beside the note's screenshot.
- [x] Browser, before and after: the note's case rebuilt (a diagonal in
  three parts, the line set into the paper, a valley from the first third),
  on every surface in "Every phase", in both presets; the crane's pages
  compared for reflow, and a ZIP step file's crop.
- [x] **Short Dividers** (R3-1 A and R3-2 A; the count regular, R3-3 B):
  the field, its reader and
  writer, `cleanDivisions`, the primitive, `divisionsShape`, the hit-test
  twin, the Layers switch, `setShortDividers`. Tests: interior dividers
  straddle the line at 2.5 and 10 mm; the end dividers reach the measured
  line; nothing changes at 1 mm; snapping to the division points
  unchanged; a same-step paste keeps the flag; an older build keeps the
  mark verbatim.
- [x] `diagram mark styled`: the event, `trackDiagram.ts`, its row in
  `docs/analytics.md`.
- [x] Browser, before and after: the note's case with Short Dividers on,
  the valley line clear, on every surface.
- [x] `diagram-revision-2.md`: ED4 and ED9 marked "Revised by Revision 3".
- [x] Gate, on exactly what was committed: lint, typecheck, the i18n check
  and the whole vitest suite (Node 22): 889 test files and 12,016 tests
  pass (2 files and 15 tests skipped).
- [x] Push (PR #446).

**As built (2026-10-08).** Two commits, as planned: the aux pen alone
(`5b82674f1`: the count still bold, the golden's seven old cases), then
Short Dividers with the regular count, the event and the catalogs
(`8a0add3bd`). Nearby tests pass at each; at the first, tsc, eslint on its
11 files, and the diagram, References, panels and analytics suites (290
files, 4,041 tests).

- **The aux pen.** `rightAnglePen` is `auxMarkPen`
  (`stepDiagramGeometry.ts`), drawn by the right angle and equal divisions.
  `DIAGRAM_DIVISIONS_INK` lost `pens` and is `as const`; `DivisionsPen` is
  gone. `DivisionsDrawn.pens` is `pen`; `divisionsPathData` returns one
  `d` in `divisionsStrokes`' order (the line, the dividers, the ticks),
  drawn as one `<path>`; `markReach` pads every stroke end by half the one
  pen. The spacing floor reads `markRingWidth(project)` in `divisionsDrawn`
  and the table's ring pen in the hit twin (`divisionsInPicture`), so a
  part crowds where it did. The ink is still `ink.mark`.
- **The count** (R3-3 B): `fontWeight` 700 to 400 on the count's `<text>`,
  nothing else of it moved. The page reads the weight off the markup
  (`setUploadText`), so the PDF and the SVG embed Noto Sans Regular's digits
  for it; `loadDiagramFonts` always loads Latin 400 and 700, so there is no
  new fetch. In the theme-styled (non-inline) drawing the count carries
  only its class and was never bold.
- **Short Dividers.** `shortDividers?: true`, read with `readFlag` (as Bold
  and halo are), in `ANNOTATION_FIELDS.divisions`, written only when true;
  `withShortDividers`, `cleanDivisions`; `shortDividers: boolean` on the
  References primitive and `DivisionsLook`, passed by the compile and the
  hit twin (its `Pick` is now `DivisionsFields`). In `divisionsShape` the
  dividers between the ends start at `offset − overshoot` instead of
  `min(0, offset − overshoot)`, the same at 1.65 mm or less. The canvas's
  selection wash uses the hit twin, so it follows them too.
  `divisionsFootprint` is untouched.
- **Layers.** A Short Dividers `ToggleRow` under Number in
  `DiagramDivisionsControls`, with its help; `setShortDividers` in
  `useStepAnnotations`, one undo step ("Change equal divisions"), sending
  `diagram mark styled` (`kind`, `option: short_dividers`, `value`) only
  when the mark changes. i18n: `panels:diagram.annotations.shortDividers`
  and `shortDividersHelp` in all nine catalogs.
- **Tests**, each new one failing without its change (checked by reverting
  the weight, the inner start, the file field and the hit twin's flag one
  at a time): `stepDiagramGeometry.test.ts` (the one pen, the floor at 32
  parts on 25 mm, short dividers at 2.5 and 10 mm, unchanged at 0, 1 and
  1.65 mm), `paintAnnotations.test.ts` (one path at the aux width in both
  presets, the count at 400, reach), `diagramFile.test.ts` (round trip,
  unsaid when off, damage, an older build keeps it verbatim),
  `annotationModel.test.ts` (carry, mirror, flip, F, clean),
  `annotationHit.test.ts`, `annotationClipboard.test.ts` (same-step and
  other-step paste), `pictureSnap.test.ts` (division points unchanged),
  `DiagramLayersPanel.test.tsx` (the switch, undo, the event),
  `DiagramAnnotateCanvas.test.tsx` (the selection wash's interior dividers
  start 1.65 mm short of the line, the end ones reach it),
  `trackDiagramMarkStyled.test.ts`, `referenceFinderStepInModel.test.ts`,
  `diagramInk.test.ts`.
- **Goldens.** `divisionsGolden.json` re-recorded, with `diagonal-short`,
  `note-short` and `offset-1-short` added. For the seven old cases on the
  card, the page and the canvas (`artifacts/revision-3/18a/goldenDiff.txt`)
  every stroke end is identical; two paths are one, at the old line's
  width; the count is in the same place at 400; the reach is smaller only
  where a divider's or tick's end was the extreme (0.44 px on the card,
  0.21 pt on the page). `offset-1-short` is byte-identical to `offset-1`.
- **Weights in the PDF** (`artifacts/revision-3/18a/18a-evidence.png`,
  scripts in `18a/verify/`). The note's case, rasterised by pdftoppm at
  2400 dpi, each stroke measured beside the step's aux crease. Diagram
  preset: the crease 0.260 pt; the line, dividers and ticks 0.254 to 0.255
  (the dividers 0.568 before). Default: the crease 0.504; the mark 0.504 to
  0.509 (0.795 before). The content stream sets one path of 8 strokes at
  0.25 pt (0.5 in the Default), where before it set the line at 0.25 (0.5)
  and the other seven at 0.5625 (0.7875). The count is NotoSans-Regular 9 pt
  where it was NotoSans-Bold, in the same place. With Short Dividers the
  interior dividers are 3.31 mm and the end ones 13.65 mm, and the valley
  line is clear.
- **Browser** (`18a-evidence.png`, `18a-before-after.png`). The note's case
  on the crane's step 2, and a mark inside step 23's enlarged window. Before
  (HEAD db3eeae59's source), after and with Short Dividers: Chromium light
  and dark, the canvas and the card; in light, both presets, also the
  enlarged step's card, Pose's ghost (the card at Pose's opacity), the page
  cell, the PDF at 96 and 288 dpi, the one-sheet SVG and a cropped ZIP step
  file. iPad-sized WebKit, after only, by touch: the switch tapped on and
  off in the Settings sheet's Layers, one undo step each. The crane's 29
  page cells are identical before and after in both presets; step 2's
  picture moves 0.078 pt in its cell, its reach 0.156 pt smaller each way,
  at the same scale, and the cropped step file shrinks by the same. Every
  test diagram reads with nothing locked or unknown and writes back
  identical (Reference Diagrams' retired `page.scale` differs as it did
  before 18a).
- **Not shown in the browser:** Pose's live 3D and simulated ghosts (step 2
  is a References step with no live view; the ghost markup is the same
  `annotationMarks`), the print dialog (the same composed pages as the
  PDF), and a before in WebKit.
- **Review fixes.** `fr/panels.json` keeps its no-break spaces literal, as
  in HEAD, so its diff is the two new keys like every other catalog's;
  `divisions.test.ts`'s header names the aux pen, the regular count and
  Short Dividers; the selection-wash test above.

**For Zach, not decided by this plan** (from the review). Both DECIDED,
Zach, 2026-10-08: "go with your recs from now on unless there is a large fork in the design to be figured out, until i say otherwise": the first gets a hint, built in 18b
(18b, As built); the second is left as it is, the count in the regular
weight (R3-3 B), no halo and no new place.
- At an offset of 1.65 mm or less, Short Dividers changes nothing, as R3-2 A
  says, and at 2.5 mm, where a new mark is laid, an interior divider still
  starts 0.85 mm off the measured line, so a fold crossing there is still
  drawn over until the line is dragged further out. The switch still turns
  on, and nothing says why the drawing does not change. Should the help say
  the switch shows only once the line stands more than 1.65 mm off?
- In the note's case the count sits on the square's other diagonal crease,
  where it always did. Regular weight (R3-3 B) makes it harder to read over
  that crease at print size than the bold was
  (`artifacts/revision-3/18a/review/36-count-600dpi-before-after.png`,
  `37-print-size-96dpi-before-after-x3.png`, and `18a-evidence.png`'s
  600 dpi counts). A halo like a label's, or a different place for the
  count, would be a decision of its own.

### 18b Stars

- [x] **The shared box**, a commit of its own that changes nothing on the
  Edit canvas: `lib/transformBox.ts`, the box math moved out of
  `annotationTransform.ts` (re-exported there) with its tests;
  `transformHandles`, which `SelectionHandles` draws from; the
  about-the-centre option on `resizeAnnotationBox` (R3-29b A, R3-29c A).
  Tests: the moved tests; `transformHandles` gives eight squares, or four
  under `always`, and four turn handles 18 px out along each corner's
  diagonal; the option keeps the centre put; `CanvasObjectOverlay.test.tsx`
  passes unchanged. Browser: a reference image on the Edit canvas selected,
  resized with and without Shift, and turned with Shift, before and after,
  its handles where they were.
- [x] **The Diagram's box**: `diagram/annotate/transformGrips.ts`
  (`transformBoxOf`, `transformGripAt`, the `transform` grip part and its
  drag), `TransformBoxSelection` and its module's rules, the hover cursors,
  the undo labels, and R3-30c's floor after a 3 mm star is measured on
  screen. Tests: `transformGripAt` takes a square, a turn handle or the
  body at zoom 1 and 4, and at a finger's reach; Shift holds a turn to 15°
  steps (R3-28 A); a resize stays in its range; one undo step per drag and
  none for a click; the cursors; no handles on a diagram that cannot
  change.
- [x] Geometry: `starDrawn`, `DIAGRAM_STAR_INK`. Tests: ten points, one up
  at angle 0; turned by its angle and scaled by its scale; not turned by a
  turned or a mirrored projector; reach with mitred tips, turned and
  scaled.
- [x] The primitive through the five References modules; drawing, filled
  and outlined, on and off the paper.
- [x] Model and file: the kind, `fill`, `angle`, `scale`,
  `cleanAnnotation`, the switches. Tests: round trip; `to` read as `from`;
  an unknown fill, or a scale past R3-30a's range, is a newer build's and
  kept verbatim; an angle read normalized; a scale that does not read is
  damage.
- [x] Tool: the click, snapping and ⌘, the rail's Fill control and its
  setting, the key, help. Tests: placed on a crossing; a Line snaps to it.
- [x] Hit at its scale; the box, corners only, scaling about its centre (a
  star snapped to a crossing stays on it); the drag; the Layers row, the
  Fill row and the Rotation row; a carry keeping its angle and scale
  (R3-32 A), Turn Over, paste and the enlarged window, with `markExtent`
  keeping a turned, scaled star at a window's edge.
- [x] Analytics (`star`, `fill`; `diagram mark styled` for Fill, size and
  rotation) and i18n (the Rotation row, the undo labels).
- [x] Golden `stars.cases.ts`: filled and outlined, turned and scaled, on
  white, on a References face, off the paper.
- [x] Browser, before and after: a filled and an outlined star on a crane
  crossing beside the sample, a dashed line from one, on every surface; a
  star scaled and turned by its box, beside an image's box on the Edit
  canvas; a small star at the canvas's usual zoom; the rail at phone width.
- [x] Gate, on exactly what was committed: lint, typecheck, the i18n check
  and the whole vitest suite (Node 22): 892 test files and 12,093 tests
  pass (2 files and 15 tests skipped).
- [x] Push (PR #446, `3ea485fa5`).

**As built (2026-10-08).** Three commits: 18a's follow-up hint
(`8b8370e7f`), the shared box, changing nothing on the Edit canvas
(`fa232db37`), then stars with the box on the Diagram canvas
(`98725b534`). Every decision used is recorded DECIDED above (Status).

- **18a's hint** (`8b8370e7f`). While Short Dividers is on and the line
  stands 1.65 mm or less off the line it measures, a note under the switch
  says "Short dividers show once the line is more than 1.65 mm out. Closer
  than that, every divider already reaches across the line." A note, not
  the help: the help is a hover tooltip, and the moment that needs saying
  is the switch turning on with nothing redrawn. `shortDividersShow`
  (`annotationModel.ts`) is the one test, `offset >
  SHORT_DIVIDERS_FROM_MM` (`DIAGRAM_DIVISIONS_INK.overshoot` ×
  `ANNOTATION_INK_MM`, 1.654 mm), held by a test to what `divisionsShape`
  draws at 0, 1, 1.6, 1.7, 2.5 and 10 mm. The note puts the number in as
  `{{mm}}`, formatted for the language (1,65 in French and Russian); a test
  holds every catalog to `{{mm}}` and no digits. The count stays regular:
  nothing changed.
- **The shared box** (`fa232db37`). `lib/transformBox.ts` holds
  `TransformBox`, the handle names, `HANDLE_SIGNS`,
  `CORNER_RESIZE_HANDLES`, `MIN_BOX_EXTENT`, `boxCornersModel`,
  `resizeAnnotationBox` (now with `{ aboutCentre }`), `AspectLockPolicy`,
  `resizeAspectLock`, `snapAngle`, `boxContainsModelPoint`,
  `transformHandles`, and the sizes as constants (8 px squares, 5 px turn
  handles 18 px out, 1.5 px strokes, the 15° step, which
  `IMAGE_ROTATION_SNAP_RADIANS` now names). `annotationTransform.ts`
  re-exports it under its old names, so no importer changed; the moved
  tests are `lib/transformBox.test.ts`. `SelectionHandles` draws from
  `transformHandles`. **Where the code proved the plan wrong:**
  `transformHandles` takes the box's four corners as drawn, with
  `{ cornersOnly, rotateOffset }`, not `(box, aspectLock, rotateOffset)`:
  the Edit canvas lays its handles out on corners projected through a
  `CpOverlayView` that can flip or stretch, so a box signature would have
  moved them under such a camera. The Diagram passes
  `boxCornersModel(box)`. Proof (`artifacts/revision-3/18b/editbox/`,
  `capture.mjs`): a reference image on the crane's crease pattern selected,
  resized by a corner with and without Shift, by an edge, and turned with
  Shift, light and dark: all twelve screenshots pixel-identical and every
  handle's attributes byte-identical, before and after, and again on the
  committed tree (`verify-*`). `CanvasObjectOverlay.test.tsx` passes
  unchanged.
- **Model and file** (`98725b534`). Kind `star`, a `point` kind after
  `circle`: `fill?: 'black'` (unsaid, outline), `angle?` (degrees
  clockwise in [0, 360), unsaid upright), `scale?` (unsaid 1, held to
  `GLYPH_SCALE`, 0.5–4, which the eye will share). `ANNOTATION_FIELDS.star`
  = `fill`, `angle`, `scale`: an unknown fill or a scale past the range is a
  newer build's, kept verbatim; a scale that is not a positive number is
  damage; an angle that does not read is dropped alone; `to` is read as
  `from`. Every exhaustive switch says what a star is: no ends, path, text
  or colour (R3-23 A), nothing behind a flap, no Flip. A carry moves only
  its centre (R3-32 A), so Turn Over, a paste and the enlarged window keep
  its angle and print size; `markExtent` takes its turned box.
- **Drawing.** `DIAGRAM_STAR_INK = { radius: 4.5, inner: 0.382 }`, about
  3 mm across; `starPoints` and `starDrawn` (`stepDiagramGeometry.ts`),
  placed by the projector, never turned or mirrored by it. The primitive
  through `referenceFinderDiagramToPrimitives`, `DiagramPrimitives`
  (filled: one `ink.mark` path, no stroke; outlined: the sheet's fill and
  the ring pen, mitred at `STAR_MITER_LIMIT` 4, 0.5625 pt in the Diagram
  preset), `markReach`, `foldSymbolFade` and
  `referenceFinderStepInModel`.
- **Tool.** Star after Circle in Marks, key K (`diagram.toolStar`, through
  the registry); it snaps as a Circle does, ⌘ to put it down freely, and
  its centre is a `point` snap target (R3-24 A). The rail's Star Fill
  (`DiagramStarFillControl`), Filled | Outline, under Marks while the tool
  is in hand, kept as `diagramAnnotateStarFill` (type in
  `diagram/annotate/starFill.ts`, so the settings store does not import
  the tool records); the tool's icon is the star it lays. The tool window
  adds "With Select, Shift-drag a round handle at a corner to turn it in
  15° steps."
- **The box** (`diagram/annotate/transformGrips.ts`). `boxedMarkOf`, an
  exhaustive switch, gives each boxed kind's box (a star's: the square of
  its tips at its scale, turned by its angle), whether it keeps its
  proportions, its turn, and its `resized` and `turned` writers, so the
  eye (18c) and shapes (18d: a `size`, a turn in [0, 180)) cannot get a
  box without saying how they are written; `transformBoxOf` and
  `hasTransformBox` read it. `drawnTransformBox` never draws it under
  24 screen px (R3-30c B); `transformBoxHandles` lays out corners only
  (R3-29a A) from `transformHandles`. `transformGripAt`: inside the box a
  handle takes only a press on it as drawn (a square's 8 px, a turn
  handle's 5 px circle); the press's reach (8 px mouse, 18 px finger)
  extends only outward. `transformDragged`: a square scales about the
  centre (R3-29b A) as the pointer's travel since the press draws it out,
  held to 0.5–4; a turn handle turns by the pointer's angle about the
  centre, Shift to 15° (R3-28 A); turns, typed or dragged, kept to 0.01°
  and scales to 0.001. `HitSizes` gained `px` (one screen px in picture
  units); `hitAnnotation` asks the box first for a selected star; a star's
  body is within its tips' reach plus half an ink, and a star covers an
  earlier circle inside its outline. `useAnnotateCanvas` makes each drag
  one undo step ("Resize annotation", "Rotate annotation"; none for a
  click), sends `diagram mark styled`, and sets `data-transform-hover`,
  which the module turns into move, pointer and grab cursors, Space's grab
  winning. `TransformBoxSelection` draws `.transformBox` and
  `.transformHandle` with strokes of `TRANSFORM_STROKE_PX / zoom`:
  `non-scaling-stroke` does not see react-zoom-pan-pinch's CSS transform.
  No handles on a diagram that cannot change. A 3 mm star is 34 px across
  at the crane's fit (57%), so the floor shows below about 40%.
- **Layers.** A star's row glyph is in its own fill; `DiagramStarControls`
  (Fill, "Change star") and `DiagramRotationRow` (degrees, wrapped as an
  image's, "Rotate annotation"), through `setStarFill` and `setMarkAngle`.
- **Analytics and i18n.** `diagram annotation added` with `tool: star` and
  `fill`; `diagram mark styled` with `kind: star` and `fill` | `size` |
  `rotation`, valued `filled` | `outline` | `handle` | `field`;
  `docs/analytics.md`. Strings in all nine catalogs, stamped. The undo
  labels are internal, as all of the Diagram's are.
- **Tests**, each failing without its change: `lib/transformBox.test.ts`,
  `transformGrips.test.ts` (including a finger and a mouse on the middle,
  off it and on both lower arms at an iPad's fit and at the floor; a press
  off a square's middle not jumping the star), `stepDiagramGeometry`,
  `paintAnnotations`, `diagramFile`, `annotationModel`, `annotationHit`,
  `pictureSnap`, `stepView`, `DiagramAnnotateCanvas.test.tsx` (laying,
  snapping, the box, resize, Shift turn, move, cursors, coarse-pointer
  moves, strokes per zoom, read-only), `DiagramLayersPanel.test.tsx` (Fill,
  Rotation, a typed 12.345 stored as 12.35, the 18a note),
  `DiagramAnnotateRail.test.tsx`, `settingsStore.test.ts`, and the golden
  `stars.cases.ts` / `starsGolden.json` (filled and outlined, turned and
  scaled, half size, off the paper, on a References step's grey back).
- **Review fixes**, from two reviews of the first build: a finger on a
  selected star scaled it (the 18 px reach was more than a corner's 17 px
  from the middle of a box at its floor); the box's strokes followed the
  zoom (0.85 px at the fit, gone below 40%); a scale drag jumped on its
  first move; a press on a star's arm took a circle drawn under it; the
  drag wrote a glyph's fields for any boxed kind; a typed Rotation wrote
  12.345000000000027; and the note's number was written into the words.
  Each is fixed as described above, with a test that fails without it.
- **Browser** (`artifacts/revision-3/18b/18b-evidence.png`; scripts in
  `verify/`, `fixes/`, `editbox/`). On the crane's step 1, Chromium light
  and dark: K, a filled star snapped to the middle crossing, Star Fill to
  Outline and an outlined star on the right edge's crease end, a valley
  line snapped to the star; selected, the cursors; scaled to 2 about its
  point; turned to 45° with Shift; Layers' Fill and Rotation; at 10% a
  24 px box round a 6 px star; the 18a note at 1 mm, gone at 2.5 mm; the
  card, the page cell, the PDF at 288 dpi and the one-sheet SVG (outline
  mitred); the file round trip identical; no console errors. iPad-sized
  WebKit by finger: the star tapped on and selected, a square dragged
  (scale 2, still on the crossing), a turn handle dragged (50°), the body
  dragged (a move). The box's strokes 1.49–1.5 px on screen from 10% to
  661% in Chromium and WebKit. An enlarged step's card, Pose's ghosts and
  two ZIP step files draw turned, scaled stars.
- **Not shown:** the rail at phone width, where Annotate is not offered
  ("Annotate on a larger screen"); iPad-sized WebKit stands for it.
- **Left for a change of its own:** the Diagram's older grips (`.handle`:
  end dots, zoom grips, right-angle grips) have the stroke fault the box
  had, from before 18b: about 5 px at 343% and faint below 40%. The fix is
  the same, `strokeWidth={1.5 / zoom}` and no CSS width.

### 18c The eye

- [x] Geometry: `eyeDrawn`, `DIAGRAM_EYE_INK`. Tests: its open side faces
  its angle at 0°, 90° and 217°; scaled; a mirrored projector.
- [x] The primitive through the five References modules; drawing.
- [x] Model and file: the kind, the `sight` class, `angle`, `scale`; `to`
  read as `from`. Tests: round trip; a scale past R3-30a's range is a newer
  build's and kept verbatim.
- [x] Tool: the drag setting its angle, the click, Shift's 15°, the key,
  help. The box: corners only, scaling about its centre, and turning it.
  Tests: move, scale, turn, Shift; the `corner` and `direction` grips never
  offered on an eye.
- [x] Hit inside its turned box; the Flip row (Horizontal to 180° less its
  angle, Vertical to its negative) and F; the Rotation row; carry through a
  mirror and a quarter turn, Turn Over, paste.
- [x] Analytics and i18n.
- [x] Golden `eyes.cases.ts`, turned and scaled.
- [x] Browser, before and after: an eye on the crane beside the note's
  picture and the template's, at print size, scaled and turned by its box,
  on every surface.
- [x] Gate, on exactly what was committed: lint, typecheck, the i18n check
  and the whole vitest suite (Node 22): 893 test files and 12,147 tests
  pass (2 files and 15 tests skipped).
- [x] Push (PR #446, `3ea485fa5`).

**As built (2026-10-08).** One commit, `1a66a3cc9` ("Diagram: the eye"),
which includes the review's fixes. R3-8 A, the one decision 18c still
needed, is recorded DECIDED above. Evidence:
`artifacts/revision-3/18c/18c-evidence.png` (`composite.py`).

- **Drawing.** `DIAGRAM_EYE_INK = { length: 15, spread: 4.8, cornea: 13.5,
  bulge: 0.5, iris: 1.2 }` (`diagramInk.ts`), measured off the note's
  picture: lids 4.96 mm long meeting at 35.5° behind and running half a
  millimetre past the cornea, and a half-circle iris about 0.8 mm across on
  the cornea's middle. `eyeShape(centre, look, ink)`
  (`stepDiagramGeometry.ts`) is the one place the shape is decided; the
  drawing, its reach and the rail's icon all take it. `eyePathData` is one
  path: the lids as one run mitred at the back (`EYE_MITER_LIMIT` 4), the
  cornea arc, and the iris as two quarter arcs, so no renderer has to guess
  a half circle's sweep. Aux pen (R3-26 A), `ink.mark`, butt ends, no fill,
  on and off the paper.
- **The primitive** `{ kind: 'eye', at, angle, scale }` through the five
  References modules. **Where the plan was loose:** it did not say which
  space `angle` is in. It is the sheet's y-up direction (cos, −sin), and
  unlike a star's turn it is projected: `eyeDrawn` takes the look direction
  through the projector's basis and `diagramInModel` through the frame, so
  a turned or mirrored picture turns the eye with the paper. The glyph is
  symmetric, so it is never mirrored as a glyph. `markReach` takes the lid
  ends and the back corner's mitre.
- **Model and file.** Kind `eye`, new shape class `sight` (not `point`, not
  `corner`), with `angle?` (degrees clockwise from looking right, in
  [0, 360)) and `scale?` (`GLYPH_SCALE`, shared with the star). `cleanStar`
  became `cleanGlyph`, which never keeps a fill on an eye.
  `ANNOTATION_FIELDS.eye` = `angle`, `scale`; `to` is read as `from`; a
  scale past the range is a newer build's, kept verbatim; one that is no
  positive number is damage; an angle that does not read is dropped alone.
  The turn and scale precision moved from `transformGrips.ts` to the model
  (`keptTo`, `GLYPH_ANGLE_PRECISION`, `GLYPH_SCALE_PRECISION`), so a laid
  or carried eye is kept to 0.01° as a dragged one is.
- **Tool (R3-8 A).** Eye in Marks after Equal Divisions, key Y
  (`diagram.toolEye`, bound nowhere else). `eyeLooking` lays it at the
  drag's start looking toward its end, Shift holding 15° steps; a click, or
  a drag shorter than a slip, looks at the frame's middle (at the middle
  itself it looks right, no angle written). One undo step; the tool stays
  in hand. Its centre is no snap target, since the viewer often stands off
  the paper. The Shift line reads "Shift-drag to set the way it looks in
  15° steps." The box line has a key of its own (`eyeBoxShiftKey`), because
  the star's translations name the star or agree with it in five
  languages.
- **The box.** `boxedEye` and `boxedStar` both go through `boxedGlyph`: the
  lids' length along the look by their spread across, corners only, scaled
  about the centre within 0.5–4, its turn handles turning the look.
  **Where the code proved the plan's floor too narrow:** `drawnTransformBox`
  assumed a square glyph. It now grows a box about its centre in its own
  proportions until its shorter side is 24 px (R3-30c B); a star's is
  unchanged. `hitAnnotation` asks the box first for a selected eye, so the
  `corner` and `direction` grips are never offered. Its body is its turned
  box plus a press's reach (`boxDistanceModel`) and, while selected, the
  box as drawn.
- **Flip and Layers (R3-9b A, R3-33 A).** The Flip row turns it about its
  centre: Horizontal to 180° less its angle, Vertical to its negative,
  through `carryEye`. Flip (F) has it look the other way, half a turn on;
  it is named "Flip" and drawn with a two-way arrow (`ArrowLeftRight`)
  rather than Flip Vertical's mirror. The Rotation row goes through
  `setMarkAngle`; the row's glyph, `EyeGlyph`, looks left as the note's
  does. A carry through a quarter turn turns it a quarter, a mirror and
  Turn Over reflect it, and a paste moves it.
- **Analytics and i18n.** `tool: eye` (`snap: none`); `diagram mark styled`
  with `kind: eye` for size and rotation; `docs/analytics.md`. Four strings
  (`toolEye`, `eyeHelp`, `eyeShiftKey`, `eyeBoxShiftKey`) in all nine
  catalogs, stamped.
- **Tests**, beside each change: geometry (0°, 90°, 217°, scale, pen,
  turned and mirrored projectors, the path), paint, file, model (lay,
  Shift, click, clean, Flip, F, carry), grips (box, proportional floor,
  scale, turn), hit, actions, clipboard, snap, `markExtent`, References,
  the rail, the canvas and Layers, and the golden `eyes.cases.ts` /
  `eyesGolden.json` (right, left, 217°, down at ×2, half at 300°, off the
  paper, on a References face; its recorder is
  `18c/eyes.record.test.ts.txt`).
- **Browser**, re-run on the committed code (`run.mjs` light and dark,
  `ipad-touch.mjs`, `review-fixes.mjs`). Chromium on the crane's step 1: Y;
  a drag (30.76°), a Shift-drag (210°) and a click (looking down at the
  middle); the move, pointer and grab cursors; a corner drawn out to ×1.5
  about the centre; a Shift turn to 75°; Flip H 105°, Flip V 255°, F 75°,
  Rotation −30 to 330°, each one undo step; the card, the page cell, the
  PDF (pdftoppm, 96 and 288 dpi), the one-sheet SVG, three ZIP step files,
  an enlarged step's card and Pose's ghosts; the round trip identical;
  light and dark alike; no console errors. At 15% a press 17 px out (past
  the eye's own box and reach, inside the drawn box) moves it. iPad-sized
  WebKit by finger: laid by a drag (37.15°) and a tap (270°), scaled ×1.5,
  turned 60°, moved. The note's eye, ours and the Origami House template's
  side by side, magnified and at 288 dpi: `18c/note-vs-ours.png`; before
  and after: `18c/before-after.png`. Not shown: the rail at phone width
  (Annotate is not offered there) and the print dialog (the PDF's pages).

**Review (2026-10-08), fixed in the commit.** A press inside a selected
eye's or star's box drawn at its 24 px floor, but past the glyph's own
box, took nothing and let the mark go (the two "24 px floor" cases in
`annotationHit.test.ts` fail without the fix). The turned box's distance
had been copied into `annotationHit.ts`; it is now `boxDistanceModel` in
`lib/transformBox.ts`, which `boxContainsModelPoint` asks. F on an eye
wore Flip Vertical's icon. The Shift line said "turn it" while laying.

**Left for a change of its own** (since 18b or older, not the eye's; both
fixed in 18d, each as a commit of its own, 18d As built):
- With a mark's tool still in hand, the new mark's box is drawn, but a
  drag on its handles lays another mark (a star with K does the same).
  Either the handles take the press before a draw (`transformGripAt` in
  `useAnnotateCanvas`), or the box is drawn without handles while a tool
  is in hand.
- An eye or a star pasted from a whole step onto an enlarged step of
  another picture lands outside the window, selected but not drawn
  (`annotationClipboard.ts`); eyes, often off the paper, will meet it
  most. A pasted mark outside the window could be brought into view as a
  close-up's `bringIntoView` does.

**For Zach, not decided by this plan** (settled 2026-10-08 as recommended,
under Zach's standing instruction: the ring pen, recorded under R3-26, and F
as Flip Horizontal, recorded under R3-9b; built in 18d's first commit).
- **The eye's pen.** In the aux pen (R3-26 A: 0.25 pt in the Diagram
  preset) the eye reads as a hairline beside the creases and arrows on the
  card, the page cell and the PDF, much lighter than the note's sketch or
  the template's 0.75 pt eye (`18c/note-vs-ours.png`, `note-vs-pdf288.png`).
  The ring pen (0.5625 pt, a star outline's) would be closer. It is a
  one-line change, but it changes R3-26.
- **What F does to an eye.** Built as a half turn, so it looks the other
  way (30° to 210°); Flip Horizontal gives 150° and Flip Vertical 330°.
  R3-9b A asks only that one click turn a left-looking eye to look right,
  which a half turn and Flip Horizontal both do. F as Flip Horizontal would
  repeat the Flip row.

### 18d Shapes

- [x] 18c's follow-ups, first, a commit of their own: the eye in the ring
  pen (R3-26, amended) and F as Flip Horizontal (R3-9b, amended), with
  before and after of the eye on a page.
- [x] 18c's two older faults, each a commit of its own with a test that
  fails before it: a drag on a just-laid mark's handles with its tool
  still in hand; a mark pasted onto another picture's enlarged step
  outside its window.
- [x] `areaOutline.ts`: an ellipse's and a rectangle's outline and rim
  distance, turned. Tests: rim distance against sampled points; turned.
- [x] Model and file: two kinds, `size`, `angle`. Tests: round trip; `to`
  read as `from`; a missing `size` is damage; a size past R3-30b's range is
  a newer build's and kept verbatim; an angle read within [0, 180).
- [x] Drawing: the `areas` list, its paint order and its reach. Tests:
  reach, failing if the list is left out of `annotationReach`; a shape,
  turned too, under a Valley Line and an arrow; `markExtent` keeping a
  shape that reaches into an enlarged window from outside, unbadged.
- [x] Tool: corner to corner, Shift, Alt, a click's standard size
  (`placedByClick`); the Shapes group, keys, help.
- [x] The box in place of any `zoomGrips`: eight squares with R3-29c's keys
  and R3-30b's range, the turn handles; hit by the rim in the `under`
  order, and inside a selected shape's box behind every mark (R3-31 A).
  Tests: a corner with the opposite held, with Shift and with Alt; an edge;
  a turn with Shift; a line inside a selected oval is taken first, and
  empty paper inside it moves the oval; a line inside an unselected oval is
  selected by a press inside it; deleting a shape sends no enlargement
  event.
- [x] Carry (`carryArea`) through a spread and a mirror, a turned shape
  included; paste into an enlarged window grows with it; the Rotation row.
- [x] Analytics and i18n.
- [x] Golden `areas.cases.ts`, turned shapes included.
- [x] Browser, before and after: five upright ovals ringing five areas, as
  the turtle's do; a rectangle round a flap; a shape turned and resized by
  its box, beside an image's box on the Edit canvas (18b's); on every
  surface; the rail on an iPad, and the phone. Not shown: the turtle's
  sample and a 60° grid capture (neither is on disk here: the crane is
  22.5°), so the ovals are on the crane's step 7.
- [x] Gate, on exactly what was committed: lint, typecheck, the i18n check
  and the whole vitest suite (Node 22): 895 test files and 12,218 tests
  pass (2 files and 15 tests skipped). Each of the first three commits,
  exported alone, typechecks and its tests pass.
- [x] Push (PR #446, `7cdbd6f89`).

**As built (2026-10-08).** Four commits, each with the review's fixes
that belong to it: `b18fb0072` (the eye's pen and F), `00d69cf0e` (a new
mark's box answers its own tool), `ff9c7fc45` (a paste onto another
picture's enlarged step stays in view) and `073db6fe6` ("Diagram: ovals
and rectangles"). The first three were cut from cumulative patches
(`artifacts/revision-3/18d/stage-*.patch`); exported alone, each
typechecks and its related tests pass (7 files and 327 tests, 2 and 139,
5 and 182), and its new tests fail on the commit before it. The box
lines' rewording (`starShiftKey`, `eyeBoxShiftKey`) rides in the shapes
commit with the shapes' strings, since the catalogs are shared. Every
decision used is recorded DECIDED above (Status), but R3-37. Evidence:
`artifacts/revision-3/18d/18d-evidence.png` (`composite.py`), every shot
re-taken on the committed code.

- **The eye's pen and F** (commit 1). `eyeDrawn` strokes in
  `markRingWidth`, as an outlined star does: 0.5625 pt in the Diagram
  preset, 0.7875 in the Default (`eyesGolden.json` re-recorded with the
  18c recorder). F on an eye: `flipsArc('eye')` is false again, and a new
  `flipKeyAction` / `flipKeyEdit` in `annotationActions.ts` say which verb
  F runs on a mark — Flip Arc where an arc flips, an eye's Flip
  Horizontal — and null where it would change nothing (a straight arrow;
  an eye looking straight up or down), so the key falls through.
  `useDiagramShortcuts` asks it for the gate and the edit. The Flip row's
  Horizontal carries F's chord on an eye, the eye's own Flip button and its
  two-way-arrow icon are gone, and F on an eye is counted as the row's
  Horizontal (`docs/analytics.md`). Browser: `18d/eye/eye-before-after.png`
  (the crane's step 1 page cell, the old code restored for the before):
  the aux pen's hairline eye against the ring pen's; F 30° to 210° before,
  to 150° after; Layers' Flip buttons before "Flip Horizontal, Flip
  Vertical, Flip", after the row alone. Exported, the eye's stroke is a
  Circle ring's, 0.75 px in the one-sheet SVG (0.5625 pt;
  `18d/verify/eye-pen.mjs`).
- **Handles before a draw** (commit 2). With the selected mark's own tool
  in hand — the Star on a star, the Eye on an eye, the Oval on an oval, the
  Rectangle on a rectangle (`handlesInHand`: `drawingKind` is the mark's
  kind) — a press on its scale square or turn handle takes the handle
  (`handleGripAt`, which asks `hitAnnotation` exactly as Select does), and
  the hover shows its pointer or grab cursor with no snap or right-angle
  preview; a press on its body still draws. So a star (K), an eye (Y) or a
  shape just laid is resized and turned without putting the tool down.
  **Review fix:** as first built, any tool that draws took the handles, so
  with an oval selected and the Valley Fold Arrow picked up, an arrow
  started on the oval's corner or edge square resized the oval instead,
  within 8 px of a square with a mouse and 18 px with a finger, where an
  arrow wants to start on a crease point. Under any other tool the press
  draws that tool's mark; the box is still drawn with its squares, as every
  other selected mark's grips are under a drawing tool, which take no press
  either (`DiagramAnnotateCanvas.test.tsx`, "lets another tool draw from a
  selected shape's squares", fails without it).
- **A paste onto another picture's window** (commit 3). `intoView`: from a
  whole picture onto another picture's enlarged step, each mark that,
  carried to the same place on that picture, the window would draw nowhere
  (`marksInWindow`: beyond a window of it each way, selected but unseen)
  keeps its place in the window, as one from a window always has. The same
  picture's paste is unchanged (the same paper, outside the window if it
  lies there). **Where the code narrowed the ask:** "would land outside
  the window" read as not touching it (`marksTouchingWindow`) broke a 16g
  review test (`diagramClipboard.test.ts`, "a mark across the model and a
  small frame"): a line across the model, pasted onto another picture's
  small window, lands beside it and is drawn there, at the same place on
  the picture, by design — Revision 2's decision 7, which Zach confirmed
  with "On the crane, 22 → 23 lands outside 23's window". So the rule is
  the fault's own, a mark drawn nowhere; whether decision 7 still stands is
  R3-37, for Zach. Browser: a star at (0.06, 0.94) on step 1 would have
  landed at (−1.09, 2.28) in step 24's window units (enlarged from step
  22's area); it lands at (0.06, 0.94), inside.
  **Review fixes.** (1) First built per paste, so an eye or a star far off
  the window, copied with one mark the window draws, still went through the
  picture with it and was drawn nowhere; each mark is now asked on its own
  (`annotationClipboard.test.ts`, the 18d case, fails without it). (2) A
  paste the window draws beside it — most of them, from another picture's
  whole step: of a 5 × 5 grid of step 1's places the review pasted on the
  crane's step 24, 16 landed beside the window — was selected but off the
  canvas's view, its Layers row badged. The canvas now steps back to show
  a paste, as it does a close-up laid beside the picture (15f), which the
  18c note
  proposed: the paste tells the store (`diagramPasted`: the step, the
  pasted ids and a nonce), and `useAnnotateCanvas` brings what of it is
  drawn into view once (`pastedRect`, through `marksBox` in `stepView.ts`),
  nothing when it is already in view, not again on reopening the step
  (`diagramClipboard.test.ts`, `useAnnotateCanvas.test.ts` and the canvas's
  "a paste brought into view" fail without it). Where it lands is
  unchanged, so it is still left off the page until it is moved into the
  window (decision 7; R3-37).
- **Model and file** (commit 4). Kinds `oval` and `rectangle`, shape class
  `area` (`AREA_KINDS`, `isAreaKind`); `size` always written, `angle`
  within [0, 180) only when turned. `areaFromCorners(kind, …)` is the drag
  `zoomAreaFromCorners` had, moved into the model (the zoom module imports
  the model, not the other way) and shared: Shift a circle or a square, Alt
  from the middle, a drag under a twentieth of a click's side a click's
  0.3 square. `carryArea` is `carryZoom`'s rounded-rectangle math, pulled
  out and shared through `carriedVector`. `cleanArea`, `withAreaBox`
  (sides held to `AREA_SIDE`, which is `ZOOM_SIDE`, R3-30b A) and
  `withAreaAngle` (kept to 0.01°, then into [0, 180)). Every exhaustive
  switch says what a shape is: no ends, path, text, colour, behind-flap
  end, Flip or arc; Turn Over keeps its kind. `ANNOTATION_FIELDS.oval` and
  `.rectangle` = `size`, `angle`; `to` read as `from`; `size` by
  `readZoomSize` (missing or malformed, damage; past the range, a newer
  build's); `angle` any number read by `rectangleAngle`, one that does not
  read dropped alone. **A consequence of R3-30b, found in review:** a shape
  carried into a small enlarged window grows with it, and a side that
  would pass 2 window units is held at 2, since a larger one would read as
  a newer build's. It then rings less than the same part of the picture,
  and a paste back out keeps what the window held: in a window a fifth of
  the picture across, a 0.5-wide oval becomes 2 units, not 2.5, and comes
  back 0.4 wide, with no notice. Pinned by `annotationClipboard.test.ts`
  ("holds a shape grown past R3-30b's range"). A ring more than twice a
  window across rings much more than the window shows, so this is left as
  R3-30b's range says.
  **Undone at launch (2026-10-10, `bc89d1681`):** with #444's carry of
  every mark, the hold refused Enlarged on for a step with such a shape, an
  x-ray or a close-up, and every mark was left in the old units, so Enlarged
  off moved them for good. R3-30b's range is the picture's frame's; it is
  now held to that in the marks' units (`unitsPerFrame`), the reader takes
  the same range, and a shape goes into a window and back as it was. The
  test is now "grows a shape past twice a small window with it".
- **Geometry and drawing.** `diagram/annotate/areaOutline.ts`:
  `areaOutlineOf`, `areaRimDistance`, `insideArea`, `areaOutlinePoints`,
  `areaBox` (exact turned extents, `pad` for half a pen). **Where the plan
  was loose:** the ellipse's nearest point is found by six steps along the
  evolute (each takes the centre of curvature where the point is and turns
  it toward the press), not Newton's on the angle, which wanders near the
  middle; it agrees with a 40,000-point sampled rim to 5e-5. A drawing's
  `areas` list (`AnnotationArea`): `<ellipse>`, or `<rect>` with
  `stroke-linejoin="miter"` (the marks are wrapped in round joins), turned
  by `rotate(angle cx cy)`, the ring pen, the arrows' ink, no fill, no
  casing. `annotationAreas` paints them; `DiagramAnnotationLayer` draws them
  before the lines and `annotationScene` makes them the first markup item,
  so the card, the page, print, the PDF, the one-sheet SVG, the ZIP's step
  files and Pose's ghosts all paint them under every line and mark
  (R3-11d B), over a close-up's inside. `annotationReach` takes each
  outline's turned box half a pen out (exact for an ellipse's offset and a
  mitred rectangle). `markExtent` takes the outline's turned box.
- **The box.** `boxedShape`: the outline's own box (no floor), eight
  squares, its turn in [0, 180). `BoxedMark` gained `resizing(keys)`, so
  each kind says how a square resizes it: a glyph in proportion about its
  centre whatever is held; a shape freely, Shift in proportion
  (`resizeAspectLock('default-off')`), Alt about its centre (R3-29c A).
  **Beyond the plan:** `resizeAnnotationBox` gained a `sides` option, the
  range each side is held to as the drag goes, so a side at its limit
  holds the opposite edge where it was (a clamp after the fact would slide
  it); the Edit canvas never passes it, and its tests pass unchanged.
- **Hit (R3-31 A).** A shape is pressed by its rim, under every mark in
  the hit order. Selected, its box takes a press only once nothing drawn
  does — another shape's rim inside it included — and a label's margin
  before it; a press in the box's corner outside an oval is the oval's.
- **Tool.** Oval (Shift+O) and Rectangle (R) in a new Shapes group after
  Marks; put down freely; the tool stays in hand. **Departure from the
  plan:** the tool window's Shift and Alt lines are keys of their own
  (`ovalShiftKey` "Shift-drag to make it a circle.", `rectangleShiftKey`,
  `shapeAltKey`), not Enlarge in Frame's: German's "ihn" agrees with
  Bereich, not Oval or Rechteck, and the eye's lines were split for the same
  reason in 18c. Two more say R3-29c on the box (`shapeBoxShiftKey`,
  `shapeBoxAltKey`). The old test that R picked nothing (Rotate's old key)
  now says R picks the Rectangle. **Review fixes:** the help adds "Click
  for a standard size.", as Enlarge in Frame's does, since a click lays a
  0.3 × 0.3 shape, about a third of the picture; and the box's lines in the
  Star, Eye, Oval and Rectangle windows (`starShiftKey`, `eyeBoxShiftKey`,
  `shapeBoxShiftKey`, `shapeBoxAltKey`) lose "With Select,", since the box
  now also answers with the mark's own tool in hand, the only time those
  windows show. Five strings retranslated in the eight locales and
  stamped.
- **Layers, analytics, i18n.** Rows by kind (an upright ellipse, a
  square-cornered rectangle glyph); the Rotation row through
  `BoxedMark.turned` (200 typed is 20); no Flip row. `diagram annotation
  added` with `tool: oval | rectangle`, `snap: none`; `diagram mark styled`
  with `kind: oval | rectangle` for size and rotation; a deleted shape is
  no enlargement (`applyAnnotationEdit`, tested). Nine strings in all nine
  catalogs, stamped (French's escaped no-break spaces kept).
- **Tests**, each failing without its change: `areaOutline.test.ts`,
  `annotationModel` (laying, range, clean, turn, the switches, carry through
  a quarter turn, a mirror, Turn Over, a spread and a window), `diagramFile`
  (round trip, `to`, turn, damage, newer, older), `paintAnnotations`
  (compile, paint order under a Valley Line and an arrow in both presets,
  reach, the scene's first item), `stepView`, `transformBox` (`sides`),
  `transformGrips` (box, eight squares, free, Shift, Alt, edge, range,
  turn), `annotationHit`, `applyAnnotationEdit`, `annotationClipboard`,
  `annotateTools`, the rail, the canvas (lay, Shift, Alt, click, box,
  resize, turn, move, a line first, an unselected shape, a drag on a new
  shape's square with its tool in hand), Layers, and the golden
  `areas.cases.ts` / `areasGolden.json` (upright, turned, a circle, under
  lines, off the paper, on a References face; canvas through
  `DiagramAnnotationLayer`; recorder `18d/areas.record.test.ts.txt`).
- **Browser** (`18d-evidence.png`, part 1: `shapes/run.mjs` light and
  dark, `shapes/ipad.mjs`, re-run on the committed code). Chromium on the
  crane's step 7: Shift+O and R through the registry; five upright ovals;
  a rectangle round the lower left flap, turned with Shift to 135°, a
  corner freely, an edge, a corner with Shift (proportions kept) and with
  Alt (centre kept), each one undo step; Rotation 200 → 20; the move,
  pointer and grab cursors; empty paper inside the selected oval moved it, a
  Valley Line inside it was taken first; with R in hand a drag on the new
  rectangle's square resized it (6 shapes before and after), with K in hand
  a new star's square scaled it to 2; the paste above; the card, the page
  cell, the PDF at 288 dpi, the one-sheet SVG (6 ellipses, 2 rectangles),
  two ZIP step files, the enlarged step's card and Pose's ghosts; the round
  trip identical; no console errors, light or dark. iPad-sized WebKit by
  finger: the rail's Shapes group, an oval and a rectangle laid, the oval
  tapped on its rim, an edge drawn out, turned 50°, moved from inside. The
  phone (390 px) says "Annotate on a larger screen", so its rail is not
  shown.

**Review (2026-10-08), fixed before the gate**, each fix with a test that
fails without it; before and after in the browser, `18d-evidence.png`,
part 3 (`review-fixes/fixes.mjs`, light and dark, re-run on the committed
code; the handles' before is the same script on the old rule):
- **Major: the handles took a press under any drawing tool** (Handles
  before a draw, above). Now only the mark's own tool. Browser, the crane's
  step 9: an oval laid with Shift+O, then V; over its east square no
  cursor, and a drag from it lays a Valley Fold Arrow with the oval left at
  0.20 (before: "Resize annotation", 0.20 → 0.31, no arrow); Shift+O again,
  the square's pointer, and the drag resizes it.
- **Blocker, in part: a paste from another picture's whole step lands
  beside the window, off the canvas.** Where it lands is Revision 2's
  decision 7, which Zach confirmed, so changing it is R3-37, for him; built
  as A. What was fixable without that is fixed: the canvas brings the
  paste into view (A paste onto another picture's window, above). Browser:
  a star from step 1 at (0.3, 0.5), Cmd+C, Cmd+V on step 24: it lands at
  (−0.54, 1.27) window units either way; before, its selection sat at
  x −72, y 986 of a 1440 × 900 window, after, inside the canvas, the zoom
  70% → 53%. A second paste, already in view, moved nothing. It is still
  not printed until moved into the window.
- **Minor, fixed:** each pasted mark asked on its own (above; today's copy
  takes one mark, so this matters once more than one can be copied); the
  eye's comment (ring pen), the canvas module's cursor comment and a
  doubled blank line in `DiagramLayers.tsx`; the shape help's "Click for a
  standard size." and the box lines without "With Select," (Tool, above);
  the clamp of a shape grown past R3-30b's range, recorded and pinned
  (Model and file, above).
- **Declined, with reasons.** The box is still drawn with its squares
  under another tool, though they take no press, as every other selected
  mark's grips are under a drawing tool; hiding them for the box alone
  would make it the one mark that does. On an iPad a corner square sits
  about 18 px from its turn handle, so a finger a little outside the corner
  can turn rather than resize: the nearer handle already wins
  (`transformGripAt`), so the fix is the shared box's layout on a coarse
  pointer, which the Edit canvas shares (18b's), and wants Zach's eye — a
  change of its own. (Built since: Follow-ups to 18d.) The floating tool
  help covers the paper's lower right at 1440 × 900 (since before 18d) —
  a change of its own. F's name in the
  shortcut registry is still "Flip Arc" though it flips an eye
  horizontally; left for Zach's shortcut pass (R3-25).

### Follow-ups to 18d

Both are decided under Zach's standing instruction of 2026-10-08: "go with
your recs from now on unless there is a large fork in the design to be
figured out, until i say otherwise". Neither is a large fork. The first is
the change 18d's review declined as one of its own. The second is a
rounding rule.

- [x] **A finger's handles** (`9e8493653`). On a coarse pointer the
  transform box's handles sit a touch target apart and each has a touch
  target, on the Diagram and the Edit canvas. A mouse's are unchanged byte
  for byte. Before and after on iPad-sized WebKit by finger, on a selected
  star and on an image on the Edit canvas, and on desktop Chromium.
- [x] **The turn's rounding** (`a4608e3ae`), with a test that fails before
  it. Built differently from the ask; see As built.
- [x] `diagram-workspace.md`: D26 and Phase 18 as built through 18d.
- [x] Gate, on exactly what was committed: lint (`npm run lint:web`),
  typecheck, the i18n check, the whole vitest suite (Node 22): 895 test
  files and 12,235 tests pass (2 files and 15 tests skipped), and
  `npm run build:web` with its prerender.
- [x] Push.

**As built (2026-10-08).**

- **A finger's handles.** `lib/transformBox.ts` gives each pointer its
  handles, `TRANSFORM_HANDLE_SIZES`, read through
  `transformHandleSizes(coarse)`. A mouse's are as they were: 8 px
  squares, 5 px turn handles 18 px out, and no target. A finger's are sized
  by the touch target, `--touch-target` (44 px). The same number is now
  `TOUCH_TARGET_PX` in `platform/pointerSurface.ts`, held to `theme.css` by
  a test. Its squares are 12 px and its turn handles 7 px, grown for a
  finger as Edit Path's nodes are. Each turn handle sits 44 px out from its
  corner, and every handle has a 22 px target round it, so a corner's
  target and its turn handle's meet and never overlap.
  - **One rule** decides which handle a press takes, `transformHandleAt`.
    It is the nearest handle the press is on as drawn. Outside the box it
    is the nearest within its target or the pointer's reach. Inside the
    box only a handle as drawn takes a press, since the object is there.
  - **The Diagram.** `transformBoxHandles` and `transformGripAt` take the
    pointer's sizes (`HitSizes.handles`, from `useAnnotateCanvas`'s
    `hitSizes`), and `TransformBoxSelection` draws them.
  - **The Edit canvas.** On a coarse pointer only, `CanvasObjectOverlay`
    draws a transparent 22 px disc under each handle (`TouchTargets`,
    `data-touch-target`). The discs are clipped to outside the box by an
    even-odd clip path. A press on any disc goes to the handle
    `transformHandleAt` names, so where two discs overlap, the nearer
    handle takes it.
  - **Beyond the ask.** On a coarse pointer the Edit canvas's resize holds
    the press's offset from its handle's middle (`grab`), as the Diagram's
    box has since 18b. So a press anywhere in a 22 px target does not jump
    the box on the first move. A mouse's press still takes the square to
    the pointer. Applied to a mouse as well, the offset moved 18b's proof
    by up to 7e-5 px after a drag. That changed antialiased pixels in
    three of its six shots, so it is kept to the finger.
  - **Tests**, each failing before its change (checked by reversing the
    source):
    - `lib/transformBox.test.ts`: the sizes; a press 14 px wide of a corner
      takes a mouse's turn handle and a finger's square; inside the box,
      only as drawn; reach and scale.
    - `transformGrips.test.ts`: a finger's layout and press.
    - `DiagramAnnotateCanvas.test.tsx`, by a finger: 12 px squares, 7 px
      turn handles 44 px out, and a press 14 px wide that resizes.
    - `CanvasObjectOverlay.test.tsx`: the targets and their clip; the
      nearer handle, whichever disc is pressed; no turn targets while
      cropping; a finger's square drawn out without a jump; a mouse's
      unchanged.
    - `pointerSurface.test.ts`: the token.
    - An inline snapshot of every Edit canvas handle's markup, recorded on
      the code before the change, holds a mouse's layout
      (`CanvasObjectOverlay.test.tsx`, "draws a mouse's handles exactly as
      before").
  - **Browser** (`artifacts/revision-3/18-followups/touch-targets-evidence.png`;
    scripts `touch.mjs`, `desktop.mjs`, `editbox/capture.mjs` and
    `composite.py`).
    - iPad-sized WebKit by finger, a selected star (scale 2) on the crane's
      step 1: square to turn handle 17.8 px before, 43.6 px after. A finger
      14 px out from its se corner, dragged 40 px down, turned it 18.1°
      before; after, it scales it from 2 to 4.
    - A reference image on the Edit canvas: 18 px before, 44 px after. The
      same finger turned it from 0.3 to 0.447 rad before; after, it widens
      it from 154.9 to 197.2. A press 12 px inside its corner still lands
      on its body, so the clip holds in WebKit.
    - Desktop Chromium, a mouse: the star's box and handles are
      byte-identical and its screenshot pixel-identical. 18b's Edit canvas
      proof, re-run: all six shots pixel-identical, and `record.json`
      (every handle's attributes, and the image after each drag)
      byte-identical.
- **The turn's rounding.** The case raised, a star's or an eye's 359.996°
  written as 360, did not happen. `boxedGlyph.turned` wrapped and rounded,
  and then `withGlyphAngle` wrapped again, so 360 became 0. A test of five
  such turns passes before and after. Rounding first, as asked, would have
  let the wrap's float error through: 372.35 would be written
  12.350000000000023. That fault was real in shapes. `withAreaAngle`
  rounded first, so a typed 192.35 was written 12.349999999999994, and
  200.01 was written 20.00999999999999.
  - **Built as one rule for every turn**, `keptTurn(degrees, within)` in
    `annotationModel.ts`: wrapped, rounded, and wrapped again. A glyph's
    box and Rotation row, a laid eye (`eyeLooking`), an eye's carry
    (`carryEye`) and a shape (`withAreaAngle`) all use it.
  - **Tests.** `annotationModel.test.ts` (a shape's 192.35, 200.01, 185.67
    and 359.996, and `keptTurn` itself) fails before.
    `transformGrips.test.ts` pins the glyph cases so the order cannot
    regress: 359.996, 359.995, −0.004, 719.996 and −360.004 are upright,
    and 372.35 and −347.65 are 12.35.

### 18e X-ray: model, canvas, tool and Layers

Only after 18.0 passes and R3-16a, R3-16c and R3-17 to R3-22 are answered
(R3-12 to R3-15b and R3-16b are). On `claude/diagram-xray` (R3-27 B).
All answered 2026-10-08 (Status at the top).

- [x] Capture (R3-16a A, amended after 18.0): no `sides` key — each face's
  side from its outline, a stored face item's own where there is one;
  `paperFaces` unchanged, so nothing locks and nothing is budget-checked. A
  flat step with no faces gets them as an x-ray is laid on it, in the same
  undo step (`stepWithPaperFaces` through `giveDiagramStepPaperFaces`, as
  an enlarge area's step does). Tests: the sides of the 36 faces a no-spread
  capture drops agree with the spread capture's own (`xrayScene.test.ts`).
- [x] `xrayScene.ts` and its stacks, with tests: depth 1 to 3 at an anchor;
  every face over a removed one removed; the spread path; an empty ring
  skipped; a depth past the stack drawn at the deepest.
- [x] Model and file: the kind, its class, `radius`, `anchor`, `depth`.
  Tests: round trip; `to` read as `from`; 0 and 1.5 are damage.
- [x] The canvas's inside hook; the rim; no other surface draws an x-ray
  yet.
- [x] Tool: the drag, the click (`placedByClick`), Depth taking the focus,
  the held reasons, the key, help.
- [x] Grips (the circle's centre and rim) and hit (the rim, `under`);
  snapping inside a window (R3-22).
- [x] Layers: Depth, the notice (a plural key), Anchor. The Anchor row:
  its CSS move with computed styles compared, a commit of its own
  (`6bf0abf5c`); `DiagramAnchorRow`;
  `useAnchorPick` by kind; the drag by kind; "Change X-ray"; the Auto and
  reset wording. Tests: an x-ray's pick and drag never send `diagram
  enlargement changed`; an enlarge area's still do; the frame's Auto
  wording unchanged.
- [x] Carry, Turn Over (as built a linked fold's Turn Over leaves the
  window where it was, as every mark: R3-21, 18e review), paste, enlarged
  steps (`markExtent`); a Refresh that
  leaves too few layers; a step that loses its layers (R3-18b), each case:
  drawn nowhere, the Layers reason, and drawn again on the way back.
- [x] Analytics and i18n.
- [x] Browser, before and after: crane windows at depth 1, 2 and 3 beside
  the note's picture, on the canvas; with a spread; on an enlarged step; the
  held tool on a crease pattern; a step shown as a crease pattern and back.
- [x] Review: every major finding fixed, each with a test that fails
  before it, and the minor ones that were cheap and clearly right (folded
  into As built, below); the rest is Zach's (For Zach).
- [x] Gate, on exactly what was committed: lint, typecheck, the i18n check
  and the whole vitest suite (Node 22): 899 test files and 12,281 tests
  pass (2 files and 15 tests skipped).
- [x] Push (already included in merged #446).

**As built (2026-10-09).** Two code commits: `6bf0abf5c` (the Anchor row and an
enlargement's verb become components, nothing on screen changed) and
`534a98062` ("Diagram: X-ray windows in Annotate", with the review's fixes).
Every decision used is recorded DECIDED above (Status). Evidence:
`artifacts/revision-3/18e/18e-evidence.png` (`composite.py`), every shot
taken on the committed code, from `run.mjs` (Chromium, light and dark),
`heart.mjs`, `drag.mjs`, `ipad.mjs` (iPad-sized WebKit by finger),
`review-fixes.mjs`, `parity.mjs`, `speed.mjs` and `anchorRowStyles.mjs`,
all in `artifacts/revision-3/18e/`.

- **Model and file.** Kind `x-ray`, shape class `x-ray`: `from` the
  window's centre (`to` read as `from`), `radius` in Enlarge's circle's
  range, `depth` a whole number from 1 (`XRAY_DEPTH`, laid at 1, always
  written), `anchor` a point on the paper. `cleanXRay`, `withXRayDepth`,
  `xrayDepthOf`. `ANNOTATION_FIELDS['x-ray'] = radius, anchor, depth`; a
  radius past the range is a newer build's, kept; a missing, zero,
  fractional or non-numeric depth is damage; an anchor that does not read
  is dropped alone. Carried by `carryZoom`'s circle path (depth and anchor
  kept) for the moves the app applies — a quarter turn, an upload's flip, a
  References turn-over. A linked flat fold's Turn Over is none of them: the
  window stays where it was, as every mark does (R3-21, amended). Every
  exhaustive switch says what an x-ray is: no ends, path, text, colour,
  behind-flap end, Flip or arc; it never snaps (R3-24 A).
- **Sides not stored** (R3-16a A, amended after 18.0): `paperFaces`,
  `capturePaperFaces` and the file are unchanged, so nothing locks and
  nothing is budget-checked. A face's side is the stored scene item's own,
  or for a face it dropped, by how its ring turns on the paper and on the
  picture, calibrated on a face the scene names; the 36 faces a no-spread
  crane capture drops agree with the spread capture's own
  (`xrayScene.test.ts`).
- **"Over" with a tolerance** (18.0 results, 2): `annotate/faceOverlap.ts`
  (`sharedPart`, Sutherland–Hodgman with a face that is not convex cut into
  triangles by its ears; `overlapsWider` at `OVER_MIN_WIDTH` = 1e-4 of the
  picture) and `facesOverWithin` in `behindFlaps.ts`; 15e's `facesOver` is
  untouched. Tested on the heart's own pair (`heartPair.mjs`,
  `__fixtures__/heartFacePairs.json`): faces 20 and 29 meet along a fold,
  their shared part 1.1e-6 wide; the narrowest true overlap 0.032. In the
  browser on the heart (`heart.mjs`), at index 15 and 16 at depth 3, 15e's
  test would take away 5 faces where the window takes 3.
- **`diagram/xray/xrayScene.ts`**, the one pure module every surface draws
  a window with: `xrayFacesOf(step)` (memoised on `paperFacesOf`'s faces:
  each face's item, the paint order, the covers on the unspread picture),
  `xrayAnchorPoint`, `xrayAnchorDrawn`, `xrayStackAt`, `xrayRemoval`,
  `xrayInsideScene`, `xrayInside` and `xrayWindowMarkup` (the clip, held to
  a `bound` where given; the page's white; the faces through
  `paperSceneSvgBody`; the rim at 1.5 × the edges' pen). 18f's painters call
  `xrayInside` and `xrayWindowMarkup` with their own projection and units
  per pt, as `useXRayInsides.ts` does. **Paint order** (18.0 results, 3,
  built as a topological sort): a stored face waits only for the earlier
  stored faces it overlaps; a dropped face goes after every face it lies
  over and before every face over it; the earliest free face is taken, and
  a knot is cut at its backmost face. "Before the first face over it", as
  planned, painted a face after one under it on the crane's no-spread
  capture; chaining every stored face to the one before it could knot
  (`knotStep`, five faces); the crane is checked both ways.
- **The canvas.** `annotationDrawing` compiles an x-ray into its own list,
  `xRays` (window and rim); `annotationScene` and `annotationMarks` do not
  draw it, so no card, page, file or Pose ghost shows one until 18f, rim
  included (tested). `useXRayInsides` + `DiagramXRayInsides` lay each
  window under the close-ups' insides and the marks; on an enlarged step in
  its window's units, held inside the frame's cut by half its pen
  (`zoomOutlineInset`) so the cut is drawn whole across a window. None on a
  picture with no layers (R3-18b A), where the rim is neither pressed
  (`hitAnnotation`'s `xRays`) nor framed (`annotationReach`'s `xRays`, the
  fit's fifth argument); 18f must pass `{ xRays: true }` wherever it draws
  windows. While an x-ray is selected its picked anchor is marked, a ring
  and a dot in the selection's ink. A close-up shows the picture plain
  (R3-20 B).
- **Tool and standing.** X-Ray in Marks after Enlarge in Frame, key X
  (`diagram.toolXRay`), its glyph a heavy rim round the note's M. A drag
  out from the middle, or a click (0.15); then Depth takes the focus
  (`FocusField` `depth`), so 2 and Enter set it — once the faces land, where
  they are fetched (`useFieldFocusRequest` waits on a disabled field).
  `xray/xrayStanding.ts`: `ready`; `fetch` (a flat step without faces, its
  pattern open and its link not stale), where laying or pasting an x-ray or
  an enlarge area fetches them in that undo step
  (`giveDiagramStepPaperFaces`, which marks the step in the unsaved
  `diagramPaperFacesFetching` while it runs, so Layers says nothing
  meanwhile); `refresh` ("Refresh step {{number}} to x-ray it"); `none`
  ("X-ray works on flat folds"). `xrayToolHeld` is the one predicate: the
  rail, the X key (`xrayHeld`), and `annotateToolInHand(state, standing)`
  through `useAnnotateToolInHand(step)`, which the canvas, the tool window
  and the rail read, so where the rail holds the tool Select is in hand. A
  press whose middle is on no paper lays nothing and says "Start on the
  paper…" (`ToolNotice` `no-paper`).
- **Grips, hit, snapping.** Selected, a circle's grips (`zoomGripAt`);
  pressed by its rim in the `under` order with enlarge areas and shapes; a
  move or resize is "Change X-ray" and never an enlargement event. Snapping
  (R3-22 B, `xray/xraySnap.ts`, used by `pictureSnapTarget`): inside a
  window the picture's points and crossings stop being targets; the shown
  faces' corners are points, and their edges, held to the window, cross
  the lines drawn over them (`crossingsNear`'s `shownLines`); every
  picture point in reach outside a window is a candidate. Tested on a
  hand-built three-layer fold (`xray/xray.fixtures.ts`): the crane's layers
  share their corners, so no crane window changes a target.
- **Layers.** `DiagramXRayControls` with `useXRayControls` and
  `xrayLayers.ts`: Depth from 1 to the layers at the anchor less one, its
  max never below a stored depth past the stack (so visiting the field
  rewrites nothing); "Only {{count}} layers here" (plural); "No paper under
  its middle" off the paper; the held reasons; the Anchor row
  (`DiagramAnchorRow`, `DiagramZoomVerb`, moved out of
  `DiagramZoomControls` in `6bf0abf5c`: 3,780 computed properties a theme, no
  difference, `anchorRowStyles.mjs`). `buildAnchorActions` takes `on:
  'x-ray'` for its own hints; `useAnchorPick` edits an x-ray's anchor as
  "Change X-ray".
- **Analytics and i18n.** `diagram annotation added` `tool: x_ray`;
  `diagram mark styled` `kind: x_ray`, `option: depth` (`1`, `2`, `3+`) or
  `anchor` (`picked`, `auto`); `docs/analytics.md`. Fifteen strings, in all
  nine catalogs.
- **Browser, on the committed code** (Chromium on :5314, light and dark,
  no console errors). The crane (`run.mjs`): X through the registry; a
  window on the bird base's front flap (index 20) at depth 1, 2 and 3 typed
  into the focused Depth field; moved, resized and anchored; Show As crease
  pattern (kept, drawn nowhere, its rows held with the reason) and back;
  laid on index 19, its faces fetched in the same undo step; on the
  enlarged index 27; held on the crease pattern (index 4). The heart
  (`heart.mjs`), indices 14 to 16 at the deepest stack each has (7): 14 and
  16 have no faces, which a lay fetches, Depth focused 110 to 160 ms later;
  15 (stale) holds the tool, an x-ray added there says "Refresh step 14 to
  x-ray it", and after Refresh it is drawn; each takes away 1, 2 and 3
  faces at depth 1, 2 and 3. The review's cases (`review-fixes.mjs`): a
  stale step, a depth past the stack, a lay that fetches, a crease
  pattern's rim, a paste that fetches, a click off the paper, a picked
  anchor, index 27's cut. **Parity** (18.0 results, 6, `parity.mjs`): 21 of
  21 windows that take nothing away identical to the stored picture's own
  face items through the same clip; at depth 1 to 3 each differs.
  **Speed**: the per-frame work (`speed.mjs`) median 0.06 to 0.11 ms a frame, at most 3.2 ms (the first frame, the step's set-up), at most 2.0 ms at 4× CPU throttling; a real drag of a
  window's centre grip, 120 moves (`drag.mjs`), on index 28 (52 faces) and
  20 (44): frame gaps at 120 Hz as an enlarge area's (Enlarge's circle, the same grips, no inside): p95 at most 10.1 ms, against 9.6; one frame of 25 to 32 ms on the enlarged index 28, against 10.3; at 4× CPU p95 at most 16.0 ms and worst 18.6, against 15.3 and 18.5. The task of about 70 ms (300 ms at 4×) as a drag starts, and of 60 ms after the release, is the same with an enlarge area: the canvas's, not the x-ray's. iPad-sized WebKit by finger (`ipad.mjs`): laid, pressed
  by its rim, moved.

**For Zach.** (1) **Turn Over** (R3-21): a linked flat fold's Turn Over
leaves every mark where it was, x-rays included, so a window then looks at
another part of the fold; carrying marks through it would be a new carry
for every mark — a fork for him. (2) The Diagram preset's white front, as
18.0 said, makes a revealed front-up layer read as the page, and on flaps
whose layers share outlines depth 1 and 2 can look like a hole and like
nothing (the heart's windows at depth 2 are plain white): a tint for the
revealed front, or a two-colour style where x-rays are used. (3) The glyph,
a heavy ring round an M, may read as "mountain" (the M key's tool): a ring
with a few hidden-line dashes inside is the alternative. **DECIDED** (Zach's
standing instruction, 2026-10-08): the ring with dashes, built in 18f. (4)
The Anchor row's label stays Enlarge's "Anchor" (in Japanese, Chinese and
Korean "anchor face"), where an x-ray's anchor is a point; a key of its own
if the shared word reads wrong. **DECIDED**, the same way: "Point"
(`xRayAnchor`), built in 18f. (5) On an iPad, Pick in the Settings sheet
leaves the sheet over the canvas, so the next tap does not land until it is
closed — Enlarge's row and sheet too, not new in 18e. **DECIDED**, the same
way: the sheet steps aside while the pick is armed, Enlarge's too, built in
18f. (6) Untested: a woven
patch (no step in his four diagrams has one), and his two no-spread
chipmunk steps in the browser (they have no stored faces; the no-spread
path is tested on the crane's capture and a hand-built fold).

### 18f X-ray on every other surface

- [x] The card, the enlarged step's card and page, the page's `cellPicture`
  (print, the PDF, the one-sheet SVG, the ZIP's step files), and Pose's
  ghosts, rim only (R3-19). A close-up over a window as R3-20 says.
- [x] The parity test across every painter, copied from
  `closeUps.surfaces.tsx`; a ZIP step file cropped round a window by its
  rim.
- [x] Golden `xray.cases.ts`.
- [x] Browser, before and after: crane windows on every surface in "Every
  phase", the PDF at print size and ×3.
- [x] 18e's follow-ups: the icon, the Point row, the sheet that steps aside
  for a pick (18e, For Zach, (3) to (5)).
- [x] Review: two reviews, ten findings, all fixed but one carried from 18e
  (Not changed, below), each behaviour fix with a test that fails before it
  (folded into As built).
- [x] Gate, on exactly what was committed: lint (`npm run lint:web`),
  typecheck, the i18n check and the whole vitest suite (Node 22): 902 test
  files and 12,351 tests pass (2 files and 15 tests skipped).
- [x] Push (already included in merged #446).

**As built (2026-10-09).** One code commit, `d14d34b92` ("Diagram: X-ray
windows on every surface"), the review's fixes in it. Every decision used is
recorded DECIDED above (Status; R3-18b, R3-19, R3-20; 18e, For Zach (3) to
(5)). Evidence: `artifacts/revision-3/18f/18f-evidence.png`
(`verify/composite.py`), every shot taken on the committed code, no console
errors: one window cut out of every surface at the same size — the canvas,
a card, the Pages view, the PDF through pdftoppm, the one-sheet SVG, a
transparent step file and Pose — on the crane's index 20, the enlarged
index 27 and the review's step 10 (`verify/windows.mjs`, Chromium, light and
dark); the surfaces in context (`verify/surfaces.mjs`); the icon
(`verify/icon.mjs`); the iPad pick (`verify/ipad.mjs`, iPad-sized WebKit by
finger, light and dark). The implementer's before-and-after runs
(`surfaces.mjs`, `ipad.mjs`, `roundTrip.mjs`) and the review's
(`review-fixes/`) are beside it.

- **One painter, every surface.** `xray/xrayPaint.ts`: `xrayWindowOn` draws
  one window on any surface from where that surface lays the step's drawing
  (`DrawingPlace`: its frame's box in its units, and the drawing's px across
  it); the projection, the units per pt, the window, the rim and an
  enlarged step's bound follow from it, drawn through 18e's
  `xrayWindowMarkup`. The canvas's `useXRayInsides` calls it with its frame
  at the origin. `xraySurfaceOf(step, look)` is null on a picture with no
  layers (R3-18b A). `xrayPainter` makes the `XRayPainter` a surface hands
  `paintAnnotations` (`AnnotationPaint.xRays`): each window in a
  `data-x-ray-window` group under the close-ups' insides and the marks, its
  ids `annotation-x-ray-<n>-`; with `look: 'rim'`, the rim alone
  (`xrayRimMarkup`). A callback rather than the hook part 5 planned:
  `paintAnnotations` importing `xray/` would make a cycle through
  `paintZoomed`. `placeAnnotations` measures a window by its rim only where
  a painter is given (`annotationReach`'s `xRays`) and draws one on a step
  with no other mark; it, `annotatedPicture` and `posedZoomPicture` take
  `{ paper, xRays }` where they took `paper`.
- **The page's white, on the paper only** (the review's major; part 5's
  "lays the page's white" amended). `xrayInside` also returns `ground`, the
  faces the window takes away where the picture draws them
  (`xrayGroundScene`). `xrayWindowMarkup` fills those with the white,
  stroked the edges' pen wide so their outlines go too, as plain paths in
  `<g data-x-ray-ground>` so nothing reads them as faces left. Off the paper
  a window lays nothing, and a page's band, a selected cell's tint or a
  transparent step file shows through it as it does round it; a window that
  takes nothing away lays no white. Laid over the whole circle, as 18e did
  on the canvas's white page, it printed a white disc wherever a window
  crossed the paper's edge. On the paper nothing looks different, but the
  canvas's markup is no longer 18e's byte for byte.
- **The surfaces.** A step card (`useStepPictureUrl` → `annotatedStepUrl`,
  `zoomedStepUrl` → `zoomedCardPicture`; cached by the faces' object and
  the look). The pages' `cellPicture`, measured by `layoutPicture`
  (`reachedWith`'s `xRays`), which the Pages view, print, the PDF, the
  one-sheet SVG and the ZIP's step files all draw through. Pose
  (`DiagramStepDetail`): its card at 0.3 and `posedZoomUrl`, rims only
  (R3-19 A); while a spread is dragged the preview is captured without
  faces, so the rims take the stored step's standing and stay. The live 3D
  and simulated views are given no painter: they mount only for 3D or
  simulated captures, which have no layers (R3-18b). No surface hands its
  close-ups' insides a painter, so a close-up over a window shows the
  picture plain (R3-20 B). `hitAnnotation` is the canvas's alone, from 18e.
- **The follow-ups** (18e, For Zach (3) to (5)). The icon
  (`DiagramAnnotateToolGlyph`): the heavy rim round five short dashes in
  two staggered rows, drawn as segments; the Hidden Line's own dash, built
  first, read as a grille at the rail's size
  (`review-fixes/icon-variants-2x.png`). The row: `DiagramAnchorRow` takes
  its `label`, "Point" for an x-ray (`xRayAnchor`), with its own picking
  hint (`xRayAnchorPicking`) and the reset hint "Count the layers at the
  window's centre again". The sheet (`useWorkspaceViewDrawer`): while a
  pick armed from it is live (`escapePutsPickDown`) it closes and records
  the pick, and it comes back on the same pane, with no second `view drawer
  opened`, only when that pick ended where it was made, anchored or put
  down (`anchorPickEndedInPlace`, beside `activeAnchorPick`). Leaving for
  Pose, the step list, another step, another mark, another workspace or
  pointer keeps it closed, and a sheet opened meanwhile is the user's. The
  bar (`DiagramAnchorPickBar`): the shared `CanvasContextBar`, inside the
  Annotate canvas's view and off its stage, on a coarse pointer while a pick
  is armed, saying "Tap the point where the layers are counted" or "Tap a
  face to anchor to it", with Cancel, which puts the pick down as Escape
  does. The phone does not annotate, so it never shows there. Five new
  strings and the reworded reset hint, in all nine catalogs.
- **Tests.** `xray/xray.cases.ts`, eleven cases: the hand-built three-layer
  fold at depth 1, 2 and past its stack, and past the frame's edge; the
  crane with no spread and with one, a picked anchor, two windows under a
  valley line, a circle and a close-up over one, an enlarged step whose
  window crosses its frame, a window whose middle is off the paper, and one
  a third off a flap (`crane-edge`). `xray.surfaces.tsx` paints each
  surface as its own code does. `xrayGolden.test.ts`
  (`__fixtures__/xrayGolden.json`, 86 kB, `XRAY_GOLDEN_WRITE=1`).
  `xraySurfaces.test.ts`, the parity test: every surface's window read back
  in its frame's units and pt is the canvas's — clip, white, rim (0.75 pt),
  faces in order with fill, pen (0.5 pt) and place, and Pose's rim's place —
  within each surface's rounding; a window that takes nothing away is the
  picture's own faces through the clip (18.0 results, 6); nothing painted
  inside a window and off the paper, on a page cell and in a transparent
  step file; an enlarged step's inside held half its cut's pen inside the
  frame; under the marks; R3-20 B; ids unique; drawn and measured nowhere
  without layers (R3-18b A); a page's room grown by the rim; a cropped step
  file cut round the rim. Also the PDF through the real writer, the
  one-sheet SVG, Pose's rims (a faceless preview included), the icon, the
  Point row and its hints, the sheet stepping aside and every way out
  (`WorkspaceViewDrawer.test.tsx`), and the bar and its Cancel. Each
  review fix's test failed with the old code put back.
- **Browser.** One window cut out of every surface at the same size is the
  same faces in the same order; off the paper the canvas's and card's white,
  the band in the Pages view, the PDF and the sheet, and the checkerboard in
  the step file show through (index 27's window). Before and after
  (implementer, `surfaces.mjs`): every surface but the canvas ignored the
  x-ray before; after, the cards, Pose (rims only), the Pages view, the PDF
  at 96 and 288 dpi, Print (the app's print layer printed by Chromium), the
  one-sheet SVG and the step files, same size and cropped. The review's
  off-paper run (`review-fixes/offpaper.mjs`): only the window crossing the
  paper's edge changed, (255,255,255) on the band before and the band's
  (236,236,232) after. iPad-sized WebKit by finger, light and dark: armed
  from the sheet, the sheet goes and the bar shows; Cancel and an anchoring
  tap ("Change X-ray") bring it back on Layers; Pose, Steps and Next Step
  leave it shut; Enlarge's frame pick shows its own wording.
- **The round trip** (`roundTrip.mjs`): the crane (the copy, and Zach's own)
  reads with nothing locked and no unknown mark and writes back identical;
  with three windows (one anchored), written, read and written again,
  identical. His chipmunk, heart and Stanford logo too; Reference Diagrams
  writes back all but its page's retired `scale: "fit"` (let go
  2026-10-06, not this phase's).
- **Analytics.** Nothing new: the surfaces draw what the canvas draws, the
  anchor's pick and its row send what 18e sends, and putting a pick down,
  which Cancel is one way of doing, was never counted.

**Not changed (carried from 18e).** The Diagram preset's white front makes
a depth-1 window on the crane's flaps read as a punched hole, and a depth-2
window whose revealed layer matches the picture as nothing (18e, For Zach
(2)); 18f puts both on paper (`review/finding-white-disc-step24.png`,
`review/pages-10-19.png`). A window crossing an enlarged step's frame draws
its rim whole outside the frame while its inside stops at the frame (18e's
choice), now in print and the PDF too.

**For Zach.** (1) Where a window takes every layer away at a point inside
the paper's outline, it shows the page's white (18.0 results, 5), even on a
page with the band, where off the paper the band now shows: white there, or
the band? (2) The pick bar is new on-canvas UI (`18f-evidence.png`, iPad
row). (3) The icon: `review-fixes/icon-variants-2x.png` has the first build
(A, the Hidden Line's dash) and three others (B aligned, C staggered, which
is built, D two and two).


### Review follow-ups (2026-10-09)

Zach's review of the branch after 18g, five asks, each small and none a
fork:

- [x] **Update Enlarged Steps says what it did.** A toast: "Updated
  enlarged step 23", or "steps 23–30"; a warning when some of the area's
  steps took no frame ("Updated 1 of 2 enlarged steps"); an error when none
  did or the update threw, with the reason. Nothing for a diagram replaced
  while the faces were folded: the press went with it.
- [x] **Set Upright in Pose, on a step in 3D or Simulated.** In the bar
  under the picture, in place of View From the Front and View From the
  Corner, which go. It is the live view's own verb, as in Edit's 3D window
  and Simulate (`setUprightView`, the toast `announceUprightSet` says, the
  `Axis3d` icon): the picture does not move, and the view's next rest is
  captured with the camera's new up, one undo step, as a drag's is. Reset
  Pose takes it off. Held, saying why, while no live view shows (no
  WebGL2, the simulator loading).
- [x] **A 3D step's lines at the flat steps' weight.** Two causes. On the
  cards, pages and the PDF, a 3D capture names its folds mountain and
  valley, which the Diagram's painter drew in the fold pens, half the edge
  pen in the Diagram style; a flat capture names its folds edges. A folded
  model's folds are edges (D6), so the painter now draws them so
  (`foldedModelPens`), steps saved before this too. In Pose, the live 3D
  and simulated views drew a constant ~0.7 px while the flat picture beside
  them is scaled up to fill the stage, its pens with it; their creases now
  grow with the frame from the size a picture opens at
  (`RenderSettings.creaseWidthGrows`, `poseLineWeight.ts`).
- [x] **A simulated step at the same weight** (Zach, 2026-10-09, shown the
  three side by side: "i want simulated to match"). A simulation names its
  folds mountain and valley too, and the Diagram drew them in the fold
  pens; its cards, pages and Pose's live simulator now draw them in the
  edge pen as well (`foldedModelPens`). A crease not yet folded on a step
  simulated part way is drawn so too: the capture names a crease by its
  assignment, not its angle. Simulate and Edit's inline simulations keep
  their mountain and valley pens (Phase 9); this is the Diagram's alone.
- [x] **Pose's hint in a dark theme.** "Drag to turn · Double-click to
  reset" was the theme's muted text on a pill that the white stage under it
  makes mid-grey; it is in the readout's and the bar's ink now, with their
  shadow.
- [x] **The 1% budget (Z11) raised** to a whole file under 100 MB:
  `diagram-revision-2.md`, The budget.


### Final gate

- [ ] The crane loads with every mark known and saves back byte-identical;
  its pages and PDF compared before and after the whole branch.
- [x] `diagram-workspace.md`: Phase 18, "Revision 3", pointing here, with
  the decisions as Zach answered them: D26, and Phase 18 as built through
  18d and its follow-ups. X-ray's part comes with its PR.
- [x] Draft PR from `claude/diagram-revision-3` onto
  `claude/diagram-workspace-plan-ceb4f2` (#436), its body carrying each
  phase's before and after; and a second from `claude/diagram-xray` onto
  it (R3-27 B).
