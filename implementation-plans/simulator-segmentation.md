# Crease-Pattern Segmentation for Simulate & Export

## Goal

Split a document's fold output into independent crease-pattern segments —
each a region enclosed by a closed border chain (not necessarily a square) —
so that:

1. The Simulate tab simulates **one** segment at a time (selected from a left
   sidebar of flat 2D thumbnails) instead of folding the entire sheet at once.
2. Export can offer "whole document", "selected pattern", or "each pattern as a
   separate file", reusing the exact same segmentation.

Performance is a first-class requirement: large documents must not stall the
main thread, and only the selected segment should ever be simulated.

## Approach

### Where the code lives (decided)

- Segmentation is a **pure TypeScript** module in `apps/web/src/lib` — an
  OriStudio product concern, **not** `treemaker-core` (TreeMaker engine only).
- It runs **inside the existing treemaker Web Worker** that already builds the
  FOLD document (`api.foldArtifacts`), so the graph walk never touches the main
  thread. Being a pure function, worker vs. main is a call-site choice.
- If a native/CLI consumer ever needs it, it ports to the `oristudio-cp` crate
  (which already has a `fold_graph` module) — never `treemaker-core`.

### Core module: `apps/web/src/lib/creasePatternSegmentation.ts`

Pure, no React / store / simulator deps.

```ts
export interface CpSegment {
  id: number;
  faceIndices: number[];        // indices into the SOURCE fold's faces
  boundary: Point[][];          // outer ring + holes, paper coords (clip/thumbnail)
  bounds: { minX; minY; maxX; maxY };
}

// Lightweight: no per-segment fold duplication. Cheap to clone across worker.
export function segmentFoldDocument(fold: FoldDocument): CpSegment[];

// Materialize the sub-fold for ONE segment, lazily, only when simulated.
export function buildSegmentFold(fold: FoldDocument, segment: CpSegment): FoldDocument;
```

**Algorithm — face flood-fill with border walls** (O(V+E+F)):

1. Build an edge→faces map (use `edges_faces` if present, else hash undirected
   `faces_vertices` pairs).
2. Faces are adjacent iff they share an edge whose assignment is **not** `'B'`.
   Border edges are walls.
3. Union-find over faces → each connected face-set is one segment.
4. Per segment: trace boundary rings (edges incident to exactly one face of the
   segment), compute bounds. Keep only `faceIndices` + rings + bounds.
5. Sort deterministically (paper reading order, top-left first) so the default
   "first selected" is stable.

`buildSegmentFold` collects the segment's vertices/edges from `faceIndices`,
re-indexes to a compact `FoldDocument`, and preserves `edges_assignment` and
`edges_foldAngle` so folding behaves identically to the whole-sheet case.

**Why flood-fill (not border-cycle tracing + point-in-polygon):** robust to both
ways multiple CPs occur — fully disjoint patterns separate naturally; patterns
sharing a `'B'` edge separate via the wall rule. Degrades gracefully: no `'B'`
edges → connected components; a single connected CP → exactly one segment
(today's behavior unchanged).

### Worker + store integration

- Extend the treemaker worker `foldArtifacts` path to also return
  `segments: CpSegment[]` (lightweight). Add `segments` to `FoldArtifacts`.
- Store: expose `cpSegments` (already memoized via `foldArtifactRevision`) and
  `selectedSegmentId` + `setSelectedSegment(id)`. Default to the first segment
  whenever the segment set changes. Recompute only on fold change — never on
  view / orbit / selection changes.

### Simulator

- In `SimulatorPanel`, source the fold from the selected segment:
  `buildSegmentFold(baseFold, selectedSegment)` instead of the whole fold.
- Fold `selectedSegmentId` into `simulationSourceKey` so the existing
  dispose → prepare → step → settle cycle swaps models on selection change.
- Net: a smaller model is prepared/stepped → faster than today; idle segments
  cost nothing. Single-segment documents behave exactly as before.

### Prepared-model LRU cache (smooth rapid switching)

The solver is the CPU `DynamicSolver` (the panel passes no `gl`/`canvas`, so no
WebGL context is ever created). Memory per instance is a few `Float32Array`s
sized to the segment; only one controller is live at a time (dispose-before-
create), so switching never accumulates GPU/context memory. The only switch cost
is re-preparation (`buildSegmentFold` → `prepareFoldModel` → `new DynamicSolver`
→ initial settle).

To make rapid switching smooth, cache **prepared `PreparedOrigamiModel`s** (the
output of `prepareFoldModel`, which is immutable and reusable) so re-selecting a
segment skips the prepare step:

- `apps/web/src/lib/preparedModelCache.ts`: a small LRU keyed by
  `foldArtifactRevision + ':' + segmentId`, capacity ~4, value =
  `PreparedOrigamiModel`. `get(key, factory)` returns cached or builds+inserts;
  evicts least-recently-used past capacity.
- The cache stores **prepared models, not controllers** — a fresh
  `DynamicSolver`/controller is still created per selection (cheap; it's just
  the typed-array allocation + settle), so simulation state never bleeds between
  segments. The expensive topology work (`faces_edges`, `edges_faces`, crease
  params, triangulation) is what gets reused.
- Invalidate the whole cache when `foldArtifactRevision` changes (the revision is
  part of the key, so stale entries are simply never hit and age out; on new
  fold we also `clear()` to release memory promptly).
- Capacity bounds memory: at most ~4 segments' prepared arrays retained. This is
  the explicit latency↔memory tradeoff, bounded and small.

### Left sidebar (fixed, embedded)

- `SimulatorSegmentsSidebar` is rendered **inside** `SimulatorPanel` as a fixed
  200px flex column (`.simulator-workspace` row) — NOT a dockview panel, so the
  user cannot drag/rearrange/close it.
- Vertical list of **flat 2D SVG thumbnails** (creases + border), rendered once,
  static — no simulator instances per thumbnail. Highlights the selected
  segment; click → `setSelectedSegment`.
- Hidden when there is ≤1 segment, so single-pattern documents look like today.

### Robustness fixes (found during testing on a real 9-pattern `.ori`)

- **`resolveCpSegments(artifacts)`**: some import paths (e.g. `.ori` →
  `flatFoldArtifacts`) do not carry worker-attached `segments`. Consumers call
  `resolveCpSegments`, which prefers `artifacts.segments` (worker fast-path) and
  otherwise computes them on the main thread, memoized by artifacts identity
  (a `WeakMap`) so it runs at most once per fold. Cheap: 9 segments over 1104
  faces computes instantly.
- **`flatPlaneAxes(fold)`**: the paper plane is not always X-Y — the simulator's
  fold uses `[x, 0, z]` (paper in X-Z, Y is the flat normal). Bounds, boundary
  rings, thumbnails, and segment export pick the two coordinate axes with the
  largest extent, so display geometry is correct regardless of the fold's plane.
  (Segmentation connectivity is index-based and was already plane-independent.)
- **Editable-CP simulation gate** (`SimulatorPanel`): the empty-state check used
  `project.creases.length === 0`, which is always 0 for hand-drawn / imported
  editable crease patterns (they live in `oristudioCpDocument`, not
  `project.creases`). That made the simulator show "No crease pattern" for a
  perfectly valid drawn CP even though the fold artifacts were ready. Fixed by
  also treating a present `oristudioCpDocument` as a simulation source. (Pre-
  existing bug, exposed by testing the segmentation feature on drawn CPs.)

### Export reuse

- `serializeCreasePatternSvg` / `renderCreasePatternPng` gain an optional
  `segment` arg: sets the viewBox to `segment.bounds` and filters creases/facets
  to the segment. Since `TreeProject` creases are float points (not indexed like
  the fold), classify each crease/facet by point-in-`segment.boundary` —
  representation-agnostic, works across the two data shapes.
- Export dialog surfaces the scope choice ("whole" / "selected" / "each")
  only when `cpSegments.length > 1`.

## Performance

- Segmentation: once per fold revision, in the worker, O(V+E+F) — cheaper than a
  single sim frame. Lightweight result (no geometry duplication) crosses the
  worker boundary.
- Sub-fold materialized lazily for only the selected segment.
- Thumbnails: static flat SVG, rendered once; virtualize only if a document ever
  has many segments.
- Simulator: only the selected segment is live; switching reuses the existing
  dispose path.

## Architecture correction: no flat-folding for simulation

Testing a document with several disconnected crease patterns surfaced a
foundational issue and a wrong assumption:

- The Rust flat-folder (`flat_fold_artifacts` → `solve_flat_fold`) walks a single
  connected face graph, so it throws on multiple disconnected crease patterns
  ("vertex N was not reached by the face traversal"). We had been feeding the
  simulate path through it.
- But **the interactive simulator does not need flat-folding**. `origami-simulator`
  folds the flat pattern itself via physics; it only needs **planar faces + M/V
  assignments**. Faces come from a connectivity-agnostic planar face tracer that
  already exists in JS (`buildPlanarFaces` / `inferTopology` in
  `creasePatternImport`), which the `.cp`/`.fold` import path already used.
- `folded_base` (the Rust flat-folded snapshot) is dead product data — never
  rendered; it only spuriously gated an error status.

**Change:** the editable-CP simulate path (drawn CPs + `.ori`, and CP imports)
now builds simulation artifacts entirely in JS via `foldArtifactsFromFold`
(infer faces → prepare model). No flat-folding, so any number of disconnected
crease patterns works. The Rust `flat_fold_artifacts` binding was removed from
the product worker/JS. (The tree path still uses TreeMaker's own
`fold_artifacts`, which produces a single connected CP.)

Removed: `flatFoldArtifacts` worker method + wasm import, `withFlatFoldArtifacts`
/ `withFlatFoldError`, the `folded_base_error` status gating, and the interim
`foldComponents.ts` split/merge workaround.

## Affected Areas

- `apps/web/src/lib/creasePatternSegmentation.ts` (new)
- `apps/web/src/workers/treemakerWorker.ts` + `engineRuntime.ts` (return segments)
- `apps/web/src/engine/types.ts` (`FoldArtifacts.segments`)
- `apps/web/src/store/workspaceStore/*` (selectedSegmentId, selectors)
- `apps/web/src/components/panels/SimulatorPanel.tsx` (source selected segment)
- `apps/web/src/components/panels/SimulatorSegmentsPanel.tsx` (new sidebar)
- `apps/web/src/store/layoutStore.ts` (`applySimulateLayout` docks sidebar)
- `apps/web/src/lib/creaseExport.ts` (+ export scope) and its dialog/menu

## Checklist

- [x] `creasePatternSegmentation.ts`: `segmentFoldDocument` + `buildSegmentFold` +
      `pointInSegment` + `segmentThumbnailSvg` + unit tests
- [x] Worker returns lightweight `segments`; `FoldArtifacts.segments` typed
- [x] Store: `selectedSegmentId`, `setSelectedSegment`, default-first (lifecycle
      tied to fold resource factories)
- [x] `SimulatorPanel` simulates the selected segment via `buildSegmentFold`
      (memoized; source key embeds revision + segment id)
- [x] `preparedModelCache.ts` LRU (cap 4) + wired into panel; cleared on new fold
- [x] `SimulatorSegmentsPanel` sidebar with flat 2D thumbnails + selection
- [x] `applySimulateLayout` docks the sidebar; `simulator-segments` mapped to the
      simulate workspace + registered as a panel component
- [x] Export: reusable `serializeSegmentSvg` / `renderSegmentPng` (fold-based, so
      independent of TreeProject coordinate space) + unit test
- [x] Tests: segmentation (disjoint, border-adjacent, interior-crease, empty) +
      LRU cache + segment export
- [x] Validate: `lint:web`, `typecheck:web`, `test:web` (410 passing), `build:web`,
      browser preview (triad → 1 segment, sidebar + thumbnail + simulator confirmed)

## Remaining follow-ups (not in this pass)

- Export **scope UI**: the reusable per-segment export functions exist and are
  tested, but the export dialog does not yet surface a "whole / selected / each"
  picker (`requestCreasePatternExportOptions` + menu wiring). The library work is
  done; only the dialog/menu wiring remains.
- The sidebar is always docked in the Simulate workspace (shows a single card for
  single-pattern documents) rather than auto-hiding at 1 segment. Auto-hide would
  require reactive dockview layout mutation vs. the current static layout.
