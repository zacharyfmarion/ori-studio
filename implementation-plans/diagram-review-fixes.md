# Diagram: review fixes from #436

## Goal

Zach's review of #436 (2026-10-08), verbatim:

> 1. can you default the path width to 20. 2. It feels wierd that enlarged settings only appear in pose tab, even though you interact with the enlarged region in the annotate tab. can we move it to the annotate tab? 3. If the previous step was enlarged from a folded figure, the next step defaults to a CP when linked but it defaults enlarged, which doesn't make sense because it just zooms in on a portion of the CP. whats the right UX here? I almost think that it might be having the type of the next step (cp / simulated / folded figure) default to whatever the step before it is? not sure 4. When i change the area that subsequent steps are enlarged from, it feels like there should be some message saying that the area on these steps is out of date and a way to update (kind of similar to the way it works for picutures

He approved the design below for all four items ("sounds good"). This is a
small PR stacked on #436 (branch `claude/diagram-review-fixes`). Each item is
its own commit, or its own small run of commits.

Item 5 came out of items 2 and 3's reviews. Zach said "yes" to (a), fixing
the marks that float over the whole model when Enlarged is turned off. (b)
follows his decided rule in item 3: switching Show as keeps a step enlarged,
so its frame must land properly for every Show as.

Item 6 is three small fixes found while reviewing #436 and #442 (17b, 17f),
each its own commit. Under Zach's standing instruction (2026-10-08), "go with
your recs from now on unless there is a large fork in the design to be
figured out, until i say otherwise", these are the recommendations given:
the halo in two parts, and the two phone issues fixed on #436. (a) and (b)
are built; (c)'s premise was wrong (the card header does not wrap), and the
header that does is left for Zach with a recommendation.

Item 7 builds the two recommendations item 6 left open, each its own commit,
decided under the same standing instruction (2026-10-08): "go with your recs
from now on unless there is a large fork in the design to be figured out,
until i say otherwise". Neither is a large fork: (a) is 6(c)'s recommended
layout, (b) the follow-up 6(a) recommended.

## Approach

### 1. The path width defaults to 20 mm

- **Default.** `DEFAULT_PATH_WIDTH_MM = 20` in `diagramDocument.ts`, and
  `DEFAULT_PAGE_SETUP.pathWidthMm` is 20.
- **No proportional mode.** `pathWidthMm` is a `number`, never null.
  `AUTO_PATH_WIDTH_SHARE` and the `pathWidthMm(setup, cell)` helper are
  removed from `diagramPageLayout.ts`, and the layout reads the setup's width
  directly.
- **Existing files.** A file that does not say, or says something damaged,
  reads as 20. Diagrams that never chose a width (they drew at 0.42 of a
  cell's smaller side, 26 mm on A4 3 × 3) now draw at 20. Out of range still
  clamps to 4–60 mm.
- **Writing.** The field is written only when it is not 20, the same as
  `pathColor`, which is written only when it is not its default. A diagram
  that never changed the width still opens in a build that does not know the
  field.
- **Page pane.** The field shows the stored width. Reset appears when the
  width is not 20 and sets it back to 20 (one undo step, one `path_width`
  count, as before). `useDiagramPageSetup` drops its `pathWidth` /
  `setPathWidth` adapter. The row commits through `setPage`, like the rows
  beside it.
- **Golden.** The page golden's flow digests change by the band alone. The
  Pages view's page and its arrows do not change. The test records why.

### 2. Enlarged settings move to Annotate

Today:

- **The Enlarged toggle is Pose's.** It is on Pose's toolbar
  (`DiagramLinkedPoseControls`, fed by `DiagramStepDetail`'s `poseToolbar`)
  and is a row in the Step pane's Pose section (`DiagramStepPose`'s
  `EnlargedRow`). On a phone it is only the row.
- **The step's Enlarged section is read-only.** The Step pane shows it in
  every tab (`DiagramStepZoomStatus`): From, Size and the notices. It has no
  buttons.
- **The editable controls are in Layers.** Size (Fill or fixed) and the
  Anchor's Pick and Reset are in the Layers pane (`DiagramZoomControls`), on
  a selected frame or area row. The Layers pane shows only in Annotate.

The design:

- **Annotate's Step pane gets an Enlarged section** that you can edit. On
  every step it has the Enlarged toggle (`buildEnlargedAction`, unchanged).
  On an enlarged step it also has:
  - From, which goes to the area.
  - Size, with Fill.
  - The frame's Anchor, with Pick and Reset.
  - The read-out and the notices.

  This section replaces `DiagramStepZoomStatus` while Annotate is open. The
  rows bind the same hooks that Layers uses (`useStepZoom`,
  `useZoomControls(step, { kind: 'frame' })`), so the two cannot drift. It is
  a child component with its own hook (AGENTS.md › Panel components), not
  more code in `DiagramStepPanel`.
- **The rail is unchanged.** Annotate's rail already has the Enlarge area
  tools. They stay held on an enlarged step (`enlargedStepTakesNoArea`).
- **Pose keeps only the frame drawing.** The toggle comes off Pose's toolbar
  (`enlargedButton` and its `poseToolbar` prop), and `EnlargedRow` leaves
  `DiagramStepPose`. The read-only Enlarged section does not show in Pose.
  Out of both Pose and Annotate, it stays as it is, read-only.
- **Layers is unchanged.** Its frame and area rows keep their controls. They
  belong to the selected mark, while the Step pane's belong to the step.
  Both use one binding. *Decided (Zach, 2026-10-08):* the frame row keeps
  Size and Anchor. Layers is where the frame is selected, and the Step pane
  is where the step's settings live.
- **Strings and analytics.** The toggle's strings may keep their
  `panels:diagram.pose.enlarge*` keys. Renaming them means moving all eight
  translations too. Help text that names Pose for Enlarged is reworded. The
  `enlarge_off` pose action and `diagram step enlarged` via `toggle` keep
  their names, so dashboards stay continuous. `docs/analytics.md` is updated
  to say the toggle is now in Annotate's Step pane. Moving a control is not a
  new action, so no event is added.

### 3. A new step after an enlarged one

Today:

- **The picker's default.** For a new link it offers the way this session
  last linked (`lastLinkedAs`), which starts as Crease Pattern
  (`stepCaptureActions.ts`: `pickerShowAs`, `linkDiagramStep`).
- **New steps start enlarged.** Every new step after an enlarged step is
  seeded enlarged at creation (`seedNewSteps` in `zoomFrames.ts`, Z2 in
  `diagram-revision-2.md`). That includes an empty Add Step, an upload and a
  pulled References card. An empty step's frame lands with its first picture
  (`landSeededFrame`, called from `commitStepCapture` in
  `store/workspaceStore/diagramCapture.ts`).
- **The bug.** If you link that step as a Crease Pattern after a Folded run,
  it enlarges a corner of the crease pattern.

The design:

- **The new link's default.** A step with no link defaults to the previous
  step's picture type (Crease Pattern, Folded or Simulated), turns passed
  over. That is the previous linked step's `showAsOf(render)`. With no linked
  step before it, the default is today's `lastLinkedAs`. This amends D19's
  "the picker offers the way it last linked" for this one case. A relink
  still offers the way the step is shown.
- **An enlarged run continues only with the same picture type.** A new step
  stays enlarged only if it shows the same picture type as the run's source
  (the step its seed was captured from).
  - Linked as a different type: its first picture drops the seeded zoom in
    the same undo step as the capture, and the step starts unenlarged.
    `landSeededFrame` decides this, given the run's type.
  - Uploads and pulled References cards start unenlarged. Both go through
    `commitMade` in `diagramSlice.ts` (`addDiagramPictures`,
    `pullReferencesDiagramSteps`), so `commitMade` stops seeding the steps
    they make.
  - An upload that fills an empty seeded step drops the seeded zoom instead
    of landing it. This is `commitMade`'s `filled` path, used by
    `addDiagramPictures` and `setDiagramStepPicture`. Replacing the picture
    on a step that already has one, and is enlarged, keeps it enlarged.
  - The 17d trim of a card's marks to its frame (`withCardMarksInFrame`)
    then has no caller for new cards. Remove it, or keep it only where it is
    still reached.
  - The model cannot tell an empty step that was seeded from one enlarged by
    hand before its picture. Both follow these rules. Say so if a test shows
    that is wrong.
  - This amends Z2 ("new steps added after an enlarged step start enlarged")
    and 16g/17d. The plan doc records it.
- **Switching Show as keeps the step enlarged.** On a step that is already
  enlarged, switching Show as is unchanged: it keeps the step enlarged
  through the Crease Pattern landing already built (`followOwnPicture` /
  `landedOnSheet`). One click on the toggle, now in Annotate (item 2), turns
  it off.
- **Analytics.** `diagram step enlarged` via `seeded` no longer counts
  uploads or cards. Say so in `docs/analytics.md`. Dropping a seeded frame is
  not a user action, so there is no event for it.

### 4. "Area out of date" notices

- **Record the area's state.** When an enlarged step is captured (toggle,
  seed, Update), it records the area's state then. That state is the
  outline (centre, radius or size, angle, which gives the shape) and the
  anchor. It also records the area's step id, so a deleted area can still be
  named. The new optional field on `DiagramStepZoom` is, say,
  `areaWas: { stepId, outline, anchor? }`. It is read and written in
  `readStepZoom` / `writeStepZoom` (`diagramFile.ts`) and is unsaid when
  absent. A file without it is never flagged. *(Amended after review: such a
  step is recorded at the first hand edit of its area, below.)*
- **Compare it with the area now.** A pure function in `diagram/zoom/`
  compares the recorded state with the area now (`from`): current, changed,
  deleted or unknown (no record). This sits beside the link status
  (`capture/linkStatus.ts`). Only a hand edit flags a step: moving,
  resizing, changing Shape or re-anchoring. An area carried by its own
  step's picture change (Refresh, re-pose: `carriedOutline` and
  `annotationCarry.ts`) covers the same paper. That carry moves the record on
  each enlarged step in the same edit, so it does not flag. Undo puts the
  record back, because the status is derived, not stored.
- **Changed.** Each enlarged step made from the area says
  "Out of date: Step N's area changed", with Update.
  - In the Step pane: the sentence and an Update button, as the picture's
    "Out of date: the pattern changed" has Refresh Picture.
  - On the card: a chip in the card's short form ("Area changed", as
    "Pattern changed" is). The picture's own Out of date chip comes first.
  - Update is a catalog verb (`diagramActions.ts`, beside Refresh Picture)
    and a new store action, `updateEnlargedDiagramStep(stepId)`, built on
    `updateInStore` with one target. It is one undo step.
- **Update all.** The area's own step gets Update all, which replaces today's
  Update Enlarged Steps (`buildAreaActions` and the Layers area row). It
  updates the out-of-date steps from that area as one undo step. Notices that
  name "Update Enlarged Steps" (`enlargedNoPaper`, `enlargedUnanchoredUpdate`,
  `enlargedRefreshUpdate`) are reworded.
  - *Item 2 built nothing for the area's own step.* Annotate's Enlarged
    section (`DiagramStepEnlarged`) there is only the switch, held, and its
    reason ("No earlier step has an area to enlarge: draw one with Enlarge")
    says to draw an area the step already has. Item 4 adds Update all to that
    section, and that case needs its own words (all 9 catalogs): for example
    "Enlarged on steps 23–25" (`areaSubtitle`). Built with that line and a
    tooltip of its own on the held switch (see the checklist); Zach to
    confirm.
- **Deleted.** If the area is deleted, the enlarged steps keep their frames
  and say "Step N's area was deleted", with no Update. If the area's step is
  gone too, today's "An area no longer in the diagram" stays.
- **Analytics.** Update on one step is a new action. `diagram step enlarged`
  gains `via: 'update_step'` beside `update`, documented in
  `docs/analytics.md`. Update all stays `update`.
- **Amended after rf4's review (my picks, for Zach to confirm).** The code
  proved the decided record too narrow in two places:
  - *Size and Edge are recorded too.* A capture copies the area's Size and
    Edge (Revision 2: "on an area, Size is what later captures copy"), so
    with only outline and anchor recorded, a Size or Edge changed on the area
    said nothing and Update All refused it, while a single Update pushed it
    and threw away a Size set on the step. Now `areaWas` records them; a step
    whose own Size or Edge equals what it recorded *takes* the area's, one
    that differs set its own. The area's Size or Edge changed says "Area
    changed" to the steps that take it, and Update places the frame from the
    area and keeps a Size or Edge set on the step (`withOwnPrint`). An Edge
    is told by how it draws (Cut said on a circle is the circle's own).
  - *Older files are recorded at the first hand edit of their area.*
    Enlarged steps never shipped, so every diagram Zach has (the crane among
    them) is an "older file", and "never flagged" meant the feature did
    nothing on them. A hand edit of an area now records the area as it was
    just before the edit on each step from it with no record
    (`recordAreaBeforeEdit`, in `editStepAnnotations`, the same undo step),
    so the edit flags them as it flags any step. Nothing is recorded at open,
    and a carry by the area's picture records nothing. Not chosen: recording
    every step at open (a document change on load, and a file whose area was
    moved before saving reads as current).
  - *One predicate.* `outOfDate` (`areaStatus.ts`) is the one question for
    the Step pane's Update, Update All everywhere and what they place; the
    card's chip says the narrower "the area changed". A step with no record,
    a frame needing a Refresh first, and a frame moved or sized by hand on
    itself are not out of date. Update is held ("Up to date with step N's
    area") otherwise, as Refresh Picture is, and the store refuses it, so no
    undo step changes nothing.

### 5. Enlarged turned off, and Show as Simulated

#### (a) Turning Enlarged off maps the marks back onto the same paper

Today:

- **Marks are in the window's units.** An enlarged step keeps its marks in
  its window's units (16e). Turning Enlarged off carries them from the window
  to the whole picture: `unenlargeStep` → `withZoom` → `carryBetween` →
  `carryMarks`. Turning it on carries them the other way, and lines across
  the frame are trimmed (16h).
- **The bug.** `carryMarks` moves the author's marks only while they are in
  step with the picture (`annotatedPictureKey` is the picture's key). Marks
  drawn on an older picture keep the window's numbers. On the whole picture,
  those numbers spread the marks over the model.
- **On the crane.** Steps 23 and 24 open out of step: their marks were drawn
  before the picture last changed (D8). Turned off, each mark moved 0.63
  picture units, from the head to the middle of the model.

The design:

- **A change of units carries every mark.** This applies when a window is
  placed on the picture the step shows, moved on it or dropped. Every mark
  the build can read goes, in step with the picture or not, so each stays
  where it shows on the picture. The step stays in or out of step as it was:
  `carryMarks` gains `unitsOnly`, and `carryBetween` sets it. That is
  `withZoom`'s one carry.
- **Off and on.** Turned off, the marks land where the window showed them.
  Turned on again, they go back into the window. Each is one undo step, as
  before. Lines trimmed at the frame stay trimmed (16h's accepted change),
  and trimming them again on the way in changes nothing.
- **The same rule wherever `withZoom` carries.** Besides off and on, that is:
  - the frame moved, resized or reshaped by hand;
  - Update and Update All (rf4's known gap: "Update leaves the step's own
    marks where they were in the window");
  - faces given to a picture in place (`anchorInPlace`).

  Each is a change of units on one picture, so a mark there would otherwise
  move on the paper.
- **`startsWhole` is a change of picture, and carries too.** It is the one
  other `withZoom` carry: a step that had no picture takes one (an upload,
  a References card, or a first link of another type than its run) and
  drops its frame. Its marks were drawn in a window on another picture,
  most often, so they mark nothing on the new one either way. Item 3
  accepted carrying them to the whole picture ("carries its marks to the
  whole picture, where they mark nothing"). Before rf5 only marks in step
  with the new picture went, which happens only when the same picture is
  given back; the rest kept the window's numbers. Now every mark this
  build can read goes, and stays out of step with the new picture, so item
  3's accepted rule now holds. On the crane's step 24, Remove Picture then
  an SVG upload puts the marks small at the upload's upper right, where
  the frame sat in picture units (the review's probe,
  `artifacts/review-fixes/5/startswhole/3-uploaded.png`).
- **Unchanged.** A step with a mark this build cannot read still keeps them
  all where they were, out of step. So does a step with a mark that could not
  come back within reach. A re-pose, a Refresh and a relink change the
  picture, not only the units, and carry as before (D8).

#### (b) Show as Simulated on an enlarged step

Planned: the frame lands on the simulated picture's paper, so every Show as
lands properly:

- Crease Pattern through the Z8 amendment's top-face landing;
- Folded and Simulated through the imprint.

*As found (not built; Zach to choose).* The imprint cannot land on a
simulated picture today, because a simulated picture has no faces on the
paper. Z8 decided this: "3D, simulated, References and uploaded steps keep
the frame in picture units", and `paperFacesOf` returns null for them.

Show as Simulated always captures at 0%, which is the flat sheet seen
through the step's camera (`renderToShowAs`, `flatScene`). The frame keeps
the place it had in picture units, so it shows other paper. On the crane,
by the Step pane's Show as buttons (the implementer's
`probe-showas-<23|24>-strip.png`; the reviewer's
`review/b-light-24-strip.png` and `review/b-dark-23-strip.png`, under
`artifacts/review-fixes/5/`):

- **From Folded,** the frame shows a slice of the tilted sheet, not the
  head.
- **From Crease Pattern,** it frames the corner of the picture's box, where
  the diamond-shaped sheet leaves only white, the marks floating there.
- **The same step lands on different paper by the path it took.** The
  imprint survives Simulated, so Folded is landed right again. But
  Folded → Simulated → Crease Pattern lands through the anchor face's
  imprint, not the top face's (`landedOnSheet` needs the picture before to
  be a folded one with faces): step 23's frame goes to (0.19, 0.92), the
  bottom-left of the sheet, where Folded → Crease Pattern puts it on the
  head's corner at (0.965, 0.984). That is the miss the Z8 amendment fixed.
  Crease Pattern → Simulated → Crease Pattern is fine, and every Undo gives
  the step back as it was.

*Corrected after review.* The first write-up said nothing in a stored
simulated picture says where the paper lies in it, so landing needs new data
at capture. That went too far. The step keeps its camera (`render.view`), and
a 0% picture is a fixed function of the region's simulator fold and that
camera:

- `flatScene` scales the fold (`foldScaledForSolver`), takes its flat
  positions, frames them (`framingOf`), and projects them through
  `cameraUniforms(view, centre, radius, 512, 512)` (`SIMULATED_FRAME_PX`)
  with perspective (`stillFrame`);
- `meshToPaperScene` paints each mesh triangle straight between its
  projected corners (`projectVertices`, the CPU mirror of the shader), so
  the map from the paper to the picture is affine on each triangle.

The main thread already builds that fold (`storeSimulationFold`) before
handing it to the worker. What is missing is the map itself, not anything
it is made from. *Checked on the crane* (`option-1b/probe-1b.mjs`, steps 23
and 24): the main thread ran the worker's own steps on the fold it sent, and
every corner the stored scene paints (328) lies on the projected mesh within
0.006 px, the scene's 0.01 px storage step; the two bounds agree to 0.005
px. The fold's sheet lies at (x, 0, z), x from −200 to 200 and z from
−5700 to −5300, so its paper coordinates need a shift, and perhaps a flip,
that this did not check.

Options. Each says what it does to the path-dependent landing above.

1. **A 0% simulated picture keeps its faces on the paper**: each mesh
   triangle's place on the paper and in the picture, stored as
   `paperFaces` as a flat fold's are, not in the picture's key. Then:
   - `paperFacesOf` reads them as an unfolded sheet, and `landedOnSheet` and
     `anchoredOffSheet` treat any unfolded sheet (a crease pattern or a 0%
     simulated picture) alike. That fixes the path dependence too.
   - The file reader keeps `paperFaces` on a 0% simulated picture (today
     only on a flat fold's, `diagramFile.ts`, with a fit check like
     `paperFacesFitScene`). The field exists; an older build drops them, as
     it reads any picture without faces.
   - Simulated steps captured before have none until refreshed. Pose's
     captures above 0% are the solver's positions, which only the worker
     has, so they stay in picture units.
   - **At a tilt the window shows the same paper at its centre, but not the
     same shape of it.** A triangle's map is affine, while the imprint fits
     each face's placement as a similarity (`zoomImprint.ts`). Under the
     crane's simulated camera (pitch −0.955, yaw 45°), the square sheet is
     a diamond 598 px wide and 369 px tall in the stored scene, about 0.6
     as tall as wide. A circle in the window then covers an ellipse on the
     paper, and a similarity fitted to a large triangle (the crane's mesh
     has 70) misplaces the centre. The placement for this kind of face
     should be the triangle's own affine map (a change in `zoomImprint`
     for it); untested.
   - It amends Z8, and it is a phase of its own: capture, the file,
     `zoomImprint` and tests.

   Where the faces are made is an implementation choice, not a product one:
   - **1a. In the worker**: `flatScene` returns them beside the scene. The
     worker prepares that mesh already; one more return value from it.
   - **1b. On the main thread** (the review's option): from the fold it
     already builds and the step's camera, with the worker's own pure
     functions (`framingOf`, `cameraUniforms`, `projectVertices`;
     `foldScaledForSolver` moved out of the worker's module so the two
     share it). No change to the worker's API, and the probe above shows it
     exact on the crane; but the main thread prepares the mesh a second
     time per capture (`prepareFoldModel`), unmeasured on a dense model.
     Kept only in memory rather than in the file, a reopened file's
     simulated steps have none until refreshed; rebuilding them later needs
     the pattern as it was at capture.
2. **Show as Simulated turns Enlarged off,** in Show as's undo step, as a
   first link of another type does since rf3. A plain trade-off: it
   reverses item 3's decided rule ("switching Show as keeps the step
   enlarged") for Simulated only, while Crease Pattern, the other view of
   the unfolded sheet, stays enlarged through its top-face landing. It is
   small. The path dependence goes, since a Simulated step is no longer
   enlarged.
3. **Keep Z8, and fix only the round trip.** Folded → Simulated imprints
   afresh through the top face, as the Z8 amendment does onto a crease
   pattern, so a later Crease Pattern lands on the head. It is small, and
   fixes the path dependence, but the simulated window still shows other
   paper. It is also the first step of option 1.

*Recommended,* if Show as Simulated stays enlarged: option 1, made in the
worker (1a), since the worker prepares the mesh already; 1b if the worker's
API should stay as it is. Option 3 alone keeps the step enlarged on a
window that shows other paper, which is what (b) set out to fix.

### 6. A halo along the sheet's edge, and two phone fixes

#### (a) A Text halo follows the sheet's edge

Today:

- **One colour, by the centre.** A haloed label on a References picture
  takes one colour from where its centre is (17b, `labelOnPaper`): the
  face it stands on, or the page's white off the sheet.
- **The bug.** A label across the sheet's edge spills that colour past it.
  A pulled letter half off a grey back paints grey onto the white page, and
  one whose centre is just off it cuts a white notch into the grey.

The design (decided):

- **Two parts.** The halo is the face inside the sheet's outline and the
  page's white outside it, so it follows the edge exactly.
- **Other pictures.** Halos on folded and simulated pictures stay page
  white.

As built:

- **Which labels.** The label's reach (`labelReach`, the box
  `annotationReach` crops a file to) is tested against the sheet's outline
  (`boxOnSheet`; a sheet's outline is convex). Wholly on it, the halo is
  the face, as before. Wholly off, it is the page's white. Across the edge,
  it is both. A face that is the page's white, as the Diagram preset's
  front is, is one colour anywhere. Labels that do not cross the edge keep
  their markup byte for byte.
- **How the two parts are painted** (*deviation in mechanism, not in
  look*). The one halo stroke is painted with an SVG pattern
  (`AnnotationHaloAcross`, `haloPatternElement`). Its tile covers the
  label's reach and an em more, and holds the page's white with the sheet
  over it in the face. Two copies of the stroke, clipped inside and outside
  the sheet, were not used, because:
  - Two clips that meet on the edge each soften it, so a hairline of the
    sheet's edge line shows through the halo.
  - The white laid whole under a clipped face was tried first. It leaves a
    light rim round the grey part, where the two strokes' softened rims
    stack. This was seen on the canvas.
  - krilla (the PDF writer) sets a stroke-only `<text>` as text, so the
    copies would set the words three times in the PDF. With one stroke,
    `pdftotext` reads each word once.
- **Pattern ids.** A pattern's id is made from what it paints
  (`keyDigest`). A page cell renames it (`prefixIds`). The Annotate canvas
  names it for its layer (`useId`, through `annotationMarks`' `scope`), as
  close-ups name their clips.
- **Off the sheet the halo is still white.** So a halo past the sheet still
  shows on a page's flow band, as decided.
- **Pulled letters.** A pulled letter across the edge no longer matches
  its baked card's one-colour halo. The 17d equivalence test says so for
  that case alone, and counts in a test of its own that the fixtures meet
  that case.
- **Baked letters are unchanged** (*for Zach*). Only Text labels follow the
  edge, pulled letters included. References' own letters, before Make
  Marks Editable, still take one colour by the box's centre (`labelOnPaper`
  in `cp-workspace/references/diagram/DiagramPrimitives.tsx`). That is the
  default state of every References step in the Diagram (card, page, PDF),
  and the References workspace itself. So:
  - a letter across the edge on an unpulled step still spills its colour,
    as before rf6;
  - Make Marks Editable now visibly changes such a letter, so 17d's rule
    that a pulled step paints as its baked card no longer holds for it.

  Recommended follow-up: give baked letters the same pattern halo in
  `DiagramPrimitives`, which makes pulling a visual no-op again and
  restores 17d's rule. Built in item 7(b).
- **Known.** poppler (`pdftoppm`) draws a 6/255 lighter hairline round the
  pattern's part at 600 dpi. CoreGraphics (Preview, QuickLook), Chromium
  and WebKit draw none.
- **Known, not rf6.** The sheet's edge line shows through the hole of a
  letter on the edge (a small tick inside the Q), on the canvas, in WebKit
  and in the PDF. A halo is a stroke a fixed width round each outline, so
  it does not reach into a hole. Filling the holes in the halo's colour
  would change References' baked letters too, so it is left unless Zach
  finds it distracting.

#### (b) Dialogs opened from the Settings sheet open over it

Today:

- **Where each is in the document.** Every touch sheet portals itself to
  the end of `<body>`: the View or Settings sheet, Edit's and Simulate's
  tool sheets, and Design's pane list. `App`'s modals are inside `#root`.
- **Why the sheet wins.** Both are on the modal tier, where the later in
  the document is on top. `topmostModalDialog` also takes the last one as
  the dialog that owns the keys.
- **The bug.** Every dialog a sheet opens is under it. Checked on a phone:
  Replace from References… and Delete Step's question. One Escape closed
  both the dialog and the sheet.

The fix, at its cause, with no z-index changed:

- **A sheet layer before the modals.** `App` renders a sheet layer
  (`SheetLayer`) ahead of every modal and registers it in `layoutStore`
  (`sheetLayer`). Every sheet portals into it (`SheetPortal`), or into
  `<body>` before it is there.
- **Order matches stacking again.** A dialog opened from a sheet comes
  later in the document, so it is drawn on top and holds focus and keys.
- **Escape.** A sheet's Escape stands down while a dialog is over it
  (`isTopmostDialog`), as `useModalDialog`'s does. A shortcut can open a
  dialog over any sheet (sheets are not shortcut barriers), so this is
  every sheet's, not only the View sheet's. All four now close on Escape
  through one hook, `useSheetEscape` (`components/ui/`), whose predicate
  `sheetOwnsEscape` holds every case in which the key is another's: a
  field's, an open layer's, an armed mode's, a dialog's over the sheet.
  Before review, the tool sheets and the pane list each had their own
  listener, with fewer guards than the View sheet's, and one Escape closed
  both a Settings dialog (⌘,) and the sheet under it.

#### (c) A step's header on a phone

Planned: the Steps grid card header wraps onto three rows on a phone
("Step 24 · Enlarged… · CREASE PATTERN"). Keep it on one row, with the
chips truncating as on the desktop.

*As found (not built; Zach to choose).*

- **The card header does not wrap.** At 375 px in WebKit (iPhone X) it is
  one 33 px row, light and dark, with Folded, Crease Pattern and
  Simulated · 0% badges (`probe-c.mjs`). Its CSS cannot wrap: `.header` is
  a flex row without `flex-wrap`, and the chip already gives way first.
- **The three rows are the open step's header** (Pose or Annotate), which
  17f photographed:
  - ← Steps, then ‹ Step 24 of 25 ›;
  - Pose | Annotate;
  - Undo, Redo, Done and Settings (`probe-c-open.mjs`).
- **That header has no chips to truncate.** Fitting it on fewer rows is a
  layout choice: which of nine 44 px controls give way. Its last two rows
  alone need about 380 px together, against 359 px across a phone. So it is
  not invented here.

*Recommended, and built in item 7(a) (mock in
`artifacts/review-fixes/6/mock-c.png`, from `mock-c.mjs`, which edits the
live page's DOM):*

- **Leave out the Pose | Annotate switch on a phone.** On a phone, Annotate
  is only the note "Annotate on a larger screen", so the switch offers a
  dead end. The phone already leaves Spread Layers out of the pose toolbar
  for the same reason (it would wrap a row).
- **Two rows at 375 px and at 320 px:** "← Steps ‹ Step 24 of 25 ›", then
  "↶ ↷ Done Settings". Today it is three at both.
- **Nothing is stranded.** The Step pane's Annotate button is the one other
  way into Annotate on a phone. The note it leads to would get a Pose
  button.
- **One component.** It is `DiagramStepDetail`, which already knows it is
  on a phone. No shared block changes.
- **Alternative:** keep every control and make the Settings pill icon-only
  on a phone. That is two rows at 375 px but still three at 320 px, and the
  pill is the shared View or Settings trigger every workspace seats
  (`.view-drawer__trigger`).

### 7. Item 6's two open recommendations

Decided under Zach's standing instruction (2026-10-08): "go with your recs
from now on unless there is a large fork in the design to be figured out,
until i say otherwise".

#### (a) A phone's open step has no Pose | Annotate switch

6(c)'s recommendation, as built:

- **The switch.** `DiagramStepDetail` leaves `SegmentedControl` (Mode) out
  when `useIsPhoneLayout()` holds: a coarse pointer on a phone-sized
  viewport, the app's one phone predicate. On a phone, Annotate is only the
  note "Annotate on a larger screen", so the switch offered a dead end, as
  Spread Layers would have in the pose toolbar.
- **Two rows.** The header is "← Steps ‹ Step N of M ›", then
  "↶ ↷ Done Settings", at 375 px and 320 px (WebKit, iPhone X and SE).
  Before, three at both.
- **Nothing stranded.** The Step pane's Annotate button still opens the
  note, which now has a Pose button (the existing `diagram.detail.pose`
  string, so no new string).
- **CSS.** None changed: the switch is not rendered, and the note's grid
  (`.message`) already stacks a button under its sentence. No shared block
  is touched.
- **iPad and desktop.** Unchanged: WebKit iPad (1024 px, touch) and Chromium
  at 1280 px, every header control's box and computed style, and the
  header's pixels, are identical before and after.

#### (b) References' own letters' halo follows the sheet's edge

6(a)'s follow-up, as built:

- **Which letters.** A References letter in a picture that leaves the app:
  the Diagram's card, page and PDF (the baked scene, `diagramToPaperScene`),
  and References' own exports. They took one colour by their box's middle
  (`labelOnPaper`). Now, as Text does since rf6, a letter wholly on the
  sheet takes the face, wholly off it the ground, and across the edge one
  stroke painted by a pattern of the sheet.
- **One piece of code.** The decision (`boxOnSheet`), the tile and its id,
  and the pattern (`haloPatternElement`) move out of `annotationPrimitives`
  into `cp-workspace/references/diagram/sheetHalo.tsx` (`sheetHalo`), the
  lower of the two layers. Text's halo calls it with its own reach
  (`labelReach`); a References letter with its box and half its halo round
  it (`letterHalo` in `DiagramPrimitives`).
- **Byte for byte where nothing crosses.** `sheetHalo` returns the very
  face and ground strings as before. The 17d fixtures' 144 baked scenes
  (each fixture, both faces, three styles, three sizes) compared with HEAD:
  15 changed, each in one letter, across the edge; the rest identical
  (`artifacts/review-fixes/7/baked/`). References' goldens are unchanged.
- **The pattern's id names its ground.** It is made from what it paints, and
  a References picture's ground is the page's, not always white. So a Text
  label across the edge has a new id value; its markup is otherwise the same.
- **17d's rule holds again.** `referencesCardMarks.equivalence.test.ts`
  checks a pulled letter against its baked one:
  - both across: the same sheet, face and ground;
  - one colour both: the same colour;
  - pulled across, baked one colour: the baked colour is the pattern's on
    the side the baked letter reaches.

  The last happens because Text measures its words in Noto Sans with room
  round them, a References letter by its box, the tighter of the two; the
  reverse never happens. A count checks the fixtures meet letters across the
  edge baked as well as pulled.
- **On screen, unchanged.** The References workspace's card and the big
  view colour a letter's halo by class from the theme
  (`.step-diagram__label--on-paper`, `theme.css`). A pattern there would need
  new rules in that global block, which the CSS rules do not allow in a fix.
  Moving it is its own PR, and Zach's call; until then a letter across the
  edge on screen takes one colour, as before.

## Affected Areas

Paths under `apps/web/src/` unless rooted.

- **1. Path width.**
  - `diagram/document/diagramDocument.ts` (`DiagramPageSetup.pathWidthMm`,
    `DEFAULT_PATH_WIDTH_MM`, `PATH_WIDTH_MM_RANGE`, `DEFAULT_PAGE_SETUP`,
    `normalizePageSetup`)
  - `diagram/document/diagramFile.ts` (`writePageSetup`)
  - `diagram/pages/diagramPageLayout.ts` (`AUTO_PATH_WIDTH_SHARE` and
    `pathWidthMm()` removed)
  - `diagram/pages/useDiagramPageSetup.ts`
  - `components/panels/DiagramPagePanel.tsx`
  - Tests: `diagramFile.test.ts`, `flowLane.test.ts`, `stepPlaces.test.ts`,
    `placeGolden.test.ts`, `DiagramPagePanel.test.tsx`
  - `implementation-plans/diagram-workspace.md` (the width amendment's
    note)
- **2. Enlarged in Annotate.**
  - The toggle comes off Pose: `components/diagram/DiagramStepDetail.tsx`
    (`poseToolbar`), `components/diagram/DiagramLinkedPoseControls.tsx`
    (`enlargedButton`), `components/diagram/DiagramStepPose.tsx`
    (`EnlargedRow`).
  - The Step pane: `components/panels/DiagramStepPanel.tsx`,
    `components/diagram/DiagramStepZoomStatus.tsx` (or a new
    `DiagramStepEnlarged` beside it).
  - Bindings: `diagram/zoom/useStepZoom.ts`, `diagram/zoom/useZoomControls.ts`,
    `diagram/zoom/zoomActions.ts`, `components/diagram/DiagramZoomControls.tsx`
    (a shared row component if both panes compose it).
  - Analytics docs: `docs/analytics.md`.
  - i18n: `public/locales/*/panels.json` (`diagram.pose.enlarge*`,
    `diagram.stepPane.enlarged*`, `diagram.annotate.enlargeHelp`).
  - Tests: `DiagramStepDetail.test.tsx`, `DiagramLinkedPoseControls.test.tsx`,
    `DiagramStepZoom.test.tsx`, `DiagramStepPanel.test.tsx`,
    `DiagramZoomControls.test.tsx`.
- **3. New steps after an enlarged one.**
  - The picker's default: `diagram/capture/stepCaptureActions.ts`
    (`pickerShowAs`, `linkDiagramStep`), `diagram/capture/useStepLink.ts`.
  - Seeding: `diagram/zoom/zoomFrames.ts` (`seedNewSteps`, `landSeededFrame`,
    `withCardMarksInFrame`), `diagram/zoom/zoomCapture.ts` (`seedSource`,
    `firstLinkPose`), `store/workspaceStore/diagramCapture.ts`
    (`commitStepCapture`), `store/workspaceStore/slices/diagramSlice.ts`
    (`addAt`, `commitMade`, `addDiagramPictures`, `setDiagramStepPicture`,
    `pullReferencesDiagramSteps`), `store/workspaceStore/diagramZoom.ts`
    (`trackSeeded`, `trackSeededSteps`).
  - Docs: `docs/analytics.md`; `implementation-plans/diagram-revision-2.md`
    (Z2 amended).
  - Tests: `zoomFrames.test.ts`, `zoomCapture.test.ts`,
    `stepCaptureActions.test.ts`, `useStepLink.test.tsx`,
    `referencesPulledSteps.test.ts`, `diagramZoom.test.ts`.
- **4. Area out of date.**
  - Model and file: `diagram/document/diagramDocument.ts`
    (`DiagramStepZoom`), `diagram/document/diagramFile.ts` (`readStepZoom`,
    `writeStepZoom`).
  - Recording and carrying: `diagram/zoom/zoomFrames.ts` and
    `zoomCapture.ts` (record at capture), `diagram/annotate/annotationCarry.ts`
    (carry the record).
  - A new status module in `diagram/zoom/`. `diagram/zoom/zoomActions.ts`
    (`StepZoomNotice`, `stepZoomStatus`, `buildAreaActions`).
  - Store: `store/workspaceStore/diagramZoom.ts` (`updateInStore`) and
    `diagramSlice.ts` (new `updateEnlargedDiagramStep`).
  - Catalog: `diagram/actions/diagramActions.ts`.
  - UI: `components/diagram/DiagramStepCard.tsx` (chip),
    `components/diagram/DiagramStepZoomStatus.tsx` (notice and Update).
  - Analytics: `analytics/events.ts` (`DiagramStepEnlargedVia`),
    `analytics/trackDiagramZoom.ts`, `docs/analytics.md`.
  - i18n: `public/locales/*/panels.json`.
  - Tests: beside each module, plus a file round-trip in
    `diagramFile.test.ts`.
- **5. Enlarged turned off, and Show as Simulated.**
  - (a): `diagram/zoom/zoomFrames.ts` (`carryMarks`, `carryBetween`,
    `startsWhole`'s comment; the module's table). Tests:
    `zoomFrames.test.ts`, `diagramZoom.test.ts`, `diagramDocument.test.ts`
    (Remove Picture then Upload). Docs:
    `implementation-plans/diagram-revision-2.md` (the table's "Enlarged
    turned off" row).
  - (b), if option 1 is chosen: `diagram/capture/captureFolded.ts`
    (`captureSimulated`, `SimulateFlat`),
    `store/workspaceStore/diagramCapture.ts` (`storeSimulateFlat`),
    `diagram/zoom/zoomImprint.ts` (`paperFacesOf`, a triangle's affine
    placement), `diagram/zoom/zoomFrames.ts` (`landedOnSheet`,
    `anchoredOffSheet`), `diagram/document/diagramFile.ts` (`paperFaces` on
    a 0% simulated picture). 1a adds `simulator/simulatorSession.ts`
    (`flatScene`); 1b moves `foldScaledForSolver` out of it into a module
    the main thread shares.
- **6. A halo along the sheet's edge, and two phone fixes.**
  - (a): `diagram/annotate/annotationPrimitives.tsx` (`haloPaint`,
    `labelReach`, `boxOnSheet`, `labelElement`, `haloPatternElement`,
    `annotationMarks`' `scope`), `components/diagram/DiagramAnnotationLayer.tsx`.
    Tests: `textOptions.test.tsx`, `textHaloSurfaces.test.ts`,
    `referencesCardMarks.equivalence.test.ts`, `DiagramAnnotationLayer.test.tsx`.
  - (b): `components/SheetLayer.tsx` (new), `store/layoutStore.ts`
    (`sheetLayer`), `App.tsx`, `components/WorkspaceViewDrawer.tsx`,
    `hooks/useWorkspaceViewDrawer.ts`, `components/DesignPaneSwitcher.tsx`,
    `cp-workspace/toolCatalog/CpToolsTrigger.tsx`,
    `simulator/SimulatorToolsTrigger.tsx`; Escape through
    `components/ui/useSheetEscape.ts` (new) from `useWorkspaceViewDrawer`,
    `components/ui/tools/useToolPickerSheet.ts` and `DesignPaneSwitcher`.
    Tests: `SheetLayer.test.tsx`, `WorkspaceViewDrawer.test.tsx`,
    `CpToolsTrigger.test.tsx`, `SimulatorToolsTrigger.test.tsx` (new),
    `DesignPaneSwitcher.test.tsx` (new).
  - (c): none (a mock only).
- **7. Item 6's two open recommendations.**
  - (a): `components/diagram/DiagramStepDetail.tsx`. Tests:
    `DiagramStepDetail.test.tsx`.
  - (b): `cp-workspace/references/diagram/sheetHalo.tsx` (new),
    `cp-workspace/references/diagram/DiagramPrimitives.tsx` (`letterHalo`, the
    label's shape), `diagram/annotate/annotationPrimitives.tsx` (`haloPaint`
    calls `sheetHalo`; `boxOnSheet`, `haloPatternElement` and
    `AnnotationHaloAcross` moved). Tests: `diagramToPaperScene.test.ts`,
    `referencesCardMarks.equivalence.test.ts`.

## Checklist

### 1. Path width defaults to 20 mm

- [x] `DEFAULT_PATH_WIDTH_MM = 20`; `pathWidthMm: number`; unsaid or damaged reads as 20
- [x] Proportional mode removed (`AUTO_PATH_WIDTH_SHARE`, `pathWidthMm()`)
- [x] Written only when not 20, the same as `pathColor`
- [x] Page pane: shows the stored width; Reset only when not 20, back to 20
- [x] Tests: file round-trip, flow lane, step places, Page pane; page golden re-taken with the reason
- [x] Plan note in `diagram-workspace.md`; analytics unchanged (`path_width` still means set or reset)
- [x] No new strings (i18n unchanged)
- [x] Nearby tests, `tsc --noEmit`, eslint on changed files (and the whole vitest suite: 12000 passed)
- [x] Browser: crane flow page, Page pane at 20 and the ribbon (`artifacts/review-fixes/1/`)
  - The crane says 25 mm. Reset showed, and pressing it set 20: the field
    read 20, Reset went away, and the band laid out at 20 mm, with no
    console errors.
  - Screenshot: `crane-flow-page-path-20mm.png`. Script: `shot.mjs`.
    Results: `shot.json`.

### 2. Enlarged settings move to Annotate

- [x] Annotate's Step pane: an Enlarged section with the toggle, From, Size with Fill, Anchor Pick/Reset, read-out, notices
  - `components/diagram/DiagramStepEnlarged.tsx`, composed by
    `DiagramStepPanel` only while annotating. It binds `useStepZoom` (the
    switch, status, notices) and, on an enlarged step,
    `useZoomControls(step, { kind: 'frame' })` (Size, Anchor, read-out, and
    the frame's Go to Area for From).
  - The rows both panes draw are one file, `DiagramZoomRows.tsx`
    (`ZoomSizeRows`, `ZoomAnchorRow`, `ZoomReadout`, `ZoomNote`, `ZoomVerb`),
    taken out of `DiagramZoomControls` with their CSS, module to module. The
    Layers frame controls' computed styles and boxes are unchanged
    (`layers-styles.mjs`). `DiagramStepZoomStatus` exports `EnlargedFromRow`
    and `StepZoomNotices`, so both sections say them with one set of strings.
  - **Pick selects the frame.** The canvas picks only round the selected
    area or frame (`activeAnchorPick`). So `pick` in `useZoomControls` arms
    the pick, then selects its target; in Layers that is a no-op.
  - **Pick keeps the Step pane forward.** Layers' reveal passes over a layer
    selected to pick its anchor (`layerToReveal` in `useDiagramPaneReveal`).
    Arming before selecting makes this hold for a key press too. The Step
    pane stays, with Pick pressed and focused; Escape puts the pick down, a
    second lets the frame go, and the side column never moves. Layers' own
    Pick is unchanged.
  - **From goes to the area** (the frame's Go to Area), which brings Layers
    forward with the area selected, like any Go to that lands on a mark.
- [x] Toggle off Pose's toolbar and out of Pose's Step pane section; read-only section hidden in Pose
  - `enlarged` left `DiagramLinkedPoseControls` and `EnlargedRow` left
    `DiagramStepPose`; `DiagramStepDetail` lost `useStepZoom`. No shortcut,
    menu item, command or context menu named the toggle.
  - One exception to "hidden in Pose": a step with no picture made enlarged
    by Add Step or Insert Step After. Annotate cannot open on it, so the
    detail shows Pose, and there the read-only section shows rather than
    nothing (`!annotating && (!detailOpen || !annotatable)`, through
    `stepCanBeAnnotated`).
  - A step with no picture can no longer be turned enlarged, or off, from
    the UI, since Annotate needs a picture. The store's path for it stays for
    seeded steps.
- [x] Phone: the section works in the drawer
  - Phone and iPad drawers render `DiagramStepPanel`, so the section is the
    same there. A phone's Annotate has no canvas, so Pick is not offered
    there, in the Step pane or Layers (`buildAnchorActions` takes `canvas`,
    from `!useIsPhoneLayout()`); Reset still is.
- [x] Tests near each change
  - `DiagramStepZoom.test.tsx` (Pose has no switch, linked or not, phone or
    not; Annotate's section: switch on and off, each one undo step, held with
    its reason, From, Size, Pick then Reset, read-out, notices, read-only
    diagram; the empty seeded step; no Pick on a phone),
    `useDiagramPaneReveal.test.tsx` (Step pane's Pick by click and by key;
    Layers' own Pick), `zoomActions.test.ts` (no Pick without a canvas). Each
    fails before its change.
- [x] i18n in all 9 catalogs (`i18n:extract`, translate, `i18n:stamp`, `i18n:check`)
  - No new or changed strings: every row reuses its keys and defaults, and no
    English string named Pose for Enlarged. `i18n:check` passes.
  - `i18n:extract` re-serialises `fr/panels.json` (no-break spaces become
    ` `, same values). That churn is not this change's and was put back.
- [x] `docs/analytics.md` wording; no new event
  - `enlarge_off`, `diagram step enlarged` (`toggle`) and `diagram
    enlargement changed` say where the switch and rows are since 2026-10-08.
    Events and values are unchanged.
- [x] Review; before/after screenshots (Pose and Annotate, desktop and phone)
  - Two reviewers; the fixer took the major (Pick switched the side column
    to Layers) and three minors (empty seeded step, Pick on a phone, stale
    comments).
  - Gate (rf2 commit): `lint:web`, `tsc --noEmit`, `i18n:check` clean;
    whole vitest suite 888 files / 12013 tests passed (2 files, 15 tests
    skipped).
  - Evidence: `artifacts/review-fixes/2/rf2-evidence.png`, from
    `verify.mjs` (results `verify/verify.json`) and the implementer's
    `before-*` captures at HEAD 1e207458d. Crane step 23, desktop and iPad,
    light and dark: no Enlarged in Pose; in Annotate, Fixed, the switch off,
    and a picked anchor and its Reset are each one undo step and undone by
    Cmd+Z (Edit > Undo on the iPad). No console errors. Earlier runs:
    `shot.mjs`, `drive.mjs`, `fixes.mjs`.
  - Open for Zach (not changed):
    - The section reads "Enlarged" over a switch called "Enlarged". Options:
      the switch on the header row, another label (9 catalogs), or no
      section before any step has an area.
    - On the area's own step the section is only the held switch, with the
      wrong reason (item 4 now carries this).
    - On a phone, the switch is reached only through Annotate's drawer.
    - An empty step that starts enlarged cannot be turned off until it has a
      picture.
    - Turning Enlarged off leaves the step's marks where they sat on the
      enlarged picture (already so; may belong with item 4). *Item 5 (a):*
      the marks were out of step with the picture.
    - Already so, out of scope: the iPad's pick view cuts the crane off at
      the left; FieldRow and SegmentedRow targets in the drawer are under
      44 px; Reset leaves focus on the page once it removes itself.

### 3. New steps after an enlarged one

- [x] The picker's default for an unlinked step: the previous linked step's picture type
  - `nearestEarlierShowAs(document, stepId)` in `diagramDocument.ts` walks
    back like `nearestEarlierSpread`, passing over turns, uploads,
    References steps and a newer build's steps. `pickerShowAs(document,
    step)` offers a relink the way the step is shown, a new link the nearest
    linked step's way, and the session's `lastLinkedAs` only when no step
    before it is linked. `useStepLink` reads it through a store selector, so
    the offer follows the diagram while the picker is open. D19 amended in
    `diagram-workspace.md`.
  - `linkDiagramStep` called with no `way` still links an unlinked step as a
    Crease Pattern. Every caller passes the picker's way; `lastLinkedAs`
    there would make the tests depend on their order.
- [x] A first picture of another type than the run drops the seeded zoom, in the capture's undo step
  - **The run.** `runOrigin` (private, `zoomCapture.ts`) follows a step's
    `captureSource` back past enlarged steps with no picture. It ends at an
    enlarged step with a picture, whose run the step continues, or at an
    area, where a run starts. `runSource` is that enlarged step, and null
    for a step that starts a run. `runShowAs` is the run source's
    `showAsOf(render)`, and null for an upload, a References step, or no run.
  - **Kept or dropped at the first link.** `landSeededFrame` (only from
    `commitStepCapture`) asks `keepsRunFrame` (private, `zoomFrames.ts`). The
    frame is kept and landed when the step was linked already (a file's
    linked step with no picture, given one by Refresh or Pose), when it
    starts a run (as before rf3, however it is linked), or when the linked
    picture's `showAsOf` equals `runShowAs` of the diagram before the
    capture. An upload's run (null) matches nothing. Otherwise the step
    starts whole (`startsWhole`) in the capture's `commit`: one undo step,
    and Undo gives back the empty seeded step. A step that had a picture
    returns early, so Show as, Refresh, relink and Pose are unchanged.
  - **16h's turn follows the rule.** `firstLinkPose(document, stepId, way,
    spread)` reads `runOrigin`. A step continuing a run starts in the run
    source's turn when linked the run's way (158° on the crane) and at no
    turn otherwise, since it starts whole. A step starting a run takes the
    turn of the step its area is on, whichever way it is linked, converted by
    `renderToShowAs`, as 16h did before rf3. A step after another empty
    seeded step now starts in the run source's turn; before, at no turn.
  - `startsWhole(was, next, assets)` in `zoomFrames.ts` is the one rule for
    "a first picture starts whole". It drops the frame of a step that had no
    picture through `withZoom`, the path Enlarged turned off takes, so marks
    kept from a picture since removed go from the window to the whole
    picture.
- [x] Uploads and References cards start unenlarged; `withCardMarksInFrame` callers settled
  - `commitMade` is gone: `addDiagramPictures`, `setDiagramStepPicture` and
    `pullReferencesDiagramSteps` call `commit`. Uploads and cards are never
    seeded.
  - **Deviation: the fill drops the frame where the picture lands, not in
    `commitMade`.** A card filling an empty seeded step must start whole too,
    and its marks are laid out inside `pullReferencesSteps` (`swapCardMarks`
    → `marksIntoUnits`); dropping the frame afterwards would leave its lines
    cut at the frame and lose the marks the frame left out. So `startsWhole`
    runs in `setStepPicture` (upload fill, Replace Picture on an empty step)
    and in `pullReferencesSteps`' fill branch, before the card's marks
    arrive. A step that has a picture keeps its frame through Replace Picture
    and a References Replace.
  - `withCardMarksInFrame` is removed (its only caller seeded new cards).
    `liesInFrame` and `marksIntoUnits` stay, for Replace, Way and Make
    Editable on a References step enlarged later.
  - `seedNewSteps(document, stepIds, assets)` is called only from `addAt`
    (Add Step, Insert Step After; Insert Turn's turn is passed over). It lost
    `filled` and the run tracking that only uploads made in one edit needed:
    an empty seeded step passes on the imprint it copied. It skips a step
    after an enlarged upload or References step (`runSource` set,
    `runShowAs` null), since no first picture could keep that frame; the
    empty card would say "Enlarged · N" for nothing. An exception to Z2,
    recorded there.
  - `trackSeededSteps` only waits for each seeded step's first picture.
  - The model cannot tell a seeded empty step from one enlarged by hand
    before its picture, or from an enlarged step whose picture was removed.
    All follow these rules (see the open calls).
- [x] Show as on an already-enlarged step unchanged; the toggle turns it off in one click
  - A store test shows Crease Pattern on step 2's enlarged folded crane
    keeping its frame, and the switch turning it off in one undo step.
- [x] Tests near each change
  - `diagramZoom.test.ts`: uploads and cards after a run, or filling an
    empty seeded step, start whole and count nothing (Undo gives the seed
    back); Replace Picture keeps a pictured step enlarged; Insert Step After
    an enlarged upload starts whole; a seeded step linked as a Crease Pattern
    after a Folded run starts whole in the link's undo step, and undone and
    linked Folded lands and counts `seeded`; a run start relinked after its
    picture is removed keeps its frame; Show as keeps the frame.
  - `zoomFrames.test.ts` (`landSeededFrame` keeps, drops, leaves a pictured
    step; `startsWhole`; no seed after an enlarged upload or References step;
    a run of empty steps passes on the imprint), `zoomCapture.test.ts`
    (`runSource`, `runShowAs`, no run from an area), `stepCaptureActions.test.ts`
    (the first link's turn by way, after an empty step, and for a run
    start), `useStepLink.test.tsx` (the offer), `diagramDocument.test.ts`
    (`nearestEarlierShowAs`; `setStepPicture` on an empty enlarged step, a
    mark carried to the whole picture), `cardMarks.test.ts`,
    `referencesPulledSteps.test.ts`, `referencesCardMarks.pages.test.ts`
    (whole cards).
  - Each new test failed before its change: 11 before the implementation,
    8 more before the review fixes.
- [x] i18n if any string changes, all 9 catalogs
  - No string changed; `i18n:check` passes.
- [x] `docs/analytics.md` (`seeded` scope); Z2 amended in `diagram-revision-2.md`
  - `diagram step enlarged`: from 2026-10-08 uploads and cards count
    nothing, and `seeded` counts only an empty step's first link that keeps
    the frame. A dropped seed has no event, and leaves `awaitingPicture`'s
    entry, so a link of the run's type after Undo still counts once.
    `DiagramStepEnlargedVia`'s comment says the same; events and values are
    unchanged.
  - `diagram-revision-2.md`: Z2 amended (with the run-start and upload
    exceptions), decided item 11 superseded, the 2026-10-07 open question
    "A step made after an upload" moot. 17d's frame trim for new cards
    amended in `diagram-references-annotations.md`, D19's picker default in
    `diagram-workspace.md`.
- [x] Review; before/after screenshots (Folded run, then a new step linked)
  - Review: 8 minor findings. Fixed: the type rule had bound run starts and
    linked steps with no picture (finding 1); seeds after an enlarged upload
    or References step (2 and 5, option (a)); dead seeding code (4); stale
    Revision 2 entries (3). Left for Zach (6) or pre-existing (7, 8), below.
  - Gate (rf3 commit): `lint:web`, `tsc --noEmit`, `i18n:check` clean;
    whole vitest suite 888 files / 12035 tests passed (2 files, 15 tests
    skipped).
  - Evidence: `artifacts/review-fixes/3/rf3-evidence.png`, from
    `final/verify.mjs` (facts in `final/<before|after>-<light|dark>.json`)
    and `final/composite.py`; "before" ran with HEAD ec2461f3c's nine
    sources put back, restored byte-identical. On the crane, light and dark,
    Insert Step After step 24 (the Folded run is steps 23–25):
    - Before: the picker offers Crease Pattern; linked, step 25 is a
      crease-pattern corner at 158°, enlarged (Zach's report). An upload
      after step 25 is enlarged, and References Card 2 after it is enlarged
      with 1 of its 6 marks.
    - After: the picker offers Folded; linked, step 25 is the folded head at
      158°, enlarged like step 24. Undone and linked as a Crease Pattern, it
      is whole at 0°. The upload is whole, and Card 2 is whole with all 6
      marks.
    - No console errors. Earlier runs: `verify.mjs`
      (`rf3-evidence-implementer.png`, steps 25–26), `review-fix/` (a run
      start relinked; Insert Step After an enlarged upload), `review/` (the
      reviewer's walk).
  - Open calls, decided 2026-10-08:
    - Remove Picture then Upload, or Link as another type, on an enlarged
      step that continues a run drops its frame and carries its marks to the
      whole picture, where they mark nothing; Replace Picture keeps it
      enlarged. Keeping the frame there needs the seed marked when it is
      made (a transient flag the file need not keep) and `startsWhole`
      applied only to it. *Decided: dropping the frame there is accepted for
      now.*
    - Confirm that a new empty step after an enlarged upload or References
      step starts whole, which makes the 2026-10-07 question moot.
      *Decided: such a step is not seeded.*
  - Seen in review, pre-existing: Show as Simulated on an enlarged step
    keeps it enlarged, but the window shows no paper (the frame keeps the
    Crease Pattern landing's picture-unit place, off the simulated sheet).
    *Item 5 (b).* Separately, on the crane, step 25 (Pattern 24) frames
    only a small wedge, and a step continuing its run copies that
    faithfully. Not Simulated, and no 5 (b) option touches it: *item 5's
    open items* (a Folded step whose anchor face the fold moves).

### 4. "Area out of date" notices

- [x] `DiagramStepZoom` records the area's state at capture; file read/write; old files never flagged
  - `DiagramStepZoom.areaWas?: DiagramZoomAreaWas` (`{ stepId, outline,
    anchor?, scale?, edge? }`): the area's step, its outline in that step's
    picture units, a picked anchor on the paper, and the Size and Edge the
    capture copied. `areaWasOf` (`zoomCapture.ts`) makes it and `capture()`
    writes it, so the switch, a seed, Update and Update All all record. A
    step captured through an enlarged step takes that step's record (none if
    it has none).
  - File: `areaWas` in `zoom`, written only when set. A damaged record (no
    step, an outline, anchor, Size or Edge that does not read) is dropped on
    its own, never the frame. A field with no name here, an outline or Size
    past reach, or an unknown Edge word makes the step a newer build's, as
    the zoom's own fields do. `zoom` is on no release, so only unreleased
    branches lock such a step.
  - **Deviation, for Zach: an older file is recorded at the first hand edit
    of its area, not "never flagged".** Enlarged steps never shipped, so
    every diagram with them, the crane included, has no records, and the
    decided rule made the feature do nothing on all of them.
    `recordAreaBeforeEdit` (`areaRecord.ts`), at the end of
    `editStepAnnotations`, gives each step from an edited area that has no
    record the area as it was just before the edit, in the same undo step,
    so that edit flags it. Nothing is recorded when a file opens or by a
    carry. Not chosen: recording at open, which changes the document on load
    and calls a file current whose area was moved before it was saved.
- [x] Status function: current, changed, deleted, unknown; a carry by the area step's own picture does not flag
  - `areaStatus(document, stepId)` (`zoom/areaStatus.ts`): `current`,
    `changed`, `deleted` (naming the area's step while it is there) or
    `unknown` (no record, or one naming a newer build's step). Derived, so
    Undo gives it back.
  - `areaChangedFor(zoom, now)` (`zoom/areaRecord.ts`) is "changed": the
    place differs (centre, radius or size, a rectangle's turn, the picked
    anchor; to 1e-9 relative), or the step takes its Size or Edge from the
    area and that changed. A step takes it when its own equals what it
    recorded; one that differs was set on the step. An Edge is compared by
    how it draws, so Cut said on a circle equals the area leaving it unsaid
    (the crane's steps).
  - **Deviation, for Zach: Size and Edge are recorded and compared.** The
    decided record was outline and anchor. A capture copies the area's Size
    and Edge, so without them a Size or Edge changed on the area said
    nothing and Update All refused it, while one step's Update pushed it
    over a Size set on the step.
  - The carry: `followAreaRecords(before, after, stepId)` moves the outline
    and anchor of every record that matched an area before an edit of that
    area's step's own picture. `updatePicture` in `diagramDocument.ts` runs
    it for `setLinkedPicture` (capture, Refresh, relink, linked re-pose),
    `setUploadPose`, `setReferencesSide` and `setReferencesWay`, every path
    through `withCarriedAnnotations`. A record that no longer matched (the
    area moved by hand first) stays out of date. Refresh leaves an area
    where it was (D8), so nothing moves.
  - `outOfDate(document, stepId)` is the one question for Update and Update
    All: changed, or a frame copied in picture units that a capture now
    anchors (`updateAnchors`: its step and the area's have faces). A step
    with no record, one needing a Refresh first, and a frame moved or sized
    by hand on its own step are not out of date. `stepsToUpdate` lists them.
    The card's chip is the narrower "the area changed" (`enlargedChips`).
- [x] Step pane notice with Update; card chip; catalog verb; `updateEnlargedDiagramStep`
  - `EnlargedAreaUpdate` (`DiagramStepZoomStatus.tsx`), under From in both
    the read-only and Annotate Enlarged sections: a warning Notice "Out of
    date: Step N's area changed", and Update as an ActionList row
    (RefreshCw), shown only while the step is out of date or its Update
    runs, as Refresh Picture is.
  - Catalog verb `update-enlarged` ("Update"), after Refresh Picture and
    Open in Edit, so the card's menu has it. Gate `enlargedArea: { number,
    outOfDate, updating }`: held "Up to date with step N's area" while the
    step is not out of date, and while locked or capturing; enabled, its
    tooltip is "Place the frame again from step N's area as it is now";
    `waiting` ("Its picture is being captured") while it folds faces,
    refusing a second press.
  - Card: "Area changed" in the well's chip, after the picture's Out of date
    and Pattern missing, before Lighting or Style changed; only on a step
    with a picture (`enlargedChips` gives `{ from, changed }`).
  - Store: `updateEnlargedDiagramStep(stepId)` and
    `updateEnlargedDiagramSteps(areaIds)`, both `updateInStore` with an
    `EnlargedUpdate`. They place only steps out of date, faces folded first,
    as one undo step ("Update enlarged step" / "Update enlarged steps"), and
    none when nothing is out of date. In flight they are keyed by step and
    area, so an Update and an Update All of one area refuse each other.
    `updateEnlargedSteps(..., only)` keeps a Size or Edge set on the step
    (`withOwnPrint`).
- [x] Update all replaces Update Enlarged Steps; notices reworded
  - `buildUpdateAllAction` ("Update All", `update-all`) is shared by Layers'
    area row and the area step's sections, and the area step's card menu
    has it too (`update-all-enlarged`). Held "Every step enlarged from this
    area is up to date" when none is out of date.
  - Reworded: `enlargedNoPaper`, `enlargedUnanchoredUpdate` and
    `enlargedRefreshUpdate` ("…Update from step N's area…"). Layers' frame
    note is only "Turning Enlarged off and on places this frame again."
    (`frameNote` removed), and its frame row says the Step pane's "Out of
    date: Step N's area changed" or "Step N's area was deleted"
    (`frameSubtitle(t, areaStatus)`). `updateEnlargedSteps`, `updateOne` and
    `updateRange` are gone.
- [x] The area's step: Update all in Annotate's Enlarged section (`DiagramStepEnlarged`), and the held switch's words for a step that holds the area (Zach to choose)
  - `HeldAreas` (`DiagramStepZoomStatus.tsx`): "Enlarged on steps 23–25"
    (`areaSubtitle`); while a step is out of date, "Out of date: step 25" or
    "Out of date: steps 23–25 and 27" (`outOfDateLine`: runs as ranges,
    listed by `Intl.ListFormat`) and Update All. Annotate's section always
    shows the first line; the read-only pane shows the section only while a
    step is out of date.
  - My pick, for Zach to confirm: the held switch's tooltip on a step that
    holds an area is "This step holds the enlarge area: turn Enlarged on in
    a later step to enlarge it" (`enlargeHoldsArea`).
- [x] The Enlarged switch on the section's heading (item 2's open call; my recommendation, not objected to)
  - `CollapsibleSection`'s `action`: a `Toggle` named "Enlarged" in a
    `.switch` span carrying the tooltip (a disabled switch shows none) and
    `data-enlarged-switch`. Like every section action it shows only while
    the section is open. The body (`data-step-enlarged`) is empty until the
    step is enlarged or holds an area. Module CSS only: `.switch`, and
    `.area`, `.notice`, `.areas` in `DiagramStepZoomStatus.module.css`.
- [x] Deleted area: "Step N's area was deleted", no Update
  - From says it (`enlargedFromDeleted`) and is no link; no Update; Layers'
    frame row says the same. No card chip, since only turning Enlarged off
    changes anything; the header chip reads "Enlarged" as for any area
    gone. With the area's step gone too: "An area no longer in the diagram".
- [x] Tests near each change, and a file round-trip
  - `areaStatus.test.ts` (16: the record; current and changed by move,
    resize, shape and anchor; deleted; Size and Edge taken or set on the
    step, Edge by how it draws, kept by Update; older files recorded at the
    first hand edit; one predicate; the carry by a linked re-pose and an
    upload's pose, Refresh, a hand move or Size before a re-pose; Update and
    Update All). `diagramZoom.test.ts` (store: Update's gate and undo step,
    `update_step`; Update All only out-of-date steps; overlapping requests;
    Layers' Size and Edge then Update All; a Size set on the step survives;
    an older file's move and its Undo). `diagramFile.test.ts` (round-trip,
    unsaid, damaged, newer, Size and Edge). `zoomActions.test.ts`,
    `diagramActions.test.ts`, `diagramContextMenu.test.ts`,
    `zoomFrames.test.ts`, `DiagramStepZoom.test.tsx`,
    `DiagramStepsGrid.test.tsx`, `DiagramZoomControls.test.tsx`.
  - Failing before: the two carry tests with the follow taken out; the
    review fixes' store and file tests with each change reverted. The
    component and catalog tests cover rows and verbs HEAD does not have.
- [x] i18n in all 9 catalogs
  - 13 new keys, 3 reworded, 4 removed (`updateEnlargedSteps`, `updateOne`,
    `updateRange`, `frameNote`). `i18n:extract`, the 8 locales by
    `artifacts/review-fixes/4/translate.py` and `review-fix/translate.py`
    (which keep fr's no-break spaces unescaped), `i18n:stamp`;
    `i18n:check` passes.
- [x] Analytics: `via: 'update_step'`, documented
  - `DiagramStepEnlargedVia` gains `update_step` (one per Update); Update
    All stays `update`, one per step placed. `docs/analytics.md` says what
    counts as out of date and where both verbs are. Z7 amended in
    `diagram-revision-2.md`.
- [x] Review; before/after screenshots (move an area, then Update and Update all)
  - Review (two reviewers): 3 majors, 12 minors. Fixed: Size and Edge
    (both majors' halves), older files never flagged, two `wantsUpdate`
    predicates, Update enabled on a current step and its bare label (a
    tooltip now), Update and Update All at once, Update showing no wait,
    Layers' frame row wording, no Update All on the area's step in the
    grid, no line saying which steps, a chip on an empty card. Declined: a
    re-pose that leaves the area behind (the crane's D8 marks, a known gap
    below); Update leaving the step's marks in the window's units (old,
    a later item).
  - Gate (rf4 commit): `lint:web`, `tsc --noEmit`, `i18n:check` clean; the
    whole vitest suite 889 files / 12089 tests passed (2 files, 15 tests
    skipped). One earlier run under memory pressure failed a CP fold test
    in `store.test.ts` (a `frameModelBounds` call); it passed alone three
    times and in the clean run.
  - Evidence: `artifacts/review-fixes/4/rf4-evidence.png` from
    `final/final.mjs` (facts in `final/<light|dark>.json`) and
    `final/composite.py`. "Before" is `before.mjs` on HEAD 03a57d182's
    sources, put back and restored byte-identical. On the crane, light and
    dark, step 22's area moved by hand:
    - Before: no chip, no notice, no Update; Annotate's section has a row
      "Enlarged" under the heading "Enlarged"; Layers offers Update Enlarged
      Steps.
    - After: the move is one undo step and records steps 23–25 (no records
      in the file). Cards 23–25 say "Area changed"; step 23 says "Out of
      date: Step 22's area changed" with Update, read-only and in Annotate,
      where the switch is on the heading; step 22 says "Out of date: steps
      23–25" with Update All; Layers' frame row says the same as step 23.
      Update clicked in step 23's pane: one undo step, 23 current. Card 24's
      menu: Update enabled with its tooltip. Step 22 then says "steps
      24–25"; Update All clicked there: one undo step, all current, card
      24's Update held "Up to date with step 22's area". Step 22 re-posed
      (Rotate Right, its marks kept in step first): the area turned with
      the picture, nothing flagged. The area deleted: "Step 22's area was
      deleted", no Update. No console errors.
    - Refresh Picture is held on the crane's step 22 (its picture is
      current), so the Refresh carry is shown by `areaStatus.test.ts` only.
    - Earlier walks: `verify.mjs`, `touch.mjs` (phone and iPad drawers,
      before the review fixes; `rf4-evidence-implementer.png`),
      `review-fix/verify.mjs` (Size and Edge, overlapping requests, an
      empty step after a stale run), `review/`, `review-adv/`.
  - For Zach to confirm: Size and Edge in the record and kept by Update;
    an older file recorded at the first hand edit of its area; Update held
    on an up-to-date step (a frame moved by hand on its own step is then
    reset only by turning Enlarged off and on); the held switch's tooltip
    and the line "Enlarged on steps 23–25"; the menu label "Update" (a
    reviewer suggested "Update from Area").
  - Known gaps: on the crane as opened, step 22's marks are out of step
    with its picture, so a re-pose leaves the area behind (D8) and the
    enlarged steps still read current though the area frames other paper.
    A new step captured from an out-of-date step inherits its record and is
    out of date at once. Update moves the frame but leaves the step's own
    marks where they were in the window. Step pane action rows are 28 px
    tall, under the 44 px touch target in the phone drawers (pre-existing).

### 5. Enlarged turned off, and Show as Simulated

- [x] (a) Every `withZoom` carry moves every readable mark, in step with the picture or not
  - Marks are carried by `carryMarks(..., { unitsOnly })` in
    `zoomFrames.ts`, which `carryBetween`, `withZoom`'s one carry, sets.
    The author's marks go whenever this build can read them all, whatever
    `annotatedPictureKey` says, and the step stays in or out of step as it
    was.
  - On the step's own picture that is a change of units: Enlarged off and
    on, a hand move, resize or reshape, Update and Update All, and
    `anchorInPlace`. Each mark stays where it shows, so Enlarged turned off
    puts the crane's out-of-step marks on the head, not over the model.
  - `startsWhole` is a change of picture: a step that had no picture takes
    one and drops its frame. Its marks are carried to the new whole picture
    and stay out of step with it, which is item 3's accepted rule ("carries
    its marks to the whole picture, where they mark nothing"). Before rf5,
    only marks already in step with the new picture went.
  - Unchanged: a mark this build cannot read, or one that cannot come back
    within reach, keeps every mark where it was, out of step. A re-pose
    (`reposeFrame`), Refresh and relink (`withCarriedAnnotations`) change
    the picture and carry as before (D8). Lines trimmed at the frame stay
    trimmed. Off is "Show whole step" and on is "Enlarge step", one undo
    step each.
  - Documented in `carryMarks`', `carryBetween`'s and `startsWhole`'s
    comments, the module's table and revision-2's "Enlarged turned off"
    row.
- [x] (a) Tests that fail before the change, all three failing on HEAD af01028ae's `zoomFrames.ts`
  - `zoomFrames.test.ts`, an enlarged crane step whose marks are out of
    step: turned off, every mark stays where it showed, still out of step;
    on again, the marks go back into the window, where they were; moved by
    hand, then placed again by Update, they stay on the same paper (rf4's
    known gap).
  - `diagramZoom.test.ts` (store): off and on are one undo step each, the
    marks stay on the paper and out of step, and two Undos give the step
    back. On HEAD the store's invariant watcher (`marksProblems`) also
    reported "step-2: marks moved on the paper (mark)".
  - `diagramDocument.test.ts`: Remove Picture, then Upload, on an enlarged
    linked step. The frame goes and the marks are carried to the upload's
    whole picture, out of step with it. On HEAD they kept the window's
    numbers. The rf3 test beside it gives the same upload back, so its
    marks are in step and it passes either way.
- [x] (a) Gate on the committed tree (the worktree held only this phase's changes)
  - `npm run lint:web`, `tsc --noEmit` and `i18n:check` clean;
    `git diff --check` clean.
  - The whole vitest suite (Node 22): 889 files and 12092 tests passed;
    2 files and 15 tests skipped.
- [x] (a) Browser: the crane's steps 23 and 24, light and dark (`artifacts/review-fixes/5/`)
  - `verify-a.mjs` clicks the Enlarged switch on Annotate's section heading
    off, then on, on each step, then Undo three times.
  - Before (HEAD af01028ae's `zoomFrames.ts`, put back and restored
    byte-identical): turned off, the marks moved 0.63 picture units, from
    the head to the middle of the model.
  - After: turned off, they moved 0 on the picture and sit on the head,
    still out of step; turned on, under 1e-16. Undo gives each step back as
    it opened. No console errors.
  - The verifier re-ran it on the committed code (`verify-<light|dark>*`):
    the same numbers, and cards pixel-identical to the implementer's
    `after-*` captures.
  - Evidence: `rf5-evidence.png` from `composite-rf5.py`: (a) as opened,
    off before and off after, light and dark; (b)'s current behaviour from
    the reviewer's walk. Facts are in `<before|verify>-<light|dark>.json`.
- [ ] (b) Show as Simulated lands the frame on the simulated picture's paper: **not built, needs Zach's choice; open in the PR notes**
  - The planned mechanism, landing through the imprint, needs a simulated
    picture to have faces on the paper. Z8 kept those from it, so the
    imprint has nothing to land on. The Approach has the facts and options
    1–3. Recommended, if Show as Simulated stays enlarged: option 1, its
    faces made in the worker (1a).
  - Until then the window shows other paper, and the same step lands on
    different paper by its path: Folded → Simulated → Crease Pattern puts
    step 23's frame at the sheet's bottom-left, while Folded → Crease
    Pattern puts it on the head. Options 1 and 3 fix that; option 2
    removes it.
  - Probes: `probe-showas.mjs` (`probe-showas-<23|24>-strip.png`) and the
    reviewer's walk by real Show as clicks, `review/walk-b.mjs`
    (`review/b-<light-24|dark-23>-strip.png` and `.json`).
  - Option 1b's first question, exactness, is answered on the crane:
    `option-1b/probe-1b.mjs` runs the worker's pure steps on the main
    thread over the fold and camera it sent, and every painted corner of
    the stored scene (328) lies on the projected mesh within 0.006 px
    (`option-1b/step-<23|24>.json`). Not checked: the fold's paper
    coordinates (its sheet is at z −5700 to −5300), a dense model's
    main-thread cost, and the placement at a tilt.
- [x] Item 3's two open calls recorded as decided (2026-10-08)
  - Dropping the frame of a mid-run enlarged step on Remove Picture, then
    Upload or Link as another type, is accepted for now.
  - An empty step after an enlarged upload or References step is not
    seeded. The 2026-10-07 question in `diagram-revision-2.md` says so.
- [x] i18n and analytics: no string, event or property changed.
- [x] Review: 9 findings (3 major, 6 minor)
  - The three majors are (b) unbuilt and the path-dependent landing it
    leaves. Their fix is Zach's choice, so (b) stays open above, with the
    review's main-thread option added as 1b.
  - Fixed: the plan overstated what a simulated picture lacks; option 2
    misread item 3 (now a plain trade-off: it reverses the decided Show as
    rule for Simulated only, while Crease Pattern stays enlarged);
    `startsWhole` was called a change of units and had no test of its real
    case; the step 25 note was filed under (b).
  - Noted, out of scope: the card header's truncation (below).
- Open items found in rf5's review, pre-existing, not part of (b), for Zach:
  - **Step 25 frames a sliver.** The crane's step 25 (Folded, 158°,
    enlarged from step 22's area) shows only a sliver of the head at the
    bottom of its window, so its card looks almost blank in Steps and on
    page 3 (`review/crop-s25-selected.png`, `review/s25-annotate.png`,
    `review/e-light-pages-23-24-off.png`). Turned off and on again it
    captures the same frame, (0.6761, 0.1218) r 0.2165
    (`review/s25b.mjs`), and whole it shows the head pointing right at the
    bottom of where the frame sits (`review/s25-off.png`). So it is the
    landing, not stale file data: most likely a Folded step whose anchor
    face (Z9) is moved by the fold being diagrammed, here an inside
    reverse fold, lands its frame off that paper. Not Simulated, and no
    5 (b) option touches it.
  - **The card header cuts "Enlarged · 22".** With the type badge
    SIMULATED · 0% or CREASE PATTERN, the header reads "Enlar…" or
    "Enla…", light and dark (`review/crop-b-light-24-1-simulated-card.png`,
    `review/b-light-24-strip.png`, `review/b-dark-23-strip.png`). Item 3
    keeps steps enlarged across Show as, so the provenance number is lost
    on every such step. A fix for the card header, for example letting the
    badge shrink first, or keeping the icon and step number without the
    word.

### 6. A halo along the sheet's edge, and two phone fixes

- [x] (a) A halo across a References sheet's edge is the face on the sheet and the page's white off it
  - One stroke painted by a pattern of the sheet, for labels whose reach
    crosses the edge. Labels wholly on or off it, and every label on a
    white face or another picture, keep their one colour and their markup.
    The Approach says why it is not two clipped copies.
- [x] (a) Tests; the new ones fail on HEAD 69fda4d0f's sources
  - `textOptions.test.tsx`: the one stroke and its pattern (tile, white,
    the sheet in the face from the tile's corner); one colour wholly on,
    wholly off and on a white face; either winding, and an enlarged step's
    sheet in window units; ids by what they paint, and scoped.
  - `textHaloSurfaces.test.ts`: across the edge on the page, the step file
    and the card, its pattern in the same document (renamed per cell);
    enlarged too.
  - `DiagramAnnotationLayer.test.tsx`: two layers of one drawing in one
    document, each with its own pattern.
  - `referencesCardMarks.equivalence.test.ts`: amended. A pulled letter
    across the edge takes the face or white where its baked letter took
    one, and the fixtures meet that case.
- [x] (a) Browser (`artifacts/review-fixes/6/`)
  - On HEAD's sources and on these, crane step 2 (grey back): its letters
    made editable, and EDGE and TOP across the edge, IN on it and OUT off
    it. Shown on the Annotate canvas (light and dark), the card, the
    composed page and the PDF (`verify-a.mjs`).
  - After: grey on the sheet, white off it, the sheet's edge line knocked
    out; IN as before. OUT is clear of the edge on the canvas and the card,
    and crosses it on the page, where the picture prints smaller. No
    console errors.
  - The PDF was drawn by poppler (`pdf-a.py`, its hairline above) and by
    CoreGraphics through QuickLook (clean). The page was drawn by WebKit
    (`webkit-page.mjs`, clean). `pdftotext` reads each word once.
- [x] (b) Sheets portal into a sheet layer `App` renders before its modals; every sheet's Escape stands down under a dialog (`useSheetEscape`)
- [x] (b) Tests
  - `WorkspaceViewDrawer.test.tsx`: the sheet in the layer, a dialog after
    it on top, and its Escape the dialog's. Fails on HEAD's drawer and
    hook.
  - `SheetLayer.test.tsx`, for the new module: the layer takes sheets and
    lets go on unmount, and `App` lays it out before every modal.
  - `CpToolsTrigger.test.tsx`, `SimulatorToolsTrigger.test.tsx`,
    `DesignPaneSwitcher.test.tsx` (review): each sheet opens in a registered
    layer, a dialog after it keeps its Escape, and a second Escape closes
    the sheet. They fail with a sheet portaled to `<body>`, and with the
    sheets' own listeners from before the review. The pane list also
    stands down for an open layer's Escape.
- [x] (b) Browser: WebKit, phone light and dark, iPad light (`verify-b.mjs`)
  - Before (`probe-b.mjs before`): the browser and Delete Step's question
    were under the sheet, and one Escape closed both.
  - After: Replace from References… opens the browser on top. Its Cancel,
    tapped, closes it and leaves the sheet. Escape closes it alone, and a
    second Escape closes the sheet.
  - Delete Step's question is on top, and Cancel leaves the step.
  - Edit's tool sheet (`verify-b.mjs`) and Simulate's
    (`verify-b-sheets.mjs`) open in the layer, on top; Simulate's closes on
    Escape.
  - Review (`escape-sheets.mjs`, WebKit iPhone and Chromium at 375 px):
    Edit's and Simulate's tool sheets, Design's pane list (a new TreeMaker
    design, four panes) and the Diagram's Settings sheet, each with
    Settings opened over it by ⌘,. One Escape closes Settings alone, a
    second the sheet. Before (`escape-webkit-before/`, the old listeners put
    back), one Escape closed both for every sheet but the Settings sheet.
- [x] (c) Not built here: the card header does not wrap on a phone; the three rows are the open step's header (Approach, with a recommendation and `mock-c.png`). Built in 7(a)
- [x] i18n and analytics: no string, event or property changed; `i18n:check` passes
- [x] Review findings addressed: one Escape listener for every sheet; a
  layer test per sheet; the 17d count no longer depends on test order;
  `ToolPickerSheet`'s comment; baked letters and the (c) recommendation
  written up for Zach
- [x] Gate on the committed tree (the worktree held only this phase's changes)
  - `npm run lint:web`, `tsc --noEmit`, `i18n:check` and `git diff --check`
    clean.
  - The whole vitest suite (Node 22): 893 files and 12106 tests passed;
    2 files and 15 tests skipped. The first full run failed one test
    outside rf6, `store.test.ts`'s "offers the vertex the refusal named"
    (a CP fold refusal's framing call); it passed alone and in the re-run.
  - The verifier put HEAD 69fda4d0f's sources back (restored
    byte-identical): all 14 new tests, in 9 files, fail there.
- [x] The commits, each its own: (a) `9d5ae76e2`, (b) `aedad268f`; (c) has none
- [x] Verify (`verify-rf6.mjs`, 375 px: Chromium light and dark, WebKit iPhone X light and dark; HEAD's sources and these)
  - (b) Before, in all four: the Settings sheet was drawn over the
    References browser, and one Escape closed both. After: the browser is
    on top, one Escape closes it alone, a second the sheet.
  - (a) Step 2's card in the Steps grid on a phone: EDGE and TOP are
    painted by their patterns, IN grey, OUT white. Before, EDGE and TOP
    were grey.
  - (c) Steps 22–25's card headers are one 33 px row in all four runs;
    step 24 open has three rows of controls.
  - No page or console errors.
- Evidence: `artifacts/review-fixes/6/rf6-evidence.png`, from
  `composite-rf6-verify.py`: (a) on the canvas (Chromium light and dark),
  the page, the PDF (pdftoppm and CoreGraphics) and the phone card; (b)
  in all four runs, and Escape over Edit's tool sheet; (c) as found, with
  `mock-c.png`. The implementer's composite is `rf6-evidence-implementer.png`.
- As built, in short:
  - (a) A halo across a References sheet's edge is one stroke painted by a
    pattern of the sheet: the face on it, white off it. Every other halo
    keeps its colour and markup. References' own (unpulled) letters are
    unchanged, so pulling a letter across the edge now changes it; making
    them follow the edge too is Zach's call.
  - (b) `SheetLayer` comes before `App`'s modals and holds all four touch
    sheets; their Escape is one hook, `useSheetEscape`. No z-index changed.
  - (c) Not built: the card header already holds one row. The open step's
    header is three rows, and the recommendation for Zach is to leave out
    Pose | Annotate on a phone (two rows at 375 and 320 px).

### 7. Item 6's two open recommendations

- [x] (a) No Pose | Annotate on a phone; the note offers Pose
- [x] (a) Test (`DiagramStepDetail.test.tsx`): the switch on a larger
  screen in Pose and Annotate; none on a phone; the note's Pose button
  returns to Pose. Fails on HEAD 6df930d17's component.
- [x] (a) Browser (`artifacts/review-fixes/7/header.mjs`, crane's step 24)
  - WebKit, iPhone X (375 px) and iPhone SE (320 px): three rows before,
    two after; Annotate's note has its Pose button, which returns to Pose.
  - WebKit iPad (1024 px) and Chromium (1280 px): every header control's box
    and computed style, and the header's pixels, identical before and after
    (`compare-header.py`, `header-compare.json`).
  - No page or console errors. Evidence: `rf7-header-evidence.png`.
- [x] (b) A References letter across the sheet's edge, in a file, is haloed by
  a pattern of the sheet, through `sheetHalo`, which Text's halo now calls too
- [x] (b) Tests; the new ones fail on HEAD 66af96242's `DiagramPrimitives`
  - `diagramToPaperScene.test.ts`: on the front and the back, a letter
    wholly on takes the face, wholly off the ground, across the edge a
    pattern in the same markup (the ground under the sheet in its face, the
    sheet's corners from the tile's corner, the tile past the letter), each
    letter set once. A white face is one colour; on screen, classes as
    before.
  - `referencesCardMarks.equivalence.test.ts`: amended as the Approach says,
    and the fixtures meet letters across the edge baked and pulled.
- [x] (b) Byte for byte: 144 baked scenes against HEAD, only the 15 letters
  across the edge changed (`baked/compare-baked.py`); References' goldens
  pass unchanged
- [x] (b) Browser (`verify-edge.mjs`, `pdf-edge.py`; `crane-edge.osf` from
  `edge-fixture.mjs`: crane with a point R on step 2's grey back, its letter
  across the edge)
  - Before: the card's R a grey halo spilling onto the page; the page's and
    the PDF's a white one cutting into the sheet. After: grey on the sheet,
    white off it, the edge line knocked out, on the canvas, the card, the
    page (Chromium), and the PDF (poppler, CoreGraphics).
  - `pdftotext` reads P, Q and R as often after as before (twice each, steps
    0 and 2).
  - poppler draws the faint hairline round the pattern's part that 6(a)
    noted; CoreGraphics none.
  - No page or console errors. Evidence: `rf7-edge-evidence.png`.
- [x] i18n and analytics: no string, event or property changed
- [x] The commits, each its own: (a) `66af96242`, (b) `37a872f09`

### Finish

- [x] Full gate, on the committed tree at `37a872f09` (Node 22), PR-wide
  - `npm run lint:web` from the root, and `tsc --noEmit` and `i18n:check` in
    `apps/web`: clean.
  - The whole vitest suite: 893 files and 12109 tests passed; 2 files and 15
    tests skipped.
  - `npm run build:web` from the root: built, and the landing prerendered.
  - `git diff --check`: clean.
