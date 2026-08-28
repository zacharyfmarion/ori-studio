# Planar Face Inference: One Vertex Identity, One Source of Faces

## Goal

Fix the torn simulation of `broken_simulator.osf`, and remove the class of bug
behind it.

Two independent defects compose into the visible failure. They are fixed in two
separate PRs, in this order:

1. **PR 1 (web).** The JS planarizer identifies vertices by an exact
   `toFixed(9)` string key. `toFixed` preserves the sign of a negative that
   rounds to zero, so `(0)` and `(-9.09e-15)` hash to `"0.000000000"` and
   `"-0.000000000"` — two vertices at the same location, and a sheet torn
   between them. Give the JS planarizer the epsilon vertex merge the Rust kernel
   already uses.
2. **PR 2 (kernel).** Reaching that JS planarizer at all is the second defect. A
   document holding two disconnected crease patterns fails an Oriedita Euler
   gate, the kernel emits no faces, and the web silently falls back to its own
   planarizer. Compute faces per connected component in the kernel so the live
   editing path stops using the JS planarizer entirely.

PR 1 unblocks the reported file. PR 2 is what removes the class. Neither
subsumes the other: PR 1 is still required after PR 2 because the JS planarizer
permanently owns `.cp` / `.fold` import, where kernel faces do not exist by
definition.

### Verified background

Established by direct experiment, not inference — record here so the next
reader does not re-derive it:

- **The kernel is faithful to Oriedita, not broken.** Upstream's
  `FoldExporter.toFoldSave` does the same `boolean includeFaces =
  pointSet.calculateFaces(); if (includeFaces) { … }`, and the Euler gate lives
  in `PointSet.java:428-441`. Upstream's own comment calls it a rounding-error
  detector for a single sheet. `F − E + V = 1` holds per connected component, so
  k components score k; two disjoint squares score 2 and are rejected as if they
  were rounding damage.
- **The kernel is only gated, not incapable.** Given the exact failing geometry:
  whole document → 10 vertices, **0 faces**; each component alone → 5 vertices
  (centre stays a *single* vertex at `9.09e-15, -9.09e-15`) and **4 correct
  faces**. `face_request` is per-line and purely local.
- **The per-component composition already exists in Rust**, in the 3D folding
  path (`folding3d/cells.rs:254-260`): `for component in
  connected_components(&segments) { FoldGraph::from_segments(&component, true) … }`.
- **Why the JS path exists.** `inferTopology` arrived 2026-05-19 (`8bbfc3de`)
  for FOLD/CP *file* import — one day before the `oristudio-cp` kernel was
  scaffolded (`b6c92c2a`). It was promoted onto the live simulate path
  2026-07-08 (`511d9868`) for a correct reason (the Rust **flat-folder**
  `solve_flat_fold` walks a single connected face graph, and the interactive
  simulator does not need flat-folding at all). But "stop flat-folding" was
  implemented as "build faces in JS"; dropping the flat-folder never required
  dropping the kernel's face finder. The conflation survives in the comment at
  `creasePatternSlice.ts:1125`.

## Approach

### PR 1 — Epsilon vertex identity in the JS planarizer

**Where.** `vertexId`, inside `splitSegments`
(`apps/web/src/lib/creasePatternImport.ts:666`), and its `roundKey` helper
(`:1087`). `splitSegments` has two callers — `inferTopology` (`:526`) and
`foldFromSegments` (`:492`, the `.cp`/`.ori` import path) — so both are fixed by
one change.

**What to build.** Replace the string-key map with the same structure the kernel
uses (`fold_graph.rs:565-615`): a bucket hash plus a 3×3 neighbour probe plus a
distance compare.

```
bucket(p) = (floor(p.x / BUCKET), floor(p.y / BUCKET))
index_of(p):
  scan the 9 buckets around bucket(p)
  among all candidates within EPSILON of p, return the LOWEST index
  otherwise push p as a new vertex
```

Three details carry real weight:

- **Tolerance = the file's existing `EPSILON` (1e-8).** Not an arbitrary pick,
  and deliberately *not* the kernel's `Epsilon::POINT` (2.5e-4, ~4 orders
  larger). The emit loop in the same function already declares 1e-8 to mean
  "same point" — it drops any sub-edge with `distance(a, b) < EPSILON` (`:684`).
  The vertex index currently disagrees with its own emitter; this makes them
  agree. It also covers the failure mode with margin: a quantization-induced
  split puts the twins at most ~1e-9 apart, and the observed pair is 1.3e-14.
  Adopting the kernel's much larger tolerance would be a real behaviour change
  to import and is explicitly out of scope.
- **Lowest matching index wins.** The kernel does this
  (`found.map_or(candidate, |best| best.min(candidate))`) so the result cannot
  depend on bucket iteration order. Mirror it, or the output is
  non-deterministic across engines.
- **`BUCKET = 4 * EPSILON`,** mirroring `VERTEX_BUCKET = Epsilon::POINT * 4.0`.
  The bucket must exceed the merge radius or a 3×3 probe stops being sufficient.

**Explicit non-goal.** Do **not** "fix" `uniqueSorted` (`:1054`). It also passes
through `toFixed`, but its values land in a `Set`, and `Set` uses SameValueZero —
`+0` and `-0` already collapse there. It is not affected.

**Also out of scope:** this does not address genuinely near-coincident geometry
(sliver creases at ~1e-5). That is a separate concern with its own history; see
the sliver notes in `cp-export-sliver-kills-fold` territory. Do not widen the
tolerance to chase it here.

**Invariant to preserve.** For any document with no pair of points within
`EPSILON`, output must be **byte-identical** to today — including vertex order,
which is preserved because dedup only removes duplicates from a first-seen
ordering. Pin this on the `iguana_24` corpus fixture.

**Regression test.** Reuse the established idiom rather than inventing one. The
"every M/V crease is incident to exactly two faces" invariant in
`simulationCorpus.test.ts:42-53` already detects this defect — verified: the
broken document yields **2 orphaned creases** (`[1,4]` M and `[3,5]` V, the two
halves of the split diagonal), and zero after the fix. Add a focused case in
`creasePatternImport.test.ts` built from the minimal geometry (a square with both
diagonals whose centre is `(+9.09e-15, −9.09e-15)`), asserting one centre vertex,
four triangles, and no orphaned creases.

### PR 2 — Per-component faces in the kernel export

**Where.** `FoldGraph::from_model_for_export` (`fold_graph.rs:92`) and its sole
caller `export_fold_document` (`io/fold.rs:335`, gate at `:376`). That single
caller is the whole reason this is a safe seam.

**Compose; do not modify the ported primitive.** `calculate_faces`
(`fold_graph.rs:251`) and `from_segments` must come out of this PR unchanged.
Everything folding-related keeps calling them exactly as today, so
`face_positions`' `DisconnectedFaces` refusal and the folding oracle are
untouched. This is the same discipline `folding3d/cells.rs` already follows.

**Shape.**

1. Lift `connected_components` (`folding3d/cells.rs:420`) and `root` (`:442`) out
   of `folding3d` into a shared location (`fold_graph.rs` is the natural home)
   and have `cells.rs` use the lifted copy — no behaviour change there.
2. Extend it to return, per component, the **original line indices**, not just
   the segments.
3. In `from_model_for_export`: build the whole-document graph as today (it owns
   the canonical point and line indexing, which the per-edge arrays in
   `export_fold_document` are all parallel to). If `include_faces` is already
   true, stop — single-component documents must take a byte-identical path.
4. Otherwise, per component: build a sub-`FoldGraph` from that component's
   segments, call the **unmodified** `calculate_faces`, and remap its face rings
   back to whole-document point indices.
5. Rebuild `line_face_borders` globally from the remapped faces via the existing
   `line_face_borders_from_incidence` (`:292`).

**The remap needs no geometric lookup.** A component's sub-graph derives its
points from the same coordinates, with the same `VertexIndex`, walking a subset
of the segments in original order — so local point *k* is the *k*-th distinct
whole-document point encountered walking that component's lines. Because step 2
carries the line indices, the whole-document graph's own `lines` array gives that
mapping by replay. Do not re-look-up points geometrically; two merges that
disagree would be a silent corruption.

**All-or-nothing.** If **any** component's own Euler gate fails, emit no faces at
all — exactly today's behaviour. This preserves the contract that a present
`faces_vertices` means "trustworthy arrangement", which is what upstream's gate
actually asserts. Do not emit a partial face set.

**Parity.** This is a deliberate, documented divergence and needs a `PORTING.md`
entry alongside the existing ones. Note for scoping: the parity test
`fold_topology_matches_oriedita_wireframe_oracle`
(`tests/oriedita_io_oracle.rs:219`) asserts on `export_fold_document` output
including `faces_vertices.len()` — but **both of its cases are
single-component**, so it will not break. That also means the divergence is
currently unpinned, so add a two-disjoint-squares case asserting that Oriedita
says `includeFaces=false` where we now emit faces. An untested divergence is
worse than the bug.

**Web follow-through** (same PR — the kernel change is not observable without
it):

- Rebuild the bridge before trusting anything in the browser:
  `npm --workspace @treemaker/web run build:oristudio-cp-wasm`. No wasm artifact
  is tracked, and lint/typecheck/vitest all pass over a stale `.wasm`.
- Correct the stale comment at `creasePatternSlice.ts:1125-1128` — it credits the
  flat-folder for a limitation that belongs to the face finder.
- The fallback now means something different. An absent `faces_vertices` no
  longer means "multi-CP document"; it means "the kernel judged this arrangement
  numerically untrustworthy". Push a diagnostic warning when `inferTopology` runs
  on a *live kernel document* (not on file import, where it is normal). Route it
  through i18n if it surfaces in the UI; the existing
  `diagnostics.warnings.push` strings at `:529` are raw English, so match
  whatever that path actually renders.

**What must not change.** `folding` / `folding3d` face behaviour; the
`DisconnectedFaces` refusal; single-component export output.

## Affected Areas

PR 1:

- `apps/web/src/lib/creasePatternImport.ts` (`vertexId`, `roundKey`)
- `apps/web/src/lib/creasePatternImport.test.ts` (new case)
- `apps/web/src/lib/simulationCorpus.test.ts` (unchanged-output pin)

PR 2:

- `crates/oristudio-cp/src/fold_graph.rs` (`from_model_for_export`, lifted
  `connected_components`)
- `crates/oristudio-cp/src/folding3d/cells.rs` (use the lifted helper)
- `crates/oristudio-cp/src/io/fold.rs` (unchanged logic; verify the `:376` gate)
- `crates/oristudio-cp/tests/oriedita_io_oracle.rs` (divergence case)
- `crates/oristudio-cp/tests/io.rs` (multi-component export coverage)
- `PORTING.md` (divergence entry)
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` (comment,
  fallback diagnostic)

## Checklist

### PR 1 — web epsilon vertex identity

- [x] Replace `vertexId`'s string-key map with bucket + 3×3 probe + `EPSILON`
      distance compare; lowest matching index wins
- [x] `BUCKET = 4 * EPSILON`
- [x] Leave `uniqueSorted` alone; note why in a comment so it is not "fixed" later
- [x] Focused test: square with `(+9.09e-15, −9.09e-15)` centre → one centre
      vertex, four triangles, zero orphaned M/V creases
- [x] Pin unchanged output on `iguana_24` (vertex count, order, face count)
- [x] `npm run lint:web && npm run typecheck:web && npm run test:web`
- [ ] Verify the reported file in the browser: Simulate tab **and** an inline
      simulation window both fold as one sheet

### PR 2 — kernel per-component faces

- [x] Lift `connected_components` / `root` into `fold_graph.rs`; `cells.rs` uses
      the lifted copy with no behaviour change
- [x] Return per-component line indices
- [x] Per-component face pass in `from_model_for_export`, remapping by replay
- [x] All-or-nothing gate: any component failing → no faces
- [x] Rebuild `line_face_borders` from the remapped faces
- [x] `calculate_faces` and `from_segments` unchanged — confirm by diff
- [x] Single-component export byte-identical (assert against a stored expectation)
- [x] Oracle divergence case: two disjoint squares, Oriedita `false` vs. our faces
- [x] `PORTING.md` entry
- [x] `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings
      && cargo test --workspace`
- [x] Oriedita parity run (see `tools/oriedita-oracle/README.md`):
      `ORIEDITA_GEOMETRY_ORACLE=tools/oriedita-oracle/build/oriedita-geometry-oracle
      cargo test -p oristudio-cp --test oriedita_io_oracle`
- [x] `npm --workspace @treemaker/web run build:oristudio-cp-wasm`
- [x] Fix the stale flat-folder comment; add the live-document fallback warning
- [ ] Verify in the browser that the multi-CP document now takes the kernel path
      (`inferTopology` no longer runs — confirm, do not assume)

## Risks and open decisions

- **PR 1 tolerance.** 1e-8 is argued from the emitter's existing behaviour, but
  it is a judgement call. If the corpus pin shows any real file changing output,
  stop and reconsider rather than adjusting the number to make tests pass.
- **PR 2 face ordering — investigated, and smaller than it looks.**
  Per-component iteration changes face order for multi-component documents (all
  of component 1, then component 2). Single-component order is unchanged, which
  is what parity covers. Segment ids do **not** follow face order: they are
  assigned after a geometric reading-order sort
  (`creasePatternSegmentation.ts:243`). Face order only survives that sort
  through `Array.prototype.sort`'s stability, i.e. when two regions have
  identical `bounds.minY` *and* identical `bounds.minX` — a region nested in
  another's top-left corner, say. In that tie case ids can swap.

  The consequences are bounded. The only persisted consumer is
  `segmentIdHint` on inline simulation windows, and it is already hardened:
  `resolveInlineSimulationSegment` (`inlineSimulation.ts:421`) uses the hint
  only as a shortcut and only when its boundary still matches, then falls back
  to a full boundary match and returns `null` rather than a nearest-box guess.
  `selectedSegmentId` is store-only and reset on load; `faceIndices` are
  recomputed from the fold every time. So the worst outcome is a different
  default-selected segment and sidebar order on an unusual document — not a
  window simulating the wrong region. **No mitigation needed**; do not add a
  tie-break sort without a reproducing document, since that would change segment
  ids for existing files to fix a cosmetic difference.
- **PR 2 is a parity divergence.** It is justified — upstream's gate is a
  single-sheet numerical check being read as a connectivity verdict — but it must
  be documented and pinned, not quietly introduced.
- **Not fixed by either PR:** the residue itself. The centre lands at
  `9.09e-15` rather than `0` because of how the CP was constructed. That is
  ordinary float behaviour and both fixes tolerate it by design; snapping
  construction output to a lattice is a separate question.
