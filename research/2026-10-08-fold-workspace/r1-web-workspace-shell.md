# Fold workspace: how a new workspace plugs into apps/web, and the patterns it must follow

## Summary

- **Registering a workspace is a known, repeated job.** References was added in commit `da6d19a04`, which touched about 78 files. Most were locales and tests; about 30 were code. Diagram followed the same path on PR #436 (`6f75a0200`, "Registers Diagram everywhere References is registered"). Fold should copy that list. Nothing is needed in `apps/tauri`: the macOS menu is built from the web menu definition (`apps/web/src/menus/nativeMenu.ts:18-24`), and a grep of `apps/tauri/src-tauri/src` finds no workspace ids. VERIFIED.
- **Fold is an authoring workspace, not a reader.** Simulate and References share a read-only capability mask with undo turned off (`apps/web/src/lib/workspaceCapabilities.ts:1086`, `historySlice.ts:474`). Fold needs its own history, the way Diagram has one: a snapshot history, an undo/redo branch per editing context, and its own `historyCountForContext` entry. VERIFIED (Diagram's version is at 31e1d6d84).
- **Persistence.** A fold sequence belongs in the project as a document of its own, beside the crease pattern and the design tabs. Diagram set the pattern: a top-level `workspace.diagram`, its own `formatVersion`, a lenient reader, and a raised `minimumReaderSchemaVersion` (31e1d6d84 `nativeProjectFile.ts`). VERIFIED. The current v8 reader rebuilds `workspace` from named fields only, so an unknown key is silently dropped (`nativeProjectFile.ts:1274-1296`). VERIFIED.
- **Engine.** Copy the precrease planner's shape, not the CP engine host:
  - a new pure Rust crate plus a `-wasm` bridge;
  - a Comlink worker built on lazy `init()`, a `call()` wrapper and `{code, message}` error envelopes;
  - a reference-counted runtime under `store/workspaceStore/`;
  - wasm in the webview on desktop as well, so no Tauri code.

  The document stays plain data in the store; worker-side state is a cache that can be rebuilt by replaying the steps.
- **Canvas.** Don't add a mode to `CreasePatternWebglCanvas.tsx` (4320 lines). Build a small surface that takes props and sits on the `CpRenderer` seam, as `ReferencesCpView` does (`ReferencesCpView.tsx:111-125`). VERIFIED.
  - Drawing a folded form with layer order already works end to end: the kernel-style paper scene (faces plus subface stacks listed top to bottom) goes through `foldedFlatPaperScene` → `PaperScene` → `foldedSceneLocalGeometry` → `renderer.setFolded` with per-vertex depth. Diagram consumes the same `PaperScene`.
  - **Missing pieces:** picking a face or a layer stack on a *flat* folded form, and snapping to the folded form's visible features. Both are small pure functions over that same face/subface data.

---

## Workspace touchpoints

The table lists what References and Diagram touched, checked against the current tree. Line numbers are on this branch (`a96961959`). All rows are VERIFIED unless marked.

| Concern | File:line | What Fold adds |
|---|---|---|
| Workspace id and definition | `apps/web/src/workspaces/workspaces.ts:1,7,8,11-40` | `'fold'` in `WorkspaceId`; `commandId: 'view.fold'`; `primaryPanelId: 'fold'`; a definition in rail order |
| Panel → workspace map | `workspaces.ts:46-61` | `fold`, plus any side panes (e.g. `fold-steps`, `fold-view-controls`) |
| Command → workspace | `workspaces.ts:82-98` | `case 'view.fold'` |
| Editing context | `apps/web/src/workspaces/editingContext.ts:13-22, 37-45` | `'fold'` in `EditingContext` and in `STATIC_PANEL_CONTEXTS` |
| Route paths | `apps/web/src/routing/paths.ts:17-19, 33-44, 54-68` | `FOLD_PATH = '/fold'`, `workspacePath`, `parseWorkspacePath` (both switches are exhaustive) |
| Router | `apps/web/src/routing/appRouter.tsx:144-146` | `{ path: 'fold', element: <WorkspaceRoute workspace="fold" /> }`. No guard is needed: "every surface stands on its own" (`appRouter.tsx:34-46`), so Fold should create a blank sheet for itself the way Edit does |
| "Workspace viewed" event | `apps/web/src/routing/WorkspaceRoute.tsx:30`; `analytics/events.ts:20` | Add `'fold'` to `WorkspaceScreen`; the event then fires automatically |
| Dock layout | `apps/web/src/store/layoutStore.ts:105-112` (`ALL_LAYOUT_SCOPES`), `:181-219` (`WORKSPACE_SIDE_PANES`), `:398-417` (`applyDefaultLayout` switch), `:469-477` (the References builder to copy) | A `fold` scope, a side-pane spec, and `applyFoldLayout`. `LAYOUT_VERSION` (`:26`) needs no bump; `reconcileSidePanes` repairs older layouts |
| Panel registry | `apps/web/src/components/panels/PanelComponents.tsx:20-38` | `fold: FoldPanel` plus the side panes. The error boundary is added automatically (`:46-48`) |
| Touch drawer | `apps/web/src/components/WorkspaceViewDrawer.tsx:29-34` | A body for each new `SidePaneId`. A missing one is a compile error |
| Workspace rail | `apps/web/src/components/WorkspaceShell.tsx:59-64` (icons), `:79-90` (tooltip), `:100-111` (phone tab label) | All three are exhaustive switches or records over `WorkspaceId` |
| Shell header CSS | `apps/web/src/App.css:1146-1149` | Add `[data-workspace='fold']` to the dock header-height rule (Diagram changed it to an `:is()` list so the stylesheet ratchet holds) |
| Menu action ids | `apps/web/src/commands/menuActions.ts:36-139`, `:354-363` (`VIEW_PANEL_ACTIONS`) | `'view.fold'` → `'fold'`. Primary verbs (valley, mountain, step back/forward) should also be ids here so the `command invoked` chokepoint tracks them (`:819-828`) |
| Menu bar | `apps/web/src/menus/menuDefinition.ts:183-194` | A View row. A `Fold` top-level menu is optional; `menuHasVisibleItems` drops a menu whose items are all hidden (`menuVisibility.ts:31-35`) |
| Capabilities | `apps/web/src/lib/workspaceCapabilities.ts:62-70`, `:643-672`, `:1086-1140` | `view.fold`, plus a Fold arm in `maskCapabilitiesForContext` that hides `cp.*`, `optimize.*` and `insert.*` and the tree's `edit.*` but keeps undo/redo **enabled** — not the `READ_ONLY_CONTEXTS` arm |
| Undo depth | `apps/web/src/store/workspaceStore/capabilities.ts:36-49` | A `fold` branch. Diagram generalises this to `WorkspaceHistoryCounts` at 31e1d6d84, so add `fold` there |
| Undo/redo dispatch | `apps/web/src/store/workspaceStore/slices/historySlice.ts:462-474, 626-638` | `if (context === 'fold') { await get().undoFold(); return; }` placed before the read-only bail-out |
| Store slice | `store/workspaceStore/types.ts:1833-1843`, `store.ts:29-39` | `FoldSlice` composed into `WorkspaceState` |
| Project established | `store.ts:94-102` | Count a fold sequence as a real document |
| Landing after open | `store/workspaceStore/landingWorkspace.ts:20-27` | "A project with only a fold sequence lands on Fold" (Diagram added the same arm) |
| Keyboard scope | `keyboard/shortcuts.ts:24` (`ShortcutScope`), `:64-80` (id union), `:87` (`ShortcutTarget`), `:1115-1121` (precedence), `:1128` (`CONDITIONAL_SCOPES`) | A conditional `fold` scope and a `FOLD_SHORTCUTS` table |
| Keyboard runtime | `keyboard/shortcutRuntime.ts:57, 59-66, 146-165, 188-206, 226-228`; `shortcutDispatcher.ts:61, 206-209`; `i18n/shortcutLabels.ts` | An executor slot, register/run functions, a push onto the scope stack, a dispatcher case and labels |
| Viewport keys | `shortcutRuntime.ts:35, 70-74` | `viewportSurfaceForContext` sends any unknown context to `'tree'`. Either add a `'fold'` viewport surface (Diagram added `'diagram'`) or let the fold scope own zoom and fit, as References does |
| Analytics unions | `analytics/events.ts:20, 326-331, 509-515` | `'fold'` in `WorkspaceScreen`, `PaperExportSurface` and `ContextMenuSurface`, plus new events (document them in `docs/analytics.md`) |
| i18n | `public/locales/{9 locales}/{common,menu,panels,tools}.json`, `.hashes.json` via `i18n:stamp` | Rail, tab, View menu, capability strings and shortcut labels |
| Project file | `lib/nativeProjectFile.ts:219-284, 558-606, 653-690, 1274-1296`; `slices/projectSlice.ts:1616-1627, 1935-1941` | See the next section; the sequence must be threaded through **both** writers and the reader |
| Wasm build | `apps/web/package.json:7-14` | `build:oristudio-fold-wasm`, added to the `build:wasm` chain (CI `ci.yml:111`, the deploy workflows and Tauri's `beforeBuildCommand` all run that chain) |
| Tests that list every workspace or context | `workspaces.test.ts:9-22`, `paths.test.ts`, `layoutStore.test.ts`, `editingContext.test.ts`, `PanelComponents.test.tsx`, `designKinds/capabilityMask.test.ts`, `designKinds/registry.test.ts`, `menuActions.test.ts`, `menuDefinition.test.ts`, `shortcutRegistry.test.ts`, `shortcutRuntime.test.ts`, `workspaceCapabilities.test.ts`, `WorkspaceShell.test.tsx`, `WorkspaceViewDrawer.test.tsx` | Each was edited by the References or Diagram registration commits |

Things that need **no** change (VERIFIED):
- PWA routes (`pwa/swRoutes.ts`).
- The service-worker precache. `vite.config.ts:210-222` finds every emitted worker and `.wasm` by bundle type or file extension.
- `scripts/setup-worktree.sh`, which copies all of `apps/web/src/generated` (lines 104-119).
- The Tauri shell.

**Name collisions (VERIFIED).** "Fold" already names several things:
- `artifacts.fold` holds FOLD-format artifacts (`nativeProjectFile.ts:263-268`).
- `file.exportFold` is the `.fold` export.
- `lib/foldCancellation.ts` and `foldArtifactResource.ts` exist.
- Edit has a "Fold" verb (`ReferencesViewportToolbar.tsx`: "It sits where Fold sits on the Edit bar").
- References has a `cp-workspace/references/fold/` folder.

Use `fold` only for the WorkspaceId, the route and the primary panel. Name the document, engine, slice and artifact `foldSequence` / `fold-sequence`. INFERRED recommendation.

**Where the code lives.** Diagram put its pure modules in `apps/web/src/diagram/{document,actions,…}` and its components in `components/diagram/`, with thin panels in `components/panels/Diagram*Panel.tsx` (31e1d6d84 file list). Fold should mirror that: `src/fold/` and `components/fold/`. AGENTS reserves `cp-workspace/<concern>/` for code tied to the CP workspace. INFERRED.

---

## Document & persistence

### How workspace state is persisted today (VERIFIED)

| Kind of state | Where it lives | Evidence |
|---|---|---|
| Dock arrangement | localStorage, per workspace scope, gated by `LAYOUT_VERSION`; never in the `.osf` | `layoutStore.ts:26, 81-98, 637-650` |
| Design documents | `workspace.designs[]` as a generic `{kind, text, format}` payload plus `viewState`; designs of unknown kinds are kept verbatim in `unknownDesigns` and written back | `nativeProjectDesigns.ts:15-40`; `nativeProjectFile.ts:245-261, 460-475` |
| The Edit crease pattern | `workspace.creasePattern` under the reserved id `'crease-pattern'` | `nativeProjectDesigns.ts:53` |
| A reader's view of the crease pattern (References) | `creasePattern.viewState.references` — additive, no schema bump | `nativeProjectFile.ts:176-190` |
| Derived, disposable caches | `artifacts.references` (plans per sheet), thrown away when its key no longer matches | `nativeProjectFile.ts:269-283` |
| A project-level document (Diagram, PR #436) | `workspace.diagram`, with its own `DIAGRAM_FORMAT_VERSION = 1` | 31e1d6d84 `diagramDocument.ts`, `nativeProjectFile.ts` |
| Forward-compatibility bags | file-level `extensions` and per-document `extensions`, carried through on save | `nativeProjectFile.ts:341-357, 1295` |

**Versioning conventions:**
- `NATIVE_PROJECT_SCHEMA_VERSION = 8` (`:72`).
- `minimumReaderSchemaVersion` is the field that makes an older build refuse a file and say why (`:221-230, 507-517`).
- Diagram added `NATIVE_PROJECT_READER_VERSION = 9`. A file containing a diagram stays schema 8 but asks for reader 9, so an older build refuses it instead of opening it and deleting the diagram on its next save.
- The writer pretty-prints (`JSON.stringify(written, null, 2)`, `:474`). That is why Diagram stores scenes as one compact JSON string (`sceneJson`) and the CP types avoid persisting large render models (`oristudioCpTypes.ts:650-655`).

### Recommendation for the fold sequence (INFERRED)

1. **Add `workspace.foldSequence`** as a top-level field beside `diagram`, carrying its own `formatVersion`. Use Diagram's three reader rules (31e1d6d84 `diagramFile.ts:1-26`):
   - malformed parts are dropped;
   - unknown kinds are kept verbatim;
   - a document from a newer build opens read-only.

   One fold-specific twist: steps form a chain. An unknown op kind (say, a newer build's `inside-reverse`) means no state after it can be computed. That step and **every step after it** must be kept verbatim and locked; the steps before it stay usable.
2. **Raise `minimumReaderSchemaVersion` whenever a sequence is present**, as Diagram does. Otherwise a current build drops the key on re-save (`:1274-1296` builds `workspace` from named fields). The alternative is to store it under `extensions.foldSequence`, which older builds already carry through. That degrades more gently (older builds open the project and keep the sequence without showing it), but it differs from Diagram. See the open questions.
3. **What the document holds:**
   - the initial sheet;
   - an ordered list of `{ id, op: { kind, ...params } }` steps, with stable step ids so Diagram can link to them;
   - each op's input as the user gave it (axiom inputs and the chosen fold line in that step's folded frame) and the layer selection.

   The resolved crease pattern and the folded state after each step are **derived**. If caching is wanted, put them in `artifacts.foldSequence`, keyed by engine version and a hash of the step prefix, and disposable like `artifacts.references`.
4. **Thread the sequence through every path the diagram goes through** (31e1d6d84 `projectSlice.ts` diff):
   - both writers: `createNativeProjectFile` (`projectSlice.ts:1616`) and `createNativeCreasePatternProjectFile` (`:1940`);
   - the load install;
   - discarding it on New or when another project opens;
   - a load path for a project that holds only a fold sequence;
   - `dirty` handling that compares against the document as written, so an edit made while the save dialog is open stays dirty;
   - never saving it over an `.ori` or `.orh` file. Diagram added `keepsOriedita = !forceSaveAs && get().diagram === null`.
5. **Camera.** Persist it as document state, validated with `validateUserCamera` (`renderer/camera.ts:304`). Edit treats its camera as document state for the reasons given at `nativeProjectFile.ts:166-175`.

### Undo and redo (VERIFIED pattern, INFERRED application)

`snapshotHistory.ts:13-86` is the shared past/future stack, capped at 100 entries, used by BP and by Diagram (`diagramSlice.ts` at 31e1d6d84 imports `recordSnapshot`, `undoSnapshot` and `redoSnapshot`).

For Fold, snapshot the **sequence document** (the steps plus the step being viewed), not engine state. Because engine results are cached by step prefix, undoing a fold just shows an earlier cached state; nothing is recomputed. Wire it through `historySlice` by editing context and through `historyCountForContext`, as Diagram does. Mark `dirty: true` on every recorded edit; slices already do this, e.g. `creasePatternSlice.ts:719`.

---

## Engine pattern

### The three patterns in use (VERIFIED)

1. **Engines that hold documents, managed by `engines/engineHost.ts`.** Covers `treemaker`, `oristudio-cp` and `oristudio-bp` (`:35-43`).
   - One literal `new Worker(new URL(...))` per engine (`:58-92`).
   - Crash detection through `attachWorkerDiagnostics`, and `onEngineLost` so `documentRegistry` can put documents back to rest (`:112-167`).
   - CP runs natively through Tauri on desktop (`:65-75`; `apps/tauri/src-tauri/src/cp_engine.rs:1-14`), with a command manifest kept in step by a parity test.
   - Its doc comment says this host is **only** for persistent engines that hold documents (`:24-33`).
2. **Reference-counted service runtimes.** `simulatorRuntime.ts:7-22` (retain/release; last one out terminates) and `precreaseRuntime.ts:10-21`.
   - `precreaseRuntime.ts` adds `onPrecreaseClientLost` and `whilePrecreaseClientAlive`, which races a call against worker loss because a terminated worker never settles Comlink promises (`:28-65`).
   - Precrease runs as wasm in the webview on desktop too (`:16-18`).
   - Its worker carries planner handles across calls and is designed for time-budgeted chunks (`close(budget_ms)`), with every argument validated at the boundary (`workers/precreaseWorker.ts:1-21`).
3. **A worker spawned for one run and then terminated.** `cpExactSolveWorker.ts:1-31`. Cancelling means terminating, because a cooperative flag would only be read at the next checkpoint, up to 7.8 s later.

**Shared conventions:**
- Lazy `ensureReady()` and a `call()` wrapper that turns exceptions into `WasmErrorEnvelope {code, message}` (`oristudioCpWorker.ts:99-140`).
- Large geometry moves as transferables (`:186-190`).
- An expected refusal resolves as `{status:'refused', refusal}` rather than throwing (`:329-333`).
- Strings that cross the boundary are stable codes, never sentences, because the i18n checks cannot see Rust literals (`oristudioCpTypes.ts:656-658`).
- Cooperative cancellation (`lib/foldCancellation.ts`) needs `SharedArrayBuffer` plus cross-origin isolation on the web and degrades to "unavailable" without them (`:52-60, 76-87`).

### Recommendation for the fold-sequence engine (INFERRED)

- **Crates.** `crates/oristudio-fold` (pure Rust, typed errors, no wasm) and `crates/oristudio-fold-wasm`, mirroring `oristudio-precrease` / `-wasm`. Note that `oristudio-precrease/src/construct.rs:1-73` already derives all seven Huzita–Justin axioms (O1–O7, including the O6 cubic, with in-paper validity filters, each root numbered). Its `Construction::lines(&sheet)` (`:127-138`) works on a flat sheet. Reusing or extracting it avoids a second implementation. Folded-frame inputs would need validity filters for the folded outline.
- **Worker.** `workers/foldSequenceWorker.ts`, shaped like `precreaseWorker.ts`. Methods are coarse and serializable, for example:
  - `axiomCandidates(stateKey, construction)` returns fold lines with root ids;
  - `previewFold(stateKey, line, layerSelector, direction)` returns `{status:'ok', state} | {status:'refused', refusal: {code,...}}`;
  - `applyStep(stateKey, op)` returns `{stateKey, cp, foldedScene}`;
  - `replay(sheet, ops, fromIndex)`, one step per call.
- **Output contract.** Emit per-state data shaped like `OristudioCpFoldedPaperScene`: `faces[] {outline, front_up, edges[] {kind: border|fold}}` and `subfaces[] {polygon, faces_top_to_bottom}` (`oristudioCpTypes.ts:529-570`). The canvas, the export path and Diagram can then reuse `foldedFlatPaperScene` → `PaperScene` without new adapters. Alongside it, emit the resulting crease pattern as a line list with M/V/aux assignment.
- **Runtime.** `store/workspaceStore/foldSequenceRuntime.ts`, reference-counted, retained by the Fold panel and by any Diagram capture, with a `whileFoldClientAlive` wrapper. Do **not** register it in `engineHost`. The authoritative document is plain data in the store, so on worker loss the runtime replays the steps, as a design kind with `engine: null` would (`designKinds/types.ts:226-234`).
- **Cancellation.** A simple fold on a known layered state should be fast, so V0 needs none. A long replay is made abandonable by running one step per call and checking a JS run token between calls. Don't depend on the `SharedArrayBuffer` flag. If a single call ever becomes slow, use the terminate-and-respawn pattern of `cpExactSolveWorker`.
- **Desktop.** Run the wasm in the webview, as precrease and the simulator do. A native path would mean Tauri commands plus a manifest parity test (`cp_engine.rs:12-14`). Only take that on if measurements demand it, given the "Tauri stays thin" rule.

---

## Canvas & picking & snapping

**Reuse the renderer seam, not the editor canvas (VERIFIED).**
- `CreasePatternWebglCanvas.tsx` is 4320 lines. It registers module-level singletons: `registerCpCamera` (`:32`), `registerCpSurfacePress` (`:34`), `cpTransformPreviewStore` (`:64`), and the shared touch arbiter in `gestures/cpSurfaceGestures.ts`, which assumes "one surface is mounted at a time".
- `ReferencesCpView.tsx:111-125` states the precedent directly: "A small, props-driven surface on the renderer seam… rather than a mode of `CreasePatternWebglCanvas`: that canvas has no read-only mode, takes ~80 tool props, and registers the camera, surface-press and transform-preview singletons." It reuses `createReglRenderer`, `UserCamera`, the scene adapters and `LineHitIndex`, with its own pinch handling and no store publishing. A `FoldCanvasView` should follow it.

**(a) The flat sheet with creases: yes (VERIFIED).**
- `CpRenderer.setStrokes(StrokeGeometry)` handles creases, with up to 6 dash slots and per-segment dash phase (`renderer/types.ts:50-117`).
- `setSheetFill` draws the paper (`CpRenderer.ts:72-81`); `setPreview` draws a candidate fold line (`:88-92`); `setOverlayPoints` draws the snap indicator (`:93-97`).
- M/V line styles come from `createCpLineAppearanceResolver` / `cpLineStyleDashPatterns` (used by both canvases).

**(b) A folded form with layer order: yes (VERIFIED).**
- `setFolded(FoldedGeometry)` accepts fills and strokes with per-vertex `depth`, so the two batched passes interleave correctly (`types.ts:61-67, 204-219, 259-268`).
- The chain already exists end to end:
  - `foldedFlatPaperScene(kernelScene)` turns subface stacks into painter's order, including woven or cyclic stacks via patches (`folded/foldedFlatScene.ts:1-60, 100-135`);
  - `foldedSceneLocalGeometry(PaperScene, style)` (`adapters/cpFoldedToScene.ts:657-697`) produces the GPU geometry;
  - Diagram stores exactly this `PaperScene` as a `'scene'` picture, plus a `paperFaces` string with per-face `levels` (31e1d6d84 `diagramDocument.ts:503-547`).
- **Caveat:** that adapter draws folded strokes without dashes (`cpFoldedToScene.ts:648-650`). Dashed creases drawn *on* the folded form need the stroke channel; References already does this for moving flaps (`types.ts:97-110`).
- **Fold animation:** References' `fold/foldPoseGeometry.ts` already projects a moving flap into the folded channel, using height as depth (`:1-24`). It handles one convex flap on a flat sheet (`foldScene.ts:33-50`). A multi-layer fold is the same idea applied to the moving layer set. INFERRED.

**Picking (partly missing).**
- No code picks faces on a *flat* folded form (grep for `topmost|pickFace|faceAt` finds only the simulator and BP). VERIFIED.
- The simulator has `frontmostFaceAt`, `facesWithCentreIn` and `facesVisibleIn` for 3D meshes, with an `'all-layers' | 'visible'` choice (`simulator/pickQuery.ts:14-63`). That is the right vocabulary but the wrong data.
- For Fold, use the subface data: a point-in-polygon test over `subfaces[].polygon` returns `faces_top_to_bottom`, which gives both the **topmost face** (`[0]`) and the **layer stack under the cursor**. It is exact and pure, and belongs in `src/fold/` with unit tests, or in the engine. INFERRED.

**Snapping for axiom input (VERIFIED APIs, INFERRED fit).**
- **Spatial index:** `picking/lineHitIndex.ts` (nearest segment or point within a tolerance; `distanceToSegment` at `:135`).
- **Radii that scale with zoom:** `cpHitRadiusModel` and the `*_COARSE` minimums for touch (`snapRadius.ts:93-134`).
- **Flat-sheet snapping:** `nearestCpSnapTarget` and `nearestOrieditaDrawPointTarget` (`lib/creasePatternViewport.ts:828-920`) are tied to `OristudioCpDocumentSnapshot`. They apply only if Fold's flat crease pattern takes that shape; otherwise write a small analogue.
- **Folded-form snapping:** the closest existing model is Diagram's `pictureSnapTarget` (31e1d6d84 `diagram/annotate/pictureSnap.ts:1-80`). It snaps to vertices, line ends, paper corners and crossings within a radius in picture units, with a rank order between kinds. Fold needs the same over the folded state's visible vertices, edges (`border`/`fold`) and crossings.
- **Multi-click axiom input:** `cp-workspace/tools/inputModelRegistry.ts:26-79` is a good template. It declares per-step snap modes (`'point' | 'crease' | 'crease-required' | 'candidate'`) and already covers Oriedita's `Axiom5` and `Axiom7`. Fold's O1–O7 can be declared the same way (e.g. O5 = `[point, point, crease]`, O6 = `[point, crease, point, crease]`). When an axiom has several solutions, the `candidate` step picks one (`sequenceSteps.loneCandidateAutoPick`).

---

## Constraints

From AGENTS.md and the linters (VERIFIED):

- **Panels are composition sites.** `FoldPanel` only mounts and wires children. Behaviour goes elsewhere:
  - **keys** go in `src/keyboard/` (a conditional `fold` scope with its executor); the lint rule `noPanelKeydown` (`eslint.config.js:392-401`) rejects `keydown` listeners in panels;
  - **verbs** go in a React-free, store-free action catalog returning plain descriptors, shared by toolbar, context menu and menu bar (`folded/foldedFigureActions.ts:21-33` is the model; Diagram has `diagram/actions/diagramActions.ts`);
  - **store bindings** go in `use*` hooks beside the concern;
  - **geometry** goes in pure modules with tests.
- **Panel size cap.** 800 lines, comments and blank lines excluded (`eslint.config.js:388-390`). Raising it in an explicit, reviewed line is allowed; hiding the count is not.
- **Workspace switches tear the dock down.** `activateWorkspace` runs `dockviewApi.clear()` and rebuilds (`layoutStore.ts:563-591`), so Fold's state and engine results must live in the store or runtime, never in the panel.
- **CSS modules only.** No new rules in `theme.css` (ratchet test: `src/styles/globalStylesheets.test.ts`). References' `theme.css` additions (`da6d19a04`) predate this rule; follow Diagram's `*.module.css` files. Use `--radius` and compose `components/ui` (`Toolbar`, `ViewportToolbar`, `Menu`, `CanvasContextBar`, `ViewportStatusReadout`). Shared blocks such as `panel-shell`, `panel-body` and `cp-webgl-layer` may be worn but must not gain rules. Don't give the Fold canvas the `cp-webgl-layer` class: the editor's floating toolbars forward wheel events to the first such canvas (`ReferencesCpView.tsx:117-118`). The app-shell rule in `App.css:1146` stays global, edited in place.
- **One predicate per question.** Text fields use `isShortcutEditingTarget` (`keyboard/shortcutDispatcher.ts:76`); nothing may depend on where focus is.
- **Analytics** go only through `track` in `apps/web/src/analytics/`: lowercase event names with spaces, `snake_case` properties, enums or bucketed numbers only, never geometry. Verbs dispatched through `MENU_ACTION_IDS` are tracked automatically (`menuActions.ts:819-828`); don't add a second event for them. Suggested hand-placed events: `fold step added {op_kind, layer_scope: all|some|top, via}`, `fold refused {code}`, and later `fold step sent to diagram`.
- **Sentry** only through `monitoring/`, i.e. `reportError` for errors that are deliberately swallowed.
- **Tauri stays thin**: no product logic there. The native menu is already derived from the web definition.
- **i18n.** JSX text must go through `t()` (`eslint.config.js:505-515`). All 9 locales are needed, plus `i18n:stamp`. Engine refusals cross the boundary as codes.
- **Porting discipline.** If the fold engine borrows algorithms from Oriedita or Flat-Folder, the porting rules apply (read upstream first, use the oracle, no approximations). Original code still needs an implementation plan in `implementation-plans/` with Goal, Approach, Affected Areas and Checklist.
- **Wasm artifacts are untracked.** After changing the engine crate, rebuild the bridge before trusting the browser; a bare `tsc` or `vitest` run passes against a stale `.wasm`.

---

## Open questions / risks

1. **A workspace or a design kind?** The design-kind registry gives tabs (several documents), generic `.osf` payloads, `unknownDesigns` carry-through, per-kind history, capability masks and `sendToEdit` without new plumbing (`designKinds/types.ts:209-301`). A top-level workspace (the Diagram precedent) means one document per project and all the plumbing above. The owner asked for a workspace; decide early whether a project holds one sequence or several (several would mean `foldSequences[]`, or tabs).
2. **Collisions with the Diagram PR (#436, frozen at 31e1d6d84).** Fold edits the same unions and seams that Diagram rewrites: `WorkspaceHistoryCounts`, `NATIVE_PROJECT_READER_VERSION`, the `'diagram'` viewport surface, the `:is()` header rule, scope precedence. The reader version is either 9 (shared) or 10, depending on which lands first. Building Fold on main before Diagram merges means rewriting these seams later.
3. **Raise the reader version, or use `extensions`?** Raising refuses to open the file in older (often desktop) builds. `extensions.foldSequence` keeps the data across older builds, but those builds can't show it. It is INFERRED, not tested, that every save path threads `extensions` through.
4. **Can a replay be trusted?** Saved steps must name layers in a way that survives engine changes: not raw face ids, unless the engine fixes a canonical face numbering. Otherwise a newer engine may resolve "fold the top 2 layers" differently. This needs golden replay fixtures and an engine version in any cache key.
5. **Precision.** Repeatedly reflecting floats drifts. The engine should compute folded positions from crease-pattern coordinates rather than step by step. Snapping and picking tolerances must agree with the engine's (`foldedSceneEpsilon = 1e-5 × sheet`, `foldedFlatScene.ts:142-144`).
6. **Woven layer orders.** Drawing handles them with patches, but "layer N under the cursor" and "fold through specific layers" need a defined meaning where the stack changes inside one face.
7. **Diagram integration.** Diagram needs a new step source, e.g. `{kind:'fold-step', sequenceId, stepId, fingerprint}`, beside `'cp' | 'references-step' | 'upload'` (31e1d6d84 `diagramDocument.ts:478`), plus a link-status rule. Fold steps then render as `'scene'` pictures with `paperFaces`.
8. **Keyboard.** Fold will want bare letters (valley V, mountain M, the axioms) that CP tools already use. A conditional scope makes this safe, but chord defaults need the duplicate-chord test (`shortcuts.ts:1088-1112`).
9. **Engine lifetime.** If Diagram captures from fold states while Fold isn't mounted, the reference-counted runtime must be retained by the capture as well, or captures will start a replay from scratch.
10. **Performance is unmeasured.** A replay of N steps on a load of a large sequence, and the `.osf` size if states are cached, should be measured before deciding whether to cache per-step states or rely on replay alone.
