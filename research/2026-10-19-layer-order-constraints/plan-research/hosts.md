# Layer order dialog: host surfaces and their saved data

Plan research, one slice of the engineering plan. This slice covers the hosts
in `apps/web`, meaning the places that open the dialog, take its answer and
save it:

- Edit's flat folded figure;
- Edit's crease-pattern selection;
- a Diagram step, and Pose;
- the saved data and its versions;
- the disabled entry on 3D figures and steps.

The dialog itself and the engine belong to other slices. They are cited here
only where a host depends on them.

- **Base.** Read at `eb4b51c54` (PR #476, `claude/fold-solver-perf`, stacked
  on #475). The source is a scratch snapshot of that commit. Every
  `path:line` below is at `eb4b51c54`, relative to the repo root, and paths
  without a prefix are under `apps/web/src/`.
- **Nothing was run.** Not the app, not tests, not a browser.
- **Evidence labels.** **Verified**: read at the cited lines. **Inferred**: my
  reading, not checked by running anything. **Unknown**: not established.
- **Design wins.** Where the approved design (2026-10-20) differs from
  `product-spec.md`, I follow the design. One example: Add clears the
  sentence. That is the dialog's behaviour and does not touch the hosts.

---

## Summary

1. **"Layer order…" in Edit is one catalog entry.** It is a new command in
   `buildFoldedFigureActions`, placed right after "Another solution". The
   toolbar and the context menu then both get it with no other change. The
   catalog needs one new field, a `hint` on commands, so the entry can show
   disabled with a reason (3D, not solved, no source). **Verified** seam;
   size **S**.
2. **Apply in Edit should fold into a new kernel handle, not change the old
   one.** Refold already works this way, and that is what makes its undo
   correct (`creasePatternSlice.ts:3153-3156`). "Another solution" instead
   changes the handle in place, and undo puts back only the model, not the
   layer order (`creasePatternSlice.ts:535-582`, `historySlice.ts:356`). So
   after an undo, anything that re-renders from the kernel (a style change, a
   reselect) probably shows the undone solution. **Inferred** from code, not
   run. With a new handle, Apply is one undo entry and stays correct.
3. **A reopened flat figure has no handle** (`nativeProjectFile.ts:934-943`),
   and flat figures are never rehydrated. A new on-demand
   `rehydrateOristudioCpFlatFigure` does two things:
   - it refolds and shows the saved order through the new "show this order"
     kernel entry;
   - it adopts the result only if the saved order comes back exactly, which is
     the 3D rehydrate's rule (`creasePatternSlice.ts:3199-3331`).
   Size **M**.
4. **Save Edit's constraints in the crease-pattern document's `extensions`
   bag, not on the figure.** The figure reader drops any field it does not
   name (`nativeProjectFile.ts:958-1031`). The document's `extensions` bag, by
   contrast, has been read and written back verbatim by every build since
   v0.2.0 (`projectSlice.ts:1189`, `:1821`; commit `af6248937`).
   - So an older build carries the constraints instead of dropping them, and
     no reader-version bump is needed.
   - The cost: an older build can change a figure without updating its
     record. A `figureKey` detects that, and the constraints are then
     flagged, never dropped.
   - The alternative, a field on the figure plus reader 12, makes older builds
     refuse the whole file. This is an owner decision (Q1).
5. **Save a Diagram step's constraints on its source** (`DiagramCpSource`),
   not on the `folded-flat` render. On the source they survive Show as and a
   flat-to-3D route switch. On the render they would be lost with no word,
   because the 3D render has no field for them (`captureFolded.ts:314-327`).
   - An older build sees an unknown key and locks the step: it shows its
     picture and can be moved or deleted, never edited
     (`diagramFile.ts:813-846`, `:1123-1131`; `diagramDocument.ts:1283-1288`).
     That is the Diagram's designed behaviour.
   - No `DIAGRAM_FORMAT_VERSION` bump and no project reader bump.
6. **Pose and the Step pane share one pose controller**
   (`openLinkedPose.ts:1-38`). Apply becomes one new pose request,
   `{ verb: 'layer-order', … }`, through `poseLinkedStep`. It commits one
   "Adjust pose" capture (`poseController.ts:399-401`), so both entry points
   get undo, the busy guards and engine-loss handling for free. **Verified**
   seam; size **L** with the capture path.
7. **Two existing pagers need engine support before they can work.** These are
   "Another solution" and the Diagram's ‹ › once a figure has constraints
   (decision 4). Stepping through the fitting solutions needs an enumeration
   of fitting *looks* (distinct pictures from the side shown) and a position
   within it. Neither exists for this route yet (engine slice). I propose
   these as their own PRs, after display and Apply.

---

## 0. One contract for every host

The dialog never reads a store. Every host hands it the same thing and takes
back the same thing.

### 0.1 What exists

- **Root-mounted modals with their own UI store.** Import CP is the example:
  `fold/io/foldImportUiStore.ts:1-40`, mounted at the app root inside an
  `OverlayErrorBoundary` (`App.tsx:181-218`). **Verified.**
- **`useModalDialog`** keeps keys, focus and Escape inside the dialog, which
  stands Pose's keys down while it is open (`components/ui/useModalDialog.ts:64`).
  **Verified.**
- **Every host can produce the Oriedita paper scene of what it shows now:**
  - faces on the paper as `points` into `sheet_points`;
  - each face's `front_up`;
  - each subface's `faces_top_to_bottom`.

  (`engine/oristudioCpTypes.ts:529-586`.)
  - Edit gets it from a live handle (`cpFoldRuntimeBindings.ts:58`,
    `getOristudioCpFoldedFigurePaperScene`).
  - Pose gets it from the session's held read (`captureSession.ts:73`,
    `:288-292`).
  - A capture gets it through `runtime.paperScene` (`lib/creaseExportFold.ts:43-47`).

  **Verified.**
- **The Fold engine can already build a problem from exactly that scene.**
  "Start from Edit's folded figure" reads `FoldedPaperScene`. It takes each
  face's ring on the sheet as the crease pattern, and the stacks as the
  order, with faces named by ring centroids
  (`crates/oristudio-fold-wasm/src/io/figure.rs:1-60`). The checking session
  that the dialog uses (`import_session`, `import_check`) has no web caller
  yet (`crates/oristudio-fold-wasm/src/io/bindings.rs:13-21`). **Verified.**

### 0.2 Proposed

- **A new store**, `layer-order/layerOrderDialogStore.ts`, with the same shape
  as `foldImportUiStore`. Hosts call `openLayerOrderDialog(request)`.
- **A new root modal**, `LayerOrderModal`, in `App.tsx`.
- **The request and the result:**

```ts
export type LayerOrderSurface = 'edit_figure' | 'edit_pattern' | 'diagram_step' | 'pose';

export interface LayerOrderRequest {
  surface: LayerOrderSurface;           // also the analytics enum
  title: string;                        // header: the figure's or the step's name
  /** Oriedita's fold as the host shows it now: the dialog's crease pattern and problem. */
  scene: OristudioCpFoldedPaperScene;
  side: 'front' | 'back';               // the side the dialog opens on
  look: { kind: 'edit'; displayStyle: OristudioCpFoldedFigureDisplayStyle; paper: PaperStyle }
      | { kind: 'diagram'; style: DiagramStyle };   // "draws the figure the way its host does"
  frame: PaperFrame;                    // host paper frame <-> the scene's CP coordinates (§4.3)
  record: LayerOrderRecord | null;      // what is saved, if anything
  /** Commit. Resolves true once the host has committed, so the dialog closes; false keeps it open. */
  apply: (applied: LayerOrderApplied) => Promise<boolean>;
}

export interface LayerOrderApplied {
  record: LayerOrderRecord;             // in the host's paper frame
  /** Every pair of the chosen order, in the shape the Oriedita "show this order" entry takes (engine slice). */
  seed: OrieditaOrderSeed;
}
```

- **Why the scene and not raw creases.** Every host already folds with
  Oriedita to draw, so face naming and tolerances come from one place. The
  dialog's problem is built from the faces Edit actually draws. **Inferred**
  to be the cheapest bridge. The engine slice must confirm that the session
  can be opened from a scene with its order ignored.
- **Size: S** for the store and the modal shell. The dialog's insides are
  another slice.

---

## 1. Edit: a flat folded figure

### 1.1 What exists

| Concern | Seam | Notes |
| --- | --- | --- |
| The verb catalog | `cp-workspace/folded/foldedFigureActions.ts:546-695` (`buildFoldedFigureActions`); the command shape is `:52-68`; deps are `:215-293`; readiness is `:302-308` | Store-free and React-free; the toolbar and the context menu both render it. **Verified.** |
| "Another solution" | `foldedFigureActions.ts:622-639`; cycling state `foldedFigureState.ts:37-55` | Disabled when not ready, or when there is nothing to step to. **Verified.** |
| Toolbar and menu renderers | `CpFoldedFigureToolbar.tsx:24-36` (`CommandButton`, title = label), `:161-190`; `foldedFigureMenuItems.tsx:147-156` | Menu rows already take a `hint` (`components/ui/contextMenuTypes.ts:20-28`). `FoldedFigureCommand` has no `hint` field. **Verified.** |
| Store bindings and undo | `cp-workspace/folded/useFoldedFigures.ts:313-321` (`runFoldedFigureAction`), `:895-1037` (deps), `:951-955` (foldAnother), `:962-966` (refold) | One verb is one undo entry, through the layer bracket (`foldedFigureGesture.ts:14-44`). **Verified.** |
| Fold | `store/workspaceStore/slices/creasePatternSlice.ts:1928` (`foldOristudioCpDocument`); flat path `:2276-2452`; starting face 1 at `useFoldedFigures.ts:86`, `:741-755` | **Verified.** |
| Another solution | `creasePatternSlice.ts:2482-2610` | Changes the handle in place. The flat branch is `:2568-2592`. Fires `fold solution cycled` at `:2571-2574`. **Verified.** |
| Fold to case (no UI caller) | `creasePatternSlice.ts:2612-2694` | **Verified.** |
| Refold | `creasePatternSlice.ts:2957-3166`; flat branch `:3091-3165` | New handle; the old one is released after success, and only then (`:3153-3156`). Lands on solution 1. Can swap to 3D (`:3013-3089`). **Verified.** |
| 3D rehydrate (the model for a flat one) | `creasePatternSlice.ts:3199-3331`; rules `cp-workspace/folded/folded3dRehydrate.ts:67-103`; scheduling `useFolded3dRehydration.ts` | Adopts only when the index and the frame match. **Verified.** |
| Duplicate | `creasePatternSlice.ts:3333-3476`; flat `:3435-3461` | The placeholder entry is built **field by field** (`:3350-3372`), so a new field is not copied unless named there. **Verified.** |
| Undo | `historySlice.ts:356`, `:542` → `reconcileFoldedFigureModels` → `creasePatternSlice.ts:535-582` | Reconciles the *model* (colours, side) only. Its own comment: a reselect re-renders from the kernel and shows the undone state (`:487-500`). **Verified.** That the same thing happens to a stepped solution is **Inferred**. |
| Re-render from the kernel | Style change at `creasePatternSlice.ts:2784-2790`; selection marker `:584-600` | Both draw the kernel's current state, not the entry's. **Verified.** |
| Properties subtitle | `foldedFigureNotice.ts:223-245` ("Case N"); used at `foldedFigureProperties.ts:369` | **Verified.** |
| Edit to Fold bridge | `fold/io/foldEditFigure.ts:20-24`: needs a handle and `outcome === 'Solved'` | **Verified.** |
| Analytics | `fold attempted` / `fold completed` (`creasePatternSlice.ts:1970-1999`; `analytics/events.ts:1499-1500`); `fold solution cycled` (`:1501`); `folded figure rehydrated` (`:1708`, fired at `creasePatternSlice.ts:3246`, `:3322`) | **Verified.** |

### 1.2 What is missing for this design

- An entry point, and a way to disable it with a reason.
- A kernel call that folds and shows a given order. That is the engine
  slice's "show this order" entry; the host needs its binding.
- An Apply that is one undo entry and survives undo.
- The record on the figure, carried through Duplicate and Refold, and saved
  (see §4).
- Reopen. Today a reopened flat figure cannot step at all, and the dialog
  needs a fold of the order on screen.
- Refold after a crease edit: re-resolve, show the closest fitting order, and
  flag broken constraints.
- "Another solution" within constraints (decision 4).
- A Properties summary.

### 1.3 Proposed change

**(a) Catalog.** Size **S**.

- Add `'layer-order'` to `FoldedFigureCommand['id']`. Add an optional `hint`
  to `FoldedFigureCommand`, rendered as the title when disabled
  (`CommandButton`) and as the menu row's `hint`.
- Add `openLayerOrder?: (figure) => void` to `FoldedFigureActionDeps`. When it
  is omitted, the verb is dropped, the same pattern as `exportFigure`.
- Push the command right after `'another'`. The label is
  `t('panels:foldedFigureActions.layerOrder', 'Layer order…')`.
- **The disabled rules**, in this order, each with its own hint:
  1. A 3D figure: "Layer order works on flat folded models for now" (§5).
  2. Not drawable, or `snapshot.outcome !== 'Solved'`: "These creases have no
     layer order to choose from" (Q7).
  3. `sourceBounds == null`, an imported figure: "This folded model has no
     source creases to work from".
  4. A newer build's record (§4.4): "Made with a newer Ori Studio".
  - Not ready (`status === 'loading'`): disabled with no hint, like the
    other verbs.
- **Readiness is different from the other verbs.** A figure **without a
  handle stays enabled**: pressing it rehydrates on demand (c). A stale figure
  is enabled too (e).
- **The icon** is a design call. Rule 1 (one concept, one icon) means the
  glyph has to be new. `Layers` is already Render as (Edit) and Spread Layers
  (Diagram) (`foldedFigureActionIcons.tsx:48-49`;
  `DiagramLinkedPoseControls.tsx:39`). **Verified.**

**(b) Binding: `useFoldedFigures`.** Size **S**.

`openLayerOrder(figure)` does the following:

- builds a `LayerOrderRequest` from:
  - the live paper scene;
  - `foldedFigureModel(figure).state` (`Front0` → `front`);
  - `figure.displayStyle` and `effectiveObjectPaperStyle(figure, display)`
    (`useFoldedFigures.ts:865-869`);
  - `EDIT_PAPER_FRAME` and `figure.layerOrder`;
- opens the dialog;
- has `apply` call
  `runFoldedFigureAction(t('panels:creasePattern.setLayerOrderAction', 'Set layer order'), () => applyOristudioCpFigureLayerOrder(id, applied))`.

The panel gains nothing: the binding lives in the hook.

**(c) Store: `applyOristudioCpFigureLayerOrder(id, applied, { refold })`**, in
`creasePatternSlice.ts`. Size **M**.

- Shaped like the flat refold. It goes through
  `withFoldInFlight('layer-order', …)`, so the run is visible and stoppable.
- It calls a new runtime binding,
  `foldRuntimeOristudioCpDocumentWithOrder(startingFaceId, model, lineIds, seed, runId)`,
  which returns `{ handle, snapshot }` like `fold`. It refolds the source
  lines (`reselectFoldableLineIds(document, sourceBounds)`) with the seed.
- On success it swaps in `{ handle, snapshot, renderSnapshot,
  layerOrder: applied.record, contradiction: null, status: 'ready' }`. It
  releases the old handle afterwards, and only then; history may still hold
  it (`foldedFigureHandles.ts:1-19`).
- On failure: `restorePreviousFigure`. On a stop: `restorePreviousFigureQuietly`.
- **Why a new handle and not an in-place "show this order" on the old one.**
  An undo restores the old entry, *with the old handle in its old kernel
  state*. A later style change or reselect (`:2784-2790`, `:584-600`)
  re-renders the right order. **Inferred** sound; the store tests in §1.5
  prove it.
- The binding lives beside `foldRuntimeOristudioCpDocument` in
  `store/workspaceStore/oristudioCpRuntime`. `CpFoldRuntime` gains an optional
  `foldWithOrder` for the Diagram (§3).

**(d) Store: `rehydrateOristudioCpFlatFigure(id, { pending })`.** Size **M**.
It runs on demand only (pressing Layer order…, and later Another solution),
never in the background.

- **Gates**, mirroring `canRehydrateFolded3dFigure`:
  - flat;
  - `handle == null`, `ready`, generated;
  - `sourceBounds` set;
  - not stale.
- **With a record:** fold the source lines with the record's order as the
  seed. **Without a record:** `fold` then `foldToCase(current_fold_case)`.
- **Adopt only if the result is the same order.**
  - With a record, the re-read scene must reproduce the record's order pairs.
  - Without one, `current_fold_case` must match.
  - In both cases the re-rendered `renderSnapshot` must also equal the stored
    one. A flat render is deterministic within a build, which is
    **Inferred**; the check is cheap.
  - Otherwise free the handle and leave the figure as it is. The dialog then
    says it could not reopen the fold, and the figure keeps its picture.
- No history, no `dirty`, no selection, as in the 3D rehydrate
  (`:3318-3321`).
- `folded figure rehydrated` gains `mode: 'flat' | 'spatial'`.
- **Side effect (Q8):** the same action could re-enable Duplicate and Another
  solution on reopened flat figures. That is a separate PR if the owner wants
  it.

**(e) Refold with constraints.** Inside `refoldOristudioCpFoldedFigure`'s flat
branch (`:3091-3165`). Size **M**.

1. Fold the source lines with Oriedita's default, as today, and read its
   paper scene.
2. If `figure.layerOrder`, call the engine's
   `resolveLayerOrder({ scene, frame, record })`.
   - **It re-finds the faces** by paper points
     (`faceAtSheetPoint`, as proposed in `design/fold-share.md` §4.2.A). Each
     constraint comes out *held*, *gone* (its point lands in no face) or
     *split* (ambiguous).
   - **It solves** with the held constraints.
   - **It returns** the fitting order closest to the saved one, with updated
     `held` flags, or `none` (the smallest clash), or `undecided` (the budget
     ran out).
3. On `fits`: fold with that seed (a third fold, see risk R3), swap, and write
   the updated record.
4. On `none`: keep the old picture, which is exactly today's no-op-on-failure
   rule (`:3107-3118`). Mark the record
   `attention: 'conflict'`. The subtitle says "Layer constraints need
   attention", and the dialog opens on the current creases.
5. On `undecided`: show Oriedita's default, and mark constraints that were not
   applied `held: false`.
- Fires `layer constraints need attention { surface: 'edit_figure', cause,
  broken_count_bucket }`.
- **"Layer order…" on a stale figure** opens the dialog on the *current*
  creases: it folds them through the rehydrate path with no adopt check.
  Apply then commits `applyOristudioCpFigureLayerOrder(id, applied,
  { refold: true })` under the label "Refold with layer order", as one entry.
  This is the only way out once a refold reported a conflict. Refusing the
  stale case would deadlock the user (**Inferred**).
- **A constrained figure whose creases now fold in 3D.** The refold swaps
  kind (`:3013-3089`) and **keeps `layerOrder` on the entry, unused**. The
  subtitle and the dialog entry say it needs flat creases. A later refold
  back to flat re-applies it. Never cleared silently.

**(f) Duplicate.** In `duplicateOristudioCpFoldedFigure`'s `loadingEntry`
(`:3350-3372`), add `layerOrder: source.layerOrder`. The kernel clones the
session, so the copy shows the same order. Size **S**. **Verified** that the
field is otherwise lost.

**(g) Another solution within constraints (decision 4).** Size **M**. It
depends on the engine providing an enumeration of fitting looks.

- `foldAnotherOristudioCpFigure` branches at the top: if the figure has
  constraints, it calls `foldAnotherConstrained`.
- `foldAnotherConstrained`:
  - asks the engine for the next fitting look after the current order, on the
    side shown;
  - folds with that seed into a new handle, as in (c);
  - writes the new order into the record. The constraints are unchanged.
- One undo entry, "Show another solution", as today.
- **The cursor.** Where the figure stands among its fits lives only in
  memory. It goes in a handle-keyed side table,
  `cp-workspace/folded/foldedLayerOrderCursors.ts`, dropped with the handle
  like `foldedFlatScenes.ts:113-121`. It is never saved ("never a case
  number").
- `foldedFigureCycling` branches the same way: hasNext and wrap come from the
  cursor; with no cursor, "Another solution" is enabled when the last count
  is more than 1.
- Fires `fold solution cycled` with a new `constrained: true` property.
- With no constraints, nothing changes: Oriedita parity.

**(h) Properties subtitle.** Size **S**.

- `foldedFigureSubtitle` (`foldedFigureNotice.ts:223-245`) gains a branch for
  a constrained figure: "3 constraints · 2 of 4 solutions", "decided", or
  "Layer constraints need attention".
- Wording is the design's; "solutions", not "cases".
- The figure's Properties sheet *may* gain a text row. The UI brief (§8) notes
  there is no existing row to copy.

### 1.4 Risks

- **R1. The seeded entry's fidelity** (engine). Display depends on Oriedita
  reproducing the seed exactly. The Fold branch measured 1,685 of 1,685 on
  generated states; real Edit files are untested (`product-spec.md` §13).
- **R2. Oriedita refuses figures the Fold solver folds** (Crane, Heart:
  `SameParityAdjacentFaces`). The entry is disabled unless the outcome is
  `Solved` (Q7).
- **R3. Cost of folding twice or three times.** A refold with constraints
  folds Oriedita's default (for the scene), then resolves, then does the
  seeded fold. The iguana's first Oriedita fold takes 0.51 s
  (`product-spec.md` §6.9), so a refold there could take about 1.5 s plus the
  resolve. **Inferred**; measure it in the browser.
- **R4. Pre-existing: undo drift after "Another solution".** Undo restores the
  entry but not the kernel's case, so a reselect or style change redraws the
  undone solution. **Inferred** from `creasePatternSlice.ts:487-500`,
  `:535-545`, `:2784-2790`; not run. Out of scope, but the constrained path
  must not inherit it, which is why every order change gets a new handle.
- **R5. An unconstrained figure stepped to a browsed order.** If Apply is
  pressed with no constraints but a browsed order, the figure becomes
  record-backed. Its "Another solution" then steps the Fold solver's fits,
  not Oriedita's enumeration (Q10).
- **R6. The cursor is lost on reload.** The label falls back to "Another
  solution" until the first press. That is acceptable.

### 1.5 Tests and gates

- **`foldedFigureActions.test.ts`:**
  - the verb sits right after Another solution;
  - it is disabled with each hint (3D, unsolved, no source, newer record);
  - it is present and enabled on a handle-less ready flat figure;
  - it is dropped when `openLayerOrder` is omitted.
- **`foldedFigureMenuItems.test.tsx` and `CpFoldedFigureToolbar.test.tsx`:**
  the hint reaches the menu row and the button title.
- **Store tests, with fake runtime bindings:**
  - Apply records exactly one undo entry;
  - undo restores the old handle;
  - a style change after the undo renders through the **old** handle (the
    regression for R4's mechanism);
  - a stopped Apply leaves the list identical, so no entry;
  - a failed Apply calls `restorePreviousFigure`;
  - Duplicate copies `layerOrder`;
  - Refold with a record calls resolve, then the seeded fold, and writes
    updated `held` flags;
  - Refold `none` keeps the old picture and sets `attention`;
  - Refold to 3D keeps the record;
  - with no record, Refold and Another solution make exactly today's kernel
    calls (the parity guard).
- **Rehydrate:** adopted when the order matches; abandoned and freed when it
  does not; no history or dirty either way.
- **Browser:**
  - kabuto, `solution_sample_1`, and the 850-face iguana fixture;
  - Apply, undo, redo, then a style change after the undo;
  - save, reload, Layer order… (rehydrate);
  - a crease edit, then Refold;
  - Duplicate.

---

## 2. Edit: a crease-pattern selection ("Fold with layer order…")

### 2.1 What exists

- **Viewport bar.** Its `fold` group is the one figure verb on the bar
  (`components/panels/CreasePatternPanel.tsx:2907-2955`):
  - on a phone it is an `action` that can collapse into the overflow;
  - on desktop it is a `ViewportToolbarButton` node;
  - both call `folded.foldModel` (`useFoldedFigures.ts:741-755`, wrapped in
    `runFoldedFigureAction`);
  - `G` reaches the same call (`CreasePatternPanel.tsx:1405-1425`).

  **Verified.**
- **Selection toolbar.** It appears only when the selection is one whole sheet
  (`cp-workspace/CpSelectionToolbar.tsx:80-87`). Its Fold calls
  `foldOristudioCpDocument` **directly**, not through `runFoldedFigureAction`
  (`:177-185`). History is recorded only by the bracket
  (`foldedFigureGesture.ts:27-43`), so this fold is probably not undoable.
  **Inferred**, pre-existing (Q11).
- **Routing.** `resolveFoldRoute(document, scopedLineIds)` is pure and cheap,
  and decides flat, spatial or none (`cp-workspace/folded/foldRoute.ts:73-80`).
  **Verified.**
- **The pre-fold CAMV warning** is inline in `foldOristudioCpDocument`
  (`creasePatternSlice.ts:2002-2079`). **Verified.**

### 2.2 What is missing

- An entry point.
- A fold that exists only for the dialog. It must not create a canvas entry
  that appears and then disappears on Cancel.
- A way to create the figure *with* its record as one undo entry.

### 2.3 Proposed change

Size **M**.

- **One catalog, `cp-workspace/folded/foldBarActions.ts`,** React-free:
  `foldBarActions(t, { canFold, flatRoute, fold, foldWithLayerOrder })`. It
  returns Fold and "Fold with layer order…" as descriptors. Both the viewport
  bar and `CpSelectionToolbar` render it, so the two cannot drift and the
  panel's `fold` group shrinks rather than grows (`max-lines`).
- **Disabled rules:** no foldable selection uses the existing rule. A
  selection that routes `spatial` is disabled with "These creases fold in 3D;
  layer order works on flat folds for now" (§5).
- **A new store action, `prepareOristudioCpLayerOrderFold(lineIds)`.**
  - It runs the same CAMV pre-check: factor
    `confirmFoldWarnings(route, scopedLineIds)` out of
    `foldOristudioCpDocument`, `:2002-2079`.
  - It then folds through `withFoldInFlight('fold', …)` with **no draft
    entry**, as the 3D path already does (`:2083-2092`).
  - It returns a private handle. The caller frees it on Cancel.
- **The hook's `foldWithLayerOrder()`:**
  - opens the dialog on that handle's scene, with `surface: 'edit_pattern'`;
  - on Apply calls
    `runFoldedFigureAction('Fold model', () => foldOristudioCpDocument({ lineIds, layerOrder: applied }))`.
  - That **folds with the seed** into a new entry, with `layerOrder` set,
    through the ordinary flat path (`:2276-2452`), and frees the private
    handle. One undo entry, one `fold attempted` / `fold completed` pair,
    which gains `via: 'layer_order'`.
- **Selection-toolbar Fold.** Route it through `runFoldedFigureAction` while
  in there (Q11).

### 2.4 Risks

- **The private handle can leak** if the dialog is torn down without
  Cancel: on document replace or engine loss. Hold it through
  `retainFoldedFigureHandle`, and have the dialog store release it on close,
  on document replace, and on `onEngineLost`.
- **Two folds on Apply** (the private one, then the seeded one), as in R3.
  Alternatively the seeded fold could reuse the private handle in place. The
  entry is new, so there is no undo hazard here (**Inferred**). That depends
  on the engine offering an in-place entry as well.

### 2.5 Tests and gates

- **`foldBarActions` unit tests:** labels, disabled hints for none and
  spatial, and order.
- **Store:**
  - Cancel frees the handle and leaves the figure list untouched (no entry);
  - Apply adds exactly one figure carrying `layerOrder`, as one undo entry;
  - the CAMV decline path is unchanged (existing tests).
- **`CpSelectionToolbar.test.tsx`:** both verbs; the spatial-disabled hint.
- **Browser:** select a sheet, Fold with layer order…, Apply, undo, redo.

---

## 3. Diagram step and Pose

### 3.1 What exists

| Concern | Seam | Notes |
| --- | --- | --- |
| The stored pose | `diagram/document/diagramDocument.ts:217-262` (`folded-flat` with `foldCase`, `spread`) | **Verified.** |
| The linked source | `diagramDocument.ts:428-445` (`DiagramCpSource`, `remembered`); Show as `renderToShowAs` `:543-568`; `withRememberedPoses` `:574-584` | **Verified.** |
| A Fold-step source | `diagramDocument.ts:466-496`; `DiagramStepPose.tsx:114-131` | Its order is the sequence's: `foldCase` must be 1 (`diagramFile.ts:1424-1428`). **No dialog here.** **Verified.** |
| One-shot capture (Link, Refresh) | `diagram/capture/captureFolded.ts:424-503`; flat branch `:487-502` (`openFold` → `foldToCase` → read → free) | The source is rebuilt from scratch via `storedCpSource` (`:439-449`). A route switch replaces a flat render with 3D (`:314-327`). **Verified.** |
| Refresh | `diagram/capture/stepCaptureActions.ts:212-226` → `captureDiagramStep` → `store/workspaceStore/diagramCapture.ts:297-332` | Passes the stored `render`. **Verified.** |
| Faces on demand | `diagram/capture/stepPaperFaces.ts:77-88` | Re-captures with the stored render. **Verified.** |
| The Pose session | `diagram/capture/captureSession.ts:169-337` (`flat`, `turnOver`, `nextSolution`, `flatPicture`, `heldFlatPicture`) | Holds one flat handle between verbs; `reached` only grows. **Verified.** |
| Pose verbs | `diagram/capture/linkedPose.ts:134-363`; flat pose `:156-183`; flat verbs `:301-348` | **Verified.** |
| The pose controller | `diagram/capture/poseController.ts:282-655`; `run` `:373-425`; commit "Adjust pose" `:399-401`; `trackPose` `:114-125`; source rebuild `linkedSource` `:709-726` | **Verified.** |
| Action catalog | `diagram/actions/diagramLinkedPoseActions.ts:38-54` (ids; `DiagramLinkedPoseVerb` excludes `set-upright`), `:155-288` (build), `:122-143` (`layerOrderLabel`), `:329-359` (`isDefaultRender`) | Verbs refuse rather than disable, which keeps focus. **Verified.** |
| Toolbar | `components/diagram/DiagramLinkedPoseControls.tsx:27-41` (icons), `:97-123` (the pager readout after Previous) | **Verified.** |
| Step pane "Layer order" row | `components/diagram/DiagramStepPose.tsx:149-158`; it shares the open controller through `useOpenLinkedPose` (`diagram/capture/openLinkedPose.ts:22-38`) | The row exists only while the step is open in Pose. **Verified.** |
| Annotations across an order change | `diagram/annotate/annotationCarry.ts:257` compares `foldCase` | **Verified.** |
| Hook | `diagram/capture/useDiagramLinkedPose.ts:185-191` (builds actions), `:242` (label), `:325` (publishes) | **Verified.** |

### 3.2 What is missing

- An entry on the toolbar and the Step pane row.
- A pose request that applies a record.
- A capture path that shows a record's order, for Refresh, re-link and
  paperFaces.
- The record on the source, kept by every source rebuild.
- An annotation-carry rule that knows the order changed.
- Pager behaviour once constrained (decision 4).

### 3.3 Proposed change

Size **L** in total.

**(a) Where the record lives: on the source.** Add
`DiagramCpSource.layerOrder?: string`, a compact JSON
`LayerOrderRecord` (§4.2), stored as `paperFaces` is: one line, not a line per
number (`diagramDocument.ts:697-706`).

- Every source rebuild must carry it:
  - `captureStep`'s `source()` (`captureFolded.ts:439-449`);
  - `linkedSource` (`poseController.ts:709-726`);
  - `storedCpSource` / `readCpSource` (`diagramFile.ts:1341-1355`).
- `DiagramFoldStepSource` never has one.
- **Why the source and not the render.** It survives Show as (crease pattern
  and back) and a flat-to-3D route switch. One record per step matches
  decision 5. Duplicate step copies it.

**(b) Capture.** `CaptureStepRequest` gains `layerOrder?: LayerOrderRecord`
(from the step's source). In the flat branch (`captureFolded.ts:487-502`):

- **Without a record:** exactly today's code (parity).
- **With one:**
  1. `openFold` (Oriedita's default), then read the scene;
  2. `runtime.resolveLayerOrder(...)` (injected, like `fold3d`; §0);
  3. on `fits`: `runtime.foldWithOrder` (or show in place, if the engine
     offers it on the held handle), read the picture, free.
- **The result source** carries the updated record (`held` flags, new order
  witness). `foldCase` is written as the kernel reports it and ignored when a
  record exists.
- **On `none`:** return a new `{ status: 'needs-attention', cause }`. The step
  keeps its picture, as a refused refold does. `sayCaptureOutcome` says "This
  step's layer constraints need attention".
- **On a route switch to 3D:** the record stays on the source, the 3D picture
  is captured, and the step is flagged (Q6).
- **Callers to update:**
  - `refreshDiagramStep` (`stepCaptureActions.ts:212-226`);
  - `stepPaperFaces.ts:83-88`;
  - Show as and Duplicate (`stepCaptureActions.ts:118-200`);
  - `diagramCapture.ts:309-320`.

**(c) Pose.**

- `LinkedPoseRequest` gains `{ verb: 'layer-order'; applied: LayerOrderApplied }`.
- `CaptureSession` gains:
  - `heldFlatScene()`: the held read's `scene`, for the dialog with no refold;
  - `flatWithOrder(document, lineIds, side, seed)`: a new held handle, the old
    one released.
- In `poseLinkedStep`'s `folded-flat` arm, `layer-order` returns the picture
  at the same side, turn and spread. The controller commits with the source's
  `layerOrder` set from `applied.record`, through the same `capturing` and
  `commitDiagramCapture(…, 'Adjust pose')`. One undo step.
- **If a capture is already running,** Apply waits for it, as `commitSpread`
  does (`poseController.ts:556-558`), rather than being refused as busy.
- **Not counted as a pose.** Call `run(request, { tracked: false })`; the
  dialog's own `closed { outcome: 'applied', surface }` event counts it.

**(d) Entries.**

- **Action catalog.** Add `'layer-order'` to `DiagramLinkedPoseActionId`, and
  exclude it from `DiagramLinkedPoseVerb`. It opens a dialog, so it runs
  through `options.run`, like `set-upright` (`diagramLinkedPoseActions.ts:174-203`).
  - The `folded-flat` list places it right after `next-solution`, beside the
    pager (`:260-272`).
  - Disabled: read-only, already covered by the factory; see-through or
    `solutions.none` ("This fold has no layer order"); and a held fold that is
    not ready yet.
  - The `folded-3d` list includes it disabled (§5).
- **Toolbar.** `DiagramLinkedPoseControls` renders it as a word button or an
  icon (design rule 6: a word if the icon cannot say it). Inserting it after
  `next-solution` keeps the pager's readout where it is (`:115-122`).
- **Step pane.** The "Layer order" row (`DiagramStepPose.tsx:149-158`) gains
  a trailing button in a **reserved** slot, so nothing shifts the chevrons or
  the count (rule 7). It runs the same action from `linkedPose.actions`.
- **Binding.** `useDiagramLinkedPose` binds `openLayerOrder`:
  - it calls `controller` to make sure a flat fold is held (the same
    `capturing` path as `holdForPreview`, `:482-497`);
  - it opens the dialog with `scene = session.heldFlatScene()`, the step's
    side, `{ kind: 'diagram', style }`, `paperBoxFrame(scene)` and the
    record;
  - `apply` returns `run({ verb: 'layer-order', applied })`.

**(e) Pager within constraints (decision 4).** Size **M**. It depends on the
engine's look enumeration.

- When the source has a record, ‹ › step through fitting looks:
  `session.nextFit` / `previousFit` over a cursor held in the session.
- `layerOrderLabel` reads `{ n, total, exact }` of fitting solutions, not
  `foldCase`.
- Each step commits "Adjust pose" with the new order in the record.
- **Before that lands,** a constrained step's chevrons refuse with "Step
  through solutions in Layer order…". Interim only.

**(f) Small rules.**

- **Annotations.** `annotationCarry.ts:257` uses `sameLayerOrder(was, is,
  fromSource, toSource)`, which compares the record's order as well as
  `foldCase`. A change of order is then never mistaken for a pure turn.
- **Reset Pose.** `isDefaultRender` (`:335-336`) ignores the record, and Reset
  keeps it (Q4).

### 3.4 Risks

- **R7. Older builds lock constrained steps.** Read-only, carried verbatim.
  Steps without constraints are unaffected. The Diagram has been live since
  the week of 2026-10-11, so real files will meet this (`surfaces.md` §6.2).
- **R8. Engine work inside a capture.** Two engines are called inside one
  capture, the CP kernel and the Fold engine; each may run in its own worker.
  Stop has to reach both: today `runStepFold` binds only the CP kernel's run
  (`diagramCapture.ts:212`). **Unknown** how the Fold engine's budget and
  cancel are wired; that is the engine slice's.
- **R9. Refresh All.** On a diagram with many constrained steps, each capture
  re-solves. The cost is per-step resolve (median 11 ms to open, p95 0.74 s
  natively, `product-spec.md` §6.9) plus a second Oriedita fold.
  **Inferred**; measure it on a real diagram.
- **R10. A shared step's frame.** The record's points are in the paperFaces
  frame: CP units about the centre of the folded paper's box
  (`capturePaperFaces.ts:66-76`). A crease edit that changes the region's
  outline would shift every point. Rare, because a step's scope is a whole
  sheet, but the result is "gone" or "split" flags, not a wrong order.

### 3.5 Tests and gates

- **`captureFolded.test.ts`** (fake runtime):
  - no record makes exactly today's calls;
  - a record makes resolve, then the seeded fold, and the result source
    carries the updated record;
  - `none` gives `needs-attention` and no picture change;
  - a route to 3D keeps the record.
- **`linkedPose.test.ts` and `poseController.test.ts`:**
  - `layer-order` commits once as "Adjust pose", untracked;
  - the busy wait;
  - engine loss during Apply gives a discarded capture and no commit.
- **`diagramLinkedPoseActions` tests:**
  - placement after next;
  - disabled hints (see-through, 3D, read-only);
  - absent for crease pattern, simulated and fold-step.
- **`DiagramStepPose` test:** the row's button exists and does not move the
  chevrons; find by role and name.
- **`annotationCarry` test:** a record change with an equal `foldCase` is not
  carried.
- **Browser:**
  - a linked step: Apply, undo, redo;
  - Refresh after a crease edit inside the region;
  - Show as Crease pattern, then back;
  - Duplicate step.

---

## 4. Saved data and versions

### 4.1 What exists

- **The `.osf`.** Schema 8, reader 11. Reader 11 is the Fold workspace's
  sequences, and it is in this base (`lib/nativeProjectFile.ts:62-92`,
  `:179-189`). **Verified.** The reader-10 collision noted in `surfaces.md`
  §6.1 is resolved here.
- **Edit figures.**
  - The writer spreads `...entry` with `handle: null`
    (`nativeProjectFile.ts:934-943`).
  - The reader builds an explicit literal, "**This function is the drop**"
    (`:958-1031`).
  - So an older build silently drops a new figure field and saves without it.

  **Verified.**
- **The CP document's `extensions` bag:**
  - read at load (`validateDocumentV1`, `nativeProjectFile.ts:1453`);
  - stored as `oristudioCpDocumentExtensions` (`projectSlice.ts:1189`);
  - written back verbatim (`projectSlice.ts:1821` → `nativeProjectFile.ts:930`).
  - It has done this since `af6248937` (2026-07-17, in v0.2.0 and later).

  **Verified.**
- **The Diagram.**
  - Key sets per source kind and per render mode (`diagramFile.ts:813-846`,
    `:869-876`).
  - An unknown key, at any depth, makes the step a newer build's: locked,
    carried verbatim (`:1123-1131`, `:1189-1218`, `:1006-1019`).
  - A locked step "can be moved or deleted, never edited"
    (`diagramDocument.ts:1283-1288`).
  - A `formatVersion` above this build's opens the whole diagram read-only
    (`diagramFile.ts:21-25`, `:226-258`).
  - `paperFaces` is a compact JSON string with its own key-set check
    (`diagram/document/paperFacesFile.ts:15-58`).

  **Verified.**
- **Fold's precedent.** `FoldCompletionChoice { faces: SheetPoint[]; orders:
  [f, g, ±1][] }`, FOLD triples over witnesses
  (`fold/document/foldSequenceDocument.ts:729-748`). The Rust `WitnessOrder`
  (`crates/oristudio-fold/src/witness.rs:1-45`). Fold's sheet frame is unit
  sized and y-up (`foldSequenceDocument.ts:49-53`). **Verified.**

### 4.2 The record, shared by both hosts

`lib/layerOrder/layerOrderRecord.ts`: pure, with no React, no store and no
engine. Size **S**.

```ts
/** A point on the paper, in the host's paper frame (§4.3). */
export type PaperPoint = readonly [number, number];
/** FOLD faceOrders over `faces`: [f, g, s], s = 1 when f lies on the side g's front faces, -1 on its back. */
export type PaperFaceOrder = readonly [number, number, 1 | -1];

export interface LayerOrderRecord {
  /** One interior paper point per face named, in the order first named. */
  faces: PaperPoint[];
  /** The user's constraints, in the order made: "subject in front of / behind object", paper-relative. */
  constraints: PaperFaceOrder[];
  /** Indexes into `constraints` that the order shown does not honour (gone, split, clashing after an edit). */
  unheld: number[];
  /** Why the record needs attention, when it does; absent when it does not. */
  attention?: 'conflict' | 'route-3d' | 'detached';
  /** The order shown at Apply: its pairs that the creases alone leave free (§4.6). */
  order: PaperFaceOrder[];
}
```

- **On disk:** one compact string,
  `{"v":1,"faces":[…],"constraints":[…],"unheld":[…],"order":[…]}`, with keys
  written in that fixed order. Points are rounded to 1e-9 of the sheet
  extent, so a round trip is byte-stable.
- **The reader** returns `{ record, json } | NEWER | null`, on the
  `readPaperFaces` pattern:
  - an unknown key or `v > 1` is `NEWER`;
  - damage is `null`.
- **Never a case number.** `foldCase` and `current_fold_case` stay where they
  are, and with a record present they mean nothing.

### 4.3 Paper frames

`PaperFrame { toCp(p): Point; fromCp(p): PaperPoint }`:

- **Edit: `EDIT_PAPER_FRAME`, the identity.** Crease-pattern model
  coordinates, y-down: the frame of `sheet_points` and `sourceBounds`.
  Absolute coordinates match how Edit finds its source: refold reselects by
  the absolute `sourceBounds`.
- **Diagram: `paperBoxFrame(scene)`.** CP units about the centre of the folded
  paper's box, exactly `flatPaperFaces`' frame (`capturePaperFaces.ts:66-76`).
  - Steps are found again after a move (`regionIdentity.ts`), so their points
    must be move-invariant.
  - Zoom imprints already find faces by points in this frame
    (`zoomImprint.ts:556-565`, as cited in `surfaces.md` §3.4). The Step pane
    can therefore name a constraint's faces from the stored `paperFaces`
    without a fold.
- **Into the engine's frame.** The conversion to the Fold engine's unit y-up
  sheet frame happens once, at the engine seam. Hosts never see it.

### 4.4 (a) An Edit figure

- **In memory.** `OristudioCpFoldedFigureEntry.layerOrder?: LayerOrderRecord
  | null` (`engine/oristudioCpTypes.ts:1115-1267`).
- **In the file: the CP document's `extensions` bag**, not the figure:

```json
"extensions": {
  "oristudio.foldedFigureLayerOrders": {
    "<figure id>": { "record": "{\"v\":1,…}", "figureKey": "<sourceFingerprint>|<current_fold_case>" }
  }
}
```

- **Writer.**
  - `nativeFoldedFigures` strips `layerOrder` from each entry.
  - The project writer (`projectSlice.ts:1821`) writes the bag:
    `{ ...loadedBag minus our key, [our key]: built from the live figures }`.
  - Foreign keys are kept.
- **Reader.** At install (`projectSlice.ts:1189`):
  - attach each record to its figure;
  - if the figure is missing, drop the record: it went with its figure;
  - if the record reads `NEWER`, keep the raw value, and the entry's verbs say
    "made with a newer Ori Studio".
  - if `figureKey` no longer matches the figure, set `attention: 'detached'`
    and keep the constraints. This catches an older build that pressed
    Another solution or refolded.
- **Why not a field on the figure.**
  - Builds up to the current `main` drop it silently (§4.1), and lose it on
    their next save.
  - Raising the reader to 12 when any figure carries a record fixes that, but
    makes every older build refuse the whole file.
  - The bag loses nothing and needs no bump. Its cost is the `figureKey`
    detach check.
  - Owner decision, Q1.
- **Verified vs Inferred.** The carry mechanism is **Verified**. That
  `sourceFingerprint|current_fold_case` catches every way an older build can
  change the order is **Inferred**:
  - Another solution changes the case;
  - a refold changes the fingerprint, and is offered only when stale;
  - Flip and style do not change the order;
  - Duplicate makes a new id, whose copy has no record.

### 4.5 (b) A Diagram step

- **Field.** `DiagramCpSource.layerOrder?: string`. `SOURCE_KEYS.cp` gains
  `'layerOrder'` (`diagramFile.ts:815`).
- **Reading.** `readCpSource` reads it through the codec. `NEWER` makes the
  step locked, like `paperFaces` (`:1006-1019`). Damage drops it alone; the
  step keeps its picture, and the drop is said once.
- **Version consequences:**
  - no `DIAGRAM_FORMAT_VERSION` bump;
  - no `.osf` reader bump;
  - in builds without the key, **only steps carrying a record lock**: they
    show their stored picture, read-only, can be moved or deleted, and are
    written back verbatim.
- **Leave `CP_RENDER_FIELDS['folded-flat']` unchanged.**

### 4.6 Witness size

- **The problem.** A whole order of a deep figure is large:
  - all overlapping pairs could be tens of thousands for the 250-layer
    iguana (**Inferred**, not measured);
  - written into a pretty-printed `.osf`, or inside the 2 MB-guarded Diagram
    file (`captureFolded.ts:95-96`).
- **Proposal.** Store only the order's pairs that the creases *alone* leave
  free. Those are the only pairs that differ between fits, so they fully
  determine "closest to the saved order".
  - The session knows the forced set: `import_session` reports `forced`.
- **Gate:** measure record bytes per figure on the cpoogle corpus (p50, p95,
  max) before merging the file format. Fall back to the full order where the
  free set cannot be computed (Q3).

### 4.7 Migration

- **None.** `current_fold_case` and `foldCase` keep today's meaning and
  today's code paths when no record exists. That is Oriedita parity,
  untouched.
- **The first Apply writes the record.** Nothing converts an index into a
  record. An index names a moment in an enumeration, not an arrangement
  (`surfaces.md` §3.3).

### 4.8 Tests and gates

- **`layerOrderRecord.test.ts`:**
  - byte-stable round trip;
  - `NEWER` for an unknown key and for `v: 2`;
  - `null` for damage (an index out of range, `s` not ±1, a non-finite
    point).
- **`nativeProjectFile.test.ts`:**
  - the round trip puts the record in `document.extensions` and back onto the
    entry;
  - foreign extension keys survive;
  - simulate an older build by reading with today's `validateFoldedFigure`
    and re-writing: the bag is intact;
  - detach detection;
  - a record for a missing figure is dropped;
  - the existing round-trip test still passes.
- **`diagramFile.test.ts`:**
  - a source with `layerOrder` round-trips byte for byte;
  - a `v: 2` record locks its step and is written back unchanged;
  - a fold-step source with `layerOrder` is a newer build's;
  - `diagramFileSize.test.ts` gains a constrained fixture.
- **A gate on the corpus measurement** above.

---

## 5. 3D figures and steps: disabled, with the reason

Size **S** for all of them.

| Where | Today | Change | Reason text (wording is the design's) |
| --- | --- | --- | --- |
| Edit 3D figure, toolbar and menu | No layer-order verb other than Another solution (`foldedFigureActions.ts:622-639`) | Same `'layer-order'` command, `disabled: true`, `hint` | "Layer order works on flat folded models for now" |
| Edit selection that routes spatial | Fold folds in 3D (`creasePatternSlice.ts:2083`) | "Fold with layer order…" disabled, `hint` (`foldBarActions`) | "These creases fold in 3D; layer order works on flat folds for now" |
| Diagram step shown `folded-3d` (Pose toolbar) | No layer-order verbs (`diagramLinkedPoseActions.ts:276-284`) | `'layer-order'` in the `folded-3d` list, disabled, `hint` | as for Edit's 3D figure |
| Step pane for a 3D step | No "Layer order" row (`DiagramStepPose.tsx:149`) | **No row added.** The toolbar's disabled verb carries the reason; a row of nothing but a reason would be noise (rule 3). | n/a |
| A constrained flat figure or step whose creases now fold in 3D | n/a | The record is kept; `attention: 'route-3d'`; the subtitle or capture outcome says so | "These creases now fold in 3D; the layer constraints wait until they fold flat" |

Tests: the catalog tests in §1.5 and §3.5 assert each disabled hint.

---

## 6. Analytics

**Existing**, all **Verified**:

- `fold attempted` / `fold completed` (`events.ts:1499-1500`);
- `fold solution cycled` (`:1501`);
- `folded figure rehydrated` (`:1708`);
- `fold choice offered` (`:1752`, Fold only);
- `diagram picture posed` with `next_solution` / `previous_solution`
  (`:390-401`, `:1782`; `poseController.ts:114-125`).

None goes through `handleMenuAction`.

**Host-side additions.** Enums and buckets only.

- **The dialog events** carry `surface` from the request:
  `edit_figure | edit_pattern | diagram_step | pose`. `pose` means the
  toolbar; `diagram_step` means the Step pane row.
- `layer constraints need attention`:
  - `surface` (`edit_figure | diagram_step`);
  - `cause` (`conflict | gone | split | route_3d | detached`);
  - `broken_count_bucket`.
  - Fired by refold, Refresh, and load-time detach detection.
- `fold solution cycled` gains `constrained: boolean`.
- `folded figure rehydrated` gains `mode: 'flat' | 'spatial'`.
- `fold attempted` / `fold completed` gain `via: 'layer_order'` for "Fold with
  layer order…".
- **Applying through Pose is not counted as `diagram picture posed`.** The
  request runs with `tracked: false`, so it is not counted twice.

---

## 7. Open questions for the owner

1. **Edit's saved constraints: the `extensions` bag or a field plus reader
   12?**
   - **Recommended: the bag.** Older builds carry it, no file is refused, and
     a detach check covers an older build's edits.
   - **The alternative:** builds older than this one refuse any file with a
     constrained figure.
2. **Diagram: the record on the step's source (recommended) or on the
   `folded-flat` render?** The source keeps it through Show as and a 3D route
   switch. Either way, older builds lock only the constrained steps.
3. **Witness size.** Is storing only the creases' free pairs acceptable, with
   a corpus measurement as the gate? Or should the full order always be
   stored, as Import CP's `orderJson` does?
4. **Reset Pose on a constrained step.** Keep the constraints and only reset
   the turn and side (recommended), or clear them?
5. **Apply and the side.** The dialog has its own Front/Back switch. Does
   Apply set the host's side to the side the dialog shows (Edit's
   `model.state`, the step's `side`)? Or is the dialog's switch only a lens
   (recommended)?
6. **A constrained step whose creases now fold in 3D.** Capture the 3D picture
   and flag the step (recommended)? Or keep the old flat picture until the
   user acts?
7. **Figures Oriedita could not order** (`Contradiction` or `NoSolutions`).
   The Fold solver may find an order there, but display goes through
   Oriedita's seeded entry. Disabled in v1 (recommended)?
8. **Reopened, unconstrained flat figures.** Should the new on-demand flat
   rehydrate also re-enable Another solution and Duplicate on them (a separate
   small PR)?
9. **A keyboard shortcut** for "Layer order…" or "Fold with layer order…",
   for example Shift+G?
10. **Apply with no constraints but a browsed order.** Does it save a
    record, and so leave Oriedita's enumeration for that figure? Or is it
    disallowed, with Apply disabled until there is a constraint or a change?
11. **Selection toolbar Fold.** It seems to record no undo entry today
    (§2.1, **Inferred**). Fix it in passing?
12. **Undo after "Another solution."** The undo drift in R4 is pre-existing
    (**Inferred**). Take it as its own fix: reconcile the order on undo, or
    give each step a new handle.

---

## 8. Suggested PR split for this slice

Every PR is off the dialog branch (from #476). The engine dependencies named
are the engine slice's deliverables.

| # | PR | Size | Depends on | Gates |
| --- | --- | --- | --- | --- |
| H1 | **The record and the host contract**: `layerOrderRecord.ts` (types, codec, `NEWER`), `PaperFrame` adapters, `layerOrderDialogStore` and an empty `LayerOrderModal` shell at the app root | S | none | unit tests; lint and typecheck |
| H2 | **File formats**: Edit's record in the CP document `extensions` bag (writer, reader, detach, orphan), entry field; Diagram `DiagramCpSource.layerOrder` (key set, reader, lock); fixtures; size measurement on cpoogle | M | H1 | `nativeProjectFile` and `diagramFile` round trips; size gate |
| H3 | **Edit display and Apply**: kernel binding `foldWithOrder`; `applyOristudioCpFigureLayerOrder` (new handle, one undo entry); catalog entry with `hint`, including the 3D disabled state; on-demand flat rehydrate; Duplicate carries the record; subtitle; analytics | M–L | H1, H2; engine "show this order" entry; dialog v1 | store tests including the undo-then-restyle regression; catalog tests; browser on kabuto, `solution_sample_1` and the iguana |
| H4 | **Edit refold with constraints**: resolve, then the seeded fold; held and unheld flags; `attention`; stale "Layer order…" commits "Refold with layer order"; route-3D keeps the record | M | H3; engine `resolveLayerOrder` | store tests; browser: edit creases and refold |
| H5 | **Fold with layer order…**: `foldBarActions` shared by the viewport bar and the selection toolbar; `prepareOristudioCpLayerOrderFold`; CAMV helper factored out; selection-toolbar Fold made undoable (Q11) | M | H3 | catalog and store tests; browser |
| H6 | **Diagram and Pose**: capture path with a record (Refresh, Show as, Duplicate, paperFaces); `CaptureSession.heldFlatScene` / `flatWithOrder`; `layer-order` pose request; toolbar and Step pane entries including the 3D disabled state; annotation-carry rule; `needs-attention` outcome | L | H1, H2; engine resolve and show entries; dialog v1 | `captureFolded`, `linkedPose`, `poseController` and actions tests; browser on a linked diagram |
| H7 | **Pagers within constraints** (decision 4): Edit "Another solution" through fitting looks with the in-memory cursor; Diagram ‹ › through fits; labels | M | H3, H6; engine look enumeration | store and actions tests; browser |

H3 and H6 can run in parallel once H2 lands. H7 is last, because it is the
only host work that waits on an engine capability the dialog itself does not
need.
