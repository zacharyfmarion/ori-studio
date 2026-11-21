# Aux lines under edges

## Goal

Wherever an aux line meets an edge or a fold line, the edge or fold line is
drawn on top: in the 3D folded figure, the simulation, and the 2D folded
figure, on screen and in every picture made from them (Diagram steps, exports,
thumbnails), including pictures already saved in a file.

## Approach

The 2D folded figure already draws its aux lines under its edges: its scene
emits a face, then its aux lines, then its edges (`foldedFlatScene.ts`), and
the canvas strokes its aux overlay just above the face fills and below the
drawer's strokes (`auxDepth` in `cpFoldedToScene.ts`). The 3D figure and the
simulation do not:

- **Vector scenes** (`meshToPaperScene`, `spatialPaperScene`). Lines are drawn
  in painter's order, each as late as nothing covers it. A 3D figure's aux
  cuts come after its ring creases in each layer, so where an aux line ends on
  an edge the two land side by side, aux last. Measured on a 90° box with
  three aux lines: 11 of 15 aux–line contacts drew the aux line on top.
- **The GPU edge pass** (`MeshRenderer`). Every crease kind is one draw, in
  edge order; the 3D window does not write crease depth, so later wins.
- **The canvas-2D fallback**, which strokes edges in edge order.

Fix:

1. `linesUnderTheLinesTheyMeet` in `packages/origami-simulator/src/lineDrawOrder.ts`:
   a pass over a painter's order that moves each `under` line (aux) to just
   before the first other line drawn before it whose ink meets its own, as
   long as nothing between them comes within ink reach of it — so no face
   paints over any of its ink it did not before, and the order stays valid.
   Grouped items never leave their group's run.
2. `withAuxLinesUnder(scene, reach)` applies it to a `PaperScene`.
   `meshToPaperScene` and `spatialPaperScene` call it on what they build; a
   Diagram picture's stored scene is painted through it (`paintedScene`), so
   saved files get the new look without being rewritten.
3. `MeshRenderer` draws the aux ribbons first, without writing depth, then the
   other creases, whenever the drawn range has both. `MeshDrawOptions.edgeKinds`
   lets a caller draw one half; the spatial renderer, which draws its ink in
   masked groups, draws every group's aux before any group's other lines.
4. The canvas-2D fallback strokes aux lines before the rest.

## Affected Areas

- `packages/origami-simulator/src/lineDrawOrder.ts`, `paperScene.ts`,
  `webgl/meshRenderer.ts`, `index.ts`
- `apps/web/src/cp-workspace/folded/folded3dSpatialScene.ts`
- `apps/web/src/diagram/pictures/storedScene.ts`
- `apps/web/src/simulator/spatialMeshRenderer.ts`, `canvas2dFrame.ts`

## Checklist

- [x] `linesUnderTheLinesTheyMeet` + `withAuxLinesUnder`, with unit tests
- [x] `meshToPaperScene` and `spatialPaperScene` order aux lines under
- [x] Stored Diagram scenes painted with aux lines under
- [x] GPU edge pass: aux first, no depth write; spatial ink in two sweeps
- [x] Canvas-2D fallback strokes aux first
- [x] Browser check: 3D figure, Diagram step, simulation, 2D figure, before/after
- [x] Lint, typecheck, relevant tests
