# Diagram, Revision 2: equal divisions, a right-angle mark, enlarged steps

**Status: planned 2026-10-05; 16a–16g built. The right-angle mark (16a)
and equal divisions (16b) are built (2026-10-06), and so are enlarged steps'
model, file and imprint (16c), the writer of a flat step's faces with them
since Zach's answer on its size budget (Z11), their drawing on every surface
(16d), their pages and export (16f, 2026-10-06), their authoring (16e,
2026-10-07) and their changing pictures, new steps, moves and deletes (16g,
2026-10-07), without which 16e does not ship. Zach settled every decision
on 2026-10-06: the enlarged steps' Z1–Z11, and the equal-divisions
(ED1–ED13) and right-angle (RA0–RA8) decisions as recommended. Each is
recorded in its part. What building 16e–16g raised since, Zach settled on
2026-10-07: "Decided with Zach (2026-10-07)" and "Decided with Zach, after
16g" below, their follow-ups built ("Follow-ups to 16e and 16f",
"Follow-ups to 16g"). Left: what "Open with Zach" lists, and the Final
gate.** Phase 16 of
`implementation-plans/diagram-workspace.md`, after Phase 15
(`implementation-plans/diagram-annotate-second-pass.md`), whose kinds, tools,
painter and close-ups this builds on. Built by hand, phase by phase, as Phase
15 was. Paths are under `apps/web/src/` unless they say otherwise. The
decisions, as things to try (gitignored, beside the other diagram artifacts):

- `artifacts/revision-2/enlarged-steps.html`: enlarged steps, drawn from
  `crane.osf`, with its six decisions numbered 1–6 (Z1–Z6 here), the knobs
  for what is settled by evidence, the flows S1–S6, a printed page and the
  two examples beside it. It predates Zach's answers of 2026-10-06 and still
  shows the walk-back and the plane they replaced; this plan is the record.
- `artifacts/revision-2/revision-2-marks.html`: the equal-divisions mark
  (its decisions numbered 1–13, ED1–ED13 here) and the right-angle mark
  (RA-0–RA-8, RA0–RA8 here), at print size on white, grey or the sketch's
  paper. Its "Copy picks" text names each decision by those numbers.

The decision names here follow the prototypes' numbering, so picks pasted
back map one to one. Where a decision names something to judge on a
prototype (a white-paper panel, a row of layered edges, glyph variants,
narrow flaps), that is what the prototype must show; the check before 16a
and 16b confirms it does.

**How the text reads.** The equal-divisions and right-angle parts were
written before Zach's answers, as they would be built under the recommended
options. Wherever the text depends on a decision it names it, as "(ED5 A)",
and that decision's entry says what another option would have changed. Zach
took every recommendation, so each such passage stands as written and the
options it names beside the recommendation were not taken. The
enlarged-steps part names its decisions, Z1–Z10, only to point at the record
of what Zach decided.

**Decided with Zach (2026-10-07).** Raised by building and verifying 16e and
16f. Zach: "please just go with your recommended answers for everything".
1–4 are built ("Follow-ups to 16e and 16f", after 16f); 5 and 6 confirm
what 16e built.

1. **The arrow across a flow row break** sat in the lane's bend but was
   mirrored to the next row's way, so it pointed across the page, not at the
   enlarged step (16f; the crane's 21 → 22). *Decided: turned toward the
   step.* It is aimed from its place in the bend at the middle of the
   enlarged step's picture, its bow on the outside of the bend; on a row,
   across a grid's row and across a page it is as before (2541506f2).
2. **Step files printed an enlarged step small.** `zoomFileFrameMm` capped it
   at 6× the area as the area's own step file draws it: on the crane's
   same-size files step 22's window was 23.8 mm in a 61 mm box (48 mm on the
   page). *Decided: match the page's enlargement.* The file draws the window
   at the size its page cell prints it, no larger than the box holds: 48 mm
   (4f842157d).
3. **Copied marks after Duplicate Step and Enlarged** reach far outside the
   window: Annotate's fit zoomed out to them (13%, not 70%) and Fill sized the
   step by them (×1.52 on the crane, ×3.67 with them deleted; ×1.4 and ×6 on
   today's crane). *Decided: marks outside the frame count neither for Fill
   nor for Annotate's fit, and keep their "Outside the enlarged frame"
   badge.* Built as: what lies outside the window counts for neither; a mark
   wholly outside it is badged; one reaching out of it counts inside it and
   is drawn whole, overflowing its room (86ebf9e12).
4. **A Size change mid-run** started a run, so the Fill steps after it
   measured against their own frame, not the area they came from. *Decided:
   every step of a run measures against the same area.* Only an arrow, or a
   step not enlarged, starts a run (493e7b4e1).
5. **An enlarged step's marks' reach** (`zoomModel.windowReach`, in "Model
   and file format"): the file rule lets a mark on an enlarged step sit as
   far from the small window as a whole picture's marks may from its frame,
   so Enlarged carries the crane's long valley line there and back exactly.
   *Confirmed* as 16e built it. Amended by 8 below: a line crossing the
   frame is trimmed on its way in, and comes back trimmed.
6. **A frame dropped in a gap Spread Layers opens** settles on the layer
   above, the plan's rule: 61 px at 43% zoom on crane step 21 (0.028 picture
   units); every other drop landed where it was dropped. *Confirmed* as 16e
   built it.

**Decided with Zach, after 16g (2026-10-07).** Raised by 16g's review and
verify, each as recommended. Zach: "use your recs and include the enlarged
steps follow ups in the branch". 8, 10, 11 and 12 are built ("Follow-ups to
16g", after 16g); 7 and 9 confirm what 16g built.

7. **Paste between a whole step and an enlarged one.** 16g's fixer read "otherwise
   they land in identical units" as picture units, and built: marks go
   window → picture → window, so they land at the same place on the
   picture; between windows of two pictures not proven the same, they keep
   their window coordinates (`annotationClipboard.intoView`). On the crane,
   22 → 23 lands outside 23's window, and 23 → 22 lands on the head, in the
   area. *Decided: as built*, "at the same place on the picture".
8. **A copied line crossing an enlarged frame** ran on across the page: with
   86ebf9e12 marks outside the frame stopped sizing it, and on the crane the
   copied centre valley line, magnified about ×6, ran down page 3 through
   steps 23 and 26. *Decided: trimmed as it enters the window*, ending just
   past the frame by a fold line's overshoot past the paper's edge on a whole
   picture; stored, in the verb's one undo step, and dragged longer by hand.
   Arrows, labels, circles and other marks, and marks wholly outside the
   window, are left alone (the latter keep their badge, 3). This amends 5: a
   trimmed line comes back trimmed when Enlarged is turned off.
9. **Marks through a Relink, Refresh or Turn Over** stay unturned in the
   window (D8), and a spread change carries off-paper mark ends by the
   nearest face, which the window magnifies about 2.2×. *Decided: accepted*,
   both as consistent with whole steps.
10. **A step seeded enlarged** and then linked started at no turn, not the
    previous step's 158°, so on the crane its head pointed another way (16g
    finding 14). A whole step's first link starts at no turn too; only its
    spread comes from earlier steps. *Decided: an enlarged step's first link
    starts in its source's turn* (rotation, which holds an Upright, and a
    flat fold's side).
11. **A run of uploads after an enlarged step**: the second was seeded from
    the first, an upload with no faces, and so had no imprint. *Decided:
    every step of the run is seeded from the run's source frame and
    imprint.* *Superseded 2026-10-08 (`diagram-review-fixes.md`, item 3):*
    uploads are not seeded at all, and a new empty step after an enlarged
    upload starts whole.
12. **Show as Crease Pattern on an enlarged folded step** landed the frame on
    its anchor face's paper, 288 sheet units from the crane's head (Z8 as
    decided). *Decided: on a flat crease pattern, the frame lands on the top
    face at its centre, the paper its window showed*; Z8 amended there.

**Open with Zach (2026-10-07).** Raised by building 11 and 8.

- **A step made after an upload.** 11 keeps every upload of a run anchored,
  but a capture from a step with no faces still takes its frame and not the
  imprint it keeps (Where faces are missing; `zoomCapture.test.ts`, "not an
  imprint it keeps from its own capture"). So a step inserted after an
  upload, one or a run, then linked to a folded pattern lands its frame in
  picture units, not through the paper: on the crane, 314 sheet units from
  24's paper, before 11 and after it. Its first link also starts at no turn
  (10 reads the turn of the step its frame came from, the upload).
  *Recommended:* a seeded step takes a faceless enlarged step's stored
  imprint with its frame, and its first link the turn of the run's linked
  source; Enlarged turned on keeps the rule as decided.
  *Moot since 2026-10-08 (`diagram-review-fixes.md`, item 3):* an upload's
  run shows no picture type, so no step continues it. A step made after an
  enlarged upload is not seeded and starts whole, and one enlarged after it
  by hand starts whole at its first link. Listed for Zach to confirm in
  item 3's open calls.
- **A whole step's line pasted onto an enlarged one** (7) is not trimmed, as
  8 trims a carried one, so a long line pasted there runs across the page as
  8 found. *Recommended:* trim a pasted line as a carried one.
- **The overshoot's length.** No fold line in the app has a set overshoot:
  most of Zach's lines on the crane end on the paper's edge; the few he ran
  past it end 0.007–0.045 of the picture past. 8 uses 0.04 of the window
  (`ZOOM_LINE_OVERSHOOT`), about 1.9 mm on the crane's window at Fill. A
  number to tune by eye.

## Goal

Zach's Diagramming note (`Oristudio/Diagramming.md` in his notes), "Revision
2", 2026-10-05. Three asks, quoted as written:

1. **Equal divisions.** A sketch (`Diagramming-1791222430526`), then: "Add a
   tool for showing equal divisions. Basically you draw a line and specify
   number of divisions and can control how far offset it is off the line you
   drew". The sketch: a square's top edge in four; just above it, a thin line
   parallel to it; at each end and each quarter, a stroke square to the edge,
   from the edge up past the line; on each quarter, one slash leaning across
   the line; a dashed valley dropping from the first quarter; no number.
2. **The right-angle mark.** "The square indicator should have its own edges
   attached to it and be inside inside the actual place its showing, like
   this:" (`Diagramming-1791236414942`, 182 × 138 px). The sketch: where a
   fold meets a flap's edge at 90°, an ∟ of two legs of its own, parallel to
   the fold and the edge and set into the angle off the vertex, with a closed
   square in its corner.
3. **Enlarged steps.** "I want to have an option to show just a portion of the
   model. Generally you can kind of cut away everything outside a circle, or
   you can have the entire step just be zoomed in inside a circle. See below:"
   - **Look 1** ("Example one", steps 55 → 56, `Diagramming-1791236259175`):
     "1. The prior step circles the region that is going to be zoomed into",
     "2. There is a special arrow that kinda looks like a genie coming out of
     a bottle, the non arrowhead end is one point.", "3. Then basically you
     get a zoomed in version of the model and it just shows the arc of the
     circle that kind of cuts the zoomed in part off from the rest of the
     model". Measured: 55 carries a thin full circle over the head; a hollow
     arrow with a pointed tail starts just outside its rim and bends toward
     56; 56 is the head about 1.25× larger, cut off by one arc that runs about
     0.2 r past where it crosses paper, with nothing else of the model drawn.
   - **Look 2** (steps 46 → 47, `Diagramming-1791236450244`): "Another option:
     Basically if the entire region is inside the folded form (like you're
     zooming in on some interior flap) you just surroound with a shape. We can
     do a rounded rectangle like this:". Measured: a thin rounded rectangle
     over 46's central column, on a white casing that knocks out the creases
     it crosses; the same hollow arrow mid-gutter; 47 the column about 1.67×
     larger inside the whole rounded rectangle, drawn plain; the corner radius
     0.22 of the shorter side on both; the frame's top-right corner off the
     paper on both steps.

   In both examples the step with the region shows no other action inside it,
   and the enlarged step shows the same fold state, unturned, and carries the
   next instructions.

Revision 1's five asks are built (Phase 15a–15f: behind flaps, the line type
and Line tool, Angle Bisector with the equal-angle mark, pleat arrows, solid
arrows, close-ups) and are not redone here. The close-up (15f) is an inset on
the same step; an enlarged step is the cross-step version, the
`diagram-workspace.md` "Later" item "A per-step zoom ("enlarge from here")".
The note's "Before merging" question (a file format holding an array of
diagrams) is not part of this plan. It is a question about the file's top
level, answered on its own. Nothing here touches that level: this plan adds
step keys, a picture field and annotation kinds only, so it neither helps nor
blocks it.

## Approach

### Common ground

- **Units.** 1 ink = 1.25 CSS px = 0.331 mm (`ANNOTATION_INK_MM`, new in
  `diagram/annotate/canvasInk.ts`). Pens are in pt. The Diagram preset
  (`lib/paper/paperPresets.ts:48-61`) draws edges at 0.5 pt (0.53 ink); the
  picture's existing creases (mountain, valley, aux) at 0.25 pt; and the
  dashed fold lines and arrows at 0.75 pt (0.8 ink), all in one ink,
  #231f20. The ring pen (`markRingWidth`, ¾ of the arrow pen,
  `labelLayout.ts:130`) is 0.5625 pt = 0.6 ink = 0.198 mm. Every mark here is
  a print size in ink, as every mark since Phase 14 is, so it reads the same
  on the canvas (a 50 mm frame), on a card and at every printed scale.
- **Kinds.** A new kind fails to compile at about 13 exhaustive sites until
  each says what it does, and a new References primitive at
  `diagramPrimitiveShape`, `diagramInModel` and `markReach` (second pass,
  "Where Annotate stands"). Revision 2 adds two kinds, `divisions` and `zoom`.
  The right angle adds none.
- **The file.** Every new kind or field is read by the newer-build rule: an
  older build keeps it verbatim and does not draw it. Zach's crane
  (`crane.osf`) loads with every mark known after every phase, and every
  step saves back byte-identical; since 95a516de1 the file itself differs in
  one place, the page setup's `scale`, which is no longer written.
  `DIAGRAM_FORMAT_VERSION` stays 1; the Diagram is unreleased (PR #436).
- **Keys.** D (Equal Divisions, ED8 A), E (Enlarge) and Shift+E (Enlarge in
  Frame) (Z1) are unbound in the Diagram's scope today
  (`keyboard/shortcuts.ts:600-625`). Plain D is Edit's Edge line type and
  plain E its Extend Line (`shortcuts.ts:242, 267`), both in the
  crease-pattern scope, which is never live with the Diagram's, as S and F
  already are. Under ED8 A the rail's Marks group reads Circle, Right Angle,
  Equal Angles, Equal Divisions, Close-Up, Enlarge, Enlarge in Frame (today:
  Circle, Right Angle, Equal Angles, Close-Up, `annotateTools.ts:108-123`).
- **Decisions** are named Z1–Z10 (enlarged steps), ED1–ED13 (equal
  divisions) and RA0–RA8 (right angle); Z1–Z6, ED and RA follow the
  prototypes' numbering. All were decided on 2026-10-06; every ED and RA
  decision as recommended.
- **Names.** The UI, tool ids, i18n keys and analytics say *enlarge*; types,
  modules, fields and the file say `zoom`. A component is code, so it is
  `DiagramZoomControls`, `DiagramZoomView`, `DiagramStepZoomStatus`.

### 1. Enlarged steps

**Words.** The UI says **Enlarge**: Sturm's and Lang's word, with E as its
key. A rail tool called "Zoom" reads as a magnifier and collides with the
canvas's own zoom. Code and the file say `zoom` (Zach, 2026-10-06).

**The design in one paragraph.** Step 55 carries a `zoom` annotation, *an
area*: a circle or a rounded rectangle in 55's picture units, with an optional
Size, Edge and picked anchor. Drawing it changes nothing else. A step opts in
with **Enlarged** on Pose's toolbar, which *captures* a frame from the nearest
earlier step that has one (an area drawn on it, or its own frame if it is
enlarged) and stores it on the step, with the area's id as provenance. The
capture is an *imprint*: the source frame is laid on the paper through the
source step's *anchor face* (by default the backmost face lying outside the
frame), and drawn on this step where that paper lies, through the face that
holds the anchor's point on the paper here, turned and mirrored with it. Both
happen on the two pictures with their spread taken off; the landed frame then
follows this step's spread by its centre (two stages, Zach after 16.0). From
then on the step owns its frame: moving steps, or editing or deleting the
area, changes nothing on it. Toggling Enlarged off and on captures again, and
the area's **Update Enlarged Steps** captures again every step with its
provenance. A step added after an enlarged step starts enlarged. The frame is
a layer of the step that can be moved by hand; the step's marks are in its
window's units, so the window is its frame (D8). The arrow is computed at
layout, between a step that shows an area and an enlarged step after it, and
is never stored. Every edit is one undo step.

This replaces the plan of 2026-10-05, in which drawing an area inserted or
adopted the next step, an enlarged step found its area by walking back over
the steps before it, and windows landed on later pictures through a
sheet-centred plane. Zach's decisions of 2026-10-06 are recorded under
"Decisions: enlarged steps"; what was dropped, and why, under "Alternatives
considered". What the design avoids: an enlarged step with no picture of its
own; a step that changes because another step moved or was deleted; one
step's Pose re-posing another; a Frame sub-mode in Pose; the feature hidden in
Close-Up; an arrow that moves between the ring and the gutter by itself; a new
entry kind, which would reopen every `isTurn` consumer; a stored link that
drawing depends on, which a paste or a delete could break.

#### Settled by evidence, not left to Zach

- **Edge by shape.** A circle defaults to Cut (look 1) and a rounded rectangle
  to Whole (look 2). Look 2's frame has its top-right corner off the paper on
  both 46 and 47 (13–15% of its perimeter), so Cut would print it broken. Edge
  is stored only when picked; unsaid, it follows the shape, so changing Shape
  never overrides a choice. Zach's own rule for look 2, "if the entire region
  is inside the folded form … you just surround with a shape", is what Cut
  does by itself for a circle: one lying wholly over paper (cut pieces ≥ 97%
  of it) draws closed.
- **Pens.** The enlarged step's boundary is drawn in the paper style's edges
  pen (0.5 pt in the Diagram preset), in paper ink: both examples draw it at
  or below the model's edge weight (look 2's frame is 1.65–2.2 px against 2.4
  px edges). The area on the step before is drawn in the ring pen, in the
  arrows' ink, as a close-up's ring is.
- **Corner radius**: 0.22 × the shorter side, scaling with the enlargement
  (45/205 = 75/342).
- **Cut overshoot**: 0.2 × the printed radius (a rectangle: its shorter
  half-side), clamped to 2–6 mm. Look 1 runs about 65 px past the cut at r ≈
  320 px; a fixed 2 mm reads as a stub.
- **Zooming back out prints nothing**, and no magnification label prints. Lang
  says no reduced-view arrow is accepted, and neither example has either.
- **No keep-together rule.** Across a page break the arrow prints where D22
  puts a turn there, at the next picture's leading edge, and a notice names
  the split.
- **Each step keeps its own pose** (D5, D19). The frame lands wherever the
  anchor face lies in the step's own pose, so no step is re-posed to match
  another.
- **Several areas may sit on one step** (Zach's arrow rule names the case).
  **A step is enlarged or holds areas, not both**: enlarging an enlarged step
  comes later.

The prototype's knobs, for the overshoot (0.2 r or a fixed 2 mm), the boundary
pen (edges or arrows) and the word (Enlarge or Zoom), keep their defaults:
"all those defaults look good" (Zach, 2026-10-06). Its fourth knob, plain
picture units against the plane, belonged to the plane, which is gone.

#### Capturing a frame: the imprint

**Terms.**

- **Paper coordinates**: crease-pattern units about the centre of the paper's
  box. Every step of one paper shares them, because the paper's size does not
  change between steps; a copy of the sheet placed elsewhere in Edit for the
  next stage shares them too, since they are taken about its own centre. A
  crease pattern's paper is its scope's (the centre `creasePatternScene` turns
  about, `creasePatternScene.ts:70-76`); a flat fold's is the box of the
  kernel's `sheet_points`.
- **The unspread picture**: a flat step's picture as its pose draws it (side,
  turn, case) with no spread. A flat capture keeps each point's place on it
  in `paperFaces`. On a step with no spread it is the picture.
- **A face's placement**: the map from paper coordinates to this step's
  unspread picture for one face of the paper: the similarity (a turn or a
  reflection, one scale, a shift) fitted by least squares to the face's
  corners on the paper and on the unspread picture. The fold's own map is
  exactly such a similarity at the model's scale, mirrored exactly when the
  face shows its other side
  (`paper_scene_sheet_points_map_each_face_to_the_scene_by_a_similarity`,
  `crates/oristudio-cp/tests/folding.rs:2088`), so the fit is exact to the
  stored step. A crease pattern is one face, the paper, placed by
  `creasePatternScene`'s own map: about the paper's centre, mirrored for Back
  (`side`, 5b6872f8c), turned by `rotationDeg`, at `CAPTURE_PX_PER_UNIT`. It
  has no spread.
- **A face's drawn ring**: its whole ring in the stored scene when the step
  has a spread, and its unspread ring when it has none. A spread keeps every
  face, whole, one ring, corner for corner in the kernel's outline order
  (`markHidden: !spread`, `captureFolded.ts:214`; `emitWholeFace`,
  `foldedFlatScene.ts:763`), so the drawn places need no storing.
- **A face's spread move**: where the spread takes a point of the face: its
  mean value coordinates over the face's unspread ring (`meanValueWeights`,
  `foldedLayerSpread.ts:495`), and the same weights over its drawn ring. For
  both spreads that is the painter's own field (`placement`,
  `foldedFlatScene.ts:179`), exactly: it moves the corners and blends them by
  those weights inside. It is how `spreadMove` already carries marks when a
  spread changes (`annotationCarry.ts:284`).
- **Onto the spread**: an unspread point goes by the spread move of the face
  on top there unspread: the last whole face, in the stored scene's paint
  order, whose unspread ring holds it.
- **Off the spread**: a drawn point goes to the unspread point that onto the
  spread takes to it. Of the faces whose drawn ring holds it, the last
  painted whose spread move, undone there, lands where that face is on top
  unspread. Undoing is solved, not fitted: Newton's method from the face's
  affine fit, exact for the affine spread (its move is affine on a face) and
  within 2e-12 px for the depth spread on 16.0's captures. Where no face
  qualifies, the point lies in a strip the spread opened, where a lower layer
  shows; the face drawn on top there is used. Everywhere else the two are
  inverse. A point on no face goes by the nearest face's move at the nearest
  point of its ring. With no spread both are the identity.
- **A frame's anchor face**, on its own step: a picked one (the face holding
  the paper point stored with the frame), or the face the default rule below
  chooses.
- **The anchor's paper point**: the picked point, or, by default, the point
  inside the anchor face farthest from its edges, on the paper.

**A capture**, from a source frame F on step S onto step N, in two stages
(Zach, after 16.0; "For Zach" there):

1. F's anchor face A on S, and its paper point P.
2. *Off S's spread*: F's centre taken off the spread. Its size and angle stay
   as drawn.
3. *Imprint*: that frame carried onto the paper by A's placement on S,
   inverted: its centre, size and angle in paper coordinates.
4. The face B of N's paper that holds P. A flat fold's faces tile its paper,
   so there is one; a point on a crease goes to the lower face index.
5. *Land*: the imprint carried into N's unspread picture by B's placement on
   N. It turns and mirrors with B, so a rounded rectangle may land at any
   angle; no rule keeps it upright.
6. *Onto N's spread*: the landed centre taken onto the spread, by the face on
   top under it, not by B. The frame keeps the size and angle it landed with:
   a circle stays a circle and a rectangle is not skewed.
7. N stores the frame as drawn (step 6), the imprint and P, F's shape, Size
   and Edge, F's anchor if it was picked, and F's provenance: the area's id,
   or, when F is an enlarged step's frame, that step's provenance.

Zach: "imagine imprinting the frame onto the face and seeing where it lands on
the paper. Then using that every time to draw the frame on subsequent steps."
Steps 4–6 also place a frame again when its own step's picture changes, from
its stored imprint and P. Steps 2–3 alone, on its own step, run when the
frame is moved by hand or its anchor is picked: the frame stays and its
imprint is made again. Since onto the spread undoes off the spread, the frame
lands again where it was left, except a frame whose centre was dropped in a
strip the spread opened, which settles on the layer above, at most the
strip's width away (confirmed by Zach, 2026-10-07).

**Why two stages.** Landed in one stage, through placements fitted to the
spread pictures, a frame drifts by up to 5.46% of its diameter whenever S's
and N's folds hold different faces still and a spread is on: the spread then
moves the anchor and the framed part apart differently on the two steps.
Unspread, the imprint is exact on every refold 16.0 tried. Following the
spread by the face under the centre lands every case within 1.36%; following
it by B instead lands up to 5.22% off, no better than one stage, because B
is the part the spread moves differently from the framed one. The measured
cases are under 16.0.

**Where faces are missing.** A 3D, simulated, References, uploaded, fixed or
raster picture has no faces to anchor to. When S or N is one, F is copied in
picture units: the frame keeps its centre, size and angle in the
frame-relative units every picture uses, and the Anchor row is hidden on such
a step. From a crease pattern, the paper is the only face and the anchor's
paper point is F's centre on the paper, so a later folded step places the
frame by the face under that centre. Onto a crease pattern, the imprint lands
on the paper directly.

**The default anchor.** Zach: "it should be selectable, lets try defaulting to
the back most face that is outside the bounds of the region. Since thats the
face least likely to move."

1. The candidates are all of S's faces, hidden ones included, ranked by
   *level*: the longest chain of faces stacked over a face as the picture is
   seen (`layerLevels`, `cp-workspace/folded/foldedLayerSpread.ts:394`). The
   kernel gives each subface's stack as seen in its pass
   (`faces_top_to_bottom`), so a picture turned over, or seen from the back,
   is ranked from the side it shows: a stack's top layer seen from the front
   is its bottom one seen from the back. The greatest level is backmost; a
   tie goes to the larger face on the paper, areas within 0.1% counting as
   equal, then to the lower face index. Paper areas, not picture areas: on
   crane step 22 the two deepest faces, 33 and 14, are symmetric twins of
   equal paper area whose picture areas differ only by rounding, and by up
   to 5% under a spread (16.0).
2. The backmost face lying entirely outside F: its drawn ring misses F's
   shape as drawn.
3. If every face touches F, the backmost face that reaches outside it.
4. If none does (F takes in the whole model), the backmost face.

A flap folded inside the frame is what the enlarged steps go on to move, and
the frame must not follow it; the layer at the back, away from the frame, is
what a fold inside the frame leaves still.

**Picking.** The Anchor row (Controls) arms a pick mode on the canvas; a click
anchors the frame to the face drawn on top under the pointer, at the point
clicked: that face's spread move undone there, then its placement inverted.
Re-picking never moves the frame on its own step: it makes the imprint again
on the picked face, and so changes where later captures from it land. A
picked anchor is copied by captures, so a series of steps keeps one point on
the paper; a default one is worked out afresh on each step a capture is taken
from.

**Where the faces come from.** The kernel already gives everything this needs,
and no kernel change is planned: `FoldedPaperScene` (schema 3,
`crates/oristudio-cp/src/folding.rs:669-725`) has each `FoldedPaperFace`'s
folded `outline` and the wireframe `points` it names, `sheet_points` placing
each of those points on the unfolded sheet, and each subface's
`faces_top_to_bottom`. The web already reads these for the affine spread
(`affineSpread`, `fitAffine`, `anchorFace` and `layerLevels` in
`cp-workspace/folded/foldedLayerSpread.ts`). What is missing is on our side.
A step keeps only its `PaperScene` (`DiagramScenePicture.sceneJson`,
`diagramDocument.ts:502`), which has no paper coordinates and no unspread
places; with no spread it also drops hidden faces (`storableScene`,
`captureGeometry.ts:63`), and the backmost face is usually hidden. So a flat
capture also stores `paperFaces` (below): each point's place on the paper and
on the unspread picture, and each face's corners and level. It is computed in
`flatPicture` (`captureFolded.ts:201`), the one path for Link, Refresh,
Show as and Pose, from the paper scene it already reads, on every flat step
(Z11). The drawn places are not stored again: the stored scene has them
whenever they differ from the unspread ones. Flat captures made before it
have none until they are needed, and then get them from their pattern
folded again while the link is current, or else by a Refresh (S5).

**On the crane.** Step 55's area rings the head. Its default anchor is the
body's back layer, wholly outside the ring. Step 57 refolds the head on the
next sheet, and that capture's fold may hold another face still and give the
model new bounds. The back layer's paper point is still on 57's paper, on the
face that holds it there, and the frame lands where that face puts the
imprint, unspread: round the head, as long as the body has not moved against
the head. It then follows 57's spread with the head. On 16.0's refolds of the
crane's head it lands within 1.36% of its diameter under the default affine
and depth spreads, and within 0.01% with none.

#### Walkthroughs

**S1, look 1: 55 → 56 (a flat fold; a circle; the arc only).**

1. Open 55 in Annotate: double-click its card, or its Annotate corner button.
2. Press E, or click **Enlarge** in the rail's Marks group. The tool window
   says "Drag out from the middle of an area to mark it for an enlarged step.
   Click for a standard size." The centre does not snap, as a close-up's does
   not.
3. Press on the middle of the head and drag out until the rim cuts the brown
   flap. A live ring follows the pointer.
4. Release. One undo step, "Enlarge Area": the circle is added to 55 in the
   ring pen, with no casing (Z5). Nothing else changes. Annotate stays on 55
   with the area selected; its anchor face, the body's back layer, is
   outlined in the selection ink. Layers shows its row, **Enlarge area**, "No
   step is enlarged from it": Shape Circle · Size empty (placeholder "Fill") ·
   Edge Cut · Anchor "Auto" (its tooltip "The backmost face outside the frame") · Update Enlarged
   Steps (disabled) · Delete.
5. Make 56. At the end of the diagram, 55's card menu › **Duplicate Step**
   (the copy has the same link, picture and pose, and 55's marks, the area
   among them), or **Insert Step After** and **Link Pattern…** to the same
   sheet. If 56 already exists, skip this.
6. On 56, Pose's toolbar › **Enlarged**, whose tooltip reads "Enlarge from
   step 55's area". One undo step: the capture. On a duplicate, the copied
   area is removed in the same step, since a step is enlarged or holds areas,
   and the tooltip then adds "…and remove this step's own enlarge area". The
   step's other marks are carried into the frame's units. 56 shows 55's
   picture, so the frame lands where the circle is.
7. Press → (Next Step, `shortcuts.ts:580`) on 55, or open 56 in Annotate: the
   head enlarged and clipped to the circle; one arc where the circle crosses
   paper, running on about 0.2 r past each crossing; nothing else of the
   model.
8. Draw 56's marks as on any step: Shift+V and a drag for the valley line, V
   and a drag for the arrow, the caption in Step › Instruction. Labels, heads
   and snapping behave as on any step, because the window is the frame.
9. Pages view: 55 with its full circle; the hollow, pointed-tail arrow in the
   gutter at the circle's printed height, pointing at 56 (Z3); 56 filling its
   room (Z4).

The gesture is E, one drag, Duplicate Step, Enlarged.

**S2, look 2: 46 → 47 (an interior region; a rounded rectangle drawn whole).**

1. Open 46 in Annotate and press Shift+E (**Enlarge in Frame**).
2. Drag corner to corner around the central column. Its aspect is free: the
   drag sets the width and the height on their own, so it is any rectangle;
   Shift makes it square; Alt drags from the middle. The corners round at
   0.22 × the shorter side.
3. Release. One undo step: the rounded rectangle is added to 46 in the ring
   pen, over a white casing that knocks out the creases it crosses (Z5); Edge
   is Whole. Nothing else changes.
4. If 47 already shows 46's fold, as in look 2, turn on its **Enlarged**;
   otherwise Duplicate Step on 46 and turn on the copy's.
5. Open 47 in Annotate: the column enlarged inside the whole rounded
   rectangle, drawn in the edges pen; the model's lines stop at the frame.
   Press H for the hidden line, draw the loop arrow, type "Bring the hidden
   corner to front."
6. Pages view: the arrow mid-gutter at the frame's height (Z3); 47's tall
   window runs down its room, with the caption under it.

**S3, adjusting afterwards.**

- **The area, on 55.** It hits on its outline only, and last, under the other
  marks, as a close-up does, so marks inside it stay clickable. Selected, its
  centre dot moves it and its rim resizes it; a rectangle has 4 corner and 4
  edge grips (Shift keeps the aspect, Alt resizes about the centre). Grips are
  at least `--touch-target` on coarse pointers. Each drop is one undo step and
  changes 55 only. The row now reads "Enlarged on steps 56–60" and offers
  **Update Enlarged Steps**, whose tooltip says "Place the frame again on
  steps 56–60 from this area as it is now, over any move made on them". One
  undo step captures each step with this area's provenance again, wherever it
  now sits; their marks are carried with their windows, so they stay on the
  same paper.
- **The frame, on 56.** Layers' first row on 56, **Enlarged frame** ("From
  step 55's area"), or a click on the boundary on 56's canvas, selects it.
  Selected, the canvas also draws 56's picture round the frame, dimmed, with
  the anchor face outlined, and the frame's grips: the centre moves it, the
  rim (a rectangle's corners and edges) resizes it. A drop is one undo step:
  the frame moves on 56's picture, its imprint is made again on the same face,
  and the marks are carried by the window's move (a scale and a shift), so
  they stay on the same paper. The row's note: "Update Enlarged Steps on step
  55, or turning Enlarged off and on, places this frame again." The frame is
  not turned by hand in v1; its angle comes from its face.
- **Size** (Z4). Empty means Fill. Type 1.25 and the step prints at 1.25 × the
  area's printed size; where a room cannot hold that, the read-out turns
  amber: "Asked ×3 · prints ×2.4 — the room is too small". Clear the field to
  go back to Fill. On an area, Size is what later captures copy; on a frame,
  it is that step's own.
- **Shape** [Circle | Rounded rectangle]. A circle of radius r becomes a 2r ×
  2r rounded square; a w × h rectangle becomes a circle of radius ½·max(w, h).
  A circle round-trips exactly. An unsaid Edge follows the new shape; a chosen
  one is kept. On a frame, the centre stays and the imprint is made again.
- **Edge** [Cut | Whole]. Cut is disabled, with the hint "This picture has no
  paper outline to cut along", when the step's picture has none (uploads,
  fixed SVGs, raster captures). Such steps always draw Whole.
- **Anchor**, on an area and on a frame: "Auto" or "Picked", on one line in
  both states, each saying what it is in its tooltip ("The backmost face
  outside the frame"; review of 16e: the long rule wrapped and moved the rows
  below on every pick). **Pick** arms the pick mode: on the canvas the face drawn on top
  under the pointer is highlighted (on 56 the picture round the frame shows
  while its row is selected, so faces outside the frame can be picked), and a
  click anchors to it, one undo step. Escape, or Pick again, leaves the mode.
  **Reset** returns to the default. Neither moves the frame on its own step.
- **Delete the area**: the verbs row's Delete, or Delete/Backspace with the
  area selected. One undo step that changes 55 only: 56–60 keep their frames,
  their frame rows read "From an area no longer in the diagram", and nothing
  offers to update them.
- **Turn off Enlarged on 58**: one undo step; 58 shows the whole model, its
  marks carried from the window to the whole picture; 57 and 59 are
  unchanged. Turned on again, it captures from the nearest earlier step with
  an area or a frame: 57's frame.

**S4, folding on while enlarged (57–60), then 61 whole.**

1. 56 is enlarged. In Edit, fold the next crease, on a new sheet (one per
   stage) or on 55's own sheet.
2. In the Diagram, 56 › **Insert Step After** (or Add Step with 56 last). The
   new **57 starts Enlarged**, as Spread Layers is seeded (`spreadStartsFor`,
   `diagramDocument.ts:263`): captured at creation from 56's frame, with its
   provenance (55's area), Shape, Size, Edge, anchor and imprint. It has no
   picture yet, so no landed frame; it is an empty card with the chip
   "Enlarged · 55".
3. **Link Pattern…** › the sheet › Folded. The imprint lands on 57's
   unspread picture through the face that holds the anchor's paper point,
   though the folded model's bounds changed and the capture's fold may hold
   another face still, and the frame then follows 57's spread by its centre.
   If the frame holds no paper, the Step pane warns "The enlarged frame holds
   no paper on this step." Another route: **Duplicate** 56 (the copy keeps
   Enlarged, the frame, the imprint and the marks), delete the marks that no
   longer apply, then Link Pattern… to the next sheet; the frame lands from its
   imprint on the new picture.
4. Annotate 57 in its window. Repeat for 58–60.
5. For 61: Insert Step After 60 (it starts enlarged), Link, then release
   Pose's pressed **Enlarged**: 61 shows the whole model. Nothing prints
   between 60 and 61.
6. Pages view: 56–60 at one size (Fill's smallest over them); 61 back in
   54–55's Fit-each run, as enlarged steps are left out of runs.

**S5, moves, deletes, refreshes, re-poses.** Nothing is captured again on its
own: only the toggle and Update Enlarged Steps take a frame from another step.

- **Reordered** (Zach's example). Drag 19 to after 11 and it keeps the frame
  captured from 18's area. The arrow is read from the order: it prints before
  19 only if 11 shows an area, leaving the one with 19's provenance or else
  11's first. Moving 18 away leaves 19 as it is, with an arrow only if the
  step now before it shows an area; moving 18 back restores the arrow, since
  nothing stored changed.
- **The area's step deleted.** 56–60 stay as they are; their provenance points
  nowhere, and nothing offers to update them.
- **55 refreshed** (Out of date → Refresh). The area is a mark and follows D8:
  it stays in picture units, out of step, with D8's notice. 56–60 are
  unchanged. Update Enlarged Steps captures them again from the area where it
  now lies.
- **55 re-posed** (Rotate, the Rotation field, Upright, Spread, Front | Back).
  `carryZoom`, modelled on `carryCloseUp` (`annotationModel.ts:1571`), moves
  the area with the paper: its centre with the face under it, its size with
  the move, its angle with the turn at any angle, mirrored with the side.
  56–60 are unchanged.
- **56 refreshed, relinked or re-posed.** Its frame stays on its paper: the
  stored imprint lands on the new unspread picture through the face that
  holds its paper point, then follows its spread. A re-pose that changes only
  the spread (Spread Layers, its kind or amount) moves the frame with the
  layer under its centre and changes neither its size nor its angle. This is
  the step's own capture following its own picture, not a capture from
  another step. Its marks, in the window's units, go with the frame; a
  refresh still shows D8's out-of-step notice. If the paper point is not on
  the new paper, the frame stays where it was in picture units, with the
  notice "The frame's anchor is not on this step's paper".
- **Duplicate 55.** The copy and its area (a fresh id) land between 55 and 56,
  and 56 keeps its provenance. The arrow now prints from the copy to 56 (it
  shows an area and 56 is enlarged), leaving the copy's first area, and none
  prints from 55 to the copy. The copy's area row says "No step is enlarged
  from it". Literal and visible.
- **Duplicate 56.** The copy keeps Enlarged, the frame, the imprint and the
  provenance, so Update Enlarged Steps on 55's area places it too.
- **A References step, an upload, a 3D or simulated step.** No faces: the
  frame is copied in picture units, and the Anchor row is hidden. An enlarged
  References card is rebuilt at the larger sheet size (`paintStepDiagram`), so
  letters and arrowheads keep their pt size; Cut follows the sheet's rim and
  the flap polygons the card draws. An upload is drawn Whole; a raster
  enlarged below 200 dpi at its printed size gets "Kept as a bitmap — it
  prints soft". An upload that is already an enlargement (a hand-drawn one) is
  framed by moving and resizing the frame by hand to take in the picture.
- **A flat capture older than `paperFaces`** (every flat step of the crane
  today). Its faces are fetched when they are needed — as it becomes an
  enlarge source or is enlarged, the capture paths 16e calls — by folding its
  linked pattern again (`stepWithPaperFaces`, `capture/stepPaperFaces.ts`),
  but only while its link is current and the fold draws its stored picture
  (the same picture key), so the faces are that picture's. Otherwise —
  stale, missing, no pattern open, or drawn differently by this build — it
  has none until refreshed: a capture from it or onto it copies the frame in
  picture units, and the Step pane says "Refresh step 55, then Update
  Enlarged Steps on step 55's area, to anchor the frame to its paper" (or
  "…then turn Enlarged off and on" once the area is gone), naming whichever
  step lacks them. A Refresh alone does not place a frame captured as a copy
  again, so the notice is worked out from the frame itself: while the frame
  has no imprint on a step whose paper could anchor it, and both steps have
  their faces, it says "Update Enlarged Steps on step 55's area to anchor
  the frame to its paper" (review of 16e, 2026-10-06). Refresh is offered on
  a current flat step with no faces (`facesMissing` in
  `diagramActions.ts`), so that notice never names a disabled verb.

**S6, print.** Defaults: A4 portrait, 12 mm margins, 3×3 grid; each cell 62 ×
84.67 mm. Every diagram fits each, no longer a choice since the One scale
option was removed (95a516de1). Sizes are Fill's (Z4) and the arrow's places
D22's (Z3).

- **Gutter.** A diagram with any enlarge arrow reserves D22's 14 mm gutter
  between every pair of rooms (`diagramPageLayout.ts:764-769`), as one turn
  does. Rooms are 48 mm wide instead of 56.
- **Sizes.** 55 prints at its run's scale: an area ringing 0.3 of a 48 mm-wide
  model is about 14 mm across. Under Fill, 56's cut content fills its 48 mm
  room, so the frame is about 64 mm: "Prints ×4.4". The empty, off-paper part
  of the circle takes no room. Look 1's literal ×1.25 would give an 18 mm
  picture in a 48 mm room.
- **Same row** (55 in column 1, 56 in column 2). The arrow is centred
  mid-gutter (x = 74 mm); its box, about 12 × 9.5 mm, clears both rooms by 1
  mm. It sits at the area's printed centre height, with its box clamped inside
  both drawn pictures' vertical overlap, clear of 56's number band. It points
  right and bows up.
- **Row break.** The arrow goes where D22 puts a turn glyph across a row
  break, with no lift. In the flow layout that is the lane between the rows
  where the flow turns, between the bottom of 55's row and the top of 56's
  (Zach's change to D22 of 2026-10-06, being built now); in the grid, D22's
  place there as built. It points on to 56: in the grid along 56's row; in
  the flow aimed from the bend at 56's picture, its bow on the bend's
  outside, and the row above keeps room for it at its tallest, 11.7 mm
  (Zach, 2026-10-07: mirrored the next row's way, it pointed across the
  page).
- **Flow.** A left-to-right row as the grid. A right-to-left row: mirrored,
  pointing left, the bow still up, the lift applied. Which rows run right to
  left is per page since printed spreads (D10, 2026-10-06): read it from the
  layout's `rightToLeft`, never from the row's index; on a right page read
  from the bottom up, a row break's place is still D22's, on the lane between
  the upper step's words and the lower one's number.
- **Different pages.** The area prints with 55 on page p and the arrow on p+1
  at 56's leading edge, D22's page-break place. The Pages view and the Export
  dialog say "Step 56 is on the page after the area it enlarges"; the fix is
  **Start a New Page Here** on 55.
- **Fit each.** Enlarged steps stay out of the Fit each runs: they never
  enter `scaleRuns`. They print at Fill, or at Size × the area's printed
  size. 55 and 61 stay neighbours in one Fit-each run. D10 is amended to say
  so.
- **A turn between** ([55, Rotate, 56]): the rotate glyph and the arrow stack
  in one gutter, turns first, 1.5 mm apart. No lift.
- **PDF**: the composed page SVG goes to the writer unchanged; krilla's clip
  paths were proven in 15f.
- **ZIP step files.** 55 keeps its area. 56 is framed alone, at the size its
  page prints it, no larger than its file's picture box holds (Zach,
  2026-10-07: measured against the area's size in the files, which share one
  scale smaller than the page's, it printed half its page size). No arrow:
  the `turnsLeftOut` notice (`DiagramExportOptions.tsx:223-230`) becomes
  "Turns and enlarge arrows print only on pages".

#### Controls, pane by pane

- **Annotate rail, Marks group, after Close-Up.** **Enlarge (E)** draws a
  circle from its middle; **Enlarge in Frame (Shift+E)** draws a rounded
  rectangle corner to corner. The rounded rectangle's aspect ratio is free:
  any rectangle, drawn corner to corner (Shift squares it, Alt draws it from
  the middle), no ratio special, and freely resizable afterwards by corner
  and edge grips, on the area and on an enlarged step's frame (S3). Zach, 2026-10-06: "you should be able to draw like some rectangle, or you know, it could be a square, but it's like the like that aspect ratio isn't special. It should be like you know you should be able to modify it."
  They are `DrawingTool` ids `ENLARGE`
  (`'enlarge'`) and `ENLARGE_FRAME` (`'enlarge-frame'`), as `SOLID_ARROW` is
  one, laying kind `zoom` with a look `{shape}`; `drawingLook`
  (`annotateTools.ts`) widens from `WhiteArrowLook` to a per-tool look, after
  the Solid Arrow's precedent. Keys go through the registry:
  `DiagramAnnotateShortcutId`, the `diagramShortcut` definitions,
  `ANNOTATE_SHORTCUT_IDS` (`diagram/actions/diagramShortcuts.ts`) and
  `i18n/shortcutLabels.ts`. The tools are disabled, with a reason, on a step
  with no picture; on an enlarged step ("This step is already enlarged —
  draw the area on a step that shows the whole model", which a paste that
  leaves an area out says too; there, an Enlarge tool in hand from another
  step is Select, and the rail shows Select); on a locked step; on a
  read-only diagram. No pre-draw option is added: Line Type stays the rail's
  only one.
- **Annotate canvas, a step with areas.** Each area is a mark with grips.
  Selected, its anchor face is outlined in the selection ink, where the step
  has faces.
- **Annotate canvas, an enlarged step.** The window is the canvas's frame. The
  frame is a layer: a click on its boundary, or its Layers row, selects it,
  and it joins the canvas's selection under a reserved id, so selection and
  Escape take today's paths. Selected, the canvas also draws the picture
  outside the frame, dimmed by 45% page colour, the anchor face outlined, and
  the frame's grips; the canvas zooms out to reach them. Delete is not
  offered on the frame: Pose's Enlarged turns it off.
- **Pick mode**, on either canvas: Pick in the Anchor row arms it; hovering
  highlights the face drawn on top under the pointer (the stored scene's face
  items carry the kernel face index `paperFaces` is listed by); a click
  anchors. Escape, or Pick again, leaves it. The keys go through the shortcut
  runtime (`keyboard/`), never a listener on the canvas.
- **Layers pane, a step with areas.** A row per area, "Enlarge area" with its
  glyph, subtitled "Enlarged on steps 56–60" or "No step is enlarged from it",
  counted by provenance wherever those steps are. Selected, it shows
  **DiagramZoomControls**, a new component with its own CSS module: Shape
  [Circle | Rounded rectangle] (SegmentedRow); Size (NumberRow, ×, 1.25–6,
  step 0.25, empty means Fill); Edge [Cut | Whole] (SegmentedRow); Anchor;
  a read-out line; and the verbs from the `zoomActions` catalog: Update
  Enlarged Steps (disabled, with "No step is enlarged from this area", when
  none is) · Go to Step 56 (the first of them) · Delete.
- **Layers pane, an enlarged step.** The first row, "Enlarged frame",
  subtitled "From step 55's area" or "From an area no longer in the diagram".
  Selected, the same controls, writing this step's frame; Go to Area on Step
  55 while it exists; and the note about Update and the toggle. Marks lying
  wholly outside the window grown by one window are kept, not drawn or
  measured, and carry an "Outside the enlarged frame" badge.
- **The Anchor row**, inside DiagramZoomControls: "Backmost outside the frame
  (auto)" or "Picked"; Pick; Reset while picked. Hidden on a step with no
  faces, and on a crease pattern, whose one face is the paper.
- **Pose toolbar**, on both paths (the linked catalog behind
  `DiagramLinkedPoseControls`, and `poseActions` for uploads and References;
  `DiagramStepDetail.tsx:176-208`). **Enlarged** is a pressed toggle, a
  descriptor from `diagram/zoom/zoomActions.ts` shaped like `spread-layers`
  (`diagramLinkedPoseActions.ts:208`). Its tooltip names the step it would
  capture from. On a step that holds areas (a duplicate of the area's step),
  turning it on removes them in the same undo step, and the tooltip says so.
  It is disabled, with "No earlier step has an area to enlarge: draw one
  with Enlarge", when no earlier step has an area or a frame.
- **Pose stage of an enlarged step**: the whole picture, the frame outlined
  dashed in the selection ink, everything outside dimmed by 45% page colour,
  the marks ghosted in place. Screen-only; no verbs. A live 3D or simulated
  view shows the outline ghosted over the camera.
- **Step pane** (fields only): **DiagramStepZoomStatus**, with its own CSS
  module, mounted by one line in `DiagramStepPanel` after Pose. A read-only
  section "Enlarged" with the rows From ("Step 55's area", a link) and Size
  ("Fill · prints ×4.4"), an amber read-out as a notice;
  and the notices: the frame holds no paper; the anchor is not on this step's
  paper; a capture older than `paperFaces` (refresh to anchor); prints soft.
  Each names the verb that fixes it; the pane has no buttons.
- **Step catalog**: nothing new. Duplicate Step and Insert Step After are
  today's verbs.
- **Steps grid**: an "Enlarged · 55" chip with the arrow glyph on enlarged
  cards (`DiagramStepCard.module.css`), "Enlarged" alone once the area is gone.
- **Pages view**: a hit target for each arrow, as for turns
  (`DiagramPagesView.tsx:102-121`). A click selects the enlarged step; a
  double-click opens the area's step in Annotate with the area selected.
- **Export dialog**: notices for arrows left out of step files and for an
  enlarged step on the page after its area.
- **Page pane**: nothing new.
- **Where the behaviour lives**: `diagram/zoom/zoomActions.ts` (a React-free
  catalog: Enlarged, Update Enlarged Steps, Pick, Reset, the Go to verbs),
  `diagram/zoom/useZoomControls.ts` (the Layers bindings),
  `diagram/zoom/useStepZoom.ts` (the Step pane and Pose toggle bindings) and
  `diagram/zoom/useAnchorPick.ts` (the pick mode's canvas bindings). Every edit
  is one undo step through a `diagramSlice` verb; `DiagramLayers` and
  `DiagramStepPanel` only compose.

#### Model and file format

```ts
// diagram/document/diagramDocument.ts
export type DiagramAnnotationKind = /* today's 17 (l.555) */ | 'zoom';
/** How an enlarged step draws its frame: only where it cuts paper (look 1), or all of it (look 2). */
export type DiagramZoomEdge = 'cut' | 'whole';
export type DiagramZoomShape = 'circle' | 'rounded';

interface KnownDiagramAnnotation {
  /* …existing… A `zoom` is an AREA, marking what a later step may enlarge. Drawing one changes no other step.
   *   from = to = the area's centre, in this step's picture units
   *   radius = a circle's radius (0.015–1, the close-up's range and reader)
   *   scale  = the Size captures copy: that many times the area as it prints, 1.25–6; unsaid = Fill */
  /** A rounded rectangle's width and height in picture units; exactly one of `radius` and `size`. */
  size?: [number, number];
  /** Degrees clockwise: a rounded rectangle's turn, from a pose that carried it. Unsaid 0. */
  angle?: number;
  /** Unsaid: the shape's own (circle 'cut', rounded rectangle 'whole'). */
  edge?: DiagramZoomEdge;
  /** A picked anchor: a point on the paper, in paper coordinates. Unsaid: the default rule. */
  anchor?: [number, number];
}

/** A circle or a rounded rectangle, centred, turned clockwise by `angle`; exactly one of `radius` and `size`. */
export interface DiagramZoomOutline {
  centre: [number, number];
  radius?: number;
  size?: [number, number];
  angle?: number;
}

/** An enlarged step: it shows a frame of its OWN picture, captured from an earlier step at one moment. */
export interface DiagramStepZoom {
  /** Provenance only: the area it was captured from, directly or through an enlarged step. Never read to draw. */
  from: string;
  shape: DiagramZoomShape;
  /** The frame in this step's picture units, as drawn (onto its spread). Absent while the step has no
   *  picture (seeded empty). The step's marks are in the units of its upright box, the window: the window
   *  is its frame. */
  frame?: DiagramZoomOutline;
  /** The frame on the paper, in paper coordinates, and `on`, the anchor's paper point; `picked` when the
   *  anchor was picked. Absent where the step has no faces. */
  imprint?: DiagramZoomOutline & { on: [number, number]; picked?: true };
  scale?: number;          // as the area's; unsaid = Fill
  edge?: DiagramZoomEdge;  // as the area's
}
export interface DiagramStep { /* …existing (l.758)… */ zoom?: DiagramStepZoom }

/** A flat fold's faces as anchoring needs them, each wireframe point once (the shared-points form). */
export interface DiagramPaperFaces {
  /** Per point: its place on the paper (paper coordinates), then on the unspread picture (scene px). */
  points: [number, number, number, number][];
  /** Per face, in the kernel's face order: its corners as indices into `points`, in its outline's order. */
  rings: number[][];
  /** Per face: the faces stacked over it as the picture is seen (`layerLevels`); the greatest is backmost. */
  levels: number[];
}
/** `paperFaces`: a `DiagramPaperFaces` as a string of compact JSON, as `sceneJson` is a scene. */
export interface DiagramScenePicture { /* …existing (l.502)… */ paperFaces?: string }
```

`paperFaces` lists every face the kernel names on the sheet (`sheetNamedFaces`,
`foldedLayerSpread.ts:288`), hidden ones included, in the kernel's face order,
which the stored scene's face items already carry as `face`. It is written by
flat captures only: a crease pattern's one face comes from its render, and no
other picture has faces.

- **Unspread places only.** A point's drawn place is read from the stored
  scene, through its face's drawn ring (Terms): with a spread on it is there,
  and with none it is the unspread place. Storing it as well would add 7 kB
  on the crane and say nothing new. Recomputing one set of places from the
  other is possible, by running the spread or inverting it (the affine
  spread inverts to 0.007 px, given the face it holds still), but it would
  tie a stored snapshot to the spread code of whichever build reads it,
  which the stored scene never is.
- **Rounding.** Unspread places to the stored scene's step
  (`storedSceneStep`). Paper places to the power of ten at or below that step
  over the capture scale: 0.001 of a unit on the crane, within the scene's
  step, and short decimals (117.156) where 16.0's rounding wrote twelve
  digits (117.156462585).
- **A string, not a JSON value.** The project file is written pretty-printed
  (`serializeNativeProjectFile`, `lib/nativeProjectFile.ts:480`), which puts
  each number of an array on a line of its own: as a value, the crane's
  `paperFaces` would add 126 kB instead of 20.6 kB. In memory it stays the
  string and is read through `paperFacesOf`, memoized per picture as the
  stored scene is.
- **The budget (Z11).** The whole file: with every flat step refreshed, the
  `.osf` grows by at most 1%, the faces as the file writes them. There is no
  cap per step: with no spread a step's stored scene drops the faces it
  hides while `paperFaces` keeps every one, so a step's faces may outweigh
  its scene (1.35–1.45 on the 16.0 fixture) while the file barely grows.
  Measured as the writer landed, every flat step refreshed through Refresh
  and saved by the app: the crane +0.84% (20.5 kB of faces on 2.49 MB), the
  heart (`heart.osf`) +0.65%, the chipmunk +0.18%, Reference Diagrams +0.37%.
  `zoom/paperFacesBudget.test.ts` holds what the budget rests on: a step's
  faces add their compact string to the file and nothing more, the same
  whatever the spread. If a change or a diagram breaks the 1%, it does not
  raise it: the numbers go to Zach. The lever then is to write `paperFaces`
  only on steps that hold an area or a frame; not coarser rounding, which
  would give up exactness.

Pure modules in `diagram/zoom/`:

- `zoomModel.ts`: `ZOOM_CORNER` 0.22 (× the shorter side); the click sizes
  (radius 0.15; 0.3 × 0.3); `ZOOM_SCALE` = `CLOSE_UP_SCALE`
  (`annotationModel.ts:978`); Fill clamped to [1, 6] × the area's printed
  size; the overshoot {share 0.2, 2–6 mm}; closed when the cut pieces cover ≥
  97%; gaps under 2 mm merged; `cleanZoom` (one of `radius` and `size`; sizes
  in [0.015, 2]); `carryZoom` (the centre with the paper, the angle with any
  turn, mirrored with the side); shape conversion; per-shape defaults;
  `frameWindow`, a frame's upright box.
- `zoomImprint.ts`: `paperFacesOf(step, assets)` (the stored `paperFaces`
  read, a crease pattern's one face from its render, or null);
  `drawnRing(faces, scene, face)`; `ontoSpread` and `offSpread` (Terms);
  `facePlacement` (the least-squares similarity to the face's unspread ring,
  reflected when the face's affine fit is); `defaultAnchor(faces, frame)`
  (drawn rings, ties on paper area); `anchorPoint(face)`;
  `faceAt(faces, point)`; `imprint(frame, placement)`;
  `land(imprint, placement)`; `landFrame`, steps 4–6 of a capture.
- `zoomCapture.ts`: `captureSource(doc, stepId)` (the nearest earlier step
  with an area or a frame, turns passed, a locked newer-build step passed
  over); `capture(doc, stepId, assets)`, the `DiagramStepZoom` a step would
  get; `stepsFrom(doc, areaId)`, the steps Update captures again; the seed for
  a new step.
- `zoomIndex.ts`, derived per document (WeakMap memo), never stored: per area
  id, the steps with that provenance; per enlarged step, the area an arrow
  before it leaves, or null.
- `stepView.ts`, what every surface paints and annotates:
  `stepView(doc, stepId): {step, window: PictureBox | null, zoom: StepZoomView | null}`;
  `viewFrame(view, assets)`, the window or `stepPictureFrame`;
  `viewGeometry(view, assets, style)`, `pictureGeometry` mapped into window
  units and kept to the frame grown by the snap radius.
- `zoomFrames.ts`: the carries in "Keeping frames and marks consistent".

**Reading and writing** (`diagram/document/diagramFile.ts`):

- **`STEP_KEYS` and `SCENE_PICTURE_KEYS`, landed first, as a commit of their
  own.** Today `readStep` (l.422) builds a step from named fields and
  **silently drops any other key**, and `writeStep` (l.267) writes a fixed
  set; `readPicture`'s scene case (l.790-795) likewise builds the picture
  from its four fields and drops any other. So a new step or picture field is
  lost by any build that predates it. The commit's `STEP_KEYS` holds the
  eight keys `writeStep` writes today: {id, revision, source, picture,
  annotations, annotatedPictureKey, text, breakBefore}; its
  `SCENE_PICTURE_KEYS` holds {kind, sceneJson, paperScale, styleKey, key}.
  Any other key makes the step a newer build's: locked and carried verbatim,
  as an unknown source kind already makes it. `zoom` and `paperFaces` join
  the sets only in the commits that read them, so a build from between locks
  such a step rather than accepting the key and dropping it. From then on a
  build without enlargement opens an enlarged step locked, shown as made by a
  newer Ori Studio, and keeps the area mark verbatim.
- **`readStepZoom`.** Keys `from`, `shape`, `frame`, `imprint`, `scale`,
  `edge`; any other makes the step NEWER (locked), as does a `shape` or `edge`
  string this build does not know. `from` a non-empty string; an outline's
  `centre` two finite numbers within ±`ANNOTATION_REACH` frames, exactly one
  of `radius` and `size` (positive, finite), `angle` finite; `on` two finite
  numbers; `scale` as the area's. Anything else is damage: the zoom is dropped
  and `annotatedPictureKey` is set to null, so D8's out-of-step notice shows
  (the step's marks were in window units). `writeStep` adds `zoom` when set,
  each optional field only when set.
- **An enlarged step's marks reach as far as its whole picture's**
  (`zoomModel.windowReach`; review of 16e, 2026-10-06; confirmed by Zach,
  2026-10-07). They are in the window's units, so reach's four frames would
  be four *windows*: a mark across the model from a small frame (the crane's
  long valley line beside a head area of radius 0.05 lies some eight windows
  out) could not be carried into the window and back, and S1.6 carried no
  mark at all. So on a step with a frame, a mark's point is this build's
  within the bounding box of reach's four windows about the window and the
  whole picture's ±`ANNOTATION_REACH` frames taken into the window's units;
  the reader reads the frame first and checks the marks against that box,
  edits clean within it, and carries between units clamp to the box of the
  units they go to. A change of units is then a pure scale and shift, exact
  there and back; a mark past even that box (a newer build's) still keeps
  every mark where it was, out of step.
- **`readPaperFaces`.** A string that parses to an object with `points`,
  `rings` and `levels`: each point four finite numbers; one ring and one
  whole level ≥ 0 per face, each ring empty (a face the kernel could not
  name) or ≥ 3 indices into `points`. Another key on the object makes the
  step NEWER. Anything else is damage: counts that disagree, an index out of
  range, a face the stored scene names that `rings` does not have, or, on a
  step whose render has a spread, a face whose whole ring in the scene is
  missing or of another length, since its drawn places would be wrong. Damage
  drops the field, so the step anchors nothing until refreshed. Capped, with
  the scene, by `SCENE_JSON_MAX_BYTES`; a capture over the cap is kept without
  it, with the older-capture notice.
- **The `zoom` annotation.**
  `ANNOTATION_FIELDS.zoom = fields('radius', 'size', 'angle', 'scale', 'edge', 'anchor')`
  (l.868). The `readAnnotation` case follows `readTicks`/`readKinks`
  (l.1091/1143): exactly one of `radius` and `size` (both or neither is
  damage, and the mark is dropped); `radius` through the close-up's reader
  (`readCloseUpRadius`, l.1130); `size` two finite numbers > 0, valid from
  0.015 to 2 and NEWER outside that, as a radius is, damage otherwise;
  `angle` finite, damage otherwise (the field dropped); `scale` unsaid means
  Fill, valid 1.25–6, a positive number outside that NEWER, as
  `readCloseUpScale` reads a close-up's, damage otherwise (the field dropped);
  `edge` `'cut'` or `'whole'`, another string NEWER, anything else damage;
  `anchor` two finite numbers, damage otherwise (the field dropped). NEWER
  keeps the mark verbatim as an `UnknownDiagramAnnotation`, not drawn, flagged
  in Layers as made by a newer Ori Studio. `writeAnnotation` (l.287)
  destructures `size`, `angle`, `edge` and `anchor`, as its
  `Record<string, never>` check forces; each is written only when set.
- **Nothing else changes.** No page-setup key, so `DiagramPageSetup`,
  `PAGE_KEYS` (`diagramFile.ts:184`) and the read-only lock are untouched. No
  entry kind, so `isTurn` (`'kind' in entry`, `diagramDocument.ts:813`) is
  untouched.

#### Keeping frames and marks consistent

Marks on an enlarged step are in its window's units, and the window is the
frame's upright box. The rules are pure functions in
`diagram/zoom/zoomFrames.ts`, called from the store verbs:

| What changed | Frame | Marks |
| --- | --- | --- |
| Enlarged turned on; a seeded step's first picture; Update Enlarged Steps | Captured from the source and landed; Update overwrites a hand move; every step of a run made in one edit from the run's source (after 16g, 11) | Carried from the whole picture, or the old window, into the new window; from the whole picture, a line crossing the frame trimmed just past it (after 16g, 8) |
| Enlarged turned off | Dropped | Carried from the window to the whole picture |
| The frame moved or resized by hand, or its Shape changed | As set, but for a centre dropped in a strip the spread opened, which settles on the layer above (Capturing a frame); its centre taken off the spread and the imprint made again on the same face | Carried by the window's move (a scale and a shift), so they stay on the same paper |
| The frame's anchor picked or reset | Unchanged; the imprint made again on the new face | Unchanged |
| This step re-posed (the `withCarriedAnnotations` call sites: `diagramDocument.ts:1176/1311/1339/1394`, `useDiagramLinkedPose.ts:209`) | Its imprint landed on the re-posed picture; with no faces, carried by the pose's move | The pose's own move, composed through old window → picture → new window |
| This step refreshed or relinked | Its imprint landed on the new picture; kept in picture units when it has no faces or the paper point is off the paper | Unchanged in window units, so they go with the frame; D8 out of step as for any refresh |
| This folded step shown as its crease pattern, and folded again (Z8 amended) | On the sheet, on the paper its window showed, imprinted there; folded again, landed where it was and anchored again by Z9's rule. A picked anchor lands by its pick | Unchanged in window units; D8 out of step |
| The source area edited, re-posed, refreshed or deleted; its step deleted; steps moved | Unchanged | Unchanged |

"Landed" is steps 4–6 of a capture: on the unspread picture, then onto the
spread. A test helper asserts after every store verb in the slice tests: each
enlarged step whose picture has faces has a frame equal to its imprint landed
on that picture, to the stored step (or carries the off-paper notice), and no
mark moved on the paper unless the verb moved it. Copy and paste remember
their source view (picture key and window): pasted onto a step with the same
picture key, marks map by the window's move; otherwise they land at the same
place on the picture, window → picture → window, but between windows of two
pictures not proven the same, which keep their window coordinates (Decided
with Zach, after 16g, 7; `annotationClipboard.intoView`).

#### Rendering on every surface

**One windowed painter**, `diagram/zoom/paintZoomed.ts`, on the close-up's
recipe (`paintAnnotations.ts:115`):

1. `<defs><clipPath id="{prefix}-zoom">` holding a circle, or a rect with `rx`
   = 0.22 × the shorter side, turned by the frame's angle.
2. A clipped group holding the step's **own** picture, painted again at
   `s = target / window` (`paintSource(source, style, padding, s)`,
   `paintDiagramStep.ts:229`), so pens keep their print weight. References
   cards are rebuilt at size; uploads and fixed pictures are enlarged whole.
   The group is translated so the window lands on the target frame.
3. The boundary.
4. The step's marks, compiled on the window frame, **not clipped**.

Ids are prefixed per cell or card (`prefixIds`), and text is counted for font
embedding. **Culling**: scene items whose bounds miss the window grown by the
overshoot are dropped before painting; otherwise every enlarged step would
embed the whole model in the PDF and repaint it on every card.

**The boundary** (`diagram/zoom/zoomEdge.ts`) is part of the picture, not a
mark. Whole draws the full outline. Cut:

1. Sample the outline: a circle at `RING_SIDES` (96) or finer; a rectangle's
   sides exactly, with 32 points per corner, turned by its angle.
2. Run `behindFlaps.piecesUnder` (l.173, exported for this) over the step's
   paper silhouette: a flat fold's `layers.covers`; a crease pattern's sheet
   ring; a References card's sheet plus the flap polygons it draws; a 3D or
   simulated picture's stored face rings, read although `sceneGeometry` skips
   them (approximate).
3. Keep the stretches over paper and grow each by the overshoot, converted at
   the printed size.
4. Merge gaps under 2 mm. Pieces covering ≥ 97% draw the closed outline; no
   piece draws nothing.

Circle pieces are drawn with `ringPieces` (`stepDiagramGeometry.ts:1853`),
rectangle pieces as polylines, with round caps, in the edges pen and paper
ink. Uploads, fixed SVGs and rasters have no silhouette and draw Whole.

**An area** compiles to a new `CompiledAnnotation` variant, `zoom`, beside
`close-up` (`annotationPrimitives.tsx:196-200`; its `compileAnnotation` case at
l.273), drawn by a `zoomAreaElement` beside `closeUpElement` (l.696): the full
outline, turned by its angle, in the ring pen and the arrows' ink, plus a
white casing on a rounded rectangle (Z5), 0.45 ink (≈ 0.15 mm, a hairline
knock-out) wider than the pen on each side; 1.5 ink (≈ 0.5 mm) until Zach's
review of 16d. It lies in the close-ups' layer, over the shapes and under
callouts and labels. Its reach is the outline plus half the pen and the
casing. Pose ghosts it as the other marks. It is not a References primitive,
so the primitive switches are untouched.

**Per surface:**

- **Cards** (`DiagramStepCard` → `annotatedStepUrl`,
  `useStepPictureUrl.ts:65`): an enlarged step paints the windowed view, the
  window filling `CARD_FRAME_PX` (50 mm), its marks at `CARD_FRAME_PX` on the
  window frame. The cache key adds the frame, shape, edge and corner. A card
  with areas shows them.
- **Annotate canvas, enlarged step**: `layoutFor`'s frame
  (`useAnnotateCanvas.ts`) is the window at `ANNOTATE_FRAME_PX` (1000). A new
  `DiagramZoomView` (own CSS module) draws
  `closeUpPictureUrl(source, style, s)` (l.151, cached by scale), clipped as
  `DiagramCloseUpInsides` is, plus the boundary; nothing outside the frame
  unless the frame is selected, when the surround is drawn dimmed. Snapping
  and behind-flap layers come from `viewGeometry`. `INK_UNITS` and the
  frame-relative constants (`LABEL_SIZE` 0.05 of the frame,
  `MIN_ANNOTATION_LENGTH`, `PASTE_OFFSET`, the click defaults) stay right with
  no edits, because the window is the frame. That is why marks live in window
  units: in whole-picture units a label would print k× larger, and about 15
  `INK_UNITS` sites would need a view scale no type checks.
- **Annotate canvas, a step with areas**: an area is a mark with grips: a
  circle's centre dot and rim, as `closeUpGripAt` (`annotationHit.ts:586`); a
  rectangle's corners, edges and centre, through new `AnnotationGripPart`
  values. It hits on its outline only, last in the hit order (l.696). The
  same grips serve an enlarged step's frame.
- **Pick mode**: the faces' drawn rings (Terms), the top one under the
  pointer filled in the selection ink at low opacity.
- **Pose**: see Controls.
- **Pages**: `cellPicture` (`pagePictures.ts:332`) draws through the windowed
  painter at the pinned size, and `settle()` (l.438) centres the content plus
  marks. `CellPicture` (l.80) gains `framePt` (computed today and dropped at
  l.396) and the window's placed box. The composer's order: band → title →
  cells → turn glyphs and enlarge arrows → page number
  (`composeDiagramPage.ts:131-137`).
- **PDF**: the same page SVG, no Rust change.
- **Step files** (`stepFiles.ts:98-132`): the windowed painter at the size the
  scale rule gives; no arrow.
- **Export Picture** (`exportStepPicture.ts`) on an enlarged step: the window
  with its boundary and no marks, which is what the step shows.
- **A close-up on an enlarged step**: its `CloseUpPicture` callback paints the
  windowed view at the close-up's scale.

#### Page layout and scale

```ts
LayoutStep.picture.kind: 'paper' | 'fit' | 'zoom'  // 'zoom': frame = the content box (Cut: paper inside the frame ∪ the
                                                  //   cut pieces) or the window (Whole), in window units; reach as today
LayoutStep.zoom?: { arrowFrom: { stepId: string; areaId: string } | null;  // computed, never stored
                    frameShare: number;  // the frame's longer side, in this step's whole-picture units
                    scale: number | null; run: number }
LayoutCell.zoom?: { asked: number | null; printed: number; reduced: boolean }   // the Layers and Step pane read-out
LayoutPage.zoomArrows: { at; box; beforeStepId; areaStepId; areaId; rightToLeft: boolean; liftable: boolean }[]
```

- **The arrow, computed.** An arrow prints before an enlarged step when the
  step before it, turns passed, holds an area. It leaves the area whose id is
  the enlarged step's provenance, else that step's first area in its
  annotations' order. Nothing about it is stored, and it reads the order as it
  is: after a move it prints wherever the rule now holds.
- **Runs**, for layout only: an enlarged step and the enlarged steps directly
  after it, turns passed, up to a step that is not enlarged or that has an
  arrow before it. Every step of a run is measured against the run's area,
  whatever Size it asks for, so ×2 means the same all along it, on a step
  captured from an earlier enlarged step too (Zach, 2026-10-07). Under Fill
  a run's Fill steps print at one size.
- **Scale**, a post-pass after the runs loop (`diagramPageLayout.ts:924-940`,
  `scaleRuns` over the `paper` pictures by mm per unit, then over the `fit`
  pictures by frame). 'zoom' pictures are of neither kind, so no run takes
  them; otherwise `scaleRuns` would absorb a lone enlargement under about
  7.4× into its neighbours' run. The post-pass first computes each run's
  `areaMm`: with an arrow before its first step, the area's longer side × the
  area cell's printed frame (× the cell's `mmPerUnit` for a paper picture,
  its `frameMm` for a fit one); without
  one, the first step's `frameShare` at the scale its whole picture would
  print at among its neighbours. The area's step may be on an earlier page;
  every scale is known before cells are built.
  - **Fill** (Z4): `windowMm` = the minimum over the run of each step's
    `shared` fit (`ScaleFit`, l.304), clamped to [1, 6] × `areaMm`. Each step
    prints at min(`windowMm`, its own fit) and is flagged `reduced` when that
    bites, so one long caption reduces only its own step.
  - **Fixed Size**: `windowMm` = Size × the run's `areaMm`, capped the same
    way. A Size starts no run of its own (Zach, 2026-10-07; as 16f was
    built it did, and the Fill steps after it measured by their own frames).
  - The read-out is `printed / areaMm`; it turns amber under `FIT_ZOOM` (1.3):
    "Prints only ×1.1 — draw a smaller area".
  - `layoutDiagram`'s measure-at-scale passes re-measure reach at the pinned
    size, the overshoot in mm included.
- **Gutter**: `turning` becomes
  `turning || steps.some(s => s.zoom?.arrowFrom)`; `outerShortfall` is
  shared.
- **Arrow places** (Z3): `placeTurns` (l.954) is generalised over
  `BetweenGlyph = {kind: 'turn'} | {kind: 'enlarge'}`, its output split into
  `LayoutPage.turns` (type unchanged) and `LayoutPage.zoomArrows`;
  `DiagramTurnKind` is not widened. The arrow takes D22's places for a turn,
  as built: on a shared row, midway between the facing edges at the mean
  centre height; across a flow row break, in the lane between the rows where
  the flow turns (Zach's change of 2026-10-06, being built now), and across a
  grid row break, D22's place there; across a page break, half a gutter
  before the next picture's leading edge (its right edge on a right-to-left
  flow row); x clamped to [7, W−7] mm. Taking `placeTurns`'s output keeps the
  arrow and the turn glyph agreeing as D22 changes. With turns in the same
  gutter, the arrow stacks after them, 1.5 mm clear.
- **Lift** (composer; Z3): alone in a shared-row gutter (`liftable`), the
  arrow's y becomes the area's printed centre (from the area cell's `framePt`
  and the area's centre). Its **box** is clamped into both drawn pictures'
  vertical overlap, which starts below the next cell's number band (the number
  at the cell's y + 7 mm; pictures from y + 8). No lift beside a turn, or
  across a break.
- **Unchanged**: `splitIntoPages` (l.739); the number at the cell's top-left;
  the caption 5 mm under the drawn picture. The containment test
  (`composeDiagramPage.test.ts:255`) is extended to enlarged cells; arrows are
  page-level and belong to no cell.

#### The enlarge arrow

A synthetic `white-arrow` painted through `paintAnnotations` on its own frame,
exactly as `paintTurnGlyph` paints a turn (`turnGlyph.ts:39`):

- width regular: neck 10.8, head 12 × 24 ink, a 3.57 mm neck and a 3.97 mm
  long × 7.94 mm wide head (`diagramInk.ts:215`);
- tail `pointed`: the `1 − (1 − u)^1.2` taper of template path4649
  (`WHITE_ARROW_TAPER`, `stepDiagramGeometry.ts:1996`);
- white fill, outlined in the arrows pen;
- two path nodes on an 11 mm chord with a 0.18 sagitta, bowing up; the chord
  is above the 9.3 mm under which `whiteArrowOutline` shrinks the arrow (head
  plus `WHITE_ARROW_LEAST_SHAFT` 1.5 necks, 28.2 ink).

Its box, about 12 × 9.5 mm, is measured once from the painted outline, not
typed as a constant (the 11.6 × 7 and 12 × 6 mm boxes two proposals typed
cannot hold the 7.94 mm head). Mirrored on right-to-left rows
(`turnFollowsReading`), the bow kept up. Across a flow row break it is aimed
instead (Zach, 2026-10-07): turned from its place toward the middle of the
enlarged step's picture, flipped about its chord where that keeps its bow on
the outside of the lane's bend (`LayoutArrowAim`), its box measured turned.
It shows only on pages and in the PDF: cards never draw across cards, so they
show the chip.

#### Edge cases

- An area no step is enlarged from prints as a plain outline. An arrow still
  prints from it when the step after it is enlarged, since the arrow reads the
  order, not provenance.
- A turn-over between the area and the enlarged step: the anchor face is
  turned over too, so the frame lands mirrored on it, exactly; no notice.
- An area taking in the whole model: Cut finds no crossing and draws no
  boundary, Fill comes out near 1×, the read-out is amber, and the default
  anchor falls back to the backmost face.
- A frame holding no paper on its step (the anchor face moved against what
  was framed): the "holds no paper" notice; it still prints. The fixes are a
  picked anchor on the source and Update, or a hand move.
- The anchor's paper point not on the step's paper (another paper, a sheet cut
  down): the frame is copied in picture units, with its notice.
- Spread layers: the frame lands unspread and follows the spread by its
  centre, so it keeps its unspread size and turn, unskewed. Under the default
  affine spread the paper inside it is skewed by up to 4% (axes 1.038 and
  0.976 of the scale, 16.0), so its rim and the ellipse that paper would make
  differ by up to 1.9% of its diameter. It follows the layer on top under its
  centre. When a fold has laid another layer over the paper the area was
  drawn round, the frame follows the new top layer, which the spread moves a
  little apart from the covered one: up to 1.36% of its diameter on 16.0's
  refolds (A and B under the depth spread).
- Rotation by any angle (447568348): exact; the frame turns with its face.
- Raster pictures (an over-budget capture kept as an 80 mm, 300 dpi bitmap, or
  a raster upload): the soft-print notice below 200 dpi effective.
- 3D and simulated pictures: frames in picture units; the Cut silhouette comes
  from the painter's-tree faces and is approximate. Live orbit views show the
  outline only.
- What lies outside the window counts neither for the step's size nor for
  Annotate's fit (Zach, 2026-10-07). A mark partly outside it is drawn
  unclipped and measured only inside it, so it overflows its room; one wholly
  outside it is kept, badged and measured nowhere, and drawn only within a
  window of it (`marksTouchingWindow`, `marksInWindow`).
- A picture with no paper outline: the Edge row is disabled with its hint.
- An empty enlarged step (seeded, before Link) shows the placeholder with its
  chip; its first picture lands the imprint captured at creation, or the frame
  copied in picture units.
- A locked (newer-build) step is passed over when a capture looks for its
  source, and is never captured onto.
- A read-only diagram disables every enlarge control, Pick included; areas and
  frames still draw.
- Undo and redo restore marks, frames and imprints together, one entry per
  verb.
- On a phone the fields go in the Step drawer and grips are at least
  `--touch-target`. A phone's Pose toolbar wraps at 375 px (three rows
  before 16e), so the toggle follows Spread Layers into the Step drawer: an
  Enlarged switch in the Step pane's Pose section, off the phone's toolbar.
  The pick mode is a tap.
- Analytics opted out: every event is a no-op, and behaviour is unchanged.

#### Analytics

Event names lowercase and space-separated; values enums and buckets only,
never geometry. Rows go in `docs/analytics.md`.

- `diagram annotation added`: `tool` gains `enlarge` and `enlarge_frame`, with
  `snap` `none`. Extend `DiagramAnnotationTool` (`analytics/events.ts:75`) and
  `ANNOTATION_TOOL`.
- New `diagram step enlarged`, one per step a capture places a frame on:
  `via` (`toggle`/`seeded`/`update`); `placed` (`face`/`sheet`/`picture`:
  through an anchor face, through a crease pattern's sheet, or copied in
  picture units); `anchor` (`auto`/`picked`/`none`, `none` when copied in
  picture units); `shape` (`circle`/`rounded`); `picture`
  (`DiagramPictureKind`:
  `svg`/`raster`/`references`/`crease_pattern`/`flat`/`3d`/`simulated`). An
  Update that places five steps counts five; a seeded step counts when its
  first picture lands the frame.
- New `diagram enlargement changed`, once per drop or commit: `on`
  (`area`/`frame`); `setting` (`moved`/`shape`/`size`/`edge`/`anchor`/`deleted`);
  `value` (`circle`/`rounded`/`fill`/`fixed`/`cut`/`whole`/`auto`/`picked`/`none`);
  for a fixed size, `size_bucket` (`<=1.5`/`<=2`/`<=3`/`<=6`).
- `diagram picture posed`: `action` gains `enlarge_off`, beside
  `spread_on`/`spread_off` (`DiagramPoseAction`, `events.ts:143`). Turning
  Enlarged on is counted once, by `diagram step enlarged` (`via: toggle`).
- `diagram exported` gains `enlarged_step_bucket`
  (`<=0`/`<=1`/`<=5`/`<=20`/`>20`, the ladder `empty_step_bucket` uses).
- A step added by Insert Step After that starts enlarged counts `diagram step
  added` as today. Duplicating a step, enlarged or not, counts neither
  (`docs/analytics.md:342`: "Duplicating a step is not counted").
- None of these verbs is a `MENU_ACTION_ID`, so the `handleMenuAction`
  chokepoint does not count them; the events above are the only count, and
  none is placed twice.

#### i18n

About 45 strings, all through `t()`, in all nine catalogs (en, de, es, fr, ja,
ko, pt-BR, ru, zh-CN); `i18n:extract` → translate → `i18n:stamp` →
`i18n:check`. One step reads "Step 56", not "Steps 56–56", so each string that
names the steps an area enlarged ("Enlarged on steps 56–60", Update's tooltip)
is two keys, one step and a range, not a plural.

| Namespace | Strings |
| --- | --- |
| `tools:diagram` | `toolEnlarge`, `toolEnlargeFrame` |
| `panels:diagram.annotate` | `enlargeHelp`, `enlargeFrameHelp`, the modifier lines, the disabled reasons, the pick mode's hint |
| `panels:diagram.annotations` | Row and field labels (Enlarge area, Enlarged frame, the two subtitles each way, Shape, Circle, Rounded rectangle, Size, Fill, Edge, Cut, Whole, Anchor, Auto and its tooltip, Picked, Pick, Reset); the read-outs, normal and reduced; the verbs (Update Enlarged Steps and its tooltip, Go to Step {{n}}, Go to Area on Step {{n}}); the frame's note; badges and hints (Outside the enlarged frame, the Cut-unavailable hint) |
| `panels:diagram.pose` | `enlarged`, its tooltip with and without "remove this step's own enlarge area", its disabled reason |
| Step pane | The read-out row and four notices |
| Card | The chip, with and without a step number |
| `dialogs:diagramExport` | `turnsLeftOut` reworded, the page-split notice |
| Shortcut labels | Two |

#### Amendments to `diagram-workspace.md`

- **D2**, unchanged in spirit: an enlarged step owns its picture; its frame
  is a view of it.
- **D8**: an enlarged step's canvas frame is its window, and its marks are in
  window units. Its frame follows its own picture through a re-pose, a
  Refresh or a relink by its imprint, and its marks go with it; nothing
  follows another step's changes.
- **D10**: enlarged steps stay out of Fit each's runs (a stated exception).
- **D22**: enlarge arrows are between-step glyphs that reserve the gutter and
  take a turn's places.
- **Later**: remove "A per-step zoom ("enlarge from here")"; add Phase 16,
  pointing here.

#### Risks

- **The anchor face can move.** The default is chosen to stay still, but a
  fold that moves the back layer against the framed part (a reverse fold of
  the body, a sink) takes the frame with it. Mitigations: Pick, and a hand
  move. The spike (16.0) measures the crane.
- **A spread moves the anchor and the framed part apart.** Landed in one
  stage, a frame drifted up to 5.46% of its diameter when the two steps held
  different faces still. Two-stage landing (Zach's decision after 16.0)
  brings every measured case within 1.36%; a hand move (Z10) corrects the
  rest.
- **Later stages on other sheets** share paper coordinates only if Edit's
  copy of the sheet keeps its orientation; a sheet turned in Edit lands the
  frame turned. The spike checks the crane's sheets.
- **`paperFaces` size.** On every flat capture (Z11). Measured on the crane
  in the form chosen (each point's paper and unspread places, the drawn ones
  read from the scene, as a string): 0.84% of the file. The whole-file budget
  (Model and file format) holds it, and breaking it goes back to Zach.
- **Older captures have no faces** until they are needed, and then get them
  from their pattern only while the link is current and the fold draws the
  stored picture. On Zach's four diagrams that is 28 of 30 flat steps; the
  heart's step 14 (stale) and Reference Diagrams' step 6 (current, but drawn
  differently by this build) need a Refresh first, and until then their
  frames are copied in picture units, with a notice.
- **Frame maintenance** must run on every picture-edit path. Mitigations: one
  funnel around `withCarriedAnnotations`, explicit verbs, and the invariant
  helper after every slice verb in the tests.
- **The view resolver** must reach every painter (card, canvas, Pose, layout,
  cell, step files, export). Mitigations: one `stepView` entry point and a
  cross-surface test of one enlarged fixture.
- **The key-set lock** may lock dev files whose steps or pictures carry stray
  keys: check crane.osf and the fixtures before landing it.
- **The 14 mm gutter** shrinks every room by about 14% once a diagram gains
  its first enlarge arrow. That is D22's precedent; the prototype's print
  panel shows it.
- **Repaint cost** on cards, the canvas and pages for long series of enlarged
  steps. Mitigations: culling, and caching by (picture, frame, scale).
- **Cut** on 3D or simulated pictures and on woven flaps is approximate;
  raster pictures print soft when enlarged.
- **Panel growth**: rows belong in the new components and hooks, so the
  `max-lines` cap keeps its meaning.

#### Decisions: enlarged steps (all DECIDED, 2026-10-06)

Zach answered in conversation on 2026-10-06. Z1–Z6 follow the prototype's
numbering (`artifacts/revision-2/enlarged-steps.html`, which predates these
answers and still shows the walk-back and the plane); Z7–Z10 were settled in
the same conversation and have no prototype panel, and Z11 at 16c's gate.
**No enlarged-steps decision is pending.**

**Z1. How an area is made, and whether drawing it makes a step. DECIDED: the
Enlarge tools on the step before, and drawing changes nothing else.** Zach:
"I'd rather opt in with a toggle but not change any other steps by default."
Enlarge (E) and Enlarge in Frame (Shift+E), on the rail's Marks group after
Close-Up, lay an area on the step, edited there with grips and in Layers; no
step is inserted or adopted. Not taken: the 2026-10-05 recommendation, in
which releasing also inserted the next step; a frame placed in a Pose Frame
mode on the enlarged step; Close-Up › Show: Next step.

**Z2. How a step becomes enlarged, and stays so. DECIDED: an Enlarged toggle
on Pose's toolbar, capturing a frame at that moment.** Turning it on copies
the area from the nearest earlier step that has one, an area drawn on it or,
if that step is enlarged, its captured frame, and stores it on the step. After
that the step owns it: reordering never changes it (Zach's example: drag step
19 to after step 11, and it still uses the area captured from step 18);
editing the area on 18 later does not touch it; toggling off and on captures
again from whatever is before it now. New steps added after an enlarged step
start enlarged, captured at creation (Zach: "yeah sounds right"). Not taken:
Enlarge and Whole cards in the Steps grid; the 2026-10-05 recommendation, in
which each window was derived from the area and followed its edits.
**Amended 2026-10-08 (`diagram-review-fixes.md`, item 3; Zach: "that sounds
good").** A run continues only with its picture type. An empty step made after
an enlarged one (Add Step, Insert Step After) still starts enlarged. Its first
picture keeps the frame only if it is linked the way the run's source shows
its pattern: Crease Pattern, Folded or Simulated. Linked another way, the step
starts whole in the link's undo step. Uploads and References cards never
continue a run. Made after an enlarged step, or filling an empty step seeded
enlarged, they start whole. This also amends 16g ("every way a step is made")
and 16h (a run of uploads). The pattern picker now offers a step with no link
the previous linked step's way (D19 amended). Switching Show as on a step that
is already enlarged keeps it enlarged. As reviewed: the rule binds a step's
first link only where it continues a run, whose source is an enlarged step
with a picture. A step that starts a run (enlarged from an area, directly or
past empty steps) keeps its frame however it is linked, and so does a linked
step given its first picture by a Refresh or Pose. An empty step made after an
enlarged upload or References step is not seeded, since no first picture
could keep that frame.

**Z3. Where the arrow prints. DECIDED: A, in the gutter, lifted to the area's
height.** "all those defaults look good" (Zach, 2026-10-06). D22's place for a
turn: mid-gutter on a shared row, raised to the area's printed height when
alone there and kept clear of the next number; mirrored on right-to-left
rows; across a flow row break, in the lane between the rows, by Zach's change
to D22 of the same day; across a page break, at the next picture's leading
edge. The arrow is computed at layout, never stored, and leaves the area the
enlarged step was captured from when its step has several, else the first.
Not taken: out of the ring when there is room; mid-gutter with no lift.

**Z4. How big an enlarged step prints. DECIDED: A, Fill, with a typed Size to
fix it.** "all those defaults look good". As large as the run's room allows,
at most 6× the area; a Size in Layers prints at that many times the area's
printed size; the read-out says what prints. Not taken: a literal ×2.

**Z5. The casing on the area's outline. DECIDED: A, by shape.** "all those
defaults look good". A rounded rectangle is cased in white, a circle is not,
as in the two examples. Not taken: both cased; neither.
**Revised 2026-10-06, on seeing 16d built: the casing is a hairline.** Zach,
of the rounded rectangle's white outline: "this white outline on look two is
way too wide. It should just be like a tiny line." `ZOOM_CASING_INKS` goes
from 1.5 to 0.45 ink past the pen each side (0.5 mm to 0.15 mm, 0.42 pt).
Measured on look 2 at print size: its knock-out is about 1.7 px beside a
1.05 px crease and a 1.65 px outline, about 1.65 times its thinnest crease,
which at the Diagram preset's 0.25 pt aux pen is 0.41 pt (0.44 ink).

**Z6. Drawing an area when a next step exists. SUPERSEDED by Z1.** Drawing
never inserts or adopts a step. The next step is made with Duplicate Step or
Insert Step After, or is already there, and its Enlarged is turned on.

**Z7. Keeping enlarged steps up to date with their area. DECIDED: provenance,
and Update Enlarged Steps.** Each enlarged step keeps the id of the area it
was captured from: provenance only, never a live link, never read to derive
anything. The area's Layers row offers Update Enlarged Steps, which captures
again every step with that provenance, as one undo step. Deleting the area or
its step leaves the enlarged steps as they are, with nothing to update from.

**Amended 2026-10-08 (`diagram-review-fixes.md`, item 4; Zach: "sounds
good").** Each capture also records the area as it was then (`areaWas`: its
step, outline and picked anchor), still never read to draw. Once the area is
moved, resized, reshaped or re-anchored by hand, every step captured from it
says "Out of date: Step N's area changed", with Update on that step (its
Step pane and its card's menu); a carry of the area by its own step's picture
moves the records with it and says nothing. Update Enlarged Steps became
Update All, on the area's Layers row and its step's Enlarged section in
Annotate: it places only the steps out of date (and a file's steps from
before records), so a frame moved by hand on a current step stays. A deleted
area's steps keep their frames and say "Step N's area was deleted".
After rf4's review (for Zach to confirm): the record also holds the Size and
Edge the capture copied, so the area's Size or Edge changed says so to a step
that took it, and Update keeps a Size or Edge set on the step; a file's step
from before records is recorded at the first hand edit of its area, and is
out of date from then, not placed by Update All before; Update and Update
All are offered only while a step is out of date — Update All also in the
area step's read-only Step pane and its card's menu.

**Z8. Which part of the model the frame follows. DECIDED: an imprint on a face
of the paper.** Zach: "imagine imprinting the frame onto the face and seeing
where it lands on the paper. Then using that every time to draw the frame on
subsequent steps." The face is found on each step by a point on the paper,
because faces differ between steps; the frame turns and mirrors with it, with
no rule keeping it upright. Crease-pattern steps map through the sheet, Front
and Back mirrored; 3D, simulated, References and uploaded steps keep the
frame in picture units. Under a spread it lands in two stages, unspread and
then onto the spread by its centre: Zach's answer to 16.0's failure, recorded
there ("For Zach", 2026-10-06).
**Amended 2026-10-07, onto a flat crease pattern** (Zach: "use your recs and
include the enlarged steps follow ups in the branch"; Decided with Zach,
after 16g, 12). Show as Crease Pattern, or Duplicate As › Crease Pattern, on
an enlarged folded step lands its frame on the top face at the frame's
centre, the paper its window showed, imprinted afresh there and kept, so the
frame stays on that paper as the sheet turns. The anchor face (Z9) is for a
re-posed picture, whose faces move apart; it lies under the paper the window
showed, so on the unfolded sheet it put the frame 288 sheet units from the
crane's head. Shown folded again, the frame lands where it was and is
anchored again by Z9's rule, so every re-pose of a folded picture follows
the anchor face as before. A picked anchor still lands by its pick.

**Z9. The anchor face. DECIDED: selectable, by default the backmost face
outside the frame.** Zach: "it should be selectable, lets try defaulting to
the back most face that is outside the bounds of the region. Since thats the
face least likely to move." The fallbacks: the backmost face reaching outside
the frame, then the backmost face. An Anchor row on an area and on a frame
picks a face on the canvas, and Reset returns to the default. Not taken: the
largest face; the face under the area's centre (Alternatives considered).

**Z10. When the automatic placement misses. DECIDED: the frame is a layer,
moved and resized by hand.** It is listed in the Layers pane and selectable on
the canvas. Update Enlarged Steps and the toggle place it again, over a hand
move, and the UI says so. The step's marks go with the frame.

**Z11. What a flat step's faces may cost. DECIDED: every flat step saves
them, under a whole-file budget.** Zach: "I'd rather always save the faces
because later down the line I also want to do stuff like you know, being
able to hide specific faces and show the faces underneath. Like, you know,
things that would require us to have all the faces for a step." Option (a)
of 16c's budget item: the per-step cap (a step's faces at most 0.3 of its
scene) is dropped and the whole-file one (the `.osf` grows by at most 1%)
kept; a step captured before faces were kept gets them when they are needed,
from its pattern while its link is current, else by Refresh (S5).

#### Alternatives considered

- **view-of-step-before** (a zoom mark on N; N+1 shows N's own picture through
  it, with no picture of its own). Kept: the tools, window-unit marks,
  per-shape defaults, the page-split notice, the arrow's hit target; its
  inserting on release was kept until Z1 dropped it. Rejected: a step without
  a picture breaks D2 and has about 155 direct `.picture` reads to reconcile;
  drawing through a link by annotation id breaks on cut and paste; posing 56
  would re-pose 55.
- **step-owns-its-framing** (the frame on the zoomed step, ring and arrow
  derived; the highest score, and the base here). Kept: steps own their
  pictures, Pose's dimmed window, culling, the key sets, the invariants, and,
  with Z2, a frame stored on every enlarged step. Its want of an edit across
  steps is answered by Update Enlarged Steps. Not kept: the region edited in a
  Pose sub-mode; the sheet-centred plane.
- **page-first** (Enlarge and Whole entries in the step order, holding the
  area in fold space): Z2's option B. Kept: Fill from shared fits, the content
  box for Cut, the overshoot rule, Pose's dimmed window. Not the base: it
  needs an audit of every `isTurn` consumer and a second, non-annotation
  selection model on the canvas; its stored copies of the space go stale; the
  ring jumps to another picture when steps are moved or deleted.
- **smallest-surface** (a close-up with Show: Next step): Z1's option C. Kept:
  the per-step Pose toggle with seeding, the arrow through the turn pipeline
  lifted to the ring's height, the edges-pen boundary, a glyph box that holds
  the head. Rejected: two gestures, behind Close-Up; a Layers row that inserts
  steps; and its claim that Cut alone reproduces look 2, which look 2's
  off-paper corner disproves.
- **The walk-back and the sheet-centred plane** (this plan as of 2026-10-05).
  An enlarged step found its area by walking back over turns and enlarged
  steps, and its window was derived from that area through a plane: pattern
  units about the sheet's centre, each step's turn undone. Dropped for two
  reasons. What a step printed depended on the steps before it, so moving or
  deleting one re-framed others or left them with no area. And the plane
  moved the whole picture by one transform, so it drifted wherever a capture's
  fold held another face still or a spread moved the head (its own Risks
  named this), and it could neither turn nor mirror a frame with the paper.
  Point-in-time capture answers the first; the face imprint the second.
- **The largest face as the anchor** (proposed before Z9). Usually the body,
  but the largest face can be one that moves, such as a big flap the next
  step folds, and one lying partly inside the frame drags it with any fold
  there.
- **The face under the area's centre as the anchor.** A flap folded inside
  the frame, which is what the enlarged steps go on to fold, would drag the
  frame with it.

### 2. Equal divisions

**What it is.** Lang's combination of "the notation of the draftsman and
geometer" (Part VI): a dimension line set off from the object, plus hash
marks, one group with one hash and another with two. It is also the |—\—|—\—|
symbol on Zach's Origami House template; Sturm prints the count ("4") instead.
A new kind, `divisions`. It never draws the line it measures, which the
picture already has, only its own notation. The sketch's dashed valley is an
ordinary Line drawn to a division point, which snaps.

Words: the **measured line** (`from` to `to`, the line being divided); the
**line** (the dimension line, set off from it); **dividers** (strokes square
to the measured line, at each end and between parts); **ticks** (the slashes
on each part).

#### The tool

Equal Divisions, in the Marks group after Equal Angles, key D (ED8 A). It is
not a line tool, so Line Type does not apply to it. Laying it follows ED1 A
(a drag, or a click on a line); under B the click and the `nearestLine.ts`
move below go, and under C the offset is placed by a third press.

- **Drag from one end to the other.** Both ends snap as a Line's do (the
  picture's corners and vertices, line ends, crossings, other marks' points);
  ⌘/Ctrl puts an end down freely; the Snap switch turns snapping off. The
  draft shows the mark as it will be drawn.
- **Or click a line to divide it end to end**: a line of the picture, or a
  drawn Line. The nearest-line finder Angle Bisector's picks use (`lineAt`,
  `usePickTool.ts:145-160`) moves into a pure module,
  `diagram/annotate/nearestLine.ts`, shared by both tools, and **extends the
  piece under the click through its collinear neighbours**
  (`runsStraight`/`alongLine`) to its maximal ends. Without that, a click
  takes a piece: a crease pattern's rim is split wherever a crease meets it
  (`pictureGeometry.ts:8-10`), so after a book fold a click on the top edge
  would divide half of it. With the tool in hand, the line a click would take
  is highlighted under the pointer, so on a flat fold a covered face's edge is
  seen before it is taken.
  - A click takes the line under the raw pointer, not the snapped start, with
    or without ⌘ or Snap, which affect only a drag's ends. A release that
    moved past the drag slop but is shorter than `MIN_ANNOTATION_LENGTH`
    counts as a click, not as a drag rejected for its length.
  - A click on no line puts nothing down, and the tool window says "Click on a
    line to divide it whole, or drag from one end to the other." Only pick
    tools can say such a thing today (`annotateTools.ts:397`,
    `pickProgress.ts`); `pickProgress` is generalised to a tool notice a
    drawing tool can set, cleared on the next press or tool change, and read
    by `useAnnotateToolHint`.
  - Uploads and fixed pictures have no picture lines; Lines drawn on them can
    be clicked.
- **Laid with** 4 parts (the sketch's) and one tick; the line 2.5 mm off, on
  the side away from the picture's middle (off the paper when the measured
  line is an edge), as a callout's box goes; on a line through the middle, to
  the right of travel.
- **Then the count** (ED5 A; under B or C nothing takes the focus, and
  `useFieldFocusRequest` and `fieldRef` below are not built). The new mark
  is selected, as every new mark is, which brings Layers
  forward (d388654df), and its **Parts** field takes the focus, as a new
  label's Text does: type 5 and press Enter; `NumberField` blurs on Enter and
  the canvas has its keys back. Escape keeps 4. The field selects its contents
  when it takes the focus, so 5 replaces 4 rather than making 45 (clamped to
  32).
  - The focus effect at `DiagramLayers.tsx:113-139` is typed and placed for a
    textarea. It moves into a hook,
    `useFieldFocusRequest(annotationId, field)`, used by `TextAreaRow` and by
    `NumberRow` through a new `fieldRef`; `labelFocus.ts` becomes a
    field-focus request (an annotation id plus a field).
  - On a coarse pointer, where Layers is a tab of the sheet behind the
    Settings pill, the tool window says so ("…then type how many parts in
    {{sheet}} ▸ {{tab}}", as `textHelpOnTouch` does for labels,
    `annotateTools.ts:456`), and the field takes the focus when that tab comes
    forward. Until then 4 stands.
  - **The tool stays in hand** after a mark is laid (ED13 A), as it does
    after every mark but a label or a callout, which hand Select back
    (`useAnnotateCanvas.ts:959-960`), so several marks can be drawn in a
    row.

**Selected, with Select**, the canvas shows a wash along its ink, a hairline
along the measured line between two dots at its ends, and a small handle at
the middle of its line (`DivisionsSelection`). The gestures (ED2):

- A dot moves its end, snapping as when drawn.
- Dragging the mark (any of its ink, or the handle) slides its line nearer to
  or farther from the measured line, square to it, kept to 0.1 mm; Shift holds
  it to half millimetres. Dragged across the measured line, the line goes over
  to the other side. One undo step per drag.
- It is never moved whole: it belongs to the line it measures.
- F (Flip Arc's key and verb, named Flip, as on a pleat arrow) moves the line
  to the other side in place.
- Select's help ("Drag it, or the dot at either end, to move it",
  `annotateTools.ts:263`) gains this mark's exception, and the Shift line goes
  in `annotateToolModifiers`, after the `closeUpShiftKey` precedent.

#### Model and file

- `from`, `to`: the measured line's ends, in picture units.
- `parts`: 2 to 32, always written. 32 is the largest box-pleating grid
  commonly marked; Edit's Divided Line goes to 256, but it makes creases, and
  past 32 a printed mark is a ruler.
- `offset`: the line's distance from the measured line in **mm as it prints**,
  0 to 15, always written (ED3). At 0 the line lies on the measured line and
  the dividers straddle it: the template's symbol. It is the first print
  length a mark stores; mm rather than ink, so the pane's 0.5 mm steps are
  written as typed.
- `mirrored?: true`: the line lies to the left of the way from `from` to `to`
  runs, as the picture shows it; unsaid, to the right. The pleat arrow's
  field, with its meaning. Keeping the side apart from a non-negative offset
  lets it survive an offset of 0.
- `ticks?: 1 | 2 | 3`: one when unsaid; the equal-angle mark's field, read and
  edited the same way (`DiagramAngleTicks` becomes `DiagramTicks`; ED7).
- `numbered?: true`: prints the count (ED6 A; under B there is no field, and
  under C the count always prints with no field).

`createAnnotation` lays the defaults. `cleanAnnotation` gains a branch: ends
within reach, `parts` whole and in range, `offset` in range, `mirrored` and
`numbered` written only when true. `isDegenerate` checks the length, as for a
line. A new `AnnotationShape`, `divisions`, keeps it out of `LINE_KINDS`, so
hit order and every line consumer stay as they are.

The file: `ANNOTATION_FIELDS.divisions` = `parts`, `offset`, `mirrored`,
`ticks`, `numbered`. `parts` is required: a whole number over 32 is a newer
build's; under 2, or not whole, is damage. `offset` is required: past 15 is a
newer build's; negative or not a number is damage. `mirrored` and `ticks` are
read as for pleat arrows and angle marks. `numbered`: unsaid or false is off,
true is on, anything else is damage. `behind` is not one of its fields, so a
file that gives it one is a newer build's. The writer names the new fields, as
`writeAnnotation`'s exhaustiveness check enforces.

#### Drawing at print weight

A shared References primitive (D8),
`{kind: 'divisions', from, to, parts, offset, mirrored, ticks, numbered}` with
`offset` in the drawing's ink. The geometry is `divisionsShape`,
`divisionsDrawn` and `divisionsPathData` in `stepDiagramGeometry.ts`; the
sizes, and each stroke's pen, are `DIAGRAM_DIVISIONS_INK` in `diagramInk.ts`.
The compile converts mm to ink by `ANNOTATION_INK_MM`. The side is measured
after projecting (`mirrored !== project.mirrored`), as a pleat arrow's Zs are.

- **Pens** (ED9 B): dividers and ticks in the ring pen; the line in 0.25 pt,
  the existing creases' pen (under A the ring pen; under C the ring pen at
  45% ink). Butt caps, the annotations' ink, on and off the paper
  (`onAndOffPaper`).
- **The line**: from end divider to end divider, `offset` off the measured
  line.
- **Dividers**: parts + 1, square to the measured line, each from the measured
  line to 5 ink (1.65 mm) past the line (ED4). Where the offset is less than
  that, a divider starts as far on the other side of the line instead,
  straddling it evenly; at 0 that is the template's symbol.
- **Ticks**: across the line at the middle of each part, 3 ink (1 mm) either
  side of it, each leaning 20° off square, as a backslash does across a level
  line. The lean is decided on the page, as text's direction is, whichever way
  the mark was drawn and however the picture is turned or mirrored: it is
  notation, not paper. Two or three ticks stand 2 ink (0.66 mm) apart. These
  are the sketch's sizes, not the equal-angle mark's ±1.8 ink square to its
  arc (ED11 A; under B they take the angle mark's size and keep their
  lean). A part shorter than twice its ticks' span draws them smaller,
  **down to a floor** (ED10 B): tick spacing at least two pens, a half-tick
  at least 1.5 ink. Past the floor they stop shrinking, and the Parts row
  warns "Too many parts to print clearly at this size", measured at the
  step's printed size from the page layout, as the Steps grid reads the
  cards' text-cut flags. (Under A, no floor: three ticks on 32 parts of a 40
  mm edge stand 0.19 mm apart, under one pen. Under C, past the floor each
  part draws one tick.)
- **The number** (`numbered`): the count in `INLINE_LABEL_FONT`, weight 700,
  at 7.2 ink (2.4 mm, the rotate glyph's fraction), in the annotations' ink,
  upright, centred on the line's middle 2 ink beyond the dividers' ends, on
  the line's side. Its `<text>` goes through the cell's `setText`, so the PDF
  embeds its digits, and `annotationScene` swaps it to the page's Latin face.
  No halo: annotation drawing has no paper outline to know where the paper is
  (`annotationPrimitives.tsx:551-556`, `outline: []`), and Annotate's labels
  draw none.
- **Reach** (`markReach`): every stroke's ends plus half a pen, and the
  number's box. A mark along a picture's top edge takes about 4.2 mm of its
  room, which lowers its Fit-each run's scale (ED3).
- **Calibration**: on the sketch the offset is about 11 px on a 205 px edge,
  the dividers run about 8 px past the line, and the ticks are about 8 px at
  about 20°. At a 50 mm edge that is 2.7, 2 and 2 mm.

#### Snapping, flaps, carry, flip, copy

- **Snapping.** `snapsWhenPlaced` is true for both ends.
  `annotationSnapPoints` offers its two ends and each division point on the
  measured line, so a Line drawn from the first quarter, as in the sketch,
  lands on it. Not added to `drawnLines`: the measured line is not drawn, so
  it makes no crossings. On a 3D or simulated picture the parts are equal on
  the page, not on the paper (the camera has perspective,
  `captureFolded.ts:241`), so division points are not offered there, as
  right-angle detection skips camera lines.
- **Behind flaps**: never (`behindEnds` empty). It is notation over the
  picture, mostly off the paper.
- **Carry**: as a line. Each end goes with the face under it
  (`PictureMove.point`, per face in a spread); a mirror toggles `mirrored`, so
  the line stays on the paper's same side; a turn leaves it. `offset`,
  `parts`, `ticks` and `numbered` do not change: print sizes do not scale with
  the picture. `diagramInModel` maps the ends and toggles `mirrored` where the
  map turns the paper over (`reverses`), as for a pleat arrow.
- **Flip Horizontal and Vertical** (`flipsOver`): about the middle of the
  measured line (`flipCentre`). On a level edge Flip Vertical takes the line
  to the other side and Flip Horizontal changes nothing visible, so
  `flipChangesMark` (`annotationModel.ts:1662`, a JSON comparison today, read
  at `annotationActions.ts:455`) compares this kind's drawn geometry, and the
  do-nothing flip is held.
- **Flip (F)**: through the pleat arrow's `withPleatSide`, renamed `withSide`;
  held (`flipChangesArc` false) on a mark with no offset and no number.
- **Paste** into another step lands in place. On the same step (ED12 A), the
  copy keeps its measured line and stands 2.5 mm further out for each
  earlier paste (stacked, as drafting stacks dimension lines), up to 15 mm. It
  is not moved by `PASTE_OFFSET` (`annotationClipboard.ts:27-55`), which would
  leave it measuring nothing. Under B it lands on the line's other side;
  under C it moves by `PASTE_OFFSET` as every mark does.
- Pose's ghosting and a close-up's inside draw it as they draw every mark;
  inside a close-up the offset stays at its print size, as an arrowhead does.
  Edit Path does not shape it.

#### Layers pane

`DiagramDivisionsControls`, a child component of field rows only, so no styles
of its own: **Parts** (a stepper, 2–32, with the crowding warning, ED10 B),
**Offset** (a stepper in mm, 0–15 by 0.5; any tenth typed; ED3 A), **Ticks**
(1 | 2 | 3; ED7 A), **Number** (a switch, help "Print the count beside the
line."; ED6 A), then the Flip
row (Horizontal, Vertical) and the verbs (Flip, Delete). The Ticks row is
extracted as `DiagramTicksRow`, used by the equal-angle mark's rows and by
this component, so the order is Parts, Offset, Ticks, Number. Each change is
one undo step through `useStepAnnotations`: `setParts`, `setDivisionsOffset`,
`setNumbered`, and `setTicks` widened to either kind through `hasTicks(kind)`.
`DiagramLayers` only mounts the component.

#### Analytics and i18n

- `diagram annotation added` with `tool: divisions`. A drag's `snap` is its
  ends' (either snapped). A click on a line is `none`, as the bisector's line
  picks are ("picks lines rather than points", `docs/analytics.md:347`), and a
  new enum property on this tool's event, `placed` (`drag`/`line`), lets ED1
  be judged later.
- Flips from the Layers row are counted by `diagram annotation flipped`; F's
  side flip is not, as for pleat arrows. That row's wording ("any other mark
  about its anchor") is amended to say this mark flips about its middle.
- No other event: parts, offset and number are settings of one mark, and
  drawing one tells us it is used. `DiagramAnnotationTool`, `ANNOTATION_TOOL`
  and `docs/analytics.md` (the tool list, the snap sentence, `placed`) are
  updated.
- i18n, nine catalogs: `tools:diagram.toolDivisions` ("Equal Divisions");
  `panels:diagram.annotate.divisionsHelp` ("Drag along a line from one end to
  the other, or click it, to divide it; then type how many parts. With Select,
  drag the mark to set how far off the line it sits."), `divisionsHelpTouch`,
  `divisionsNoLine`, `divisionsShiftKey`, and the Select help's exception;
  `panels:diagram.annotations.parts`, `.offset`, `.number`, `.numberHelp`,
  `.partsCrowded`; the shortcut label `diagram.toolDivisions`. The ⌘ line
  reuses `endsFreeKey`.

#### What the review changed

The design was reviewed against the code before this plan. Each major issue,
and its fix above:

1. *Clicking an edge to divide it whole failed on crease-pattern pictures*,
   whose rim is split at every crease, and could take a covered face's edge on
   a flat fold. Fixed: the shared nearest-line module joins collinear pieces
   into the whole line, with a hover highlight of what a click takes; tested
   on `pictureSnap.test.ts`'s rim fixture and on a flat fold with a covered
   face.
2. *The number's "halo where it lies on the paper" could not be built.* Fixed:
   no halo, as Annotate's labels have none.
3. *A same-step paste moved the copy whole*, contradicting ED2. Answered by
   ED12, whose recommendation stacks it 2.5 mm further out on the same
   measured line.
4. *Ticks shrank with no lower limit* and smeared at 32 parts. Answered by
   ED10, whose recommendation is a floor in ink and a warning past it, with
   a geometry test at 32 parts on 25 mm.
5. *On the Diagram preset's white paper the end dividers and the line close a
   band that reads as part of the sheet.* ED9 puts the pens to Zach, judged
   on white paper in the prototype.
6. *Draw-then-type broke where Layers was not showing*, on touch above all.
   Fixed: touch help, the focus taken when the tab comes forward, the
   contents selected on focus; and ED13 asks whether the tool stays in hand.

The minor issues are folded in above: the tool notice channel; `snap: none`
and `placed`; F uncounted, the flipped row reworded; a short drag taken as a
click, and ⌘ and Snap-off clicks defined; reach's cost on the shared scale; no
division points on projected pictures; ED4's and ED7's reasons corrected, and
the tick sizes put to Zach (ED11); the Select help and the Shift line;
`flipChangesMark`; `INLINE_LABEL_FONT`; the uploads sentence; test placement
(in the checklist).

#### Decisions: equal divisions (all DECIDED, 2026-10-06)

Zach answered on 2026-10-06, "oh yeah they look good", to the
recommendations: all A, except ED9 B and ED10 B, each the recommended option.
Built in 16b. The interactive versions are in
`artifacts/revision-2/revision-2-marks.html`. **No equal-divisions decision is
pending.**

**ED1. How do you lay it? DECIDED: A.**
- A. Drag from one end to the other, both ends snapping as a Line's do, or
  click a line of the picture (or a drawn line) to divide it whole.
- B. Drag only: exactly the Line tool's gesture.
- C. A drafting tool's three presses: the two ends, then the pointer places
  the line (its offset and side), and a third press sets it.
- **Recommended: A.** The note says "you draw a line", and the drag does
  exactly that. Most of these marks divide a whole edge or crease, and a click
  takes it end to end with no aiming at corners. C settles the offset in one
  gesture, but it would be the only three-press placement outside the pick
  tools, and a touch screen has no hover to preview the offset.

**ED2. What does dragging a laid mark do? DECIDED: A.**
- A. It slides the line nearer or farther (the offset); across the measured
  line it goes to the other side; Shift holds 0.5 mm. The end dots move the
  ends. It is never moved whole.
- B. As every mark: a drag moves it whole, and the offset is set by a small
  handle at the line's middle.
- C. The offset only in Layers; on the canvas it moves whole or by its ends.
- **Recommended: A.** Moved whole, it measures nothing. The offset is the one
  thing set by eye, and the line is what the pointer goes for. B leaves a
  small target for the thing actually adjusted; C makes an eye-judged setting
  a typed one.

**ED3. What unit is the offset in? DECIDED: A.**
- A. Millimetres as it prints: 0 to 15 mm, 2.5 by default, in 0.5 mm steps.
  The whole symbol is one print size, like every mark.
- B. A share of the picture: 5% of the frame by default, the sketch's. The
  line moves out as the picture prints larger, while dividers and ticks keep
  their print size.
- **Recommended: A.** Every mark's size is a print size, and Fit each prints
  steps at different scales: under B the same-looking mark sits 1.5 mm off on
  one step and 4 mm on the next while its ticks never change. 2.5 mm is the
  sketch's offset at the 50 mm the canvas and cards draw at, so the two rules
  look the same on screen and differ only on the page. Either way the mark's
  reach costs room: about 8% of the default A4 3×3 box for a mark along a top
  edge, 13% with Number on, lowering its Fit-each run's scale.

**ED4. How far do the dividers run? DECIDED: A.**
- A. From the measured line to 1.65 mm past the line, as in the sketch. Where
  the offset is smaller, they straddle the line evenly; at 0 that is the
  template's |\|\| symbol.
- B. As A, but stopping 0.7 mm short of the measured line (drafting's
  extension-line gap), so they never touch the paper's edge.
- C. Only the two end dividers reach back to the measured line; the inner ones
  are short strokes straddling the line, as Sturm and drafting draw them.
- **Recommended: A.** It is what the sketch draws, and the template's symbol
  is its zero-offset case, so one rule covers both. A divider that touches the
  edge says which point of the edge it marks. At offsets of 1.65 mm and more
  the dividers stay in the margin; below that they go into the paper by design
  (0.65 mm at 1 mm, 1.65 mm at 0), and at 0 the line overdraws the edge. The
  prototype shows 2.5, 1 and 0 mm on white paper. B and C read as an
  engineering drawing rather than the sketch.

**ED5. How many parts, and how is the count set? DECIDED: A.**
- A. 2 to 32, laid at 4. The Parts field takes the focus as a new label's Text
  does: type 5, press Enter, and the canvas has its keys back.
- B. 2 to 32, laid at 4, changed only in Layers, as a pleat arrow's Kinks are.
- C. Laid with the last count used, changed in Layers.
- **Recommended: A.** "specify number of divisions" makes the count part of
  making the mark, and labels already work as draw-then-type. B adds a click
  to every mark. C saves it only when marks repeat, and makes each new mark
  depend on history no one can see.

**ED6. Does it print the count? DECIDED: A.**
- A. A Number switch on each mark, off by default; on, the count prints
  upright beside the middle of the line.
- B. Never: ticks only, as the sketch and the template.
- C. Always, as Sturm's symbol sheet.
- **Recommended: A.** Off by default, as the sketch and template print no
  number. But readers slip counting 7 or 9 parts, and a Label placed beside
  the mark would not move with it. The rotate glyph already sets a number
  inside a mark through the same text path to the PDF.

**ED7. How are two sets of equal parts in one step told apart? DECIDED: A.**
- A. Ticks 1, 2 or 3 per mark: the equal-angle mark's field and Layers row,
  shared (Lang: one group gets one hash, another two).
- B. Always one tick; a second set is told apart by its count (Number on).
- C. Chosen automatically: a second divisions mark in a step gets two.
- **Recommended: A.** Lang's convention, already used for equal angles. C
  would change a mark with what else is on the step. The field, row and verb
  are shared, but the printed ticks are not the same size: an angle mark's are
  ±1.8 ink square to its arc, a division's ±3 ink leaning 20°, as the
  sketch's. Whether they should match is ED11, where the prototype draws the
  two side by side.

**ED8. Name, key and place on the rail. DECIDED: A.**
- A. "Equal Divisions" (the note's words), key D, in Marks after Equal Angles.
- B. "Equal Parts" (Sturm's words, a pair with Equal Angles), key E. E is
  Enlarge's (Z1, decided), so B would need another key.
- C. As A, with no key, as Equal Angles has none.
- **Recommended: A.** D is free in the Diagram's scope and suggests "divide";
  beside Equal Angles, the two equality marks sit together.

**ED9. Which pen draws the dimension line, on white paper? DECIDED: B.**
(Raised by the review.)
- A. Every stroke in the ring pen, 0.5625 pt.
- B. The line in 0.25 pt (0.09 mm), the existing creases' pen and the
  template's crease weight; dividers and ticks in the ring pen.
- C. The line in the ring pen at 45% ink, like the sketch's light grey;
  dividers and ticks in full ink.
- **Recommended: B**, to be judged on the prototype's white-paper panel,
  with C, or ED4's B (a 0.7 mm gap at the edge), as the fallback had B still
  read as a taller sheet. Zach took B. The sketch's line is thin and grey, on
  green paper. In the Diagram preset the ring pen is heavier than the 0.5 pt
  edge, and the end dividers continue the sheet's sides by 4.15 mm, so A
  draws a closed band in the edges' ink. C adds a second ink to a preset that
  has one.

**ED10. Ticks on crowded parts. DECIDED: B.** (Raised by the review.)
- A. Shrink freely, with no lower limit.
- B. Shrink to a floor (spacing at least two pens, a half-tick at least 1.5
  ink) and stop there; the Parts row warns that the parts are too short.
- C. Shrink to the floor; below it each part draws one tick.
- **Recommended: B.** At 32 parts on a 40 mm edge, A's three ticks stand
  0.19 mm apart, under one pen, and merge; arrowheads already keep a
  minimum (`ARROWHEAD_MIN_STROKES`). C stays legible but changes what the
  mark says, since two ticks mean a second set.

**ED11. Tick size beside the equal-angle mark. DECIDED: A.** (Raised by the
review.)
- A. Each its own: division ticks ±3 ink leaning 20°, 2 ink apart, as the
  sketch; angle ticks stay ±1.8 ink, square to the arc, 1.8 apart.
- B. One size: division ticks take the angle mark's length and spacing and
  keep their lean.
- **Recommended: A.** It keeps the sketch's proportions; the shared Ticks
  field is one vocabulary of counts, not of sizes (ED7).

**ED12. Pasting on the same step. DECIDED: A.** (Raised by the review.)
- A. In place, 2.5 mm further out for each earlier paste, up to 15 mm.
- B. In place, its line on the other side.
- C. Moved down and right by `PASTE_OFFSET`, as every mark's paste is.
- **Recommended: A.** The mark belongs to its line. Under ED2 A a body drag
  sets the offset, so a moved copy (C) could only be put back end by end.
  B works once; a second paste has nowhere to go.

**ED13. After laying one. DECIDED: A.** (Raised by the review.)
- A. The tool stays in hand, as after every mark but a label or callout.
- B. Select comes back, as after a label.
- **Recommended: A.** A label goes back to Select because its words come
  next. Here the count comes next too, but after Enter the next thing is
  often another edge: the top in quarters, then the left.

**Out of scope**: showing how to find the divisions by folding, which Lang
also asks diagrammers for (the References sequence's job); dotting dividers
that cross a hidden edge; choosing the tick count automatically.

### 3. The right-angle mark

**What the sketch shows.** Measured on the original, rotated so the flap's
edge is level; units are its px, the square about 13.5 a side.

- A dashed valley fold leaves a small reference ring on the flap's lower edge
  and meets the flap's upper edge at 90°.
- The mark sits in the angle between the fold and the edge, on the flap's tip
  side, wholly on the paper, touching neither line.
- It is an ∟ of two legs of its own, one parallel to the edge and one to the
  fold. They meet at an inner corner about 8.3 px in from the fold and 8.5 px
  in from the edge, on the angle's bisector about 12 px from the vertex. Each
  leg runs about 21.5 px from the inner corner.
- A closed square, about 13.5 px a side, sits in the ∟'s corner, two sides on
  the legs; the legs run on past it by about 8 px. The inset is about 0.6 of a
  side, a leg about 1.6 sides. It is drawn in the book's red-brown at about
  the edge's weight.
- A short black tick continues the fold a few px past the edge, off the paper.
  It is the fold line's own overshoot, not part of the mark (Zach, RA0).
- The reading: today's open square given its own two legs and moved off the
  vertex into the angle (RA0 A).

**Why it is better, and what it costs.** Today's mark (`diagram-annotate.md`
decision 11, built in 14e) borrows two sides of its square from the picture's
lines. On a dashed valley the borrowed half is dashes, or nothing where a gap
falls, and at the vertex it collides with line ends, rings and arrowheads.
With its own legs the mark is whole whatever the lines are, and it sits where
a reader looks for it. The cost: on 3D and simulated captures, photo uploads
and affine spreads, a right angle on the paper is not 90° on the page, and
legs drawn square to each other and parallel to the lines 1.3 mm inside them
make any difference visible as gaps that converge. At a projected 80° each leg
runs about 5° off its line, and the 4-ink inset varies from 2.7 to 5.3 ink
along it. Today's look hides that. The browser proof shows those pictures
beside today's look (RA2).

**Geometry**, in ink, under RA0 A (legs and a square), RA1 A's sizes and RA5
A's full-length legs: `DIAGRAM_RIGHT_ANGLE_INK = { inset: 4, side: 7, leg: 11
}`. RA5 C makes `leg` 9, so the legs end 13 ink (4.3 mm) out; RA0 B drops the
legs and draws the closed square alone. *Revised 2026-10-06 after Zach's
review (RA1, RA5): half that, `{ inset: 2, side: 3.5, leg: 5.5 }`, in the aux
lines' pen.* V is the vertex
and d the unit diagonal into the angle, measured after projecting; a and b are
d turned 45° either way, as `rightAngleSquare` turns them today.

- Inner corner I = V + inset·(a + b): 4 ink (1.3 mm) off each line, 5.7 ink
  along the diagonal.
- Legs from I to I + leg·a and from I to I + leg·b: 3.6 mm each, ending 15 ink
  (5 mm) out along each line, the angle mark's radius.
- Square I + side·a, I + side·(a + b), I + side·b: 2.3 mm a side, today's
  size.
- Footprint about 5 × 5 mm (today 2.3 × 2.3). The clear gap between each line
  and the leg beside it, half-pens off, is about 1.09 mm.

**Every right angle takes it** (RA2 A). No field and no option: existing
marks, the crane's included, redraw in the new look. Under B a `look` field
and a Layers row come in (old marks keep today's look); under C a style
setting.

**Placing** (RA3 A). The vertex stays the anchor: hover in a right angle and
click, or press at a corner and drag into the angle; Shift holds 45° steps; ⌘
(Ctrl) places freely. The inset belongs to the drawing, not the file. But
today's find zone, the snap radius about the vertex less a 25% dead zone
(`rightAngles.ts:67, 92`; about 3.7 to 14.7 screen px), lies wholly in the gap
between the vertex and the new mark's inner corner (about 17.5 px at fit, the
far corner about 48 px). The hover ghost would never be under the pointer, and
a click on it would put down a free mark elsewhere, breaking 14e's rule that
the hover shows exactly what a click does. So the search changes:

- For this tool, `rightAngleCorner` searches vertices within the snap radius
  plus (inset + side)·√2 ink, in picture units at the canvas's ink, and
  accepts the angle whose sector, out to the drawn square's far corner, holds
  the pointer. The dead zone is dropped on that path.
- `rightAnglePlacement.ts` and the canvas's hover and click preview
  (`useAnnotateCanvas.ts:349-356, 750-773`) use it, so the ghost lies under
  the pointer and a click there marks that vertex.
- A press at a vertex, within the snap radius, still starts the drag from the
  corner. ⌘ still puts the vertex at the pointer, and its hint ("Hold
  {{modifier}} to put its corner down anywhere, without snapping.") becomes
  "…to put the corner it marks down anywhere…" (RA8 A), since the drawn ∟
  now has a corner of its own.
- The hover ghost (`RightAngleGhost`) draws the new shape; the vertex's snap
  target still shows.

**Model and file: unchanged** (under RA2 A, RA3 A and RA4 A; RA2 B, RA3 B
and RA4 B each add a field). `from` is the vertex and `to` is
`RIGHT_ANGLE_DIAGONAL` along the diagonal; `ANNOTATION_FIELDS['right-angle']`
stays base-only; `cleanCorner`, `rightAngleAt`, `turnRightAngle` and
`CORNER_NUDGE` are untouched. Existing files read as they are, draw in the new
look and save back byte-identical. An older build opening a newer file draws
today's look from the same data.

**Drawing at print weight.** The primitive `{kind: 'right-angle', at, toward}`
is unchanged.

- In `stepDiagramGeometry.ts`, `rightAngleSquare` (l.2536) becomes
  `rightAngleShape(vertex, diagonal, size)`, returning
  `{ legs: [endA, inner, endB], square: [onA, far, onB] }`.
- `rightAngleDrawn(at, toward, project)` (l.2558) sizes it by `project.ink`
  and measures the diagonal after projecting, so it mirrors with the paper;
  symmetric about its diagonal, it has no side to keep. Null when `toward` is
  the vertex.
- `rightAnglePathData(shape)` gives `M endA L inner L endB M onA L far L onB`:
  one path element, so overlaps never double the ink.
- Pen: the ring pen in `ink.mark` (RA5 A; B draws the legs past the square
  in 0.25 pt, a second path; D a colour of its own), solid,
  `stroke-linecap="butt"`,
  `stroke-linejoin="miter"` set on the element: mitred inner and far corners,
  and the square's far sides ending butt on the legs' centrelines. Drawn twice
  through `onAndOffPaper`, as today. `DiagramPrimitives.tsx`'s case (l.896)
  draws the path; `polylinePathData`'s import goes if it falls unused.
- `rightAngleReach(pen)` (l.2577): pen/2 past the four butt ends and √2·pen/2
  past the two mitred corners; `markReach.ts` (l.182) takes all six points.
  The far ink (the square's far corner, at RA1 A's sizes whatever RA5 does
  to the legs) moves from about 9.9 to 15.5 ink from the vertex, so the room
  pages and the canvas fit leave for marks that open off the picture grows,
  and the crane's pages may reflow though its file is unchanged. The proof
  compares them.

**Hit and grips** (`annotationHit.ts`).

- `rightAngleInPicture(annotation, ink)` replaces `rightAngleLegs` (l.485) and
  returns the shape at the canvas's ink.
- `rightAngleDistance` (l.518) is 0 inside the closed square, the distance to
  the nearer stroke elsewhere, and **Infinity when the press is nearer the
  vertex than the inner corner**. Marks hit above lines, and the coarse reach
  (18 px) is about the vertex-to-inner-corner gap at fit, so without this the
  mark could still take a press meant for the line ends at its vertex on an
  iPad.
- Selected, the mark keeps the `corner` grip on the vertex (it moves the mark
  whole and squares it into the right angle at a new vertex); the `direction`
  grip moves to the square's far corner (it turns the mark, Shift for 45°).
  The corner grip sits about 5.7 ink from the mark, alone in the angle, so the
  Selection and the ghost draw a hairline in the selection colour from the
  vertex to the inner corner (RA6 A; under B the dot stands alone). The wash
  covers both strokes as one path.

**Unchanged code**: snapping (`annotationSnapPoints` still offers the vertex;
the legs give no rays or crossings to `rightAngles.ts` or `drawnLines`); carry
(a spread carries the vertex with its face by `CORNER_NUDGE`, a mirror mirrors
the diagonal); Flip Horizontal or Vertical about the vertex, into the mirrored
quadrant with its inset kept; Turn 90° to the next quadrant clockwise; paste;
`referenceFinderStepInModel`. Layers gains no row; Turn 90° stays the mark's
verb, and the row's icon changes with the glyph (RA7).

**Analytics**: no new event;
`diagram annotation added {tool: right_angle, snap}` still measures use, and
its snap semantics hold. If RA2 becomes a per-mark Look or RA4 a Size, the
setting needs a hand-placed `diagram right angle restyled` (an enum `look` or
`size`) and a docs row. **i18n**: the reworded `cornerFreeKey` in nine
catalogs (RA8 A); a Look, Inset or Size row from an alternative would add a
label and its options.

#### What the review changed

1. *The hover and click no longer showed what a click puts down*: the find
   zone lies in the gap before the inset mark. Fixed: the footprint search
   above, with tests that hovering where the ghost is draws the same ghost and
   a click there marks that vertex; `rightAngles.ts`, `rightAnglePlacement.ts`
   and the canvas's hover are now touchpoints, and RA3's reason is rewritten.
2. *Three `paintAnnotations.test.ts` tests hard-code the old geometry*
   (l.234-260 the shape regex, 263-269 the bounds past the frame, 706-870 the
   reach-at-any-pen model). Fixed: listed, to be rewritten for two subpaths;
   the bounds at the legs' 15-ink butt ends, or at the far corner's 11 ink
   plus its mitre, whichever the case gives; and a six-point reach model.
3. *In the Diagram preset the legs, in the edges' ink at about their weight,
   1.1 mm inside and parallel, may read as layer edges.* Fixed: RA5 puts the
   ink and weight to Zach, judged on a row of layered edges.
4. *3D, simulated, photo and affine pictures show any error in the angle.*
   Fixed: the trade-off is stated (above and in RA2), and those pictures are
   in the browser proof.

The minor issues are folded in: pens in pt with ink equivalents (Common
ground); the corner grip's distance corrected and a hairline put to Zach
(RA6); the vertex excluded from the hit at every zoom; the duplicate file test
dropped (`diagramFile.test.ts:523-531` already covers the round trip; the
crane's byte-identical save stays in the proof); the glyph made a decision
(RA7); the ⌘ hint's rewording put to Zach (RA8); RA4's unsupported claims
dropped and its options reworded; the reflow check; the sketch's reading and
the black tick put to Zach, with a closed-square-only control (RA0).

#### Decisions: the right-angle mark (all DECIDED, 2026-10-06)

Zach answered on 2026-10-06, "oh yeah they look good", to the
recommendations: RA0–RA8 all A. For RA0 he settled the black tick too: it is
the fold line's overshoot, not part of the mark. Built in 16a. The
interactive versions are in `artifacts/revision-2/revision-2-marks.html`.
**No right-angle decision is pending.**

**RA0. What does the sketch mean? DECIDED: A.**
- A. An ∟ of two legs with a closed square in its corner, inset from the
  vertex (the reading above).
- B. A closed square only, inset, with no legs (the prototype's control
  column).
- Also asked (a caption under RA-0's figure, not one of its options): the
  short black tick past the edge. Is it the fold line's own overshoot (not
  drawn here), or part of the mark? **Zach: the fold line's overshoot, not
  part of the mark.** The mark draws nothing past the edge.
- **Recommended: A**, with the tick left for Zach to say. Under B the legs,
  RA5 and RA6 would have fallen away and RA1 set only the inset and the
  square.

**RA1. How big is the mark, and how far into the angle? DECIDED: A.** (Ink is
0.331 mm; legs are measured from the inner corner.)
- A. Inset 4, square 7, legs 11: 1.3 mm in, a 2.3 mm square (today's), legs
  ending 5 mm from the vertex along each line; a footprint of about 5 × 5 mm.
- B. Inset 3, square 6, legs 9: 1 mm in, 2 mm, legs ending 4 mm out. Fits a 4
  mm flap.
- C. Inset 5, square 8, legs 13: 1.7 mm in, 2.6 mm, legs ending 6 mm out.
  Closest to how big the sketch's mark looks on a large picture.
- **Recommended: A.** It keeps decision 11's 2.3 mm square and the sketch's
  proportions (inset about 0.6 of a side, legs about 1.6 sides), and its legs
  end at 15 ink, the angle mark's radius, so the two precise marks look like
  one family (true under RA5 A; RA5 C ends them at 13 ink). B if the
  diagrams have many narrow flaps; C starts to crowd a corner. The
  prototype's sliders set any size, and a custom size comes back in the
  picks.
- **Revised 2026-10-06, on seeing 16a built: half of A.** Zach: "the right
  angle mark is twice as big as it should be". Inset 2, square 3.5, legs 5.5
  (`DIAGRAM_RIGHT_ANGLE_INK`), A's proportions kept: 0.66 mm in, a 1.16 mm
  square, legs ending 7.5 ink (2.5 mm) from the vertex along each line; a
  footprint of about 2.5 × 2.5 mm. The legs no longer end on the angle
  mark's radius. The hit test, the placement's footprint search
  (`RIGHT_ANGLE_FOOTPRINT`, now about 0.051 of the frame), the selection's
  wash, tie and grips and the canvas's ghost all follow the constants.

**RA2. Does every right angle take the new look, or is it an option?
DECIDED: A.**
- A. Every right-angle mark, with no new field. Existing marks redraw; the
  file is unchanged.
- B. A per-mark Look row in Layers (Inset / On the Corner): a `look` field,
  unsaid meaning On the Corner so old marks keep today's look, new marks laid
  Inset; strings in nine catalogs and an event.
- C. A diagram-wide switch in the Diagram's style settings.
- **Recommended: A.** The note reads as a correction, not a request for a
  second style, and one look per meaning keeps a diagram consistent. Today's
  weakness, sides borrowed from lines that may be dashed or crowded, is in
  every file, and the model already holds everything the new drawing needs.
  Against it: on 3D, simulated, photo and affine pictures the legs show where
  the picture's angle is not square; the proof shows those beside today's
  look.

**RA3. Is the inset fixed, or can a mark move further into its angle?
DECIDED: A.**
- A. A fixed inset, placement as today: the vertex the anchor; click in the
  angle, or drag from the corner into it.
- B. A fixed default plus a third grip: drag the square along its diagonal to
  set an `inset` stored on the mark (about 2–20 ink, default 4), with an Inset
  row in mm in Layers.
- C. Free placement anywhere inside the region, away from the vertex, the legs
  giving the two directions.
- **Recommended: A.** Keeping the vertex as the anchor keeps snapping to the
  corner, carrying with its face, Turn 90°, flips, copy and the file. With the
  footprint search, the hover ghost lies under the pointer and a click there
  marks that angle. A grip can be added later on the same model if a crowded
  corner needs one. C needs a new search for perpendicular lines, breaks
  snapping to the corner and carrying with the face, and has no anchor on an
  upload.

**RA4. What happens on a flap narrower than the mark (about 5 mm at RA1 A)?
DECIDED: A.**
- A. Draw it as it is. If it does not fit, Turn 90° to the fold's other side,
  or delete it.
- B. A per-mark Size row in Layers (Regular / Small, Small 0.6×), with a
  `size` field.
- C. Shrink it automatically to the free space in its angle; only pictures
  with geometry (crease patterns, flat folds, References), not uploads or 3D.
- **Recommended: A for now**; B can be added later without changing anything
  else, if a real diagram needs it. The prototype shows flaps 5 and 4 mm
  wide, with how far the leg along the edge ends from the far edge (on the 5
  mm flap, right on it: 15 ink = 4.97 mm). It never showed pictures printed
  at 40 and 54 mm; the canvas draws at 50 mm, so it understates crowding on a
  4-column page. RA4 was decided without them (the check before 16a and 16b).

**RA5. The mark's ink and weight in the Diagram preset. DECIDED: A.**
(Raised by the review.)
- A. Legs and square in one path, in the ring pen and `ink.mark` (the
  arrows' #231f20).
- B. The square in the ring pen; the legs past it in 0.25 pt, an existing
  crease's weight.
- C. The legs shortened to end 2 ink (0.66 mm) past the square (leg 9 at RA1
  A).
- D. One path in a colour of its own, like the sketch's red-brown: a mark
  colour in the paper style, where the Diagram preset is otherwise one ink.
- **Recommended, tentatively: A**, judged on the prototype's cell with a
  layer edge 1 mm under the paper's edge and an existing 0.25 pt crease, in
  the Diagram preset. A is the sketch's proportions (legs about 1.6 sides)
  and keeps RA1 A's reason. If A reads as layers there, C is the smallest
  change: one pen, and the run that reads as an edge shortened. Under A the
  3.6 mm legs run parallel to an edge 1.1 mm inside it, in its ink, which is
  how stacked layers are drawn. B's thinner solid leg reads as a crease. D
  adds a style token. (The prototype recommends A with this fallback; the
  plan follows it.) Zach took A, and 16a's browser proof shows the legs
  beside the sketch.
- **Revised 2026-10-06, on seeing 16a built: the aux lines' pen.** Zach: the
  mark "should be the thickness of aux lines (right now it looks like arrow
  thickness)". Still one path, now drawn in the paper style's aux pen
  (`rightAnglePen`: `project.pens.aux`, an existing crease's pen — 0.25 pt in
  the Diagram preset, 0.5 pt in the Default) instead of the ring's (0.5625 pt
  in the Diagram preset), and still in the ring's ink, `ink.mark`: the
  Diagram preset's aux pen is the same #231f20, and the Default's grey would
  make the mark read as a crease. `markReach` measures it in the same pen.

**RA6. Tie the vertex dot to the mark? DECIDED: A.** (Raised by the review.)
- A. Selected or hovered, a hairline in the selection colour runs from the
  vertex to the mark's inner corner.
- B. No hairline: the vertex dot sits alone in the gap.
- **Recommended: A.** The corner grip stays on the vertex, 5.7 ink (about 17
  px at fit) from the mark's nearest ink, and handles keep their screen
  size, so the gap grows as the canvas zooms in. Without a tie the dot reads
  as a separate point. The prototype shows both at 100% and 300%.

**RA7. The rail icon. DECIDED: A.** (Raised by the review.)
- A. Shows the inset: the picture's two lines in a 1 px hairline, with the
  inset ∟ and square inside them.
- B. ∟ legs and a closed square at the rail's 1.5 stroke, butt caps and miter
  joins: today's silhouette with heavier legs.
- C. Today's icon, unchanged.
- **Recommended: A**, the only one that shows the mark sits inside the angle;
  B looks unchanged on the rail. The prototype draws all three at 20 px and
  6×, light and dark.

**RA8. The ⌘ hint. DECIDED: A.** (Raised by the review.)
- A. "Hold ⌘ to put the corner it marks down anywhere, without snapping."
- B. Unchanged: "…to put its corner down anywhere…".
- **Recommended: A.** The drawn mark now has a corner of its own, away from
  the pointer, so "its corner" could mean either. A rewords `cornerFreeKey`
  in nine catalogs and `DiagramAnnotateToolWindow.test.tsx:131-135`.

## Affected Areas

**Enlarged steps.**

- New, `diagram/zoom/`: `zoomModel.ts`, `zoomImprint.ts`, `zoomCapture.ts`,
  `zoomIndex.ts`, `stepView.ts`, `zoomFrames.ts`, `zoomEdge.ts`,
  `paintZoomed.ts`, `zoomActions.ts`, `useZoomControls.ts`, `useStepZoom.ts`,
  `useAnchorPick.ts`, a test beside each, and the golden `zoom.cases.ts`,
  `zoomGolden.test.ts`, `__fixtures__/zoomGolden.json`.
- New components, each with its CSS module:
  `components/diagram/DiagramZoomControls.tsx` (the Anchor row inside it),
  `DiagramStepZoomStatus.tsx`, `DiagramZoomView.tsx`.
- Document: `diagram/document/diagramDocument.ts` (the kind, its fields,
  `DiagramStepZoom`, `DiagramStep.zoom`, `DiagramPaperFaces`,
  `DiagramScenePicture.paperFaces` (a string), the seed on insert,
  duplicate);
  `diagramFile.ts` (`STEP_KEYS`, `SCENE_PICTURE_KEYS`, `readStepZoom`,
  `readPaperFaces`, `writeStep`, `ANNOTATION_FIELDS.zoom`, `readAnnotation`,
  `writeAnnotation`).
- Annotate: `diagram/annotate/annotationModel.ts` (`ANNOTATION_SHAPES` and its
  exhaustive switches, `createAnnotation`, `carryZoom` from `carryCloseUp`);
  `annotationPrimitives.tsx` (the `zoom` variant, `zoomAreaElement`, reach);
  `annotationHit.ts` (grips, new `AnnotationGripPart` values, hit order);
  `annotateTools.ts` (`ENLARGE`, `ENLARGE_FRAME`, `drawingLook`, help,
  disabled reasons); `useAnnotateCanvas.ts` (the window as frame; the frame's
  selection and grips; the pick mode); `behindFlaps.ts` (`piecesUnder`
  exported); `annotationCarry.ts` (one funnel, the frame's re-landing;
  `wholeFaces` exported for a face's drawn ring);
  `annotationClipboard.ts` (the source view); `paintAnnotations.ts` (a
  close-up on an enlarged step); `annotationEventKind.ts`; `turnGlyph.ts` (the
  arrow is painted as a turn glyph is);
  `components/diagram/DiagramAnnotateCanvas.tsx` (the area's and the frame's
  selection and grips, the dimmed surround, the pick highlight);
  `DiagramAnnotateToolGlyph.tsx` (two glyphs); `DiagramLayers.tsx` (mounting,
  rows).
- Keys: `keyboard/shortcuts.ts`, `diagram/actions/diagramShortcuts.ts`,
  `i18n/shortcutLabels.ts` (E, Shift+E, and Escape leaving the pick mode).
- Pictures: `diagram/pictures/paintDiagramStep.ts`, `useStepPictureUrl.ts`,
  `pictureFrame.ts`, `paintStepDiagram.ts`, `exportStepPicture.ts`,
  `prefixIds.ts`.
- Capture and pose: `diagram/capture/captureFolded.ts` (`flatPicture` writes
  `paperFaces`, unspread places from the placement with no spread);
  `cp-workspace/folded/foldedLayerSpread.ts` (`fitAffine` and
  `sheetNamedFaces` exported beside `layerLevels` and `meanValueWeights`,
  read not changed);
  `diagram/capture/creasePatternScene.ts` (its paper's placement, exported);
  `useDiagramLinkedPose.ts`, `stepCaptureActions.ts` (a frame re-landed on
  refresh, relink and pose); `diagram/actions/diagramLinkedPoseActions.ts` and
  `diagramPoseActions.ts` (Enlarged); `components/diagram/DiagramStepDetail.tsx`,
  `DiagramLinkedPoseControls.tsx`, `DiagramPoseStage.tsx` (the dimmed frame).
- Steps: `components/diagram/DiagramStepCard.tsx` and its module (the chip);
  `DiagramStepsGrid.tsx`; `components/panels/DiagramStepPanel.tsx` (one
  line); `store/workspaceStore/slices/diagramSlice.ts` (the verbs).
- Pages and export: `diagram/pages/diagramPageLayout.ts`, `diagramPages.ts`,
  `pagePictures.ts`, `composeDiagramPage.ts`;
  `components/diagram/DiagramPagesView.tsx`; `diagram/export/stepFiles.ts`,
  `useDiagramExport.ts`, `diagramPdf.wasm.test.ts`;
  `components/diagram/DiagramExportOptions.tsx`.
- Shared References geometry, read not changed:
  `cp-workspace/references/stepDiagramGeometry.ts` (`whiteArrowOutline`,
  `ringPieces`), `cp-workspace/references/diagram/diagramInk.ts`.
- No kernel change: `crates/oristudio-cp`'s `FoldedPaperScene` (schema 3)
  already carries `FoldedPaperFace.points` and `sheet_points`.

**Equal divisions.**

- `diagram/document/diagramDocument.ts` (the kind; `parts`, `offset`,
  `numbered`; `DiagramTicks`), `diagramFile.ts`.
- `diagram/annotate/annotationModel.ts` (the shape, constants, defaults,
  `cleanDivisions`, the exhaustive switches, `withSide`, `hasTicks`,
  `flipChangesMark`); new
  `divisionsPlacement.ts` and `nearestLine.ts` (out of `usePickTool.ts`);
  `annotateTools.ts` (group, key, label, help, touch help, modifiers, the
  Select help); `annotateSnap.ts`; `pictureSnap.ts`; `annotationHit.ts` (the
  `offset` grip); `useAnnotateCanvas.ts` (click on a line, the short-drag
  click, the offset grip, the focus request, the tool kept in hand);
  `labelFocus.ts` (a field-focus request); `pickProgress.ts` and
  `useAnnotateToolHint.ts` (the tool notice); `annotationPrimitives.tsx`
  (compile, reach); `canvasInk.ts` (`ANNOTATION_INK_MM`);
  `annotationClipboard.ts` (the same-step paste); `annotationActions.ts` (Flip
  named for this kind); `applyAnnotationEdit.ts`;
  `useStepAnnotations.ts`; `annotationEventKind.ts`.
- `cp-workspace/references/referenceFinderDiagramToPrimitives.ts` (the
  primitive), `stepDiagramGeometry.ts` (`divisionsShape`, `divisionsDrawn`,
  `divisionsPathData`), `diagram/diagramInk.ts` (`DIAGRAM_DIVISIONS_INK`),
  `diagram/DiagramPrimitives.tsx`, `diagram/markReach.ts`,
  `referenceFinderStepInModel.ts`, `fold/foldSymbolFade.ts`.
- Components: `components/diagram/DiagramAnnotateCanvas.tsx` and its module
  (`DivisionsSelection`, the hairline), `DiagramAnnotateToolGlyph.tsx`, new
  `DiagramDivisionsControls.tsx` and `DiagramTicksRow.tsx`,
  `DiagramLayers.tsx`; `components/ui/NumberField.tsx`,
  `components/ui/fieldRows/NumberRow.tsx` and `TextAreaRow.tsx` (`fieldRef`,
  select on focus) with the new `useFieldFocusRequest` hook.
- Keys: `keyboard/shortcuts.ts`, `diagram/actions/diagramShortcuts.ts`,
  `i18n/shortcutLabels.ts`.
- New golden: `diagram/annotate/divisions.cases.ts`, `divisions.test.ts`,
  `__fixtures__/divisionsGolden.json`.

**The right-angle mark.**

- `cp-workspace/references/diagram/diagramInk.ts` (`DIAGRAM_RIGHT_ANGLE_INK`),
  `stepDiagramGeometry.ts` and its test, `diagram/DiagramPrimitives.tsx`,
  `diagram/markReach.ts`.
- `diagram/annotate/annotationHit.ts` and its test, `rightAngles.ts`,
  `rightAnglePlacement.ts` and their tests, `useAnnotateCanvas.ts` (hover and
  click preview), `annotateTools.ts` (`cornerFreeKey`),
  `paintAnnotations.test.ts`.
- `components/diagram/DiagramAnnotateCanvas.tsx` and its test (Selection,
  `RightAngleGhost`, the hairline), `DiagramAnnotateToolGlyph.tsx`,
  `DiagramAnnotateToolWindow.test.tsx`.
- Goldens re-recorded: `diagram/annotate/__fixtures__/rightAngleGolden.json`
  with `rightAngleMarks.test.ts`, and
  `cp-workspace/references/__fixtures__/referencesRightAnglesGolden.json`.
- Stale doc comments: `annotationPrimitives.tsx:17`,
  `referenceFinderDiagramToPrimitives.ts:181`, `annotationModel.ts`'s corner
  carry, `DiagramAnnotateToolGlyph.tsx:83` and `:180`,
  `DiagramAnnotateCanvas.tsx:394`, `diagramInk.ts:118-125`,
  `DiagramPrimitives.tsx:897`.

**All three.** `analytics/events.ts`, `docs/analytics.md`, `public/locales/*`
(nine catalogs); `implementation-plans/diagram-workspace.md` (D2, D8, D10,
D22, the Later list, Phase 16) and `implementation-plans/diagram-annotate.md`
(decision 11 and 14e superseded). The three parts share `annotateTools.ts`,
`annotationHit.ts`, `DiagramAnnotateCanvas.tsx`,
`DiagramAnnotateToolGlyph.tsx`, `DiagramPrimitives.tsx`, `markReach.ts`,
`stepDiagramGeometry.ts`, `diagramInk.ts`, `diagramFile.ts` and the catalogs,
so their phases land one at a time, each rebased on the last.

## Checklist

**Every phase**, as the second pass's
(`diagram-annotate-second-pass.md:286-296`): reader and writer with round
trips and "an older build keeps it verbatim"; `cleanAnnotation`; carry; hit
and grips; the canvas; the Layers or Step pane; the tool window; the rail,
keys and shortcut labels; analytics with `docs/analytics.md`; i18n in all nine
catalogs; unit and canvas tests, each failing before its change; a golden for
each new primitive; new components styled by their own CSS modules, and
changed ones in theirs (every Diagram component this plan touches already
has one: `DiagramAnnotateCanvas`, `DiagramLayers`, `DiagramStepCard`,
`DiagramStepsGrid`, `DiagramPagesView`, `DiagramPoseStage`,
`DiagramLinkedPoseControls`, `DiagramExportOptions`, `DiagramStepDetail`), no
rule added to a shared block. Then before and after in the browser, light and
dark, desktop Chromium and iPad-sized WebKit, beside the image it answers,
each fix shown on its own with its confidence and evidence; the crane loading
with every mark known and every step saving back byte-identical; a review of
the phase; the gate (lint, typecheck, i18n check, the whole vitest suite) and
a push.
The builder owns every gate, the browser's included, and shares the proof
with Zach. What was built is written under each phase's checklist, as in
Phase 15. Each phase is built to the decisions recorded here: the
enlarged steps' Z1–Z10, and for 16a and 16b Zach's answers to RA0–RA8 and
ED1–ED13 (2026-10-06, each the recommendation, so the items below stand as
written).

**Order.** 16.0, the enlarged-steps spike, comes first, before 16c–16g. 16a
and 16b need only their own decisions, not the spike, and can land before or
alongside 16c–16g; 16a first, as it changes no file. 16c's key-set commit
lands before anything writes `zoom` or `paperFaces`.

### 16.0 The enlarged-steps spike (nothing merges)

Face-anchored imprinting, measured on the crane before any of it is built.

**Result, 2026-10-06: FAIL.** With no spread the imprint is exact on every
refold, within 0.01% of the frame. With a spread it passes whenever S and N
hold the same face still. It fails when N's fold holds another face still and
a spread is on: under the default affine spread, by 5.46% on refold C and by
4.80% on the crane's own 21 → 22; under the depth spread, by 2.44% on refold C
shown in S's pose. Zach decided on 2026-10-06 to land in two stages, which
every case passes, within 1.36%; the rest of the design is unchanged. See
"For Zach" below the checklist, and the last item for what it costs the file.

Everything the spike ran is under `artifacts/revision-2/spike/` (gitignored),
on the dev server's own modules. Nothing under `apps/` or `crates/` changed.
Two helpers that the app does not export, `placement` (foldedFlatScene.ts) and
`piecesUnder` (behindFlaps.ts), were reached by importing the dev server's
module again as a blob with one extra `export` line, so the code that ran is
the app's own. The scripts:

- `spike.mjs`, with `common.mjs`, `pageHelpers.mjs` and `geom.mjs`, writes
  `spike-results.json` and `spike-captures.json`;
- `summary.mjs` prints the tables below;
- `sizes.mjs`, `orientation.py`, `cut.mjs` and `figures.mjs` cover the other
  items;
- after the decision, `twoStageExact.mjs` lands in two stages from stored
  data alone, and `twoStageSizes.mjs` weighs `paperFaces` in the crane's file.

The crane has no step 55. S is its step 22, the last, in its linked pose
(front, 157.5°, case 13).

- [x] A spike branch of `flatPicture` that keeps `paperFaces`. Capture the
  crane's 55 with it; draw an area round the head; mark one point of the head
  on the paper to measure against.
  *As built:* `spikeFlatPicture` (`common.mjs`) calls the app's
  `flatPicture` unchanged and builds `paperFaces` from the same kernel scene.
  For each kernel face, hidden ones included, it keeps three things:
  - its corners on the paper, `sheet_points` about their box's centre;
  - the same corners through the painter's own `placement`;
  - its `layerLevels` level over `foldedPaintOrder`.

  Both rings are rounded to the stored step. Recaptured through the branch,
  17 of the crane's 18 flat steps write a `sceneJson` byte-identical to the
  file's. Step 9 cannot be refolded today (see the note at the end).

  The area is a circle round the head. The head is the right-hand flap,
  which step 21 raises ("Repeat step 20 on the right side") and the refold
  below folds. The circle is centred on the flap's axis, 0.34 of the way down
  from the tip, with a radius of 0.4 of the flap: 116 px, on a model about
  305 px across. The marked head point is the paper under the circle's
  centre, on the face drawn on top there: face 42, the neck's top layer. The
  refold below leaves that paper where it is.
- [x] Refold to a 57 three ways: by editing 55's sheet; on the next sheet;
  and one whose capture's fold holds a different face still (`openFold` folds
  from face 1, `lib/creaseExportFold.ts:333`, which lands elsewhere on a
  changed sheet). Imprint the area through its default anchor and land it on
  each, as `zoomImprint` will. Measure on each the landed frame's centre
  against where the marked head point lands, as a share of the frame's size,
  with no spread, the default affine spread and a depth spread. Pass: under
  2%. If it fails, the result goes to Zach, with the rejected anchor rules'
  results beside it, before 16c starts.
  *As built:* the crane has no head fold, so the spike builds one: an outside
  reverse fold of the neck's tip (`pageHelpers.headFold`).
  - **The fold line** crosses the neck 0.3 of the way from the tip, at 55° to
    the flap's axis.
  - **The creases** are carried onto the sheet through each neck layer's own
    map. The layers above the flap's middle fold one way and those below fold
    the other. The spine flips beyond the line.
  - **The kernel solves it**, with 52 faces. An inside reverse fold along the
    same line has no layer order (Contradiction). Mirrored, it solves, but the
    head points into the wings.

  It was made in the store with the store's own verbs,
  `insertOristudioCpLineSegments` and `replaceOristudioCpLineSegments`, as
  three refolds:
  - **A**: step 22's sheet edited in place.
  - **B**: a copy of that sheet 500 units below it, with the fold on the copy.
  - **C**: B's sheet folded from face 18 instead of face 1, as a renumbered
    face 1 would fold it. Face 18 shows its back in face 1's fold, so the
    model comes out turned over. It is shown in S's pose.
  - **C posed**: C as an author would pose it to match S, back at 225°.

  Each refold uses the fold case whose layer order agrees with S's over the
  faces both have: case 9 for A and B, case 5 for C. A and B hold the same
  face still as S, and C, by construction, does not.

  Beside them, **R** is the crane's own 21 → 22:
  - the area is round the tail, which step 20 raises, on step 21;
  - it lands on step 22 as linked, on the next sheet, in 22's own pose
    (21 is back at 315°, 22 front at 157.5°);
  - the two folds hold different faces still, with no help from the spike:
    21's face 1 is not 22's.

  Every pair is measured three ways, the same on S and on N: no spread, the
  default affine spread (3%, top, skew 1, 81°) and the default depth spread
  (2.5%, down). Imprinting and landing work as `zoomImprint` will (`geom.mjs`):
  - each face is placed by the least-squares similarity, reflected when its
    affine fit is;
  - the anchor's paper point is the face's pole of inaccessibility;
  - on N, that point is held by the face that contains it, the lower index on
    a crease.

  The truth is where N's own painter draws the marked paper. The share is the
  landed centre's distance from it over the frame's diameter:

  | Refold | No spread | Default affine | Depth |
  | --- | --- | --- | --- |
  | A: S's sheet edited | 0.009% | 0.004% | 0.565% |
  | B: the next sheet | 0.005% | 0.002% | 0.561% |
  | C: another face still, S's pose | 0.005% | **5.458%** | **2.436%** |
  | C posed like S | 0.008% | **5.458%** | 0.591% |
  | R: the crane's 21 → 22 | 0.001% | **4.804%** | 0.064% |

  The frame does not jump; it drifts: by 12.4 px on C and 11.0 px on R,
  against a 116 px radius. To pass at that drift, a frame's radius would have
  to be 311 px on C or 276 px on R, about the size of the whole model (305 to
  333 px). Any head-sized frame fails there.

  The cause is the affine spread. It holds still the face on top "as the
  front sees it", and which paper that is depends on which face the fold
  holds still. By the middle of its paper, the held face is (52.5, −173.6) on
  S, A, B and step 22, (−52.5, 173.6) on C, and (−67.6, 176.6) on step 21. So S
  and N spread the model differently, and the body (the anchor) and the head
  move apart by different amounts.

  Posing C like S does not change the held face: C posed fails by the same
  5.458%. The depth spread fails only on C left unposed (2.44%), where the
  screen's "down" meets a turned-over model; posed like S, C passes at 0.59%.

  Copied in picture units, as an older capture is, C lands 43–52% off. On
  every refold whose fold changed, the imprint is what places the frame.
  Images: `imprint-head.png` (S, then A, B, C and C posed, by spread, with
  every landing drawn) and `imprint-tail.png` (R).
- [x] The default anchor on those captures: which face it picks (expected:
  the body's back layer), and the largest face and the face under the centre
  beside it, to show why they were not taken.
  *As built:* the default anchor is the body's back layer, as expected.
  - **Step 22**: face 33, the lower rear of the body, at level 23, the
    deepest. Under the depth spread its symmetric twin, face 14, is taken
    instead.
  - **Step 21**: face 30, also at level 23.

  The two rules not taken, measured on the same captures:
  - **The largest face** (19, a wing layer; on step 21, face 11). It lands
    within 0.002% unspread. Under the affine spread it is worse than the
    default: 10.16% on C and 4.36% on R. Under the depth spread on C it lands
    at 1.59%.
  - **The face under the centre** (42). It lands within 0.10% in every row,
    but only because the marked point lies on that face. Take instead an area
    centred on the head itself, above the fold line (0.12 of the flap, radius
    0.22), anchored by the paper under its centre: it follows the folded head
    and lands 67% off on A, B and C. The default and the largest face stay
    within 0.02% there. Anchored by its own pole, the face under the centre
    lands at 0.00%, but only because the pole of the uncut neck triangle lies
    below the fold line.

  A finding for 16c: faces 33 and 14 tie on level, and their picture areas
  differ only by rounding: 2706.41540 against 2706.41540, and 2625.954
  against 2625.950 under the depth spread. An affine spread changes those
  areas by 5%. Their paper areas are equal, 1252.5035 each. So the tie should
  be broken on the paper's area, with a relative tolerance, then by the lower
  index.
- [x] A circle under the default affine spread: the landed frame against the
  circle's paper carried point by point through its face's affine move (how
  far the similarity departs).
  *As built:* carried through the landing face's own affine map instead of
  the similarity, the circle's points move by up to 11.0 px. That is 4.7% of
  the frame's diameter on A and B, and 4.8% on R:
  - 2.7% is the centre moving;
  - 1.9% is the circle turning into an ellipse, whose axes are 1.038 and 0.976
    of the similarity's scale.

  When S and N spread alike, the same face is fitted alike on both, and the
  error cancels between imprint and land: A and B land at 0.004%. The drift on
  C and R comes from the held face, above, not from the fit. Under the depth
  spread the same comparison gives 1.3–1.5%.
- [x] `paperFaces` in bytes beside `sceneJson` on the crane's flat steps. If
  it is more than half as large, 16c stores the shared-points form (Risks).
  *As built:* in the per-face form (two rings and a level), `paperFaces` is
  0.42 to 1.14 times `sceneJson` on the 17 refoldable flat steps: 82.9 kB
  against 83.2 kB in all. It is more than half on 16 of the 17, so **16c
  stores the shared-points form**:
  - each wireframe point once, as its paper x and y and its picture x and y;
  - each face as indices into those points, with its level.

  That form is 0.24 to 0.43 times `sceneJson`, 31.2 kB in all (0.38). It loses
  nothing at the stored step: where two faces name one point, they place it
  within 0.007 px of each other. Per step: `sizes.json`. After the decision
  the picture places are the unspread ones, and the form is weighed as the
  file writes it: the last item.
- [x] Whether the crane's stage sheets keep one orientation in Edit (Risks).
  *As built:* yes. Each stage sheet's creases, about its box's centre, were
  compared with the previous stage's under the square's eight symmetries,
  counting a crease only where a line of its own colour lies on it. At all 15
  transitions, from step 5 to step 22, the identity matches best. The half
  turn and the diagonal mirrors tie with it only where the crane's creases
  are symmetric, and there a copy turned by them would hold the same creases,
  so it would fold the same. Run with `orientation.py`; the output is in
  `orientation.txt`.
- [x] Cut pieces from `piecesUnder` on a flat fold and on a crease pattern,
  compared with look 1's arc (its span and overshoot).
  *As built:* `piecesUnder` runs over a flat fold's `layers.covers` and over a
  crease pattern's sheet ring. Each case gives one clean arc, unbroken where
  the circle crosses face seams:
  - the head frame landed on B: 134.6° over paper (the wing and the neck),
    drawn as 157.5° with 0.2 r past each end;
  - a head-sized circle (radius 0.22 of the flap) on B: 35.9° over paper,
    58.8° drawn;
  - step 3's crease pattern, with a circle round its top corner: 134.3° over
    the sheet.

  Look 1 was measured from Zach's image by fitting a circle to its arc:
  radius about 294 px, no point more than 1.9 px off the fit. It is one arc,
  about 33° over paper and 61° drawn, running about 0.24 r and 0.26 r past
  its crossings: a little more than the plan's 0.2 r. Images: `cut.png`;
  data: `cut.json`.
- [x] The results, with images, written here under this phase.
- [x] After Zach's decision: two-stage landing as 16c will do it, from what a
  step stores, and what it costs the file.
  *As built:* `twoStageExact.mjs` lands every case above in two stages from
  the spike's stored rings alone, with no kernel and no spread code. Off S's
  spread by solving the face's mean value coordinates (Newton; residual at
  most 1.3e-12 px); imprint and land unspread; onto N's spread by the face on
  top under the landed centre. Beside it, the last stage by B's move instead:

  | Refold, spread | One stage (above) | Two stages | Two stages, by B's move |
  | --- | --- | --- | --- |
  | A, affine | 0.004% | 0.513% | 5.202% |
  | B, affine | 0.002% | 0.511% | 5.212% |
  | C, affine | **5.458%** | 0.263% | 5.215% |
  | C posed, affine | **5.458%** | 0.513% | 5.224% |
  | R, affine | **4.804%** | 0.002% | 5.030% |
  | A, depth | 0.565% | 1.362% | 2.063% |
  | B, depth | 0.561% | 1.356% | 2.063% |
  | C, depth | **2.436%** | 0.549% | 1.503% |
  | C posed, depth | 0.591% | 1.335% | 2.020% |
  | R, depth | 0.064% | 0.002% | 2.446% |

  With no spread both stages are the identity, and every row lands as above
  (at most 0.009%). Solved rather than fitted, the two stages land where the
  first, fitted measurement put them, to 0.002%: the 1.36% is not the
  inversion, as was first thought. It is the layer followed. On A, B and C
  the refold lays another layer over the marked paper (face 39, under 41 on
  A and B and under 40 on C), and the frame follows the layer on top under
  its centre, which the spread moves a little apart from the covered one. On
  R the marked paper stays on top, and the frame lands within 0.002%. Where S
  and N hold the same face still, one stage was exact under the affine spread
  and two stages land at 0.51%, still a pass. Following B lands as badly as
  one stage, so the frame follows the face under its centre.

  `twoStageSizes.mjs` then recaptured the crane's 17 refoldable flat steps
  through the app's own modules, each with its own render and its own affine
  spread (every flat step of the crane has one), and wrote `paperFaces` into
  the file as `serializeNativeProjectFile` writes it, pretty-printed:

  | 17 flat steps | Bytes in the file | The `.osf`, 2,488,783 B today |
  | --- | --- | --- |
  | `sceneJson`, for scale | 93,887 | — |
  | 16.0's form: paper and drawn places, a string | 33,582 | +33,718 B, +1.35% |
  | The same plus the unspread places, a string | 40,633 | +40,769 B, +1.64% |
  | **Chosen**: paper and unspread places, paper to 0.001, rings and levels as arrays, a string | 20,473 | +20,609 B, **+0.83%** |
  | The chosen form as a JSON value | 79,376 | +126,136 B, +5.07% |

  The chosen form is 0.16–0.26 of each step's `sceneJson`, 0.22 in all, and
  5.9% of the crane's 347 kB diagram; the rest of the file is its crease
  pattern. Step 9 is left out, as above; at its neighbours' ratio it would
  add about 0.4 kB. On the heart (`heart.osf`, 8 flat steps, each with an
  affine spread) it adds 8,367 B, +0.67%, 0.06–0.22 a step; its stored scenes
  differ from what a recapture draws today, so there it weighs fresh
  captures beside them. Three checks behind the choice:
  - **The drawn places are already stored.** With a spread on, every face is
    whole in the stored scene, one ring, corner for corner, equal bit for bit
    to what 16.0's form would store: on all 17 crane steps and on all 14 of
    16.0's spread captures. With no spread, they are the unspread places.
  - **Recomputing is possible, and not chosen.** 16.0's form gives the
    unspread places back by inverting the affine spread, to 0.0068 px over
    all 17 steps, given the face the spread holds still: one more number,
    which takes the kernel's subfaces to find. The depth spread would also
    need the model's unspread size. Either reads a stored snapshot through
    whichever build's spread code, and neither is needed.
  - **Each point once stays lossless** with the unspread places: the faces
    naming a point place it identically.

  Data: `twoStageExact.json`, `twoStageSizes-crane.json`,
  `twoStageSizes-heart.json`.

**For Zach: the failure. DECIDED, 2026-10-06: land in two stages.** Zach:
"Land in two stages sounds good, assuming file size doesn't get huge. And
they can always move it if its wrong." The failure: when a capture's fold
holds another face still than its source's and a spread is on, a frame landed
in one stage through the backmost face drifts by about 5% of its diameter
under the default affine spread, about 3.5 mm on a frame printed at Fill's
64 mm. The crane's own 21 → 22 does it.

1. **Keep the design and accept the drift.** Not taken.
2. **Land in two stages.** Taken: imprint and land on the unspread pictures,
   then let the frame follow the spread by its centre, as "Capturing a frame"
   now describes. Every measured case lands within 1.36% (the item above).
   `paperFaces` keeps each point's unspread place instead of its drawn one,
   which the stored scene already holds, so two stages cost no more than
   16.0's form: +0.83% on the crane's file, within the budget set in "Model
   and file format". "They can always move it": the frame's hand move (Z10)
   is unchanged.

**Before 16c starts:**
- store `paperFaces` in the chosen form: each point's paper and unspread
  places, the faces' rings and levels, as a string;
- break the anchor's level tie on paper area, within 0.1%, then by the lower
  face index;
- use R (21 → 22) and C as the "different face still" fixtures that the
  `zoomImprint` tests name; under a spread, they pass only with the
  two-stage landing.

*A note:* crane step 9 ("Repeat steps 5-8 behind") cannot be refolded
today. The app's own Refresh of it fails in the kernel with
`WorkerOverlap(Setup(InitialHierarchy(SameParityAdjacentFaces { line: 10,
first_face: 5, second_face: 6 })))`. That is not the spike's doing, and it is
left out of the sizes above.

### Before 16a and 16b: the marks' decisions (nothing merges)

**DECIDED, 2026-10-06.** Zach: "oh yeah they look good", to the
recommendations.

- [x] The marks prototype shows what each decision names. Checked on
  2026-10-05: present are ED4's offsets of 2.5, 1 and 0 mm and ED9's pens on
  white, grey and the sketch's paper; ED10's 32 parts with an edge-size
  slider; ED11's two kinds of tick side by side; ED12's pasted copy; RA0's
  closed-square control and the black-tick question; RA2's angle-on-the-page
  slider; RA4's 5 and 4 mm flaps; RA5's layered-edge cell; RA6's hairline at
  100% and 300%; RA7's three icons. Missing: RA4's pictures printed at 40 and
  54 mm. Add it before Zach is asked, or drop the claim from RA4.
  *As it went:* the 40 and 54 mm pictures were never added. RA4 now says so,
  and that it was decided without them.
- [x] The prototype and this plan agree on every decision's options and
  recommendation (checked 2026-10-05; the plan follows the prototype's
  numbering, ED9's option C and RA5's recommendation).
- [x] Zach tries the marks prototype and answers ED1–ED13 and RA0–RA8 (its
  "Copy picks" text names them by number). His answers are recorded under
  each part's decisions, and every passage marked with a decision he did not
  take is rewritten to his answer.
  *As it went:* he took every recommendation: ED1–ED13 all A except ED9 B and
  ED10 B, and RA0–RA8 all A. For RA0's black tick: the fold line's overshoot,
  not part of the mark. No passage needed rewriting; each decision is marked
  DECIDED in its part.

### 16a The right-angle mark

**Built 2026-10-06, commit 83fe37d37**, to RA0–RA8 all A. The sketch's short
black tick past the edge is the fold line's overshoot, so the mark draws
nothing past the edge.

- [x] Geometry: `DIAGRAM_RIGHT_ANGLE_INK {inset, side, leg}`,
  `rightAngleShape`, `rightAngleDrawn`, `rightAnglePathData`,
  `rightAngleReach`. `stepDiagramGeometry.test.ts`, replacing the cases at
  about l.1104-1139: the inner corner inset·√2 along the diagonal; each leg
  parallel to its line, `leg` long, running past the square; the far corner
  (inset + side)·√2 out; the square's far sides ending on the legs; a diagonal
  turned 0.3 rad; a mirrored projector; null with no diagonal; reach per
  point; two subpaths.
  *As built:* `DIAGRAM_RIGHT_ANGLE_INK = { inset: 4, side: 7, leg: 11 }`
  (`diagramInk.ts`): the ∟'s corner 1.3 mm in from each line, the square 2.3
  mm a side, the legs ending 15 ink (5 mm) out, an angle mark's radius.
  - `rightAngleShape(vertex, diagonal, size)` returns
    `{ legs: [endA, inner, endB], square: [onA, far, onB] }`: the inner corner
    inset·(a + b) from the vertex, the legs from it to leg·a and leg·b, the
    square's far sides ending on the legs; a and b are the diagonal turned 45°
    anticlockwise and clockwise on the page.
  - `rightAngleDrawn(at, toward, project)` sizes it by `project.ink` and
    measures the diagonal after projecting, so the mark mirrors with the
    paper. Null with no diagonal.
  - `rightAnglePathData` writes `M endA L inner L endB M onA L far L onB`.
  - `rightAngleReach(pen)` returns `{ legs, square }`: pen/2 at the four butt
    ends, √2·pen/2 at the two mitred corners. `rightAngleSquare` is gone.
  - Tests: `stepDiagramGeometry.test.ts`, "a right-angle mark (Revision 2)".
- [x] Drawing: the right-angle case in `DiagramPrimitives.tsx`; six points in
  `markReach.ts`; `paintAnnotations.test.ts`'s shape regex, bounds and
  reach-at-any-pen model rewritten.
  *As built:* one path in the ring pen and `ink.mark`, butt caps and
  `stroke-linejoin="miter"`, through `onAndOffPaper`. `markReach.ts` takes all
  six points. `paintAnnotations.test.ts` reads both subpaths and builds the
  reach from first principles.
- [x] Placement: the footprint search in `rightAngles.ts` and
  `rightAnglePlacement.ts`; the canvas's hover and click preview. Tests
  (`rightAngles.test.ts`, `rightAnglePlacement.test.ts`,
  `DiagramAnnotateCanvas.test.tsx`): hovering where the ghost is draws the
  same ghost; a click there marks that vertex; a press at the vertex still
  drags from the corner; ⌘ puts the vertex at the pointer.
  *As built:* nearest first, with no dead zone (this tool was its only user).
  - `rightAngleCorner(step, assets, point, radius, { footprint, ...snap })`
    asks every vertex within radius + footprint, nearest first, and returns
    the first whose sector holding the pointer is a right angle, else null.
    A nearer vertex with no right angle there never hides one that has it:
    the stacked flap corners 0.0075 either side of crane step 8's crossing
    (fixture `STACKED_CROSSING`, `pictureSnap.fixtures.ts`).
  - `footprint` is required. `deadZone`, `DEAD_ZONE_SHARE` and
    `nearestVertex` are gone, and the module doc is rewritten.
    `placeRightAngle` passes `RIGHT_ANGLE_FOOTPRINT`,
    (inset + side)·√2·`INK_UNITS`, about 0.103 of the frame;
    `useAnnotateCanvas` is unchanged.
  - Tests: the mark found from over it; a nearer vertex with none passed
    over; each quadrant at the crossing; a drag from the crossing squares;
    hovering over the mark draws the identical ghost.
  - Browser, crane step 8: a Chromium mouse 3 and 8 px into each quadrant,
    8 of 8 (HEAD 0 of 8); iPad finger taps at 6, 10 and 14 px, 3 of 3 (HEAD 0
    of 3). Hovering over the ghost draws the same ghost for 1,965 of the
    crane's 1,985 right-angle ghosts.
- [x] Hit and canvas: `rightAngleInPicture`, `rightAngleGrips` (direction on
  the far corner), `rightAngleDistance` (0 inside the square, Infinity nearer
  the vertex than the inner corner); the Selection and `RightAngleGhost` draw
  the path and, under RA6 A, the vertex hairline. `annotationHit.test.ts`
  (l.475-500, with 483-486 rewritten): inside the square; a miss at the
  vertex at the coarse reach and the fit zoom; a hit at a leg's far end; the
  grips.
  `DiagramAnnotateCanvas.test.tsx` (l.1397-1546; 1427-1434 reads a path, not a
  polyline): ghost and selection markup; the far-corner grip turns the mark;
  the corner grip moves and squares it; with a valley line ending at the
  vertex and nothing selected, a press at the vertex selects the line.
  *As built:* `rightAngleInPicture` replaces `rightAngleLegs`.
  `rightAngleDistance` is Infinity when |P − V| < |P − I|, I the ∟'s corner:
  the perpendicular bisector, which never cuts ink. It is 0 inside the closed
  square, and otherwise the distance to the nearer stroke. The `direction`
  grip is on the square's far corner; `corner` stays on the vertex. The
  Selection and `RightAngleGhost` draw the path and the RA6 tie (`.cornerTie`
  in `DiagramAnnotateCanvas.module.css`), its `strokeWidth` 1/zoom set on the
  element, because `vector-effect` does not undo react-zoom-pan-pinch's CSS
  transform: measured 0.99 px at 47% and 1.00 px at 1200%, in Chromium and
  WebKit. The tie also shows on a selected mark in a read-only diagram.
- [x] The glyph (RA7); under RA8 A, `cornerFreeKey` reworded in nine
  catalogs and in `DiagramAnnotateToolWindow.test.tsx:131-135`; the stale doc
  comments.
  *As built:* RA7 A: hairline lines with the inset ∟ and its square, its
  paths carrying `data-glyph-part` (`DiagramAnnotateToolGlyph.test.tsx`,
  new). RA8 A: `cornerFreeKey` reads "Hold {{modifier}} to put the corner it
  marks down anywhere, without snapping." in all nine catalogs, extracted,
  translated and stamped; the i18n check passes.
- [x] Goldens re-recorded and checked by eye beside the sketch:
  `rightAngleGolden.json` (frame-corner, up-right, turned, off-picture,
  at-reach; card, page, canvas) and `referencesRightAnglesGolden.json` (front
  and back).
  *As built:* as written: 5 cases × card, page and canvas, and References
  front and back.
- [x] `diagram-annotate.md`: decision 11 and the 14e as-built marked
  superseded by this section.
- [x] Browser, before and after: a box_90 capture; a References step, front
  and back; an upload with lines drawn on it; a 45° flap whose fold meets its
  edge, beside the sketch; a 3D capture, a simulated capture, a photo upload
  with a perspective corner, and a mark carried through an affine spread, each
  beside today's look; the crane, its right angles redrawn, saved and diffed
  identical, and its pages and a PDF at 300 dpi compared before and after for
  reflow.
  *As built:*
  - The verify pass (`artifacts/revision-2/16a/verify/`; composite
    `artifacts/revision-2/16a/16a-before-after.png`), BEFORE being HEAD's 14
    changed sources routed into a private browser on :5291: crane step 8's
    45° flap corner and its centre crossing, at print size (96 dpi) and ×3
    (288 dpi) from each build's PDF, beside the sketch; the canvas plain and
    selected in Chromium light and dark and in WebKit iPad 1024×1366 light
    and dark; the rail glyph before and after.
  - The fixer (`artifacts/revision-2/16a/fix/index.html`), on the canvas at
    fit and on each card: box_90's crease pattern and its 3D capture; the
    crane's crease pattern; References front and back; an upload with lines
    drawn on it; the 45° flap beside the sketch; the crane's simulated
    capture; a synthetic perspective photo; an affine spread carry (skewed in
    Chromium only). RA2's trade-off shows as this plan says: on projected
    pictures the legs float off the lines or cross face edges.
  - Existing diagrams: a crane saved by HEAD with 8 marks (3 opening off the
    picture) loads in this build with all 8 and writes back byte-identical
    (sha256 3a2de540…). PDF pages 2 and 3 are pixel-identical; page 1
    changes only at the marks, and at step 3, whose mark opens off the top:
    that picture sits 2.0 mm lower. The fixer's Pages check agrees: 26 cells
    identical but for one turn glyph 1.8 px lower. Zach's crane file itself
    holds no right-angle mark, so its own pages cannot reflow.
  - Where the proof differs from the item: the PDF was compared at 96 and 288
    dpi, not 300; and the flat-fold case is step 8's crossing and the 45°
    flap corner, not the vertex at (0.3514, 0.4969), whose right angles come
    from a hidden layer edge.
- [x] Analytics (added as built): no new event. `diagram annotation added
  {tool: right_angle}` stands, and a click on the mark shown counts as
  `snap: snapped`; one clause added to its row in `docs/analytics.md`.
- [x] Proof and gate (added as built): the implementer's 30 tests fail on
  HEAD's sources, and 11 of 11 mutants are caught; the fixer's step-8 and tie
  tests fail on the reviewed code. At the commit, 838 files and 11,082 tests
  pass (2 files and 13 tests skipped); lint, tsc and the i18n check are
  clean.
- [x] Zach's ink review (2026-10-06, RA1 and RA5 revised): half the size,
  `{ inset: 2, side: 3.5, leg: 5.5 }`, in the aux lines' pen
  (`rightAnglePen`). The goldens (`rightAngleGolden.json`,
  `referencesRightAnglesGolden.json`) re-recorded and checked by eye; the
  crane's step 8 at print size and ×3 beside its aux lines, before and after:
  `artifacts/revision-2/review-ink/right-angle.png`.

### 16b Equal divisions

**Built 2026-10-06, commit 650bc8871**, to ED1–ED13: all A, except ED9 B and
ED10 B. Implemented, reviewed (code and print), fixed and verified.

- [x] Model: kind `divisions`; `parts`, `offset`, `numbered`; `mirrored` and
  `ticks` reused (`DiagramTicks`); the shape; defaults; clean; degenerate; the
  exhaustive switches; `hasTicks`; `withSide`. `annotationModel.test.ts`:
  laying one (4 parts, 2.5 mm, the side away from the middle on each edge of a
  square and on a line through it); clean and degenerate cases; the
  `carriesText` and behind lists.
  *As built:* its own `AnnotationShape`, `divisions`, kept out of
  `LINE_KINDS`; after `angle-mark` in `ANNOTATION_KINDS` and on the rail.
  - Fields: `parts` (`DIVISIONS_PARTS` 2–32, laid at 4); `offset`
    (`DIVISIONS_OFFSET_MM` 0–15, laid at 2.5, step 0.5, kept to 0.1);
    `numbered?: true`; `mirrored?: true` and `ticks` reused, with
    `DiagramAngleTicks` renamed `DiagramTicks`.
  - Helpers: `withSide` (was `withPleatSide`), `hasTicks`, `divisionsParts`,
    `divisionsOffsetWithin`, `withParts`, `withDivisionsOffset`,
    `withNumbered`.
  - The default side, `divisionsAwayFromMiddle`, lives in
    `annotationModel.ts` beside `createAnnotation`, not in
    `divisionsPlacement.ts` as the Placing item says, to avoid an import
    cycle.
  - `cleanDivisions` holds the offset to its range, never rounds it, and
    drops bad ticks. `isDegenerate` checks the length; `flipsArc` is true;
    `flipCentre` is the middle of the measured line.
- [x] File: required fields; newer builds' (`parts` 33, `offset` 16, an
  unknown field, `behind`); damage (`parts` 1 or 2.5, `offset` −1); round
  trips, the every-kind round trip included; an older build keeping it
  verbatim; the crane written back unchanged.
  *As built:* `ANNOTATION_FIELDS.divisions` = `parts`, `offset`, `mirrored`,
  `ticks`, `numbered`; `parts` and `offset` required. Kept verbatim as a newer
  build's: `parts` over 32, `offset` over 15, `ticks` over 3, any unknown
  field, `behind`. Dropped as damage: `parts` under 2 or not whole; `offset`
  negative or not a number; either missing; a `numbered` or `mirrored` that
  is not a boolean. A build that knows no such kind keeps it verbatim. The
  crane writes back identical.
- [x] Drawing: `DIAGRAM_DIVISIONS_INK` (overshoot 5, tick 3, spacing 2, lean
  20°, number 7.2, gap 2, the tick floors, as ED9–ED11 settle them) and
  `ANNOTATION_INK_MM`; `divisionsShape`, `divisionsDrawn`,
  `divisionsPathData`; the primitive in `DiagramPrimitives` (`canLeavePaper`
  true), `markReach`, `diagramInModel`, `symbolAnchor`; the compile (mm to
  ink); the number through `setText` in `INLINE_LABEL_FONT` 700. Tests:
  dividers at i/N; the straddle rule at offsets 0, 1 and 2.5 mm; the tick lean
  unchanged when `from` and `to` swap and under a mirror; ticks shrinking to
  the floor and the warning past it, at 32 parts on 25 mm; the number's place
  on level and upright lines; `paintAnnotations.test.ts`'s reach-against-ink
  table, the number's box at both style pens; `diagramInk.test.ts` pins.
  *As built:* `DIAGRAM_DIVISIONS_INK = {overshoot 5, tick 3, spacing 2,
  leanDeg 20, tickFloor 1.5, spacingFloor 2, number 7.2, gap 2, pens {line:
  'crease', marks: 'ring'}}`, the pens typed `DivisionsPen` (ED9 B).
  `divisionsDrawn` takes each stroke's pen, and the crowding floor's, from
  that table, and so does the hit test. `ANNOTATION_INK_MM` (0.3307) and
  `mmInPictureUnits` are in `canvasInk.ts`. `stepDiagramGeometry.ts` has
  `divisionsShape`, `divisionsDrawn`, `divisionsPathData` (a `line` and a
  `marks` path) and `divisionsStrokes`.
  - Dividers run from the measured line to past the dimension line, as in
    the sketch.
  - The tick lean is decided on the page: the quarter turn clockwise of the
    line's rightward (or downward) direction, tipped 20°.
  - Ticks scale down to their floors on short parts (ED10 B); `crowded` is
    set when the half-tick or the spacing would go under its floor.
  - The count stands upright beside the line's middle, `gap` past the
    dividers, its box estimated at 0.62 em a digit and a half-height of 0.4
    em. It is `INLINE_LABEL_FONT` 700, and Noto Sans Bold on pages and in the
    PDF.
  - The primitive is in `DiagramPrimitives` (`canLeavePaper`; classes
    `step-diagram__divisions` and `step-diagram__divisions-number`).
    `markReach` covers every stroke's ends plus half its pen, and the count's
    box; `diagramInModel`'s side follows `reverses`; the `symbolAnchor` is
    the middle of the line.
  - The annotation projector now carries the style's aux pen as `crease`, so
    the line prints at 0.25 pt in the Diagram preset.
- [x] Golden: `divisions.cases.ts`, `divisions.test.ts`,
  `divisionsGolden.json`, on a card, a page and the canvas: the sketch; a left
  edge, mirrored; a diagonal in 3 with two ticks; offsets 0 and 1 mm; 7 parts,
  numbered; 32 parts on a short edge.
  *As built:* as written (`__fixtures__/divisionsGolden.json`), the cases
  named sketch, left-edge, diagonal, offset-0, offset-1, seven-numbered and
  crowded.
- [x] Tool: Marks after Equal Angles, key D, label, help and touch help,
  modifiers (⌘ `endsFreeKey`; Shift for the offset drag), the glyph (the
  template's |\|\| symbol), shortcut executor and label, the Select help's
  exception. Tests: `annotateTools.test.ts` (the Marks order, the tool window,
  D bound, plain T and R still unbound), `diagramShortcuts.test.ts`'s tool-key
  table (l.239), `DiagramAnnotateRail.test.tsx`.
  *As built:* Marks read Circle, Right Angle, Equal Angles, Equal Divisions,
  Close-Up. D is `diagram.toolDivisions`, with its shortcut label; the glyph
  is |\|\|. The help and touch help are as planned. The modifier lines are
  `endsFreeKey` and `divisionsShiftKey`, which reads "With Select, Shift-drag
  the mark to move its line by half millimetres." The Select help gains the
  drag-offset exception.
- [x] Placing (ED1 A): the drag with snapped ends; `nearestLine.ts`, moved
  out of `usePickTool` with collinear pieces joined, shared with Angle
  Bisector, and its hover highlight; `divisionsPlacement.ts` (the default
  side; the offset and side from a pointer, 0.1 mm, Shift 0.5 mm); a short
  release taken as a click; the tool notice for "no line here". Tests: the
  rim fixture's top edge taken whole; a flat fold with a covered face;
  `DiagramAnnotateToolWindow.test.tsx` for the notice; the bisector's tests
  unchanged.
  *As built:* a drag snaps both ends; ⌘/Ctrl puts an end down freely. A click
  takes `nearestLine(..., { whole: true })`, and a release past the slop but
  shorter than `MIN_ANNOTATION_LENGTH` counts as a click. `nearestLine.ts`,
  out of `usePickTool`, is shared with the Angle Bisector, which still takes
  only the piece; it joins collinear pieces that meet or overlap
  (`nearestLine.test.ts`: a crease pattern's rim, a flat fold's covered
  face's edge and a line drawn on an upload, each taken whole). On hover the
  line a click would take is drawn as a 3 px line in the full selection
  colour (`PickPreview.hoverTakes`, `[data-takes]`); the bisector keeps its
  30% wash. A click on no line shows a notice in the tool window
  (`pickProgress`: `setToolNotice`, `toolNotice`, `useToolNotice`), cleared
  on the next press, a tool change or a step change.
- [x] The count (ED5 A, ED13 A): `useFieldFocusRequest`; `fieldRef` on
  `NumberRow` and `NumberField`; contents selected on focus; the tool kept in
  hand. Tests:
  Parts takes the focus and Enter gives the keys back; typing 5 over 4 gives 5
  (jsdom, then WebKit in the browser check).
  *As built:* `labelFocus.ts` became `fieldFocus.ts` (`requestFieldFocus`,
  `takeFieldFocus`, `pendingFieldFocus`, `cancelFieldFocus`,
  `onFieldFocusRequest`; a field of `'text'` or `'parts'`).
  `useFieldFocusRequest` replaces `DiagramLayers`' inline effect and selects
  the contents when it takes a request; `NumberField` gains `inputRef`,
  `NumberRow` `fieldRef`. The hook takes the focus back, on the next frame,
  from a container that focused itself afterwards (the touch Settings
  sheet), which fixes labels in that sheet too. `DiagramDivisionsControls` is
  keyed by the mark's id, so a second mark laid in a row gets its own count
  to type over.
- [x] Snap: both ends; division points as targets, not on projected pictures
  (`annotateSnap.test.ts`, `pictureSnap.test.ts`).
  *As built:* `snapsWhenPlaced('divisions')` is true. The snap points are the
  ends and the division points, with no division points on projected (3D or
  simulated) pictures. Divisions are not in `drawnLines`.
- [x] Hit and grips: the `offset` grip part; `moved()` and `placeInHand`;
  `DivisionsSelection`. `annotationHit.test.ts` (the ink, the number, the
  ends, the offset grip); canvas tests: a drag with snapped ends; a click on
  an edge; dragging the mark sets the offset, and across the measured line
  flips the side; Shift holds halves.
  *As built:* the body is measured to the line, dividers and ticks, and is 0
  on the count's box; the measured line is never the mark's. The `offset`
  grip is a handle at the middle of the line (`divisionsOffsetGrip`).
  `draggedDivisions` moves the line square to the measured line, switching
  side when dragged across; the offset is kept to 0.1 mm, or 0.5 mm with
  Shift, and each drag is one undo step. `DivisionsSelection`: a wash along
  the ink and the count's box, a hairline along the measured line, end dots,
  and `data-handle="offset"`.
- [x] Carry, flips, copy: a mirror toggles the side and a spread carries the
  ends by their faces (`annotationCarry.test.ts`); Flip Horizontal, Vertical
  and F (`flipAnnotation.test.ts`; `annotationActions.test.ts`: Flip offered
  and named, a do-nothing Flip Horizontal held); the same-step paste as ED12
  settles it (`annotationClipboard.test.ts`); the side on a frame that turns
  the paper over (`referenceFinderStepInModel.test.ts`).
  *As built:* mirror, References turned over, a per-face spread, Flip
  Horizontal and Vertical, F, and a flipping frame in
  `referenceFinderStepInModel`. A mirror toggles `mirrored`; offset, parts,
  ticks and the count never change. One check, `divisionsAlikeEitherSide`
  (offset 0 and no count), is behind both F's hold (`flipChangesArc`) and
  `divisionsFootprint`, so Flip Horizontal and Vertical are held exactly
  where F is, and also along the mark's own level line. ED12 A: a paste on
  the same step stands 2.5 mm further out for each earlier paste, up to 15
  mm (`PASTE_DIVISIONS_OFFSET_MM`).
- [x] Layers: `DiagramDivisionsControls`, `DiagramTicksRow`, the crowding
  warning; the `useStepAnnotations` setters. `DiagramLayersPanel.test.tsx`:
  the rows, one undo step each.
  *As built:* `DiagramDivisionsControls`: Parts, Offset (mm, a literal
  suffix), Ticks, and Number with its help; Flip and Delete come from the
  shared rows. It has a CSS module of its own, with one rule for the
  warning's inset, where the Layers pane text above says none.
  `DiagramTicksRow` is extracted and shared with the equal-angle mark.
  - The crowding warning is judged at the printed frame: `DiagramPanel`
    publishes it (`printedFrames.ts`, `usePublishPrintedFrames`) and
    `useDivisionsCrowded` reads it. `printedFrameMm` (`pagePictures.ts`)
    falls back, for a cell with no scale, to the size the page fits the
    picture to (`fittedFrameMm` / `fittedSheetMm`, not counting the marks'
    small extra shrink), and to 50 mm before the pages are laid out.
  - `setParts`, `setDivisionsOffset` and `setNumbered`, and `setTicks`
    widened through `hasTicks`, are each one undo step, "Change equal
    divisions".
- [x] Analytics (`tool: divisions`, `snap`, `placed`) and `docs/analytics.md`
  (the tool list, the snap sentence, the flipped row); i18n in nine catalogs.
  *As built:* `tool: divisions` and the new optional `placed` (`drag`/`line`,
  type `DiagramDivisionsPlaced`), through
  `trackDiagramAnnotationAdded(tool, snap, placed)`. `docs/analytics.md`: the
  added and flipped rows (divisions flip about the middle of their line; F is
  not counted). 11 keys in all nine catalogs: `tools:diagram.toolDivisions`;
  `panels:diagram.annotate` `divisionsHelp`, `divisionsHelpTouch`,
  `divisionsNoLine`, `divisionsShiftKey`; `panels:diagram.annotations`
  `parts`, `offset`, `number`, `numberHelp`, `partsCrowded`; and
  `selectHelp`, reworded in place.
- [x] Browser, on a square step of the crane: D and a real drag along the top
  edge, 5 typed, a Line from the first division, set beside the sketch; a
  click on a crease pattern's edge after a book fold; the card, the page, and
  the PDF through `pdftoppm` at 600 dpi; light and dark; Chromium, and
  iPad-sized WebKit for the touch help and the focus.
  *As built:*
  - The implementer (`artifacts/revision-2/16b/browser.mjs`, `shots/`),
    Chromium 1440×900 light and dark: the crane read with no unknown
    annotation and written back identical; D, a real drag along step 1's top
    edge, 5 typed and Enter; a Line from the first division snapping to it;
    the handle dragged to 4 mm; on step 3's crease pattern, hover lighting
    the whole diamond edge, split by a crease at its middle, and a click
    dividing it whole; a click on no line showing the notice; the cards, the
    pages, and the PDF through `pdftoppm -r 600`. WebKit 1180×820 with touch:
    the touch help; a tap dividing the top edge whole; Parts taking the focus
    when the Settings sheet opens on Layers, and 5 with Enter giving 5.
  - The verify pass (`artifacts/revision-2/16b/verify/`, composite
    `16b-before-after.png`), on crane step 1's top edge: fifths at 6 mm with
    2 ticks and Number on; quarters at 2.5 mm with 1 tick; a valley from the
    first quarter. Shown: the PDF at print size and ×3 beside the sketch; the
    flow D → drag → 5 → Enter → rows in Chromium light and dark; the canvas
    plain and selected, and the card, in Chromium and in WebKit iPad
    1024×1366, light and dark; the touch flow through the Settings sheet; the
    Pages view. No console errors (WebKit with interception on; its COEP
    worker noise also shows on a bare load).
  - The gate on HEAD 3d6210133 plus 16b: 843 files and 11,160 tests passed.
  - Not tried on a real iPad, where a focus outside a user gesture may not
    raise the keyboard.
- [ ] For Zach, not changed:
  - ⌘Z straight after laying a mark is swallowed by the focused Parts field,
    as with labels; Escape or Enter first.
  - Crossed corners where two divided edges meet (ED4 A, ED9 B).

### 16c Enlarged steps: model, file, imprint

**Built 2026-10-06, commits 3fc2e4f36 (the key sets), cbcb60fe4 (the rest)
and ab3b6b26a (the writer of `paperFaces`, after Zach's answer on the
size budget, Z11)**, to Z1–Z11, the anchor rule and two-stage landing.
Implemented, reviewed, fixed and verified. Nothing draws an area or a frame
yet (16d), and no store verb reaches the pure modules yet (16e, 16g).

- [x] `STEP_KEYS` and `SCENE_PICTURE_KEYS`, a commit of its own, holding
  today's keys: an unknown step key or scene-picture key (`zoom` and
  `paperFaces` included, until the items below) locks the step, which writes
  back byte-equal; the crane loads with nothing locked and every step saves
  back byte-identical (since 95a516de1 the file differs in one place only,
  the page setup's `scale`, no longer written); the fixtures checked for
  stray keys first.
  *As built:* 3fc2e4f36, alone and first, as "Reading and writing" requires.
  `STEP_KEYS` is the eight keys `writeStep` writes; `SCENE_PICTURE_KEYS` is
  {kind, sceneJson, paperScale, styleKey, key}. Any other key locks the
  step, which is written back byte-equal. The crane, the heart, the chipmunk
  and Reference Diagrams open with nothing locked, and every step saves back
  byte-identical. In the app, on a crane with an area on step 19 and step 20
  enlarged from it (`artifacts/revision-2/16c/verify/app-head.json`,
  `app-keysets.json`): the build before 16c drops step 20's frame and both
  steps' faces; the same build with the key sets alone opens both steps
  locked and writes them back unchanged.
- [x] `paperFaces`, in the form chosen after 16.0: written by `flatPicture`
  (Link, Refresh, Pose) from the kernel's paper scene, hidden faces
  included, as a string of compact JSON holding each point's paper and
  unspread places (paper to the power of ten under the scene step over the
  scale, unspread to the scene step) and the faces' rings and levels
  (`layerLevels`); never the drawn places. `readPaperFaces` with its NEWER
  and damage cases, the scene cross-check among them; round trips;
  `paperFaces` added to `SCENE_PICTURE_KEYS`; the crane's existing steps
  unchanged until refreshed. Tests: with a spread on, every face's drawn ring
  read from the stored scene equals the painter's spread places; with none,
  the unspread places equal the scene's visible rings.
  *As built: the reader in cbcb60fe4, the writer in ab3b6b26a, on every
  flat step (Z11).*
  - The stored form: one compact JSON string; points `[paper x, paper y,
    unspread x, unspread y]`, rings, and levels from `layerLevels` over
    `foldedPaintOrder`. Paper places are rounded to 10^floor(log10(scene
    step / scale)), 0.001 on the crane; unspread places to
    `storedSceneStep`.
  - `readPaperFaces` (`diagramFile.ts`) takes the NEWER case (another field
    locks the step) and damage (the field is dropped, the picture kept). It
    cross-checks against the scene the reader has already parsed (the
    `readScenes` WeakMap), so no scene is parsed twice. `paperFaces` is in
    `SCENE_PICTURE_KEYS`. A `setLinkedPicture` test checks that a capture
    adding only faces counts as an edit and keeps the picture key.
  - **The writer**, held back at 16c's gate on the size budget and landed
    with Zach's answer (Z11) in ab3b6b26a. `flatPicture(..., { faces })`
    calls `flatPaperFaces` (`capture/capturePaperFaces.ts`) and stores
    through `storedPaperFaces` (in `diagramFile.ts`), so every flat capture
    keeps them: Link, Refresh and Show as through `captureStep`, Pose's
    commits through its session. Pose's preview, never stored, passes
    `faces: false`. Faces are not in the picture's key: a capture that only
    adds them changes no mark's place, but is an edit (`setLinkedPicture`).
  - **Older steps: the backfill route.** `stepWithPaperFaces(runtime,
    {step, document, segmentation, style})` (`capture/stepPaperFaces.ts`,
    the kernel injected as `captureStep`'s is) returns the step with its
    faces, or why not: `none` for a picture with no faces to have, `refresh`
    with `stale`, `missing`, `unknown` or `redrawn`. It folds only when the
    link is current, and keeps the faces only when the fold draws the stored
    picture (the same key), so they are that picture's; the picture,
    revision and marks are untouched, and committing is the caller's (16e's
    capture paths, when a step becomes an enlarge source or is enlarged).
    `lacksPaperFaces(step)` says whether a step is such an older capture.
  - **Refresh on a current, faceless flat step.** `DiagramStepActionState`
    gains `facesMissing` (`lacksPaperFaces`), which makes a current link
    refreshable as a stale light does, so "Refresh step N to anchor the
    frame" never names a disabled verb (the Step pane hides a disabled
    Refresh). Refresh all and the count it is offered by (`refreshKind`)
    are unchanged: they stay about pictures that are out of date. The Step
    pane and the card's menu now offer Refresh on every older flat step
    until it has its faces.
  - Verified at :5291 (`artifacts/revision-2/16c/writer/`: `app.mjs`,
    `pose.mjs`, `backfill.mjs`, `budget.mjs`, composite
    `writer-composite.png`). On the crane: all 18 flat steps older and
    current, Refresh offered on each; the backfill gave step 22 its faces (47
    points, 44 faces, picture and revision untouched), and a real click on
    the Step pane's Refresh then wrote byte-identical faces and the row went;
    Link, Show as and Pose (a real click on Rotate Right) each wrote faces;
    every flat step refreshed and saved, the crane reopened with nothing
    locked, all 18 with faces, Refresh offered on none, and saved again
    byte-identical but `savedAt`. Over Zach's four diagrams the backfill gave
    faces to 28 of 30 flat steps, each byte-identical to what Refresh then
    wrote; the heart's step 14 (stale) and Reference Diagrams' step 6
    (current, but this build draws it with another key) went to Refresh,
    which redrew both. The new tests fail on 16c's HEAD without the change
    (16 of them). Gate on exactly the commit (HEAD exported, the change
    applied): lint, tsc and the i18n check clean; 855 files and 11,342
    tests passed, 2 files and 14 tests skipped, no expected failure left.
- [x] The size budget. A vitest over the 16.0 fixture: each capture's
  `paperFaces` at most 0.3 of its `sceneJson`, both as the file writes them
  (16.0: 0.16–0.26). A script beside `twoStageSizes.mjs`, run at 16c's gate
  on the crane with every flat step refreshed: the `.osf` grows by at most 1%
  (16.0: 0.83%), its numbers written under this phase. If either fails, 16c
  stops and takes the numbers to Zach rather than raise the budget (Model
  and file format).
  *As built, and broken: PENDING Zach.* The vitest is
  `zoom/paperFacesBudget.test.ts`, over `zoom/__fixtures__/zoomImprint.json`;
  the script is `artifacts/revision-2/16c/paperFacesBudget.mjs`, run with the
  held-back writer applied, every flat step refreshed:

  | Diagram | File growth | Faces / scene, per step | Budget |
  | --- | --- | --- | --- |
  | crane (2,492,341 B today) | +0.84% | 0.153–0.254 | holds |
  | heart | +0.67% | 0.061–0.221 | holds |
  | chipmunk | +0.18% | 0.083–0.121 | holds |
  | Reference Diagrams | +0.26% | 0.344 | breaks |
  | crane, Spread Layers off | +0.87% | 0.392–1.804 | breaks |

  No whole file grows more than 0.87%, under the 1%. The per-step 0.3 breaks
  on captures with no spread, where the stored scene drops the faces it
  hides while `paperFaces` keeps every face: the faces' bytes barely change,
  the scene shrinks (0.39–1.80 on the crane; 1.35–1.45 on the fixture's S, C
  and R21). It also breaks on Reference Diagrams' one small step (0.344).
  So 16c stopped there: the vitest's no-spread case is an expected failure
  (`it.fails`, "BREACHED, awaiting Zach"), to be rewritten with the answer,
  and the writer is held back (above). **For Zach, then PENDING:**
  - (a) a whole-file budget (the `.osf` grows by at most 1%) in place of the
    per-step one; or
  - (b) the plan's lever: faces saved only on steps that hold an area or a
    frame, captured when a step first gets one.

  **DECIDED, 2026-10-06: (a)** (Z11). Zach: "I'd rather always save the
  faces because later down the line I also want to do stuff like you know,
  being able to hide specific faces and show the faces underneath. Like, you
  know, things that would require us to have all the faces for a step."
  *As rewritten:* the budget is the whole file's, every flat step refreshed:
  the `.osf` grows by at most 1%. `zoom/paperFacesBudget.test.ts` no longer
  caps a step: it holds that a step's faces add only their compact string to
  a file written as the app writes one (never a value, a number to a line),
  and the same bytes whatever the spread, and it still reports each
  capture's faces against its scene. The whole file is weighed on Zach's
  diagrams, which are not committed, by
  `artifacts/revision-2/16c/writer/budget.mjs`: every flat step refreshed
  through Refresh, the file saved by the app's Save and weighed against the
  app's own save before the refresh:

  | Diagram | Flat steps | File growth | Faces in the file | Faces / scene, per step (reported) |
  | --- | --- | --- | --- | --- |
  | crane | 18 | +0.84% | 20,497 B | 0.153–0.254 |
  | heart | 8 | +0.65% | 8,143 B | 0.061–0.221 |
  | chipmunk | 3 | +0.18% | 1,315 B | 0.083–0.121 |
  | Reference Diagrams | 1 | +0.37% | 267 B | 0.344 |

  Reference Diagrams grows by more than at 16c's gate (+0.26%) only because
  it is weighed against the app's save of it (80,222 B), not the file on
  disk (114,434 B); its faces are the same 267 B.
- [x] The `zoom` kind and its fields (`angle` and `anchor` with the rest),
  `cleanZoom`, `carryZoom` (any angle, mirrored with the side), shape
  conversion, per-shape defaults; `DiagramStepZoom`; readers and writers,
  `zoom` added to `STEP_KEYS` with `readStepZoom`. Tests: round trips;
  defaults unsaid; NEWER and damage for each field; a malformed `zoom`
  dropped with `annotatedPictureKey` null; the older-build-verbatim case.
  *As built:*
  - The area's fields: exactly one of `radius` and `size`, with `angle`,
    `scale`, `edge` and `anchor`; `to` is read as `from`. An out-of-range
    value, an unknown edge word or an unknown field is NEWER; both or neither
    of `radius` and `size` drops the mark; a bad optional field drops only
    that field.
  - `cleanZoom` and `carryZoom` are in `annotationModel.ts`, not
    `zoomModel.ts` as "Model and file format" lists them, to avoid an import
    cycle. `carryZoom` carries a rectangle's angle through any turn, mirrored
    with the side, normalised to [0, 180).
  - An area has no Flip. `compileAnnotation('zoom')` returns null, so nothing
    draws one until 16d; it is hit on its outline only, below every other
    mark. Layers lists it as "Enlarge Area" (`enlargeArea`, one key in nine
    catalogs), with a glyph of a rounded frame with outward corner ticks.
    `DiagramAnnotationTool` gains `enlarge` and `enlarge_frame`, and
    `docs/analytics.md`'s row says so; nothing sends them until 16e's tools.
  - `DiagramStepZoom`'s keys: `from`, `shape`, `frame`, `imprint` {`outline`,
    `on`, `picked`}, `scale`, `edge`. An unknown key or value locks the step;
    a malformed zoom is dropped and sets `annotatedPictureKey` to null. A
    seeded step keeps the source's frame, copied in picture units, beside its
    imprint. A step with no faces keeps its capture's imprint until its frame
    is set by hand.
- [x] `zoomImprint`, landing in two stages. Tests: a face's placement exact
  on the unspread picture, and mirrored on a face showing its back; off and
  onto the spread are the identity with no spread, and inverse with one
  (exact under the affine spread, to 1e-9 px under the depth spread), but in
  a strip the spread opened, where a dropped centre settles on the layer
  above; imprint then land on the same picture is the identity, spread or
  not; R (21 → 22) and C, the 16.0 fixtures whose folds hold different faces
  still, land within 2% under the default affine and depth spreads (16.0:
  0.002% and 0.26%; 0.002% and 0.55%), and the same cases by B's move would
  not (5.0% and 5.2% under the affine spread), so the last stage follows the
  face under the centre; the frame keeps its unspread size and angle; a turn
  by any angle and a turn-over carry the frame turned and mirrored (a rounded
  rectangle lands at an angle); under an affine spread a circle lands a
  circle; a crease pattern, Front and Back; a step with no faces copies in
  picture units; a paper point off the paper; a centre over no paper follows
  the nearest face.
  *As built:* a face's placement is the least-squares similarity, reflected
  when the face's affine fit has a negative determinant. Off the spread by
  Newton's method, started from the face's affine fit; onto the spread
  through the topmost face under the point, else by the nearest ring point's
  move. Measured live at :5291 (`verify/imprintLive.mjs`), 16.0's refolds
  captured afresh and run through `enlargeStep`; the worst is 1.362%, against
  the 2% allowed:

  | Case | No spread | Affine spread | Depth spread |
  | --- | --- | --- | --- |
  | A | 0.004% | 0.521% | 1.362% |
  | B | 0.006% | 0.518% | 1.356% |
  | C | 0.002% | 0.257% | 0.549% |
  | C posed like S | 0.004% | 0.510% | 1.335% |
  | R (21 → 22) | 0.001% | 0.002% | 0.002% |
- [x] The default anchor. Tests: the backmost face entirely outside the
  frame, by drawn rings; a level tie broken on paper area within 0.1%, then
  by the lower face index (crane step 22's faces 33 and 14, equal on the
  paper, their picture areas apart by rounding and by 5% under a spread);
  every face touching → the backmost
  reaching outside; the frame covering the model → the backmost; a picture
  turned over and a Back pass, each ranked from its own side; a crease
  pattern anchoring at the frame's centre; a picked anchor taking precedence.
  *As built:* faces are ranked by level, then by paper area (ties within
  0.1%), then by the lower index; the anchor is the first wholly outside the
  frame, else the first reaching outside it, else the backmost. Its paper
  point, `poleOf`, is polylabel on a binary heap: precision 1e-3 of the
  face's longer side, at most 20,000 cells, starting cells of max(shorter
  side, longer / 64). The crane fixture's 420 faces take 19.6 ms in all.
  Crane step 22 anchors on face 14, which lands on face 12; R on face 30,
  which lands on 14.
- [x] `zoomCapture`. Tests: the source (the nearest earlier step with an area
  or a frame, turns passed, a locked step passed over); provenance (an area's
  id, or inherited through a frame); a picked anchor copied, a default one
  worked out afresh; the seed at creation (imprint stored, the frame landed
  by the first picture); a reorder changes no captured frame; deleting the
  area or its step changes no enlarged step; Update captures exactly the steps
  with that provenance, wherever they sit, in one undo step, over hand moves;
  toggling off and on captures from what is before the step now.
  *As built:* `captureSource` passes over turns and locked steps.
  `areaSource` finds an area by id: Update captures from the area itself,
  wherever the enlarged steps sit, and never changes `from`. `sourceImprint`:
  a source step with faces is imprinted afresh, one with a picture but no
  faces has its frame copied, and one with no picture gives its stored
  imprint. `heldFrame` keeps the frame's centre within reach. `capture`
  returns {zoom, placed: face | sheet | picture | null, anchor: auto |
  picked | none}. "One undo step" comes with the store verbs (16e).
- [x] `zoomIndex`, `stepView`, `viewFrame`, `viewGeometry`; `zoomFrames`,
  every row of its table, and the invariant helper.
  *As built:* `zoomFrames.ts` has one pure function per row of the table:
  `enlargeStep`, `unenlargeStep`, `updateEnlargedSteps`, `relandFrame`,
  `setFrameOutline`, `setFrameAnchor` and `reposeFrame(before, after, move,
  assets)`. Marks are carried between units with an exact round-trip check:
  if any mark would not come back the same, every mark keeps its numbers and
  the step is marked out of step. None is wired to a store verb yet (16e,
  16g). The invariant helper is `frameProblems`
  (`zoom/zoomInvariant.fixtures.ts`), run by `zoomFrames.test.ts`.
  `zoomIndex` is a WeakMap memo per document order. `stepView.ts` has
  `stepView`, `viewOfStep`, `viewFrame` and `viewGeometry` (a margin of 0.1
  window lengths; it keeps only the last window per geometry).
- [x] Proof and gate (added as built). The verify scripts are in
  `artifacts/revision-2/16c/verify/`: `imprintLive.mjs`; `app.mjs`, with
  make, canvas, head and keysets modes; `roundTrip.mjs`, `headBuild.mjs`
  and `composite.mjs` (composite
  `artifacts/revision-2/16c/16c-before-after.png`); and `gate/hunks.py` and
  `gate/locales.py`, which rebuilt 16c's hunks on each new base. At the gate, 854 files and 11,324 tests passed, with one
  expected failure (the budget's) and 2 files and 13 tests skipped; lint,
  tsc and the i18n check were clean.

### 16d Enlarged steps: painting

**Built 2026-10-06**, to the part's "Rendering on every surface". An area is
drawn on its step, and an enlarged step is drawn as its window on every
surface — card, Annotate canvas, Pose (flat and live), page cell, PDF, step
files, Export Picture — from the frame it stores, faces or none. Nothing
authors an area or a frame yet (16e); pages lay an enlarged step out as a
fitted picture of its window until 16f's 'zoom' kind.

- [x] `paintZoomed` (the clip, turned with the frame; the repaint at scale;
  culling); `zoomEdge`, with `piecesUnder` exported; the area's
  `CompiledAnnotation` with its casing and reach.
  *As built:* `zoom/paintZoomed.ts` holds what surfaces share:
  `zoomPlacement` (window, whole picture and frame on a surface by one scale
  and shift), `zoomClipShape`, `zoomCull` (the window grown by the
  overshoot, in picture units), `zoomBoundary`, `paintZoomed` (clip, the
  surface's own picture, boundary), and `paintZoomedPicture`, the window as a
  document of its own at a card's 50 mm, which cards, the canvas and
  close-ups use; `zoomedPictureFile` is the same window as Export Picture's
  file, sized and drawn in pt with its XML declaration, as every captured
  picture and step file is. Culling is `sceneCulledTo` (`paintDiagramStep.ts`): scene
  items whose extent misses the box are dropped, bounds and sheet kept, so
  what is left lands where it did; `paintSource`/`paintScene` and the page's
  `draw` take it. `paintedFrameLongerPx` (`pictureFrame.ts`) gives a source's
  frame at scale one without painting it, for the repaint's scale, from the
  scene as `storedScene` read it once per picture. `zoom/zoomEdge.ts`:
  `paperSilhouette` (a scene's visible face rings, a References card's sheet
  and regions, null for uploads and fixed pictures, memoized per picture);
  `zoomEdgeDrawn` (Whole, or Cut by `piecesUnder` over the faces near the
  outline: stretches grown by the overshoot, then gaps under 2 mm drawn
  through, closed at ≥ 97% raw cover or when the grown stretches meet; a
  small per-silhouette cache); `zoomEdgePaths` (a circle's arcs through
  `ringPieces`, a rounded rectangle whole with true quarter-circle corners,
  its stretches as polylines along 32 points a corner). The area compiles to
  `{kind: 'zoom', outline}`; `AnnotationDrawing.zoomAreas` draws it in the
  ring pen and the arrows' ink, a rounded rectangle on a white casing
  `ZOOM_CASING_INKS` (1.5; 0.45 since Zach's review, Z5) ink past its pen
  each side, between the marks and
  the close-ups; its reach is the turned outline's box and half its pen or
  casing.
- [x] Cards; the Pose stage's dimmed frame; the Annotate canvas
  (`DiagramZoomView`, the window as frame, the dimmed surround when the frame
  is selected, snapping and layers from `viewGeometry`); Export Picture; a
  close-up on an enlarged step.
  *As built:* every surface asks `zoomedSource(step, assets)` (null for a
  step that shows its whole picture). Cards: `zoomedStepUrl` →
  `zoomedCardPicture`, keyed by the frame, its shape and edge. Pose, flat:
  `posedZoomUrl` → `posedZoomPicture` (the whole picture, the frame dashed in
  `ZOOM_SELECTION_INK`, the rest under 45% white, the marks ghosted on the
  window); live 3D and simulated views: `poseGhostMarkup`, the outline
  undimmed with the marks. The posed picture's box takes in all of the
  frame's outline, marks or none, so a circle round the model's edge is
  never cut at the picture's side. Canvas: `useAnnotateCanvas` lays the window out as
  the frame (`zoomedCanvasLayout`), with the margin its card gives it
  (`ZOOM_CARD_MARGIN`, 1 mm in 50), so a fit leaves its boundary clear of the
  zoom pill as any picture's edge is; `DiagramZoomView` (own CSS module)
  draws the window as its card paints it (`zoomedPictureUrl` at scale one:
  culled, clipped, its boundary on it) laid on the frame, an image no larger
  than the window however small it is, and a hairline in the frame's shape
  (the frame div's box hairline is off, `data-zoomed`); with the reserved id
  `ZOOM_FRAME_ID` selected (16e selects it), the whole picture instead
  (`closeUpPictureUrl` at the window's 50 mm), under 45% white but the
  frame, the boundary over it. *Deviation:* the plan drew the whole picture
  under a clip always; for a small window that image is many frames across
  (some 33,000 world px at the least radius), so only the surround draws it.
  The selection's ink is held in two places, which a canvas test holds
  equal: the canvas module's `--annotate-selection` (a component's own value,
  which `themeTokens.test.ts` has its module define) and
  `ANNOTATE_SELECTION_INK` (`canvasInk.ts`), which Pose's outline draws on a
  picture no stylesheet reaches. Snapping, right angles, nearest lines, Layers' frame
  and the divisions read through `markGeometry`/`viewFrame`, the window's
  units. Export Picture writes the window with its boundary, no marks, as
  SVG whatever the picture. A close-up on an enlarged step shows the window
  again, larger: cards and the canvas through `paintZoomedPicture` at the
  close-up's scale, a page through its own windowed draw.
  **Added, from the Edge cases:** `marksInWindow` — marks lying wholly
  outside the window grown by a window each way are kept but neither drawn,
  measured nor pressed (cards, cells, the canvas's drawing, fit and hits);
  Pose shows them all, in place. Their Layers badge is 16e's. An area's
  extent is its outline's box. Tests: `stepView.test.ts` (kept, dropped
  along each side, a ring's, a close-up's, an area's and a path's extent,
  unknown marks kept, `stepAsDrawn`), a card and a cell that neither draw
  nor measure a far mark (`paintZoomed.test.ts`), and a press on one hitting
  nothing on the canvas.
- [x] `zoomEdge` fixtures: look 1 (the arc's span and overshoot); look 2
  (Whole; and with Cut, the broken corner); a rounded rectangle at an angle;
  the ≥ 97% close; the empty case.
  *As built:* `zoom/zoomEdge.test.ts`, with the gap rule (measured after the
  overshoots: a slot is drawn through when what they leave of it is under
  2 mm) and the silhouette reader.
- [x] Goldens on a card, a page and the canvas: look 1, a circle cut on a
  crane flat fold; look 2, a rounded rectangle drawn whole, with the casing on
  the step before; a rounded rectangle landed at an angle; an upload drawn
  whole; a References card.
  *As built:* `zoom/zoom.cases.ts`, `zoom.surfaces.tsx`,
  `zoomGolden.test.ts` and `__fixtures__/zoomGolden.json` (recorded with
  `ZOOM_GOLDEN_WRITE=1`), on 16c's crane fixture `S.none`; checked by eye
  beside Zach's two examples, `artifacts/revision-2/16d/shots/goldens.png`
  (`goldens.mjs`).
- [x] A label on an enlarged step prints the same size as on an unenlarged
  step of the same printed frame.
  *As built:* in `zoom/paintZoomed.test.ts`, on a page cell at a 40 mm frame.
- [x] Proof (added as built). In the app at :5291 on Zach's crane
  (`artifacts/revision-2/16d/verify/browser.mjs`): an area on step 19 (a
  circle) and on step 15 (a rounded rectangle), each step duplicated and the
  copy enlarged through `zoomFrames.enlargeStep`, its carried marks replaced
  by a valley line and a label; the grid, Pose, Annotate (and the frame
  selected), the area's step and the pages, against the build before 16d
  (HEAD copies routed, `headBuild.mjs`), in Chromium and iPad-sized WebKit,
  light and dark: `artifacts/revision-2/16d/16d-before-after-*.png`. The
  look-1 boundary runs past where it leaves the paper; look 2 is whole; the
  area's casing knocks out the creases. A PDF of the golden's steps through
  the real writer, rasterised by `pdftoppm`: `verify/shots/pdf-1.png` (the
  writer case itself is 16f's). The browser found one bug, fixed: a selected
  frame's dimming covered only the canvas's world, not the whole picture
  past it. The review's fixes (2026-10-06): Pose's cut outline, the canvas's
  margin and small-window image, Export Picture in pt, the scene read once,
  and `marksInWindow`'s tests, above; `printedFrameMm` on a window and Pose on
  an enlarged step with no marks have tests of their own. Left for Zach's
  eye: the rounded rectangle's casing (Z5's 1.5 ink, about 0.5 mm of white
  each side) reads heavier on the crane's gray than look 2's hairline
  knock-out (about 0.1 mm); about 0.4–0.5 ink would match it
  (`ZOOM_CASING_INKS`, the golden re-recorded).
- [x] Zach's ink review (2026-10-06, Z5 revised): "way too wide. It should
  just be like a tiny line." `ZOOM_CASING_INKS` 0.45, chosen against look 2
  at print size; `zoomGolden.json` re-recorded and checked by eye beside
  look 2; step 15's area on the crane at print size and ×3 beside look 2,
  before and after: `artifacts/revision-2/review-ink/casing.png`.

### 16e Enlarged steps: authoring

**Built 2026-10-07** (commit 63f390cf2), to the part's "Walkthroughs" S1–S3
and "Controls, pane by pane". Annotate gains Enlarge (E) and Enlarge in Frame
(Shift+E); Pose gains Enlarged, which captures and carries, and turned off
carries back, one undo step each; Layers shows an area's and a frame's
Shape, Size, Edge and Anchor with Update Enlarged Steps and the Go to verbs;
the Step pane and the cards say where a frame came from and, from 16f's
layout, what it prints at. The part's text was amended as built in the same
commit: Anchor "Auto"; S5's refresh notice; the enlarged step's reason; the
Step pane's rows; the phone's toggle in the Step drawer; the marks' reach on
an enlarged step, for Zach; the 16g gate and the 16g seeding funnel. It does
not ship before 16g (below).

- [x] Enlarge and Enlarge in Frame: tools, keys, glyphs, help, disabled
  reasons; release adds the area only, as one undo step; grips and hit.
  Enlarge in Frame's aspect ratio is free: any rectangle, drawn corner to
  corner (Shift squares it, Alt from the middle), and freely resizable
  afterwards by its corner and edge grips (Shift keeps the aspect, Alt about
  the centre), on the area and on an enlarged step's frame (Zach,
  2026-10-06).
  Tests: a drag adds the area and no step; several areas on one step; grips;
  the area hit under other marks; the tools disabled on an enlarged step; a
  drag of any aspect, Shift square, Alt from the middle; an edge grip
  changes one side only, on the area and on the frame.
  *As built:*
  - **Tools.** `annotateTools.ts`: `ENLARGE` ('enlarge', E) and
    `ENLARGE_FRAME` ('enlarge-frame', Shift+E), drawing tools that lay kind
    'zoom'; `drawingLook` returns `DrawingLook` (`WhiteArrowLook & {
    shape? }`); `isEnlargeTool`, `annotateToolBlocker` and
    `enlargedStepTakesNoArea`, whose reason reads "This step is already
    enlarged — draw the area on a step that shows the whole model"; the help
    and modifier lines (Shift square, Alt from the middle) and
    `EnlargeGlyph` (circle and rounded). The keys are in
    `keyboard/shortcuts.ts`, `ANNOTATE_SHORTCUT_IDS` and `shortcutLabels`;
    `runDiagramAnnotateShortcut` takes the key on an enlarged step and picks
    nothing.
  - **The drag.** `useAnnotateCanvas`'s `laid()` builds the draft and the
    drop: `zoomAreaFromCorners` for a rectangle (Shift, Alt),
    `createAnnotation` otherwise; undo label 'Enlarge area'. `diagramState`'s
    `annotateToolInHand` is Select for an Enlarge tool on an enlarged step,
    read by `useAnnotateCanvas`, `useAnnotateToolHint` and DiagramPanel's
    rail; the stored tool is untouched. `clipboardSlice.pasteClipboard`
    leaves kind 'zoom' out on an enlarged step, with a toast, and makes no
    history entry when nothing is left.
  - **Grips.** `zoom/zoomGrips.ts`: `ZoomGrip` (centre, rim, corner 0–3,
    edge 0–3), `zoomGrips`, `zoomGripPoint`, `zoomGripAt` and
    `draggedOutline`, which holds the opposite side, resizes about the
    centre with Alt, keeps one scale with Shift and turns with the
    rectangle. `AnnotationGripPart` gains `{ part: 'zoom' }`;
    `hitAnnotation` tries a selected area's grips first, and an area hits on
    its outline only, last. Undo label 'Change enlarge area'. Fixed on the
    way: `rectangleAngle` maps a hair under 0 to 0, not 180.
  - Tests: `DiagramAnnotateCanvas.test.tsx` ("the Enlarge tools and the
    enlarged frame": a drag adds the area alone, one undo step, and a second
    on the same step; a rectangle of any aspect, Shift square, Alt from the
    middle; an area taken by its outline under the marks inside it; a
    circle's centre and rim, a rectangle's corner, Alt and edge grips;
    nothing drawn on an enlarged step), `zoomGrips.test.ts`,
    `annotateTools.test.ts`, `diagramShortcuts.test.ts`,
    `DiagramAnnotateRail.test.tsx`, `diagramClipboard.test.ts`.
- [x] `zoomActions`: the Enlarged toggle on both pose catalogs, removing a
  step's own areas when it has them; Update Enlarged Steps; Pick and Reset;
  the Go to verbs. `DiagramStepZoomStatus` and its notices; the card chip.
  A capture whose source or enlarged step is an older flat capture first
  gives it its faces through `stepWithPaperFaces` (16c, Z11), in the same
  undo step; one it sends to Refresh gets the S5 notice.
  Tests: the toggle on captures and off carries the marks out; on a
  duplicate of the area's step it removes the copied area; disabled with its
  reason when no earlier step has an area or a frame.
  *As built:*
  - **Store verbs.** `diagramSlice`: `enlargeDiagramStep`,
    `unenlargeDiagramStep`, `updateEnlargedDiagramSteps`,
    `editDiagramStepZoom`, `giveDiagramStepPaperFaces` (joins only the
    newest history entry) and `setDiagramAnchorPick`.
    `store/workspaceStore/diagramZoom.ts`: `storePaperFacesBackfill` (a
    `FOLD_RUN_NONE` runtime through `stepWithPaperFaces`), `withPaperFaces`
    (only while the revision and picture key still match), `enlargeInStore`
    ('Enlarge step'), `unenlargeInStore` ('Show whole step') and
    `updateInStore` ('Update enlarged steps'), each guarded while in flight,
    and `trackCaptured`/`trackSeeded`. `zoomFrames` adds `setFrameShape`,
    `setFrameScale`, `setFrameEdge`, `seedStepZoom`, `landFirstFrame`,
    `landSeededFrame`, `sizedByHand` and `MarkUnits`. `addAt` seeds a new
    step; `commitStepCapture` and the upload's fill and replace land a
    seeded frame (every other way a step is made is 16g's funnel).
  - **Catalog and hooks.** `zoom/zoomActions.ts`: `enlargedState`,
    `buildEnlargedAction`, `buildAreaActions` (`waiting`, and aria-busy
    while Update folds faces), `buildFrameActions`, `buildAnchorActions`,
    `stepsEnlargedFrom`, `areaStepOf`, `areaSubtitle`, `frameSubtitle`,
    `stepZoomStatus` (the notices: no paper; anchor off paper; refresh
    {stepId, number, then}; unanchored {then}), `zoomReadout` and
    `zoomReadoutText` (over 16f's `usePrintedZoom`: 'prints', amber 'room',
    'barely') and `enlargedChips`. Hooks: `useStepZoom` (Pose's toggle and
    the Step pane) and `useZoomControls` (Layers).
  - **UI.** Pose's Enlarged is on the toolbar on both paths
    (`DiagramLinkedPoseControls`'s `enlarged`) except on a phone; the Step
    pane's Pose section has it as a `ToggleRow` switch on every path.
    `DiagramStepZoomStatus` (its own CSS module, one line in
    `DiagramStepPanel`): an Enlarged section with From (a link) and Size
    ("Fill · prints ×N"), the amber read-outs and the notices. The card's
    chip, "Enlarged · N", sits in its header.
  - Tests: `diagramZoom.test.ts` (on and off, one undo step each, the marks
    carried; a duplicate's copied area removed; S1 on the crane in step
    there and back; nothing to capture from; a step added after an enlarged
    one; older captures' faces), `zoomActions.test.ts`,
    `DiagramStepZoom.test.tsx`, `DiagramStepsGrid.test.tsx` (the chip).
- [x] `DiagramZoomControls` with `useZoomControls`: the area rows and the
  frame row, their subtitles by provenance, Update's count and disabled
  state, the frame's note, the badge on marks outside the window — the only
  place a mark 16d's `marksInWindow` keeps, but neither draws nor lets be
  pressed on cards, cells and the canvas, can be seen again. Tests:
  Layers rows on both steps; Update as one undo step.
  *As built:* `DiagramZoomControls` (its own CSS module): Shape as icon
  segments; Size as Fill | Fixed and a ×N field (1.25–6, by 0.25); Edge as
  Cut | Whole, Cut held without an outline; Anchor on one line ("Auto" or
  "Picked", each with its tooltip); the read-out, `data-tone="warning"` when
  amber; the frame's note; the verbs. `DiagramLayers`: the frame's row first
  (`data-zoom-frame-row`), an area's subtitle "Enlarged on step N", "…steps
  A–B" or none, and the badge "Outside the enlarged frame".
  `useDiagramPaneReveal`: `layersSelectionId` brings Layers forward for the
  frame, and a change of step brings the Step pane forward only while no
  layer is selected, so Go to Area keeps Layers. Tests:
  `DiagramZoomControls.test.tsx` (both steps' rows, Update offered and
  waiting, a read-only diagram holding every control, the badge),
  `diagramZoom.test.ts` (Update as one undo step, over a hand move),
  `useDiagramPaneReveal.test.tsx`.
- [x] The frame as a layer: selected by its boundary and by its row; the
  dimmed surround and the anchor face outlined; grips; a drop moves the frame,
  makes its imprint again and carries the marks, one undo step. Tests: marks
  stay on the same paper through a move and a resize. The surround (16d)
  paints the whole picture at the window's scale, a new picture per frame
  and many frames across for a small window: cap or cull it, and keep a
  drag from painting one per move.
  *As built:*
  - `frameOutline = outlineIntoBox(window, frame)`; the gesture mode 'frame'
    draws only a `frameDraft` outline while dragging. The drop is
    `editDiagramStepZoom` → `setFrameOutline(outlineFromBox(…))`:
    `sizedByHand` (no smaller than an area may be drawn), off then onto the
    spread, the imprint made again on the same face; labels 'Move enlarged
    frame' and 'Resize enlarged frame'. `holdCamera` keeps the picture's
    points still on screen; `revealFrame` steps back on selection.
    `ZOOM_FRAME_ID` is selectable while `showsFrame`, and `keepSelectable`
    runs after the zoom verbs. The anchor face's ring and the frame's line
    keep their screen width (`px / zoom`).
  - **The surround, capped:** `zoomSurroundUrl` → `zoomSurroundRegion` (the
    window ±2 cells, at a quarter-octave scale) and `paintZoomSurround`. It
    grows toward `alsoShow` (the anchor's ring, or the whole picture while
    picking) up to `ZOOM_SURROUND_MOST_CELLS` (24), and a small move or
    resize paints nothing new.
  - **The off-paper inverse.** `zoomImprint`'s `offPaper` solves onto(p) =
    drawn in up to 32 fixed-point steps. A point in a strip a spread opens
    settles on the layer above, per the plan: 0.028 picture units on crane
    step 21; every other drop landed exactly (`verify/probe/`; confirmed by
    Zach, 2026-10-07).
  - **Reach** (confirmed by Zach, 2026-10-07; "Model and file format";
    Decided with Zach, 5). `annotationModel` adds `AnnotationReach`,
    `PICTURE_REACH`, `withAnnotationReach` (scoped, try/finally) and
    `isWithinReach`;
    `withinReach`, `handleWithinReach` and `deltaWithinReach` read the
    active reach. `zoomModel.windowReach(frame)` joins reach's four windows
    round the window with the whole picture's ±4 frames taken into window
    units; `stepReach` is that on an enlarged step with a picture, else the
    picture's. `diagramFile.readStep` reads `zoom` first and checks the
    marks against `windowReach` (the frame's centre still against
    `PICTURE_REACH`); `editStepAnnotations` cleans within `stepReach`;
    `zoomFrames.carryMarks` carries within the reach of the units it goes
    to, with a round trip back, and a failure keeps every mark where it was,
    out of step.
  - Tests: `DiagramAnnotateCanvas.test.tsx` ("an enlarged step's frame":
    selected by its boundary under every mark, with an Enlarge tool in hand
    from another step too; moved, one undo step, the marks on the same
    paper; resized, drawing only an outline until it lands; still on a
    read-only diagram), `zoomFrames.test.ts` (the long mark there and back,
    S1.6; resized again and again off the paper; held no smaller than an
    area), `zoomImprint.test.ts`, `zoomSurround.test.ts`,
    `zoomModel.test.ts`.
- [x] Not shipped before 16f: until 16f's 'zoom' kind, pages lay an enlarged
  step out as a 'fit' picture, which can share a Fit each run with uploads,
  3D and other fitted pictures and change their printed size (S6: enlarged
  steps never enter `scaleRuns`). The toggle that makes one reaches no user
  until 16f lands.
  *Retired by 16f* (46c5de201), which landed first: an enlarged step is laid
  out as its own 'zoom' kind and shares no Fit each run.
- [x] Not shipped before 16g: re-posing, refreshing or relinking an enlarged
  step garbles its marks and leaves its frame. `withCarriedAnnotations` is
  not frame-aware until 16g wires `reposeFrame` and `relandFrame` into it:
  it carries the window-unit marks as if they were the whole picture's, and
  the frame stays where it was in picture units while the picture turns
  (review of 16e, 2026-10-06). 16g lands in the same release as 16e.
  *Retired by 16g*: `withCarriedAnnotations` hands an enlarged step to
  `zoomFrames.followOwnPicture`, which every edit of a step's own picture
  reaches (Pose's commits and its spread preview, Refresh, Link, a
  References step's side and way, an upload's pose).
- [x] The Anchor row and the pick mode (`useAnchorPick`): Pick, the hover
  highlight, a click anchoring, Escape through the shortcut runtime, Reset;
  hidden with no faces and on a crease pattern. Tests: a pick stores the
  paper point and leaves the frame where it is; a later capture lands through
  the picked face; Reset returns to the default; Escape leaves the mode with
  the focus in Layers.
  *As built:* `zoom/zoomAnchor.ts`: `anchorPickable` (flat faces only),
  `anchorFace`, `anchorFaceRing`, `faceUnder`, `pickedAnchor`,
  `frameHoldsPaper` and `anchorOnPaper`. The pick mode is store state,
  `diagramAnchorPick` {stepId, target} in `DIAGRAM_SCOPED_KEYS`, read
  through `activeAnchorPick`; `diagramSlice`'s `pickPutDown` clears it on
  any selection change, open or close that no longer matches it.
  `useAnchorPick` binds the canvas's hover and press ('Pick anchor');
  `runDiagramCancel` ends the pick first; Reset is 'Reset anchor'. Tests:
  `zoomAnchor.test.ts` (none without faces; a pick stores the paper point
  and leaves the frame; a later capture lands through the picked face;
  Reset goes back to the rule), `DiagramAnnotateCanvas.test.tsx` ("the
  anchor's pick mode"), `diagramShortcuts.test.ts` (Escape leaves the pick
  first, wherever the focus is), `DiagramZoomControls.test.tsx`,
  `diagramZoom.test.ts`.
- [x] Analytics (`enlarge`, `enlarge_frame`; `diagram step enlarged` with
  `via`, `placed` and `anchor`; `diagram enlargement changed`;
  `enlarge_off`) and `docs/analytics.md`; i18n in nine catalogs, the one-step
  and range strings as two keys each.
  *As built:* `analytics/trackDiagramZoom.ts`: `trackDiagramStepEnlarged`
  (`via` toggle | seeded | update, `placed` face | sheet | picture, `anchor`
  auto | picked | none, `shape`, `picture`) and
  `trackDiagramEnlargementChanged` (`on` area | frame, `setting` moved |
  shape | size | edge | anchor | deleted, `value`, `size_bucket` <=1.5 |
  <=2 | <=3 | <=6); `enlarge_off` on `diagram picture posed`; `enlarge` and
  `enlarge_frame` on `diagram annotation added`; their rows in
  `docs/analytics.md`. 72 new English strings in `tools` and `panels`,
  translated in all nine catalogs and stamped; `i18n:check` passes. The
  French panels catalog wrote its existing no-break-space escapes as the
  characters themselves, its values unchanged.
- [x] Browser: S1 and S2 by a real mouse on the crane, its steps refreshed so
  they carry `paperFaces`, beside the two examples; S3's frame move and
  anchor pick; a read-only diagram with every enlarge control disabled; the
  Pose toolbar at 375 px with Enlarged showing (if it wraps, the toggle moves
  to the Step drawer, as Spread Layers does).
  *As built:* `artifacts/revision-2/16e/verify/proof.mjs` on Zach's crane at
  :5291, by real mouse and keys, in Chromium light and dark and iPad-sized
  WebKit (`shots/*-results.json`): S1 (E and a drag, Duplicate Step,
  Enlarged: one "Enlarge step" undo step, imprinted, the copied area
  removed, the marks in step, no "picture changed" notice; undo and redo);
  S2 (Shift+E corner to corner, the casing, Edge Whole); the Pages view (the
  area's step, the arrow and the enlarged step cut by its arc, beside look
  1; S2 beside look 2); the area's and the
  rectangle's grips (Shift's aspect exact, Alt's centre kept, three undos
  back exactly); Update Enlarged Steps as one undo step; S3's pick (the face
  under the pointer lit, the anchor stored with the area unmoved, the row
  one line, Escape from Layers, Reset and its undo) and the frame selected
  by its boundary, moved (landed where dropped, the camera held), resized
  and sized Fixed; Insert Step After seeding an empty enlarged step,
  "Enlarged · 20", landed by its first picture in the same undo step; off
  as one undo step; saved through the app's Save and opened in a fresh
  browser, every area, frame and imprint identical. A read-only diagram
  holds the rail's tools, every control, Pick and the toggle
  (`16e/browser.mjs`, `shots/*-readonly-*.png`). At 375 px, by touch
  (`phone.mjs`), Enlarged is in the Step drawer, not on the toolbar.
  Before and after (`before.mjs`, HEAD's sources routed through
  `headBuild.mjs`): E picks nothing before and Enlarge after, and Pose shows
  Enlarged before Reset Pose; composite
  `artifacts/revision-2/16e/16e-before-after.png` (`composite.py`). No app
  errors in Chromium; WebKit's worker COEP refusal follows Playwright's
  request routing, not the build (`coep.mjs`, `coep2.mjs`).
- [x] Gate (added as built): in a copy-on-write clone of 46c5de201 with
  exactly the committed patch (91 files), lint, tsc and the i18n check
  clean; 871 test files and 11,581 tests passed, 2 files and 13 tests
  skipped. The committed patch was checked byte for byte against the gated
  one.
- [x] Left open by the verify (2026-10-07), small; the larger questions,
  "Open with Zach" 3, 5 and 6, are decided (Decided with Zach, at the top).
  On an iPad the panes are a sheet, so the first Escape closes it and only
  the second puts Pick down. The badge "Outside the enlarged frame" wraps to
  two lines and cuts off the mark's name. A fixed Size of 1.25 reads "Prints
  ×1.3". `DiagramEnlargementValue` holds 'none', which is never sent.
  *Done in 16g*: the sheet leaves Escape to an armed pick
  (`shortcutRuntime.registerArmedMode`, claimed only while the Diagram has
  the keys, `diagramState.escapePutsPickDown`); the badge on its own line
  under the row's name; a fixed Size reads as typed, in the language's own
  numbers (`zoomNumber`); 'none' gone.
- [ ] Still open from 16e's verify, carried forward: after a large shrink
  the cropped surround's edge can still show at a very low zoom; the anchor
  face's outline is often off screen with the frame selected (arming Pick
  zooms out to it; selecting does not).

### 16f Enlarged steps: pages and export

**Built 2026-10-06** (commit 46c5de201, before 16e), to the part's "Page
layout and scale" and "The enlarge arrow". An enlarged step is laid out as
its own kind, by what it prints, in runs of its own; the arrow is computed
from the order, placed as a turn is, lifted to its area where it stands
alone beside it, and printed on every path that composes pages — the Pages
view, the PDF, Print and the single SVG. Step files frame an enlarged step
alone, with no arrow. This retires 16e's "not shipped before 16f" item: no
enlarged step shares a Fit each run any more.

- [x] The 'zoom' layout kind; the computed arrow; runs; the scale post-pass
  (Fill and fixed, `areaMm` from the area or from the step's own frame); the
  `LayoutCell.zoom` read-out; the gutter rule. Tests: unenlarged steps'
  scales identical with and without an enlarged step, apart from the gutter;
  an arrow after a step with an area and none after one without; among
  several areas the one with the step's provenance, else the first; Fill
  takes the run's minimum, and a long caption reduces only its own step; a
  fixed Size and its reduction; Cut laid out by its content box.
  *As built:*
  - **The kind.** `layoutPicture` measures an enlarged step as `kind: 'zoom'`
    in its window's units (longer side one), its `frame` the content box and
    its scale the window's printed longer side (a `frameMm` measure, so
    `layoutDiagram`'s measure-at-scale passes treat it as a fitted picture's;
    a diagram with an enlarged step is always measured at scale, since a cut
    frame's overshoot is set in mm). The content box is
    `zoom/zoomContent.ts`: Whole, or a Cut that draws closed, is the window;
    a Cut is the paper inside the frame (each silhouette face near it clipped
    to the outline's 96-gon, Sutherland–Hodgman) with the boundary's drawn
    stretches, overshoot included; a frame over no paper keeps its window.
    `drawZoomed` places the window so the content's middle is the room's,
    and `cellPicture` keeps the content, not the window, in the room
    (`DrawnPicture.paperPt`); `boundsPt` is the content and half the
    boundary's pen.
  - **What the layout is handed** (`LayoutStep.zoom`, from
    `diagramLayoutSteps`): `arrowFrom` {stepId, areaId, `share` (the area's
    longer side in its step's picture units), `box` (the arrow's)} or null;
    `frameShare` and `windowShare` (the frame's and the window's longer sides
    in whole-picture units); `whole` ({paper, units} or fit); `scale` (Size).
    *Deviation:* no stored `run`; runs are derived in the layout. The arrow's
    box rides on `arrowFrom`, and `ZOOM_FILL` moved into `diagramPageLayout.ts`
    (re-exported by `zoomModel.ts`), because the layout must import nothing
    that paints: `settingsStore → diagramExportSettings → stepFileGeometry →
    diagramPageLayout → … → settingsStore` left `DEFAULT_DIAGRAM_EXPORT_SETTINGS`
    uninitialised.
  - **Runs and scale** (`zoomScales`, after the paper and fit runs, every
    other scale known): a run is an enlarged step and those directly after it
    (turns passed), broken by a step that is not enlarged, an arrow, or a
    change of Size — "a step with its own Size starts a run of its own" read
    as that; an enlarged step with no window yet (seeded, before its first
    picture: `LayoutStep.zoomPending`) joins none and breaks none, and no
    arrow prints before it. `arrowArea()` (`diagramPages.ts`) is the one
    arrow rule, read by `layoutZoom` and by `enlargeArrowCount(document)`
    for the export notice. Under
    Fill a run prints one frame size: the least `shared` fit over it, held to
    1–6 × `areaMm`; Size × `areaMm` held the same; each step at that or its
    `own` fit, `reduced` when that bites. A frame turned in its window is
    measured by its own longer side (`frameShare / windowShare`).
    `areaMm` with an arrow: the area's `share` × the area cell's printed frame;
    without one: `frameShare` × the scale of the nearest step of its whole
    picture's kind (before it, else after) × its whole picture's units, or,
    with none, the square box. *Deviation from the letter:* "the scale its
    whole picture would print at among its neighbours" is the nearest
    neighbour's scale; putting the whole picture into `scaleRuns` would move
    its neighbours, which this phase must not.
  - **Read-out.** `LayoutCell.zoom` {asked, printed, reduced}, published per
    step by `printedFrames.ts` as `usePrintedZoom(stepId)` for 16e's Layers
    and Step pane read-outs (the amber under `FIT_ZOOM` is theirs).
  - **Gutter.** An arrow keeps a turn's gutter (`turning`).
  - Tests: `pages/diagramPageLayout.test.ts` ("enlarged steps on the page"),
    `pages/zoomPages.test.ts` (the arrow read from the order, provenance among
    several areas, turns passed; Cut laid out by its content box and centred
    by it), `pages/printedFrames.test.ts`.
- [x] `placeTurns` over `BetweenGlyph`; `LayoutPage.zoomArrows`;
  `CellPicture.framePt`; the composer's arrow and lift, its box measured from
  the painted outline; Pages-view hit targets. Tests: same-row left-to-right
  and right-to-left; a flow row break, in the lane between the rows as D22
  now places a turn; a grid row break; a page break; stacked with a turn; the
  lift clamped clear of the number band; the containment test at any scale
  and page; ids unique per page, clip ids included; the arrow glyph's golden,
  both directions.
  *As built:*
  - `placeTurns` stacks `BetweenGlyph`s (turns, then the arrow, 1.5 mm
    apart) and returns `turns` (type unchanged) and `zoomArrows` {at, box,
    beforeStepId, areaStepId, areaId, rightToLeft, liftable}; a flow row's end
    keeps room for the whole stack (`slotBottom`). `liftable` is the arrow
    alone in the gutter of a row it shares with the area's step.
  - **The arrow** is `zoom/enlargeArrow.ts`: a white arrow, regular, pointed
    tail, on an 11 mm chord bowed up by 0.18 (the path `arcToPath` gives a
    fold arrow of that bend), painted through `paintAnnotations` on a 20 mm
    frame as a turn glyph is, mirrored about its place on a row read right to
    left. Its box is measured from the painted outline (`markReach` over
    the compiled arrow), once per style, since it grows with the arrows' pen:
    **11.63 × 7.91 mm** in the Diagram preset (12.50 × 8.46 at a 3 pt pen),
    not the plan's estimated 12 × 9.5; the layout is handed the document
    style's box, and the box is centred on its place.
  - **The lift** is `pages/zoomArrows.ts`, one function for the composer
    (from the pictures it draws) and for `PreparedDiagramPages.zoomArrows`
    (two `cellPicture`s per lifted arrow, once a page), so the Pages view's
    targets sit over the arrow as printed. y is the area's printed centre
    (`CellPicture.framePt` and the area's `from`), the box clamped into both
    pictures' vertical overlap and below *both* steps' number bands (cell y
    + 8 mm) — the number facing the gutter is either step's, by which way the
    row reads — the numbers first where the overlap is too short.
  - **Pages view:** a target per arrow over its printed box, for the pointer
    only (`aria-hidden`, not a listbox option: the keyboard reaches both steps
    as cells): a press selects the enlarged step, a double press opens the
    area's step in Annotate with the area selected (`zoom/openEnlargeArea.ts`),
    counted as `diagram step opened` with `via: enlarge_arrow`.
  - Tests: the layout's arrow cases in `diagramPageLayout.test.ts`; the lift,
    the right-to-left mirror on a page, the unlifted arrow beside a turn and
    unique ids with two clips in `zoomPages.test.ts`; the containment test in
    `composeDiagramPage.test.ts` with a cut circle at a sheet's edge and a
    turned rounded rectangle; `zoom/enlargeArrow.test.ts` with
    `__fixtures__/enlargeArrowGolden.json` (both directions, recorded with
    `ENLARGE_ARROW_GOLDEN_WRITE=1`); `DiagramPagesView.test.tsx`.
  - Goldens re-recorded: `zoomGolden.json` (each page cell gains `framePt`;
    the cut cases move by their content, the References circle at the sheet's
    edge 14.2 pt) and `closeUpGolden.json` (`framePt` added, nothing else).
- [x] Step files (the windowed painter at the scale rule's size, no arrow);
  the export notices; `diagram exported`'s `enlarged_step_bucket` and its
  docs row; a `diagramPdf.wasm.test` case with a turned rounded clip and cut
  arcs; a real PDF through `pdftoppm`.
  *As built:* `zoomFileFrameMm` (`stepFiles.ts`): Fill against the file's
  picture box, held to 1–6 × the area as the area's own file draws it (or the
  frame as its whole picture would), or Size × that, never more than the box
  holds. Measured on the crane's same-size step files
  (`gate/probe-stepfile.mjs`): step 21 at 22.0 mm and its area 3.96 mm, so
  step 22's window is 23.8 mm (×6) in a 61 mm box, 48 mm on the page ("Open
  with Zach", 2). *Amended* (4f842157d, Zach 2026-10-07): the page's size,
  no larger than the box holds; see the follow-ups below. The export dialog
  says "Enlarge arrows print only on the pages" (or "Turns and enlarge
  arrows…") for step files, and for the PDF
  and the SVG which enlarged step prints on the page after its area — one
  sentence,
  `panels:diagram.pages.zoomSplitStep`/`zoomSplitSteps`, shared with the Pages
  view's notice row (`useZoomSplitNotice`), as `pageSetupLabels.ts` shares
  its keys, its numbers listed by `diagram/stepNumberList.ts` in both, the
  area steps named in the plural too. It names only the splits Start a New
  Page Here on the area's step mends: not an enlarged step that starts its
  page by its own Start a New Page Here, nor one whose area's step already
  starts its page. The arrows the step-files notice counts are the layout's
  (`enlargeArrowCount`), none before a seeded step. New strings: dialogs
  `arrowsLeftOut` and `turnsAndArrowsLeftOut`, panels `zoomSplitStep` and
  `zoomSplitSteps`, in all nine catalogs (32 hashes). `enlarged_step_bucket`
  (`<=0`…`>20`, the empty steps' ladder) and its row in
  `docs/analytics.md`. The wasm case writes a page with a turned
  rounded clip, a cut circle's arcs and the arrow through the real writer;
  rasterised by `pdftoppm`: `artifacts/revision-2/16f/zoom-wasm-1.png`, and
  the app's own PDF (browser writer) `verify/shots/pdf-pages.png`.
- [x] Browser: S6's placements on A4 in grid and flow; the page-break notice;
  the crane's pages before and after its first enlarged step (the gutter),
  kept apart from 16a's reflow.
  *As built:* `artifacts/revision-2/16f/verify/browser.mjs` (before = HEAD
  copies routed, `headBuild.mjs`; after; Chromium light and dark, iPad-sized
  WebKit dark) on Zach's crane, areas on steps 9, 16 and 21 and the steps
  after them enlarged through `zoomFrames.enlargeStep`: a page break (9 → 10,
  the arrow at 10's leading edge, the notice over the pages and in the export
  dialog), one row (16 → 17, lifted to the area, 8 mm in the grid), a flow row
  break (21 → 22, in the lane's bend, mirrored on the right-to-left row) and a
  grid row break (at 22's leading edge). Composites:
  `artifacts/revision-2/16f/16f-before-after-{grid,flow}-p{2,3}.png`. Every
  unenlarged step's scale is the same before and after, in flow and grid; the
  crane already keeps the turn gutter (rooms 48 mm before and after), so its
  first enlarged step changes no room. The PDF (3 pages), the one SVG and the
  composed pages carry the arrows; step files none. `clicks.mjs`: a real
  click on an arrow's target selects the enlarged step and a double click
  opens the area, in Chromium and WebKit; a finger's double tap on an iPad
  is not tried (it is the cards' handler). WebKit's console shows the dev
  server's worker COEP refusal that 16d's runs show too; it follows whether
  Playwright intercepts requests, not the code
  (`gate/probe-webkit-annotate.mjs`).
- [x] Review fixes (2026-10-06): a seeded step parts no run
  (`zoomPending`); the step-files notice counts the arrows the layout prints;
  the arrow's box per style; `via: enlarge_arrow`; the split sentence listed
  one way, naming the area steps, and only for splits a break mends. Tests
  fail before each: `diagramPageLayout.test.ts` (a seeded step mid-run; the
  splits said), `zoomPages.test.ts` (`zoomPending`, `enlargeArrowCount`, the
  style's box), `enlargeArrow.test.ts`, `zoomSplitLabels.test.ts`,
  `zoom/openEnlargeArea.test.ts`, `DiagramExportModal.test.tsx`. Crane
  numbers: `artifacts/revision-2/16f/fixes/after.json` (the reviewer's
  seeded run: step z2 at 25.90 mm with the seeded step as without, was
  12.95); the notice in the app: `fixes/notice.mjs`,
  `fixes/shots/notice-before-after.png`.
- [x] Gate (added as built): in a separate copy of HEAD with this phase's 56
  files laid over it (scripts in `artifacts/revision-2/16f/gate/`), lint,
  tsc and the i18n check clean; 864 test files and 11,492 tests passed, 2
  files and 14 tests skipped; `diagramPdf.wasm.test.ts` ran all six cases
  against the real writer. The commit was checked byte for byte against the
  gated files.
- [x] **For Zach** (the review, 2026-10-06). The first three are "Decided
  with Zach (2026-10-07)" 3, 4 and 1 at the top, decided as recommended and
  built in the follow-ups below; the read-outs are done:
  - *Copied marks shrink a Fill step (S1).* E, a drag, Duplicate Step,
    Enlarged: the copy's marks, carried into the window's units, reach far
    past the frame, and the edge-case rule "marks partly outside the window
    are drawn unclipped and measured" sizes the step by them — ×1.52 on the
    crane, not "filling its room" as S1 step 9 says (×3.67 with them
    deleted), with no warning. The plan contradicts itself; options: (a)
    Enlarged on a copy drops or badges the copied marks outside the window,
    as it drops the copied area; (b) Fill sizes by the content box, marks
    outside the window overflowing rather than reaching; (c) keep the rule
    and say so in the read-out and Pages view. *Decided:* (b), with the
    badge on marks wholly outside the window (86ebf9e12).
  - *A Size mid-run.* A Size change starts a run, and the Fill steps after it
    then start one with no arrow, measured by their own frame, not the area
    they were captured from: their cap and "prints ×N" are against another
    reference. Option: only a step that is not enlarged, or an arrow, resets
    the area; a Size change keeps it. *Decided:* so (493e7b4e1).
  - *The arrow across a flow row break* is mirrored to the next row's way
    and points across the page, not at the enlarged step above or below it
    in the bend: keep D22's placement, or turn it toward the step there.
    *Decided:* turned toward it (2541506f2).
  - *The read-outs* (16e): the Layers pane said the Size asked for and the
    Step pane only "Fill"; `usePrintedZoom(stepId)` has what prints
    ({asked, printed, reduced}) for the plan's "Prints ×3.67" / "Asked ×6 ·
    prints ×2.78 — the room is too small" and the amber under `FIT_ZOOM`.
    *Done in 16e* (63f390cf2): `zoomReadout`/`zoomReadoutText` over
    `usePrintedZoom`, in Layers and the Step pane ("Fill · prints ×N"),
    amber where the room or the area holds it back.

### Follow-ups to 16e and 16f (Zach, 2026-10-07)

**Built 2026-10-07**, to "Decided with Zach (2026-10-07)" 1–4 at the top
(Zach: "please just go with your recommended answers for everything"); 5 and
6 confirm what 16e built and change no code. One commit each. Verified on
Zach's crane at :5291 by the scripts in
`artifacts/revision-2/16-followups/` (`setup.mjs` makes 16f verify's three
enlarged steps), shots in its `shots/`. The batch's gate is the caller's.

- [x] 1. The enlarge arrow across a flow row break points at the enlarged
  step (2541506f2). `LayoutZoomArrow.aim` ({angle, flipped}, `LayoutArrowAim`):
  `placeTurns` aims an arrow standing in the lane's bend from its place at
  the middle of the next picture, flipped where that keeps its bow on the
  outside of the bend (the way the row before read); null on a row, across a
  grid's row and across a page, which are unchanged. The arrow's box is
  measured turned from its painted outline (`aimedEnlargeArrowMm`), and
  `slotBottom` keeps room for its tallest at any aim
  (`tallestEnlargeArrowMm`, 11.65 mm in the Diagram preset, against 7.91
  along a row), since the bend's place is known only after the slot: the
  layout is handed all three (`enlargeArrowSizes`). `paintEnlargeArrow` turns
  the arrow about its frame's middle; the golden is unchanged. Tests, failing
  before: `diagramPageLayout.test.ts` (aimed down into the next row, bow
  outside, its box the aimed box; up on a right page read from the bottom,
  flipped; null elsewhere), `zoomPages.test.ts` (the page prints the aimed
  arrow, not a mirror), `enlargeArrow.test.ts` (turned and centred, its box
  measured turned, the tip along the aim, the bow on the side it is put).
  Crane, 21 → 22 in the flow: at (195.5, 97.8) mm, 124°, a 6.5 × 10.3 mm box
  (`arrow.mjs`, `shots/arrow-flow-page-3.png`, `arrow-flow-zoom.png`;
  before: `16f/verify/shots/after-chromium-light-flow-page-3.png`).
- [x] 2. An enlarged step's step file matches its page enlargement
  (4f842157d). `zoomFileFrameMm(document, laidOut, step, box, pageFrameMm)`:
  the window as its page cell prints it, no larger than the box holds its
  content and marks at; Fill against the box where the pages give no size.
  `prepareStepFiles` lays the pages out once, on the first enlarged step's
  file, with a setter of its own. Tests, failing before:
  `stepFiles.test.ts` (a large file, where six times the area as its file
  draws it is not the page's size: the page's frame and its ×6; Size ×2 as
  the page; a small file held to its box). Crane, same-size 80 × 100 mm:
  step 22's window 48.0 mm in the 61.1 mm box, as its page (×5.61), was
  23.8 (`stepfile.mjs`, `shots/stepfile-21-22.png`).
- [x] 3. Marks outside an enlarged frame don't size it (86ebf9e12).
  `marksTouchingWindow` (`stepView.ts`): the marks an enlarged step is sized
  by. `layoutPicture` measures it by its content and those marks' reach
  clipped to the window; `cellPicture` keeps the same in its room, so a step
  file is cropped to it too; Annotate's fit frames the window alone
  (`annotateFitRect`); Layers badges a mark wholly outside the window,
  drawn or not. Tests, failing before: `zoomPages.test.ts` (measured, and
  kept in its room, as without the copied marks, which still draw),
  `useAnnotateCanvas.test.ts` (the fit is the window), `stepView.test.ts`,
  `DiagramZoomControls.test.tsx` (a mark just off the window badged too).
  Crane, 16e's S1 with the copied marks kept: Fill ×5.94 (48 mm), was ×1.4
  (11.3 mm), ×6 with them deleted; Annotate 70%, was 13%; the copied arrow
  badged (`copied.mjs`, `shots/copied-page-before-after.png`,
  `copied-annotate-before-after.png`). *For Zach:* the copied valley line
  crosses the window, so it is not badged, and drawn whole it now runs down
  the rest of the page under step 20 — the overflow option (b) named. If
  that is not wanted: clip printed marks at the window, badge a mark that
  reaches more than a window out, or have Enlarged on a copy drop such
  marks as it drops the copied area. Two things left as they were: a card
  still grows to take in an enlarged step's marks; and any mark makes a Cut
  frame measure as its whole window, since a mark's reach starts from its
  frame (`annotationReach`), so ×5.94 here, not ×6.
- [x] 4. A run of enlarged steps measures Size against its area (493e7b4e1).
  `zoomScales`: only an arrow, or a step that is not enlarged, starts a run;
  each step prints at its Size × the run's area, or the run's one Fill size,
  held to 1–6 × the area. Tests, failing before: `diagramPageLayout.test.ts`
  (steps captured from an earlier enlarged step, half its frame, at ×2 and
  ×1.5 of the run's area; Fill after a Size held to ×6 of it). Crane: 22
  (Fill, ×5.61) duplicated as 23, its frame 0.6 of 22's and Size ×2: 17.1
  mm, twice 21's area of 8.56 mm, was 10.3 mm while reading "prints ×2"
  (`runsize.mjs`, `shots/runsize-before-after.png`; before is the layout at
  4f842157d, routed).
- [x] 5 and 6 recorded as confirmed: the marks' reach (`windowReach`) and the
  frame dropped in a spread's strip settling on the layer above.

### 16g Enlarged steps: changing pictures, new steps, moves and deletes

**Built 2026-10-07** (commit d19e80be9, 39 files), after a review, a fix
pass and a verify. It retires 16e's "Not shipped before 16g". Every edit of
an enlarged step's own picture moves its frame and marks through one funnel;
every way a step is made after an enlarged one seeds it; moves and deletes
change no frame; copy and paste remember their units. Verified on Zach's
crane at :5291 by `artifacts/revision-2/16g/final/` (`runAll.sh`; composite
`artifacts/revision-2/16g/16g-before-after.png`, `composite.py`), each
command run against HEAD's sources routed in (`headBuild.mjs`) and against
16g. What its review and verify left for Zach is decided ("Decided with
Zach, after 16g", at the top) and built ("Follow-ups to 16g", below).

- [x] Seeding through one funnel for every way a step is made after an
  enlarged one: Add Step and Insert Step After (16e seeds these two), and an
  upload of several pictures, a References pull and a References fill of an
  empty enlarged step (`pullReferencesDiagramSteps`), which 16e neither
  seeds nor lands (`landSeededFrame`). Decide which `via` an empty step
  turned Enlarged counts: today `trackCaptured` drops a capture with
  `placed: null`, and its first picture counts it as `seeded` (review of
  16e, 2026-10-06).
  *As built:* `zoomCapture.seededCapture` returns the whole `ZoomCaptured`
  (`seededZoom` wraps it); `zoomFrames.seedNewSteps(document, stepIds,
  assets)` walks the diagram's order, turns passed and steps with a frame
  left, so a run of new steps is enlarged through; `landSeededFrame` returns
  `LandedFirstFrame`. The slice's `addAt` seeds; its new `commitMade` lands a
  filled step first, then seeds the steps made after it, for
  `addDiagramPictures` (fill and insert), `setDiagramStepPicture` and
  `pullReferencesDiagramSteps`. Duplicate keeps the frame, the imprint and
  the provenance. Uploads and References cards have no faces: a first
  picture's frame is copied at the same place on its picture. Counting: an
  empty step turned Enlarged counts `via: toggle` when its first picture
  lands the frame; an empty step's first picture counts once, on that step,
  in the session it was made or toggled in (`awaitingPicture`); a
  duplicate, a picture put back, or a reload first counts nothing
  (`docs/analytics.md`). Crane: uploads and a References pull give 3 of 3
  enlarged, were 0 of 3; Insert Step After then Link lands within 0.85
  sheet units of 24's paper; each route one undo step (`c/p4-seeding.mjs`).
- [x] Seeding on insert and duplicate; the carries on enlarging and
  un-enlarging; the frame re-landed on its own step's refresh, relink and
  re-pose, marks with it, a spread turned on, off or changed among the
  re-poses (the frame moves with the layer under its centre, its size and
  angle unchanged); moves and deletes changing no frame. The invariant
  helper runs after each verb. Copy and paste remember their source view
  (picture key and window), with `annotationClipboard.test.ts` cases for a
  paste between two enlarged steps of one picture and from an enlarged step
  to a whole one.
  *As built:* `annotationCarry.withCarriedAnnotations` hands an enlarged
  step to `zoomFrames.followOwnPicture(before, after, OwnPictureChange)`:
  a move the app made (Pose's turn, flip, spread) → `reposeFrame`, the
  frame landed from its imprint (carried by the move with no faces) and the
  marks by the pose's move, window to window, in step; recoloured only → the
  frame landed where it was, the marks in step; anything else (Refresh,
  relink, Show as, Turn Over, a camera, a first picture) → `relandFrame`,
  the marks unchanged in window units and out of step (D8), out of step too
  when the frame moved under the same picture key. Its callers:
  `setLinkedPicture` (Refresh, Link, Pose's commits), `setReferencesSide`,
  `setReferencesWay`, `setUploadPose`, Pose's spread preview. Upload and
  References fills bypass it and land in `commitMade`. Calling `zoomFrames`
  from `annotationCarry` made an import cycle that crashed the app at load,
  so `readPaperFaces`, `storedPaperFaces` and `SCENE_JSON_MAX_BYTES` moved
  to `document/paperFacesFile.ts`. Clipboard: `DiagramAnnotationView`
  {pictureKey, window}, `copiedView` (the units always, the key only while
  the marks are in step), `intoView` (Decided after 16g, 7) and
  `pastedAnnotations` inside the target step's reach. The watcher
  `zoomInvariant.fixtures.watchFrames` checks `frameProblems` and, through
  `marksProblems`, that marks on enlarged steps whose picture did not change
  stay on their paper, after every store change, in the zoom, clipboard,
  controls, step and canvas tests. Crane: Rotate Right on 23 moves the
  paper the frame shows 0.28 sheet units, was 14.8; frame centre 0.016,
  marks 0.0039, in step, 0 invariant problems, was 1; Spread off 2e-13; a
  relink and a Refresh of an enlarged tail copy to Pattern 21 keep it within
  5.1, was 242, marks within 3.5, was 164, with D8's notice; pastes 22 → 23
  and 23 → 22 0 picture units off, were 0.60 and 0.58 (`c/p1`–`c/p3`). The
  same in Chromium dark and iPad WebKit.
- [x] The area's own carries (a re-pose at any angle by `carryZoom`; a
  Refresh by D8); the References, upload, 3D and simulated paths in picture
  units; a capture older than `paperFaces` and its notice; every notice, on
  cards, the Step pane, Layers and Export.
  *As built:* faceless pictures carry their frame by the pose's move
  (uploads, a References side) or keep it (a 3D camera); the area's own step
  carries its area at any angle and leaves enlarged steps alone. A step
  given its faces inside another step's verb (`diagramZoom.withPaperFaces`)
  goes through the new `zoomFrames.anchorInPlace`: its frame and marks stay
  as they show, its imprint made again from the frame (a picked anchor
  kept); a frame in a spread's strip settles on the layer above, its marks
  on their paper; one its paper cannot anchor drops its imprint, and the
  Step pane says to anchor it. 16e's and 16f's tests cover every notice; the
  browser saw D8's, "Out of date: the pattern changed" and Refresh Picture.
  Also from 16e's verify: one Escape on the iPad puts Pick down and keeps
  the sheet open (`registerArmedMode`); the badge on its own line; a fixed
  Size reads as typed, in the language's numbers (`zoomNumber`); card
  headers keep the step number whole (`.number`, `.kindBadge`, en, de, fr at
  1440–390 px).
- [x] `diagram-workspace.md` amended: D2, D8, D10, D22, the Later list, Phase
  16.
  *As built:* D8 states the funnel, the backfill and the paste rule; "per-step
  zoom" leaves Later; Phase 16 is added.
- [x] Browser: S3–S5 by hand on the crane; before and after beside the two
  examples; light and dark; Chromium and iPad-sized WebKit; a PDF through
  `pdftoppm`.
  *As built:* six runs (Chromium light and dark at 1440 × 900, iPad-sized
  WebKit at 1024 × 1366 by touch), each before and after, no app console
  errors; the PDF's page 3 shows 23 re-posed; the crane, heart, chipmunk and
  Reference Diagrams load with 0 locked and 0 unknown and write back
  byte-identical (Reference Diagrams differs only by its retired `scale`).
  Refresh was set up by pointing a link at another stage's sheet, not by
  editing the pattern; Refresh Picture itself was clicked.
- [x] Gate (added as built): in a copy-on-write clone of c716ce3f4 with
  exactly the phase's 39 files, lint, tsc and the i18n check clean; 872 test
  files and 11,627 tests passed, 2 files and 13 tests skipped. Not run:
  `npm run build:web` (the Final gate's).

### Follow-ups to 16g (Zach, 2026-10-07)

**Built 2026-10-07**, to "Decided with Zach, after 16g" 8, 10, 11 and 12
(Zach: "use your recs and include the enlarged steps follow ups in the
branch"). One commit each. Verified on Zach's crane at :5291 by the scripts
in `artifacts/revision-2/16h-followups/`, each run against HEAD's file routed
in and against the fix, shots in its `shots/`. Tests near each, failing
before; tsc and eslint on the changed files. The batch's gate is the
caller's.

- [x] 8. A copied line crossing an enlarged frame is trimmed just past it
  (0737ee197). `zoomFrames.trimmedAtFrame`: a valley, mountain or hidden
  line crossing the frame (`zoomModel.stretchInside`, its stretch in the
  convex outline) ends `ZOOM_LINE_OVERSHOOT` (0.04 of the window) past the
  rim at each end that lay farther out, along itself, never longer. Applied
  by `withZoom` when marks go from the whole picture into a window (Enlarged
  on, a duplicate's included; a seed bringing a picture's marks in), after
  the there-and-back check (`carryMarks`' `finish`). `marksProblems` accepts
  a line trimmed along itself, and its undo. Tests, failing before:
  `zoomFrames.test.ts` (across, out of and off-centre through the frame
  trimmed on the same line; inside, outside, an arrow and a label as they
  were; turned off, still trimmed; a seed trims; never lengthened),
  `zoomModel.test.ts` (`stretchInside`), `diagramZoom.test.ts` (S1 with the
  line through the head: one undo step, trimmed, kept so). Crane, 16e's S1:
  the copied valley line ends 0.54 of the window from its centre at both
  ends, one end was 5.09 down the page (`trim.mjs`,
  `shots/trim-page-before-after.png`).
- [x] 10. An enlarged step's first link starts in its source's turn
  (e2058fc94). A whole step's first link starts at no turn, its spread from
  earlier steps, so this is new for enlarged steps only:
  `zoomCapture.firstLinkPose` gives `linkDiagramStep` the capture source's
  rotation, which holds an Upright, and a flat fold's side, with the new
  flat pose's spread; Show as mirrors a back side's turn onto a crease
  pattern. A relink keeps the step's own pose. Tests, failing before:
  `stepCaptureActions.test.ts` (158° folded and as a crease pattern; a back
  side; a whole step at 0°; a relink). Crane: Insert Step After on 24, Link…
  › Folded › Pattern 24 links at 158°, was 0°, its frame within 1e-4
  picture units of 24's (`rotation.mjs`, `shots/rotation-before-after.png`).
- [x] 11. Every step of a run made after an enlarged step keeps its imprint
  (1bb4ed75e). `seedNewSteps` captures each step of a run from the run's
  source (`zoomCapture.seedSource`); a step the same edit fills starts the
  run as it was before its picture, which `commitMade` passes. Tests,
  failing before: `zoomFrames.test.ts` (three uploads, each the source's
  imprint; after a filled step), `diagramZoom.test.ts` (uploads; a
  References fill and the card after it). Crane: two uploads after 24, the
  second's imprint false before, true after (`uploads.mjs`). A step inserted
  after the run still lands in picture units: "Open with Zach".
- [x] 12. Show as Crease Pattern lands an enlarged frame on the paper its
  window showed (067c73dda; Z8 amended). `zoomFrames.landedOnSheet`: a folded
  step shown as its crease pattern imprints its frame afresh through the
  face on top at its centre and lands it on the sheet, the imprint kept;
  `anchoredOffSheet`: shown folded again, the frame lands from it and is
  anchored again by Z9's rule. A picked anchor, a picture with no faces, or
  paper off the sheet keeps the old landing. Tests, failing before:
  `zoomFrames.test.ts` (on the sheet, the paper the folded window showed at
  its centre, was 281 sheet units off; folded again, where it was, its
  imprint the default anchor's, no invariant problem; a picked anchor by
  its pick). Crane, step 23 by Pose's toolbar: the frame's centre on the
  head's paper (6e-14 sheet units), was 311; the mean paper the window
  shows 11.3 from the folded one's, was 288, the sheet showing paper the fold
  hid; Folded again 0 from the start; one undo step each, no invariant
  problems (`showas.mjs`, `shots/showas-before-after.png`).

### Final gate

- [ ] Lint, typecheck, the i18n check and the whole vitest suite
  (`npm run lint:web`, `typecheck:web`, `i18n:check`, `test:web`), and
  `npm run build:web`, as bundling and the PDF path change.
- [ ] The crane: every mark known, nothing locked, every step saved back
  byte-identical (the file differs only by the page setup's `scale`, no
  longer written since 95a516de1); its pages and PDF compared with the build
  before Phase 16, each difference traced to the phase that made it.
- [ ] This checklist current, with what was built written under each phase.
