# Fold workspace reuse report: painting, canvas, picking, snapping, guides and animation

## Summary

- **Fold can paint its paper with the app's existing painters and write no painter of its own. I checked this by running it.** I wrote spike states in the kernel's `OristudioCpFoldedPaperScene` shape and passed them, unchanged, through the app's export painter and its on-canvas painter.
  - On 7 states (about 21,000 sample points), the face the painter drew on top was the face Fold's layer order says is on top at every point: 0 wrong.
  - The crease-pattern pane went through the same painter: each fold drawn in the pen for its role, this step's folds dashed.
  - The colours came from the Default and Diagram presets.
- **There is one real cost.** The scene format needs `subfaces`: the overlap regions of the faces, each with its full stack of layers. The engine has to compute these (an overlay of its convex face images).
  - The spike's own renderer took them from Flat-Folder's arrangement, which the research found wrong for 7.2% of states.
  - A 40-line convex overlay was enough in this spike.
- **Two places to extract first, so Fold is a second user and not a third copy:**
  - the WebGL surface's renderer, camera and gesture code (about 430 lines of `ReferencesCpView`, already duplicated in the Edit canvas);
  - the paper front/back colour rows, which are already written three times.
- **Paper settings binding.** Fold should follow Settings ▸ Paper. The sequence gets the same sparse `appearance` pins that folded figures and simulation windows have. It should not store its own style the way the Diagram does.
  - The design's "colour side / white side" does not exist in the style. The style has `front` and `back`, and the presets disagree about which one is coloured.
- **Correction to research §9.** Edit's flat folded figure is drawn on screen from the kernel's render snapshot, not from `foldedFlatPaperScene`. That scene only feeds export (VERIFIED: `creaseExport.ts:1234`, `foldedFigureExportTarget.ts:157`). The combination Fold needs works (spike), but no surface uses it today.

## Spike evidence

The spike is in `artifacts/fold-spike/reuse/painting/` (gitignored): `paint.test.ts`, `vitest.config.mjs`, and outputs `out/table.md` and `out/*.svg`. Re-run:
```
/Users/zacharymarion/.nvm/versions/node/v22.14.0/bin/node node_modules/vitest/vitest.mjs run --config artifacts/fold-spike/reuse/painting/vitest.config.mjs
```
- **Input.** Core-spike states: the kite base (3 steps), the kite turned over, "quarter" (half twice), a top-layer corner, a precrease through 4 layers, and a bottom-two-layer mountain fold.
- **Adapter.** Each state is written as the kernel scene:
  - face outlines in the folded frame;
  - `points` = sheet vertex ids, and `sheet_points`;
  - `front_up` per face;
  - edge kind `border` / `fold` / `flat` from B / M·V / F.
- **Cells.** `subfaces` come from a convex overlay, with stacks sorted by the pairwise order.
- **Run.** The scene went through the app's unchanged `foldedFlatPaperScene`, then `paperSceneToSvg` and `foldedSceneLocalGeometry`.
- **Results** (VERIFIED, ran):
  - 9 of 9 tests pass.
  - The order within every cell is pointwise total.
  - Wrong top face: 0 of 21,106 samples, with hidden faces kept and with them dropped.
  - The canvas painter produced fills for only the visible faces (the quarter fold: 1 quad, 3 hidden).
  - Precreases came out in the aux pen and were pulled back from the paper's edge under the Diagram preset (0.25 pt, ends shortened by 1 pt).
  - In the crease-pattern pane, valley `3.30 1.65` and mountain `6.60 1.65 0.82 1.65` (the diagram-crease pens) appeared in the SVG.
  - On the canvas the same 16 lines came out solid, which is the dash gap below.

---

## 1. Paper settings

### The single source of truth (VERIFIED)

| Piece | Where |
|---|---|
| Store: `paperStyle: { display, export, presets, appliedPreset }` | `store/settingsStore.ts:283,366`; type `lib/paperStyleSettings.ts:24-41` |
| Style type, defaults, front/back | `lib/paper/paperStyle.ts:49-87, 155-184` |
| Export slot + object pins | `exportPaperStyle` `lib/paperStyleSettings.ts:66-71` |
| Per-surface field table | `PAPER_STYLE_POLICIES` `lib/paper/paperStyleResolve.ts:82-100` |
| Surface view of the style | `applyPaperStylePolicy` `:112`, `surfacePaperStyle` `:139` |
| Ink functions every painter shares | `paperFaceFill` `lib/paper/paperSvg.ts:294`, `penForRole` `:306`, `erodeLine` `:492` |
| GPU settings (simulator, 3D window) | `resolvePaperStyle` `paperStyleResolve.ts:257` |
| Object pins (sparse `appearance`) | `cp-workspace/paper/objectPaperStyle.ts:45-98` |

### Each consumer, and the route the style takes

| Surface | On screen | Export | Route |
|---|---|---|---|
| Edit crease-pattern canvas | **No paper.** Clears to the theme ground (`CreasePatternWebglCanvas.tsx:1872`); `setSheetFill` is called only by `ReferencesCpView` (`:700, :716`). Line colours are the theme's, for Oriedita parity (D12) | crease export | theme, not the style |
| Edit flat folded figure | Kernel render snapshot (`cpFoldedToScene.ts:573-622`). Colours are mirrored into the kernel's model (D1/D6). Edge width per figure (`objectPaperStyle.ts:92`; canvas `:1606, :1881`). Aux overlay `useFoldedFlatAux.ts:73,117` | `foldedFlatPaperScene` → `paperSceneToSvg` (`creaseExport.ts:922,1234`; `openFoldedFigureExport.ts:68`) | **two painters**, on purpose for parity (D6) |
| 3D folded figure on the canvas | stored PaperScene → `foldedSceneLocalGeometry` (`cpFoldedToScene.ts:657-698`, policy hard-coded at `:662`) | `folded3dScene.ts:114,154` | direct style object |
| 3D window | `resolvePaperStyle(…'folded-3d')` `folded3dWindow.ts:190` | same scene | direct |
| Simulator | `useSimulatorPaperStyle.ts:103` → `simulatorPalette.ts:125` | `simulatorExportTarget.ts:21`, `useSimulatorExport.ts:56` | direct |
| References canvas and cards | Style → CSS custom properties on `.references-workspace` (`usePaperStyleTokens.ts:141-266`, `ReferencesPanel.tsx:234`), read back from the DOM by the canvas (`referencesCanvasInks.ts:30-130`; `ReferencesCpView.tsx:712,1054`) | `diagramToPaperScene.ts:134`, `referencesStepExport.ts:158` | **CSS-token route** (a third indirection) |
| Diagram (#436, `31e1d6d84`) | A style stored in the document, D9 (`diagram/pictures/diagramPaperStyle.ts`); policy `'diagram-workspace'` = every field | `paintDiagramStep.ts` → `paperSceneToSvg` | **does not follow Settings**, by design (a printed document) |
| Export dialog | `PaperExportTarget.surface` picks the policy (`paperExport/paperExportTarget.ts:88-140`) | multi-page plus ZIP | shared |

### What Fold must call

These are VERIFIED working in the spike unless marked otherwise.
- **Folded form on canvas:** engine scene → `foldedFlatPaperScene(kernel, {markHidden, toScenePx, scale})` → `foldedSceneLocalGeometry(scene, surfaced style)` → `renderer.setFolded`. This is the 3D figure's route on the canvas, so the canvas and the file use the same `paperFaceFill`/`penForRole`.
  - Needed change: `foldedSceneLocalGeometry` hard-codes `PAPER_STYLE_POLICIES['folded-3d']` (`:662`). Make the policy a parameter, or let the caller pass an already-surfaced style (INFERRED, small).
- **Crease-pattern pane:** a PaperScene of one sheet face plus role lines, through the same painter:
  - `edge` for the border;
  - `mountain`/`valley` (fold pens) for earlier folds;
  - `aux` for earlier precreases;
  - `diagram-mountain`/`diagram-valley` for this step's creases — the design's "Dashed: creases this fold adds".
  - This matches `crease-and-fold-pens.md`. Don't adopt References' `cpGeometryStrokesToScene`: it is tied to Oriedita line colours in a `CpGeometryTransport`.
- **Step thumbnails and "Crease pattern by step":** `paperSceneToSvg(…)` as `data:` URLs, the Diagram's approach (`31e1d6d84:diagram/pictures/useStepPictureUrl.ts`, `stepPictureCache.ts`, a byte-bounded LRU of data URLs).
- **Exports:** a `PaperExportTarget` with `surface: 'fold'`, `pages` = steps (References' multi-page and ZIP pattern), `buriesFaces: true`, and `sizeMeasures` `'figure'` (folded) or `'sheet'` (crease pattern). Style comes from `exportPaperStyle(settings, sequence.appearance)`.
- **New policy:** `PaperSurface 'fold'` with References' field list (paper, edge, aux, erode, fold pens, diagram-crease pens, arrows; no light). Extract that list as `STEP_DIAGRAM_FIELDS` so the two cannot drift. Adding it also touches the analytics enum `PaperExportSurface` (`analytics/events.ts:326`).

### Binding the design's Paper tab

- **Colour swatches → pins on the sequence.** The sequence becomes a paper object (`appearance?: PaperStyleOverrides`) and the tab is a `PropertySheetView` (`components/properties/PropertySheetView.tsx`). Each row shows the effective value and offers a reset while pinned, as folded figures do. Add an "Edit paper style…" link to Settings ▸ Paper.
  - The rows are already written three times: `foldedFigureProperties.ts:150-211` (`styleColor`), `inlineSimulationProperties.ts:64-99` (`paperColor`) and `simulator/useSimulatorPaperStyle.ts:29-41`.
  - Extract `paperFaceColorFields(deps)` into `cp-workspace/paper/paperStyleFields.ts` (the module made to share rows between those two catalogs) and migrate both existing users first.
- **"Colour side up / White side up" → the sequence's starting view (turned over or not).** This is document state, not a style field.
  - The style has no colour/white meaning: Default has front `#ffff32` (yellow) and back `#e9e9e9` (`paperStyle.ts:127-128`); Diagram has front `#ffffff` and back `#b3b3b3` (`paperPresets.ts:52`).
  - Label it "Front up / Back up", with each face's swatch, matching Edit's Side control (`foldedFigureControlOptions.ts:12-18`).
- **Shape (square / rectangle / polygon) → the sheet polygon in the engine document.** It is not a style field, and the painter takes whatever polygon the engine gives.
- **The design's own colours.** The cream paper and teal moving-side tint are the prototype's. Under the Default preset Fold will show yellow and light grey. The teal highlight should be a theme accent drawn over the paper, not a paper colour.

### Duplication Fold would make worse

1. Copying References' CSS-token route would add a third token root (`.fold-workspace`) on top of the style → DOM → `readCssVarColor` path. Fold's canvases should read the style object directly, as `foldedSceneLocalGeometry` does.
2. A fourth front/back colour-row builder (above).
3. Adding a third flat-figure painter. The spike's `render.mjs` (own FRONT/BACK constants, Flat-Folder cells) must not be ported.
4. How wide a line is on screen already differs by surface:
   - References' canvas grows with zoom (`cpSizingScales` widthBoost) and has floors (`REFERENCES_VIEW_FLOORS`);
   - Edit's folded figures draw at exactly the pen's pt (`ptToDevicePx(1, ratio)`, canvas `:1881`).
   - Fold should pick one on purpose (open question).

## 2. Canvas

**What exists (VERIFIED):**
- **Shared pieces Fold reuses as they are:**
  - camera math (`renderer/camera.ts`: `fitUserCamera`, `panUserCamera`, `zoomUserCameraAt`, `frameUserCameraOnBounds`, `cameraZoomForPercent`);
  - `applyPinchToCamera`, `resolveWheelGesture`, `cpSizingScales`, `cpDpr`;
  - the `CpRenderer` interface;
  - `webglSupport`: context-loss classification and restore.
- **Duplicated glue (not shared).** `ReferencesCpView.tsx:543-974` plus its handle `:1150-1200` re-implements what `CreasePatternWebglCanvas.tsx:1641-1900` does, near-verbatim:
  - support probe and `createReglRenderer`;
  - lost-at-start and mid-session context loss, with `reportError` tags;
  - preserving the camera across a rebuild;
  - fit-once and `framingKey` refit;
  - the ResizeObserver;
  - de-duplicated zoom-percent and view reporting.

  References adds its own pointer map, pinch, wheel, a click-under-4 px versus pan test, and a hover probe coalesced to one per frame.
- **The Diagram (#436) adds no WebGL copy.**
  - Its annotate canvas is a DOM/SVG picture in `useViewportSurface` (react-zoom-pan-pinch; `31e1d6d84:diagram/annotate/useAnnotateCanvas.ts`).
  - Its 3D pose reuses `SimulatorViewport` (`DiagramPose3dView.tsx:20`).
  - `useViewportSurface` is a DOM-transform camera (Tree, BP, Diagram). It is wrong for an animated WebGL folded form.

**Options:**
- **(a) Third copy.** This is plan D8's "`FoldCanvasView` like `ReferencesCpView`". There would be two panes, so effectively a third and fourth copy.
- **(b) Extract `useCpSurface` (recommended).** Lift renderer lifecycle, context loss, resize, camera seed and fit, pan/pinch/wheel, the click-or-drag test, the per-frame hover probe, zoom and view reporting, and the zoom handle out of `ReferencesCpView`. The hook is shaped like `hooks/useViewportSurface.ts`. The surface supplies:
  - its uploads;
  - its hit test;
  - an `onPress`/`onPick` callback.

  `ReferencesCpView.test.tsx` is the gate. Then Fold's two panes are users #2 and #3.
- **(c) Also migrate Edit.** Not now: 4,320 lines, module singletons (`cpCameraRegistry`, `cpSurfacePressRegistry`) and the grid. It can adopt the hook later.

**Cost and risk:** medium. It is pure motion of code with existing tests, but every References upload effect depends on `rendererGeneration`, so the hook must expose a renderer generation (INFERRED).

**Chrome (VERIFIED, all shared):**
- the bottom bar is `components/panels/ViewportToolbar.tsx`, declared per surface as in `ReferencesViewportToolbar.tsx`;
- the "Folded · Step 2 · 4 layers…" strip is `ui/ViewportStatusReadout`;
- the floating tool window is `ui/tools/ToolHintWindow` (Edit, Simulator, and the Diagram with `ToolHintInstructions`, on #436 only);
- the clear colour is `--bg-primary`, as References uses.

## 3. Folded-form rendering

**What Fold must emit to reuse the chain unchanged** (VERIFIED by the spike): schema 3 of `OristudioCpFoldedPaperScene`, with these fields as `31e1d6d84:engine/oristudioCpTypes.ts:529-570` defines them:
- `faces[].outline`, `faces[].front_up`;
- `faces[].edges[].kind`: `flat` is drawn in the aux pen, `border`/`fold` in the edge pen (`foldedFlatScene.ts:889-891`);
- `faces[].points` and `sheet_points`. Fold has both natively, and the Diagram's layer spreads need them (`31e1d6d84:cp-workspace/folded/foldedLayerSpread.ts`);
- `flipped`, `sheet`;
- `subfaces[]` with `faces_top_to_bottom`.

**Subfaces are not optional.** `foldedFlatPaperScene` reads them for four things:
1. which faces are hidden (`:681`). The canvas painter drops hidden items (`cpFoldedToScene.ts:680`);
2. drawing order (the topological sort);
3. patches for woven components;
4. downstream: spreads and the Diagram's layer covers (`pictureGeometry.ts`).

The engine must emit cells. The spike computed them by successive convex half-plane splits. Inside one cell the order is total (asserted). The Rust version needs its own tolerance policy for this display-only overlay, separate from validation (INFERRED).

**What is missing, and where it belongs:**

| Need | Status | Recommendation |
|---|---|---|
| Fold policy in the canvas painter | Hard-coded `folded-3d` (`:662`) | Parameter (small) |
| Dashes on the folded channel | `foldedSceneLocalGeometry` emits no dash slots (its own doc: "reads solid on the canvas and dashed in the file"). The GPU program supports them, and `foldPoseGeometry.ts:340-397` already uses them | Add dash slots to the shared `FoldedBuilder` path. This also fixes Edit's 3D-figure gap between screen and file (INFERRED, small) |
| Moving-set highlight; flap "peel" X-ray | Only a global `faceAlpha` X-ray (`:639-660`, via `folded3dStylePlan`) | Per-face ink or alpha override on the painter. Not a separate overlay: a mountain fold's moving set is underneath |
| Hidden or behind lines | `'diagram-hidden'` role and arrow `HiddenStretches` exist on #436 only (`paperScene.ts` diff; `diagram/annotate/behindFlaps.ts`) | Reuse after #436 merges |
| Layer spreads to show hidden layers | #436 `foldedLayerSpread.ts` reads schema 3 | Comes free if Fold emits `points` and `sheet_points` |
| Pending-fold arrow | See §5 | SVG mark layer over the canvas |
| Scene → `FoldedGeometry` without a fake figure entry | `cpFoldedToScene` only takes `OristudioCpFoldedFigureEntry[]` | A small exported `paperSceneToFoldedGeometry` |

## 4. Picking and snapping

- **Topmost face and the stack under the cursor:** a point-in-polygon test over the emitted subfaces. It is trivial once cells exist, and nothing to share.
- **Already shared, reuse as-is (VERIFIED):**
  - `cp-workspace/picking/lineHitIndex.ts` (Edit, References `ReferencesCpView.tsx:482-496`, Diagram `pictureGeometry.ts:25`);
  - `snapRadius.ts` `cpHitRadiusModel` (References `:796-797`).

  Caveat: radii are in Oriedita 400-unit model units (`CP_MODEL_TO_CSS`, `snapRadius.ts:22`). Fold must scale by its sheet size, as the Diagram converts into picture units.
- **`nearestCpSnapTarget` (`lib/creasePatternViewport.ts:828`): do not share.** It is a linear scan with Oriedita corners and Oriedita grid. Edit's real snapping sits behind the kernel for parity.
- **Diagram `pictureSnapTarget` (#436): do not reuse directly.** It is tied to `DiagramStep`, annotations and assets. It also recovers landmarks from a painted picture, without provenance or visibility ("corners covered by a layer over them included").
  - Fold's landmarks must come from the engine with provenance (sheet vertex ids, edge plus parameter, crossings), or replay breaks (research §8, D6).
  - Share later, after #436: the tie-breaking rank and the "crossings near a point" helper (~50 lines). Low value.
- **`inputModelRegistry`: do not add Fold tools.**
  - It is keyed by `OristudioCpOperationId` and validated against the SVG surface (`inputModelRegistry.ts:1-23, 74`). Its `Axiom5`/`Axiom7` are resolved by the Oriedita kernel.
  - Reuse the surface-agnostic reducers instead: `tools/types.ts` `ToolEngine`, `createToolRuntime`, `createStepSequenceTool`, `dragLineTool`. Put them in a Fold-local registry using the `CpStepSnap` vocabulary (`point`/`crease`/`candidate`):
    - O2: point, point;
    - O3: crease, crease;
    - O5/O6: …, candidate.
  - Gap: `ToolInput` carries only `point` and `lineId` (`types.ts:13-41`). Fold needs landmark identity, so either add an optional generic `target` or keep a side table keyed by step (INFERRED).

## 5. Guides and animation

- **One mark vocabulary already exists.** It is `StepDiagramPrimitive` with `diagramShapes` (`references/diagram/DiagramPrimitives.tsx:312`), `stepDiagramGeometry.ts` (`foldArrowArc` `:455`, `createOverlayProjector` `:122`), `diagramInk.ts` and `markReach`.
  - The Diagram already compiles its annotations into it ("an annotation's arrow is References' arrow", `31e1d6d84:diagram/annotate/annotationPrimitives.tsx:1-4`). It imports `stepDiagramGeometry` from 14 files and `diagramInk` from 11 (VERIFIED). Fold is the third user.
  - On `main` the only arrow kinds are `fold-arrow` (fold and unfold) and `arc`. The one-way valley/mountain arrow, push, pleat, rotate, divisions and hidden stretches exist only on #436 (`referenceFinderDiagramToPrimitives.ts` there).
  - Recommendation: draw the pending fold as `foldArrowArc(grip, image, centre)` → `one-way-arrow`. Move the vocabulary to a neutral module only after #436 merges; that branch edits these files heavily (`stepDiagramGeometry` +1945 lines, `DiagramPrimitives` +445). Until then Fold imports from the References path.
- **Fold-line styles:**
  - the pending fold goes on the preview channel, dashed with `diagramDashPatterns` (`diagramInk.ts:474`), as References' `diagramStrokes` do (`ReferencesCpView.tsx:192, 1088`);
  - folds already made are edges, precreases aux, crease-pattern folds the fold pens.
  - No new styles.
- **Symbol overlay.** `ReferencesDiagramLayer.tsx` draws its symbols as SVG over the canvas through `createOverlayProjector`. Generalise it into a `DiagramMarksLayer` (camera, primitives, outline, pens); the fold-pose fade stays optional. Or Fold writes a thin layer over the same two functions. Medium versus small.
- **Playback (VERIFIED generic).** `fold/foldPlayback.ts` and `foldTransport.ts` touch `FoldScene` only for `flaps.length`, `kind` (pace, auto-play) and `way` (analytics) (`foldTransport.ts:120-138, 186-193`). Extract them with a `programme` (legs plus kind) input, as plan D12 says. The References tests are the gate. Small.
- **Pose geometry.** `foldPoseGeometry` and `foldSurface` model one convex flap over a flat sheet with a curling bend. Fold moves N stacked faces with an order.
  - Reuse `rigidHinge` (`foldSurface.ts:71`), `PAPER_TILT_SHADE`, the rule for which face shows, and the crease-direction swap.
  - Preferred (INFERRED): pose the PaperScene itself. Rotate the moving faces' rings about ℓ, flip `side` past edge-on, set shade, and push the frame through the same painter. Animation frames then match export by construction.
  - The cost is re-triangulating every frame, since the WeakMap cache misses. That is fine at tens of faces and unmeasured above.

## Recommendations, ranked

1. **Paint Fold only through PaperScene and PaperStyle.** The engine emits the schema-3 kernel scene including subfaces; `foldedFlatPaperScene` then feeds `foldedSceneLocalGeometry` (canvas) and `paperSceneToSvg` (export and thumbnails). VERIFIED by the spike. Cost: the cell overlay in Rust.
2. **Add `PaperSurface 'fold'`** with a shared `STEP_DIAGRAM_FIELDS` list, and make the policy in `foldedSceneLocalGeometry` a parameter. Small, VERIFIED need.
3. **Make the sequence a paper object** with `appearance` pins. The Paper tab is a `PropertySheetView`. First extract `paperFaceColorFields` from `foldedFigureProperties` and `inlineSimulationProperties`. "Start with" is Front/Back as document state; Shape belongs to the engine document.
4. **Extract `useCpSurface` from `ReferencesCpView`** before building Fold's panes, with the References tests as the gate. Edit stays as it is.
5. **Draw dashes in the folded channel's scene builder.** It is shared and also closes Edit's 3D-figure gap between screen and file. Add a per-face ink/alpha override for the moving-set highlight and peel.
6. **Extract `foldPlayback` and `foldTransport`** behind a programme input. Write a group pose that poses the PaperScene and reuses the rigid hinge, shade and face-flip rules.
7. **Use the `StepDiagramPrimitive` vocabulary** for the arrow, turn-over and rotate glyphs, and the divisions marks. Move it to a neutral module only after #436 merges. Generalise `ReferencesDiagramLayer`.
8. **Reuse the pure tool reducers** with a Fold-local registry. Keep Fold out of `inputModelRegistry`.
9. **Snapping:** engine landmarks with provenance, plus `LineHitIndex` and `cpHitRadiusModel` with a sheet scale. Reuse nothing from `nearestCpSnapTarget`.
10. **Thumbnails** are `paperSceneToSvg` data URLs. Move #436's `stepPictureCache` LRU to `lib/` when it merges.
11. **Don't:**
    - copy References' CSS-token route;
    - draw flat figures from the kernel snapshot;
    - add a mode to `CreasePatternWebglCanvas`;
    - port the spike's `render.mjs`.

## Open questions

1. Labels: "Front up / Back up" with swatches, or keep "colour / white"? The presets disagree about which face is coloured.
2. Should the Paper tab's swatches write pins on the sequence (recommended), write the app's display style, or only link to Settings ▸ Paper?
3. Line widths on screen: exactly the style's pt (Edit's folded figures, WYSIWYG with export), or References' zoom growth and floors?
4. One camera shared by both panes or one each? Which pane does the single bottom bar's zoom control?
5. Crease-pattern pane when the sequence starts back up: mirror it and fill with `paper.back` (References' `mirrored`), or always show the front?
6. Precreases: the folded form follows the style's aux switch with the bar's "Precreases" toggle as an override (generalise `referencesShowsAux`). Should the crease-pattern pane always draw them, as the Diagram's crease patterns do?
7. Sequencing: the one-way arrow, hidden stretches, `diagram-hidden` and spreads exist only on #436. Should Fold V0's guides wait for it to merge?
8. The cell overlay in Rust: what tolerance and minimum-feature policy for a structure that drives display only, not validation?
