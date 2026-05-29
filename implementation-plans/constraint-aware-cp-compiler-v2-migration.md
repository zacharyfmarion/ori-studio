# Constraint-Aware CP Compiler V2 Migration Plan

Status: Draft implementation plan, May 28, 2026.

Progress:

- Phase 1 is implemented as of May 28, 2026.
- A `ConstraintCompilerV2` backend now exists for the compiler-native evidence
  route, while `ConstraintCompilerV1` remains the current locked-border
  baseline.
- `evidence_extract.rs` converts dense model tensors into compiler-native
  line, junction, and boundary-contact primitives without importing
  `legacy_decode`.
- V2 reports evidence extraction time separately from compiler time.
- The V2 route is intentionally evidence + locked-border only for now; it does
  not yet implement the V2 arrangement, weighted selection, or exact solve.

Goal: migrate the current browser CP detector/compiler into the target
architecture:

```text
model evidence
-> compiler-native evidence primitives
-> candidate planar graph arrangement
-> weighted constraint selection with exactizability probes
-> full exact geometric solve
-> assignment solve
-> verifier
-> FOLD export
```

The compiler should treat model output as evidence, not final geometry. The end
state should not depend on legacy decoder graph cleanup, hidden fallback, or old
mutation-style exactizer/topology code in the product path.

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
  Phase 8 with the benchmark pack, after Phase 2 replaces the temporary
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

Deferred to later phases:

- Native evidence primitives are converted directly into a temporary
  `CandidateProgram` so we can smoke-test the backend today. This is not the
  final architecture; Phase 2 replaces that temporary graph conversion with a
  true candidate planar graph arrangement.
- Phase 8 will expand timing into full benchmark summaries across larger packs.

## Phase 2: Candidate Planar Graph Arrangement V2

Purpose: create the search space without prematurely choosing geometry.

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

## Phase 3: Weighted Constraint Selection V2

Purpose: choose a graph from the arrangement using visual evidence plus origami
and geometry costs.

New module:

```text
crates/oristudio-cp-compiler/src/selection.rs
```

State decisions:

- Select/reject atomic edge.
- Select carrier hypothesis: separate vs shared.
- Merge/split candidate junctions.
- Select boundary contacts.
- Keep observed assignment, flip low-confidence assignment, or mark unknown.

Score terms:

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
  disconnected near-junctions
  unmodeled crossings
  degenerate/tiny edges
  invalid boundary topology

exactizability cost:
  estimated movement needed to satisfy Kawasaki
  estimated carrier movement
  high-confidence evidence movement penalty

assignment cost:
  Maekawa residual after unknown/flexible labels
  low-confidence flips
  high-confidence flips
  LBL violations after geometry probe

simplicity cost:
  duplicate parallel alternatives
  unnecessary tiny fragments
```

Algorithm:

- Start with deterministic beam search, not ILP.
- Keep top K graph states.
- Every state stores:
  - selected hypothesis IDs
  - selected edge IDs
  - selected junction merge IDs
  - score breakdown
  - edit accounting
- Use small local exactizability probes during scoring.
- Keep the solver deterministic and explainable before considering more complex
  MaxSAT/ILP/factor-graph approaches.

Tests:

- A weak edge is selected if it fixes odd degree and has nearby visual evidence.
- A no-evidence edge is rejected even if it would reduce one local residual.
- A near-duplicate false line is rejected when it creates topology/constraint
  cost.
- A merge is selected when it fixes a disconnected near-junction with small
  movement.
- A real small angle is preserved when merging would require high movement or
  contradict visual/junction evidence.

Acceptance:

- Selection produces a graph and a score report.
- Score report explains why each accepted edit was chosen.
- On smoke benchmark, selection-only output is benchmarked separately from exact
  solve.

## Phase 4: Local Exactizability Probes

Purpose: let selection use origami theorems without treating noisy raw angles as
final truth.

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
ExactizabilityProbe
  feasible: bool
  estimated_energy
  max_vertex_move
  max_carrier_angle_move
  residual_before
  residual_after
  blockers
```

Implementation:

- Use pure Rust linear algebra, preferably `nalgebra`, so native and WASM share
  behavior.
- Start with small least-squares/Gauss-Newton style probes.
- Do not mutate the selected graph in this phase.
- Return costs to the weighted selector.

Tests:

- A small Kawasaki residual is low cost if it can be fixed with small movement.
- A small-looking residual is high cost if it requires moving a high-confidence
  carrier too far.
- Odd degree is infeasible by geometry-only exactization.
- Boundary vertices remain on the square.

Acceptance:

- Selection can distinguish:
  - "raw angle off but exactizable"
  - "topology wrong; geometry cannot fix it"

## Phase 5: Full Exact Geometric Solve

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
- Use `nalgebra` for matrix operations.
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

Acceptance:

- Exact solve improves CAMV/flat-folder success on curated noisy fixtures.
- Movement reports are understandable in the debug UI.

## Phase 6: Assignment Solver V2

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

## Phase 7: Verifier, Export, And Product Contract

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

## Phase 8: Benchmarks And Visual Review Gates

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

## Phase 9: Product Migration And Legacy Removal

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
-> arrangement_v2
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
4. Phase 4: local exactizability probes.
5. Phase 3: weighted selection using the probes.
6. Phase 5: full exact solve.
7. Phase 6: assignment solver integration.
8. Phase 7: verifier/export contract.
9. Phase 8: benchmark and visual review gates.
10. Phase 9: product promotion and legacy removal.

Phase 4 comes before full Phase 3 implementation because weighted selection
needs an exactizability cost, not raw noisy theorem residuals.

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
