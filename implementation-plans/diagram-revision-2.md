# Diagram, Revision 2: equal divisions, a right-angle mark, enlarged steps

**Status: planned (2026-10-05), not built. Every decision below is PENDING:
the build waits on Zach's answers.** Phase 16 of
`implementation-plans/diagram-workspace.md`, after Phase 15
(`implementation-plans/diagram-annotate-second-pass.md`), whose kinds, tools,
painter and close-ups this builds on. Built by hand, phase by phase, as Phase
15 was. Paths are under `apps/web/src/` unless they say otherwise. The
decisions, as things to try (gitignored, beside the other diagram artifacts):

- `artifacts/revision-2/enlarged-steps.html`: enlarged steps, drawn from
  `crane.osf`, with its six decisions numbered 1–6 (Z1–Z6 here), the knobs
  for what is settled by evidence, the flows S1–S6, a printed page and the
  two examples beside it.
- `artifacts/revision-2/revision-2-marks.html`: the equal-divisions mark
  (its decisions numbered 1–13, ED1–ED13 here) and the right-angle mark
  (RA-0–RA-8, RA0–RA8 here), at print size on white, grey or the sketch's
  paper. Its "Copy picks" text names each decision by those numbers.

The decision names here follow the prototypes' numbering, so picks pasted
back map one to one. Where a decision names something to judge on a
prototype (a white-paper panel, a row of layered edges, glyph variants,
narrow flaps), that is what the prototype must show; 16.0 checks it does.

**How the text reads while decisions are PENDING.** Each part is described
as it would be built under the recommended options. Wherever the text
depends on a decision it names it, as "(Z2 A)", and that decision's entry
says what changes if Zach picks another option. Nothing marked that way is
settled until 16.0 records his answer.

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
step keys and annotation kinds only, so it neither helps nor blocks it.

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
  (`crane.osf`) loads with every mark known and saves back byte-identical
  after every phase. `DIAGRAM_FORMAT_VERSION` stays 1; the Diagram is
  unreleased (PR #436).
- **Keys.** D (Equal Divisions, ED8 A), E (Enlarge) and Shift+E (Enlarge in
  Frame) (Z1 A) are unbound in the Diagram's scope today
  (`keyboard/shortcuts.ts:600-625`). Plain D is Edit's Edge line type and
  plain E its Extend Line (`shortcuts.ts:242, 267`), both in the
  crease-pattern scope, which is never live with the Diagram's, as S and F
  already are. Under Z1 A and ED8 A the rail's Marks group reads Circle,
  Right Angle, Equal Angles, Equal Divisions, Close-Up, Enlarge, Enlarge in
  Frame (today: Circle, Right Angle, Equal Angles, Close-Up,
  `annotateTools.ts:108-123`).
- **Decisions** are named Z1–Z6 (enlarged steps), ED1–ED13 (equal divisions)
  and RA0–RA8 (right angle), as the prototypes number them. Each has a
  recommendation; none is decided.
- **Names.** The UI, tool ids, i18n keys and analytics say *enlarge*; types,
  modules, fields and the file say `zoom`. A component is code, so it is
  `DiagramZoomControls`, `DiagramZoomView`, `DiagramStepZoomStatus`.

### 1. Enlarged steps

**Words.** The UI says **Enlarge**: Sturm's and Lang's word, with E as its
key. A rail tool called "Zoom" reads as a magnifier and collides with the
canvas's own zoom. Code and the file say `zoom`. Calling it "Zoom" instead is
a string change.

**The design in one paragraph.** Step 55 carries a `zoom` annotation, *the
area*: a circle or a rounded rectangle in 55's picture units, with an optional
Size and Edge. Each enlarged step carries `zoom: { window }`, the area's box
mapped onto its own picture. An enlarged step owns its picture (D2 untouched)
and shows a window of it. Its marks are in the window's units, so the window
is its frame (D8). Its area is found by walking back over turns and enlarged
steps to the first other step, which must hold an area, so no step stores
another step's id. Consecutive enlarged steps form a *run*, and the arrow
prints before the run's first step. Windows land on later pictures through a
sheet-centred *plane*. Every edit is one undo step.

**What depends on Z1 and Z2.** The model, walkthroughs, controls and file
format below follow Z1 A (an area mark drawn on the step before) and Z2 A (a
per-step Enlarged toggle, seeded). If Zach picks Z1 B, the region moves to
each enlarged step: a frame placed in a Pose Frame mode, with the ring on the
step before drawn from it and read-only. The `zoom` annotation kind, its
grips and its Layers row then go, and `DiagramStepZoom` gains the frame. Z1
C makes the area a close-up with a Show field and no new kind. Z2 B adds
Enlarge and Whole entries to the step order, which reopens the `isTurn`
consumers (about a dozen production sites) and replaces the Pose toggle and
seeding. Any of these rewrites this section before 16c starts. Z3–Z6 change
only the parts that name them.

This is the synthesis of four proposals and three judgements (design work of
2026-10-05; see "Alternatives considered"). What it avoids: an enlarged step
with no picture of its own; steps linked by annotation id (paste and duplicate
re-id marks); one step's Pose re-posing another; a Frame sub-mode in Pose; the
feature hidden in Close-Up; an arrow that moves between the ring and the
gutter by itself; rings or windows that vanish without notice; a new entry
kind, which would reopen every `isTurn` consumer.

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
- **No keep-together rule.** Across a page break the arrow follows D22 and
  prints at the next picture's leading edge, and a notice names the split.
- **Each step keeps its own pose** (D5, D19). A pose that differs from the
  area step's gets a notice and a **Pose Like Step 55** verb. It is never
  propagated.
- **Deleting ends an enlargement** (deleting an area, or the step that holds
  it), and the verb or its confirmation says so. **Moving steps never changes
  what any step stores.**
- **One area per step, and no enlargement of an enlarged step in v1.**

The prototype has knobs for the overshoot (0.2 r or a fixed 2 mm), the
boundary pen (edges or arrows) and the word (Enlarge or Zoom), to check these
by eye, and a fourth that maps windows by plain picture units instead of the
plane, to show why the plane is needed. A knob Zach turns becomes a decision.

#### Walkthroughs

**S1, look 1: 55 → 56 (a flat fold; a circle; the arc only).**

1. Open 55 in Annotate: double-click its card, or its Annotate corner button.
   Or card menu (or the Step header's ⋯) › **Enlarge After…**, which opens 55
   with the tool armed.
2. Press E, or click **Enlarge** in the rail's Marks group. The tool window
   says "Drag out from the middle of an area to show it enlarged in the next
   step. Click for a standard size." The centre does not snap, as a close-up's
   does not.
3. Press on the middle of the head and drag out until the rim cuts the brown
   flap. A live ring follows the pointer.
4. Release. One undo step, "Enlarge":
   - the circle is added to 55 in the ring pen, with no casing (Z5);
   - **step 56** is inserted directly after 55, before any turn that follows
     it: a copy of 55 (the same link, picture and pose) with no marks and no
     words, and `zoom.window` set to the circle's box. It has the same picture
     key, so the map is the identity;
   - under Z6, if the step after 55 already shows the very same picture, or is
     already enlarged, that step is enlarged instead, and the undo label reads
     "Enlarge · step 56";
   - Annotate stays on 55 with the area selected. Layers shows its row,
     **Enlarge · step 56**: Shape Circle · Size empty (placeholder "Fill ·
     ×4.4") · Edge Cut · Go to Step 56 · Delete. A canvas-only chip, "56 →",
     sits beside the area; it never prints.
5. Press → (Next Step, `shortcuts.ts:580`). Annotate opens 56 with the window
   as its frame: the head enlarged and clipped to the circle; one arc where
   the circle crosses paper, running on about 0.2 r past each crossing;
   nothing else of the model.
6. Draw 56's marks as on any step: Shift+V and a drag for the valley line, V
   and a drag for the arrow, the caption in Step › Instruction. Labels, heads
   and snapping behave as on any step, because the window is the frame.
7. Pages view: 55 with its full circle; the hollow, pointed-tail arrow in the
   gutter at the circle's printed height, pointing at 56 (Z3 A); 56 filling
   its room (Z4 A).

The gesture is E, one drag, →.

**S2, look 2: 46 → 47 (an interior region; a rounded rectangle drawn whole).**

1. Open 46 in Annotate and press Shift+E (**Enlarge in Frame**).
2. Drag corner to corner around the central column. Shift makes it square; Alt
   drags from the middle. The corners round at 0.22 × the shorter side.
3. Release. One undo step: the rounded rectangle is added to 46 in the ring
   pen, over a white casing that knocks out the creases it crosses; 47 is
   inserted as a copy of 46; Edge is Whole.
4. Press → to open 47: the column enlarged inside the whole rounded rectangle,
   drawn in the edges pen; the model's lines stop at the frame. Press H for
   the hidden line, draw the loop arrow, type "Bring the hidden corner to
   front."
5. Pages view: the arrow mid-gutter at the frame's height (Z3 A); 47's tall
   window runs down its room, with the caption under it.

**S3, adjusting afterwards.**

- **Move or resize**, on 55. The area hits on its outline only, and last,
  under the other marks, as a close-up does, so marks inside it stay
  clickable. Selected, its centre dot moves it and its rim resizes it; a
  rectangle has 4 corner and 4 edge grips (Shift keeps the aspect, Alt resizes
  about the centre). Grips are at least `--touch-target` on coarse pointers.
  Each drop is one undo step; the cards of 56–60 and the Pages view repaint on
  drop. The marks on 56–60 stay on the same paper: they are carried by the
  window's move, a scale and a shift.
- **From an enlarged step.** Layers' first row on 56 reads **Enlarged from
  step 55** (the boundary drawn on this step). Selected, it shows the same
  Shape, Size and Edge, which write 55's area, and **Edit Area on Step 55**,
  which opens 55 in Annotate with the area selected. Double-clicking the
  boundary on 56's canvas, or the arrow in the Pages view, does the same.
- **Size** (Z4 A; under B it is never empty, 2 when unsaid). Empty means
  Fill. Type 1.25 and the run prints at 1.25 × the
  area's printed size; where a room cannot hold that, the read-out turns
  amber: "Asked ×3 · prints ×2.4 — the room is too small". Clear the field to
  go back to Fill.
- **Shape** [Circle | Rounded rectangle]. A circle of radius r becomes a 2r ×
  2r rounded square; a w × h rectangle becomes a circle of radius ½·max(w, h).
  A circle round-trips exactly. An unsaid Edge follows the new shape; a chosen
  one is kept.
- **Edge** [Cut | Whole]. Cut is disabled, with the hint "This picture has no
  paper outline to cut along", when no step in the run has a paper outline
  (uploads, fixed SVGs, raster captures). Such steps always draw Whole.
- **Delete**: the verbs row's Delete, or Delete/Backspace with the area
  selected. Its tooltip reads "Delete — steps 56–60 show the whole model". One
  undo step: 56–60 lose `zoom`, and their marks are carried from the window to
  the whole picture.
- **End the run early** (Z2 A). On 58, Pose's Enlarged toggle reads **Whole
  Model from Here**; it turns 58–60 to the whole model in one undo step.

**S4, folding on while enlarged (57–60), then 61 whole** (Z2 A).

1. 56 is enlarged. In Edit, fold the next crease, on a new sheet (one per
   stage) or on 55's own sheet.
2. In the Diagram, 56 › **Insert Step After** (or Add Step with 56 last). The
   new **57 starts Enlarged**, seeded because the step before it is, as Spread
   Layers is seeded (`spreadStartsFor`, `diagramDocument.ts:263`). It is an
   empty card with the chip "Enlarged · 55".
3. **Link Pattern…** › the sheet › Folded. 57's window is derived from 55's
   area through the plane (pattern units about the sheet's centre, each step's
   turn undone), so it frames the head although the folded model's bounds
   changed. If the window would hold no paper, the Step pane warns "The
   enlarged area holds no paper on this step." Another route: **Duplicate** 56
   (the copy keeps Enlarged, the window and the marks), delete the marks that
   no longer apply, then Link Pattern… or Refresh.
4. Annotate 57 in its window. Repeat for 58–60.
5. For 61: Insert Step After 60 (it starts enlarged), Link, then release
   Pose's pressed **Enlarged** toggle: 61 shows the whole model. Nothing
   prints between 60 and 61.
6. Pages view: 56–60 at one size (Fill's smallest over the run); 61 back in
   54–55's Fit-each run, as enlarged steps are left out of runs.

**S5, the area's step changes; References; uploads.**

- **55 Out of date → Refresh.** The area **follows the paper** when the old
  and new captures share scope, way, side, turn and `paperScale`, because then
  the plane map is exact. This is a new D8 exception, for areas only; 55's
  other marks behave as D8 says. The windows of 56–60 do not move. 56 links
  the same pattern, so it shows Out of date too, and Refresh All refreshes it.
  If the plane does not map (the way or the side changed), the area stays in
  picture units, out of step with D8's notice, and 56–60 keep their windows
  with the notice "Step 55's area no longer maps onto this step".
- **55 re-posed** (Rotate, the Rotation field, Upright, Spread). `carryZoom`,
  modelled on `carryCloseUp` (`annotationModel.ts:1571`), moves the area with
  the paper: its centre with the face under it, its size with the move. A
  rectangle's sides swap on odd quarter turns; at any other angle it stays
  upright. 56–60 keep their own poses and windows. 56's card chip and Step
  pane say "Step 55 is turned 90° from this step", and Pose's toolbar on 56
  offers **Pose Like Step 55**: one undo step that re-poses 56 to 55's turn
  and side, its marks carried through the window as any pose carries them. A
  flat fold **Turned Over**: D8 does not carry a side change, so the area goes
  out of step; 56–60 keep their windows, with "Step 55 shows the other side",
  and Pose Like Step 55 turns 56 over too.
- **55 deleted.** The confirmation, in D24's form: "Step 55 holds the enlarged
  area for steps 56–60. Deleting it shows them whole." One undo step: 56–60
  lose `zoom`, and their marks are carried to whole-picture units.
- **Reordered: moves are literal.** 56 moved before 55 has no area before it.
  It prints whole, its marks mapped from its stored window, with the card chip
  "No area before it" and a Step pane notice; 57 now follows 55, so the arrow
  is 55 → 57. Moving 55 away does the same to 56–60, and moving it back
  restores everything, since nothing stored changed. A step that is not
  enlarged, moved into a run, splits it, and the steps after it say so.
  Inserts never split a run, because they are seeded.
- **Duplicate 55.** The copy, its area with a fresh id, lands between 55 and
  56 and becomes the area step. 55's area then enlarges no step; Layers says
  "Enlarges no step" and offers **Enlarge Next Step**. Literal and visible.
- **A References step.** Picture units are the card's sheet (`model.sheet`).
  The copy maps by identity; later cards of the same sheet size map through
  the sheet (`mirrorMove` when one card is turned over). The enlarged card is
  rebuilt at the larger sheet size (`paintStepDiagram`), so letters and
  arrowheads keep their pt size. Cut follows the sheet's rim and the flap
  polygons the card draws.
- **An upload.** The same asset maps through its pose (`poseMove`). Edge is
  forced to Whole. A raster enlarged below 200 dpi at its printed size gets
  "Kept as a bitmap — it prints soft". **A picture that is not step 55's**
  (another upload, such as a hand-drawn enlargement, or a capture shown
  another way) cannot be mapped: it is taken as already enlarged and drawn
  whole inside the frame, Edge Whole, with "This picture isn't step 55's:
  drawn whole inside the frame".

**S6, print.** Defaults: A4 portrait, 12 mm margins, 3×3 grid, Fit each; each
cell 62 × 84.67 mm. Sizes follow Z4 A and the arrow's places Z3 A (B tries
the ring first; C drops the lift).

- **Gutter.** A diagram with any enlargement reserves D22's 14 mm gutter
  between every pair of rooms (`diagramPageLayout.ts:764-769`), as one turn
  does. Rooms are 48 mm wide instead of 56.
- **Sizes.** 55 prints at its run's scale: an area ringing 0.3 of a 48 mm-wide
  model is about 14 mm across. Under Fill, 56's cut content fills its 48 mm
  room, so the window is about 64 mm: "Prints ×4.4". The empty, off-paper part
  of the circle takes no room. Look 1's literal ×1.25 would give an 18 mm
  picture in a 48 mm room.
- **Same row** (55 in column 1, 56 in column 2). The arrow is centred
  mid-gutter (x = 74 mm); its box, about 12 × 9.5 mm, clears both rooms by 1
  mm. It sits at the area's printed centre height, with its box clamped inside
  both drawn pictures' vertical overlap, clear of 56's number band. It points
  right and bows up.
- **Grid row break** (55 in column 3, 56 in column 1 of the next row): half a
  gutter before 56's left edge, x ≥ 7 mm, at 56's centre height, pointing
  right. No lift.
- **Flow.** A left-to-right row as the grid. A right-to-left row: mirrored,
  pointing left, the bow still up, the lift applied. A row end (56 directly
  under 55, starting a right-to-left row): half a gutter outside 56's right
  edge, at its centre height, pointing left, on the flow band; it never
  crosses 55's caption.
- **Different pages.** The area prints with 55 on page p and the arrow on p+1
  at 56's leading edge. The Pages view and the Export dialog say "Step 56 is
  on the page after its enlarged area"; the fix is **Start a New Page Here**
  on 55.
- **Paper and Fit each.** Enlarged steps leave both policies: they never lower
  Paper's shared mm per unit and never enter `scaleRuns`. They print at Fill,
  or at Size × the area's printed size. 55 and 61 stay neighbours in one
  Fit-each run. D10 is amended to say so.
- **A turn between** ([55, Rotate, 56]): the rotate glyph and the arrow stack
  in one gutter, turns first, 1.5 mm apart. No lift.
- **PDF**: the composed page SVG goes to the writer unchanged; krilla's clip
  paths were proven in 15f.
- **ZIP step files.** 55 keeps its area. 56 is framed alone, at Fill against
  its file's picture box, or at Size × 55's area size in the files. No arrow:
  the `turnsLeftOut` notice (`DiagramExportOptions.tsx:223-230`) becomes
  "Turns and enlarge arrows print only on pages".

#### Controls, pane by pane

- **Annotate rail, Marks group, after Close-Up** (Z1 A). **Enlarge (E)**
  draws a circle from its middle; **Enlarge in Frame (Shift+E)** draws a
  rounded rectangle corner to corner. They are `DrawingTool` ids `ENLARGE`
  (`'enlarge'`) and `ENLARGE_FRAME` (`'enlarge-frame'`), as `SOLID_ARROW` is
  one, laying kind `zoom` with a look `{shape}`; `drawingLook`
  (`annotateTools.ts`) widens from `WhiteArrowLook` to a per-tool look, after
  the Solid Arrow's precedent. Keys go through the registry:
  `DiagramAnnotateShortcutId`, the `diagramShortcut` definitions,
  `ANNOTATE_SHORTCUT_IDS` (`diagram/actions/diagramShortcuts.ts`) and
  `i18n/shortcutLabels.ts`. The tools are disabled, with a reason, on a step
  with no picture; on an enlarged step ("Enlarging further in comes later");
  on a step that already holds an area ("Step 55 already enlarges an area:
  select it to change it"); on a locked step; on a read-only diagram. No
  pre-draw option is added: Line Type stays the rail's only one.
- **Annotate canvas.** On the area step: the area, selectable with grips, and
  the "56 →" chip. On an enlarged step: the frame is the window, and
  double-clicking the boundary runs Edit Area on Step 55.
- **Layers pane.** On the area step: the row "Enlarge" (with its glyph),
  subtitled "Steps 56–60". Selected, it shows **DiagramZoomControls**, a new
  component with its own CSS module: Shape [Circle | Rounded rectangle]
  (SegmentedRow); Size (NumberRow, ×, 1.25–6, step 0.25, empty means Fill,
  placeholder "Fill · ×4.4"); Edge [Cut | Whole] (SegmentedRow); a read-out
  line; and the verbs from the `zoomActions` catalog: Go to Step 56 · Enlarge
  Next Step (only when it enlarges no step) · Delete. On an enlarged step: the
  first row, "Enlarged from step 55"; selected, the same controls, writing
  55's area, plus Edit Area on Step 55. This selection lives only in Layers;
  the canvas gains no second selection model. Marks lying wholly outside the
  window grown by one window are kept, not drawn or measured, and carry an
  "Outside the enlarged area" badge.
- **Pose toolbar** (Z2 A), on both paths (the linked catalog behind
  `DiagramLinkedPoseControls`, and `poseActions` for uploads and References;
  `DiagramStepDetail.tsx:176-208`). **Enlarged** is a pressed toggle, a
  descriptor from `diagram/zoom/zoomActions.ts` shaped like `spread-layers`
  (`diagramLinkedPoseActions.ts:208`). It is offered when the step before
  (turns skipped) is enlarged or holds an area, and disabled on a step that
  holds its own area. Turned off with enlarged steps after it in the run, it
  is labelled **Whole Model from Here**. **Pose Like Step 55** appears only
  when the step's turn or side differs from the area step's.
- **Pose stage of an enlarged step**: the whole picture, the window outlined
  dashed in the selection ink, everything outside dimmed by 45% page colour,
  the marks ghosted in place. Screen-only; no verbs. A live 3D or simulated
  view shows the outline ghosted over the camera.
- **Step pane** (fields only): **DiagramStepZoomStatus**, with its own CSS
  module, mounted by one line in `DiagramStepPanel` after Pose. A read-only
  row, "Enlarged · area on step 55 · prints ×4.4", the step number a link; and
  the notices: no area before it; the area no longer maps; posed differently;
  shows the other side; not step 55's picture; holds no paper; prints soft.
  Each names the Pose toolbar verb that fixes it; the pane has no buttons.
- **Step catalog** (card menu, Step header ⋯, menu bar; `diagramActions.ts`,
  beside Insert Turn Over After, l.266-277): **Enlarge After…** on a step with
  a picture that is not enlarged, arming the tool; **Whole Model from Here**
  on an enlarged step; the delete confirmation for an area step.
- **Steps grid**: an "Enlarged · 55" chip with the arrow glyph on enlarged
  cards (`DiagramStepCard.module.css`), and its warning forms, "No area before
  it" and "Area doesn't map".
- **Pages view**: a hit target for each arrow, as for turns
  (`DiagramPagesView.tsx:102-121`). A click selects the run's first step; a
  double-click opens the area step in Annotate with the area selected.
- **Export dialog**: notices for arrows left out of step files, an enlarged
  step on the page after its area, an area that enlarges no step, enlarged
  steps with no area before them, and enlarged steps whose area no longer
  maps or shows the other side (their window prints, but may not match the
  ring on the step before).
- **Page pane**: nothing new.
- **Where the behaviour lives**: `diagram/zoom/zoomActions.ts` (a React-free
  catalog), `diagram/zoom/useZoomControls.ts` (the Layers bindings) and
  `diagram/zoom/useStepZoom.ts` (the Step pane and Pose toggle bindings).
  Every edit is one undo step through a `diagramSlice` verb; `DiagramLayers`
  and `DiagramStepPanel` only compose.

#### Model and file format

```ts
// diagram/document/diagramDocument.ts
export type DiagramAnnotationKind = /* today's 17 (l.555) */ | 'zoom';
/** How an enlarged step draws its area's outline: only where it cuts paper (look 1), or all of it (look 2). */
export type DiagramZoomEdge = 'cut' | 'whole';

interface KnownDiagramAnnotation {
  /* …existing… A `zoom` is the AREA, drawn on the step before its enlarged steps:
   *   from = to = the area's centre, in this step's picture units
   *   radius = a circle's radius (0.015–1, the close-up's range and reader)
   *   scale  = the enlarged steps' size: that many times the area as it prints here, 1.25–6;
   *            unsaid = Fill under Z4 A (under Z4 B, 2, as a close-up's unsaid scale stays) */
  /** A rounded rectangle's width and height in picture units; exactly one of `radius` and `size`. */
  size?: [number, number];
  /** Unsaid: the shape's own (circle 'cut', rounded rectangle 'whole'). */
  edge?: DiagramZoomEdge;
}

/** An enlarged step: it shows a window of its OWN picture, the area of the step before its run. */
export interface DiagramStepZoom {
  /** The area's box mapped onto this picture, in its whole-picture units. The step's marks are in
   *  THIS window's units: the window is its frame. Re-derived from the area whenever the map is exact. */
  window: [x: number, y: number, width: number, height: number];
}
export interface DiagramStep { /* …existing (l.758)… */ zoom?: DiagramStepZoom }
```

Pure modules in `diagram/zoom/`:

- `zoomModel.ts`: `ZOOM_CORNER` 0.22 (× the shorter side); the click sizes
  (radius 0.15; 0.3 × 0.3); `ZOOM_SCALE` = `CLOSE_UP_SCALE`
  (`annotationModel.ts:978`); Fill clamped to [1, 6] × the area's printed
  size; the overshoot {share 0.2, 2–6 mm}; closed when the cut pieces cover ≥
  97%; gaps under 2 mm merged; `cleanZoom` (one of `radius` and `size`; sizes
  in [0.015, 2]); `carryZoom` (odd quarter turns swap a rectangle's sides);
  shape conversion; per-shape defaults.
- `zoomRuns.ts`, derived per document (WeakMap memo), never stored:

  ```ts
  export interface ZoomRun { areaStepId: string; areaId: string; stepIds: string[] } // the arrow prints before stepIds[0]
  export type ZoomNotice = 'no-area' | 'kept-window' | 'posed-differently' | 'other-side'
    | 'not-this-picture' | 'no-paper' | 'prints-soft';
  export interface StepZoomView {
    run: ZoomRun | null;   // null: enlarged, but no area before it → drawn whole, marks mapped from the stored window
    shape: 'circle' | 'rounded';
    edge: DiagramZoomEdge; // resolved; 'whole' when the picture has no paper outline
    scale: number | null;  // null = Fill
    window: PictureBox;    // stored, in whole-picture units
    notice: ZoomNotice | null;
  }
  export function diagramZooms(doc: DiagramDocument): {
    runs: ZoomRun[]; byStep: ReadonlyMap<string, StepZoomView>; byArea: ReadonlyMap<string, ZoomRun> };
  ```

  The walk back from an enlarged step passes turns and enlarged steps; the
  first other step is its area step if it holds a `zoom` annotation (at most
  one per step). A locked (newer-build) step ends the walk.
- `stepView.ts`, what every surface paints and annotates:
  `stepView(doc, stepId): {step, window: PictureBox | null, zoom: StepZoomView | null}`;
  `viewFrame(view, assets)`, the window or `stepPictureFrame`;
  `viewGeometry(view, assets, style)`, `pictureGeometry` mapped into window
  units and kept to the shape grown by the snap radius.

**Reading and writing** (`diagram/document/diagramFile.ts`):

- **`STEP_KEYS`, landed first, as a commit of its own.** Today `readStep`
  (l.422) builds a step from named fields and **silently drops any other
  key**, and `writeStep` (l.267) writes a fixed set, so a new step field is
  lost by any build that predates it. The commit's `STEP_KEYS` holds the
  eight keys `writeStep` writes today: {id, revision, source, picture,
  annotations, annotatedPictureKey, text, breakBefore}. Any other top-level
  key makes the step a newer build's: locked and carried verbatim, as an
  unknown source kind already makes it. `zoom` joins the set only in the
  commit that reads it (`readStepZoom`), so a build from between the two
  locks an enlarged step rather than accepting the key and dropping it.
  Landing before anything writes `zoom` means `zoom`, and every later step
  field, is kept verbatim by older builds rather than dropped. From that
  commit on, a build without enlargement opens an enlarged step locked,
  shown as made by a newer Ori Studio, and keeps the area mark verbatim.
- **`readStepZoom`.** A record whose only key is `window`; any other key makes
  the step NEWER (locked). `window` must be four finite numbers, width and
  height > 0, within ±`ANNOTATION_REACH` frames. Otherwise it is damage: the
  zoom is dropped and `annotatedPictureKey` is set to null, so D8's
  out-of-step notice shows (the step's marks were in window units).
  `writeStep` adds `zoom: { window }` when set.
- **The `zoom` annotation.**
  `ANNOTATION_FIELDS.zoom = fields('radius', 'size', 'scale', 'edge')`
  (l.868). The `readAnnotation` case follows `readTicks`/`readKinks`
  (l.1091/1143): exactly one of `radius` and `size` (both or neither is
  damage, and the mark is dropped); `radius` through the close-up's reader
  (`readCloseUpRadius`, l.1130); `size` two finite numbers > 0, valid from
  0.015 to 2 and NEWER outside that, as a radius is, damage otherwise;
  `scale` unsaid means Fill (Z4 A), valid 1.25–6, a positive number outside
  that NEWER, as `readCloseUpScale` reads a close-up's, damage otherwise (the
  field dropped); `edge` `'cut'` or `'whole'`, another string NEWER,
  anything else damage. NEWER keeps the mark verbatim as an
  `UnknownDiagramAnnotation`, not drawn, flagged in Layers as made by a
  newer Ori Studio. `writeAnnotation`
  (l.287) destructures `size` and `edge`, as its `Record<string, never>` check
  forces; each is written only when set.
- **Nothing else changes** (under Z2 A). No page-setup key, so
  `DiagramPageSetup`, `PAGE_KEYS` (`diagramFile.ts:184`) and the read-only
  lock are untouched. No entry kind, so `isTurn` (`'kind' in entry`,
  `diagramDocument.ts:813`) is untouched; Z2 B would add two.

#### How a window lands on another picture: the plane

```ts
// diagram/zoom/zoomPlane.ts
export interface ZoomPlane {
  key: string;                      // two pictures map exactly iff their keys are equal
  toPlane(p: PicturePoint): Point; fromPlane(q: Point): PicturePoint;
  unitsPerPicture: number; turnDeg: number;
}
export function zoomPlane(step, assets): ZoomPlane | null;
export function mapArea(area, from: ZoomPlane, to: ZoomPlane):
  { centre: PicturePoint; half: [number, number]; approximate: boolean };
```

| Picture | Plane | Key |
| --- | --- | --- |
| Linked crease pattern | Pattern units about the paper's centre, its turn undone, x mirrored for the back: the inverse of `creasePatternScene`'s `toScene` (`creasePatternScene.ts:70-74`), so front and back map exactly | `v1\|cp\|<paperScale>` |
| Linked flat fold | Kernel units less the region's bounds centre, its turn undone: the inverse of `flatPicture`'s turn × `CAPTURE_PX_PER_UNIT` (`captureFolded.ts:201-219`). A folded picture sits where its sheet sits (`annotationCarry.ts:126-131`), so subtracting the sheet's centre lets the next sheet share the plane. Spread offsets are not undone; the spike measures them | `v1\|flat\|<side>\|<paperScale>` |
| Linked 3D or simulated | Stored scene px | `v1\|<mode>\|<scope digest>\|<camera>` |
| References step | The card's sheet (`model.sheet`), mirrored when the card is turned over | `v1\|ref\|<w>x<h>` |
| Upload | The asset's unposed px (the inverse of `poseMove`) | `v1\|upload\|<assetId>` |
| Fixed SVG, raster capture | None: only the same picture key maps, by identity | — |

`mapArea` maps the centre through both planes and scales the size by the ratio
of `unitsPerPicture`. It swaps a rectangle's sides when the two turns differ
by an odd quarter turn; any other difference keeps the rectangle upright and
returns `approximate`, which raises the `posed-differently` notice. A circle
always maps exactly.

#### Keeping windows and marks consistent

Marks on an enlarged step are in its window's units, and the window is
anchored to the paper through the plane. The rules are pure functions in
`diagram/zoom/zoomWindows.ts`, called from the store verbs:

| What changed | Window | Marks |
| --- | --- | --- |
| The area's region edited (grips, Shape) | Every window in the run re-derived | Carried by `windowMove` (scale and shift), so they stay on the same paper |
| A step joins a run (the tool adopts it, the toggle on, a seeded insert) | Derived; if no plane maps, the whole picture inside the frame | Carried from the whole picture into the window |
| A step leaves (toggle off, Whole Model from Here, the area or its step deleted) | Dropped | Carried from the window to the whole picture |
| This step refreshed or relinked | Re-derived when the map is exact, else kept | Unchanged in window units, so on the same paper; D8 out of step as for any refresh |
| This step re-posed (the `withCarriedAnnotations` call sites: `diagramDocument.ts:1176/1311/1339/1394`, `useDiagramLinkedPose.ts:209`) | Re-derived, else carried by the pose's move | The pose's own move, composed through old window → picture → new window |
| The area step refreshed or re-posed | The area carried (pose: `carryZoom`; refresh: the exact plane map), so windows unchanged | Unchanged |
| Steps moved | Re-derived for steps whose area changed; a step left with no area keeps its own | Carried only when the window moved on the paper |

A test helper asserts after every store verb in the slice tests: wherever the
map is exact, each enlarged step's stored window equals its derived window,
and no mark moved on the paper. Copy and paste remember their source view
(picture key and window): pasted onto a step with the same picture key, marks
map by `windowMove`; otherwise they land in identical units, as today
(`annotationClipboard.ts:48`).

#### Rendering on every surface

**One windowed painter**, `diagram/zoom/paintZoomed.ts`, on the close-up's
recipe (`paintAnnotations.ts:115`):

1. `<defs><clipPath id="{prefix}-zoom">` holding a circle, or a rect with `rx`
   = 0.22 × the shorter side.
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
   sides exactly, with 32 points per corner.
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

**The area on the step before** compiles to a new `CompiledAnnotation`
variant, `zoom`, beside `close-up` (`annotationPrimitives.tsx:196-200`; its
`compileAnnotation` case at l.273), drawn by
a `zoomAreaElement` beside `closeUpElement` (l.696): the full outline in the
ring pen and the arrows' ink, plus, under Z5, a white casing on a rounded
rectangle, 1.5 ink (≈ 0.5 mm) wider than the pen on each side. It lies in the
close-ups' layer, over the shapes and under callouts and labels. Its reach is
the outline plus half the pen and the casing. Pose ghosts it as the other
marks. It is not a References primitive, so the primitive switches are
untouched.

**Per surface:**

- **Cards** (`DiagramStepCard` → `annotatedStepUrl`,
  `useStepPictureUrl.ts:65`): an enlarged step paints the windowed view, the
  window filling `CARD_FRAME_PX` (50 mm), its marks at `CARD_FRAME_PX` on the
  window frame. The cache key adds the window, shape, edge and corner. The
  area step's card shows the area.
- **Annotate canvas, enlarged step**: `layoutFor`'s frame
  (`useAnnotateCanvas.ts`) is the window at `ANNOTATE_FRAME_PX` (1000). A new
  `DiagramZoomView` (own CSS module) draws
  `closeUpPictureUrl(source, style, s)` (l.151, cached by scale), clipped as
  `DiagramCloseUpInsides` is, plus the boundary; nothing outside the window,
  since nothing prints there. Snapping and behind-flap layers come from
  `viewGeometry`. `INK_UNITS` and the frame-relative constants (`LABEL_SIZE`
  0.05 of the frame, `MIN_ANNOTATION_LENGTH`, `PASTE_OFFSET`, the click
  defaults) stay right with no edits, because the window is the frame. That is
  why marks live in window units: in whole-picture units a label would print
  k× larger, and about 15 `INK_UNITS` sites would need a view scale no type
  checks.
- **Annotate canvas, area step**: the area is a mark with grips: a circle's
  centre dot and rim, as `closeUpGripAt` (`annotationHit.ts:586`); a
  rectangle's corners, edges and centre, through new `AnnotationGripPart`
  values. It hits on its outline only, last in the hit order (l.696).
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
LayoutStep.picture.kind: 'paper' | 'fit' | 'zoom'  // 'zoom': frame = the content box (Cut: paper inside the window ∪ the
                                                  //   cut pieces) or the window (Whole), in window units; reach as today
LayoutStep.zoom?: { areaStepId: string; run: number; areaShare: number /* area's longer side, area step's picture units */;
                    scale: number | null; arrowBefore: boolean }
LayoutCell.zoom?: { asked: number | null; printed: number; reduced: boolean }   // the Layers and Step pane read-out
LayoutPage.zoomArrows: { at; box; beforeStepId; areaStepId; rightToLeft: boolean; liftable: boolean }[]
```

- **Scale**, a post-pass after the policy block
  (`diagramPageLayout.ts:847-874`). 'zoom' pictures match neither the `paper`
  nor the `fit` filter, so neither policy sees them; otherwise `scaleRuns`
  would absorb a lone enlargement under about 7.4× into its neighbours' run,
  and `paper` always would. The post-pass first computes `areaMm` =
  `areaShare` × the area cell's printed frame (its longer side × `mmPerUnit`
  for paper, `frameMm` for fit). The area step may be on an earlier page;
  every scale is known before cells are built.
  - **Fill** (Z4 A; Z4 B has no Fill, and an unsaid scale is 2): `windowMm`
    = the minimum over the run of each step's `shared`
    fit (`ScaleFit`, l.304), clamped to [1, 6] × `areaMm`. Each step prints at
    min(`windowMm`, its own fit) and is flagged `reduced` when that bites, so
    one long caption reduces only its own step.
  - **Fixed Size**: `windowMm` = Size × `areaMm`, capped the same way.
  - The read-out is `printed / areaMm`; it turns amber under `FIT_ZOOM` (1.3):
    "Prints only ×1.1 — draw a smaller area".
  - `layoutDiagram`'s measure-at-scale passes re-measure reach at the pinned
    size, the overshoot in mm included.
- **Gutter**: `turning` becomes
  `turning || steps.some(s => s.zoom?.arrowBefore)`; `outerShortfall` is
  shared.
- **Arrow places**: `placeTurns` (l.954) is generalised over
  `BetweenGlyph = {kind: 'turn'} | {kind: 'enlarge'}`, its output split into
  `LayoutPage.turns` (type unchanged) and `LayoutPage.zoomArrows`;
  `DiagramTurnKind` is not widened. D22's places: on a shared row, midway
  between the facing edges at the mean centre height; across a row or page
  break, half a gutter before the next picture's leading edge (its right edge
  on a right-to-left flow row); x clamped to [7, W−7] mm. With turns in the
  same gutter, the arrow stacks after them, 1.5 mm clear.
- **Lift** (composer; Z3 A, dropped under C, and under B tried after the
  ring): alone in a shared-row gutter (`liftable`), the arrow's
  y becomes the area's printed centre (from the area cell's `framePt` and the
  area's centre). Its **box** is clamped into both drawn pictures' vertical
  overlap, which starts below the next cell's number band (the number at the
  cell's y + 7 mm; pictures from y + 8). No lift beside a turn, or across a
  break.
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
(`turnFollowsReading`), the bow kept up. It shows only on pages and in the
PDF: cards never draw across cards, so they show the chip.

#### Edge cases

- An area that enlarges no step (its run deleted or turned off, or the area
  duplicated) prints as a plain outline with no arrow. Layers says "Enlarges
  no step" and offers Enlarge Next Step, which follows Z6's rule; Export names
  it.
- A turn-over between the area and the run, or inside it: the flat fold's
  other side does not map (`other-side`). The window is kept, or the picture
  drawn whole inside the frame when the step first joins. The fix is Pose Like
  Step 55, or the turn before the area.
- An area taking in the whole model: Cut finds no crossing and draws no
  boundary, Fill comes out near 1×, and the read-out is amber.
- An area holding no paper on a step (a refold moved the model): the "holds no
  paper" notice; the window still prints.
- Spread layers: the plane ignores spread offsets, so a window may drift by a
  spread step (the spike measures it; Risks).
- Rotation by any angle (447568348): a circle is exact; a rectangle stays
  upright and is flagged approximate.
- Raster pictures (an over-budget capture kept as an 80 mm, 300 dpi bitmap, or
  a raster upload): the soft-print notice below 200 dpi effective.
- 3D and simulated pictures: the Cut silhouette comes from the painter's-tree
  faces and is approximate. Live orbit views show the outline only.
- Marks partly outside the window are drawn unclipped and measured; marks
  wholly outside it (beyond the window grown by one window) are kept, not
  drawn, not measured, and badged.
- A run with no paper outline on any step: the Edge row is disabled with its
  hint.
- An empty enlarged step (seeded, before Link) shows the placeholder with its
  chip; its capture derives the window.
- A read-only diagram disables every enlarge control; areas and windows still
  draw.
- Undo and redo restore marks, windows and flags together, one entry per verb.
- On a phone the fields go in the Step drawer and grips are at least
  `--touch-target`. The toggle stays on Pose's toolbar, unlike Spread
  Layers, which a phone's toolbar leaves to the Step drawer because the
  toolbar would wrap (`DiagramStepDetail.tsx:179-181`). 16e checks the
  toolbar at 375 px with Enlarged and Pose Like Step 55 both showing; if it
  wraps, the toggle follows Spread Layers into the drawer.
- Analytics opted out: every event is a no-op, and behaviour is unchanged.

#### Analytics

Event names lowercase and space-separated; values enums and buckets only,
never geometry. Rows go in `docs/analytics.md`.

- `diagram annotation added`: `tool` gains `enlarge` and `enlarge_frame`, with
  `snap` `none`. Extend `DiagramAnnotationTool` (`analytics/events.ts:75`) and
  `ANNOTATION_TOOL`.
- New `diagram enlargement added`, for what that event cannot say: `shape`
  (`circle`/`rounded`); `picture` (`DiagramPictureKind`:
  `svg`/`raster`/`references`/`crease_pattern`/`flat`/`3d`/`simulated`);
  `next_step` (`inserted`/`existing`, Z6); `via` (`rail`/`key`/`step_menu`).
- New `diagram enlargement changed`, once per drop or commit: `setting`
  (`area`/`shape`/`size`/`edge`/`deleted`); `value`
  (`circle`/`rounded`/`fill`/`fixed`/`cut`/`whole`/`none`); for a fixed size,
  `size_bucket` (`<=1.5`/`<=2`/`<=3`/`<=6`).
- `diagram picture posed`: `action` gains `enlarge_on`, `enlarge_off` (with
  `scope` `step`/`rest_of_run`) and `pose_like_area_step`, beside
  `spread_on`/`spread_off` (`DiagramPoseAction`, `events.ts:143`).
- `diagram exported` gains `enlarged_step_bucket`
  (`<=0`/`<=1`/`<=5`/`<=20`/`>20`, the ladder `empty_step_bucket` uses).
- The step the tool inserts is a copy, as Duplicate makes, so it does not
  count `diagram step added` (`docs/analytics.md:342`: "Duplicating a step
  is not counted"); `next_step: inserted` counts it. A step inserted by Insert
  Step After that starts enlarged counts `diagram step added` as today.
- The step catalog's commands (Enlarge After…, Whole Model from Here) are not
  `MENU_ACTION_ID`s, so the `handleMenuAction` chokepoint does not count them;
  the events above are the only count, and none is placed twice.

#### i18n

About 45 strings, all through `t()`, in all nine catalogs (en, de, es, fr, ja,
ko, pt-BR, ru, zh-CN); `i18n:extract` → translate → `i18n:stamp` →
`i18n:check`. A run of one step reads "Step 56", not "Steps 56–56", so each
string that names the run ("Steps 56–60", the Delete tooltip, the
confirmation) is two keys, one step and a range, not a plural.

| Namespace | Strings |
| --- | --- |
| `tools:diagram` | `toolEnlarge`, `toolEnlargeFrame` |
| `panels:diagram.annotate` | `enlargeHelp`, `enlargeFrameHelp`, the modifier lines, three disabled reasons |
| `panels:diagram.annotations` | Row and field labels (Enlarge, "Enlarged from step {{n}}", Shape, Circle, Rounded rectangle, Size, "Fill · ×{{k}}", Edge, Cut, Whole); the read-outs, normal and reduced; the verbs (Go to Step {{n}}, Enlarge Next Step, Edit Area on Step {{n}}); badges and notes (Outside the enlarged area, Enlarges no step, the Cut-unavailable hint) |
| `panels:diagram.pose` | `enlarged`, `wholeFromHere`, `poseLikeStep` |
| Step pane | The read-out row and seven notices |
| Card | The chip and two warning chips |
| `panels:diagram.actions` | `enlargeAfter`, `wholeFromHere`, the delete confirmation |
| Canvas | The "{{n}} →" chip |
| `dialogs:diagramExport` | `turnsLeftOut` reworded, three notices |
| Shortcut labels | Two |

#### Amendments to `diagram-workspace.md`

- **D2**, unchanged in spirit: an enlarged step owns its picture; its window
  is a view.
- **D8**: an enlarged step's frame is its window, and its marks are in window
  units; an area follows its paper through a Refresh when the plane map is
  exact.
- **D10**: enlarged steps leave both scale policies (a stated exception).
- **D22**: enlarge arrows are between-step glyphs that reserve the gutter.
- **Later**: remove "A per-step zoom ("enlarge from here")"; add Phase 16,
  pointing here.

#### Risks

- **Plane stability is inferred, not run.** Capture folds from face 1
  (`lib/creaseExportFold.ts:333`). If a refold or another sheet fixes a
  different face, or a spread offsets the head, the windows of 57–60 drift.
  The spike (16.0) measures this. If it fails: a per-step `offset` that
  re-derivation keeps, with a Layers "Window: Reset", or face-anchored centres
  as the spread carry has.
- **Window maintenance** must run on every picture-edit path. Mitigations: one
  funnel around `withCarriedAnnotations`, explicit verbs, and the invariant
  helper after every slice verb in the tests.
- **The view resolver** must reach every painter (card, canvas, Pose, layout,
  cell, step files, export). Mitigations: one `stepView` entry point and a
  cross-surface test of one enlarged fixture.
- **The `STEP_KEYS` lock** may lock dev files whose steps carry stray keys:
  check crane.osf and the fixtures before landing it.
- **The 14 mm gutter** shrinks every room by about 14% once a diagram gains
  its first enlargement. That is D22's precedent; the prototype's print panel
  shows it.
- **Repaint cost** on cards, the canvas and pages for long runs. Mitigations:
  culling, and caching by (picture, window, scale).
- **Cut** on 3D or simulated pictures and on woven flaps is approximate;
  raster pictures print soft when enlarged.
- **Panel growth**: rows belong in the new components and hooks, so the
  `max-lines` cap keeps its meaning.

#### Decisions for Zach: enlarged steps (all PENDING)

The interactive versions are in `artifacts/revision-2/enlarged-steps.html`.

**Z1. How is an enlargement made, and where does its area live? PENDING.**
- A. Enlarge tools on the step before. On 55's rail (Marks, after Close-Up),
  Enlarge (E) drags a circle out from its middle and Enlarge in Frame
  (Shift+E) drags a rounded rectangle corner to corner. Releasing lays an area
  mark on 55, edited there with grips and in Layers, and inserts 56 as a copy
  of 55, enlarged, in one undo step. → draws on 56. The card menu's Enlarge
  After… opens 55 with the tool armed.
- B. A frame on the enlarged step, placed in Pose. Card menu › Enlarge In
  After ▸ look creates 56; the region is placed on 56 in a Frame mode on
  Pose's toolbar (dimmed surround, handles). The ring on 55 is drawn from it
  and is read-only there.
- C. Close-Up › Show: Next step. Draw a close-up (I) on 55, then switch its
  Layers row Show [Beside | Next step]; that row inserts or flags the next
  step.
- **Recommended: A.** The convention, Lang and the note all draw the region on
  the prior step. A is one gesture (E, a drag, →) and follows the
  Shift+V/Shift+M and Solid Arrow precedent of a tool per look. The area is a
  real mark, so selection, undo, the Layers listing, copy and carry come with
  it, and one area drives the whole run, so 56–60 cannot disagree and
  adjusting the region is one edit. B edits the region on the wrong step, adds
  a Pose sub-mode with its own Escape handling, and stores a frame on every
  step. C hides the feature in Close-Up, flashes an inset first, and makes a
  Layers field insert steps.

**Z2. How does an enlargement continue over several steps, and end? PENDING.**
- A. An Enlarged toggle on each step's Pose toolbar. Each enlarged step stores
  its own window. A step added after a run, or inserted inside one, starts
  enlarged, seeded as Spread Layers' starts are, and Duplicate copies the
  setting. Releasing the toggle on 61 shows the whole model; on a step with
  enlarged steps after it, it reads Whole Model from Here and ends the run
  there. The Steps grid only gains a chip.
- B. Enlarge and Whole cards in the Steps grid (D24 parity). An Enlarge card
  between 55 and 56 holds the zoom and prints the arrow; every step after it
  is enlarged until a Whole card, which prints nothing.
- **Recommended: A.** It is the Spread Layers shape: a pressed toggle on
  Pose's toolbar, the details elsewhere. Each step's state survives inserting,
  moving and deleting the steps around it, and inserts never split a run. B
  matches how turns became cards, but moving or deleting a Whole card silently
  enlarges every later step, the area hops to whichever step ends up before
  the Enlarge card, the Whole card prints nothing (Lang: no accepted reduce
  sign), and all 12 `isTurn` call sites reopen.

**Z3. Where does the arrow print? PENDING.**
- A. In the gutter, lifted to the area's height. A page-level glyph placed by
  D22's turn rules: mid-gutter on a shared row; at the next picture's leading
  edge across a row or page; mirrored on right-to-left rows. Alone in a
  shared-row gutter, it is raised to the area's printed height, kept inside
  both pictures and clear of the next step number. It reserves the 14 mm turn
  gutter, so rooms go from 56 to 48 mm on A4 3×3.
- B. Out of the ring when there is room. The tail starts just off the area's
  rim and aims at 56 whenever a clearance test against paper, marks, numbers
  and text passes; otherwise A's place. The same gutter.
- C. Mid-gutter always, exactly where a turn glyph goes (look 2), with no
  lift.
- **Recommended: A.** It is decided at layout time, so it can be tested and
  never jumps when an unrelated caption or column count changes. When the area
  faces the next step it reads like look 1; for a central frame it is look 2
  exactly. B is look 1 literally but switches between two places as the layout
  changes; C loses the link to the area. All three cost the turns' gutter.

**Z4. How big does an enlarged step print? PENDING.**
- A. Fill, with a typed size to fix it. 56–60 print as large as their rooms
  allow, one size for the run, at most 6× the area. A number in Layers › Size
  prints them at that many times the area's printed size. A read-out shows
  what prints: "Prints ×4.4", or "Asked ×3 · prints ×2.4 — room".
- B. A literal ×2 by default, the close-up's, reduced only when the room
  cannot hold it; no Fill.
- **Recommended: A.** On fixed 48 mm rooms look 1's literal ×1.25 prints an 18
  mm picture; the books' ratios are what filled their space. A typed number
  still fixes the ratio when a book should read alike, and the read-out keeps
  D10's exception visible. Either way enlarged steps leave both policies, so a
  1.25× enlargement is never swallowed.

**Z5. Does the area's outline on the step before knock out the creases it
crosses? PENDING.**
- A. By shape, as in the two examples: a rounded rectangle gets a white casing
  (look 2), a circle none (look 1).
- B. Both shapes cased, about 0.5 mm wider than the pen on each side.
- C. Neither: a plain outline in the ring pen.
- **Recommended: A.** It reproduces both measured examples. A casing on a
  circle is invisible over clear paper and shows only where it crosses dense
  creases; judge it on the prototype's crane, since it is one rule either way.

**Z6. Drawing an area on 55 when a step 56 already exists. PENDING.**
- A. Use it if it shows the same picture, otherwise insert. If the step
  directly after 55 shows the very same picture (an untouched copy) or is
  already enlarged, that step is enlarged and its marks are carried into the
  window; otherwise a copy of 55 is inserted. The undo label says which.
- B. Always insert a copy. To enlarge an existing step, turn on its Enlarged
  toggle and delete the inserted copy.
- **Recommended: A.** A 55 duplicated before enlarging leaves no stray step,
  and a step holding a later fold is never enlarged by surprise, since both
  examples show the same fold state on both steps. The undo label makes the
  result explicit.

#### Alternatives considered

- **view-of-step-before** (a zoom mark on N; N+1 shows N's own picture through
  it, with no picture of its own). Kept: the tools, inserting on release,
  window-unit marks, per-shape defaults, the page-split notice, the arrow's
  hit target. Rejected: a step without a picture breaks D2 and has about 155
  direct `.picture` reads to reconcile; linking by annotation id breaks on cut
  and paste; posing 56 would re-pose 55.
- **step-owns-its-framing** (the frame on the zoomed step, ring and arrow
  derived; the highest score, and the base here). Kept: steps own their
  pictures, no ids, the sheet-centred plane, Pose Like Step N, culling,
  `STEP_KEYS`, the invariants. Not kept: a frame per step with no edit across
  the run (S3 took five edits, and a run could disagree); the region edited on
  the wrong step, in a Pose sub-mode; rings that vanished when plane keys
  differed.
- **page-first** (Enlarge and Whole entries in the step order, holding the
  area in fold space): Z2's option B. Kept: Fill from shared fits, the content
  box for Cut, the overshoot rule, Pose's dimmed window, an unmappable picture
  drawn whole inside the frame. Not the base: it needs an audit of every
  `isTurn` consumer and a second, non-annotation selection model on the
  canvas; its stored copies of the space go stale; the ring jumps to another
  picture when steps are moved or deleted.
- **smallest-surface** (a close-up with Show: Next step): Z1's option C. Kept:
  the per-step Pose toggle with seeding, the walk back with no ids, the arrow
  through the turn pipeline lifted to the ring's height, the edges-pen
  boundary, a glyph box that holds the head. Rejected: two gestures, behind
  Close-Up; a Layers row that inserts steps; and its claim that Cut alone
  reproduces look 2, which look 2's off-paper corner disproves.

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
  room, which lowers its Fit-each run's scale, or every step's under Paper
  (ED3).
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

#### Decisions for Zach: equal divisions (all PENDING)

The interactive versions are in `artifacts/revision-2/revision-2-marks.html`.

**ED1. How do you lay it? PENDING.**
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

**ED2. What does dragging a laid mark do? PENDING.**
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

**ED3. What unit is the offset in? PENDING.**
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
  edge, 13% with Number on, lowering its run's scale under Fit each and every
  step's under Paper.

**ED4. How far do the dividers run? PENDING.**
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

**ED5. How many parts, and how is the count set? PENDING.**
- A. 2 to 32, laid at 4. The Parts field takes the focus as a new label's Text
  does: type 5, press Enter, and the canvas has its keys back.
- B. 2 to 32, laid at 4, changed only in Layers, as a pleat arrow's Kinks are.
- C. Laid with the last count used, changed in Layers.
- **Recommended: A.** "specify number of divisions" makes the count part of
  making the mark, and labels already work as draw-then-type. B adds a click
  to every mark. C saves it only when marks repeat, and makes each new mark
  depend on history no one can see.

**ED6. Does it print the count? PENDING.**
- A. A Number switch on each mark, off by default; on, the count prints
  upright beside the middle of the line.
- B. Never: ticks only, as the sketch and the template.
- C. Always, as Sturm's symbol sheet.
- **Recommended: A.** Off by default, as the sketch and template print no
  number. But readers slip counting 7 or 9 parts, and a Label placed beside
  the mark would not move with it. The rotate glyph already sets a number
  inside a mark through the same text path to the PDF.

**ED7. How are two sets of equal parts in one step told apart? PENDING.**
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

**ED8. Name, key and place on the rail. PENDING.**
- A. "Equal Divisions" (the note's words), key D, in Marks after Equal Angles.
- B. "Equal Parts" (Sturm's words, a pair with Equal Angles), key E. E is Z1
  A's Enlarge, so B would need another key.
- C. As A, with no key, as Equal Angles has none.
- **Recommended: A.** D is free in the Diagram's scope and suggests "divide";
  beside Equal Angles, the two equality marks sit together.

**ED9. Which pen draws the dimension line, on white paper? PENDING.**
(Raised by the review.)
- A. Every stroke in the ring pen, 0.5625 pt.
- B. The line in 0.25 pt (0.09 mm), the existing creases' pen and the
  template's crease weight; dividers and ticks in the ring pen.
- C. The line in the ring pen at 45% ink, like the sketch's light grey;
  dividers and ticks in full ink.
- **Recommended: B**, judged on the prototype's white-paper panel; if B
  still reads as a taller sheet, C, or ED4's B (a 0.7 mm gap at the edge).
  The sketch's line is thin and grey, on green paper. In the Diagram preset
  the ring pen is heavier than the 0.5 pt edge, and the end dividers
  continue the sheet's sides by 4.15 mm, so A draws a closed band in the
  edges' ink. C adds a second ink to a preset that has one.

**ED10. Ticks on crowded parts. PENDING.** (Raised by the review.)
- A. Shrink freely, with no lower limit.
- B. Shrink to a floor (spacing at least two pens, a half-tick at least 1.5
  ink) and stop there; the Parts row warns that the parts are too short.
- C. Shrink to the floor; below it each part draws one tick.
- **Recommended: B.** At 32 parts on a 40 mm edge, A's three ticks stand
  0.19 mm apart, under one pen, and merge; arrowheads already keep a
  minimum (`ARROWHEAD_MIN_STROKES`). C stays legible but changes what the
  mark says, since two ticks mean a second set.

**ED11. Tick size beside the equal-angle mark. PENDING.** (Raised by the
review.)
- A. Each its own: division ticks ±3 ink leaning 20°, 2 ink apart, as the
  sketch; angle ticks stay ±1.8 ink, square to the arc, 1.8 apart.
- B. One size: division ticks take the angle mark's length and spacing and
  keep their lean.
- **Recommended: A.** It keeps the sketch's proportions; the shared Ticks
  field is one vocabulary of counts, not of sizes (ED7).

**ED12. Pasting on the same step. PENDING.** (Raised by the review.)
- A. In place, 2.5 mm further out for each earlier paste, up to 15 mm.
- B. In place, its line on the other side.
- C. Moved down and right by `PASTE_OFFSET`, as every mark's paste is.
- **Recommended: A.** The mark belongs to its line. Under ED2 A a body drag
  sets the offset, so a moved copy (C) could only be put back end by end.
  B works once; a second paste has nowhere to go.

**ED13. After laying one. PENDING.** (Raised by the review.)
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
  Whether it is the fold's or a mark of its own is asked in RA0.
- The reading: today's open square given its own two legs and moved off the
  vertex into the angle (RA0 confirms it).

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
legs and draws the closed square alone. V is the vertex
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

#### Decisions for Zach: the right-angle mark (all PENDING)

The interactive versions are in `artifacts/revision-2/revision-2-marks.html`.
RA0 comes first.

**RA0. What does the sketch mean? PENDING.**
- A. An ∟ of two legs with a closed square in its corner, inset from the
  vertex (the reading above).
- B. A closed square only, inset, with no legs (the prototype's control
  column).
- Also asked (a caption under RA-0's figure, not one of its options): the
  short black tick past the edge. Is it the fold line's own overshoot (not
  drawn here), or part of the mark?
- **Recommended: A**; the tick is for Zach to say. Under B the legs, RA5 and
  RA6 fall away and RA1 sets only the inset and the square.

**RA1. How big is the mark, and how far into the angle? PENDING.** (Ink is
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

**RA2. Does every right angle take the new look, or is it an option?
PENDING.**
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
PENDING.**
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
PENDING.**
- A. Draw it as it is. If it does not fit, Turn 90° to the fold's other side,
  or delete it.
- B. A per-mark Size row in Layers (Regular / Small, Small 0.6×), with a
  `size` field.
- C. Shrink it automatically to the free space in its angle; only pictures
  with geometry (crease patterns, flat folds, References), not uploads or 3D.
- **Recommended: A for now**; B can be added later without changing anything
  else, if a real diagram needs it. The prototype shows flaps 5 and 4 mm
  wide, with how far the leg along the edge ends from the far edge (on the 5
  mm flap, right on it: 15 ink = 4.97 mm). It does not yet show pictures
  printed at 40 and 54 mm; the canvas draws at 50 mm, so it understates
  crowding on a 4-column page (16.0).

**RA5. The mark's ink and weight in the Diagram preset. PENDING.** (Raised by
the review.)
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
  plan follows it.)

**RA6. Tie the vertex dot to the mark? PENDING.** (Raised by the review.)
- A. Selected or hovered, a hairline in the selection colour runs from the
  vertex to the mark's inner corner.
- B. No hairline: the vertex dot sits alone in the gap.
- **Recommended: A.** The corner grip stays on the vertex, 5.7 ink (about 17
  px at fit) from the mark's nearest ink, and handles keep their screen
  size, so the gap grows as the canvas zooms in. Without a tie the dot reads
  as a separate point. The prototype shows both at 100% and 300%.

**RA7. The rail icon. PENDING.** (Raised by the review.)
- A. Shows the inset: the picture's two lines in a 1 px hairline, with the
  inset ∟ and square inside them.
- B. ∟ legs and a closed square at the rail's 1.5 stroke, butt caps and miter
  joins: today's silhouette with heavier legs.
- C. Today's icon, unchanged.
- **Recommended: A**, the only one that shows the mark sits inside the angle;
  B looks unchanged on the rail. The prototype draws all three at 20 px and
  6×, light and dark.

**RA8. The ⌘ hint. PENDING.** (Raised by the review.)
- A. "Hold ⌘ to put the corner it marks down anywhere, without snapping."
- B. Unchanged: "…to put its corner down anywhere…".
- **Recommended: A.** The drawn mark now has a corner of its own, away from
  the pointer, so "its corner" could mean either. A rewords `cornerFreeKey`
  in nine catalogs and `DiagramAnnotateToolWindow.test.tsx:131-135`.

## Affected Areas

**Enlarged steps.**

- New, `diagram/zoom/`: `zoomModel.ts`, `zoomRuns.ts`, `stepView.ts`,
  `zoomPlane.ts`, `zoomWindows.ts`, `zoomEdge.ts`, `paintZoomed.ts`,
  `zoomActions.ts`, `useZoomControls.ts`, `useStepZoom.ts`, a test beside
  each, and the golden `zoom.cases.ts`, `zoomGolden.test.ts`,
  `__fixtures__/zoomGolden.json`.
- New components, each with its CSS module:
  `components/diagram/DiagramZoomControls.tsx`, `DiagramStepZoomStatus.tsx`,
  `DiagramZoomView.tsx`.
- Document: `diagram/document/diagramDocument.ts` (the kind, its fields,
  `DiagramStepZoom`, `DiagramStep.zoom`, seeding on insert and duplicate,
  delete and move); `diagramFile.ts` (`STEP_KEYS`, `readStepZoom`,
  `writeStep`, `ANNOTATION_FIELDS.zoom`, `readAnnotation`, `writeAnnotation`).
- Annotate: `diagram/annotate/annotationModel.ts` (`ANNOTATION_SHAPES` and its
  exhaustive switches, `createAnnotation`, `carryZoom` from `carryCloseUp`);
  `annotationPrimitives.tsx` (the `zoom` variant, `zoomAreaElement`, reach);
  `annotationHit.ts` (grips, new `AnnotationGripPart` values, hit order);
  `annotateTools.ts` (`ENLARGE`, `ENLARGE_FRAME`, `drawingLook`, help,
  disabled reasons); `useAnnotateCanvas.ts` (the window as frame; release
  inserts or adopts); `behindFlaps.ts` (`piecesUnder` exported);
  `annotationCarry.ts` (one funnel); `annotationClipboard.ts` (the source
  view); `paintAnnotations.ts` (a close-up on an enlarged step);
  `annotationEventKind.ts`; `turnGlyph.ts` (the arrow is painted as a turn
  glyph is); `components/diagram/DiagramAnnotateCanvas.tsx` (the area's
  selection and grips); `DiagramAnnotateToolGlyph.tsx` (two glyphs);
  `DiagramLayers.tsx` (mounting, rows).
- Pictures: `diagram/pictures/paintDiagramStep.ts`, `useStepPictureUrl.ts`,
  `pictureFrame.ts`, `paintStepDiagram.ts`, `exportStepPicture.ts`,
  `prefixIds.ts`.
- Capture and pose: `diagram/capture/captureFolded.ts` and
  `creasePatternScene.ts` (the planes' inverses), `useDiagramLinkedPose.ts`,
  `stepCaptureActions.ts` (refresh re-derivation);
  `diagram/actions/diagramLinkedPoseActions.ts` and `diagramPoseActions.ts`
  (Enlarged, Pose Like Step N); `components/diagram/DiagramStepDetail.tsx`,
  `DiagramLinkedPoseControls.tsx`, `DiagramPoseStage.tsx` (the dimmed window).
- Steps: `diagram/actions/diagramActions.ts` (Enlarge After…, Whole Model from
  Here, the confirmation); `components/diagram/DiagramStepCard.tsx` and its
  module (chips); `DiagramStepsGrid.tsx`;
  `components/panels/DiagramStepPanel.tsx` (one line);
  `store/workspaceStore/slices/diagramSlice.ts` (the verbs).
- Pages and export: `diagram/pages/diagramPageLayout.ts`, `diagramPages.ts`,
  `pagePictures.ts`, `composeDiagramPage.ts`;
  `components/diagram/DiagramPagesView.tsx`; `diagram/export/stepFiles.ts`,
  `useDiagramExport.ts`, `diagramPdf.wasm.test.ts`;
  `components/diagram/DiagramExportOptions.tsx`.
- Shared References geometry, read not changed:
  `cp-workspace/references/stepDiagramGeometry.ts` (`whiteArrowOutline`,
  `ringPieces`), `cp-workspace/references/diagram/diagramInk.ts`.

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
with every mark known and saving back byte-identical; a review of the phase;
the gate (lint, typecheck, i18n check, the whole vitest suite) and a push.
The builder owns every gate, the browser's included, and shares the proof
with Zach. What was built is written under each phase's checklist, as in
Phase 15. Each phase is built to Zach's answers in 16.0; where those differ
from the recommendations, the items below change with them.

**Order.** 16.0 comes first. 16a and 16b need only their decisions, not the
spike, and can land before or alongside 16c–16g; 16a first, as it changes no
file. 16c's `STEP_KEYS` commit lands before anything writes `zoom`.

### 16.0 Decisions and the enlarged-steps spike (nothing merges)

- [ ] The prototypes show what each decision names. Checked against the two
  files on 2026-10-05: present are the overshoot, boundary-pen, word and
  map-windows knobs; ED4's offsets of 2.5, 1 and 0 mm and ED9's pens on
  white, grey and the sketch's paper; ED10's 32 parts with an edge-size
  slider; ED11's two kinds of tick side by side; ED12's pasted copy;
  RA0's closed-square control and the black-tick question; RA2's
  angle-on-the-page slider; RA4's 5 and 4 mm flaps; RA5's layered-edge
  cell; RA6's hairline at 100% and 300%; RA7's three icons. Missing: RA4's
  pictures printed at 40 and 54 mm. Add it before Zach is asked, or drop
  the claim from RA4.
- [ ] The two prototypes and this plan agree on every decision's options and
  recommendation (checked 2026-10-05; the plan follows the prototypes'
  numbering, ED9's option C and RA5's recommendation).
- [ ] Zach tries the two prototypes and answers Z1–Z6, ED1–ED13 and RA0–RA8
  (the marks prototype's "Copy picks" text names them by number), and says
  whether any knob should become a decision. His answers are recorded under
  a "Decisions" heading here, and every passage marked with a decision he
  did not take is rewritten to his answer.
- [ ] Spike on the crane: capture 55; refold to a 57 twice, once by editing
  55's sheet and once on the next sheet; map 55's area through the plane;
  measure the drift of an untouched face, with and without the default affine
  spread. Pass: under 2% of the window. If it fails, the per-step offset
  (Risks) joins 16c's scope before 16c starts.
- [ ] Cut pieces from `piecesUnder` on a flat fold and on a crease pattern,
  compared with look 1's arc (its span and overshoot).
- [ ] The results, with images, written here under this phase.

### 16a The right-angle mark

- [ ] Geometry: `DIAGRAM_RIGHT_ANGLE_INK {inset, side, leg}`,
  `rightAngleShape`, `rightAngleDrawn`, `rightAnglePathData`,
  `rightAngleReach`. `stepDiagramGeometry.test.ts`, replacing the cases at
  about l.1104-1139: the inner corner inset·√2 along the diagonal; each leg
  parallel to its line, `leg` long, running past the square; the far corner
  (inset + side)·√2 out; the square's far sides ending on the legs; a diagonal
  turned 0.3 rad; a mirrored projector; null with no diagonal; reach per
  point; two subpaths.
- [ ] Drawing: the right-angle case in `DiagramPrimitives.tsx`; six points in
  `markReach.ts`; `paintAnnotations.test.ts`'s shape regex, bounds and
  reach-at-any-pen model rewritten.
- [ ] Placement: the footprint search in `rightAngles.ts` and
  `rightAnglePlacement.ts`; the canvas's hover and click preview. Tests
  (`rightAngles.test.ts`, `rightAnglePlacement.test.ts`,
  `DiagramAnnotateCanvas.test.tsx`): hovering where the ghost is draws the
  same ghost; a click there marks that vertex; a press at the vertex still
  drags from the corner; ⌘ puts the vertex at the pointer.
- [ ] Hit and canvas: `rightAngleInPicture`, `rightAngleGrips` (direction on
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
- [ ] The glyph (RA7); under RA8 A, `cornerFreeKey` reworded in nine
  catalogs and in `DiagramAnnotateToolWindow.test.tsx:131-135`; the stale doc
  comments.
- [ ] Goldens re-recorded and checked by eye beside the sketch:
  `rightAngleGolden.json` (frame-corner, up-right, turned, off-picture,
  at-reach; card, page, canvas) and `referencesRightAnglesGolden.json` (front
  and back).
- [ ] `diagram-annotate.md`: decision 11 and the 14e as-built marked
  superseded by this section.
- [ ] Browser, before and after: a box_90 capture; a References step, front
  and back; an upload with lines drawn on it; a 45° flap whose fold meets its
  edge, beside the sketch; a 3D capture, a simulated capture, a photo upload
  with a perspective corner, and a mark carried through an affine spread, each
  beside today's look; the crane, its right angles redrawn, saved and diffed
  identical, and its pages and a PDF at 300 dpi compared before and after for
  reflow.

### 16b Equal divisions

- [ ] Model: kind `divisions`; `parts`, `offset`, `numbered`; `mirrored` and
  `ticks` reused (`DiagramTicks`); the shape; defaults; clean; degenerate; the
  exhaustive switches; `hasTicks`; `withSide`. `annotationModel.test.ts`:
  laying one (4 parts, 2.5 mm, the side away from the middle on each edge of a
  square and on a line through it); clean and degenerate cases; the
  `carriesText` and behind lists.
- [ ] File: required fields; newer builds' (`parts` 33, `offset` 16, an
  unknown field, `behind`); damage (`parts` 1 or 2.5, `offset` −1); round
  trips, the every-kind round trip included; an older build keeping it
  verbatim; the crane written back unchanged.
- [ ] Drawing: `DIAGRAM_DIVISIONS_INK` (overshoot 5, tick 3, spacing 2, lean
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
- [ ] Golden: `divisions.cases.ts`, `divisions.test.ts`,
  `divisionsGolden.json`, on a card, a page and the canvas: the sketch; a left
  edge, mirrored; a diagonal in 3 with two ticks; offsets 0 and 1 mm; 7 parts,
  numbered; 32 parts on a short edge.
- [ ] Tool: Marks after Equal Angles, key D, label, help and touch help,
  modifiers (⌘ `endsFreeKey`; Shift for the offset drag), the glyph (the
  template's |\|\| symbol), shortcut executor and label, the Select help's
  exception. Tests: `annotateTools.test.ts` (the Marks order, the tool window,
  D bound, plain T and R still unbound), `diagramShortcuts.test.ts`'s tool-key
  table (l.239), `DiagramAnnotateRail.test.tsx`.
- [ ] Placing (ED1 A): the drag with snapped ends; `nearestLine.ts`, moved
  out of `usePickTool` with collinear pieces joined, shared with Angle
  Bisector, and its hover highlight; `divisionsPlacement.ts` (the default
  side; the offset and side from a pointer, 0.1 mm, Shift 0.5 mm); a short
  release taken as a click; the tool notice for "no line here". Tests: the
  rim fixture's top edge taken whole; a flat fold with a covered face;
  `DiagramAnnotateToolWindow.test.tsx` for the notice; the bisector's tests
  unchanged.
- [ ] The count (ED5 A, ED13 A): `useFieldFocusRequest`; `fieldRef` on
  `NumberRow` and `NumberField`; contents selected on focus; the tool kept in
  hand. Tests:
  Parts takes the focus and Enter gives the keys back; typing 5 over 4 gives 5
  (jsdom, then WebKit in the browser check).
- [ ] Snap: both ends; division points as targets, not on projected pictures
  (`annotateSnap.test.ts`, `pictureSnap.test.ts`).
- [ ] Hit and grips: the `offset` grip part; `moved()` and `placeInHand`;
  `DivisionsSelection`. `annotationHit.test.ts` (the ink, the number, the
  ends, the offset grip); canvas tests: a drag with snapped ends; a click on
  an edge; dragging the mark sets the offset, and across the measured line
  flips the side; Shift holds halves.
- [ ] Carry, flips, copy: a mirror toggles the side and a spread carries the
  ends by their faces (`annotationCarry.test.ts`); Flip Horizontal, Vertical
  and F (`flipAnnotation.test.ts`; `annotationActions.test.ts`: Flip offered
  and named, a do-nothing Flip Horizontal held); the same-step paste as ED12
  settles it (`annotationClipboard.test.ts`); the side on a frame that turns
  the paper over (`referenceFinderStepInModel.test.ts`).
- [ ] Layers: `DiagramDivisionsControls`, `DiagramTicksRow`, the crowding
  warning; the `useStepAnnotations` setters. `DiagramLayersPanel.test.tsx`:
  the rows, one undo step each.
- [ ] Analytics (`tool: divisions`, `snap`, `placed`) and `docs/analytics.md`
  (the tool list, the snap sentence, the flipped row); i18n in nine catalogs.
- [ ] Browser, on a square step of the crane: D and a real drag along the top
  edge, 5 typed, a Line from the first division, set beside the sketch; a
  click on a crease pattern's edge after a book fold; the card, the page, and
  the PDF through `pdftoppm` at 600 dpi; light and dark; Chromium, and
  iPad-sized WebKit for the touch help and the focus.

### 16c Enlarged steps: model, file, plane

- [ ] `STEP_KEYS`, a commit of its own, holding today's eight keys: an
  unknown step key (`zoom` included, until the next item) locks the step,
  which writes back byte-equal; the crane loads with nothing locked and saves
  back byte-identical; the fixtures checked for stray step keys first.
- [ ] The `zoom` kind and its fields, `cleanZoom`, `carryZoom` (quarter
  turns), shape conversion, per-shape defaults; `DiagramStepZoom`; readers and
  writers, `zoom` added to `STEP_KEYS` with `readStepZoom`. Tests: round
  trips; defaults unsaid; NEWER and damage for each
  field; a malformed `zoom` dropped with `annotatedPictureKey` null; the
  older-build-verbatim case.
- [ ] `zoomPlane` and `mapArea` (per-kind maps and round trips under rotation;
  crease pattern front and back; the References mirror; the crane refold
  fixture from 16.0); `zoomRuns` (the walk back, turns, seeding on insert and
  duplicate, a step with no area before it, a duplicated area step, a locked
  step ending the walk); `stepView`, `viewFrame`, `viewGeometry`;
  `zoomWindows`, every row of its table, and the invariant helper.

### 16d Enlarged steps: painting

- [ ] `paintZoomed` (the clip, the repaint at scale, culling); `zoomEdge`,
  with `piecesUnder` exported; the area's `CompiledAnnotation` with its casing
  and reach.
- [ ] Cards; the Pose stage's dimmed window; the Annotate canvas
  (`DiagramZoomView`, the window as frame, snapping and layers from
  `viewGeometry`); Export Picture; a close-up on an enlarged step.
- [ ] `zoomEdge` fixtures: look 1 (the arc's span and overshoot); look 2
  (Whole; and with Cut, the broken corner); the ≥ 97% close; the empty case.
- [ ] Goldens on a card, a page and the canvas: look 1, a circle cut on a
  crane flat fold; look 2, a rounded rectangle drawn whole, with the casing on
  the step before; an upload drawn whole; a References card.
- [ ] A label on an enlarged step prints the same size as on an unenlarged
  step of the same printed frame.

### 16e Enlarged steps: authoring

- [ ] Enlarge and Enlarge in Frame: tools, keys, glyphs, help, disabled
  reasons; release adds the area and inserts or adopts the next step as one
  undo step; grips and hit. Tests: a drag adds the area and the step as one
  undo step; adopting the next step (Z6); grips; the area hit under other
  marks.
- [ ] `DiagramZoomControls` with `useZoomControls`; the Layers row on enlarged
  steps; Edit Area on Step N; the canvas chip; the badge on marks outside the
  window. Tests: Layers rows on both steps.
- [ ] `zoomActions`: the Enlarged toggle, Whole Model from Here and Pose Like
  Step N, on both pose catalogs; `DiagramStepZoomStatus` and its notices;
  Enlarge After…, Whole Model from Here and the delete confirmation in the
  step catalog; card chips. Tests: the toggle and Whole Model from Here; Pose
  Like Step 55.
- [ ] Analytics (`enlarge`, `enlarge_frame`, `diagram enlargement added` and
  `changed`, the pose actions; the inserted copy not counted by `diagram step
  added`) and `docs/analytics.md`; i18n in nine catalogs, a run's one-step
  and range strings as two keys each.
- [ ] Browser: S1 and S2 by a real mouse on the crane, beside the two
  examples; a read-only diagram with every enlarge control disabled; the
  Pose toolbar at 375 px with Enlarged and Pose Like Step 55 showing (if it
  wraps, the toggle moves to the Step drawer, as Spread Layers does).

### 16f Enlarged steps: pages and export

- [ ] The 'zoom' layout kind; the scale post-pass (Fill and fixed); the
  `LayoutCell.zoom` read-out; the gutter rule. Tests: unenlarged steps' scales
  identical with and without an enlargement, apart from the gutter; Fill takes
  the run's minimum, and a long caption reduces only its own step; a fixed
  Size and its reduction; Cut laid out by its content box.
- [ ] `placeTurns` over `BetweenGlyph`; `LayoutPage.zoomArrows`;
  `CellPicture.framePt`; the composer's arrow and lift, its box measured from
  the painted outline; Pages-view hit targets. Tests: same-row left-to-right
  and right-to-left; a grid row break; a flow row end; a page break; stacked
  with a turn; the lift clamped clear of the number band; the containment test
  at any scale and page; ids unique per page, clip ids included; the arrow
  glyph's golden, both directions.
- [ ] Step files (the windowed painter at the scale rule's size, no arrow);
  the export notices, the area-no-longer-maps one included; `diagram
  exported`'s `enlarged_step_bucket` and its docs row; a
  `diagramPdf.wasm.test` case with a rounded clip and cut arcs; a real PDF
  through `pdftoppm`.
- [ ] Browser: S6's placements on A4 in grid and flow; the page-break notice;
  the crane's pages before and after its first enlargement (the gutter), kept
  apart from 16a's reflow.

### 16g Enlarged steps: runs and changing sources

- [ ] Seeding on insert and duplicate; the carries on joining and leaving;
  re-derivation on refresh and relink; re-pose composition; moves and steps
  with no area; deleting ends an enlargement. The invariant helper runs after
  each verb. Copy and paste remember their source view (picture key and
  window), with `annotationClipboard.test.ts` cases for a paste between two
  enlarged steps of one picture and from an enlarged step to a whole one.
- [ ] The area step's Refresh carry (the D8 amendment); the References and
  upload paths; a picture that is not the area step's, drawn whole inside the
  frame; every notice, on cards, the Step pane, Layers and Export.
- [ ] `diagram-workspace.md` amended: D2, D8, D10, D22, the Later list, Phase
  16.
- [ ] Browser: S3–S5 by hand on the crane; before and after beside the two
  examples; light and dark; Chromium and iPad-sized WebKit; a PDF through
  `pdftoppm`.

### Final gate

- [ ] Lint, typecheck, the i18n check and the whole vitest suite
  (`npm run lint:web`, `typecheck:web`, `i18n:check`, `test:web`), and
  `npm run build:web`, as bundling and the PDF path change.
- [ ] The crane: every mark known, nothing locked, saved back byte-identical;
  its pages and PDF compared with the build before Phase 16, each difference
  traced to the phase that made it.
- [ ] This checklist current, with what was built written under each phase.
