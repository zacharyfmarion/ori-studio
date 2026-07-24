# Crease Pattern Selection Toolbar

## Goal

Add a floating toolbar that appears in the **Edit** workspace over the crease
pattern when the user's selection forms a complete, self-contained, fully
border-enclosed sub-pattern. The toolbar offers four actions, all scoped to that
sub-pattern (segment):

1. **Fold** — run the Oriedita flat-fold estimate on the segment.
2. **Export** — dropdown of all per-region-capable formats (`.cp`, FOLD, `.ori`,
   `.orh`, SVG, PNG). Image formats open the export-image modal pre-scoped to the
   segment; file formats download directly.
3. **Save to image** — shortcut that opens the export-image modal pre-scoped to
   the segment.
4. **Simulate** — switch to the Simulate workspace with the segment
   pre-selected.

## Key design decisions

- **Unit of operation is a `CpSegment`.** Segmentation already exists
  (`apps/web/src/lib/creasePatternSegmentation.ts`), produces a stable,
  deterministic `segmentId`, and is already the scoping key for both the
  simulator (`selectedSegmentId`) and image export (`options.segmentId`). We reuse
  it rather than inventing a parallel notion of "region".

- **Trigger = exact-segment match.** The toolbar shows only when the current
  crease selection (`oristudioCpSelection.lines`, as a set) is exactly equal to
  the complete CP-line set of one segment — which inherently includes that
  segment's `'B'` border creases. This guarantees a complete foldable region.
  Rejected the looser "selected borders enclose selected interior" reading: it
  admits partial-interior selections that would fold/export as broken CPs.

- **Reuse the existing FloatingToolbar stack.** `CpImageInspector.tsx` is the
  template: `useCanvasObjectAnchor(box, 'model', container)` → `FloatingToolbar`.
  The toolbar lives in screen space, portaled to `document.body`, and tracks
  pan/zoom per-frame by subscribing to the overlay-view store inside the small
  component.

- **Coordinate reconciliation turned out to be identity (verified Phase 0).**
  Selection is CP-line ids in CP-editor model space; segment boundaries live in
  the simulation-fold plane. Tracing the transform end to end:
  `export_fold_document` writes `vertices_coords` as plain `[x, y]` in CP-model
  space (topology dedup only); `prepareFoldModel` maps each point via
  `normalizePoint([x,y]) = [x, 0, y]`; `flatPlaneAxes` on `[x,0,y]` picks axes
  `[0,2]` and reads back `{x: coord[0], y: coord[2]}` = `(x, y)`. Round-trip is
  the identity — **no affine, flip, or scale**. Triangulation (earcut) adds no
  Steiner points, so it introduces no new coordinates and leaves region
  bounds/ordering unchanged, making `segmentId` stable across editor, export, and
  simulate. Therefore the resolver tests CP line midpoints against
  `pointInSegment` directly; a Phase 1 test locks this identity invariant.

- **Per-region export via one uniform seam.** FOLD/SVG/PNG already support a
  sub-region. `.cp/.ori/.orh` come from the WASM kernel handle, so per-region
  export uses a scratch kernel document (import sub-fold → export → dispose). All
  formats flow through one `exportSegment(format, match)` function.

- **Perf: stay off the edit/pan hot path.** Segments require `foldArtifacts` (a
  heavy CP→FOLD export + triangulation). We reuse the existing revision-gated
  cache, ensure it only lazily/debounced when a plausible line selection exists,
  never force, and run the resolver on selection-change only (not per frame). The
  only per-frame cost is the anchor rect, identical to the image tool.

## Approach

### Phase 0 — Verification (done, by source trace)

Confirmed the load-bearing assumptions by tracing the authoritative code:

- [x] CP-model ↔ fold-plane transform is **identity** (`export_fold_document`
      → `normalizePoint` → `flatPlaneAxes`; see Key design decisions). No affine
      needed.
- [x] Border `'B'` creases originate from `LineColor::Black0 → Assignment::Boundary
      → 'B'` — ordinary selectable `line_segments`.
- [x] `segmentId` stable across editor/export/simulate: identical coords +
      triangulation adds no vertices ⇒ identical region bounds ⇒ identical
      top-left ordering.

### Phase 1 — Selection→segment resolver (pure)

New module `apps/web/src/lib/creasePatternSelectionSegment.ts`:

- [ ] `segmentCpLineIds(document, segments)` — for each CP line, test its
      midpoint against each segment via `pointInSegment` (coords are identity —
      no transform); collect the 1-based line ids inside each segment. Memoized
      per `(document, segments)` identity.
- [ ] `resolveSelectedSegment(document, selection, foldArtifacts)
      : SelectedSegmentMatch | null` — returns the segment whose complete CP-line
      set equals `selection.lines` as a set, else `null`. Guards: empty selection,
      missing fold, degenerate transform.
- [ ] `SelectedSegmentMatch = { segment, segmentId, cpLineIds, boundsModel }`
      (`boundsModel` in CP model space, for anchoring).
- [ ] Unit tests: exact match; interior-only selection → null; cross-region
      selection → null; whole-sheet segment; empty/missing inputs.

### Phase 2 — Per-region export seam

New `apps/web/src/lib/creaseSegmentExport.ts` (+ a kernel helper in
`oristudioCpRuntime.ts`):

- [ ] `exportFoldAsKernelFormat(foldJson, 'cp'|'ori'|'orh'): Promise<string>` in
      `oristudioCpRuntime.ts` — scratch handle: import fold → export → dispose in
      `finally`.
- [ ] `exportSegment(format, match, foldArtifacts): Promise<{text, filename}>` —
      FOLD via `buildSegmentFold` + stringify; kernel formats via the helper;
      routes SVG/PNG to the modal path (below), not a silent download.
- [ ] Tests for FOLD + kernel-format sub-region export and scratch-handle
      cleanup on error.

### Phase 3 — Store actions

In `creasePatternSlice.ts` / `projectSlice.ts` (mirroring the
`sendTreeCreasePatternToEdit` handoff pattern):

- [ ] `foldOristudioCpSegment(match)` → `foldOristudioCpDocument({ lineIds:
      match.cpLineIds })`.
- [ ] `exportOristudioCpSegment(format, match, fileService)` — dispatch to the
      seam; image formats call `requestCreasePatternExportOptions({ fold,
      segments, initialOptions: { segmentId, format } })`.
- [ ] `saveOristudioCpSegmentImage(match)` — open the image modal pre-scoped.
- [ ] `simulateOristudioCpSegment(segmentId)` — `setSelectedSegment(segmentId)`
      then `activateWorkspace('simulate')` / navigate `/simulate`.

### Phase 4 — Toolbar component + wiring

- [ ] `apps/web/src/cp-workspace/CpSelectionToolbar.tsx` — reads selection +
      document + cached `foldArtifacts`; lazily/debounced `ensureFoldArtifacts()`
      when a plausible line selection exists; runs the resolver; on match builds
      an `AnnotationBox` from `boundsModel` → `useCanvasObjectAnchor` →
      `FloatingToolbar` with the four controls. Export uses the `DropdownMenu`
      pattern; buttons use `IconButton` (`size="sm" variant="toolbar"`) with
      lucide icons + tooltips.
- [ ] Mount in `CreasePatternPanel.tsx` beside `CpImageInspector`, gated by
      `annotationsInteractive && !editingTextId && !selectedCpImage` plus the
      resolver match.
- [ ] i18n strings (`panels`/`tools`/`toasts`) per `apps/web/CLAUDE.md`, then
      `i18n:extract` / `i18n:check`.

### Phase 5 — Error handling & polish

- [ ] `foldArtifacts` load failure → toolbar silently absent (no crash).
- [ ] Scratch-kernel export failure → dispose in `finally`, surface a toast, no
      orphaned handles.
- [ ] Capture `foldArtifacts`/`segmentId` at action-dispatch time so a
      mid-action edit can't drift the id.
- [ ] Gating tests (image selected, text editing, annotations non-interactive).

## Affected Areas

- New: `apps/web/src/lib/creasePatternSelectionSegment.ts`,
  `apps/web/src/lib/creaseSegmentExport.ts`,
  `apps/web/src/cp-workspace/CpSelectionToolbar.tsx` (+ tests).
- Edit: `apps/web/src/store/workspaceStore/oristudioCpRuntime.ts` (kernel export
  helper), `creasePatternSlice.ts` / `projectSlice.ts` (segment actions),
  `apps/web/src/components/panels/CreasePatternPanel.tsx` (mount + gating),
  `types.ts` (action signatures), i18n catalogs, `theme.css` (minor toolbar CSS).
- Reused unchanged: `FloatingToolbar`, `useCanvasObjectAnchor`,
  `creasePatternSegmentation.ts`, `commandDialogStore`, `CommandDialogModal`,
  simulator segment scoping.

## Open risks

- ~~Coordinate reconciliation~~ — resolved in Phase 0: the mapping is identity.
- **Kernel scratch-document lifecycle** — must guarantee disposal on every path.
- **Border creases as selectable lines** — the trigger assumes enclosing `'B'`
  creases exist as `line_segments`; documents with implicit paper boundaries
  won't trigger (intended).
