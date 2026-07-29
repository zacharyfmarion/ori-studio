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

Release caveats:

- Public parity targets TreeMaker 5.0.1's distributable ALM optimizer. CFSQP
  and RFSQP remain out of scope without redistributable source and compatible
  license terms.
- Real-world corpus files are not committed; use the external corpus harness in
  `treemaker-cli` before making claims about a private archive of historical
  user files.
