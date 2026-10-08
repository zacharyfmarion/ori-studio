# Diagram: review fixes from #436

## Goal

Zach's review of #436 (2026-10-08), verbatim:

> 1. can you default the path width to 20. 2. It feels wierd that enlarged settings only appear in pose tab, even though you interact with the enlarged region in the annotate tab. can we move it to the annotate tab? 3. If the previous step was enlarged from a folded figure, the next step defaults to a CP when linked but it defaults enlarged, which doesn't make sense because it just zooms in on a portion of the CP. whats the right UX here? I almost think that it might be having the type of the next step (cp / simulated / folded figure) default to whatever the step before it is? not sure 4. When i change the area that subsequent steps are enlarged from, it feels like there should be some message saying that the area on these steps is out of date and a way to update (kind of similar to the way it works for picutures

He approved the design below for all four items ("sounds good"). This is a
small PR stacked on #436 (branch `claude/diagram-review-fixes`). Each item is
its own commit, or its own small run of commits.

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
      enlarged picture (already so; may belong with item 4).
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
  - Open calls for Zach:
    - Remove Picture then Upload, or Link as another type, on an enlarged
      step that continues a run drops its frame and carries its marks to the
      whole picture, where they mark nothing; Replace Picture keeps it
      enlarged. Keeping the frame there needs the seed marked when it is
      made (a transient flag the file need not keep) and `startsWhole`
      applied only to it.
    - Confirm that a new empty step after an enlarged upload or References
      step starts whole, which makes the 2026-10-07 question moot.
  - Seen in review, pre-existing: Show as Simulated on an enlarged step
    keeps it enlarged, but the window shows no paper (the frame keeps the
    Crease Pattern landing's picture-unit place, off the simulated sheet).
    On the crane, step 25 (Pattern 24) frames only a small wedge, and a step
    continuing its run copies that faithfully; it may belong with item 4's
    Update.

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

### Finish

- [ ] Full gate: `npm run lint:web`, `npm run typecheck:web`, `npm run i18n:check`, the whole vitest suite
