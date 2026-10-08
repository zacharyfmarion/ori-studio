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
  absent. A file without it is never flagged.
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
    "Enlarged on steps 23–25" (`areaSubtitle`). Ask Zach which before
    building it.
- **Deleted.** If the area is deleted, the enlarged steps keep their frames
  and say "Step N's area was deleted", with no Update. If the area's step is
  gone too, today's "An area no longer in the diagram" stays.
- **Analytics.** Update on one step is a new action. `diagram step enlarged`
  gains `via: 'update_step'` beside `update`, documented in
  `docs/analytics.md`. Update all stays `update`.

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

- [ ] The picker's default for an unlinked step: the previous linked step's picture type
- [ ] A first picture of another type than the run drops the seeded zoom, in the capture's undo step
- [ ] Uploads and References cards start unenlarged; `withCardMarksInFrame` callers settled
- [ ] Show as on an already-enlarged step unchanged; the toggle turns it off in one click
- [ ] Tests near each change
- [ ] i18n if any string changes, all 9 catalogs
- [ ] `docs/analytics.md` (`seeded` scope); Z2 amended in `diagram-revision-2.md`
- [ ] Review; before/after screenshots (Folded run, then a new step linked)

### 4. "Area out of date" notices

- [ ] `DiagramStepZoom` records the area's state at capture; file read/write; old files never flagged
- [ ] Status function: current, changed, deleted, unknown; a carry by the area step's own picture does not flag
- [ ] Step pane notice with Update; card chip; catalog verb; `updateEnlargedDiagramStep`
- [ ] Update all replaces Update Enlarged Steps; notices reworded
- [ ] The area's step: Update all in Annotate's Enlarged section (`DiagramStepEnlarged`), and the held switch's words for a step that holds the area (Zach to choose)
- [ ] Deleted area: "Step N's area was deleted", no Update
- [ ] Tests near each change, and a file round-trip
- [ ] i18n in all 9 catalogs
- [ ] Analytics: `via: 'update_step'`, documented
- [ ] Review; before/after screenshots (move an area, then Update and Update all)

### Finish

- [ ] Full gate: `npm run lint:web`, `npm run typecheck:web`, `npm run i18n:check`, the whole vitest suite
