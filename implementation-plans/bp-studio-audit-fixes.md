# BP Studio Audit Fixes

## Goal

Address a batch of functional/UX issues found in a manual audit of the Design
workspace's Box Pleating (BP) Studio. Six issues are in scope; two audit notes
are deliberately deferred (see Out of scope).

Scope confirmed with the user:

1. Default symmetry **on** for new BP documents.
2. **Send to Edit** carries the BP grid so the Edit workspace grid units match.
3. Add an **Un-subdivide** (halve grid) button, disabled unless all flaps sit on
   even grid lines.
4. **Length editing** of a symmetric node also updates its mirror partner.
5. **Selecting a node focuses its name box** so you can select-and-type.
6. **Flap drag must not move the viewport** — dragging only affects the flap.

## Out of scope (deferred by the user)

- "Reducing grid size when there is not space" behavior (audit note #7). Today
  the checked shrink silently no-ops when flaps don't fit
  (`grid.rs:225`/`:259`/`:494`). Left as-is for now.
- Broader "make symmetry tools clearer" UX work. Defaulting symmetry on (issue
  1) is considered sufficient for this pass.

## Approach

### 1. Default symmetry on

Symmetry is a web-layer, session-ephemeral concept (not persisted to `.bps`,
not an engine concept). Default state is currently `enabled: false`.

- Change the default `OristudioBpSymmetryState` to `enabled: true` in
  `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts:150` and `:254`.
- The default `loc` is `{0,0}`; enabling via the toggle normally centers the
  axis with `bpTreeSymmetryDefaultLoc(tree.sheet)`
  (`BpTreePanel.tsx:407-417`). Defaulting on must initialize `loc` to the sheet
  center at document/tree creation (and on sheet resize) so the axis renders
  centered, not at the corner. Locate where the BP tree/document is initialized
  and seed `loc` + `angle` there.
- Verify the default axis (angle 90 = vertical book fold) is the desired one.

### 2. Send to Edit respects grid units (scale the CP, do NOT change the Edit grid)

Mechanism: the Edit workspace uses the Oriedita convention — a fixed 400-unit
paper with `grid_size = G` divisions (default 8), so an Edit grid cell is
`400/G` world units. BP export always normalizes to a fixed 400-unit full width
(`cp.rs:24` `CP_FULL_WIDTH`) regardless of the BP sheet dimension `D`, so a BP
cell exports as `400/D` units. The creases fill the paper, but a BP cell only
coincides with an Edit grid cell when `D == G`.

**Decision (per user):** do **not** modify the Edit `grid_size` — other designs
may rely on it. Instead scale the exported CP so **one BP cell = one existing
Edit grid cell**. Export at full width `400 · (D / G)` (equivalently, scale the
standard 400-width export by `D/G`).

- Read `G` from the live Edit doc grid (`crease_pattern.grid.grid_size`, via the
  Edit CP document state) right before export; leave it unchanged.
- Consequence to accept: when `D ≠ G` the design no longer fills the 400 paper —
  it is larger (`D > G`) or smaller (`D < G`) because cell size is preserved
  over overall size. This is the intended trade-off for matching grid units.
- Implementation: thread a full-width / scale option into
  `exportOristudioBpProjectAsCp` → wasm `bp_export_cp` / `bp_project_crease_pattern_snapshot`
  → `CpExportOptions` (`cp.rs:35`) so `transform_matrix` (`grid.rs:123/384/631`)
  uses `400 · D/G` instead of `CP_FULL_WIDTH`. (Alternative: scale the CP text
  geometrically in JS after export — prefer the export-option route to keep
  coordinates exact.) Ensure the diagonal `transform_matrix` half-cell/reorient
  handling still holds under the scaled width.
- Touch point: `sendOristudioBpToEdit` (`oristudioBpSlice.ts:552-580`) computes
  `D/G` and passes it to `exportOristudioBpProjectAsCp`; the Edit-side grid
  setter is NOT called.

### 3. Un-subdivide (halve grid) button

No engine inverse of `subdivide_sheet` exists. Add one.

- **Engine** (`crates/oristudio-bp/src/grid.rs`): add `can_unsubdivide(grid)` and
  `unsubdivide_sheet(grid, anchors) -> BpResult<Option<SheetTransform>>` mirroring
  `subdivide_sheet` (`:845`) but halving (`set_dimension(w/2, h/2)`, 0.5× matrix).
  Guard: enabled only when dimensions are even **and** every flap anchor sits on
  an even grid line (so it halves cleanly). Return `Ok(None)` when the guard
  fails. Respect `MIN_RECT_SIZE`/`MIN_DIAG_SIZE` (`shared.rs`).
- **Session** (`project_session.rs`): add `unsubdivide_layout_sheet` paralleling
  `subdivide_layout_sheet` (`:566`), applying the transform via
  `apply_layout_sheet_transform`.
- **WASM** (`oristudio-bp-wasm/src/lib.rs`): export `bp_unsubdivide_layout_sheet`
  next to `bp_subdivide_layout_sheet`.
- **Runtime/worker**: add `unsubdivideLayoutSheet` in `oristudioBpRuntime.ts`
  (~`:400`) and `oristudioBpWorker.ts` (~`:217`).
- **Store**: add `unsubdivideOristudioBpLayoutSheet` action + a `canUnsubdivide`
  selector (all flaps on even lines & dims even & above min) in
  `oristudioBpSlice.ts`.
- **UI**: add a button immediately next to Subdivide in `BpPackingPanel.tsx:395-402`
  (viewport toolbar), `disabled={!canUnsubdivide}`. Use a matched icon pair:
  **`+` (Plus) for subdivide, `−` (Minus) for un-subdivide** — replace the
  current `Grid2X2` subdivide icon so they read as a pair.
- **Command**: register `bp.layout.unsubdivide` in `oristudioBpCommands.ts`
  (near `:584`).
- Add engine tests for `unsubdivide_sheet` (round-trips subdivide; refuses on
  odd-coordinate flaps).

### 4. Symmetric length editing mirrors the partner

The length editor path (`setEdgeLength` `BpTreePanel.tsx:515-537` →
`setOristudioBpTreeEdgeLength` `oristudioBpSlice.ts:582-597`) never consults
symmetry, so it moves one node and leaves the mirror partner unchanged. Symmetry
mirroring currently only runs on click-add and drag-move.

Pairing is already tracked (two layers, both built): explicit ephemeral pairs
recorded at add-time (`addBpTreeSymmetryPair`) plus geometric inference of the
reflected-position vertex (`mirrorBpTreeVertexId`). The drag path already mirrors
a whole subtree via `buildMirroredBpTreeUpdates`; the length editor simply never
calls it. So this reuses proven machinery.

- Route the length editor's `subtreeUpdates` through `buildMirroredBpTreeUpdates`
  (as `moveOristudioBpTreeVerticesWithSymmetry` `oristudioBpSlice.ts:510-550`
  does) and also apply the length change to the partner edge, all within the
  single `setOristudioBpTreeEdgeLength` undo entry (`:582-597`). Extend that
  action (or `setEdgeLength` in `BpTreePanel.tsx:515-537`) to compute + apply the
  mirrored edge length + mirrored subtree moves when symmetry is enabled.
- Caveat (do NOT solve in this batch): symmetry `pairs` are ephemeral web state,
  not persisted to `.bps`. After save/reload only geometric inference remains, so
  symmetric length editing falls back to position-matching. Persisting pairs is a
  separate, larger change — out of scope here.

### 5. Focus name box on node selection

`BpNameEditor` (`apps/web/src/components/panels/BpNameEditor.tsx`) remounts per
selection (keyed by object id) but is never focused; the user must click it.

- Auto-focus (and select-all) the input when a node becomes the selected flap
  vertex, so selecting a node lets you type its name immediately.
- Guard against stealing focus from other typing contexts; only focus on a fresh
  single-node selection, not on programmatic/multi selection.
- Ensure keyboard shortcuts (delete/nudge) still behave: since focus moves into
  the input, confirm `isViewportInteractiveTarget` (`BpPackingPanel.tsx:1118`)
  correctly suppresses canvas shortcuts while the name box is focused, and that
  Escape/Enter/blur return control cleanly.
- The name editor currently renders only in the tree pane for leaf vertices
  (`BpTreePanel.tsx:1082-1093`); scope the focus behavior there.

### 6. Flap drag must not move the viewport

The flap drag is already clamped to the sheet
(`constrainBpPackingFlapGroupTarget`, `BpPackingPanel.tsx:1299`), and the only
viewport-move code is a `centerView`-based fit guarded to run once per document
(`fitLoadedDocument` `:1071-1092`). No obvious per-drag pan exists, so the exact
trigger for "it moves everything to keep the flap in view" must be reproduced
first.

- **Repro (browser):** drag a flap toward/off the sheet edge and observe what
  moves. Candidate mechanisms to check: the guarded fit re-firing
  (`lastFittedKeyRef`/`fitKey`), `react-zoom-pan-pinch` `<TransformWrapper>`
  behavior (`centerOnInit`, `limitToBounds={false}`, `:1554-1573`), or a
  layout/backend update during drag changing content bounds.
- **Fix:** ensure no fit/`centerView`/`setTransform` runs while a flap drag is in
  progress, and that pointer events on the flap don't reach the pan wrapper.
  Dragging should only change the flap position; the viewport stays put.
- Confirm space-held panning and normal pan/zoom still work after the change.

## Affected Areas

- `crates/oristudio-bp/src/grid.rs` — un-subdivide op + guard (issue 3)
- `crates/oristudio-bp/src/engine/project_session.rs` — un-subdivide session op (3)
- `crates/oristudio-bp/src/io/cp.rs`, `grid.rs` (`transform_matrix`) — grid-unit export (2)
- `crates/oristudio-bp-wasm/src/lib.rs` — `bp_unsubdivide_layout_sheet` (3)
- `apps/web/src/store/workspaceStore/slices/oristudioBpSlice.ts` — default symmetry (1),
  send-to-edit grid (2), un-subdivide action (3), symmetric length edit (4)
- `apps/web/src/store/workspaceStore/oristudioBpRuntime.ts`,
  `apps/web/src/workers/oristudioBpWorker.ts` — un-subdivide bridge (3)
- `apps/web/src/components/panels/BpPackingPanel.tsx` — un-subdivide button (3),
  drag/viewport (6)
- `apps/web/src/components/panels/BpTreePanel.tsx` — symmetric length edit (4),
  name focus wiring (5)
- `apps/web/src/components/panels/BpNameEditor.tsx` — auto-focus (5)
- `apps/web/src/lib/bpTreeSymmetry.ts` — reused for symmetric length edit (4)
- `apps/web/src/lib/oristudioBpCommands.ts` — un-subdivide command (3)
- i18n: any new user-facing strings (button tooltip) need inline `t()` +
  `i18n:extract`/translations per `apps/web/CLAUDE.md`.

## Checklist

- [x] 1. Default symmetry on (enabled + centered axis at creation/resize)
- [x] 2. Send to Edit maps BP grid → Edit grid units
      (engine cp_scale export option; slice passes bpCells/editDivisions; rect
      exact — diagonal uses max(w,h) as an approximation, browser-verify)
- [x] 3. Un-subdivide: engine op + guard + wasm + runtime + store + button (+/−) +
      command + tests + i18n
- [x] 4. Symmetric length editing updates the mirror partner (single undo)
      (slice orchestration over the already-tested mirroring helper; integration
      is browser-verifiable)
- [x] 5. Selecting a node focuses (and select-alls) its name box
- [x] 6. Repro + stop viewport moving during flap drag
      (root cause: SVG viewBox from getBpPackingWorldRect grew to include the
      dragged flap's rect+label, so the viewBox chased the flap; fix freezes the
      viewBox during any pointer drag)
- [ ] Validation: `cargo test --workspace` (engine), wasm rebuild, `npx tsc --noEmit`
      + `npm run test:web` + lint, `npm run i18n:check`; browser verification of
      symmetry default, send-to-edit alignment, un-subdivide, name focus, and
      flap-drag viewport by the author.
