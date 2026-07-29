# Canvas-object placement in document space

## Goal

Folded figures and inline-simulation windows must land beside the creases they
came from, for every document — including `.ori` files that carry a non-default
Oriedita camera and contain many crease-pattern regions.

Two independent defects are in scope, both reproduced against
`lamprey-draft-v0.6.ori` (8 tiled 400-unit CPs at model x ∈ [−480, 1640],
y ∈ [1744, 3860]; saved camera `zoom 1.6415`, `position (−121.7, 3943.3)`,
`displayPosition (834, 988)`):

- **A — Fold parks a figure ~1580 user units left and ~6930 below its source.**
  The crease pattern is drawn through the file's *saved Oriedita camera*, while
  folded figures are placed and drawn through the *default* paper-square affine.
  The two coincide only for a default camera. Controlled A/B on the same file and
  region, varying nothing but the saved camera: figure top-left relative to the
  CP's top-right corner is `(+2.6, 0) px` with a default camera (correct) and
  `(−52.1, +228.5) px` with the file's camera.

- **B — "Simulate inline" opens a ~14-unit window beside the wrong region.**
  The region id is resolved in one segmentation and consumed in another.
  `useSimulateSelection` segments `cpSegmentationArtifacts` (kernel export,
  untriangulated) → 20 regions; `addOristudioCpInlineSimulation` looks the same
  integer up in the store's `foldArtifacts` (triangulated simulation fold) → 23
  regions. Measured: toolbar id 17 = the 400×400 CP at (−479, 2829), store id 17 =
  a 13.6×13.6 sliver at (634, 2517).

Non-goals: changing the fold kernel, the simulator, or `.osf` format version.
No Rust changes are expected.

## Approach

### A. One model→user mapping per canvas, and it is not the file's camera

The saved Oriedita camera is a **view**, not part of the document's geometry, but
[`CreasePatternPanel.tsx:1167`](../apps/web/src/components/panels/CreasePatternPanel.tsx#L1167)
bakes it into the model→SVG-user transform:

```ts
editableModelToSvg = camera ? orieditaObjectToSvg(p, camera) : modelPointToCpSvg(p, ORIEDITA_PAPER_BOUNDS)
```

Everything else that places canvas content — `cpUserAnchorForLineIds`,
`foldedFigureLocalGeometry`, `occupiedModelSpace` — hardcodes the paper affine.
So the document silently has two "user spaces" whose scales differ by the saved
zoom, and any fixed user-space constant (`CANVAS_OBJECT_GAP = 48`) means a
different physical distance per document.

**Take the camera out of the model transform.** `modelToSvg` becomes the fixed
paper affine for every document, and the saved camera is consumed as what it is:
the initial framing of the surface's own `UserCamera`.

Why this rather than threading the document transform into the three
folded-figure call sites:

- It deletes the second space instead of propagating it. The
  `CpOverlayViewStore` doc comment already states the two views "coincide only
  when the document carries no native Oriedita camera" — this makes that
  condition unconditional.
- The folded-figure code is already written against the paper affine, so it
  becomes correct with no change, no new parameter, and no cache re-keying on
  `foldedFigureLocalGeometry`'s snapshot-identity `WeakMap`.
- Folded-figure `placement.offset` is persisted in `.osf`
  (`nativeProjectFile.ts`, `document.viewState.foldedFigures[]`) in user units.
  Keeping the paper affine means **no migration**: every project that works today
  keeps its exact stored offsets.
- The saved camera has only three consumers, all in `CreasePatternPanel`
  (`modelToSvg`, `svgToModel`, `editableCircleRadiusToSvg`), so removal is
  contained. It is read-only metadata — nothing writes it back during a session —
  and `.ori` export preserves it through `orieditaNativeMetadata`'s "preserved"
  set, so round-tripping is unaffected.

Fallback if preserving today's on-open framing semantics turns out to matter more
than the above: thread a single `cpDocumentTransform(document)` → `{ modelToSvg,
svgToModel }` helper through the three placement sites and key
`localGeometryCache` on the camera. Same defect fixed, more surface, and it
leaves user-space constants document-dependent.

### B. One segmentation authority, and region identity is not an integer

Three layered causes; fix all three or the symptom moves.

1. **The store and the toolbar segment different folds.** `resolveCpSegments`
   runs on `simulationFoldOf(artifacts)`, which is the *triangulated* mesh when
   `simulation_model` exists and the base fold when it does not. Regions are a
   property of the crease pattern, not of the simulation mesh, so segment
   **`artifacts.fold`** always. The count divergence then becomes structurally
   impossible.

   Consequence to handle: `CpSegment.faceIndices` indexes the fold it was
   segmented from, and `buildSegmentFold(simulationFoldOf(artifacts), segment)`
   uses those indices against the simulation fold. Derive the simulation faces
   for a region by testing each simulation face centroid against the region's
   `boundary` rings (`pointInSegment` already exists) instead of by shared index.

2. **A bare positional id crosses the toolbar→store boundary.**
   `useSimulateSelection` already holds `match.segment` and `match.cpLineIds`;
   `addOristudioCpInlineSimulation(segmentId)` throws that away and re-looks-up
   the integer. Pass region identity — boundary rings plus `cpLineIds`, with the
   id demoted to a hint. `InlineSimulation.sourceBoundary` already documents this
   exact rule for staleness ("ids renumber whenever an edit adds or removes a
   region"); creation should obey the rule it already states.

3. **Importer-space artifacts are installed for a kernel-backed document.**
   `projectSlice.ts:858` and `:982` set `foldArtifacts` from the importer's
   result, whose coordinates `normalizePoints` has squashed into the unit square,
   at the same moment they install the kernel-backed `oristudioCpDocument`. Right
   after opening the file the store's artifacts are `[0,1]` while the document is
   Oriedita model space. For a kernel-backed document, artifacts must be derived
   from the kernel export — skip the install and let `ensureFoldArtifacts` build
   them lazily.

   This retires the "containment came back empty ⇒ refresh and retry" heuristic
   at [`creasePatternSlice.ts:1017`](../apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts#L1017),
   which detects the symptom and then re-derives against a *third* segmentation
   while keeping the id from the first — the step that actually retargets the
   window.

### Verification

Reproduction is scripted through `window.__treemakerWorkspaceStore` with the file
served from `apps/web/public`; see the session notes. The two measurements that
must change:

- Fold the region at model (259.7, 1744.3)–(659.7, 2144.3): the figure's placed
  user bbox must be adjacent to that region's *drawn* position, gap
  `CANVAS_OBJECT_GAP`, tops aligned.
- `resolveCpSegments` over the store's artifacts and over
  `cpSegmentationArtifacts` must return the same count and the same bounds per id.

## Affected Areas

| Area | File |
| --- | --- |
| Model→user transform, circle radius | `apps/web/src/components/panels/CreasePatternPanel.tsx` |
| Initial view seeding from saved camera | `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx`, `apps/web/src/cp-workspace/renderer/camera.ts` |
| Native camera helpers (consumers change, module may stay) | `apps/web/src/lib/orieditaCamera.ts` |
| Overlay view pair (`user` may collapse to a constant of `model`) | `apps/web/src/cp-workspace/cpOverlayViewStore.ts` |
| Folded-figure anchor, geometry, bounds | `apps/web/src/cp-workspace/adapters/cpFoldedToScene.ts` |
| Segmentation source fold, region→sim-face mapping | `apps/web/src/lib/creasePatternSegmentation.ts` |
| Segment resolution from selection | `apps/web/src/lib/creasePatternSelectionSegment.ts` |
| Inline-sim creation, blockers, refresh heuristic | `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` |
| Toolbar→store hand-off | `apps/web/src/cp-workspace/inlineSimulation/useSimulateSelection.ts` |
| Importer artifact install | `apps/web/src/store/workspaceStore/slices/projectSlice.ts` |
| Fixture | `tests/fixtures/` (reduced multi-region `.ori` with a non-default camera) |

## Checklist

### Phase 0 — Fixture and failing tests

- [x] ~~Add a reduced `.ori` fixture~~ — **skipped for issue A, deliberately.**
      The store tests mock the CP kernel, so an `.ori` fixture cannot drive a
      real fold in vitest and would only re-test the pure functions the unit
      test already covers. Revisit for issue B, where the segmentation paths are
      pure and a fixture *would* pay for itself.
- [x] Test: placement anchors to creases far from the paper square
      (`cpFoldedToScene.test.ts`, coordinates taken from the real file).
- [x] Test: a saved camera is preserved but no longer *restored*
      (`orieditaNativeMetadata.test.ts`) — the pin against reintroducing it.
- [x] Tests: regions come from the crease pattern not the mesh, the region→mesh
      bridge is by geometry, and a region describing other paper yields no faces
      (`creasePatternSegmentation.test.ts`).

### Phase 1 — Take the saved camera out of the model transform (A) — **done**

- [x] Added `cpModelToSvg` / `cpSvgToModel` to `creasePatternViewport.ts`: the
      canvas's one model ↔ user mapping, with the reason it must stay a pure
      function of the point. Replaced the four inline copies of the affine (panel
      ×2, `cpFoldedToScene` ×2, `occupiedModelSpace` ×2) with references to it.
- [x] `editableModelToSvg` / `editableSvgToModel` are now that pair, with no
      document-derived branch.
- [x] `editableCircleRadiusToSvg` drops the `orieditaCameraSvgScale` branch; the
      remaining branch scales by 588/400, the same factor as the geometry.
- [x] **Decision: always fit to content on open; the saved camera is not
      restored at all.** No seeding machinery was added. The surface already
      seeds its `UserCamera` with `fitUserCamera(contentBounds)`, that is what
      every other document does, and an author's Oriedita framing does not
      transfer to a different pane size — least of all for an 8-region worksheet,
      where it frames whichever corner they were last looking at. Trivially
      reversible if the fidelity matters more.
- [x] Re-documented `CpOverlayViews`: `model` and `user` now differ by exactly
      `cpModelToSvg`, one constant affine for every document.
- [x] Deleted `lib/orieditaCamera.ts` and its test — dead once the transform and
      the status label stopped reading it. Left in place it is an invitation to
      reintroduce the defect. The metadata itself still round-trips: it is
      carried verbatim in the kernel's metadata dict, not through this module,
      and `orieditaNativeMetadataStatus` still reports Camera as *preserved*.
- [ ] Fit-to-view on open is **still not right** and is pre-existing: a document
      loaded after the surface mounts leaves the view at 0% until Fit is clicked.
      Not caused by this change (reproduced on the original code) and not fixed
      by it. Logged as separate work.

### Phase 2 — One segmentation authority (B1) — **done**

- [x] `resolveCpSegments` segments `artifacts.fold`; the worker
      (`treemakerWorker.ts`) attaches segments from the same fold, so the two
      cannot diverge.
- [x] `simulationFacesForSegment` maps a region into the mesh by
      centroid-in-boundary; `buildSegmentSimulationFold` wraps it and is now the
      only way a region becomes a simulator fold (store ×2, `SimulatorPanel`).
      Identity short-circuit when the artifacts carry no simulation model.
- [x] `segmentContainment` / `explainSelectedSegment` read `artifacts.fold`,
      since `faceIndices` now index it.
- [x] Verified on the real file: toolbar 20 vs store **20**, zero disagreements.

### Phase 3 — Region identity across the boundary (B2) — **done**

- [x] `addOristudioCpInlineSimulation` takes an `InlineSimulationRegion`
      (`{ segment, cpLineIds }`), not an index. The id survives only as
      `segmentIdHint`, which is what it was always documented to be.
- [x] `useSimulateSelection` hands over the region it had already resolved,
      which also drops a redundant containment recompute.
- [x] Empty-containment refresh heuristic deleted.
- [x] A region with no mesh faces under it now reports `unavailable` instead of
      opening a blank window.

### Phase 4 — Kernel-backed documents own their artifacts (B3) — **done**

- [x] Both install sites in `projectSlice` mark the resource *stale* when a
      kernel-backed document is present, so the first request derives artifacts
      from the kernel export. The importer's artifacts are still installed for a
      document that has no kernel handle.
- [x] Verified: after opening the `.ori`, `foldArtifacts` are in model space
      (max x 1640), not the unit square.
- [x] Three store tests updated — they asserted the eager importer install, which
      is the behaviour being removed. Both panels that read artifacts already
      call `ensureFoldArtifacts()` on mount, so nothing in the UI regressed.
- [ ] `occupiedModelSpace` blocker test — not added; the inverse is exercised by
      the Phase 1 work and no placement defect was observed. Worth adding if that
      path is touched again.

### Phase 4b — The solver needs unit scale (fallout from Phase 4) — **done**

Phase 4 stopped normalizing the document on import, which was right — segmentation
and containment need the document's own coordinates — but the GPU solver had been
silently depending on that normalization.

- Cause: the WebGL solver is float32 end to end (positions, velocities, the
  `readPixels` convergence readback) while `SimulationClock` tests convergence as
  an **absolute** `maxVelocity < 1e-5`. At document scale a sheet reaches ~3900
  units, where the float32 step is ~2.4e-4 — a velocity of 1e-5 is smaller than
  the gap between representable positions, so the model can never be *observed*
  to settle. Every load ran to the 20,000-step cap with a stalling readback every
  20 steps: ~0.5s per region switch, paid again on every visit.
- [x] `foldScaledForSolver` in `simulatorSession.ts` scales a fold into a unit box
      at the one boundary where it enters the solver — covering the Simulate
      workspace, inline windows and sequence playback together. Uniform and
      aspect-preserving; a no-op when already unit-ish, so single-pattern
      documents are untouched.
- [x] Tests pin the float32-vs-epsilon constraint itself, not just the arithmetic.

Worth knowing for anything similar: a scale test against `ReferenceSolver` proves
nothing here — it is float64 and genuinely scale-invariant. The defect only exists
on the GPU path. Found by bisecting behind runtime flags, not by analysis.

Still open, unrelated but adjacent: the Simulate workspace passes no `modelKey`,
so `prepareFoldModel` re-runs on every switch while `PreparedModelCache` goes
unused. Inline windows do pass one.

### Phase 5 — Validation

- [x] `npx tsc --noEmit`
- [x] `npm --workspace @treemaker/web exec -- vitest run` (1373 passing)
- [x] `npm run lint:web`
- [x] Browser-verified by the author on the real file: fold placement, inline
      simulation regions, and /simulate switching.
- [ ] Browser check on the real `lamprey-draft-v0.6.ori`: fold a region and
      simulate a different region; both land beside their source at the right
      size. Also open a default-camera single-CP file and confirm nothing moved.
- [ ] Open an existing `.osf` containing folded figures and confirm their stored
      placements are unchanged.

## Open questions

- ~~**Saved framing.**~~ Resolved in Phase 1: always fit to content. See the
  decision note there; flip it back if opening `.ori` files at their Oriedita
  framing turns out to matter.
- ~~**Folded-figure size.**~~ Resolved during Phase 1, and my earlier note on it
  was wrong. `foldedFigureModel.scale` is not a separate "pane zoom": Oriedita
  seeds it *from the crease-pattern camera* on every fold
  (`FoldedFigure_Drawer.createTwoColorCreasePattern`:
  `d_foldedFigure_scale_factor = camera_of_foldLine_diagram.getCameraZoomX()`),
  so it is a screen-space quantity in that camera's units. A saved `scale` of
  3.2916 against a camera zoom of 1.6415 means "2.005× the crease pattern".
  Removing the camera from the CP transform therefore removed the divisor and
  made the figure 1.64× oversized — a regression Phase 1 introduced. Fixed by
  dividing the saved scale (and subtracting the saved angle) back out when
  reading the model from `.ori` metadata; the file itself is unchanged, since the
  metadata round-trips verbatim through the kernel.
