# Phase 8 — Delete the SVG edit surface (scope + cleanup plan)

**Goal:** land the WebGL migration as a **net maintainability/architecture win**, not
just a renderer swap. When this phase is done there is exactly one CP edit renderer
(WebGL), the flag is gone, the 7,960-line `CreasePatternPanel.tsx` is decomposed into
focused modules, and the WebGL surface has **no residual dependency on an SVG element**.

Status of the codebase entering this phase: WebGL is at high parity (Phases 0–6 done);
the SVG surface still renders under the WebGL canvas (hidden via `data-webgl-hidden`)
and still owns the camera bridge. This is the "parity-period cost" the master plan
flagged — WebGL mode currently pays both renderers.

---

## A. What gets deleted (the SVG surface)

All in `apps/web/src/components/panels/CreasePatternPanel.tsx` unless noted.

### A1. SVG render components (~1,900 lines)
- `EditableCreasePattern` (the main SVG crease/point/circle/text rendering)
- `OrieditaInfiniteGrid` (SVG grid) + `visibleModelGridBounds` / `snapModelGridBounds`
- `GeneratedCreasePattern` (read-only/generated CP SVG) — **see open question O2**
- `DiagnosticPointMarker`, `DiagnosticLittleBigLittleMarker` (SVG diagnostic markers)
- `GeneratedFoldedFiguresLayer`, `GeneratedFoldedFigure`, `GeneratedFoldedFigurePrimitiveLayer`,
  `renderFoldedRenderPrimitive`, and the `foldedRender*` SVG helpers
  (`foldedRenderPathD`, `foldedRenderRectToSvg`, `foldedRenderBoundsRect`,
  `foldedRenderPaintCss`, `foldedRenderStrokeAttrs`, `foldedRenderLineCap/Join`,
  `rgbColorCss`, `rgbaColorCss`)
- `ImportedFoldedFormsLayer`, `ImportedFoldedFormFigure`, `foldedFormPointToSvg`
  (WebGL now renders imported forms via `foldedGeometryFromShapes`)
- `SelectionTransformBox`, `SelectionBoxPreview` (SVG selection resize/rotate overlay)
  — **see open question O1 (Phase 9 tension)**

### A2. react-zoom-pan-pinch (RZPP) from the edit path
- `TransformWrapper` / `TransformComponent` wrapping the SVG, `transformRef`,
  `ReactZoomPanPinchRef`, and the pan/zoom/fit plumbing that drives it
  (`handleViewportPanStart/Panning/Stop`, `handleViewportTransformed`,
  `computeFitScale`, `transformRef.current.centerView/zoomIn/zoomOut`,
  `fitLoadedCreasePattern`, `svgUserSpaceDecorationScale`, viewBox/rect sizing).
- **Do NOT remove the npm dependency** — `DesignPanel.tsx` still uses RZPP. Only the CP
  edit path stops using it.

### A3. The SVG interaction path (the "old" tool surface)
The `<svg className="cp-canvas">` element's handlers and everything feeding them
(~119 references): `handleEditablePointerMove`, `handleEditableToolPointerDown`,
`finishEditableDragPath`, `cancelEditableDragPath`, `clearEditablePointerStatus`,
`clearSelectionOnBackgroundPointerDown`, `handleEditableLine/Point/Circle/Vertex/Text Click`,
`handleFoldedFigurePointerDown`, `handleSelectionMove/Resize/Rotate PointerDown`,
`handleSelectionTransform`, and the SVG-space snap/first-pick helpers
(`resolveEditableFirstPickKind`, `nearestEditableCpLineId`, SVG `snapTarget`, the
event-target guards `isCpLineEventTarget` / `isCpSelectableEntityEventTarget` /
`isCpSelectionTransformEventTarget` / `cpTextIdFromEventTarget` /
`foldedFigureIdFromEventTarget`). The WebGL canvas already owns all of this via native
pointer events + the spatial index.

### A4. The renderer flag + branching
- `store/cpRendererStore.ts` (the whole `cpRenderer: 'svg' | 'webgl'` flag) and every
  `cpRendererMode === 'webgl'` branch (`data-webgl-hidden`, the toolbar zoom branches,
  `handleViewportShortcut`'s webgl/svg fork, the conditional WebGL mount). WebGL becomes
  unconditional for `editableCp`.

### A5. Sever the WebGL→SVG umbilical (the subtle one)
The WebGL canvas is **not** self-contained today:
- It imports `sampleView` from `svgViewBridge.ts` and takes an `svgRef` prop to seed its
  camera from the SVG's transform (fallback when `contentBounds` isn't ready).
- It takes `modelToSvg` **and** `svgToModel` props.

Phase 8 must:
- Seed the camera purely from `contentBounds` (already the preferred path in
  `ensureCamera`); drop the `svgRef`/`sampleView` fallback and **delete
  `cp-workspace/svgViewBridge.ts`**.
- Keep `modelToSvg` — the WebGL renders in SVG-user space (folded figures, circles) — but
  source it as the pure function it already is (`creasePatternViewport`), not via an SVG
  element. Drop `svgToModel` from the canvas props (the canvas does `clientToModel` via
  its own camera; confirm `svgToModel` is otherwise unused there).

---

## B. What stays (shared, renderer-agnostic)
- The kernel command layer (`executeOristudioCpCommand` / `previewOristudioCpCommand`),
  the store, the tool registry + `inputModelRegistry`, the pure tool engines.
- The entire WebGL surface (`cp-workspace/**`), including `cpFoldedToScene`.
- The diagnostic **geometry builders** (`buildCpDiagnosticMarkers/Strokes/Wedges/MarkerHits`,
  tone/shape helpers, `cpLblSectors`) — these produce WebGL geometry, not SVG.
- The **context tool panel** UI (`CpContextToolPanel`, `CpContextToolGroup`,
  `CpContextToolInstructions`, `NumericToolOption`, `TextToolOption`, `SelectToolOption`,
  `CheckboxToolOption`, `DivisionRatioOptions`, `CpLineTypeToolbar`, `FoldedFigureMenuButton`).
- Tool predicates (`is*Operation`, `shouldPreferPointSnapForStep`, …) used by the WebGL
  commit path.
- Measure + fold-frame helpers still consumed by WebGL geometry builders.

---

## C. Architectural cleanups to bundle (the "win")

1. **Decompose `CreasePatternPanel.tsx` (7,960 → target a few hundred).** After the SVG
   deletion, extract into modules under `components/panels/creasePattern/` (or similar):
   - `diagnostics/geometry.ts` — the `buildCpDiagnostic*` builders + tone/shape/LBL helpers.
   - `tools/predicates.ts` — the `is*Operation` family + `shouldPreferPointSnapForStep`.
   - `toolPanel/` — the context tool panel + all `*ToolOption` components.
   - `commands.ts` — `buildCpCommandPayload`, `handleWebglToolCommit/PreviewInput`, measure
     slots.
   - The remaining `CreasePatternPanel` = state/orchestration + WebGL wiring only.
2. **Delete vertex selection end-to-end.** Vertices are derived, never selectable in the
   WebGL model; the store still carries `selection.vertices` +
   `toggleOristudioCpVertexSelection` for the SVG path only. Remove from the store
   (`types.ts`, `creasePatternSlice.ts`, `projectSlice.ts`), the selection type, and the
   tests. (Master plan Phase 4 already flagged this.)
3. **Remove the flag** (`cpRendererStore.ts`) and its store slice; simplify `DesignSync`
   / any consumers.
4. **Collapse duplicate snap/first-pick logic.** The SVG had its own
   `resolveEditableFirstPickKind` / `nearestEditableCpLineId` / snapping; the WebGL path
   is now the single source of truth. Delete the SVG copies; keep one implementation.
5. **Coordinate model cleanup.** Delete `svgToModel`, SVG viewBox/rect/decoration-scale
   machinery, and `svgViewBridge.ts`. Keep `modelToSvg` as a pure helper. Document the two
   surviving coordinate spaces (model ↔ user ↔ device) in one place.
6. **Tests.** Rebuild around the pure modules (geometry, camera, picking, adapters, tool
   engines) instead of the SVG DOM (`data-cp-line-id` queries). The current
   `CreasePatternPanel.test.tsx` leans heavily on the SVG DOM — those tests either move to
   the pure modules or become a small number of WebGL smoke tests.
7. **Align with the active-view-context refactor** (see
   active-editing-context-refactor plan) rather than fighting it.

---

## D. Open questions / decisions (resolve before/while executing)

- **O1 — Selection resize/rotate (Phase 9 tension).** `SelectionTransformBox` (resize +
  rotate handles + flip/reflect menu) is **SVG-only**; it is **not** ported to WebGL, and
  Phase 9 (which ports it) is deferred to the very end. Deleting the SVG surface now
  **removes resize/rotate handles** until Phase 9. Move-drag (the common case) already
  works on WebGL. Options: (a) accept the temporary loss and do Phase 9 after Phase 7;
  (b) pull a minimal DOM-overlay port of the transform box forward into Phase 8; (c)
  bring Phase 9 forward to run inside Phase 8. **Needs Zach's call.**
- **O2 — The non-editable `GeneratedCreasePattern` path.** The SVG renders a read-only CP
  when `editableCp` is null; the WebGL canvas only mounts when `editableCp` exists. Is the
  `editableCp === null` case still reachable in the CP workspace, or legacy? If reachable,
  either WebGL must render it too, or it's scoped out of the edit surface. **Needs a
  reachability check + decision.**
- **O3 — Test rewrite scope.** How much of the SVG-DOM test suite to port vs. drop. The
  no-users / author-verified constraint means we can lean on manual gates + a lean
  automated core rather than reproducing every SVG DOM assertion.

---

## E. Suggested sequencing (incremental, each step still runnable)

1. **Sever the umbilical (A5)** — make the WebGL camera seed from `contentBounds`, drop
   `svgRef`/`sampleView`/`svgToModel`, delete `svgViewBridge.ts`. WebGL still mounts over
   the SVG; verify nothing regressed. *(Isolatable, low-risk first step.)*
2. **Make WebGL unconditional (A4)** — remove the flag + branching; SVG stops rendering
   for `editableCp`. Resolve O1/O2 here.
3. **Delete the SVG render components (A1)** and the SVG interaction path (A3) + RZPP from
   the edit path (A2).
4. **Store cleanup (C2, C3)** — vertex selection + flag slice.
5. **Decompose the panel (C1) + coordinate cleanup (C5) + collapse duplicates (C4).**
6. **Rebuild tests (C6).**

Each step is committed separately and hands to Zach for a gate check.
