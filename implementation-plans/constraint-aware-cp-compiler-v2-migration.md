# Constraint-Aware CP Compiler V2 Migration Plan

Status: Active implementation plan, May 29, 2026.

Progress:

- Phase 0 is complete as of May 29, 2026.
- Phase 1 is complete as of May 28, 2026.
- Phase 2 is complete as of May 29, 2026 for the first inspectable candidate
  arrangement pass.
- Phase 3 is complete as of May 29, 2026 for selection scaffolding and score
  accounting. It is deliberately not the final graph selector.
- Phase 4 is complete as of May 29, 2026 for the first inspectable local
  exactizability probe pass. The probes make origami constraints visible as
  costs instead of brittle pass/fail checks, but they still do not mutate the
  graph.
- Phase 5 is complete as of May 30, 2026 for first-pass exactizability-aware
  beam selection.
- Phase 5b was audited on May 30, 2026 and found incomplete. The selector did
  add shared-carrier moves and structural edit accounting, but the public graph
  still exported selected atomic intervals as if they were final crease edges.
  The inspector then tried to hide that mismatch with a post-selection compiled
  graph view. That was misleading and has to be removed rather than polished.
- Phase 5c is complete as of May 30, 2026. Final crease spans are now
  first-class selection output. Stage 5 shows exactly what the beam selected as
  final crease spans, with atomic intervals available only as provenance.
- Phase 5d selection-objective work is complete as of May 31, 2026. The beam
  now searches first-class final span hypotheses instead of atomic intervals,
  and the old atomic beam path has been removed. Exactizability probes still
  consume selected atomic provenance internally; making those probes fully
  span-native remains follow-up work before the full exact solver.
- Phase 5e is complete as of June 1, 2026. Phase 5d fixed shared-carrier
  alternatives, but selected graphs could still show tiny pass-through chains
  when the carrier was already an observed local carrier. Phase 5e adds
  observed-carrier span candidates so the beam can choose one final crease
  through degree-2 pass-through vertices instead of many atomic fragments.
- Phase 5f is complete as of June 3, 2026. It moves semantic degree-2
  pass-through normalization before beam search so crease-level spans are
  selectable candidates and atomic intervals are provenance/fallback only. The
  real treemaker smoke sample still is not clean, which is now tracked as a
  candidate-generation/constraint-solve problem rather than a visualization
  problem.
- Phase 6 is complete as of June 3, 2026. It introduces a source-neutral
  `CandidateGraph` IR so legacy-selected graph proposals, lower-threshold weak
  crease candidates, and compiler-native arrangement candidates all feed one
  shared selector contract and one shared exact-solver contract. This is a
  top-level phase because Phase 7 exact solving must not be built on
  arrangement-specific or legacy-specific selector types.
- Phase 7 has a working exact-solve inspector stage as of June 4, 2026. The
  backend now exposes Stage 6 and the inspector shows selected-before,
  exact-solved-after, movement, failed-vertex overlays, and before/after solver
  diagnostics. Phase 7 remains diagnostic-only until curated metrics say it is
  good enough to wire into browser import output.
- A `ConstraintCompilerV2` backend now exists for the compiler-native evidence
  route, while `ConstraintCompilerV1` remains the current locked-border
  baseline.
- The V2 adapter is cordoned into `compiler_decode_v2.rs`; the mixed
  `compiler_decode.rs` file is V1-only.
- `evidence_extract.rs` converts dense model tensors into compiler-native
  line, junction, and boundary-contact primitives without importing
  `legacy_decode`.
- V2 reports evidence extraction time separately from compiler time.
- V2 reports explicit stage IDs in `compiler_report.stage_ids`.
- `apps/cp-detect-architecture-inspector` and
  `oristudio-cp-detect-inspector` provide local Stage 1 through Stage 6 debug
  UI/API for visually inspecting dense evidence, arrangement candidates,
  weighted selection output, exactizability probes, and beam-selected final
  crease spans, plus exact-solve before/after geometry.
- The V2 product route is still not promoted. Exact solve, assignment solve,
  verifier/export contract, and benchmark gates remain open.

Goal: migrate the current browser CP detector/compiler into the target
architecture:

```text
model evidence and/or legacy graph proposals
-> source adapter
-> CandidateGraph IR
-> weighted span selection with exactizability probes
-> full exact geometric solve
-> assignment solve
-> verifier
-> FOLD export
```

The compiler should treat model output as evidence, not final geometry. The end
state should not depend on hidden fallback or old mutation-style
exactizer/topology code in the product path. Legacy is allowed as an explicit
candidate source and frozen benchmark because it is currently the strongest
topology proposal generator; it must not become a second selector, second exact
solver, or silent post-processing path.

## Target Principles

- The neural model is an evidence source. It does not directly define the final
  FOLD graph.
- The compiler owns the graph reconstruction path end to end.
- Legacy is allowed only as an explicit benchmark/backend while migrating.
- Reusable primitives such as Hough, connected components, heatmap sampling,
  and rendering may be shared, but they must live in neutral utility modules,
  not in `legacy_decode`.
- The arrangement phase is recall-oriented: keep plausible alternatives.
- Weighted selection is precision-oriented: choose the graph that best balances
  visual evidence, topology, origami constraints, and exactizability.
- Origami theorems are not evaluated as brittle pass/fail on noisy raw angles.
  They are used as "how expensive is this topology to exactize?" scoring terms.
- Exactization is a constrained solve over a selected topology, not an early
  snap/mutate cleanup pass.
- Every promoted stage must expose edit accounting and visual debug artifacts.

## Current State vs Target State

### Current State

- `crates/oristudio-cp-detect/src/legacy_decode.rs`
  contains the old threshold/vectorization/cleanup decoder.
- `crates/oristudio-cp-detect/src/compiler_decode.rs`
  creates a `CandidateProgram`, but it still calls legacy snapshot code:
  `decode_edge_stage_snapshot_from_maps`, `DecodeEdgeStageSnapshot`,
  `StageEdge`, and `StageVertex`.
- `DecoderBackend::ConstraintCompilerV1` no longer falls back to final legacy
  FOLD, but the compiler evidence path still inherits legacy graph-building
  choices.
- `border.rs` is compiler-owned and intentionally ports the good square-border
  prior. This is okay; it is no longer a hidden legacy fallback.
- `arrangement.rs` currently reports square boundary points and carrier
  intersections, but it does not yet produce a selectable planar graph with
  atomic candidate intervals and alternative hypotheses.
- `optimizer.rs` / `repair.rs` perform mutation-style topology repair from a
  single candidate graph. They are useful as experiments, but they are not the
  desired architecture.
- `exactize.rs` is conservative after ablations, but it is still a local
  cleanup pass. It is not yet a full constrained geometry solver.
- `carrier_reconcile.rs` proved that broad carrier mutation is dangerous; the
  tightened version is neutral and should remain diagnostic until replaced by
  arrangement-level alternatives and exact solve.

### Target State

- `cp-detect` exposes two explicit paths only:
  - `LegacyV2`: benchmark/regression-only old decoder.
  - `ConstraintCompilerV2`: compiler-native path from evidence to exact FOLD.
- `compiler_decode.rs` is replaced or reduced to a thin adapter from dense model
  tensors into compiler-native evidence primitives.
- `oristudio-cp-compiler` contains the reconstruction architecture:
  - `evidence`
  - `arrangement`
  - `selection`
  - `exact_solve`
  - `assignments`
  - `verify`
  - `fold_export`
- Deprecated V1 modules are cordoned off:
  - old local exactizer
  - old mutation optimizer
  - repair candidates
  - carrier reconciliation
- Product output comes from `ConstraintCompilerV2` only after it beats or
  materially improves on legacy under agreed metrics and manual review.

## Phase 0: Cordon, Baseline, And Dependency Audit

Purpose: prevent more confusion about which path owns which behavior.

Status: Complete for the current boundary. V2 now has its own adapter module
with a dependency guard, and V1 mutation modules are documented as deprecated
diagnostics. Legacy remains available only as `LegacyV2` / `ConstraintCompilerV1`
baseline code until Phase 11 removes it from the product path.

Work:

- Add a `ConstraintCompilerV2` backend enum value, but keep it disabled from
  product default until complete.
- Keep `ConstraintCompilerV1` as the current locked-border compiler baseline.
- Add `#[deprecated]` annotations or doc comments to V1-only modules:
  `optimizer`, `repair`, `carrier_reconcile`, and mutation-style exactizer
  entry points once V2 replacements exist.
- Add a dependency audit test that fails if V2 modules import
  `legacy_decode`.
- Add report metadata:
  - `compiler_architecture: "v2"`
  - `legacy_dependency: false`
  - stage IDs for every compiler step.
- Snapshot current metrics and visual packs as immutable baselines.

Acceptance:

- Existing tests still pass.
- Current `legacy` and `locked_border` metrics are unchanged.
- There is a machine-checkable assertion that V2 does not import legacy decoder
  modules.

Implemented:

- `DecoderBackend::ConstraintCompilerV2` exists and is not the default backend.
- `DecoderBackend::default()` remains `LegacyV2`.
- `ConstraintCompilerV1` remains the locked-border compiler baseline.
- `compiler_decode_v2.rs` owns the V2 adapter and has a test preventing direct
  imports of the old decoder implementation.
- `evidence_extract.rs` has a separate test preventing direct imports of the old
  decoder implementation.
- Compiler reports include:
  - `compiler_architecture`
  - `legacy_dependency`
  - `stage_ids`
- V1-only mutation modules have module docs marking them deprecated diagnostics:
  - `optimizer`
  - `repair`
  - `carrier_reconcile`
  - `exactize`
- Existing baseline artifacts remain under
  `artifacts/cp-detect-correctness/runs/smoke-1024-s3/`, including
  `browser-legacy-v2`, `browser-compiler-v1`, and locked-border ablation runs.

## Phase 1: Compiler-Native Evidence Extraction

Purpose: stop building compiler input via legacy graph snapshots.

Status: Complete for the first V2 evidence route. The current V1 compiler path
still uses legacy snapshots by design as the baseline. The new V2 backend uses
`evidence_extract.rs` and reports `legacy_dependency: false`.

New module:

```text
crates/oristudio-cp-detect/src/evidence_extract.rs
```

Data produced:

```text
DenseEvidence
  line_probability
  assignment_probability
  line_style_probability
  junction_probability
  boundary_contact_probability
  optional artifact/text/grid probability

LinePrimitive
  endpoints in image/unit coordinates
  support score
  style score
  assignment logits
  source profile

JunctionPrimitive
  point
  support score

BoundaryContactPrimitive
  side
  coordinate
  support score
```

Implementation notes:

- Move reusable low-level algorithms out of `legacy_decode` into neutral modules
  where needed:
  - map sigmoid/probability helpers
  - Hough mask generation
  - heatmap sampling
  - segment extraction
- Do not port legacy edge dropping/cleanup decisions into this layer.
- Output should be high-recall evidence, not selected topology.

Tests:

- Unit tests for tensor-to-evidence conversion.
- Initial regression tests comparing primitive presence and report fields from
  deterministic dense tensors.
- Larger cached-dense golden tests and native/WASM determinism checks belong in
  Phase 10 with the benchmark pack, after Phase 2 replaces the temporary
  `CandidateProgram` conversion.

Acceptance:

- `ConstraintCompilerV2` can produce evidence JSON for benchmark samples without
  calling `legacy_decode`.
- Evidence extraction runtime is recorded separately from compilation runtime.

Implemented:

- `crates/oristudio-cp-detect/src/evidence_extract.rs`
  - `DenseOutputRefs`
  - `EvidenceExtractionConfig`
  - `CompilerEvidence`
  - `LinePrimitive`
  - `JunctionPrimitive`
  - `BoundaryContactPrimitive`
  - `EvidenceExtractionReport`
- `DecoderBackend::ConstraintCompilerV2`
- WASM/backend parser support for `constraint-compiler-v2`.
- Unit coverage:
  - extracts line/junction/boundary primitives from synthetic dense tensors
  - evidence module does not import `crate::legacy_decode` or
    `super::legacy_decode`
  - V2 backend emits `compiler_architecture = "v2"` and
    `legacy_dependency = false`
  - V2 backend reports `timings.evidence_extraction_seconds` separately from
    `timings.compiler_seconds`
- Stage 1 visual inspection:
  - Rust backend `oristudio-cp-detect-inspector`
  - Vite app `apps/cp-detect-architecture-inspector`
  - overlays line, junction, and boundary-contact primitives over input images
  - displays downsampled dense evidence probability maps

Deferred to later phases:

- Native evidence primitives are converted directly into a temporary
  `CandidateProgram` so we can smoke-test the backend today. This is not the
  final architecture; Phase 2 replaces that temporary graph conversion with a
  true candidate planar graph arrangement.
- Phase 10 will expand timing into full benchmark summaries across larger packs.

## Phase 2: Candidate Planar Graph Arrangement V2

Purpose: create the search space without prematurely choosing geometry.

Status: Complete for the first inspectable V2 arrangement pass. The compiler
crate now owns `arrangement_v2.rs`, which builds a candidate arrangement from
compiler-native evidence primitives without consuming a legacy FOLD graph. The
architecture inspector exposes Stage 2 from the same dense-cache samples as
Stage 1 so observed carriers, shared-carrier alternatives, boundary contacts,
candidate vertices, atomic intervals, and hypothesis counts can be inspected
visually before any selection/export phase is introduced.

New or rewritten module:

```text
crates/oristudio-cp-compiler/src/arrangement_v2.rs
```

Inputs:

- `LinePrimitive`
- `JunctionPrimitive`
- `BoundaryContactPrimitive`
- square boundary prior

Outputs:

```text
CandidateArrangement
  carriers:
    observed local carriers
    inferred merged-carrier alternatives
    carrier visual support intervals
  vertices:
    observed junctions
    carrier-carrier intersections
    carrier-boundary contacts
    nearby-junction clusters
  atomic_edges:
    adjacent intervals along each carrier
    visual support sampled along interval
    style/assignment evidence
  hypotheses:
    separate segment hypothesis
    shared carrier hypothesis
    merge nearby junction hypothesis
    split crossing hypothesis
```

Important behavior:

- Nearly collinear lines do not get merged immediately.
- The arrangement records both:
  - separate-carrier interpretation
  - shared-carrier interpretation with an inferred-hypothesis cost
- Crossings become candidate vertices, but the edge intervals are not all
  selected automatically.
- Boundary contacts are generated from both model boundary-contact evidence and
  carrier-square intersections.

Tests:

- Two crossing carriers produce one candidate intersection and four atomic
  intervals.
- Two nearly collinear connected segments produce both separate and shared
  carrier hypotheses.
- Two close but intentionally angled segments remain representable as separate
  hypotheses.
- Carrier crossing square creates boundary contacts on the correct sides.
- No selected FOLD graph is emitted from arrangement alone.

Acceptance:

- Arrangement contact sheets can show:
  - observed carriers
  - inferred carrier alternatives
  - candidate junctions
  - atomic intervals
  - boundary contacts
- Arrangement is high-recall: ground-truth edges should usually exist somewhere
  in the candidate space even when not selected.

## Phase 3: Selection Scaffold And Score Accounting

Purpose: turn the Stage 2 arrangement into an inspectable selected/rejected/
undecided graph candidate before adding theorem-aware exactizability costs.

Status: Complete for the first inspectable deterministic selection scaffold. The
compiler crate now owns `selection.rs`, which consumes a `CandidateArrangement`
and emits selected/rejected/undecided atomic intervals with score breakdowns,
selected high-level hypotheses, topology edit accounting, and an explicit
`exactizability_evaluated: false` marker. The architecture inspector exposes
Stage 3 from the same dense-cache samples as Stages 1 and 2.

New module:

```text
crates/oristudio-cp-compiler/src/selection.rs
```

Implemented state decisions:

- Select/reject atomic edge.
- Keep plausible but unselected atomic edges as undecided.
- Report high-level carrier/merge hypotheses referenced by selected edges.
- Report odd-degree topology warnings that remain after selection.

Implemented score terms:

```text
visual reward:
  line support
  junction support
  boundary contact support
  assignment confidence

visual/artifact cost:
  weak support
  text/watermark/grid likelihood
  deleting strong observed evidence
  adding inferred no-evidence geometry

topology cost:
  odd-degree interior vertices
  degenerate/tiny edges

simplicity cost:
  duplicate parallel alternatives
  unnecessary tiny fragments
```

Not implemented yet:

- Beam search over multiple competing graph states.
- Exactizability cost:
  - estimated movement needed to satisfy Kawasaki
  - estimated carrier movement
  - high-confidence evidence movement penalty
- Assignment cost:
  - Maekawa residual after unknown/flexible labels
  - low-confidence flips
  - high-confidence flips
  - LBL violations after geometry probe
- Final boundary/contact topology selection.

Algorithm:

- Start from strong visual atomic intervals.
- Reject duplicate selected intervals between the same vertex pair.
- Promote weak edges only when they reduce odd-degree topology cost and have
  nearby visual evidence.
- Keep plausible but unselected edges as `undecided`.
- Report selected high-level carrier/merge hypotheses.
- Report score breakdowns and accepted-edge reasons.

Tests:

- A strong visual edge is selected.
- A weak edge is selected if it fixes odd degree and has nearby visual evidence.
- A no-evidence edge is rejected even when it would be topologically useful.
- A duplicate selected interval keeps only the highest-scoring candidate.
- A low-cost merge hypothesis is reported when a selected edge uses the merged
  junction cluster.
- A high-cost merge hypothesis is not selected.

Acceptance:

- Selection scaffold produces a graph candidate and a score report.
- Score report explains why each accepted edit was chosen.
- Architecture inspector Stage 3 shows:
  - selected edges
  - undecided edges
  - rejected edges
  - weak topology-promoted edges
  - selected high-level hypotheses
  - remaining odd-degree vertices
  - accepted edge score reasons
- Stage 3 UI defaults to the selected graph candidate so it is visually distinct
  from Stage 2's arrangement/evidence view.

Left for later phases:

- Phase 4 adds exactizability probes.
- Phase 5 replaces the scaffold with weighted beam selection using those probe
  costs.
- Phase 10 benchmarks selection-only output separately from exact solve.

## Phase 4: Local Exactizability Probes

Purpose: let selection use origami theorems without treating noisy raw angles as
final truth.

Status: Complete for the first inspectable probe pass. The compiler crate now
owns `exact_probe.rs`, which consumes the Stage 3 selection and reports local
exactizability costs without changing graph topology or coordinates. The
architecture inspector exposes Stage 4 on the same dense-cache samples.

New module:

```text
crates/oristudio-cp-compiler/src/exact_probe.rs
```

Probe types:

- Per-vertex Kawasaki feasibility.
- Small neighborhood feasibility for shared carriers across adjacent vertices.
- Boundary-contact feasibility for edge endpoints constrained to the square.

Probe output:

```text
ExactizabilityReport
  summary:
    feasible
    low_cost
    high_cost
    infeasible
    odd_degree_vertices
    hard_kawasaki_vertices
    max_kawasaki_residual_degrees
    max_estimated_vertex_move
    max_carrier_endpoint_move
    max_boundary_move
    total_estimated_energy

VertexExactizabilityProbe / CarrierExactizabilityProbe / BoundaryExactizabilityProbe
  feasible: bool
  status: feasible | low_cost | high_cost | infeasible
  estimated_energy
  max_vertex_move
  max_endpoint_move
  residual_before
  residual_after
  blockers
```

Implementation:

- Use pure Rust geometry so native and WASM share behavior.
- Evaluate the selected graph only; undecided candidates remain available for
  Phase 5 but are not changed here.
- Per interior selected vertex:
  - count crease rays after excluding boundary/flat assignments
  - mark odd degree infeasible because geometry-only exactization cannot fix it
  - compute sector angles and Kawasaki residual for even-degree vertices
  - estimate the minimum local movement needed from residual and incident edge
    length
  - classify feasible/low-cost/high-cost/infeasible using movement and
    high-confidence evidence budgets
- Per selected carrier:
  - estimate endpoint projection movement needed to put selected endpoints back
    on that carrier line
  - classify the projection as feasible/low-cost/high-cost/infeasible
- Per selected boundary/corner contact:
  - estimate movement needed to snap back to the relevant square side
  - classify the boundary movement with a tight budget
- Do not mutate the selected graph in this phase.
- Return costs for the weighted selector planned in Phase 5.

Tests:

- [x] A small Kawasaki residual is low cost if it can be fixed with small
  movement.
- [x] A small-looking residual is high cost if it requires moving
  high-confidence evidence too far.
- [x] Odd degree is infeasible by geometry-only exactization.
- [x] Boundary vertices remain on the square.

Acceptance:

- [x] Selection can distinguish:
  - "raw angle off but exactizable"
  - "topology wrong; geometry cannot fix it"
- [x] Probe costs are exposed in the inspector before they are used to promote a
  product path.

What remains after Phase 4:

- Phase 4 is diagnostic-only. It intentionally does not solve exact coordinates
  and does not select better topology.
- Stage 4 visualizes probe markers over the input image without the selected
  graph overlay, so the view is about exactizability only. Vertex, carrier, and
  boundary probes are independently toggleable per status where that probe type
  exists. Green = already feasible, cyan = low-cost movement, amber = high-cost
  movement, red = infeasible without topology changes, and purple/red vertex
  overlays call out hard-Kawasaki and odd-degree blockers.
- Stage 4 inspector is focused on probe review rather than dense evidence maps.
  The right sidebar is a probe matrix: each status row controls the vertex,
  carrier, and boundary probe types that exist for that status. This keeps the
  canvas and controls about exactizability only.
- Stage 4 now also has an issue-centric debugger. It builds a filterable list of
  exactizability issues from vertex, carrier, and boundary probes. Selecting an
  issue dims the source image, highlights the associated selected graph edges,
  weak/rejected candidate intervals, carriers, and focus point, and shows local
  theorem facts such as Kawasaki alternating sums. The list intentionally shows
  up to ten examples per issue type so visual QA can sample each failure family
  without drowning the browser. This is the preferred visual validation path
  because it checks the candidate graph evidence instead of treating the
  synthetic source image as ground truth.
- Phase 5 must use these costs while choosing between observed local segments,
  shared straight-carrier alternatives, junction merges, and undecided weak
  evidence.

## Phase 5: Weighted Beam Selection V2

Purpose: replace the Phase 3 greedy scaffold with the planned bounded selector
that uses visual evidence, topology costs, and Phase 4 exactizability probes.

Status: Implemented as the first bounded, exactizability-aware selector.

Implementation notes:

- `select_candidate_graph` remains the Phase 3 greedy scaffold so benchmark and
  inspector comparisons can still isolate the old weighted-selection behavior.
- `select_candidate_graph_beam` is the Phase 5 path. It starts from the
  high-confidence visual graph, explores a bounded beam of plausible weak/shared
  atomic edge additions, and scores states by:
  - visual/assignment/anchor evidence from Phase 3 score accounting
  - duplicate interval rejection
  - odd-degree improvement
  - Phase 4 exactizability probe penalties and improvements
- The selector is deterministic: candidates are sorted by score/id, beam states
  are sorted by total score, exact penalty, odd-degree count, and selected edge
  count.
- Phase 5 does not mutate coordinates. It only chooses a selected graph
  candidate and reports why selected edges were accepted.
- Assignment flipping/unknown-label solving is still Phase 8. Stage 5 preserves
  observed assignment labels while selecting topology, because using M/V solving
  here would blur topology selection with the later assignment solver.
- Inspector Stage 5 now shows the selected graph over the input and includes a
  `GT graph` toggle that draws the known FOLD graph underneath for visual
  comparison.

State decisions:

- [x] Select/reject atomic edge.
- [x] Select carrier hypothesis: separate vs shared when selected edges refer to
  those carriers.
- [x] Report low-cost merge hypotheses referenced by selected cluster vertices.
- [x] Select boundary contacts indirectly through selected boundary/corner
  vertices.
- [ ] Keep observed assignment, flip low-confidence assignment, or mark unknown.
  This is intentionally deferred to Phase 8 so topology selection and assignment
  solving stay separable.

Algorithm:

- [x] Start with deterministic beam search, not ILP.
- [x] Keep top K graph states.
- [x] Every state stores:
  - selected edge IDs
  - score breakdown
  - exactizability penalty
  - odd-degree count
  - per-edge improvement accounting
- [x] Use Phase 4 exactizability probes during scoring.
- [x] Keep the solver deterministic and explainable before considering more complex
  MaxSAT/ILP/factor-graph approaches.

Tests:

- [x] A weak edge is selected if it fixes odd degree and has nearby visual
  evidence.
- [x] A no-evidence edge is rejected even if it would reduce one local residual.
- [x] A near-duplicate false line is rejected when it creates topology/constraint
  cost.
- [x] A merge is selected when it fixes a disconnected near-junction with small
  movement.
- [x] A high-cost merge is not selected.
- [x] A visually stronger but topology-worse candidate is kept out when a weaker
  candidate improves exactizability.
- [x] A shared carrier hypothesis can be selected when selected edges use it.

Acceptance:

- [x] Beam selector produces selected graph states and score reports.
- [x] Score reports explain why each accepted edit was chosen.
- [x] Exactizability costs are visible in the debug UI.
- [ ] Selection-only output is benchmarked separately from exact solve in Phase
  10.

What remains after Phase 5:

- The selected graph is still not expected to be product-valid. On the smoke
  inspector sample, Stage 5 exposes a noisy selected graph with many remaining
  exactizability failures. That is useful signal for Phase 7/10 rather than a
  failure of the debug stage itself.
- Phase 7 must exact-solve geometry for a chosen topology instead of merely
  probing exactizability.
- Phase 8 must solve assignments after topology/geometry are plausible.

## Phase 5b: Structural Replacement Beam Selection Audit

Purpose: make Phase 5 choose crease-level structure, not merely high-scoring
atomic evidence intervals.

Status: Incomplete. This phase correctly identified the structural problem and
introduced useful beam moves and accounting, but it did not actually change the
output abstraction. The beam still emitted `selected_edge_ids`, where every ID
is an atomic interval from the arrangement. Those atomic intervals are evidence
provenance, not final crease edges.

Where it got fucked up:

- The intended architecture was "beam chooses final crease-level alternatives."
  For example, it should choose between "keep these local fragments" and "select
  this one shared straight carrier span between real junctions."
- The implemented code instead chose atomic intervals and then reported
  structural edits saying some intervals belonged to a shared-carrier
  replacement.
- Because the public selected graph was still atomic, the Stage 5 inspector
  showed many tiny segments even when the edit accounting said a shared carrier
  had won.
- The follow-up `compiled_selection_graph` inspector artifact was a
  post-selection contraction layer. It made the UI look closer to the desired
  graph but was not what the beam had selected, so it violated the debug UI's
  purpose.

Corrective decision:

- Do not keep inspector-only graph beautification.
- Keep atomic intervals as provenance and exact-probe input.
- Add a first-class selected span output to the compiler selection result.
- Render selected spans by default in Stage 5.
- Keep raw atomic intervals behind an explicit provenance/debug toggle.

Problem found during Stage 5 visual inspection:

- The beam-selected graph often contains chains of short, slightly wobbly local
  segments where the intended crease is visually one straight line between two
  real junctions.
- This happens because Phase 5 starts from all strong local intervals and only
  explores additive moves. Once fragments are seeded, the beam has no strong
  way to replace them with a shared-carrier interpretation.
- Degree-2 interior vertices are too cheap. Odd-degree checks do not catch them,
  because degree 2 is even. In origami, a degree-2 interior point is usually a
  pass-through point on a crease, not a real junction. If the incident edges are
  not collinear, it is a topology smell.

Architecture changes:

- Keep atomic intervals as the arrangement representation, but score graph states
  at the structural level.
- Add shared-carrier replacement moves:
  - selecting a shared carrier can add its contiguous atomic intervals as a
    group
  - local observed fragments explained by that shared carrier are removed from
    the state
  - selecting a local fragment removes overlapping selected shared-carrier
    intervals from the same primitive family
- Treat degree-2 interior vertices explicitly:
  - collinear degree-2 vertices are pass-through/collapsible and should be
    hidden from junction visualization and recorded as collapsible edits
  - non-collinear degree-2 vertices receive a structural penalty
- Reward continuity:
  - selected shared-carrier groups receive a continuity reward proportional to
    the amount of local fragmented evidence they explain
  - local fragments that have an available shared-carrier alternative receive a
    fragmentation penalty unless the shared alternative loses on evidence or
    constraints
- Add edit accounting:
  - shared carrier replacements
  - local fragments removed by replacement
  - collapsible degree-2 pass-through vertices
  - non-collinear degree-2 warnings
- Score exactizability before beam pruning:
  - each beam state carries an exactizability penalty
  - replacement candidates are allowed to survive because the exact probe sees
    the cleaner topology before the beam is truncated
  - exactizability penalties are cached by selected-edge-set key, so repeated
    graph states are never probed twice
  - the previous lazy final-survivor-only exact rescore was removed because it
    pruned clean shared-carrier hypotheses too early
- Keep structural scoring bounded with a precomputed selection index:
  - map each shared-carrier alternative to the local fragments it can explain
  - map each local fragment to whether it has any shared-carrier alternative
  - use those indexes during beam scoring instead of scanning all carriers and
    all atomic intervals for every candidate state
  - preserve the same search space; the index is a performance optimization, not
    a pruning heuristic

Algorithm:

- [x] Build beam moves over both individual edge additions and shared-carrier
  replacement groups.
- [x] Re-score each proposed state from the full selected set after replacement,
  rather than only adding an incremental edge score.
- [x] Include structural penalties/rewards in the state score:
  - visual/assignment/anchor evidence
  - exactizability penalty
  - odd-degree count
  - non-collinear degree-2 cost
  - local fragmentation cost
  - shared-carrier continuity reward
- [x] Use correctness-first exactizability:
  - exact penalty is applied to candidate states before beam pruning
  - exact penalty cache keyed by selected edge set
  - final selection is the best already-exact-scored beam state
- [x] Add precomputed structural indexes so the browser/debug loop can inspect
  Stage 5 without rescanning the whole arrangement for every beam state.
- [x] Keep deterministic ordering for moves and beam states.
- [x] Keep selection output inspectable as atomic intervals, while edit
  accounting explains which selected intervals are structural replacements or
  collapsible pass-throughs.

Tests:

- [x] A shared-carrier replacement can beat several strong local fragments when
  it explains the same primitives with less structural cost.
- [x] Selecting a shared carrier removes/conflicts with local fragments that it
  explains.
- [x] A non-collinear degree-2 interior vertex is penalized.
- [x] A collinear degree-2 interior vertex is reported as collapsible, not as a
  hard topology error.
- [x] Edit accounting reports the replacement and collapsed-pass-through counts.

Inspector/performance notes:

- The Stage 5 inspector renders the selected graph with carrier-aligned geometry
  and visible selected junctions so pass-through points are distinguishable from
  real branch/corner/contact junctions.
- The correctness-first selector is still usable for debug inspection: the
  treemaker smoke sample `treemaker_tree_v1-5gjmj-004937__clean__001` takes
  roughly 17-18 seconds end-to-end through the Stage 5 API on the local dev
  machine.
- On that same sample, the selector now chooses the previously missed
  shared-carrier replacement for carrier `288`: it replaces 116 local fragments
  with 29 shared-carrier intervals, reduces selected local fragments with shared
  alternatives from 451 to 255, and reduces odd vertices from 101 to 72.

Original acceptance, now corrected:

- [ ] Stage 5 selected graph visibly prefers shared straight carriers over
  wobbly fragment chains when the arrangement contains that alternative.
- [x] Inspector Stage 5 reports structural edits so visual review can tell
  whether the compiler replaced fragments or merely selected the old local
  evidence.
- [ ] Existing Phase 5 tests continue to pass or are updated to the new
  structural semantics.

## Phase 5c: First-Class Final Crease Span Selection

Purpose: make the selected graph representation match the intended compiler
architecture.

Status: Complete as of May 30, 2026.

Architecture:

- Add `selected_spans` to `CandidateSelection`.
- A selected span is a final crease candidate, not an atomic evidence interval.
  It contains:
  - final endpoint vertex IDs
  - selected carrier ID
  - assignment label/confidence copied from the selected evidence
  - source atomic interval IDs used as provenance
  - replaced local atomic interval IDs when it is a shared-carrier replacement
  - score/reason metadata for inspector/debugging
- Shared-carrier beam moves emit `shared_carrier_span` selections. Their atomic
  intervals remain in `selected_edge_ids` only so exactizability probes can
  inspect evidence support and so the UI can show provenance.
- Non-replaced local selections emit `atomic_interval` spans. That is an honest
  output: if the beam failed to choose a shared span, the final graph should show
  the ugly local fragments, not hide them.
- Stage 5 inspector renders `selection.selected_spans` by default.
- Stage 5 inspector can toggle raw selected atomic intervals as provenance.
- Remove `compiled_selection_graph` from the inspector API/UI. The compiler's
  selection result is the source of truth.

Algorithm:

- Build final spans from the beam's selected state and structural replacement
  edits.
- For a shared-carrier replacement:
  - group selected atomic intervals by selected shared carrier
  - walk contiguous interval chains
  - collapse pass-through vertices only inside that selected span candidate
  - preserve observed junctions, junction clusters, boundary contacts, and
    square corners as possible span endpoints
  - record collapsed atomic intervals as provenance, not graph edges
- For local selections not replaced by a shared-carrier span:
  - emit one `atomic_interval` span per selected atomic interval
  - do not merge these cosmetically
- `selected_edge_ids` remains as selected evidence/provenance, but
  `selected_spans` is the final graph surface for Stage 5 and later phases.

Tests:

- [x] Shared-carrier replacement emits one final selected span instead of all
  source atomic intervals as graph edges.
- [x] Shared-carrier replacement preserves a real observed junction as a split
  point, producing two spans when a true branch lies on the carrier.
- [x] Local fragments remain as separate selected spans when the beam does not
  select a shared-carrier replacement.
- [x] `selected_edge_ids` still contains selected atomic provenance for
  exactizability probes.
- [x] Stage 5 inspector renders selected spans by default and raw atomic
  provenance only when toggled.
- [x] The treemaker debug sample no longer shows the selected shared carrier as
  a chain of tiny atomic graph edges when a shared-carrier span was actually
  selected.

Acceptance:

- [x] The selection API makes it impossible to confuse final graph spans with
  atomic evidence intervals.
- [x] Tests fail if a shared-carrier replacement is reported but no
  `shared_carrier_span` is emitted.
- [x] Inspector code contains no post-hoc selected-graph contraction layer.

Verification:

- `cargo test -p oristudio-cp-compiler`
- `cargo test -p oristudio-cp-detect-inspector`
- `npm --workspace @treemaker/cp-detect-architecture-inspector run build`
- Stage 5 smoke API on
  `treemaker_tree_v1-5gjmj-004937__clean__001`: `selected_spans=360`,
  `selected_edges=497`, `shared_spans=85`, `collapsed=137`, and no
  `compiled_selection_graph` payload.
- Browser sanity check at `http://localhost:5176/`: Stage 5 loaded without
  `Request failed`/`not found`; toolbar only exposes selected graph, GT graph,
  and atomic provenance toggles.

## Phase 5d: Span-Level Beam Objective

Purpose: make the Stage 5 selector choose between final crease hypotheses, not
between atomic evidence intervals.

Status: Selection-objective implementation complete as of May 31, 2026.

Root cause from the May 31 treemaker sample:

- Sample: `treemaker_tree_v1-5gjmj-004937__clean__001`.
- Phase 5c correctly exposed `selected_spans`, but those spans are still
  derived after the beam has selected atomic intervals.
- The beam state is still `BTreeSet<atomic_edge_id>`.
- `score_beam_state` still sums selected atomic edge scores.
- Shared-carrier moves still add many shared atomic intervals, then
  `selected_spans_from_selection` contracts them afterward.
- This makes the search compare:
  - many high-confidence observed local atomic fragments
  - versus many inferred shared-carrier atomic intervals
- It does not compare:
  - one clean final crease span
  - versus a chain of tiny pass-through fragments.
- Because local Hough fragments each receive their own visual reward, the
  objective accidentally rewards fragmentation.
- Because shared-carrier alternatives are charged `shared_carrier_cost` per
  atomic interval, long clean shared spans are over-penalized when they cross
  many candidate vertices.
- Example diagnostics:
  - shared carrier `258` would explain the visible right-side valley chain, but
    loses: local fragments score about `20.55`, while shared evidence scores
    about `8.27` plus only about `3.6` continuity reward.
  - shared carrier `273` loses similarly: local fragments score about `38.90`,
    shared evidence scores about `16.81` plus about `6.84` reward.

Implementation result:

- `select_candidate_graph_beam` now builds span candidates before search.
- The beam state is now selected span IDs plus derived atomic provenance.
- Atomic intervals are candidate spans only when they are plausible final
  geometry; shared-carrier spans compete directly against local fragments.
- Shared spans score support once per final span, charge carrier hypothesis
  cost once, and receive replacement/fragmentation credit only for local
  fragments they geometrically explain.
- Local atomic fragments with shared alternatives are penalized in the span
  objective and in structural accounting.
- The old `BeamMove::Edge` / `BeamMove::SharedCarrier` atomic selector,
  atomic beam state, and post-selection replacement objective were deleted.
- The Stage 5 public output remains `selected_spans`; `selected_edge_ids` is
  selected evidence/provenance.

Target architecture:

- Introduce a first-class span hypothesis type used by the beam itself.
- Atomic intervals become provenance and support samples, not the optimization
  unit for the final graph.
- Stage 5 search state stores selected span hypothesis IDs.
- Each selected span has:
  - carrier ID
  - final endpoint vertex IDs
  - source atomic edge IDs as evidence/provenance
  - replaced local atomic edge IDs when applicable
  - assignment candidate
  - support statistics
  - topology endpoints used by degree/exactizability probes
  - score breakdown and reasons.
- `selected_edge_ids` remains available only as selected evidence/provenance
  for diagnostics and exactizability probes.
- `selected_spans` becomes both the public Stage 5 graph and the internal
  optimization surface.

Span hypothesis construction:

- Build `atomic_interval` span hypotheses for local observed intervals.
- Build `shared_carrier_span` hypotheses directly from shared carriers:
  - group contiguous selected-support intervals on the shared carrier
  - collapse only carrier-intersection and observed-line-endpoint pass-through
    vertices
  - preserve observed junctions, junction clusters, boundary contacts, and
    square corners as true span endpoints
  - attach all atomic intervals along the path as provenance
  - attach all local fragments explained by the shared carrier as replaceable
    provenance.
- Build optional `local_chain_span` hypotheses only when local observed
  fragments are already collinear on the same underlying observed carrier and
  can be collapsed without conflicting with a shared-carrier span. This is a
  fallback for cases where no shared carrier exists.
- Do not build cosmetic merged spans after selection.

Conflict model:

- Two span hypotheses conflict if they claim the same atomic interval as final
  geometry and are not the same selected span.
- A shared-carrier span conflicts with local fragments it explains.
- A span conflicts with another span when their endpoint/topology path would
  create duplicate edges between the same true endpoints.
- Boundary spans remain governed by the locked-border/border-prior path; border
  cleanup is not reintroduced as an experimental compiler pass here.

Scoring:

- Score support once per final span, not once per atomic interval.
- Use aggregated evidence:
  - mean/min/max line support along source atomic intervals
  - support coverage along the span
  - endpoint support
  - assignment confidence
  - carrier fit residual or hypothesis cost once per span
  - length/scale sanity
  - artifact/non-crease evidence where available.
- Reward replacing many local fragments only when the replacement is a
  geometrically coherent span with comparable visual support.
- Penalize fragmentation explicitly:
  - degree-2 pass-through vertices that remain in the final span graph
  - multiple short adjacent spans on near-identical carriers when a clean shared
    span exists
  - selected local fragments that have an unselected shared alternative with
    enough evidence.
- Do not make shared carriers win unconditionally. A local fragment chain should
  remain selected when:
  - the shared carrier has poor support coverage
  - the shared carrier crosses a real observed junction incorrectly
  - the shared carrier assignment/evidence is incompatible
  - the shared carrier would worsen exactizability or topology.

Search:

- Replace `BeamMove::Edge` / `BeamMove::SharedCarrier` with span-level moves.
- Beam state stores selected span IDs plus derived selected atomic provenance.
- Exactizability probes currently still consume selected atomic provenance. This
  keeps the existing probe implementation working, but it is not the final
  architecture; the next exactization phase should make probes consume selected
  span endpoints directly.
- Start with correctness-first beam width and candidate limits. Tune speed only
  after the treemaker failure case is fixed and covered by tests.
- Add debug output for rejected span hypotheses:
  - candidate span score
  - conflicting selected spans
  - replaced fragments
  - exactizability delta
  - reason it lost.

Inspector:

- Stage 5 should show selected span hypotheses exactly as selected by the beam.
- Add an optional "candidate spans" overlay for this phase:
  - selected
  - rejected shared spans
  - rejected local fragments
  - conflicts/replacements for a hovered or selected span.
- Add a per-span details panel so the treemaker right-side failure can be
  inspected without reading JSON.

Tests:

- [x] Synthetic fixture where three collinear observed fragments and one shared
  carrier compete; the beam selects one `shared_carrier_span`.
- [x] Synthetic fixture where a true observed junction lies on the carrier; the
  beam preserves the split into two spans.
- [ ] Synthetic fixture where a weak/incorrect shared carrier crosses a real
  junction; local spans remain selected.
- [x] Stage 5 smoke check for `treemaker_tree_v1-5gjmj-004937__clean__001`
  proving shared carrier `258` or its equivalent selected span replaces the
  right-side tiny valley fragment chain.
- [x] Stage 5 smoke check proving shared carrier `273` or its equivalent span
  replaces the central/right unknown fragment chain if visual inspection
  confirms that is the correct crease.
- [x] `selected_edge_ids` remains provenance-only and cannot be rendered as the
  default final graph.
- [ ] Exactizability probes consume selected span endpoints rather than atomic
  provenance. Current implementation still uses provenance for probe
  compatibility.
- [x] Stage 5 inspector has no post-hoc graph beautification layer.

May 31 verification:

- `cargo test -p oristudio-cp-compiler`: 74 passed.
- `cargo test -p oristudio-cp-detect-inspector`: 2 passed.
- `npm --workspace @treemaker/cp-detect-architecture-inspector run build`:
  passed.
- Stage 5 API smoke on
  `treemaker_tree_v1-5gjmj-004937__clean__001?threshold=0.65&map_size=32`:
  `selected_spans=286`, `selected_edges=517`, `shared_spans=47`,
  `atomic_spans=239`, `collapsed=231`,
  `shared_replacements=26`, `local_fragments_replaced=881`,
  `local_fragments_retained=195`, `odd_degree_vertices=58`.
- The same smoke check selected shared carrier `258` as one shared span
  replacing 20 local fragments.
- The same smoke check selected shared carrier `273` as two shared spans
  replacing 36 local fragments total.
- Correctness-first Stage 5 smoke latency for that sample was about `7.1s` on
  the local debug server.

Acceptance:

- The treemaker debug sample no longer shows the obvious right-side chain as
  many tiny selected final spans when a coherent shared span candidate exists.
- Selected final graph has materially fewer impossible degree-2 pass-through
  vertices without deleting real observed junctions.
- Shared spans improve structural quality without blindly hallucinating lines.
- The objective and debug UI make it clear why a shared span won or lost.
- Existing compiler and inspector test suites pass.
- A Stage 5 API smoke check reports selected spans and no
  `compiled_selection_graph` payload. Rejected candidate-span explanation UI is
  still future inspector work.

## Phase 5e: Observed Carrier Chain Spans

Purpose: make ordinary observed carriers span-complete, not only shared-carrier
alternatives.

Status: Complete as of June 1, 2026.

Root cause from visual inspection:

- Phase 5d made shared-carrier spans compete directly against local fragments.
- The selected graph could still show tiny selected spans when all fragments
  belonged to the same `observed_local` carrier.
- In that case the clean long crease was not a `shared_collinear_alternative`;
  it was the original observed carrier split by many carrier-intersection or
  observed-line-endpoint pseudo-vertices.
- The beam was therefore choosing between tiny `atomic_interval` candidates,
  because the clean observed-carrier span did not exist as a candidate.
- Making exactizability probes span-native is still desirable, but it does not
  solve missing candidate coverage. The selector cannot choose a long span that
  is never generated.

Target behavior:

- For each observed local carrier, find maximal chains of selected-support
  atomic intervals.
- Collapse only pass-through vertices:
  - `carrier_intersection`
  - `observed_line_endpoint`
  - interior degree-2 vertices whose incident selected-support intervals are on
    the same carrier.
- Preserve true endpoints:
  - observed junctions
  - junction clusters
  - boundary contacts
  - square corners.
- Emit an `observed_carrier_span` candidate for each maximal chain with at
  least two source intervals or at least one collapsed pass-through vertex.
- The observed-carrier span conflicts with every atomic interval it covers, so
  the beam must choose either the long crease or the tiny fragments.
- Atomic intervals covered by an observed-carrier span receive an explicit
  fragmentation penalty.
- Boundary spans remain governed by the locked-border path; this phase should
  not invent a second border cleanup algorithm.

Tests:

- [x] Synthetic fixture where three tiny intervals on one observed carrier are
  collapsed into one `observed_carrier_span`.
- [x] Synthetic fixture where a real observed junction lies in the chain and is
  preserved as a split endpoint.
- [x] Stage 5 smoke check on
  `treemaker_tree_v1-5gjmj-004937__clean__001` showing fewer atomic selected
  spans and more long carrier spans.
- [x] Inspector renders `observed_carrier_span` as selected final graph
  geometry, not as atomic provenance.

June 1 verification:

- `cargo test -p oristudio-cp-compiler`: 76 passed.
- `cargo test -p oristudio-cp-detect-inspector`: 2 passed.
- `npm --workspace @treemaker/cp-detect-architecture-inspector run build`:
  passed.
- Stage 5 API smoke on
  `treemaker_tree_v1-5gjmj-004937__clean__001?threshold=0.65&map_size=32`:
  `selected_spans=270`, `selected_edges=514`, `atomic_interval=233`,
  `shared_carrier_span=36`, `observed_carrier_span=1`, `collapsed=244`,
  `shared_replacements=25`, `local_fragments_replaced=851`,
  `local_fragments_retained=207`, `odd_degree_vertices=68`.
- The smoke selected carrier `111` as one `observed_carrier_span` with `19`
  atomic evidence intervals and `18` collapsed pass-through vertices, replacing
  the visually obvious row of tiny selected spans in the treemaker example.
- Correctness-first Stage 5 smoke latency for that sample was about `8.2s` on
  the local debug server.

Acceptance:

- The selected graph no longer shows obvious degree-2 chains as many selected
  final spans when all fragments lie on one observed carrier.
- Real observed junctions are not collapsed away.
- Existing compiler and inspector tests pass.
- The Stage 5 smoke sample remains usable in the browser without reintroducing
  post-hoc visualization cleanup.

## Phase 5f: Semantic Pass-Through Normalization Before Beam Search

Purpose: make Stage 5 select crease-level topology by default, not high-scoring
atomic evidence fragments.

Status: Complete as of June 3, 2026 for the compiler normalization
implementation and inspector plumbing. The real treemaker smoke sample still
shows that normalization alone is not enough to make the compiler graph clean;
remaining quality work belongs to the later exact/constraint selection phases,
not to hidden post-hoc visualization cleanup.

Root cause from repeated visual inspection:

- Phase 5d/e created long span candidates, but the search still seeded many
  strong `atomic_interval` candidates before those long spans competed.
- Phase 5e only produced `observed_carrier_span` candidates when all fragments
  belonged to the same observed carrier.
- Real detector output often represents one visual crease as several nearly
  collinear observed carriers, split by tiny endpoint/intersection/junction
  artifacts.
- Those artifacts can be degree-2, collinear, and visually unsupported as true
  origami vertices, yet still survive because each small segment has local line
  support.
- Reporting a selected degree-2 vertex as "collapsible" is not enough. If it is
  collapsible, it should not remain in the selected final graph.

Target behavior:

- Before beam search, build semantic pass-through span candidates over maximal
  chains of plausible atomic intervals.
- Collapse an interior vertex by default when:
  - it is not a square corner, boundary contact, or boundary vertex;
  - the candidate graph has exactly two plausible incident intervals at that
    vertex;
  - the two intervals are same-assignment-compatible;
  - their carriers/edge directions are nearly collinear.
- Preserve a vertex as a real endpoint when it has a branch, lies on the
  boundary, is a corner/contact, or represents a meaningful non-collinear split.
- Emit a `normalized_pass_through_span` candidate for each maximal chain that
  collapses at least one pass-through vertex.
- The normalized span conflicts with every atomic interval it covers.
- Atomic intervals covered by a normalized pass-through span should not be
  seeded as ordinary final graph edges. They remain provenance and only become
  selectable fallback when no semantic span explains them.
- The beam seed should prefer high-confidence crease-level spans first, then
  uncovered atomic fallback intervals.
- The Stage 5 inspector must render the actual selected spans. No post-hoc
  graph beautification is allowed.

Implementation guardrails:

- Do not reintroduce the legacy decoder or a hidden fallback path.
- Do not change the Python implementation.
- Do not add a visualization-only collapse. The selected graph data itself must
  contain the semantic spans.
- Keep boundary/border handling out of this phase; borders remain governed by
  the locked-border prior.
- If a tradeoff appears between collapsing uncertain vertices and preserving
  real junctions, stop and make that tradeoff explicit instead of silently
  changing the target architecture.

Tests:

- [x] Synthetic fixture where a chain of high-scoring fragments across multiple
  nearly collinear observed carriers collapses into one
  `normalized_pass_through_span`
  (`local_fragments_on_degree_two_chain_normalize_without_shared_replacement`).
- [x] Synthetic fixture where a branch at the middle vertex prevents collapse
  (`normalized_pass_through_span_preserves_branch_junction_as_endpoint`).
- [x] Synthetic fixture where a non-collinear degree-2 bend is not normalized
  into a straight crease.
- [x] Synthetic fixture where a single uncovered edge remains available as an
  atomic fallback (`beam_marks_exactizability_as_evaluated` now asserts the
  selected Stage 5 span stays atomic).
- [x] Stage 5 smoke check on
  `treemaker_tree_v1-5gjmj-004937__clean__001` runs against the actual selected
  graph surface. Current result at threshold `0.65`, map size `32`: 11.25s,
  `598` selected provenance edges, `261` selected spans (`177`
  `atomic_interval`, `71` `shared_carrier_span`, `13`
  `observed_carrier_span`), `337` collapsed pass-through vertices recorded in
  spans, `840` local fragments replaced, `47` remaining collapsible degree-2
  vertices, and `5` non-collinear degree-2 vertices. This confirms the selected
  graph is no longer post-hoc beautified, but also confirms the real sample is
  still not clean enough.

Acceptance:

- Selected final graph spans are crease-level candidates wherever the topology
  has collapsible degree-2 pass-through chains.
- Strong local evidence cannot by itself force a fragmented final graph when a
  semantic span explains the same evidence.
- Remaining `atomic_interval` spans correspond to true single-edge fallback
  geometry, not chains that should have been normalized.
- Compiler and inspector tests pass.
- The plan records smoke metrics before the checkpoint is committed.

Implementation notes:

- The selected graph output now comes directly from beam-selected span
  candidates. The temporary post-beam normalizer was removed because it could
  collapse through split points after the search had already chosen separate
  spans, making the inspector look cleaner than the actual selected state.
- Pass-through normalization candidates only collapse vertices with exactly two
  plausible incident intervals. Branches, boundaries, corners/contacts, and
  non-collinear degree-2 bends remain explicit graph structure.
- `selected_edge_ids` remains provenance for model/evidence intervals;
  `selected_spans` is the Stage 5 graph surface to inspect and feed forward.

## Phase 6: Source-Neutral CandidateGraph IR And Legacy-First Adapter

Purpose: stop building competing selector/exact-solver paths. Legacy is already
good at proposing most of the topology, while the compiler-native arrangement
path is still useful as an evidence generator and research path. Both should
feed one shared candidate representation, one shared beam selector, and one
shared exact solver.

Status: Complete as of June 3, 2026.

Implementation notes:

- `crates/oristudio-cp-compiler/src/candidate_graph.rs` defines the
  source-neutral IR, cost model, assignment evidence, conflicts, selected graph,
  and Phase 7 exact-solver input/output contract.
- `LegacyCandidateAdapter` converts frozen legacy `CandidateProgram` output
  into `CandidateGraph`, including optional lower-threshold spans when a weak
  program is supplied.
- The arrangement path uses
  `candidate_graph_from_arrangement_for_selection` so the Phase 5c-5f
  normalized/shared span candidates are preserved before feeding the shared
  CandidateGraph selector.
- `select_candidate_graph_beam_from_ir` is the source-neutral selector entry
  point. The older arrangement selector remains for regression comparison and
  existing tests, but Stage 5 inspector now uses the CandidateGraph path.
- `compare_candidate_graph_selector` is the repeatable dense-cache command for
  comparing frozen legacy counts against `legacy_candidates + selector`.
- Follow-up on June 3, 2026: the Stage 5 inspector and comparison command now
  pass a lower-threshold legacy decode into `LegacyCandidateAdapter::from_programs`.
  Weak boundary fragments are intentionally ignored so the deterministic border
  remains owned by the normal locked border path. On the 12-sample
  `smoke-1024-s3-browser-onnx` cache, this produced 151 weak interior
  candidates but selected 0 of them under the current beam costs; aggregate
  normalized-FOLD segment F1 stayed effectively flat/slightly worse
  (`0.86735 -> 0.86726`). This means the plumbing is present, but the selector
  objective is not yet recovering missing low-threshold creases.

Core architectural rule:

```text
legacy selected graph + low-threshold candidates ─┐
                                                  ├─> CandidateGraph
arrangement_v2 compiler candidates ───────────────┘
       -> shared beam selector
       -> SelectedGraph
       -> exact geometric solve
       -> assignment solve / verifier / FOLD export
```

There must not be a separate "legacy beam selector." The only intended
divergence is how candidates are produced and what priors/provenance they carry.
Everything after `CandidateGraph` should be shared.

Why this phase exists:

- Legacy currently gets most graph topology right. The most visible residual
  failures are missing creases and local geometric inaccuracy.
- Lowering the line threshold directly in legacy would improve recall but also
  admit more false positives. Those lower-threshold lines should become optional
  candidates with costs, not unconditional exported edges.
- The exact solver should not care whether the chosen topology came from legacy
  or arrangement V2. It should consume a selected topology with evidence,
  movement policies, and constraints.
- Without a source-neutral IR, Phase 7 would either hard-code today’s
  arrangement-specific types or accidentally create a parallel legacy pipeline.

### CandidateGraph Schema

Create a new source-neutral module:

```text
crates/oristudio-cp-compiler/src/candidate_graph.rs
```

The top-level object should be serializable for inspector snapshots and fixture
tests:

```rust
CandidateGraph {
    schema,
    coordinate_space,
    image_size,
    vertices,
    crease_candidates,
    boundary,
    conflicts,
    alternatives,
    cost_model,
    provenance,
    report,
}
```

#### Vertices

Each `CandidateVertex` is a possible graph point, not necessarily a final
exported FOLD vertex.

Required fields:

- `id`
- approximate `point`
- `kind`: `corner`, `boundary_contact`, `interior_junction`,
  `line_endpoint`, `candidate_intersection`, `junction_cluster`
- `support`: calibrated confidence that this is a real vertex
- `movement_policy`: `locked`, `boundary_only`, `movable`, `merge_candidate`
- optional `boundary_side`
- source/provenance ids

Downstream usage:

- Beam selector uses vertex support and kind to score candidate endpoints,
  avoid fake degree-2 junctions, and explain selected/rejected topology.
- Exact solver creates variables only for movable vertices. Corners are fixed,
  boundary contacts stay on their side, and locked vertices get very high
  movement cost.
- Debug UI can show why a vertex is locked, movable, inferred, or inherited
  from legacy.

Done means:

- Unit tests cover fixed corners, boundary contacts, movable interior vertices,
  and merge-candidate vertices.
- Serialization round-trips preserve ids, movement policies, boundary sides,
  and provenance.
- No downstream code needs to infer vertex kind from source-specific structs.

#### Crease Candidates: Edge vs Span

Use `CandidateCreaseSpan` as the main selection unit. A span may represent one
simple crease edge or one clean crease hypothesis that replaces many tiny
observed fragments.

Definitions:

- **Crease edge**: a final FOLD-style graph edge between two real vertices.
- **Crease span**: a selectable candidate explanation between two candidate
  vertices. It may cover multiple observed atomic fragments and collapsed
  pass-through vertices.

Required fields:

- `id`
- endpoint vertex ids
- approximate carrier: direction, normal/rho or point-direction form
- optional `source_interval` on the carrier
- `assignment_evidence`
- `presence_probability` or calibrated presence logit
- visual/support summaries: min/mean/max support, style support, non-crease
  support if available
- `source_kind`: `legacy_selected`, `legacy_low_threshold`,
  `arrangement_observed`, `arrangement_shared`, `repair_candidate`,
  `border_generated`
- `selection_policy`: `locked`, `strong_optional`, `optional`,
  `weak_optional`, `discouraged`
- source atomic fragment ids and collapsed pass-through vertex ids
- provenance/explanation strings

Downstream usage:

- Beam selector chooses spans, not raw fragments. Long clean spans conflict with
  fragment chains they explain.
- Exact solver turns selected spans into exact crease edges after moving
  vertices and fitting carriers.
- Export emits final edges from selected/exact solved spans.
- Debug UI can show selected spans by default and atomic fragments only as
  provenance.

Done means:

- A selected span can represent one edge or many fragments without changing
  selector/exact-solver APIs.
- Tests prove a long span conflicts with and replaces its fragment chain.
- Tests prove a single uncovered candidate remains selectable as an atomic
  fallback.
- The inspector labels selected spans separately from provenance intervals.

#### Boundary Model

Boundary should not compete like normal visual evidence.

Required fields:

- four locked square corners
- four sides
- boundary-contact vertices
- deterministic border reconstruction policy
- generated border spans/edges with `border_generated` provenance

Downstream usage:

- Beam selector treats border as locked context, not an ordinary line
  detection problem.
- Exact solver locks square coordinates and keeps boundary contacts on their
  assigned side.
- Export emits clean square boundary edges sorted by side contacts.

Done means:

- The legacy locked-border behavior is preserved when converted through
  `CandidateGraph`.
- Boundary contacts sort deterministically per side.
- Tests prove malformed detected border fragments are not exported as competing
  interior candidates.

#### Assignment Evidence

Recommendation: assignment evidence lives on each crease candidate. Keep
separate provenance records only for debugging/aggregation when a span combines
many source fragments.

Required fields:

- probabilities or logits for `mountain`, `valley`, `boundary`, `auxiliary`,
  `unknown`
- observed label, if any
- source: `legacy_color`, `model_assignment_head`, `span_aggregate`,
  `inferred`, `unknown`
- confidence/margin

Cost handling:

- Do not store an imperative "flip this" decision in `CandidateGraph`.
- Store the probability/logit surface.
- Downstream derives additive label cost:

```text
cost(label) = -ln(clamp(P(label), 0.01, 0.99))
flip_cost(A -> B) = cost(B) - cost(A)
```

Downstream usage:

- Beam selector may use assignment costs lightly to avoid obviously bad
  topology, but should not overfit M/V before geometry is exact.
- Phase 8 assignment solver uses the same evidence strongly while satisfying
  Maekawa/LBL and reporting observed vs inferred labels.
- Exact solver mostly ignores M/V except where assignment-specific constraints
  are explicitly introduced later.

Done means:

- CandidateGraph stores assignment probability evidence, not pre-decided flip
  mutations.
- Span aggregation from multiple fragments is deterministic and tested.
- Tests cover high-confidence label preservation, low-confidence ambiguity, and
  unknown-label neutrality.

#### Conflicts And Alternatives

Conflicts make the selector choose between explanations instead of selecting
contradictory candidates.

Required relationship types:

- duplicate spans between same endpoints
- long span replaces fragment chain
- candidates cross without a supported junction
- nearby vertex alternatives / merge candidates
- shared-carrier alternative versus separate local segments
- border-generated edge versus detected border-like fragment

Downstream usage:

- Beam selector enforces hard conflicts and can score soft alternatives.
- Debug UI explains why a candidate lost.
- Exact solver receives a coherent selected topology instead of contradictory
  overlaid geometry.

Done means:

- Conflict generation is source-neutral and tested independently of both
  adapters.
- The selector cannot select both a span and the fragments it replaces.
- The selector cannot select two duplicate candidates with the same effective
  endpoints/carrier unless explicitly allowed.

#### Priors And Cost Normalization

Use additive energy where lower is better internally. Existing "higher score is
better" selector code may keep a score wrapper temporarily, but the
`CandidateGraph` cost model should be expressed as normalized cost terms so the
exact solver and selector speak the same language.

Recommended normalized terms:

```text
presence_cost        = -ln(clamp(p_present, 0.01, 0.99))
assignment_cost      = -ln(clamp(p_label, 0.01, 0.99))
movement_cost        = (distance_px / sigma_distance_px)^2
angle_cost           = (angle_degrees / sigma_angle_degrees)^2
rho_cost             = (rho_px / sigma_rho_px)^2
fragmentation_cost   = pass_through_count * weight
source_prior_cost    = adapter-specific additive prior
continuity_reward    = negative cost for clean spans replacing fragments
```

Initial source priors:

- `legacy_selected`: high presence probability, high removal cost, but not
  locked unless border.
- `legacy_low_threshold`: medium/low presence probability, cheap to reject,
  useful when constraints/evidence support it.
- `arrangement_observed`: calibrated from line support and vertex support.
- `arrangement_shared`: pays hypothesis/source cost, gains continuity reward
  when replacing fragments.
- `repair_candidate`: expensive until it repairs hard local constraints.
- `border_generated`: locked.

Done means:

- Cost normalization constants live in one config struct with documented units.
- Unit tests cover probability-to-cost clamping, movement/angle normalization,
  and source prior ordering.
- No adapter hard-codes final decisions with magic thresholds after candidate
  creation; thresholds only control candidate generation and initial priors.

#### Provenance And Reports

Every candidate must be explainable.

Required provenance:

- source adapter: `legacy`, `legacy_low_threshold`, `arrangement_v2`,
  `repair_candidate`
- source edge/vertex/primitive ids
- original model or legacy scores
- crop/image coordinate context when available
- explanation strings suitable for inspector UI

Done means:

- Debug UI can answer "why is this line here?" and "why did it lose?"
- Benchmark reports can separate legacy-kept, weak-added, compiler-added,
  dropped, and exact-solver-moved geometry.
- Fixture snapshots are deterministic enough for regression review.

### Adapters

#### LegacyCandidateAdapter

Purpose: turn the frozen legacy decoder output into a high-quality
`CandidateGraph` proposal, then add optional lower-threshold candidates to
repair omissions.

Inputs:

- normal-threshold legacy decoded graph
- lower-threshold decoded/evidence lines
- dense model assignment evidence where available
- locked border reconstruction output

Behavior:

- Legacy-selected interior creases become `legacy_selected`
  `CandidateCreaseSpan`s with strong presence priors.
- Lower-threshold extra lines become `legacy_low_threshold` candidates with
  weaker presence priors and clear provenance.
- Border is generated from the locked border model, not copied as noisy visual
  fragments.
- Legacy M/V labels become assignment evidence, not immutable decisions.
- Extra low-threshold lines conflict with duplicate legacy lines and with
  spans/fragments they replace.

Done means:

- Normal-threshold legacy graph round-trips into `CandidateGraph` without
  losing vertices, assignments, or border contacts.
- Lower-threshold extras are present as optional candidates and never silently
  exported unless selected.
- A frozen legacy baseline can still be rendered separately for comparison.
- Tests cover: no-loss legacy conversion, weak extra candidate generation,
  duplicate conflict generation, locked border preservation, and assignment
  evidence transfer.

#### ArrangementCandidateAdapter

Purpose: preserve the compiler-native evidence route by translating
`arrangement_v2` carriers, vertices, atomic intervals, shared carrier spans, and
normalized pass-through spans into the same `CandidateGraph`.

Behavior:

- Existing `selected_spans` concepts become `CandidateCreaseSpan` candidates.
- Atomic intervals become provenance/fallback candidates.
- Shared carriers and normalized pass-through spans become long span
  candidates with replacement conflicts.
- Existing arrangement vertex kinds map to `CandidateVertex.kind` and
  `movement_policy`.

Done means:

- Current Stage 5 synthetic tests can run through the adapter without losing
  the behaviors added in Phases 5c-5f.
- The old arrangement-specific selector is either removed or reduced to a thin
  compatibility wrapper around the shared selector.
- Inspector can switch candidate source between `legacy` and `arrangement_v2`
  while the selected graph panel uses the same payload type.

### Shared Beam Selector Refactor

Goal: refactor current Stage 5 selection so it consumes `CandidateGraph` and
emits `SelectedGraph`.

`SelectedGraph` should contain:

- selected candidate span ids
- selected vertex ids
- selected boundary model
- selected assignment labels only where already fixed; otherwise assignment
  evidence remains unresolved for Phase 8
- rejected/undecided candidate ids with reasons
- structural edit accounting: added weak line, dropped legacy line, replaced
  fragments, collapsed pass-through vertex, duplicate rejection
- score/cost breakdown

Refactor rules:

- No second beam implementation for legacy.
- Existing beam tests should be ported to CandidateGraph fixtures.
- Arrangement-specific code may remain only in adapter tests or a compatibility
  layer during the transition.
- The selector should choose among spans. Raw atomic intervals are fallback
  candidates/provenance, not the default final graph surface.

Done means:

- `select_candidate_graph_beam` or its replacement has a source-neutral
  signature.
- Both adapters call the same selector.
- There is one set of selector objective weights.
- Tests prove source-specific priors change costs, not control flow.
- Inspector Stage 5 can label the source adapter used for the candidate graph.

### Exact Solver Contract

Phase 6 does not implement the full exact solve, but it must define the
contract Phase 7 will consume.

`ExactSolveInput` should be derivable from:

```text
CandidateGraph + SelectedGraph
```

It should expose:

- selected crease spans as topology
- vertex movement policies and weights
- carrier/collinearity groups
- square boundary locks
- boundary-contact side constraints
- assignment evidence for later solver phases
- provenance for reporting movement/error by source

Phase 7 output should be:

```text
ExactSolvedGraph {
    vertices_exact,
    edges_exact,
    movement_report,
    theorem_residual_report,
    solved | ambiguous | failed,
}
```

Done means for Phase 6:

- The exact-solver input/output structs are declared or documented in code
  before Phase 7 starts.
- There is a fixture that converts a selected legacy candidate graph into an
  `ExactSolveInput`.
- No exact-solver implementation has to know whether the candidates came from
  legacy or arrangement V2.

### Inspector And Benchmark Requirements

Inspector updates:

- Candidate source selector: `legacy candidates`, `arrangement candidates`.
- Panels for:
  - candidate graph summary
  - selected spans
  - weak legacy additions
  - dropped legacy lines
  - conflicts/replacements
  - cost breakdown
  - movement policy preview
- Overlay toggles:
  - frozen legacy baseline
  - CandidateGraph candidates
  - SelectedGraph output
  - ground truth
  - provenance fragments

Benchmark updates:

- Keep frozen legacy baseline metrics.
- Add:
  - `legacy_candidates + selector`
  - `arrangement_candidates + selector`
  - later `legacy_candidates + selector + exact_solve`
  - later `arrangement_candidates + selector + exact_solve`
- Report metrics by source:
  - legacy kept
  - legacy dropped
  - weak added
  - compiler added
  - false positives removed
  - missing creases recovered

Done means:

- A repeatable command produces side-by-side metrics for frozen legacy and
  `legacy_candidates + selector`.
- Visual review folders/contact sheets distinguish baseline legacy from selected
  candidate graph output.
- Benchmarks do not require rerunning previous checkpoints unless candidate
  generation changes.

### Non-Goals For Phase 6

- Do not solve exact geometry yet.
- Do not promote V2 into the product path.
- Do not remove legacy baseline rendering.
- Do not tune thresholds to win one smoke example without recording the cost
  model and benchmark impact.
- Do not implement assignment solving beyond carrying assignment evidence and
  exposing label costs.

### Acceptance Checklist

- [x] `CandidateGraph`, `CandidateVertex`, `CandidateCreaseSpan`,
  `BoundaryModel`, `AssignmentEvidence`, `CandidateConflict`, `CostModel`, and
  `SelectedGraph` are defined in source-neutral modules.
- [x] CandidateGraph serialization round-trips through deterministic fixtures.
- [x] LegacyCandidateAdapter converts frozen legacy output with no topology or
  assignment loss.
- [x] LegacyCandidateAdapter adds lower-threshold weak candidates as optional
  spans with provenance and conflicts.
- [x] The arrangement candidate path preserves Phase 5c-5f span behavior through
  the CandidateGraph path.
- [x] The shared beam selector consumes CandidateGraph, not
  CandidateArrangement directly.
- [x] There is no separate legacy-specific beam selector.
- [x] ExactSolveInput/ExactSolvedGraph contract is defined before Phase 7
  implementation begins.
- [x] Inspector can display both adapter sources using the same selected graph
  payload.
- [x] Benchmark command compares frozen legacy against
  `legacy_candidates + selector`.
- [x] Unit tests cover assignment cost derivation, source prior ordering,
  conflicts, long-span-vs-fragment selection, no-loss legacy conversion, weak
  candidate additions, and boundary locking.
- [x] Full validation passes for the affected crates/apps.
- [x] Inspector defaults to the legacy candidate adapter for the product-like
  path; Arrangement V2 remains an explicit alternate source for research/debug.

Phase 6 is complete only when every checklist item above is checked. If one
adapter works but the selector remains source-specific, this phase is not done.
If the inspector can render the result only by applying post-hoc cleanup, this
phase is not done. If exact solve has to branch on legacy-vs-arrangement source,
this phase is not done.

## Phase 7: Full Exact Geometric Solve

Purpose: convert the selected topology into exact coordinates.

New module:

```text
crates/oristudio-cp-compiler/src/exact_solve.rs
```

Variables:

- Interior vertex positions.
- Carrier parameters for selected shared carriers.
- Boundary contact side coordinates.
- Optional slack variables during solve, but final exported geometry should not
  contain theorem residual slack unless marked failed.

Constraints:

- Square boundary fixed.
- Boundary contacts stay on their assigned side.
- Vertices incident to a carrier lie exactly on that carrier.
- Atomic edge endpoints are shared vertices.
- No unmodeled crossings.
- Kawasaki residual equals zero for eligible interior vertices.
- Degenerate edges forbidden.
- Movement from visual evidence minimized and bounded.

Objective:

```text
minimize
  weighted vertex movement
  + weighted carrier movement
  + high-confidence evidence movement
  + boundary contact movement
```

Implementation:

- Begin with deterministic constrained nonlinear least squares.
- Use `levenberg-marquardt` plus `nalgebra` for the optimizer. Both must compile
  for `wasm32-unknown-unknown`; if a future dependency cannot compile to WASM,
  it is not acceptable for this browser pipeline.
- Keep a bounded iteration count for browser runtime.
- Return exact coordinates plus a full residual report.
- If no nearby exact solution exists, return structured failure; do not emit a
  misleading "valid" graph.

Tests:

- Known valid CP remains unchanged.
- Slightly noisy valid CP exactizes to zero Kawasaki residual.
- Wrong topology fails exact solve rather than warping wildly.
- Boundary/corners remain exact.
- Native and WASM exact solve match within tolerance.

### Phase 7 Status - June 4, 2026

Core solver implementation and first inspector integration are complete, but
Phase 7 remains diagnostic-only until the curated metric comparison is run.

Completed:

- [x] Added `crates/oristudio-cp-compiler/src/exact_solve.rs`.
- [x] Added `levenberg-marquardt = 0.15.0` and `nalgebra = 0.34.2`.
- [x] Implemented deterministic bounded nonlinear least-squares over
  `ExactSolveInput`.
- [x] Model variables include free interior vertex coordinates, side-only
  boundary contact coordinates, and selected carrier angle/rho parameters.
- [x] Objective includes weighted vertex movement, boundary contact movement,
  carrier movement, carrier incidence, and Kawasaki residuals for eligible
  interior vertices.
- [x] Hard reports/failures include odd-degree topology, degenerate selected
  edges, unmodeled crossings, boundary failures, and movement beyond budget.
- [x] Output includes exact coordinates, selected edges, movement report,
  theorem residual report, and `solved` / `ambiguous` / `failed` status.
- [x] Unit coverage includes stable valid CPs, noisy Kawasaki improvement,
  odd-degree topology failure, boundary-only contact movement, shared-carrier
  split-vertex straightening, and excessive-movement failure.
- [x] Validation run:
  - `cargo test -p oristudio-cp-compiler`
  - `cargo check -p oristudio-cp-compiler --target wasm32-unknown-unknown`
  - `cargo check -p oristudio-cp-detect-wasm --target wasm32-unknown-unknown`
  - `cargo check -p oristudio-cp-detect-inspector`
  - `npm --workspace @treemaker/cp-detect-architecture-inspector run build`
- [x] Added a new inspector dropdown stage for exact solve, separate from Stage
  5.
- [x] Stage 6 backend response includes Stage 5 selected topology,
  `ExactSolvedGraph`, movement report, theorem residual report, ground truth,
  and legacy graph payloads.
- [x] Stage 6 UI shows:
  - selected graph before solve
  - exact-solved graph after solve
  - vertex movement overlay
  - failed-vertex overlay
  - GT graph toggle
  - before/after diagnostics for Kawasaki, carrier residual, odd vertices,
    degree-2 vertices, Maekawa failures, degenerate edges, crossings, boundary
    failures, objective, movement budget, and top moved vertices.
- [x] Stage 6 defaults to the smallest cached sample so the inspector opens to a
  responsive exact-solve case. Larger samples remain selectable manually.
- [x] Validation run on June 4:
  - `cargo check -p oristudio-cp-detect-inspector`
  - `npm --workspace @treemaker/cp-detect-architecture-inspector run build`
  - direct Stage 6 API smoke on the clean treemaker sample
  - browser smoke at `http://127.0.0.1:5176/`

### Phase 7 Cut-Boundary Semantics Fix - June 6, 2026

TreeMaker examples can contain a useful-polygon / cut-boundary drawn inside the
rectangular image frame. That boundary is not a fold ray and should be excluded
from local flat-foldability theorem checks, but it is also not the square paper
border. Stage 6 now keeps these concepts separate:

- `paper_boundary` means the actual square/canvas paper frame.
- `cut_boundary` means an unknown/flat useful-polygon boundary adjacent to the
  paper frame. It is theorem-excluded like a boundary, but remains visually and
  semantically distinct from the paper frame.

This fixes the misleading `odd degree 3` diagnostics on the clean TreeMaker
sample without drawing the useful polygon as a square border. The direct Stage 6
smoke on `treemaker_tree_v1-5gjmj-004937__clean__001` now reports 11 paper
boundary spans, 10 cut-boundary spans, no odd-degree failures, no Maekawa
failures, and a remaining ambiguous status only from small Kawasaki residuals.

The flat-folder input path now uses the same boundary-role classifier for
TreeMaker-style samples before calling the flat-folder solver. For documents
with `treemaker_metadata` or `cp_detector.flat_folder_boundary_hint =
"treemaker_useful_polygon"`, verification promotes the detected cut-boundary
spans to FOLD `B`, normalizes the physical useful-polygon domain, emits explicit
faces/edge-face topology, and drops orphaned canvas/cutaway geometry. This makes
the canonical GT FOLD for `treemaker_tree_v1-5gjmj-004937` flat-fold
successfully through `treemaker flatfold`; the recognized legacy/selected/exact
outputs for the same clean sample still fail flat-folder with assignment
conflicts and 22 CAMV violations, which means the export semantics are fixed
but the recognized graph/assignments are not yet globally valid.

Validation run:

```bash
cargo test -p oristudio-cp-compiler exact_solve -- --nocapture
cargo check -p oristudio-cp-detect-inspector
npm run build # from apps/cp-detect-architecture-inspector
cargo test -p oristudio-cp-compiler verify::tests -- --nocapture
cargo check -p treemaker-cli
cargo check -p oristudio-cp-detect --bin compare_exact_solve_benchmark
```

Remaining:

- [x] Run curated legacy-vs-selected-vs-exact-solved metric comparisons.
- [ ] Decide, from visual + metric review, whether exact solve should be wired
  into browser import output or remain a diagnostic-only stage for now.

### Phase 7 Benchmark Gate: Legacy vs Selected vs Exact-Solved

Purpose: make the exact-solve decision repeatable. Visual inspection is still
necessary, but Phase 7 should not graduate into the browser import path unless a
dated benchmark shows what exact solving improves, what it regresses, and
whether those changes matter to the product validators.

Benchmark command:

```bash
cargo run -p oristudio-cp-detect --bin compare_exact_solve_benchmark -- \
  --dense-manifest artifacts/cp-detect-correctness/dense-cache/smoke-1024-s3-browser-onnx/manifest.json \
  --candidate-source legacy \
  --threshold 0.65 \
  --legacy-low-threshold 0.35 \
  --out artifacts/cp-detect-correctness/reports/exact-solve-comparison-YYYY-MM-DD
```

The benchmark compares three outputs from the same cached neural evidence:

1. Frozen legacy decode output.
2. Legacy-backed `CandidateGraph` after Stage 5 beam selection.
3. Stage 5 selected topology after Stage 6 exact solve.

Required metrics:

- Ground-truth graph metrics: edge precision, recall, F1, boundary edge F1, and
  assignment accuracy for matched edges.
- Structural metrics: degree-2 interior vertices, odd-degree interior vertices,
  Maekawa failures, maximum Kawasaki residual, degenerate edges, unmodeled
  crossings, and boundary failures.
- Product validators: FOLD validity, Oriedita-style Check1/Check2/Check3/CAMV
  counts, flat-folder solved status, and flat-folder error kind/message.
- Exact-solve diagnostics: status, objective before/after, max vertex movement,
  moved vertex count, evaluation count, and solve seconds.

Report artifacts:

```text
artifacts/cp-detect-correctness/reports/exact-solve-comparison-YYYY-MM-DD/
  README.md
  summary.json
  summary.md
  per_sample.jsonl
  regressions.jsonl
```

Also update:

```text
implementation-plans/cp-detect-benchmark-history.md
```

Done means:

- [x] The command above can be rerun from a clean worktree with only the dense
  cache present.
- [x] The report separates topology accuracy from geometry/product validity.
- [x] The dated result directory and benchmark-history note are committed.
- [x] Any exact-solve regression is listed in `regressions.jsonl` with the
  affected sample id and metric.

### Phase 7 Benchmark Result - June 4, 2026

Command:

```bash
cargo run -p oristudio-cp-detect --bin compare_exact_solve_benchmark -- \
  --dense-manifest artifacts/cp-detect-correctness/dense-cache/smoke-1024-s3-browser-onnx/manifest.json \
  --candidate-source legacy \
  --threshold 0.65 \
  --legacy-low-threshold 0.35 \
  --out artifacts/cp-detect-correctness/reports/exact-solve-comparison-2026-06-04
```

Result summary:

- Runtime: 848.439 seconds for 12 smoke-pack samples.
- Legacy adapted graph: edge F1 0.8651, border F1 0.9588, assignment accuracy
  0.9966, CAMV 459, flat-folder solved 0/12.
- Stage 5 selected graph: edge F1 0.8650, border F1 0.9588, assignment accuracy
  0.9974, CAMV 459, flat-folder solved 0/12.
- Stage 6 exact-solved graph: edge F1 0.8444, border F1 0.9588, assignment
  accuracy 0.9983, CAMV 459, flat-folder solved 0/12.
- Exact solve reduced maximum Kawasaki residual from 156.1668 degrees to
  0.0330 degrees, but solved 0 samples, marked 2 ambiguous and 10 failed.
- Exact solve introduced measurable edge-F1 regressions on line-style samples:
  - `rabbit_ear_fold_program_v1-5wk0b-000109__line-style__000`: 0.7824 ->
    0.6580
  - `treemaker_tree_v1-5gjmj-004937__line-style__001`: 0.7304 -> 0.5913

Interpretation:

- Stage 5 currently behaves almost identically to the legacy-adapted baseline on
  this smoke pack. It is not yet making useful topology choices from the
  lower-threshold candidate pool.
- Stage 6 proves the optimizer can drive local Kawasaki residuals down, but it
  can move vertices enough to hurt GT edge matching and does not improve
  CAMV/flat-folder success because topology and assignment failures remain.
- Exact solve should remain diagnostic-only. Do not wire it into browser import
  output until the solver is constrained to preserve topology/edge matching and
  the selector or assignment solver reduces the local theorem failures that
  block flat-folder.

Acceptance:

- Exact solve improves CAMV/flat-folder success on curated noisy fixtures.
- Movement reports are understandable in the debug UI.

## Phase 8: Assignment Solver V2

Purpose: solve M/V after topology and geometry are plausible.

Existing module to evolve:

```text
crates/oristudio-cp-compiler/src/assignments.rs
```

Behavior:

- Treat model M/V as weighted evidence.
- Enforce Maekawa where applicable.
- Evaluate LBL after exact geometry.
- Keep unknown/ambiguous labels explicit when constraints do not force a unique
  answer.
- Do not use assignment solving to hide geometry/topology failures.

Tests:

- Low-confidence wrong labels can flip.
- High-confidence labels are preserved unless the graph is otherwise invalid
  and the report marks the conflict.
- Ambiguous equivalent assignments remain ambiguous.

Acceptance:

- Assignment accuracy must not regress materially versus current baseline.
- Assignment changes are separately reported from topology and geometry edits.

## Phase 9: Verifier, Export, And Product Contract

Purpose: only export what the compiler can honestly justify.

Existing modules to evolve:

```text
crates/oristudio-cp-compiler/src/verify.rs
crates/oristudio-cp-compiler/src/fold_export.rs
```

Verifier layers:

- Structural FOLD validity.
- Planarity/no unmodeled crossings.
- Local theorem residuals.
- CAMV/Oriedita-style diagnostics.
- Flat-folder/global verification where available.

Export statuses:

```text
valid_exact
valid_with_ambiguous_assignments
geometry_exact_but_global_unverified
failed_no_nearby_exact_solution
failed_topology_selection
```

Product rule:

- The browser import flow should not silently present a mathematically broken CP
  as a successful detection.
- If exact solve fails, show the best candidate as repair-needed with explicit
  diagnostics.

Acceptance:

- Stage inspector/debug UI can show:
  - input image
  - evidence primitives
  - arrangement candidates
  - selected graph
  - exact solved graph
  - verification report
  - diff/edit accounting

## Phase 10: Benchmarks And Visual Review Gates

Purpose: prevent metrics-only or visual-only mistakes.

Benchmarks:

- Existing smoke cached dense pack.
- Larger synthetic pack with known ground truth.
- Curated issue pack:
  - disconnected near-junctions
  - nearly collinear chains
  - intentionally almost-straight but not straight folds
  - watermarks/text
  - guide grids
  - dashed lines
  - dark/faint cases

Metrics:

- Vertex F1.
- Edge F1.
- Border F1.
- Assignment accuracy.
- Boundary contact F1.
- Exact local theorem residual count.
- CAMV issue count.
- Flat-folder success rate.
- Valid FOLD export rate.
- Edit accounting:
  - selected edges added/removed
  - vertices merged/split
  - max/mean movement
  - high-confidence evidence moved
  - inferred geometry count

Visual artifacts:

Per sample folder:

```text
01_ground_truth.png
02_legacy.png
03_v1_locked_border.png
04_v2_evidence.png
05_v2_arrangement.png
06_v2_selected_graph.png
07_v2_exact_solved.png
08_v2_diff.png
report.json
```

Acceptance:

- V2 must beat or materially improve on legacy for the target product goal:
  valid/editable FOLD import, not only raw edge F1.
- If V2 improves validity but slightly hurts pixel-style edge F1, manual review
  decides whether that tradeoff is acceptable.

## Phase 11: Product Migration And Legacy Removal

Purpose: ensure old code cannot keep influencing the product path.

Work:

- Make `ConstraintCompilerV2` the product default only after gates pass.
- Keep `LegacyV2` hidden behind debug/benchmark flags for one stabilization
  period.
- Move V1 modules into a deprecated namespace or delete them when no longer used:
  - mutation optimizer
  - repair candidate search
  - old exactizer entry point
  - carrier reconciliation experiment
- Remove product UI references to legacy stages.
- Keep legacy benchmark scripts only if useful for historical comparison.
- Add CI/test guard:
  - product detection path cannot import `legacy_decode`
  - V2 compiler path cannot call V1 optimizer/repair/exactizer modules unless a
    test explicitly opts into a deprecated diagnostic.

Acceptance:

- Product path:

```text
dense model outputs
-> evidence_extract
-> source adapter
-> CandidateGraph IR
-> selection
-> exact_solve
-> assignments
-> verify
-> fold_export
```

- No hidden legacy fallback.
- No old cleanup/exactizer/topology mutation module in the product path.
- Debug UI labels legacy only as benchmark/regression comparison.

## Suggested Implementation Order

1. Phase 0: add backend/guardrails and current dependency tests.
2. Phase 1: compiler-native evidence extraction.
3. Phase 2: arrangement V2 with visual debug output.
4. Phase 3: selection scaffold and score accounting.
5. Phase 4: local exactizability probes.
6. Phase 5: weighted beam selection using the probes.
7. Phase 6: source-neutral CandidateGraph IR and legacy/compiler adapters.
8. Phase 7: full exact solve.
9. Phase 8: assignment solver integration.
10. Phase 9: verifier/export contract.
11. Phase 10: benchmark and visual review gates.
12. Phase 11: product promotion and legacy removal.

## Open Design Questions

- Should arrangement include all pairwise carrier intersections, or prune by
  visual/junction support before selection?
- How large should the beam be in browser before runtime feels bad?
- What is the right movement budget for "nearby exact solution" at 1024px?
- Do we need a real text/grid artifact head, or can we start with heuristics and
  issue-specific hard negatives?
- Should exact solve enforce Kawasaki for every interior vertex immediately, or
  only for vertices with plausible flat-foldable topology?
- What threshold of CAMV/flat-folder success justifies replacing legacy in the
  product path?
- What low-threshold candidate recall target is enough before exact solving:
  all visually present lines as candidates, or only lines needed to repair local
  theorem failures?
