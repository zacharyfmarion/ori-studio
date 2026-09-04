# Porting Discipline

The canonical source of truth is the vendored TreeMaker 5.0.1 C++ source in
`third_party/treemaker-5.0.1`.

This port should not substitute simpler algorithms for TreeMaker behavior. When
an algorithm has not yet been ported directly from the C++ implementation, the
Rust API must return `TreeError::UnsupportedOperation` instead of fabricating a
nearby result.

Current exact/anchored surface:

- v4 fixture parsing follows the `tmTree_IO.cpp`, `tmNode.cpp`, `tmEdge.cpp`,
  and `tmPath.cpp` stream order for model-tester fixtures.
- v5 writing follows `tmTree::Putv5Self` for the model parts currently
  represented in Rust.
- v4 export follows `tmTree::Putv4Self` for the GUI-free node/edge/path surface.
- Condition stream data is typed and feasibility formulas are direct ports of
  the corresponding `tmCondition*::CalcFeasibility()` methods and
  `tmConstraintFns`.
- `tmNLCO_alm` is ported internally in `treemaker-core`, including the ALM
  constants, BFGS inner loop, line search, bound handling, and documented C++
  quirks needed by optimizer parity.
- `tmScaleOptimizer`, `tmEdgeOptimizer`, and `tmStrainOptimizer` are ported for
  the headless all-owned-parts usage exercised by `tmModelTester`.

## Oriedita (`oristudio-cp*`)

Deliberate divergences, each additive — the ported algorithms and their outputs
are unchanged:

- **Restartable fold-solution enumeration.** `FoldingEstimateSession::restart()`
  rewinds to the first layer-ordering solution, and `folding_estimate_to_case`
  uses it to seek *backwards* by replaying the (deterministic) enumeration.
  Oriedita's enumerator is forward-only — `possible_overlapping_search` advances
  search state and nothing retains a solution once it has passed, so asking for
  an earlier case there does nothing. `fold_another` likewise wraps to the first
  solution at the end instead of dead-ending. The search itself, the solutions it
  yields and the order it yields them in are untouched; the oracle test in
  `crates/oristudio-cp/tests/oriedita_folding_oracle.rs` is the gate.
- **`FoldingEstimate.current_fold_case`.** Upstream's `discovered_fold_cases`
  doubles as "which solution is on screen", which only holds while movement is
  forward-only. Backwards navigation splits the two: the count keeps its meaning,
  the shown case gets its own field.
- **Paper shadow geometry.** `FoldedFigureRenderOptions::shadow_geometry`
  selects between `OrieditaExact` and the default `Refined`; only the band
  rectangles differ, and which edges cast at all is otherwise unchanged.
  `FoldedFigure_Worker_Drawer` derives the shadow's offset length from
  `getBegin(lineId)` — the 1-based *point id* — used as an x-coordinate, so a
  band comes out `10 · edgeLength / unrelatedNumber` wide instead of a constant
  10. On the kabuto fixture that is a 5.1× spread within one figure, with width
  tracking edge length. The same function then asks which side of the edge the
  paper is on by sampling at `midpoint + ε · offset` and accepting anything that
  is not `Outside`; because the sample sits inside `Polygon::inside`'s `Border`
  tolerance, both directions often pass and the edge is shadowed twice.
  `Refined` divides by the edge's true length, samples a fixed distance along
  the unit normal, and requires a strict `Inside` — one constant-width band per
  shadowed edge. `OrieditaExact` keeps the upstream arithmetic verbatim and is
  what `folded_figure_paper_render_snapshot_from_segments` renders, so the
  render oracle in `crates/oristudio-cp/tests/oriedita_render_oracle.rs` remains
  a byte-for-byte gate.

- **Kernel-side snapping states its candidates.** `SnapCandidates` (grid state
  plus a vertices flag) is threaded into
  `snap_to_close_point_in_active_angle_system`, the port of
  `CreasePattern_Worker.getClosestPoint`. Upstream reads the grid state straight
  off the UI and always searches vertices, because grid visibility is its only
  snapping control; Ori Studio has a Snapping toggle, so the frontend states the
  effective policy in the command payload. Omitting it reproduces upstream
  exactly — every vertex, and the grid the document declares — and that is what
  headless callers and the oracle tests use. The lattice search itself
  (`GridMetadata::closest_grid_point`, ported from `Grid.closestGridPoint`) is
  faithful, quirks included: the cell's long diagonal bounds the window, and an
  empty scan answers with the origin rather than with "none".
  `closest_grid_point_matches_oriedita_oracle` and
  `angle_restricted_5_with_grid_matches_oriedita_oracle` gate both against the
  real `Grid` class.
- **A disconnected fold graph is a typed refusal.** `FoldGraph::face_positions`
  returns `FoldGraphError::DisconnectedFaces { reached, unreached }` instead of
  walking off the end of a dual graph that has more than one component.
  `WireFrame_Worker.getFacePositions()` has no exit for this at all: its
  `while (remaining_facesTotal > 0)` loop keeps re-scanning an empty frontier
  until the thread is interrupted, so upstream's behavior here is a hang, not a
  result to be faithful to. Ori Studio already diverged by breaking out of that
  loop, and the break was worse than the hang — every unreached face kept
  `associated_line: None`, `fold_movement` reads that as "leave this point where
  it is", and the figure came back with an *unfolded* slab in it, reporting `Ok`.
  The Euler gate in `calculate_faces` hides the small cases (two disjoint squares
  score `euler == 2` and are rejected), but its `0.005 * faces.len()` tolerance
  admits a disconnected line set from ~200 faces up. The refusal reaches the
  frontend as engine code `fold_disconnected`. Nothing about the walk itself, the
  order it visits faces in, or any successful result changes; the folding oracle
  in `crates/oristudio-cp/tests/oriedita_folding_oracle.rs` is the gate.

- **The FOLD export runs Oriedita's Euler gate per connected component.**
  `FoldGraph::calculate_faces_per_component` re-runs the gate once per component
  when the whole-document pass refuses, and emits the union of the faces. Upstream's
  `FoldExporter.toFoldSave` writes faces only when `calculateFaces()` returns
  true, and that ends in the gate at `PointSet.java:428-441`, whose own comment
  reads a failure as damage: "something wrong caused by the rounding error and we
  cannot possibly expect a valid folding result". But `F - E + V == 1` counts the
  bounded faces of *one* connected arrangement — k components score k — so a
  document holding two crease patterns scores 2, and its faces never reach the
  file. Ours then cost the whole document its faces and the web inferred its own,
  through a planarizer whose vertex identity did not match the kernel's.

  Be careful not to overstate that gate, which is easy to do. Upstream does
  **not** refuse such a document, and Oriedita's canvas holds disjoint patterns
  perfectly well: `calculateFaces` returns early with `faces[]` and `numFaces`
  intact — skipping only `findLineInFaceBorder()` — and
  `WireFrame_Worker.setLineSegmentSet` (`:213`) calls it while discarding the
  boolean. The faces exist upstream; the gate is a trust signal that exactly one
  caller acts on, and that caller is the FOLD exporter. What upstream cannot do
  with several patterns is *fold* them, because `getFacePositions` walks a dual
  graph it assumes is connected (see the disconnected-fold-graph entry above).

  Each component is a single connected arrangement, which is what the gate
  assumes, so this composes around `FoldGraph::calculate_faces` rather than
  editing it — the same shape `folding3d::cells` already uses. One component
  failing refuses the whole
  document, so a present `faces_vertices` still means the arrangement was judged
  sound rather than merely that part of it was. Nothing runs for a
  single-component document, so the folding paths and every existing parity case
  see byte-identical output;
  `fold_topology_diverges_from_oriedita_only_for_disconnected_patterns` in
  `crates/oristudio-cp/tests/oriedita_io_oracle.rs` pins the divergence against
  the real `PointSet`, and asserts the vertices and edges still match exactly.

- **Self-loops take no part in the Euler gate.** `FoldGraph::calculate_faces`
  skips a line whose two endpoints welded to the same graph vertex, both when
  tracing faces and when counting `E`. `PointSet.calculateFaces` walks every line
  and counts every line, with no degenerate guard.

  A line becomes a self-loop exactly when it is shorter than `Epsilon::POINT` —
  a crease whose own endpoints `VertexIndex` cannot tell apart. It bounds no
  face, so tracing it fabricates a ring that walks into itself and counting it
  inflates `E`; either alone moves the Euler sum off 1. Upstream can afford that
  because its non-1 arm is a warning it hopes never fires ("something wrong
  caused by the rounding error"), and the faces survive it. Ours is a refusal
  (see the entry below), so the same input costs the document every face it has
  and the fold reports `fold_faces_unresolved`. That is how a shared crease
  pattern came back unfoldable when the editor it left had folded it: the web
  planarizer cut two creases 4.6e-5 and 1.1e-4 short of the vertex they end on,
  and the tails made the round trip as creases.

  The lines stay in `self.lines`. Callers address segments by index —
  `exact_solve_input_from_fold` places by edge position, resting on
  `from_segments` emitting one line per input segment — so removing them here
  would silently misplace geometry elsewhere. Pinned by
  `a_sub_tolerance_crease_does_not_discard_every_face` in `fold_graph.rs` and
  `sub_tolerance_creases_do_not_stop_a_fold` in `tests/folding.rs`; no fixture
  without a sub-tolerance crease changes, so the folding and FOLD-export oracles
  see identical output.

- **A failed Euler gate clears our faces; upstream keeps them.** *(Known gap, not
  a decision — predates the per-component work above and is not relied on by it.)*
  `FoldGraph::calculate_faces` sets `self.faces = Vec::new()` when the gate fails.
  `PointSet.calculateFaces` instead returns early with `faces[]` and `numFaces`
  populated, so a caller that ignores the boolean still has them, and
  `WireFrame_Worker.setLineSegmentSet` (`:213`) is exactly such a caller. Upstream
  therefore treats a failed gate as a warning; we turn it into a refusal. Every
  current consumer of `include_faces` reads a false verdict as "no faces", so
  nothing observable depends on the difference today — but it is a real
  divergence, it is not recorded anywhere else, and a future caller that wants
  upstream's behaviour will not find the faces where upstream would.

- **A FOLD folded form is refused, not flattened.** `io::fold::import_fold_document`
  returns `IoError::FoldedForm` — engine code `fold_folded_form` — for a frame
  that declares `frame_classes: ["foldedForm"]`, and for any vertex further than
  1e-9 off the paper plane. Oriedita's `FoldFileFormat` has no such refusal; it
  reads the first two components of each `vertices_coords` entry and drops the
  rest, so a folded state imports as its own shadow — a plausible-looking crease
  pattern whose creases are wherever the projection put them. Measured on the
  corpus's `MoosersTrainRigid-Gardner.fold`, all 246 spatial vertices fail
  closure after that round trip. Per AGENTS.md the operation has not been
  ported, so it errors rather than producing a nearby result. Two independent
  signals because either can be present without the other: a declared class
  (which a *flat*-folded state can carry while sitting entirely in z = 0) and
  real out-of-plane geometry (which a file can carry with no class at all). An
  explicit `z` of exactly zero still imports, because `[x, y, 0]` is how plenty
  of writers spell a flat pattern.
  **Consequence for our own files.** `apps/web/src/lib/foldedExport.ts` writes
  `frame_classes: ['foldedForm']`, so Ori Studio's folded-form FOLD export is
  refused by Ori Studio's FOLD importer, deliberately: that export is for other
  tools, not a round trip. `creasePatternImport.ts`'s frame scoring now ranks a
  `foldedForm` frame *below* an unclassified one, so a file carrying both frames
  opens its crease pattern; a file carrying only the folded form reaches the
  refusal by name. Pinned by `a_declared_folded_form_frame_is_refused_rather_than_flattened`,
  `out_of_plane_vertices_are_refused_rather_than_projected`,
  `an_explicit_zero_z_still_imports` and the two `foldedExport.test.ts` cases.

- **Bounded lengthen extensions.** `operations::transform::lengthen_crease`
  refuses an extension longer than the diagonal of the box already containing
  every crease (`MAX_LENGTHEN_EXTENSION_DIAGONALS`). Upstream has no such limit:
  `MouseHandlerLengthenCrease` decides whether a crease can reach a target purely
  from `OritaCalc.isLineSegmentParallel(s, closestLineSegment, Epsilon.UNKNOWN_1EN6)`,
  which compares the *unnormalized* cross product `a1*b2 - a2*b1` against a fixed
  absolute epsilon. That quantity is an area — it scales with both segment
  lengths — so the effective angular tolerance is `epsilon / (len1 * len2)`. For
  creases hundreds of units long it drops below the floating-point noise in the
  coordinates themselves, creases that are parallel by construction read as
  crossing, and `findIntersection` answers with a point arbitrarily far away.
  Coordinates far from the origin make it worse, because the same construction
  leaves proportionally more dust in each one. Observed in a user file at
  x ≈ 14,000: three pleat columns ~5.8e-12 rad off parallel extended to
  y ≈ -4.3e12, which put the document's bounds 8 orders of magnitude past its
  content and made the editor unusable. This bound only rejects results; it does
  not touch the parallel test, the intersection solve, or any accepted output,
  and `lengthen_crease_matches_oriedita_oracle` remains the gate.

- **The flat-foldability check is evaluated with orientation-invariant
  arithmetic.** `checks::check4` and `checks::check3` default to
  `CamvAngleArithmetic::Refined`, which differs from upstream in two evaluations
  that are identities in exact arithmetic and are not identities in `f64`.
  Upstream's are reachable as `CamvAngleArithmetic::OrieditaExact`, and that is
  what `check4_matches_oriedita_foldlineset_oracle`,
  `check_camv_task_matches_oriedita_task_oracle` and
  `check3_matches_oriedita_foldlineset_oracle` ask for, so the Java remains the
  gate on the ported behaviour.

  The larger one is the crimp reduction's `maxAngle -= 2.0 * minAngle`
  (`Check4.java:246`), which shrinks the working range by twice the *global
  minimum* sector where the geometry removes twice the *collapsed* sector. The
  tie test `|tmpAngle - minAngle| < Epsilon.FLAT` (`:230`) is what makes those
  the same number — but its window is 1e-6 **degrees**, and several sectors can
  sit inside it. On a solved crease pattern from CP detection, four sectors at
  one vertex lay within 8.2e-7 of each other, so four different pairs qualified
  and the `SortingBox` order decided which collapsed. That order starts at the
  ray with the smallest absolute bearing, so *rotating the pattern changed the
  verdict*: the same file reported 3/3/2/3/2/5 violations under the six bit-exact
  coordinate transforms, with a union of 7 sites and an intersection of **0**.
  99.68% of the surviving vertex's residual came from this substitution; 0.32%
  was real geometry. Subtracting the collapsed sector makes the final residual
  the Kawasaki alternating sum, which every legal merge preserves exactly, so the
  verdict stops depending on the path.

  The smaller one is the ray bearing. `OritaCalc.angle` (`OritaCalc.java:71-97`)
  is `Math.acos(x / L)` — the vendored tree contains no `atan` at all — and
  `acos` is ill-conditioned as its argument approaches ±1, i.e. for a
  near-horizontal ray, since `dθ/dc = -1/sin θ`. Measured over 200k rays per
  band: 9.9e-7° of error near bearing 0° against a 1e-6° bar, versus 2.8e-14° at
  45° and 90°. `Refined` uses a well-conditioned bearing local to `checks.rs`.

  Neither is sufficient alone — exact subtraction over `acos` bearings still
  flips three vertices, a better bearing alone flips four — and this is a
  strictly *sharper* check, not a laxer one: a vertex genuinely missing Kawasaki
  by 1.4e-6° is caught in six orientations of six where upstream's arithmetic
  catches it in three (`a_real_violation_is_caught_in_every_orientation`).
  `geometry::angle` itself is untouched, along with every one of its nineteen
  call sites outside these checks, and so are `Epsilon::FLAT`, the algorithm's
  control flow, and the big-little-big condition.

- **Flip Mountain/Valley also flips a direction hint.** `CreaseToggleMv`'s
  dispatch runs the port and then
  `operations::native::direction_hint::flip_direction_hints`, so the tool
  reverses a *stated* fold direction wherever the document states one — in a
  crease's colour, or in the `fold_direction_hint` an unassigned crease carries.
  The ported half is untouched: `operations::color::toggle_mountain_valley` is
  still exactly `LineColor.changeMV`, still `Red1 <-> Blue2` and identity on
  everything else, and still gated by the `foldline-change-mv` case in
  `crates/oristudio-cp/tests/oriedita_operations_oracle.rs`. The two gates are
  disjoint (`Red1`/`Blue2` against `LineColor::None`), so the counts add and no
  line is flipped twice.

  Upstream could not have an opinion here. `MouseHandlerCreaseToggleMV` filters
  with `l.getColor() == BLUE_2 || l.getColor() == RED_1` — applied by
  `BoxSelectLinesStepNode` to the box, the click fallback *and* the hover
  highlight — and `LineColor.NONE` is declared in the Java source but never
  reached by a handler, so an unassigned crease is not a state Oriedita's C tool
  can encounter. The hint is ours (see `operations/native/direction_hint.rs`).

  Both input paths move together, because a divergence that held for the click
  and not the drag box would make one tool mean two things: the box flips every
  stated direction it encloses. A *bare* unassigned crease is skipped — it
  states no direction, and seeding one would be the tool inventing a decision;
  `CreaseSetDirectionHint` is the verb for stating one.
  `crates/oristudio-cp/tests/toggle_mv_command.rs` pins both paths.

  `CreaseAdvanceType` (`CREASE_ADVANCE_TYPE_30`) deliberately does **not** get
  the same treatment. Its cycle is Oriedita's list of line *types* — unselected
  edge, selected edge, mountain, valley — and unassigned is not one of them
  (`LineColor.isFoldingLine()` excludes it, and `CustomLineType` has no member
  for it), so inserting it would be a fabricated extension of a ported cycle
  rather than an additive divergence. An unassigned crease reaches it as the
  handler's final `else`: removed and re-added unchanged, which is upstream's
  own behaviour for every colour outside the cycle.

- **Make Auxiliary also converts an unassigned crease.**
  `MouseHandlerCreaseMakeAux` gates on `LineColor.isFoldingLine()` — `Black0 |
  Red1 | Blue2` — via `BoxSelectLinesStepNode`. Over the colours Oriedita's UI
  can produce, that predicate and *"not already an auxiliary line"* are the same
  set: every line is either a folding line or one of `Cyan3..=Grey10`. The second
  reading is the gate's purpose — it is `MouseHandlerCreaseMakeMountain`'s
  `!= RED_1` in the shape this handler needs — and the two differ on exactly
  `LineColor::None`, which upstream declares and no handler reaches. So
  `operations::color::make_aux` admits it, and an already-auxiliary line is now
  the only thing the gate turns away.

  This is the third colour gate that could not see our unassigned state, and it
  failed the way the other two did: the menu item is enabled by selection alone,
  so "Make Auxiliary" on an unassigned crease did nothing and said nothing.
  Declining an *aux* line is not the same silence — the postcondition "this line
  is auxiliary" already holds there, so zero is the honest count, which is the
  law `unassign`'s `zero_means_the_state_already_holds` pins for its own verbs.

  Parity is untouched: no upstream-reachable colour changes hands, so the
  `foldline-make-aux` case in
  `crates/oristudio-cp/tests/oriedita_operations_oracle.rs` asks the same
  questions and gets the same answers. That oracle could not have caught this in
  either direction — it reimplements the predicate over colours a Java
  `FoldLineSet` can hold, so the one colour at issue is unreachable from it.
  `crates/oristudio-cp/tests/color_operations.rs` covers the widened half.

### Holes in the sheet

`PointSet.calculateFaces` keeps every traced region whose signed area is
positive (`isNonDegenerated`, `PointSet.java:218`), so Oriedita's arrangement
includes a hole cut in the paper as an ordinary face. Upstream's sheet is always
a disk and nothing downstream of that ever asks, so the reading costs it nothing.

**Ori Studio diverges, in `FoldGraph::from_sheet_segments` only.** A face whose
every edge is a boundary edge *and* whose every such edge has a face on the other
side is a hole, and is dropped. The rule is Flat-Folder's
(`third_party/flat-folder/src/io.js:277`, already ported for the other flat
solver at `crates/treemaker-flatfold/src/conversion.rs:75`); the second clause is
ours, because `Black0` here is a palette colour rather than FOLD's `B`
assignment, and without it a square split by one interior border line loses both
halves. A document with no crease at all is left alone: the question "which
regions are paper" has no defensible answer on an all-`Black0` drawing, and
nothing is being folded there anyway.

Two consequences worth stating rather than discovering:

- **The FOLD exporter writes fewer faces than Oriedita would.**
  `from_model_for_export` goes through the sheet constructor, so a holed sheet's
  `faces_vertices` describes paper and omits the hole — 2 faces where upstream
  emits 3. This is deliberate: `faces_vertices` is supposed to be the paper, and
  every FOLD consumer that handles holes filters them itself. No committed
  fixture has a hole, so `oriedita_io_oracle` is unaffected; a holed fixture
  added there would need this recorded as its expected difference.
- **Derived arrangements are excluded by construction.** `folding3d::cells`
  synthesises a per-plane arrangement coloured entirely `Black0`, and the flat
  folder builds one over the folded image's subfaces. Their bounded regions are
  cells and subfaces, not paper. They keep `from_segments`; only drawn sheet
  segments go through `from_sheet_segments`, and the opt-in direction is chosen
  so a missed site keeps upstream's behaviour rather than silently losing cells.

See `research/2026-08-31-holes-in-the-folding-pipeline.md`.

### Folding search coverage

The layer-ordering search is ported whole, and this section exists to say which
parts of it, because the one piece that was missing stayed invisible for a long
time: it was recorded only in a doc comment on the function that refused, so a
crease pattern complex enough to need it simply reported "no layer order".

Ported, and oracle-gated in `crates/oristudio-cp/tests/oriedita_folding_oracle.rs`:

- `FoldedFigure_Worker.possible_overlapping_search` and
  `inconsistent_subFace_request`, with and without swapping.
- `SubFace.possible_overlapping_search`, `ChainPermutationGenerator`, and
  `PairGuide`.
- `AdditionalEstimationAlgorithm` over the Italiano transitive-closure family
  (`fold-additional-estimation-italiano-parity.md`).
- `SwappingAlgorithm` and `SubFaceSwappingAlgorithm`.
- **`CombinationGenerator`**, with `Constraint` / `TernaryConstraint` /
  `QuaternaryConstraint`, `ReductionItalianoAlgorithm`, and
  `TraceableItalianoAlgorithm`. Upstream switches to it once a SubFace's
  permutation generator passes 2000 permutations — that number is Oriedita's own
  switch point between two algorithms, not a cap on how hard a model may be.
  Until this landed the port had no accelerator and returned
  `SubFaceSearchError::CombinationGeneratorRequired` at exactly that point, so
  every crease pattern past it lost its layer ordering. See
  `implementation-plans/fold-combination-generator-parity.md`.

Not ported, and refused rather than approximated:

- **Custom top/bottom face constraints inside the SubFace search.**
  `ChainPermutationGenerator` carries `setTopIndices` / `setBottomIndices` and
  honours them, but `SubFace.setGuideMap`'s `CustomConstraint` wiring and
  `customConstraintsInconsistentDigitRequest` have no Rust counterpart, so the
  search behaves as if no custom constraint were set. Nothing in the Rust stack
  sets one yet; the constraints reach the port only as
  `FoldedFigureRenderOptions::custom_constraints`, which is render-only.

### Fold cancellation

Upstream can stop a running fold and, until this landed, we could not.
`HaltAction` — Escape, `hotkey.properties:95` — calls `stopTask()` on the
folding executor, and 32 `Thread.interrupted()` sites inside the fold answer it.
Our fold ran to completion no matter what, which on an hour-scale crease pattern
took the whole CP worker with it.

The **mechanism** is a faithful port and could not have been anything else: a
fold is one long synchronous call, so the only thing that can stop it is the
running code asking whether it should. Three things about it are deliberately
not faithful.

- **The signal is not consumed by reading.** `Thread.interrupted()` clears the
  flag. `FoldedFigure_Worker.java:216` calls `SubFace.setGuideMap` on the search
  thread, and `SubFace.java:389/429/439/445` merely `return` on the interrupt
  without rethrowing — so a cancel that lands inside the guide map is swallowed,
  the map is left half-built, the search carries on over corrupted guides, and
  the user's Escape is silently lost. `cancel::check()` reads an atomic and
  `crates/oristudio-cp/src/cancel.rs` exposes no taking variant, so that failure
  is unrepresentable rather than merely avoided. The three `Err`-absorbing arms
  on the search path (`folding/permutation.rs`) match `Cancelled` first for the
  same reason; the worst of them turned any error into `Ok(false)`, which means
  "no stacking of this subface exists".
- **`check()` matches the cancelled run id exactly, not by watermark.** Ori
  Studio can have several folds live at once — seven call sites dispatch one, and
  a stale figure's refold can start while the user folds something else — plus
  work the user cannot address at all (the 3D rehydrate on project load, the
  export-dialog fold, both of which run *unbound*). A watermark cancels every
  live run with a lower id, so a Stop aimed at the visible fold would take a
  sibling with it. Upstream has one folding executor and no such case. The cost
  of exactness is that the transport names **one** run: both bridges carry a
  single slot, so a Stop over several live runs writes the oldest — the engine is
  serial, so that is the one executing — and the store re-aims at the next as
  each finishes.
- **A cancelled fold is rolled back, not discarded.** `FoldingEstimateTask.java:44-49`
  catches the interrupt and calls `estimated_initialize()`
  (`FoldedFigure.java:58-72`), which resets `displayStyle` to `NONE_0` and leaves
  an empty, still-selectable entry in `foldedFiguresList` — so cancelling a *find
  another* throws away the solution that was already on screen. Ori Studio
  snapshots the session's mutable state and restores it, leaving the figure
  exactly as it was before the call. Upstream structurally cannot do this: it has
  no backwards solution navigation (the first divergence in this section), so
  "the solution before this search" is not a state it can return to. Upstream's
  behaviour remains available here as a user verb, because `restart()` already is
  that reset.

**Where the checkpoint sets differ, and why they are allowed to.** Upstream's
criterion is stated in a comment at `PointSet.java:424`: "No need for
InterruptedException here since this algorithm is now way too fast even for
Ryujin." Ours is a latency bound — no uninterrupted stretch over 100 ms — so the
two sets differ in both directions, and a difference is not by itself a porting
defect. Below is the accounting for all 32 of upstream's sites
(`rg -c 'Thread\.interrupted\(\)' third_party/oriedita`), row by row, so that the
next `upstream-drift` sweep reads the real gaps instead of an all-clear:

| Upstream | # | Ori Studio |
| --- | --- | --- |
| `FoldedFigure_Configurator.java:126`, `:137` | 2 | `folding.rs` `configure_subfaces`, per subface. `:137` only stops *submitting* to a `newWorkStealingPool`; a sequential port has no queue to stop feeding. |
| `Configurator.java:388` | 1 | `folding.rs` `initial_hierarchy_from_graph`, on a stride of 8 — its body became an array read when the line/face incidence index landed. |
| `Configurator.java:416`, `:430` | 2 | `folding.rs` `equivalence_condition_candidates_from_parts`, the 3EC face scan, stride 256. `:430` is a submit loop. |
| `Configurator.java:458`, `:466`, `:481` | 3 | Same function, the 4EC collision scan — every iteration, because it carries ~85 % of setup on a large model. `:466` guards upstream's `synchronized (AEA)` block and `:481` is a submit loop; neither has a sequential counterpart. |
| `Configurator.java:276` | 1 | **Not mapped.** `reduce_subface_set` (`folding.rs`) has no poll. |
| `Configurator.java:510` | 1 | **Declined.** `prioritize_subfaces` (`folding/permutation.rs`) is public, infallible, asserted infallibly in two test files, ~40 µs, and called once from a site already covered. 40 µs against a 100 ms bar does not buy a public API break. |
| `FoldedFigure.java:148,164,179,207,230,261` | 6 | **Not mapped.** These are the stage boundaries of `folding_estimated`. A boundary poll only shortens the tail of a stage whose interior is already polled, and the expensive stages — the fold graph, the hierarchy setup, the condition generation, the layer-order search — all carry interior sites. |
| `SubFace.java:389` | 1 | `from_ordered_subfaces`, the loop whose body is `set_guide_map` (~10 ms per subface). |
| `SubFace.java:429`, `:439`, `:445` | 3 | **Not mapped, deliberately.** These are the `return`-on-interrupt sites named above. Polling the enclosing loop instead means a cancel is taken *before* a guide map is started, never inside one. |
| `AdditionalEstimationAlgorithm.java:99` | 1 | `additional_estimation.rs` `run_transitivity`, every iteration — one iteration is a whole subface's transitive closure. The "fast" variant carries the same polls. |
| `AEA.java:115`, `:130` | 2 | The triple / quadruple condition sweeps, stride 1024 — bodies are nanoseconds and the lists reach ~10⁵ entries. |
| `WireFrame_Worker.java:168` | 1 | `FoldGraph::face_positions` — **finer than upstream**, which polls per BFS *round*; one round is F·k work, so we poll per face in the round. |
| `WireFrame_Worker.java:245`, `:291` | 2 | **Not mapped.** Point-set construction from a line-segment set. |
| `ChainPermutationGenerator.java:165` | 1 | `SubFacePermutationSearch`'s `while changed != 0`, stride 64 — deliberately one level *above* upstream's site. A mid-loop return from `next_core` leaves `PairGuide::score` elevated for the confirmed prefix while the next call retracts from `num_digits` downwards, so `is_not_ready` lies. |
| `CombinationGenerator.java:120` | 1 | `run_combination_generator`, the caller. `CombinationGenerator::process` returns `bool` where `false` means "no combinations left", so a cancelled `false` would be a fabricated algorithmic verdict. |
| `FoldedFigure_Worker.java:134` | 1 | **Not mapped.** |
| `IntersectDivide.java:26` | 1 | `operations::arrangement::divide_intersections`, which became fallible solely to carry a cancel. |
| `PointLineMap.java:39` | 1 | **Not mapped.** `PointLineMap` has no counterpart on our fold path. |
| `PointSet.java:490` | 1 | **Not mapped.** The `lineInFaceBorder` index build; our `line_face_borders_from_incidence` has no poll. |

Twelve mapped, four with no sequential counterpart, one declined, **fifteen not
mapped** — three of those by choice and twelve because the latency bound did not
demand them. That last number is the point of this table: it is the honest
account, and adding a site is a one-line change if a measurement ever asks for
one.

One of our checkpoints has no upstream counterpart at all:
`infer_final_subface_transitivity` (`folding/permutation.rs`), which upstream
does not need because it reaches the same result through its incremental AEA.

Two sites poll on a **latch and `break`** rather than `?`, because they sit in
closures returning `Vec` where `check()?` does not typecheck. That is safe only
because the caller discards the whole collect at a `check()?` immediately after
it, and only because nothing ever clears the signal — so a `break` above is
always followed by that `Err`. Do not copy the shape anywhere a partial result
can reach a caller; a cancel that becomes a short list is exactly the class of
failure the `getFacePositions` note above calls "worse than the hang".

Three consequences worth knowing before touching adjacent code:

- **`fold_disconnected` is now "disconnected *or* cancelled".** `FoldGraphError`
  carries `Cancelled` beside `DisconnectedFaces`, so the pinned code above is
  reached only after `is_cancelled()` has been tested. Every conversion into
  `EngineError` short-circuits on that predicate *before* classifying by cause —
  without it, a checkpoint in additional estimation would arrive inside the
  `AdditionalEstimation(_)` arm and tell a user who pressed Stop that their
  crease pattern is unfoldable.
- **`Fold3dPlacementError` is Ori Studio's, with no upstream counterpart.** 3D
  folding is a native module (see below), and `Fold3dRefusal` is a *verdict about
  the crease pattern* — it reaches the user as "this cannot be folded in 3D".
  A cancel is not a verdict, so it could not be one of its arms; the placement
  path returns `Fold3dPlacementError`, which is either a refusal or a cancel.
  3D is cancellable at all because sites in `fold_graph.rs` and
  `operations/arrangement.rs` are shared with the flat path. The same rule binds
  the *third* arm of the 3D answer: `Fold3dSession::with_tolerances` ordinarily
  degrades an arrangement failure into a `NoLayerOrder` verdict and places the
  figure anyway, and a cancel must be tested **before** that degrade — otherwise
  a stop becomes a placed figure asserting "no layer order" about a crease
  pattern nobody finished analysing, complete with a kernel handle, an undo step
  and a dirty project. `Fold3dOrderError::is_cancelled` recurses into
  `Cells(CellError::Cancelled)` for the same reason: it is the sole guard on the
  two hand-built `EngineError` sites in `session.rs`.
- **We cancel the fold; we do not cancel the CAMV recompute.** Upstream's
  `HaltAction` stops *two* executors (`HaltAction.java:26-29`), and the second is
  `CheckCAMVTask` — the debounced background flat-foldability recompute, whose
  analogue is `scheduleOristudioCamvRefresh`. That one is not cancellable here
  yet, and the pre-fold CAMV check is a different thing again: upstream's runs
  synchronously on the EDT inside `FoldAction.actionPerformed`, where `HaltAction`
  cannot reach it either.

One frontend divergence rides along: **a cancelled scoped fold hands the crease
selection back.** `FoldAction.foldCreasePattern` calls `unselect_all(false)`
immediately after dispatching, so upstream drops the selection whatever the fold
does and a user who stops one has to reselect. We restore it, so pressing G again
is enough.

### Ori Studio native operations

Not every CP operation is a port. Some exist only here — fold-angle editing has
no Oriedita counterpart at all, because upstream creases are always a full ±180.
These are **not** divergences from Oriedita and must not be read as ones; there is
simply nothing upstream to compare them against.

Two markers say so, and a unit test in `crates/oristudio-cp/src/lib.rs`
(`native_operations_are_tagged_and_stay_out_of_ported_modules`) keeps them from
drifting apart:

- **`OperationOrigin::OriStudio`** on the operation's registry descriptor, written
  at the call site as `descriptor!(native Foo, …)`. `OperationOrigin::Oriedita` —
  the bare form, and the overwhelming majority — means `upstream` pins a real
  source element and the behavior is parity-bound.
- **`crates/oristudio-cp/src/operations/native/`**, whose contents are by
  definition not parity-bound. Anything targeting `operations::native::` must
  carry the `OriStudio` origin.

Three originals predate the tag and still live in ported modules
(`CreaseSetLineColor`, `CreaseSetFoldAngle`, `VertexSolveFoldAngles`); they are
tagged correctly, and relocating them is a separate change. New original
operations go in `native/`.

A native operation is otherwise entirely ordinary: same dispatch, same payload,
same preview path, same wasm bridge. The boundary is about provenance and what a
future porting session owes the upstream, not about how the code runs. Nothing in
`native/` needs an oracle, and no oracle sweep should expect to find one.

Whole *modules* can be native too, and `crates/oristudio-cp/src/folding3d/` is
one: the computed 3D folded state. Upstream folds by reflecting each face across
its crease, which is only correct at ±180, so there is no `WireFrame_Worker`
behaviour for a general angle to be faithful to. Everything below is a decision
rather than a port, and each is one somebody could reasonably have made
differently:

- **The placement convention** — `M_child = M_parent ∘ Rot_paper(line, rho)`,
  right-composed, the axis directed the way the child face's own winding
  traverses the crease, `rho` the signed FOLD angle applied directly. It is
  fixed by agreement with the shipped `vertex_link_polygon`
  (`checks_spatial.rs`), not by upstream, and the two must stay in one frame or
  the admission gate certifies states the renderer draws mirrored.
- **`FoldGraph`'s rings are reversed once** on the way in. Upstream never asks
  which way a face is wound, so its clockwise convention is invisible there and
  load-bearing here.
- **The appearance controls are shared, but only some of them reach 3D.**
  `FoldedFigureModel` is *Oriedita's* type — its field set, defaults and wire
  codes are parity surface, and a new upstream appearance field belongs there and
  nowhere else. What our 3D renderer can do with those fields is a separate
  question, answered in one place:
  `apps/web/src/cp-workspace/folded/foldedFigureAppearance.ts`. The inspector
  renders availability from it, so a control is never present, enabled and inert.
  Three consequences worth knowing before porting an upstream appearance change:
  - `transparent_transparency` is honoured in 3D, using upstream's own reading of
    it — the value *is* the fill alpha, default `16/255`.
  - `transparency_color` is not. It selects a Java2D *render pass*
    (`transparent_render_pass_name`), which a projector compositing its own alpha
    has no reading for. The field stays on the type so files round-trip.
  - `scale` / `rotation` are not wired to any control on either kind of figure.
    Ori Studio transforms a figure through `FoldedFigurePlacement`, driven by the
    canvas handles and stored in the `.osf`; wiring the model fields as well would
    give one figure two transforms that disagree. Scaling and rotating a folded
    figure works — through the handles.
  - Shadows are **not** drawn in 3D. Upstream's shadow is an offset band along a
    subface boundary, derived from the subface arrangement and the layer
    hierarchy; the 3D path keeps that machinery in the kernel and the projector
    never sees it. The control is shown disabled rather than hidden.
- **Two faces meeting across a segment that is not a crease is refused.** The
  flat path mirrors across one — `find_adjacent_line` applies no colour filter,
  so an unassigned crease or an interior cut folds the paper 180° — and that
  behaviour stays, because it is Oriedita's. In 3D there is no angle to apply,
  and manufacturing one would be inventing a nearby result.
- **The layer order is solved per constraint component, and the solution stream
  is an odometer over them.** Upstream has one global search because a flat
  folding puts every face in one plane; in 3D the ordering variables are the
  coplanar overlaps and the constraints over them connect into several pieces.
  The odometer's components are ordered by variable count **descending** and its
  first digit moves first, so the first press of "another solution" changes the
  largest stack rather than the smallest — `treemaker-flatfold` sorts its own
  groups ascending, so this is an inversion of the nearest thing in the
  workspace and worth naming as one.
- **The cross-plane coupling's cut is keyed to plane index.** Two creases folding
  onto one line with faces in two planes constrain each other, and reading that
  constraint off the layer table needs the two planes' slots put in a fixed
  order. The order is arbitrary — the condition is symmetric under swapping the
  two — but it has to be *consistently* arbitrary, because the table holds one
  cell per face pair for the whole model. Plane index is what makes it
  consistent; the obvious alternative, slot angle around the line, is not, since
  a face can meet two collinear folded lines from opposite sides.
- **`folding::validate_initial_hierarchy`** is additive beside
  `HierarchyTable::from_initial`, which discards `infer_above`'s error. The flat
  path keeps calling the unchecked builder and is byte-identical; only the 3D
  path, whose seeds come from several independent geometric rules, asks.
- **The drawable unit is the arrangement cell, not the face.** Upstream draws
  subfaces and can, because a flat folding puts every face in one plane and the
  ordering is global. In 3D a cyclic panel order is legal, so no per-face scalar
  "layer" exists at all — what always exists is a winner per cell. The engine
  boundary emits cells with a face stack each, and a face that overlaps nothing
  becomes a one-face cell so a renderer that draws only cells never loses paper.
- **On screen, a 3D figure is drawn by the origami simulator's mesh renderer.
  A flat figure is not, and did not change.** A flat figure is still Oriedita's
  primitive stream, drawn in the crease-pattern scene exactly as before; a 3D
  figure is a GPU mesh in a window of its own, sharing the simulator worker's one
  WebGL context. Three consequences a future porting session should know:
  - **The layers are separated by an epsilon along the plane's normal.** A depth
    buffer cannot draw a flat stack — the layers are exactly coplanar and
    z-fight, which is why ORIPA keeps an overlap matrix. We do not need one,
    because the kernel already computed the order: displacing each slot by
    `stack index × ε` makes the z-buffer reproduce it. No global order is
    constructed anywhere, so a cyclic panel order works by construction rather
    than by exception.
  - **`foldedFigure3dProjection.ts` is the vector path, not a second renderer.**
    It makes the drawing that goes into an `.osf`, a crease-pattern export, a
    standalone SVG/PNG, and the fallback picture for a figure with no GPU or no
    render model. It is off the per-frame path and stays off it
    (`projectorIsExportOnly.test.tsx`). Both paths derive from one render model
    and a test asserts they show the same layer
    (`folded3dMesh.test.ts`).
  - **A 3D figure and an inline simulation disagree about which tone is
    "front".** The simulator lifts FOLD faces with `[x, 0, y]`, a determinant −1
    map that puts its right-hand normals on the paper's FOLD-front; a folded
    figure winds the other way, because flat/3D parity — the same tone on the
    same side of the paper as the flat figure beside it — is the constraint that
    matters here. Both viewports on screen at once will disagree, by choice.
- **The FOLD `foldedForm` frame is ours, and it does not inherit.** Oriedita
  writes no folded-form frame, so there is nothing to be faithful to and three
  choices had to be made. The frame restates its own vertices, edges, faces and
  assignments with `frame_inherit: false`, because a 3D fold is walked over a
  *selection* through its own `FoldGraph` and every per-edge array on the root is
  numbered against the whole document's — an inheriting frame would take each of
  them under the wrong index. `faceOrders` is signed `facing(lower_face)`,
  translating the solver's "above along the plane's `up`" into the spec's
  "above along **g's** normal", with `s = 0` on pairs the solver left undecided
  and no sorting, since a cyclic relation set is legal. And `frame_attributes` is
  `["3D"]` and never `nonSelfIntersecting`: the crossing predicate is sound but
  not complete, so the file may not claim what the verdict does not.
- **A folded form welds one position per vertex by choosing, not averaging.**
  FOLD allows one `vertices_coords` entry per vertex where `Placement3d` keeps
  one image per face — deliberately, because averaging them is what destroys the
  evidence a loop gap is made of. The export takes the lowest-indexed carrying
  face's image, so every emitted coordinate is a real placed point.
- **A 3D fold has its own snapshot, its own commands and its own handle kind.**
  `FoldedFigureSnapshot` and the six `folded_figure_*` commands stay exactly as
  they are — `wireframe` is 2D by construction and `estimation_step` /
  `display_style` are Oriedita enums with no 3D meaning, so filling them in
  would be inventing a nearby result at the boundary. The two kinds share one
  arena, and a command applied to the wrong kind is a typed
  `folded_figure_kind_mismatch` rather than an answer.

Release caveats:

- Public parity targets TreeMaker 5.0.1's distributable ALM optimizer. CFSQP
  and RFSQP remain out of scope without redistributable source and compatible
  license terms.
- Real-world corpus files are not committed; use the external corpus harness in
  `treemaker-cli` before making claims about a private archive of historical
  user files.

## Box Pleating Studio (`oristudio-bp*`)

Deliberate divergences, each additive — the ported algorithms and their outputs
are unchanged:

- **Layout symmetry** is an Ori Studio extension with no upstream counterpart.
  Upstream Box Pleating Studio has no notion of a symmetric layout, so there is
  nothing to be faithful to; the closest domain precedent is TreeMaker's
  `tmConditionNodesPaired` / `tmConditionNodeSymmetric`, whose linear-equality
  formulation this follows.

  The whole feature is gated on `OptimizerRequest::symmetry` being `Some`. With
  it absent, every code path is the upstream one: `pack_rssl` delegates to
  `pack_rssl_symmetric` with no symmetry, the basin-hopping and global-solve
  entry points delegate likewise, and the grid fit uses the upstream greedy. The
  differential test in `crates/oristudio-bp/tests/optimizer_oracle.rs` compares
  against the vendored WASM over 400+ cases and must keep passing untouched.

  Symmetric fitting does depart from the upstream greedy in one structural way,
  because it has to: upstream pins flaps at absolute grid coordinates and grows
  the sheet lazily, and in absolute coordinates a book mirror is `x -> s - x - w`,
  so growth would move the axis out from under the already-pinned pairs. The
  symmetric fit measures the mirrored axes from the sheet centre instead — the
  same thing the diagonal sheet already does — which makes the mirror map
  independent of the sheet size at the cost of an even sheet size.

- **Which member of a mirror pair lands on which side is settled after solving.**
  A pair occupies two mirrored positions and the packing is indifferent to which
  member takes which, so the solver picks arbitrarily — in random mode
  differently per pair per seed. `OptimizerSymmetry::negative_side` carries the
  sides the user drew, and `orient_result_to_drawing` restores them: first by
  reflecting the whole layout when that agrees with more of the drawing (always
  sound — every flap lands where its own mirror was), then pair by pair, keeping
  an exchange only when it still validates. Partners are interchangeable when
  they are metrically identical, which mirror siblings are and mirrored subtrees
  are not.

- **A new leaf's flap is re-seeded from where the leaf was drawn.** Upstream's
  `vertexContainer.$addLeaf` seeds the flap from `_findClosestEmptySpot`, which
  is where the *vertex* is parked at creation, before the caller moves it to the
  point the user clicked. That spot is chosen against tree-node occupancy, so
  repositioning the leaf vacates it and the next add picks it again: in Ori
  Studio's draw-then-place flow every leaf added to a design lands its flap on
  the same cell.

  The engine path is unchanged — `add_leaf`, `closest_empty_spot` and
  `create_flap_prototype` are the faithful port. The divergence is additive and
  lives in the store's add actions (`apps/web/src/lib/bpFlapSeeding.ts`): once
  the leaf is where the user put it, its flap is moved to the same layout point
  `create_flap_prototype` would have chosen had it known the final position —
  through `relative_layout_point`, upstream's own `getRelativePoint`. Under
  mirror draw the partner's flap is then the *reflection of where the primary's
  landed*, rather than an independent mapping of the partner's tree position,
  because the map rounds and two exact tree mirrors can round to positions that
  are not mirrors.

  Upstream has no draw-then-place add — a new vertex stays where it is parked
  until dragged — so there is no upstream behaviour here to be faithful to.

- **Mirror-draw state is persisted only in `.osf`.** Which flaps mirror which,
  whether mirror draw is on, and which fold the mirror represents are saved as a
  typed `symmetry` field on the box-pleat document (native schema v6). Nothing
  about it enters the Rust `Project` model, so `.bps` and `.bpz` stay
  byte-faithful with no export-path changes — and correspondingly cannot carry
  it. `.bps` export warns first, through the shared superset-feature registry in
  `apps/web/src/lib/supersetFeatures.ts`.

  Upstream reads tolerantly (`Migration.$process` mutates and casts, and its own
  notes say "All difference will be ignored"), so smuggling symmetry into a
  `.bps` under a namespaced key would work — and still die, because
  `Project.toJSON()` rebuilds the file from upstream's model on their next save.
  Note also that `$getVersionIndex` throws `"Unrecognized version"` on a version
  it does not know, so the `version` field must always be one upstream published.

## Origami Simulator (`packages/origami-simulator`)

The vendored reference is `third_party/origami-simulator` at commit
`7855983a613c879c171b2b1557f8cd102d2640cf` (recorded in `src/provenance.ts`,
which also names the solver files the port follows). The dynamic solver is a
faithful port: same relative-position state model, same pass order
(`normalCalc` → `thetaCalc` → `updateCreaseGeo` → `velocityCalc`/`positionCalc`),
same equations. `bench/upstreamParity.bench.ts` drives the vendored page in
Chromium, so solver divergence is measured rather than assumed.

Deliberate divergences, all in fold preparation and all because our inputs are
crease graphs from a CP editor rather than upstream's hand-clean SVGs:

- **`removeDegenerateGeometry` has no upstream counterpart.** Upstream never
  needs one: a zero-area triangle NaNs its `normalize(cross(...))` face-normal
  pass and a zero-length edge divides by a zero rest length, and its inputs
  contain neither. It avoids them through an input-cleanup chain we have not
  ported (`collapseNearbyVertices` → `removeLoopEdges` → `removeDuplicateEdges`,
  `pattern.js:538-547`). Porting that chain is what would let this pass retire.
- **`delaunayFlipRing`.** Upstream's FOLD path calls earcut and keeps whatever it
  returns; only its curved-folding path triangulates for quality (`cdt2d` plus an
  orthogonality-driven swap loop). Deleting this for parity was tried and
  reverted — it made real simulations measurably worse.
- **`triangulateQuad` picks the diagonal by max-min-angle**, where upstream uses
  the shorter diagonal. Identical output on 42 real patterns; kept because it
  also rejects a diagonal falling outside a non-convex quad.
- **`removeRedundantVertices` stops at driven creases (M/V/F).** Upstream merges
  any collinear degree-2 pair with matching assignments, borders included. A
  crease-free border subdivision has no crease to lose, and it is the only mesh
  resolution `delaunayFlipRing` has to work with.
- **`projectFaceTo2D`** picks the projection plane from the face's Newell normal;
  upstream retries earcut on each of the three axis rotations until one returns
  enough triangles. Same intent, fewer earcut calls.
- **Winding restoration after earcut** uses per-triangle signed area; upstream
  finds its first ring edge among the triangles and flips all of them.
- **`edgeKey`/`buildEdgeIndex`** replace upstream's linear `findEdge` scans.
  Performance only: O(E²) → O(E), seconds on a large pattern.
- **Additions with no upstream counterpart:** `ReferenceSolver`, a CPU port that
  runs headlessly in Node and is what golden traces and CI use (upstream is
  GPU-only); `SimulationClock`, a time-budgeted scheduler in place of a fixed
  step count; and a WebGL2 mesh renderer drawing from the position texture rather
  than through three.js.

Not ported at all: cut edges (`C` is accepted by `normalizeAssignment` and
otherwise ignored; upstream runs `splitCuts` plus a second redundant-vertex
pass), the curved-folding path, the SVG import path, `removeBorderFaces`, and
`foldUseAngles` (upstream infers target angles from an imported folded form when
the FOLD carries no `edges_foldAngle`; our option of that name is dead and reads
the assignment either way).

## Staying current: two mechanisms, never one

Every pin above is a snapshot of a project that keeps moving. Two separate
things keep us honest about that, and they have **opposite** requirements. Do
not merge them.

| | Parity oracle | Drift check |
| --- | --- | --- |
| Question | Does the port still match the source we ported from? | Has upstream moved into code we depend on? |
| Reference | **Pinned** `vendored_commit` | **Current** upstream HEAD |
| Runs | Every CI build | By hand, roughly monthly |
| On problem | Fails the build | Writes a sync plan, opens an issue |

**The oracle must never be pointed at upstream HEAD.** It is a regression test
on our code. Floating it would break CI for reasons that are not ours, make it
impossible to tell "I broke the port" from "upstream changed", and make the same
commit pass on Tuesday and fail on Thursday.
`tools/oriedita-oracle/build_geometry_oracle.sh` defaults to the vendored
snapshot (`ORIEDITA_SOURCE=${...:-third_party/oriedita}`), which is correct.

**The drift check must never gate a build.** It is a notification. Run it with
the `upstream-drift` skill (`.agents/skills/upstream-drift/`), one upstream at
a time.

`upstream-sync.json` is the source of truth for both, and it tracks two commits
per upstream for this reason: `vendored_commit` is what `third_party/` contains
and what the oracle compiles against, moving only on a real re-vendor;
`last_checked_commit` is how far a drift check has triaged, moving every run.

Two things to know before touching this area:

- **The oracle suites skip silently when their environment variable is unset**,
  so an unconfigured suite and a passing suite look identical. Seven of the
  eight ran dormant in CI for months because of it. `ORACLE_REQUIRED` plus the
  `oracle_env_guard` test in each crate now turns a missing variable into a
  failure. If you add an oracle suite, add its variable to that list.
- **Do not size an upstream delta with GitHub's compare API.** It truncates its
  file list at 300 entries with no error, which has already produced two wrong
  per-module readings. Clone the upstream and diff locally.
- **A failing oracle test does not mean the port is wrong.** The oracle harness
  is a transcription too, and it can transcribe the wrong upstream function.
  The first three failures this CI wiring exposed were all the harness: it
  compared symmetric draw, double symmetric draw, and fishbone against
  `OritaCalc.extendToIntersectionPoint_2` when all three handlers call
  `CreasePattern_Worker_Impl.extendToIntersectionPoint`, which differs by a
  final `withA(s0.getB())`. The Rust was right. Read the upstream *caller*
  before changing kernel code — and note the inverse risk, which is worse
  because nothing fails: if the port and the harness both call the wrong
  function, the test passes while both diverge. Agreement between two of our own
  artifacts is not parity; only `third_party/` is authoritative.
