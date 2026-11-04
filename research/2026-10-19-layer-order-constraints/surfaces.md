# Layer-order constraints: our UI surfaces and data model

Research slice: where a user meets layer order today, and what a shared
"constrain the layer order" modal would plug into. One of four parallel
research reports; this one covers `apps/web` only (kernel internals are
another slice's, and are cited here only where the UI depends on them).

- Read on 2026-10-19 at `fe8bd4e7a` (main, this worktree). The unmerged Fold
  workspace is read at `claude/fold-workspace` (`aa736f95d`, 644 commits ahead
  of main).
- Paths are relative to the worktree. Branch paths are written
  `claude/fold-workspace:<path>:<line>`.
- Nothing was run in a browser. Line numbers are from this checkout.

**Evidence labels.** **Verified**: read in the code at the cited lines.
**Measured**: a read-only PostHog query run on 2026-10-19. **Documented**: an
internal plan or research note, not re-checked against code. **Inferred**: my
reading, not checked.

---

## Summary

1. **Edit offers one layer-order verb: "Another solution".** It steps forward
   and, at the end of the enumeration, wraps back to the first. It sits on the
   folded figure's floating toolbar and its context menu. There is no
   previous, no jump to a number, no count, no keyboard shortcut and no
   menu-bar item. Jumping to a number was removed on 2026-08-05; the store
   action behind it survives with no UI caller. **Verified.**
2. **A layer order is persisted only as a picture plus an index**
   (`current_fold_case`), never as relations between faces. A refold resets to
   solution 1. A reopened flat figure has no kernel handle, so it cannot step at
   all until it is refolded. A reopened 3D figure is replayed up to 32 steps
   and kept only if the index and frame match. **Verified.**
3. **The Diagram stores `foldCase` (an index) on a flat step's render.** Pose's
   toolbar and the Step pane show "Layer order n of m+" with Previous and Next.
   A Refresh after the pattern changes replays the same index into the new
   fold. 3D steps are always on solution 1, and changing a step's layer order
   leaves its annotations behind. **Verified.**
4. **Nothing picks a face on Edit's crease-pattern canvas or on its folded
   figures, and no surface on main shows a CP face and its folded face
   together** (hover one, light the other). The data for it exists: the
   kernel's flat paper scene gives each face's folded outline, the CP position
   of every corner (`sheet_points`), and every overlap cell's stack top to
   bottom. The Diagram already stores this per flat step (`paperFaces`) and uses
   it to find faces by a point on the paper. **Verified.**
5. **Oriedita's own constraint tool is catalogued but not ported.** It is "Add
   folding constraint": click a face of the folded figure to require that it
   show its front or back colour, then fold again. The UI lists it as
   `notImplemented` and hidden. The kernel carries the constraint type only as
   a render option for drawing markers, and the search-side setters are called
   only by tests. Changing the starting face is likewise unported: every fold
   in the app uses face 1. **Verified.**
6. **The Fold workspace branch already has most of the pieces a modal
   needs:**
   - choices stored as results, with faces named by points on the sheet and
     pairs stored as FOLD `faceOrders` triples;
   - a two-pane canvas (the folded form and its crease pattern) on a
     store-free `useCpSurface`;
   - pure picking that knows the stack under the pointer;
   - a cross-section layer listbox;
   - an Import dialog that offers per-part order cards with pictures and a
     true "n of m";
   - "Start from Edit's folded figure".

   **Verified on the branch.**
7. **Modal building blocks on main:**
   - `useModalDialog`, which keeps keys, focus and Escape inside the dialog;
   - root-mounted modals in `App.tsx`;
   - `ExportModalFrame`, a preview beside options;
   - `OptionCards`.

   Main has no store-free interactive CP canvas: `useCpSurface` exists only on
   the branch. **Verified.**
8. **Persistence hazards.**
   - An Edit figure lives in the CP document's `viewState.foldedFigures`. Its
     reader builds an explicit literal, so a new field is silently dropped by
     an older build and lost on that build's next save.
   - The Diagram reader treats an unknown field in a render as a newer build's
     work, and locks the step.
   - Reader version 10 is claimed by both main (the diagram list) and the Fold
     branch (fold sequences).

   **Verified.**
9. **Usage over the last 90 days, test accounts excluded** (data starts in the
   week of 2026-08-09). **Measured.**
   - 3,119 fold completions from 193 users; 1,963 of them produced a figure
     (1,815 flat, 148 3D).
   - 1,399 "Another solution" presses by 42 users. Per user: median 5.5,
     90th percentile 58, maximum 720.
   - 13 users went past solution 5, 5 past 20, and 1 past 100. 10 users
     reached the end and wrapped.
   - The Diagram's layer-order pager: 3 presses by 1 user, but the Diagram has
     only been live since the week of 2026-10-11.
10. **Known pain points.**
    - The enumerator is forward-only, so going back costs about one re-fold.
      **Documented.**
    - There is no total count. **Verified.**
    - Swapping buried layers is invisible in an opaque render: one model's 8
      solutions drew 8 identical pictures. **Documented in code.**
    - Indexes drift (point 2).
    - The 3D search reports "no layer order" on figures that have one, and
      whether it does depends on the starting face. **Documented.**

---

## 1. Edit workspace folded figures

### 1.1 Where a user meets layer order today

| Surface | What it shows or does | Evidence |
| --- | --- | --- |
| Folded figure's floating toolbar | "Another solution" icon button. Its label becomes "Back to first solution" when the next press would wrap. It is disabled when the figure is not ready, which needs a handle and `status: 'ready'`, or when there is only one solution. | `apps/web/src/cp-workspace/folded/foldedFigureActions.ts:302-308`, `:622-639`; mounted at `apps/web/src/cp-workspace/canvasObjects/CpFloatingInspectors.tsx:78`; rendered by `CpFoldedFigureToolbar.tsx:144-190` |
| Right-click context menu | The same verbs in the same order, from the same React-free catalog | `foldedFigureActions.ts:22-33`; `useFoldedFigures.ts:1063-1072`; `foldedFigureMenuItems.tsx:162` |
| Properties pane | The subtitle under the figure's title reads "Case N" (the 1-based solution shown). It reads Stale, Folding…, Failed or the 3D verdict instead when one applies. There is no control. | `foldedFigureNotice.ts:215-245`; `foldedFigureProperties.ts:364-373` |
| Keyboard | None. The only "solution" shortcuts are the fold-angle solver's. | `apps/web/src/keyboard/shortcuts.ts:815-825` |
| Menu bar, command palette | None. `FoldAnother` is registered as `porting` / `hidden-ui-only`, and the `handleMenuAction` chokepoint has no fold or solution action. | `apps/web/src/lib/oristudioCpCommands.ts:851-853`; `apps/web/src/commands/menuActions.ts:58`, `:289` |
| Viewport bar | Only Fold. The code says so: "Everything about a figure that exists — its style, its solutions, its export — lives on the figure's own toolbar and context menu." | `apps/web/src/components/panels/CreasePatternPanel.tsx:2908-2912` |
| Crease-pattern export dialog | A "Fold case" number input with "{{count}} found so far". It folds the pattern itself, starts at 1, and is not seeded from any figure on the canvas. | `apps/web/src/components/CreaseExportDialog.tsx:155`, `:221-245`, `:660-680`; `apps/web/src/lib/creaseExport.ts:128-136`; `apps/web/src/lib/creaseExportFold.ts:364-385` |
| Share-link modal | Always case 1 | `apps/web/src/cp-workspace/share/ShareLinkModal.tsx:173-176` |
| 3D verdict chip | "Layers not ordered", with "Simulate instead" | `foldedFigureNotice.ts:200-210` |

**How cycling behaves.** **Verified.**

- **The cycling state.** `foldedFigureCycling` exposes `hasNext`,
  `discovered`, `current` and `wrapsToFirst` (`foldedFigureState.ts:9-55`).
  `discovered` is a "Forward-only high-water mark of solutions reached. Never a
  total" (`:13-14`). Wrapping is offered only once more than one solution is
  known (`:51-53`).
- **Jump to N was removed.** The Edit "Case" field went on 2026-08-05 (commit
  `1920a12ba`, "drop the Case field": "what is lost is jumping to a specific
  number, which the export dialog still offers"). The store action
  `foldOristudioCpFigureToCase` remains
  (`store/workspaceStore/slices/creasePatternSlice.ts:2668`), and a grep finds
  no UI caller.
- **3D has no fold-to-case, by design.** Its `discovered_fold_cases` is a
  high-water mark over an odometer of per-component streams, so "case N names
  nothing stable" (`foldedFigureCapabilities.ts:20-23`, `:109-118`;
  `creasePatternSlice.ts:2670-2682`).
- **A press is one undo entry, "Show another solution"**
  (`useFoldedFigures.ts:951-955`). It is a visible, stoppable fold run
  (`withFoldInFlight('another')`, `creasePatternSlice.ts:2584-2626`), and Stop
  restores the figure unchanged (`:2653`). Both kinds of figure take this
  path: 3D at `:2583-2622`, flat at `:2624-2648`.
- **Pressing often looks like doing nothing.** The comment at
  `foldedFigureCapabilities.ts:84-107` records a measurement on
  `penguin_freeform` (8 solutions). The eight pictures hash identically under
  `Paper5` and `Wire2`, "because swapping two buried layers of a stack changes
  nothing an opaque render shows". Only X-ray (`Transparent3`) shows distinct
  pictures. **Documented in code; measured by its author.**

### 1.2 Flat and 3D, side and flip, starting face

- **Two kinds of figure.** A flat figure carries `snapshot`; a 3D one carries
  `folded3d`. Exactly one is non-null (`engine/oristudioCpTypes.ts:1124-1139`;
  `foldedFigureState.ts:32-36`). **Verified.**
- **Flat Flip and Side.** Flip toggles `model.state` between `Front0` and
  `Back1`. That is a kernel model write, not a refold, so the layer order is
  unchanged and only what sits on top on screen inverts
  (`foldedFigureActions.ts:440-461`, `:576-591`; `foldedFigureState.ts:79-90`).
  The `Both2` and `Transparent3` overlay states are not offered.
  **Verified.**
  - Inferred: a constraint written "A above B" has to say which side it is
    read from. Fold stores FOLD triples relative to a face's front for exactly
    this reason (`claude/fold-workspace:apps/web/src/fold/document/foldSequenceDocument.ts:641-647`).
- **3D "Other side".** It moves the camera to the antipodal view; a 3D
  figure's side is wherever the eye is (`foldedFigureCapabilities.ts:58-67`;
  `foldedFigureActions.ts:446-451`). **Verified.**
- **Starting face (fixed face).** It is not exposed. **Verified.**
  - Every Edit fold passes face 1 (`useFoldedFigures.ts:86`, `:745`). So do
    the Diagram and the export (`lib/creaseExportFold.ts:333`;
    `store/workspaceStore/cpFoldRuntimeBindings.ts:74-75`).
  - It is persisted on the entry as `startingFaceId` and reused by refold and
    rehydrate (`creasePatternSlice.ts:3074`, `:3150`, `:3320`;
    `lib/nativeProjectFile.ts:831`).
  - Oriedita's "Change standard face" (`CHANGE_STANDARD_FACE_103`) is
    `notImplemented` and hidden (`lib/oristudioCpCommands.ts:797-799`,
    `:871-878`).
  - It matters. On the 3D path, whether a layer order is found at all depends
    on it: `failed_layer_ordering.fold` is solved from 2 of 20 starting faces
    (`implementation-plans/fold3d-layer-order-debuggability.md:29-48`).
    **Documented.** Which flat solution comes first "depends on face indexing
    and the starting face"
    (`claude/fold-workspace:research/2026-10-08-fold-workspace/r1-cp-folded-figure.md:120`).
    **Documented; inferred there.**

### 1.3 What is persisted, and what survives

The writer saves the whole entry with `handle: null`, and a figure that was
still loading is saved as `stale` (`lib/nativeProjectFile.ts:783-793`). What a
figure carries:

- **Flat:** `snapshot`, with `current_fold_case`, `discovered_fold_cases`,
  `find_another_overlap_valid`, `model.state` and the wireframe, plus the
  picture as `renderSnapshot`.
- **3D:** `folded3d`, with `current_fold_case` and the diagnostics, plus the
  `scene` picture, the `camera` and `frameRadius`.
- **Both:** `startingFaceId`, and the source region as `sourceBounds`, the
  `cs1:` `sourceFingerprint` and `sourceLineIds`.

No face relations and no constraints are stored
(`engine/oristudioCpTypes.ts:616-644`, `:884-909`, `:1115-1267`). **Verified.**

| Event | Flat figure | 3D figure | Evidence |
| --- | --- | --- | --- |
| Reload (.osf) | The picture draws. With no handle, "Another solution" and Duplicate are disabled. Flat figures are never rehydrated, and Refold is offered only to a stale figure. So a reopened, unchanged flat figure cannot step layer orders until its creases change. | A background rehydrate refolds and replays `current_fold_case − 1` steps, capped at 32. It adopts the result only if the index and the frame match; otherwise the figure stays a static picture. | `foldedFigureActions.ts:302-308`, `:552`, `:636`, `:680`; `folded3dRehydrate.ts:27-40`, `:46-75`, `:91-98`; `creasePatternSlice.ts:3255-3347` |
| Refold after CP edits inside the source box | Folds again with `Order5` and lands on **solution 1**. The old index is not replayed. | Lands on **solution 1**, at the default camera. | `creasePatternSlice.ts:3147-3208`; `:3069-3140` |
| CP edits outside the source box | No effect: staleness is decided by the bounding box plus a content fingerprint (a port of Oriedita) | same | `foldedFigureStaleness.ts:11-48`; `useFoldedFigures.ts:967-971` |
| Duplicate | The kernel clones the session, so the copy shows the same solution and cycles on its own | same | `creasePatternSlice.ts:3440-3443` |
| Undo of "Another solution" | The entry is restored, but the kernel handle was changed in place ("an ordinary edit mutates the existing handle", `foldedFigureHandles.ts:17-19`). Whether the next press continues from the restored solution or from the kernel's: **not verified**, and I found no test for it. | same | `foldedFigureHandles.ts:1-19` |

**Verified** for every row except the undo row's open question. Two further
points:

- Oriedita's own refold, when the creases are unchanged, keeps "constraints
  and starting face" (`foldedFigureStaleness.ts:32`). The port has no
  constraints to keep.
- Inferred: Duplicate is the only way today to keep two layer orders of one
  pattern side by side.

### 1.4 Oriedita's constraint tool, catalogued but not ported

- **Upstream.** "Add color constraints to folded shape. Select a point on a
  face on the folded shape to set the color it should have … Fold again to use
  the constraints to find a new solution."
  (`apps/web/src/lib/oristudioCpToolInstructions.ts:53-60`). It is mapped to
  `addColorConstraintAction` / `ADD_FOLDING_CONSTRAINT`
  (`lib/oristudioCpActions.ts:562-565`). Prior research describes it: a
  left-click adds a `COLOR_FRONT` or `COLOR_BACK` constraint or inverts one,
  and a right-click removes it
  (`claude/fold-workspace:research/2026-10-08-fold-workspace/r1-cp-folded-figure.md:202-205`).
  **Documented.**
- **Ours.** `notImplemented('AddFoldingConstraint', …, { placement:
  'hidden-ui-only' })` (`lib/oristudioCpCommands.ts:800-802`). **Verified.**
- **Kernel.** `custom_constraints` appears only on `FoldedFigureRenderOptions`
  (`crates/oristudio-cp/src/folding.rs:420-468`). Its uses at `:2696-2762`,
  `:4046`, `:4134` and `:4496` are all in the drawing passes. The TypeScript
  type mirrors it (`engine/oristudioCpTypes.ts:404-418`). The search-side
  setters `set_top_indices` and `set_bottom_indices` exist
  (`crates/oristudio-cp/src/folding/permutation.rs:1739`, `:1747`). They are
  called only by tests (`crates/oristudio-cp/tests/oriedita_folding_oracle.rs:283-286`;
  `crates/oristudio-cp/tests/folding.rs:289-291`). **Verified.**
- **Point correspondence.** Oriedita's point-selection correspondence
  (`selected_flat_point_indices` / `selected_folded_point_indices`) is a
  render option with no UI caller, and `FoldedFigureSelectCanvasPoint` is
  `notImplemented` (`engine/oristudioCpTypes.ts:409-410`;
  `lib/oristudioCpCommands.ts:886-893`). **Verified.**

---

## 2. Picking

### 2.1 The crease-pattern canvas (Edit)

- **What can be picked.** Hit tests cover lines and points (`LineHitIndex`
  and the snap radii) and marquee quads. Presses over canvas objects are
  claimed through a registry (`cp-workspace/picking/lineHitIndex.ts`,
  `convexQuad.ts`, `cpSurfacePressRegistry.ts`, `surfacePressClaim.ts`,
  headers). There is **no face (polygon) hit test** on the CP. A whole region
  (sheet or segment) is picked and referenced by its rim (`RegionReference`,
  `cp-workspace/regions/regionReference.ts:25-32`). **Verified.**
- **Faces painted on the CP.** Only the contradiction pair: the two faces the
  layer estimate could not stack, filled red on the CP and on the folded figure
  (Oriedita's `drawSelfIntersectingSubFaces`)
  (`cp-workspace/adapters/cpFoldedToScene.ts:1126-1144`;
  `cp-workspace/CreasePatternWebglCanvas.tsx:1653`;
  `engine/oristudioCpTypes.ts:594-614`, `:1251-1258`). This is the only
  CP↔folded face correspondence on main, and it is display-only.
  **Verified.**

### 2.2 Folded figures (Edit)

- **A figure is picked whole.** A folded figure is a canvas object: a press
  selects, moves, resizes or rotates the whole figure, and a focused 3D figure
  orbits on drag (`useFoldedFigures.ts:1039-1072`;
  `foldedFigureOrbitGesture.ts:1-20`). Nothing picks a face of a flat or 3D
  figure. **Verified.**
- **Flat figures draw from the kernel's render stream.** The paper scene
  (faces, cell stacks, sheet points) is fetched only while aux creases are
  visible, and is never persisted (`foldedFlatScenes.ts:1-29`). **Verified.**

### 2.3 Data that would support picking faces on both sides

- **Flat: `folded_figure_paper_scene`.**
  - Per kernel face: its folded `outline`, the wireframe point each corner is
    (`points`), and whether it shows its front (`front_up`).
  - Per overlap cell: its `polygon` and `faces_top_to_bottom`.
  - `sheet_points`: where each wireframe point lies on the crease pattern.

  (`engine/oristudioCpTypes.ts:519-592`.) A face's ring on the CP is
  therefore `points.map(sheet_points)`, which is what the Diagram's
  `flatPaperFaces` computes (`diagram/capture/capturePaperFaces.ts:46-110`).
  **Verified.**
- **3D: the render model.**
  - per-face rings in 3D;
  - per-cell `cell_stack`, the face ids top first;
  - a determinacy flag per cell. Undetermined cells are drawn translucent
    (`engine/oristudioCpTypes.ts:944-969`;
    `simulator/foldedMeshSource.ts:58-70`).

  I found no mapping from 3D face ids to CP face polygons in the web code.
  **Inferred; not verified.**
- **Simulator picking.** The simulator picks faces on its own mesh, either
  what shows or every layer (`simulator/pickQuery.ts:1-60`;
  `simulator/useSimulatorRuntime.ts:236`, `:867`). It is not wired for folded
  3D figures. **Verified** that it exists; whether it applies is **Inferred**.

### 2.4 Correspondence and stack readouts that exist

- **Diagram (main): `paperFaces` on every flat step.** For each point, its
  place on the paper and on the unspread picture; for each face, its ring and
  its level (`diagram/document/diagramDocument.ts:669-708`). Uses:
  - an enlarge anchor is found by a point on the paper (`faceAt`,
    `diagram/zoom/zoomImprint.ts:556-565`);
  - the pick mode lights the top face under the pointer (`faceUnder`,
    `diagram/zoom/zoomAnchor.ts:73-87`);
  - a frame lands on a later step "through the face that holds the anchor's
    point there" (`zoomImprint.ts:1-31`);
  - the X-ray peel (`diagram/xray/xrayScene.ts:392` `xrayPeel`, `:498`
    `xrayRemoval`);
  - marks put behind a flap (`facesAt` / `facesOver`,
    `diagram/annotate/behindFlaps.ts:65`, `:135`).

  No crease pattern is ever shown beside the picture: the correspondence is
  internal. **Verified.**
- **Fold branch: two panes, the folded form and its crease pattern.**
  - A pick stores sheet points and is drawn on both panes. Vertex tools'
    regions are drawn on both too.
  - The stack under the pointer is read from cached cells
    (`claude/fold-workspace:apps/web/src/fold/canvas/foldPicking.ts:1-31`;
    `claude/fold-workspace:apps/web/src/components/fold/canvas/FoldCanvas.tsx:198-218`).
  - A hovered flap is lit on the folded pane only
    (`claude/fold-workspace:apps/web/src/fold/canvas/useFoldCanvasPaint.ts:168-186`).
  - The cross-section picker lists the display layers at the fold line, top
    to bottom, flags "unordered" rows, and falls back to per-interval stacks
    for a woven layer
    (`claude/fold-workspace:apps/web/src/components/fold/FoldCrossSectionPicker.tsx:9-22`,
    `:93-126`; `claude/fold-workspace:implementation-plans/fold-workspace.md:740-760`).

  **Verified on the branch.**

---

## 3. Diagram workspace

### 3.1 What Pose is

- **Two modes.** The step detail has two modes, Pose and Annotate. In Pose the
  picture fills the stage with its annotations ghosted, posed by the toolbar
  under it (`components/diagram/DiagramStepDetail.tsx:73-86`). **Verified.**
- **What Pose can do depends on the picture.** D5 sets this out
  (`implementation-plans/diagram-workspace.md:516-548`); the as-built verbs are
  in `diagram/actions/diagramLinkedPoseActions.ts:19-39`, `:245-288`.
  **Verified.**
  - **Upload:** rotate by 90° and mirror.
  - **References step:** turn over, and choose a way.
  - **Linked pattern:** "Show as" Crease pattern, Folded or Simulated (D19),
    then per way:
    - *crease pattern:* rotate, the paper's side, flip creases;
    - *flat fold:* turn over, rotate (by 15° or a typed angle), stand upright
      on a mirror axis, previous and next layer order, spread layers (depth
      or affine), reset;
    - *3D:* other side, from above, set upright, orbit by drag, reset;
    - *simulated:* fold %, set upright, orbit.
- **One capture per verb.** Every verb captures the picture and commits one
  undo step, "Adjust pose" (`diagram/capture/poseController.ts:405-411`). A
  capture session holds the fold between verbs, so turning or stepping does
  not fold again (`diagram/capture/captureSession.ts:1-14`; D4,
  `diagram-workspace.md:442-514`). **Verified.**
- **The Diagram folds the region itself.** A step's folded picture never comes
  from Edit's figures (D21, `diagram-workspace.md:1480-1500`, quoting the
  owner: "I want to render a folded figure that's separate from a folded
  figure that exists in the edit workspace"; D19, `:1335-1338`).
  **Documented.**

### 3.2 "Layer order n of m"

- **Readout.** `layerOrderLabel` gives:
  - "n of m+" while the search may find more;
  - "n of m" once it ran out;
  - n alone before the first search answers;
  - "None" for a fold with no layer order.

  (`diagramLinkedPoseActions.ts:117-145`.) It shows between ‹ and › on Pose's
  toolbar (`components/diagram/DiagramLinkedPoseControls.tsx:115-122`;
  `DiagramStepDetail.tsx:206`) and as the Step pane's "Layer order" row
  (`components/diagram/DiagramStepPose.tsx:138-147`). **Verified.**
- **Verbs.** Previous is disabled at 1; Next is disabled for a fold with one
  order or none (`diagramLinkedPoseActions.ts:258-273`). **Verified.**
  - Next is `foldAnother` on the held handle.
  - Previous is `foldToCase(k − 1)`. The kernel restarts its search and
    replays it forward (`diagram/capture/linkedPose.ts:365-369`;
    `captureSession.ts:268-270`, `:282-286`).
  - Because a replay forgets the orders past it, the session keeps the
    furthest it has reached (`reached`), which only grows or closes
    (`captureSession.ts:62-67`, `:219-239`).

  The decision is D23 (`diagram-workspace.md:1585-1598`); the as-built notes
  are at `:3654-3660`.
- **Stored.** `DiagramCpSource.render = { mode: 'folded-flat', side,
  rotationDeg, foldCase, spread? }` (`diagramDocument.ts:236-247`).
  `remembered` keeps each other "Show as" way's last pose, so a look at the
  crease pattern and back restores the layer order (`:494-511`). The furthest
  order reached is not stored. **Verified.**
- **No keyboard shortcut for layer order** (the Diagram's ids,
  `keyboard/shortcuts.ts:95-146`). It is counted as `diagram picture posed`
  with action `next_solution` or `previous_solution`
  (`analytics/events.ts:256-276`; `poseController.ts:411`). **Verified.**
- **3D steps have no layer order.** There are no 3D layer-order verbs, the
  render has no `foldCase`, and the capture runtime's `fold3dAnother` is
  called by nothing (`linkedPose.ts:393-406`;
  `diagramLinkedPoseActions.ts:277-285`; `diagramDocument.ts:248`;
  `diagram/capture/captureFolded.ts:88`). A 3D Diagram step always shows
  solution 1. **Verified.**

### 3.3 When the linked crease pattern changes

- **Link status is derived, never stored:** current, stale, missing or unknown
  (`diagram/capture/linkStatus.ts:1-14`). A region is recognised by its rim
  plus an `rc1:` fingerprint of its creases relative to their own corner, so a
  move is not a change (`cp-workspace/regions/regionIdentity.ts:1-19`,
  `:33-36`; `regionReference.ts:25-32`). **Verified.**
- **Refresh replays the index.** It captures again with the stored render: it
  folds, calls `foldToCase(foldCase)`, and "a flat request for a solution past
  the last one found keeps the last" (`captureFolded.ts:398-407`,
  `:470-484`). **Verified.** Inferred: after an edit, the k-th order of the
  new fold need not resemble the k-th of the old one; an index names a moment
  in an enumeration, not an arrangement.
- **The route can switch.** If the creases now fold in 3D, a flat render
  becomes a 3D one at the default camera, and the layer order is gone. Back to
  flat, it starts at case 1 (`linkedPose.ts:340-344`;
  `captureFolded.ts:298-307`, `:451-453`). **Verified.**
- **An open Pose session folds again** when the document or the line set
  changes (`captureSession.ts:242-262`). **Verified.**
- **Annotations stay behind on a layer-order change.** They are carried only
  through a turn or a spread, not through a change of side or layer order;
  they stay where they were (`diagram/annotate/annotationCarry.ts:233-240`;
  pinned by a test, `diagram-workspace.md:3110`). **Verified.**

### 3.4 `paperFaces`, and faces found by a point on the paper

- **Every flat capture stores `paperFaces`** as a compact JSON string. Each
  wireframe point has its place on the paper (pattern units about the centre
  of the paper's box) and on the unspread picture. Each face has its ring (in
  kernel face order) and its level (`diagramDocument.ts:669-708`;
  `diagram/document/paperFacesFile.ts:15-58`; `capturePaperFaces.ts:46-110`).
  A step captured before faces were kept gets them on demand while its link is
  current (`diagram/capture/stepPaperFaces.ts:24-99`). **Verified.**
- **Faces are matched across steps by a point on the paper, not by index.** A
  frame stores a paper point (`imprint.on`), and each step finds the face that
  holds it; on a crease the lower index wins (`zoomImprint.ts:1-31`,
  `:556-565`; `zoomAnchor.ts:47-57`). **Verified.**
- **The cost is accepted.** The owner chose to store every flat step's faces
  under a whole-file budget (Z11,
  `implementation-plans/diagram-revision-2.md:1575-1580`). **Documented.**

### 3.5 "Hide specific faces and show the faces underneath"

- **The wish.** The owner's words (Z11, 2026-10-06): "I'd rather always save
  the faces because later down the line I also want to do stuff like you know,
  being able to hide specific faces and show the faces underneath"
  (`diagram-revision-2.md:1577-1579`; restated at
  `diagram-revision-3.md:1040-1041`). **Documented.**
- **What exists: the X-ray mark.** A circular window that peels whole faces
  round by round, the window's whole top layer first; Depth N takes away the
  first N (`implementation-plans/diagram-xray-peel.md:12-56`, `:58-100`;
  `xrayScene.ts:392-509`). **Verified.** It is built from `paperFaces` levels.
  The kernel scene carries more than a step stores: each face's side, its edge
  kinds, every cell's stack and each face's aux creases
  (`diagram-revision-3.md:1043-1066`). **Documented.**
- **What does not exist: hiding a chosen face.** X-ray removes faces by window
  and depth, not by identity. **Verified** from `xrayScene.ts`'s exports; that
  nothing else does it is **Inferred** from a grep.

---

## 4. Fold workspace (`claude/fold-workspace`, unmerged)

### 4.1 Choices are stored as results, with faces named by sheet points

- **The goal.** "When a completion has more than one result, the user picks
  one and the pick is stored in the step." (`fold-workspace.md:18-19`)
- **Inputs are anchors in sheet coordinates**, "Never face, flap or
  enumeration ids" (`fold-workspace.md:315`). Choices are stored as results,
  not as indices (`:332-351`).
- **A completion choice.** `FoldCompletionChoice { faces: SheetPoint[];
  orders: [f, g, ±1][] }`: FOLD `faceOrders` triples over witness faces.
  Replay fixes them and completes. One result means resolved; a conflict or
  several means broken (`claude/fold-workspace:apps/web/src/fold/document/foldSequenceDocument.ts:631-672`).
  Import CP stores a whole order the same way, as `orderJson` (`:297-308`).
  **Verified on the branch.**
- **The engine.** A new `oristudio-layer-order` crate plus Flat-Folder's
  search, which takes "fixed assignments each tagged *carried* or *seed*"
  (`fold-workspace.md:422-480`). This is the nearest thing in the codebase to
  constraints handed to a solver. **Documented.**
- **Status is derived** (broken or changed) through the `fh1` and `fs1`
  digests (`fold-workspace.md:349-358`, D17 `:883-918`). **Documented.**

### 4.2 How a user resolves an ambiguous layer order in Fold

- **A plain fold** is exact, with no search (`fold-workspace.md:14`).
- **A compound fold** (reverse, crimp, tuck, sink, vertex) gets a "Layer
  order n of m" stepper in the tool window when its completion leaves more
  than one; the first is taken until another is chosen
  (`claude/fold-workspace:apps/web/src/fold/tools/reverse/reverseToolWindow.ts:15-17`,
  `:58-65`, `:109-131`). Choices "you cannot point at" go to a generalised
  `CpToolOptionLayer` (`fold-workspace.md:724`).
- **Import CP, including "Edit's folded figure",** opens a modal.
  - Per independent part, a radio group of order cards, each pictured by the
    state it lands.
  - The count reads "n layer orders fit" when exact, or "At least n".
  - Up to 24 previews per part, and "Search longer" when the budget runs out.

  (`claude/fold-workspace:apps/web/src/components/fold/import/FoldImportOrders.tsx:46-131`;
  `claude/fold-workspace:apps/web/src/fold/io/foldImportFlow.ts:102-111`,
  `:408-412`; `claude/fold-workspace:apps/web/src/components/fold/import/FoldImportDialog.tsx:94-200`.)
- **The cross-section picker** chooses which layers move, not an order
  (`FoldCrossSectionPicker.tsx:9-22`).
- **Analytics.** `fold choice offered`, with kinds `order` and `import_order`
  and a bucketed count
  (`claude/fold-workspace:apps/web/src/analytics/events.ts:97-118`,
  `:1605-1614`).

All **Verified on the branch** except where marked.

### 4.3 The bridge from Edit

- **Who qualifies.** A flat, `Solved` figure with a **live handle**; the bridge
  reads the kernel paper scene of the solution Edit shows
  (`claude/fold-workspace:apps/web/src/fold/io/foldEditFigure.ts:1-48`). It
  "maps Edit's chosen Oriedita solution through the shared order type"
  (`fold-workspace.md:879-881`). **Verified on the branch.**
- **A reopened flat figure does not qualify**, because it has no handle (see
  §1.3).

### 4.4 Pieces worth reusing

| Piece | What it is | Evidence |
| --- | --- | --- |
| `useCpSurface` | A store-free WebGL crease-pattern surface: an owned camera, pan, pinch and wheel, a click told from a drag, a hover probe, and `hitTest` | `claude/fold-workspace:apps/web/src/cp-workspace/surface/useCpSurface.ts:46-66`, `:219` |
| `FoldCanvas` / `FoldPane` | The folded form on the left and its crease pattern on the right, each a pane on `useCpSurface`; zoom and fit drive both | `claude/fold-workspace:apps/web/src/components/fold/canvas/FoldCanvas.tsx:69-90`, `:128-141` |
| `foldPicking.ts` | Pure picking on both panes; the stack under the pointer comes from the scene's cells | `claude/fold-workspace:apps/web/src/fold/canvas/foldPicking.ts:1-31` |
| `FoldCrossSectionPicker` | An accessible listbox of the layers at a line, keyboard-tested | as above |
| `FoldImportOrders` | Per-part order cards with pictures, on `OptionCards` | as above |
| `paperSceneToFoldedGeometry` | Paints a paper scene on the renderer's folded channel (branch only) | `claude/fold-workspace:apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` |

---

## 5. Modal and canvas building blocks (main)

### 5.1 Modal plumbing

- **`useModalDialog(onEscape, returnFocus)`** makes the dialog a shortcut
  barrier: it takes and keeps focus, captures Escape ahead of the workspace,
  sends Alt+arrows nowhere, and gives focus back on close
  (`components/ui/useModalDialog.ts:40-62`). **Verified.** Its users:
  - the References browser (`components/diagram/DiagramReferencesBrowser.tsx:23-28`,
    `:54-74`);
  - `ExportModalFrame` (`components/paperExport/ExportModalFrame.tsx:1-16`,
    `:57`);
  - Fold's Import dialog, on the branch.
- **Root mounting.** Modals are mounted at the app root, each in an error
  boundary. They share a z-index, so the later one in the document is on top
  (`App.tsx:170-209`). **Verified.**
- **The closest layout precedent** for "two things side by side, plus
  controls" is `ExportModalFrame`: the preview beside the options, with a
  footer. The crease-pattern export dialog keeps its own copy
  (`ExportModalFrame.tsx:1-16`). **Verified.**
- **Order cards.** `components/ui/OptionCard.tsx` (`OptionCards`) is on main.
  **Verified.**
- **The inline-simulate dialog** is a confirmation that opens a simulation
  window, not a canvas modal
  (`implementation-plans/inline-simulate-from-non-flat-fold-dialog.md:1-40`).
  **Documented.**

### 5.2 Canvases that could show a crease pattern and a folded figure

| Piece | Draws | Bound to the store? | Interactive? | Evidence |
| --- | --- | --- | --- | --- |
| `CreasePatternWebglCanvas` | Edit's canvas: the pattern, flat figures and 3D windows | yes; `useCpSurface`'s doc says it "registers none of the Edit canvas's singletons" | yes | `cp-workspace/CreasePatternWebglCanvas.tsx` (**Inferred** from that comment) |
| `useViewportSurface` | A DOM pan and zoom camera (react-zoom-pan-pinch), used by the BP panes, the Diagram's Annotate canvas and the Pages view | no | pan and zoom | `hooks/useViewportSurface.ts:152-165` |
| `captureCreasePattern` | A region's creases as a `PaperScene` in diagram pens | no | static | `diagram/capture/captureFolded.ts:188` |
| `buildCreaseExportArtwork` | A crease pattern as SVG | no | static | `lib/creaseExport.ts:1077` |
| `foldedFlatPaperScene` + `paperSceneSvgBody` | A flat folded figure as a `PaperScene`, then SVG | no | static | `cp-workspace/folded/foldedFlatScene.ts:115`; `lib/paper/paperSvg.ts:206` |
| `folded3dPaperScene` | A 3D figure as a `PaperScene` at a camera | no | static | `cp-workspace/folded/folded3dScene.ts:108` |
| `useFolded3dMeshRuntime` / `DiagramPose3dView` | A live 3D mesh in the simulator worker that takes drags; the view is Diagram-specific, the hook is general | the hook, no | yes | `cp-workspace/folded/useFolded3dMeshRuntime.ts:55`; `components/diagram/DiagramPose3dView.tsx:28-45` |
| Branch: `useCpSurface` + `FoldPane` | Interactive WebGL panes for a crease pattern and a folded form | no | yes | §4.4 |

### 5.3 What AGENTS.md requires of new UI here

- **Panels compose; they do not hold behaviour.**
  - Verb sets go in a React-free action catalog;
    `foldedFigureActions.ts` is the reference implementation.
  - Store bindings go in `use*` hooks beside the concern.
  - Keys go through the `keyboard/` registry, never a panel `keydown`
    listener. ESLint enforces that with `no-restricted-syntax`.
- **Panels have a line cap.** `max-lines` is 800 for panels;
  `CreasePatternPanel.tsx` has its own raised cap and is 3,531 lines
  (`apps/web/eslint.config.js:83-97`, `:388-392`, `:489-498`). **Verified.**
- **Styling.** New components use a CSS module, add no global CSS, use
  `--radius`, and compose the `components/ui/` primitives.
- **Analytics** go through `apps/web/src/analytics/`, with enums and bucketed
  counts only.

---

## 6. Persistence and versioning

### 6.1 The project file

- **Versions.** The `.osf` is schema 8. Its minimum reader is 1, 8 or 10;
  reader 10 is the Diagram list (`lib/nativeProjectFile.ts:62-78`,
  `:225-238`). **Verified.**
- **Additions are usually additive, with no bump.** Examples:
  `suppressionRegions`, the References reader state, and a folded figure's
  `scene`, `camera` and `frameRadius` (`nativeProjectFile.ts:153-165`,
  `:185-196`, `:846-860`). **Verified.**
- **A version collision is waiting.** The Fold branch also claims reader 10,
  for fold sequences, and gives 9 to "a diagram"
  (`claude/fold-workspace:apps/web/src/lib/nativeProjectFile.ts:66-80`). Main
  already writes 10 for the diagram list. **Verified** on both; that whichever
  merges second must renumber is **Inferred**.

### 6.2 Where constraints would be saved

- **(a) An Edit folded figure.** As a field of `OristudioCpFoldedFigureEntry`,
  in the CP document's `viewState.foldedFigures` (`nativeProjectFile.ts:167-183`;
  `engine/oristudioCpTypes.ts:1115-1267`).
  - `validateFoldedFigure` builds an explicit literal. Its own comment: "This
    function is the drop … anything *not named here* silently vanishes on the
    way back in" (`nativeProjectFile.ts:807-816`).
  - So a new field must be added there and to the round-trip test. An older
    build drops it on load and again on its next save: silent loss, no lock.

  **Verified.**
- **(b) A Diagram step.** On `DiagramCpSource.render` (`folded-flat`) or on
  the source itself; face data would go beside the picture's `paperFaces`
  (`diagramDocument.ts:494-511`, `:669-708`).
  - The reader keeps a key set per render mode. A field outside it makes the
    render "a newer build's", and the step is locked and carried verbatim
    (`diagram/document/diagramFile.ts:811-815`, `:853-863`, `:905-915`).
  - A new key in `paperFaces` does the same (`paperFacesFile.ts:18-22`,
    `:44`).
  - The Diagram is released, and external users have created diagram events
    since the week of 2026-10-11 (**Measured**, §7), so a lock would reach real
    files opened in older builds.

  **Verified.**
- **(c) A Fold step.** `FoldChoices.completion` is already the representation
  (§4.1).

### 6.3 How face identity is kept today

| Where | How a face or region is named | Survives CP edits or engine changes? |
| --- | --- | --- |
| Edit figure | Kernel face indices, within one fold. Only `startingFaceId` is persisted (`engine/oristudioCpTypes.ts:594-604`, `:1121`). The source region is a bounding box plus a `cs1:` fingerprint (`:1214-1237`; `foldedFigureStaleness.ts`). | No. Indices follow the arrangement. |
| Edit 3D figure | The solution index, replayed and checked on load (`folded3dRehydrate.ts:77-98`; `creasePatternSlice.ts:3337-3341`: the index "can fail across [a build] whose solver enumerates differently") | No, and checked rather than assumed |
| Diagram link | The region's rim plus an `rc1:` relative fingerprint; `cs1:` is still read for old steps (`regionIdentity.ts:1-60`; `diagram/capture/captureCreases.ts:17-24`) | Survives a move, not an edit |
| Diagram faces across steps | A point on the paper (`zoomImprint.ts:1-31`, `:556-565`) | Yes, while the paper holds the point |
| Fold steps | Interior sheet-point witnesses plus FOLD triples. A witness that lands in no face, or two in one face, breaks the step (`fold-workspace.md:332-351`). | Designed to; documented reasoning: "later faces are subsets of earlier ones" |

Inferred: sheet-point witnesses are the only scheme in the codebase designed to
survive renumbered faces. Kernel face ids and solution indices are not stable
across crease edits or engine changes.

---

## 7. Analytics

### 7.1 Events that exist

| Event | Properties | Fired from | Evidence |
| --- | --- | --- | --- |
| `fold attempted` / `fold completed` | `mode` (flat or spatial), `verdict`, `solution_count_bucket`, `elapsed_ms_bucket`. The solution count is the number discovered at fold time, so it is usually 1. | Edit's Fold | `creasePatternSlice.ts:2026`, `:2035-2056`; `analytics/events.ts:664-712` |
| `fold solution cycled` | `direction` (next or wrap); `solution_count_bucket`, the number discovered after the press | Edit only | `creasePatternSlice.ts:2564-2593`, `:2627-2630`; `events.ts:714-715`, `:1355` |
| `diagram picture posed` | `action`, including `next_solution` and `previous_solution` | Diagram Pose | `events.ts:256-276`, `:1592`; `poseController.ts:411` |
| `folded figure rehydrated` | `trigger`, `outcome` | Edit 3D on load | `creasePatternSlice.ts:3296-3303`, `:3378` |

Nothing goes through the `handleMenuAction` chokepoint, which has no fold or
solution action (`commands/menuActions.ts:58`, `:289`). The export dialog's
"Fold case" input is not instrumented. **Verified.**

### 7.2 PostHog (read-only, 2026-10-19)

Project "Default project" (543871). Every number excludes the project's test
accounts: one internal distinct id, and any event with `internal_user` set.
The window is −90 days, but the project's data starts in the week of
2026-08-09, so it covers about ten weeks. "Users" is PostHog `dau` math summed
over the range: unique users in the window. All rows are **Measured**.

| Measure | Value |
| --- | --- |
| `fold completed` | 3,119 events, 193 users |
| … flat, `folded` | 1,815 events, 131 users |
| … flat, `contradiction` | 681 events, 57 users |
| … flat, `error` | 215 events, 74 users |
| … flat, `no-solutions` | 81 events, 9 users |
| … 3D, `folded` | 148 events, 16 users |
| … 3D, `no-layer-order` | 56 events, 9 users |
| … other verdicts (cancelled, not-drawable, halted, simulated, located) | 123 events |
| `fold solution cycled` | 1,399 events, 42 users |
| … presses per cycling user | median 5.5, p90 57.9, max 720 |
| … by discovered count after the press (events / users) | ≤5: 422 / 42; ≤10: 186 / 13; ≤20: 200 / 9; ≤50: 322 / 5; ≤100: 153 / 3; ≤200: 43 / 1 |
| … wraps (events / users) | `wrap, ≤1`: 49 / 10; `wrap, ≤5`: 24 / 1 |
| `diagram picture posed` | 743 events; `next_solution` 3 (1 user); `previous_solution` 0 |
| `folded figure rehydrated` | 102 events |
| Internal users' share (unfiltered minus filtered) | 87 cycling presses, 258 fold completions, 2 Diagram layer-order presses |
| Weekly `fold solution cycled` | 10, 31, 16, 7, 90, 161, 109, 198, 53, **683** (week of 2026-10-11), 41 (partial week) |

**Readings** (**Inferred**):

- About a third of the people who got a flat figure tried another order: 42
  users cycled, against 131 users with a flat figure. These are different
  events, so the overlap is approximate.
- The tail is real. One user pressed 720 times. Five users reached solutions
  21–50 or beyond, and one passed 100. That supports the owner's "there could
  be hundreds of layer orders" for at least some patterns.
- 10 users exhausted a flat enumeration and wrapped. A flat wrap restarts the
  search, so the count after it is ≤1. A 3D wrap keeps its high-water count,
  which is consistent with the one `wrap, ≤5` user.
- Diagram layer-order paging is almost unused, but the Diagram launched about
  a week ago, so it is too early to read anything into that.
- 681 flat contradictions against 1,815 flat folds: a large share of flat
  folds end with no layer order at all.

**Not measured.** How many solutions a pattern actually has (the app never
knows a total), the time between presses, and per-pattern breakdowns. None of
these are instrumented.

---

## 8. Known pain points

1. **Navigation is forward-only.** The enumerator has no rewind; going back
   costs about one re-fold (`implementation-plans/folded-figure-solution-navigation.md:35-83`,
   `:112-137`). **Documented.** The kernel now reports `current_fold_case` and
   can restart. Edit exposes forward and wrap only; the Diagram offers
   Previous by replaying. **Verified.**
2. **There is no total.** "No 'k of N' is expressible"
   (`foldedFigureState.ts:13-14`; `engine/oristudioCpTypes.ts:887-888`). The
   Diagram shows "m+" instead. **Verified.**
3. **Different orders look identical** in opaque styles
   (`foldedFigureCapabilities.ts:84-107`). Edit has no layer spread; spread is
   Diagram-only (`cp-workspace/folded/foldedLayerSpread.ts` is used by
   `diagram/*`). **Verified.**
4. **A persisted index drifts.**
   - A refold resets to 1 (§1.3).
   - A Diagram Refresh replays the index into a new enumeration (§3.3).
   - A change of engine can change the enumeration, which is why the 3D
     rehydrate checks the index (`creasePatternSlice.ts:3337-3341`).

   **Verified.**
5. **A reopened flat figure cannot cycle** until its creases change (§1.3).
   **Verified** by reading; not run.
6. **The 3D search reports "no layer order" when one exists.** It is sensitive
   to the starting face and the cell order, and the verdict's honesty is under
   repair (`fold3d-layer-order-debuggability.md:24-48`, `:92-112`).
   `NoSolutions` is not a proof on the flat path either
   (`claude/fold-workspace:research/2026-10-08-fold-workspace/r1-cp-folded-figure.md:119`,
   `:241`). **Documented.**
7. **A re-solve must not destroy a good figure.** A refold that finds nothing
   keeps the old figure and reports
   (`implementation-plans/folded-figure-feedback-and-failures.md:16-42`).
   Inferred: a constrained re-solve that finds nothing needs the same
   no-op-on-failure rule. Fold runs are visible and stoppable from anywhere
   (`creasePatternSlice.ts:2520-2535`). **Documented / Verified.**
8. **The Diagram has gaps at both ends of a fold.** 3D steps are fixed at
   solution 1, and a layer-order change leaves annotations behind (§3.2,
   §3.3). **Verified.**
9. **The Diagram's layer-order review** settled two rules: the verbs refuse
   rather than disable, so focus is kept, and the reached frontier only grows
   (`diagram-workspace.md:3702-3705`). **Documented.**

---

## What I could not verify

- **Undo after "Another solution."** Whether undoing a press leaves the kernel
  session out of step with the restored entry (§1.3). I found no test.
- **Picking a 3D figure from the CP.** Whether a 3D figure's faces can be
  mapped back to CP polygons from data the web holds (§2.3).
- **Browser behaviour.** Nothing was run in a browser; every statement about
  behaviour comes from reading code or tests.
- **Kernel cost.** What a constrained search would cost, and whether the 3D
  search can take constraints at all. That is the kernel slice's question.

---

## Integration points for a shared modal

These are the seams each surface already has: what a modal would be opened
from, what it would be handed, what it would give back, and where the result
would be kept. Nothing here is a design.

**Common to every surface** (**Inferred**):

- **What the modal needs:**
  - the CP document snapshot;
  - the fold's scope (line ids, or a region);
  - its route, flat or 3D, from `resolveFoldRoute`;
  - the side (flat) or the camera (3D);
  - the current choice, which every surface holds today as an index;
  - a kernel runtime bound to a stoppable fold run.

  For a flat fold, `folded_figure_paper_scene` (faces, cell stacks,
  `sheet_points`) carries everything needed to draw the crease pattern and the
  folded figure side by side and to map a click on either to a face.
- **What it gives back:** the chosen arrangement and the constraints that
  produced it. The host commits one undo entry and folds or captures through
  its own path.
- **What would be stable to persist:** constraints keyed by points on the
  sheet. The Diagram's paper points and Fold's witnesses are the existing
  precedents; kernel face ids or solution indices are not stable.

**Per surface:**

| Surface | Entry point | What the modal receives | What it hands back | Persisted where | Caveats |
| --- | --- | --- | --- | --- | --- |
| **Edit, flat folded figure** | A verb in `buildFoldedFigureActions`, beside "Another solution" (`foldedFigureActions.ts:622-639`). One catalog entry appears on the toolbar and in the context menu at once. Optionally a row in the Properties sheet (`foldedFigureProperties.ts:364-373`). | The entry: `handle`, `snapshot.current_fold_case`, `model.state`, `startingFaceId`, `sourceLineIds` / `sourceBounds`, `displayStyle`. The paper scene via `getOristudioCpFoldedFigurePaperScene(handle)` (`cpFoldRuntimeBindings.ts:12`). | A new snapshot and `renderSnapshot` through a store action shaped like `foldAnotherOristudioCpFigure` or `refoldOristudioCpFoldedFigure`, wrapped in `runFoldedFigureAction` for one undo entry (`useFoldedFigures.ts:313-321`) | A new optional field on `OristudioCpFoldedFigureEntry`, which `validateFoldedFigure` must name (`nativeProjectFile.ts:807-816`). An older build drops it silently. | A reopened figure has no handle, so the modal must fold first. Refold resets to solution 1 today, so saved constraints would have to be reapplied. Kernel support for constraints is unported (§1.4). |
| **Edit, 3D folded figure** | The same verb, gated by `foldedFigureCapabilities` (`:109-126`) | `folded3d` (with `current_fold_case`), the render model registered by handle, the camera | The same shape as a flat figure's | The same | No fold-to-case in 3D. Whether the 3D order search (`folding3d`) can take constraints is a kernel question. A reopened figure is live only after rehydrate. |
| **Edit, "on an existing crease pattern"** | Next to the viewport's Fold button (`CreasePatternPanel.tsx:2906-2955`) or the selection toolbar, before any figure exists | The selected foldable line ids (`selectedFoldLineIds`, `useFoldedFigures.ts:741-748`), the document | A new figure folded under the constraints (`foldOristudioCpDocument`) | The new entry's field, as above | Every fold uses starting face 1 (§1.2). |
| **Diagram step (Step pane, outside Pose)** | The Pose section's "Layer order" row (`DiagramStepPose.tsx:138-147`), or a new id in `buildDiagramLinkedPoseActions`, which the Pose toolbar would also show | The step's `source`: `scope`, `fingerprint`, `render` with `foldCase`, `side` and `spread`; the document, the sheet index and the style; the step's `paperFaces` | A new render, captured and committed by the pose controller as "Adjust pose" (`poseController.ts:405-411`), plus the `diagram picture posed` event | `DiagramCpSource.render` (`folded-flat`). A new field locks the step in older builds (`diagramFile.ts:853-863`), unless the document's format version is raised. | Diagram folds are separate from Edit's (D21). Annotations are not carried across an order change. Refresh replays whatever is stored. 3D steps have no layer order. |
| **Pose (step detail)** | Pose's toolbar beside the ‹ n of m › pager (`DiagramLinkedPoseControls.tsx:115-122`) | As above, plus the held capture session: the fold handle is held while Pose is open (D4; `captureSession.ts:241-286`) | As above | As above | The modal must stand Pose's keys down (`useModalDialog`'s barrier). Pose captures on exit if the pose changed. A held fold is dropped and refolded when the pattern changes. |
| **Fold workspace (branch)** | The tool window's "Layer order" stepper (`reverseToolWindow.ts:109-131` and its siblings), and the Import dialog's order cards | The session's state, with faces named by witnesses | A `FoldCompletionChoice` (witness faces plus FOLD triples) | `choices.completion` on the step (`foldSequenceDocument.ts:648-672`) | Unmerged. Reader version 10 collides with main's (§6.1). Fold builds its own constraint problem (`oristudio-layer-order`), not Oriedita's search. |
