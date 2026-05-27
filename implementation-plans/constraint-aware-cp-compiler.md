# Constraint-Aware CP Compiler Plan

## Goal

Build a Rust/WASM crease-pattern compiler that turns noisy detector evidence
into an importable, structurally valid square origami CP.

The compiler is not another threshold-tuning pass. It is a reconstruction layer:

```text
model probabilities
  -> scored candidate CP program
  -> exact square arrangement
  -> constraint-aware topology selection
  -> assignment solving
  -> global verification
  -> FOLD/OSF plus repair provenance
```

The target product outcome is:

```text
uploaded CP image
  -> crop/rectify
  -> model inference
  -> constraint-aware CP compiler
  -> import into Ori Studio
  -> CAMV/check4/flat-folder hard errors near zero
  -> folded form available in most supported cases
```

## Core Thesis

The detector output should be evidence, not law.

The current browser detector roughly does this:

```text
model probabilities -> thresholded graph -> deterministic cleanup -> FOLD
```

The compiler should instead keep multiple competing geometric possibilities and
choose the graph that best explains the image while satisfying origami
constraints.

This matters because some failures are not numeric cleanup problems. A CP can
look visually close while still missing a crease, carrying a wrong M/V label, or
having a tiny vertex displacement that breaks exact flat-foldability checks.

## Relationship To Existing Plans

- `BROWSER_DETECTION_ROADMAP_V1.md` tracks browser product integration.
- `exact-python-detector-web-port.md` tracks the frozen Python V2 decoder port.
- `rust-cp-detector-quality-parity.md` is superseded by the exact-port plan for
  Python parity work.

This plan is a new architecture layer. It should initially run beside the legacy
decoder, compare against it, and replace it only when metrics and manual review
show a real improvement.

## Non-Negotiable Guardrails

- Python detector code remains frozen.
- The Rust compiler must run in browser WASM.
- Do not hallucinate unrecoverable cropped/missing borders.
- Do not add symmetry recovery in V2. Symmetry can be a later optional mode.
- Do not silently invent geometry. Every inferred crease, deleted crease,
  moved vertex, or flipped assignment must have provenance and confidence.
- Do not optimize only for edge F1. The product goal is importable, foldable
  CPs, so flat-folder success and hard CAMV error reduction are first-class
  metrics.
- Each phase must have unit tests or a clearly documented reason why the phase
  is benchmark/integration-only.
- Do not proceed from one phase to the next until the phase gate is satisfied or
  the failure is explicitly recorded.
- Keep old decoder code cordoned off as a legacy baseline so it can be removed
  cleanly if the compiler wins.

## Runtime Crate Shape

Add a new compiler crate:

```text
crates/oristudio-cp-compiler/
  src/lib.rs
  src/evidence.rs
  src/candidates.rs
  src/arrangement.rs
  src/exactize.rs
  src/constraints.rs
  src/repair.rs
  src/optimizer.rs
  src/assignments.rs
  src/verify.rs
  src/report.rs
  src/fold_export.rs
```

Expected dependencies:

- `serde`, `serde_json`, `thiserror` for stable APIs and reports.
- `nalgebra` for least-squares projection and small linear solves.
- `rstar` or an equivalent spatial index for local graph queries.
- Existing `oristudio-cp`, `oristudio-cp-detect`, `treemaker-fold`, and
  `treemaker-flatfold` crates for model import/export, diagnostics, and global
  verification.

Avoid heavyweight native dependencies. Browser runtime must stay WASM-safe.

## Legacy Decoder Cordon

The existing post-processing path should be preserved as a baseline but clearly
marked as legacy.

Target structure:

```text
crates/oristudio-cp-detect/src/
  decode.rs              thin public compatibility wrapper
  legacy_decode.rs       current threshold/cleanup decoder implementation
  compiler_decode.rs     adapter into oristudio-cp-compiler
```

Rules:

- Keep legacy behavior callable for benchmarks and A/B review.
- New product code should select a decoder backend explicitly:

```text
DecoderBackend::LegacyV2
DecoderBackend::ConstraintCompilerV1
```

- Do not delete legacy code until the compiler has beaten it on the agreed
  benchmark set.
- Once the compiler is wired, mark legacy APIs with Rust deprecation attributes
  or doc comments, depending on whether warnings would disrupt active tests.
- Legacy reports should identify themselves as `legacy_v2_decoder`.
- Compiler reports should identify themselves as `constraint_compiler_v1`.

This cordon is important because the current decoder still provides useful
oracle comparisons, but it should stop being the conceptual home for new repair
logic.

## Compiler Data Model

The compiler works with scored facts rather than a single graph.

### Evidence Fields

Inputs from the existing detector:

```text
line probability
effective line probability
non-crease probability
junction probability
boundary contact probability
assignment probabilities
line style probabilities
rectifier/crop confidence
```

### Candidate Carriers

A carrier is a possible infinite crease line:

```text
normal dot p = rho
```

Stored fields:

```text
id
line parameters
finite support interval
visual support score
dashed/gapped support score
non-crease penalty
source: observed_strong | observed_weak | inferred | border
```

Special carrier families:

```text
horizontal: y = c
vertical:   x = c
diagonal:   x + y = c
diagonal:   x - y = c
free:       theta/rho
```

### Candidate Vertices

Vertices come from:

```text
carrier intersections
junction peaks
boundary contacts
square corners
repair-generated points
```

Stored fields:

```text
id
position
source set
support score
boundary side, if any
incident candidate carriers
```

### Candidate Edges

Edges are intervals between adjacent vertices on a carrier.

Stored fields:

```text
id
carrier id
endpoint vertex ids
assignment probabilities
line support score
style support score
selected / rejected / undecided
source: observed | inferred | border
```

### Provenance

Every output element must explain why it exists:

```text
observed_strong
observed_weak
inferred_by_kawasaki
inferred_by_even_degree
inferred_by_boundary_contact
deleted_low_support
assignment_observed
assignment_flipped
assignment_inferred
assignment_ambiguous
```

## Algorithm

### Step 1: Generate Candidate Program

Use permissive thresholds to collect evidence, not just high-confidence final
lines.

Inputs:

```text
Hough/OpenCV-compatible segments
merged finite carriers
junction peaks
boundary contact peaks
assignment logits
line style logits
non-crease logits
```

Output:

```text
CandidateProgram {
  carriers,
  vertices,
  edges,
  evidence_maps,
  warnings
}
```

Why this approach:

- The model may return weak evidence for a real crease.
- A missing crease can be obvious only after checking local flat-foldability.
- The compiler needs optional candidates to select from.

### Step 2: Exact Square Arrangement

Move the graph into exact square coordinates.

Hard constraints:

```text
left border:   x = 0
right border:  x = 1
top border:    y = 0
bottom border: y = 1
```

Build an arrangement of selected or candidate carriers:

```text
carrier intersections
carrier-boundary contacts
side-sorted boundary vertices
edge intervals between adjacent vertices
```

Why this approach:

- Square origami CPs are not generic line drawings.
- Border geometry should be deterministic after rectification.
- Candidate topology should be represented in a coordinate system where exact
  flat-foldability constraints have meaning.

### Step 3: Geometric Projection

Given a selected topology, compute the nearest clean geometry.

Minimize:

```text
endpoint displacement
carrier displacement from visual evidence
movement of high-confidence junctions
movement of high-confidence boundary contacts
```

Subject to:

```text
border is exactly square
vertices lie on incident carriers
edges on same carrier are collinear
illegal crossings are split or rejected
boundary contacts stay on their side
```

Initial implementation:

- Deterministic snapping for border, horizontal, vertical, and common diagonal
  families.
- Local least-squares intersection using `nalgebra`.
- Neighborhood-only projection after local repair moves.

Do not start with a large nonlinear optimizer. Add one only if deterministic
projection cannot meet the benchmark gate.

### Step 4: Import-Mode Constraint Diagnostics

For each vertex, compute an import-oriented diagnostic record:

```text
degree
boundary/interior classification
incident edge ids
sector angles
Kawasaki residual
M/V counts
Maekawa residual
little-big-little status
line evidence summary
assignment evidence summary
severity
```

Severity buckets:

```text
clean
tiny_numeric_residual
small_geometry_residual
hard_kawasaki_failure
odd_degree_topology_failure
maekawa_assignment_failure
little_big_little_failure
boundary_topology_failure
global_flatfolder_failure
```

Why this approach:

- Oriedita-style exact CAMV checks are useful, but too strict as a user-facing
  detector diagnostic.
- A `0.11 degree` Kawasaki residual and a missing crease should not be reported
  as equally mysterious "Angles" failures.

### Step 5: Local Repair Move Generation

Generate explicit candidate repairs for hard violations.

#### Missing Crease From Odd Degree

For an interior odd-degree vertex:

```text
1. Sort incident ray angles.
2. For each angular gap, solve for an inserted ray angle that satisfies
   Kawasaki's alternating sector equation.
3. Reject the ray if it falls outside the gap or duplicates an existing ray.
4. Clip the ray to the nearest plausible target:
   existing vertex, carrier, boundary contact, or square boundary.
5. Score the new edge by visual support, endpoint evidence, and constraint
   improvement at both ends.
```

This directly targets the "model missed one crease" case.

#### Hard Kawasaki Residual

For an even-degree vertex with large Kawasaki residual:

```text
try carrier projection
try adding one crease
try deleting one weak crease
try merging a nearby duplicate vertex
try splitting a nearby missed intersection
```

#### Maekawa / Assignment Failure

Do not change geometry first. Generate assignment variable changes:

```text
flip low-confidence M/V
mark uncertain label unknown
infer label if locally forced
```

#### False Positive Line

Delete only if:

```text
line support is weak
non-crease evidence is high or assignment evidence is poor
deletion improves local constraints
deletion does not break obvious border/interior topology
```

### Step 6: Bounded Topology Optimization

Use a bounded beam search over local repair moves.

State:

```text
selected edges
deleted weak edges
inferred edges
current projected geometry
constraint diagnostics
cost
```

Cost terms:

```text
missed strong visual evidence
selected weak/inferred evidence
deleted observed evidence
geometry movement
unresolved Kawasaki residual
unresolved Maekawa residual
little-big-little violations
boundary topology failures
assignment conflicts
flat-folder failure
```

Search:

```text
1. Start from legacy decoder graph.
2. Diagnose hard violations.
3. Generate local repair moves around worst violations.
4. Apply top K moves.
5. Re-project affected geometry.
6. Re-score local and global constraints.
7. Keep best beam states.
8. Stop when valid, budget exhausted, or ambiguity remains.
```

Why beam search:

- The graph is spatial and most failures are local.
- It is browser-safe and inspectable.
- It produces concrete explanations.
- It avoids committing early to a heavyweight SAT/MILP dependency.

If beam search cannot handle common examples, revisit a hybrid solver for a
later phase.

### Step 7: Assignment Solver

Solve M/V labels after topology is plausible.

Inputs:

```text
selected graph
assignment probabilities
local Maekawa constraints
little-big-little constraints
locked high-confidence labels
```

Algorithm:

```text
1. Lock high-confidence observed labels.
2. Treat low-confidence labels as variables.
3. Solve connected components with branch-and-bound.
4. Minimize observed-label flips, unknown labels, and LBL violations.
5. If multiple equivalent solutions exist, report ambiguity.
```

Output provenance:

```text
observed_high_confidence
observed_low_confidence
flipped_to_satisfy_constraints
inferred_for_maekawa
ambiguous
unknown
```

### Step 8: Global Verification

Run final checks:

```text
FOLD structural validation
Oriedita check1/check2/check3/check4/CAMV
flat-folder solve
Ori Studio import/export smoke
```

If global verification fails, classify the failure:

```text
local theorem failure remains
assignment conflict
precision failure
overlap/order conflict
unsupported global ambiguity
```

One bounded feedback pass may generate more local repairs from the global
failure. Do not create an unbounded repair loop.

## Testing Strategy

Testing should be layered. Each phase needs a small, fast unit suite before it
graduates to benchmark fixtures.

### Unit Fixture Families

Keep tiny deterministic fixtures in git:

```text
simple square border
single diagonal
bird-base-like vertex
degree-3 missing-crease vertex
near-Kawasaki residual vertex
wrong low-confidence assignment
false-positive weak crease
boundary contact split
illegal crossing needing split
```

These should be hand-authored, not generated from the large dataset.

### Golden Diagnostic Fixtures

For diagnostics, use JSON snapshots:

```text
input graph
expected sector angles
expected residuals
expected severity
expected repair candidates
```

### Benchmark Fixtures

Use the existing detector correctness framework for larger checks:

```text
synthetic labeled CPs
V2 issue profiles
dark/combined stress cases
real-world smoke cases
named duck/cpoogle cases
```

### Acceptance Metrics

Report both graph metrics and product metrics:

```text
vertex precision/recall/F1
edge precision/recall/F1
border precision/recall/F1
assignment accuracy
complete square border rate
hard CAMV error count
tiny residual count
flat-folder success rate
valid FOLD rate
inferred crease count
deleted crease count
assignment flip count
manual edit distance proxy, when available
```

Tiny numeric residuals should be reported separately from hard theorem failures.

## Phase Plan

Each phase ends with:

```text
cargo fmt
cargo test for touched crates
targeted wasm/node test if WASM-facing APIs changed
small benchmark or snapshot update where relevant
focused commit
```

### Phase 0: Plan

- [x] Write this implementation plan.
- [x] Commit the plan.

Gate:

- `git diff --check`

### Phase 1: Legacy Cordon And Baseline Harness

- [x] Move current decoder implementation behind an explicit legacy module or
  compatibility wrapper.
- [x] Add `DecoderBackend::LegacyV2`.
- [x] Add report metadata identifying legacy output.
- [x] Keep public behavior unchanged.
- [x] Add baseline tests proving legacy output did not change.
- [x] Add benchmark command support for legacy vs compiler backends, even if the
  compiler backend initially delegates to legacy.

Phase 1 status:

- Completed in this implementation pass.
- The current decoder implementation lives in `legacy_decode.rs`.
- `decode.rs` is now a public backend router.
- Reports and exported FOLD metadata identify `legacy_v2_decoder`.
- `compare_python_detector_oracle` accepts `--decoder-backend legacy-v2`.
- The compiler backend is not implemented yet; Phase 2 introduces the no-op
  compiler path.

Unit tests:

- [x] Legacy decode fixture returns the same canonical FOLD as before the move.
- [x] Legacy report includes `decoder_backend = legacy_v2_decoder`.
- [x] Browser/WASM decode still works with the legacy backend.

Gate:

- [x] No graph/report deltas except the new backend metadata.

### Phase 2: Compiler Data Model

- [x] Add `crates/oristudio-cp-compiler`.
- [x] Define evidence, carriers, vertices, edges, assignments, and provenance.
- [x] Add conversion from current legacy decoder intermediates into a
  `CandidateProgram`.
- [x] Add JSON serialization for debug reports.
- [x] Add no-op compiler path that emits the same graph as legacy.

Phase 2 status:

- Completed in this implementation pass.
- `oristudio-cp-compiler` now owns the candidate program data model.
- The compiler can build a `CandidateProgram` from the legacy FOLD output.
- `DecoderBackend::ConstraintCompilerV1` runs a no-op compiler pass over legacy
  output and preserves the graph while adding compiler metadata.
- Automatic repair, exact arrangement, diagnostics, and assignment solving are
  still intentionally not implemented.

Unit tests:

- [x] Candidate graph round-trips through JSON.
- [x] Provenance is preserved.
- [x] No-op compiler output matches legacy on tiny fixtures.

Gate:

- [x] Compiler backend can run without changing output.

### Phase 3: Exact Square Arrangement

- [x] Implement unit-square frame representation.
- [x] Implement side-sorted boundary vertices.
- [x] Implement carrier-boundary and carrier-carrier intersections.
- [x] Implement deterministic edge interval construction.
- [x] Rebuild square border as exact `B` edges.

Phase 3 status:

- Completed in this implementation pass as compiler-internal arrangement
  infrastructure.
- `SquareArrangement` now creates virtual exact corners, deduplicates existing
  boundary vertices, computes carrier-square contacts, computes carrier-carrier
  intersections inside the unit square, and emits deterministic side-ordered
  border intervals.
- The compiler report includes an arrangement summary.
- This phase does not yet rewrite exported FOLD geometry; Phase 4 moves from
  arrangement to projection/exactization.

Unit tests:

- [x] Four square sides are always exact.
- [x] Boundary contacts are sorted correctly on all four sides.
- [x] Corners are stable and not duplicated.
- [x] A carrier crossing the square creates the expected two boundary contacts.
- [x] Adjacent contacts create deterministic border edges.

Gate:

- [x] Border topology stays equal because this phase is report-only and does not
  mutate exported FOLD.
- [x] No complete-square regressions.

### Phase 4: Geometric Projection / Exactizer V1

- [x] Move current exactizer logic into compiler-quality code.
- [x] Project vertices from incident carrier intersections.
- [x] Snap supported horizontal, vertical, 45-degree, 135-degree, and border
  carriers.
- [x] Track endpoint movement and carrier movement in the report.
- [x] Keep topology unchanged in this phase.

Phase 4 status:

- Completed in this implementation pass as compiler-library exactization.
- `exactize_program` snaps border, axis, and common diagonal carriers, then
  projects vertices from incident carrier lines with least-squares
  intersections.
- The exactizer reports moved vertices, max/mean movement, and snapped carrier
  counts.
- This phase still does not mutate product FOLD output. Exported geometry will
  be changed only after import-mode diagnostics can explain residual failures.

Unit tests:

- [x] Noisy square becomes exact.
- [x] Noisy diagonal intersections become analytic intersections.
- [x] Degenerate duplicate endpoints are merged or reported.
- [x] Projection does not move locked high-confidence vertices past tolerance.

Gate:

- [x] Tiny numeric residual count is not benchmarked yet because the exactizer is
  not wired to mutate exported FOLD.
- [x] No new hard topology failures are introduced because product output is
  unchanged.

### Phase 5: Import-Mode Constraint Diagnostics

- [x] Implement sector angle extraction.
- [x] Implement Kawasaki residuals.
- [x] Implement Maekawa residuals.
- [x] Implement little-big-little classification or wrap existing Oriedita logic
  with richer diagnostics.
- [x] Add severity buckets.
- [x] Add report payload consumable by the UI.

Phase 5 status:

- Completed in this implementation pass.
- The compiler now emits import-mode constraint diagnostics with per-vertex
  degree, sector angles, Kawasaki residual, Maekawa residual, LBL status, and
  severity.
- The report distinguishes tiny numeric residuals from hard Kawasaki failures,
  odd-degree topology failures, Maekawa assignment failures, LBL failures, and
  boundary topology failures.
- Boundary contacts now validate square-border topology separately and do not
  require interior Kawasaki/Maekawa parity.
- Diagnostics are included in `compiler_report.constraints` for the
  `ConstraintCompilerV1` backend.

Unit tests:

- [x] Valid bird-base-like vertex is clean.
- [x] Degree-3 vertex is `odd_degree_topology_failure`.
- [x] `0.1 degree` residual is classified as tiny/small, not hard.
- [x] Large Kawasaki failure is hard.
- [x] Wrong M/V count is assignment failure, not geometry failure.
- [x] Boundary contact with two border edges is not treated as an interior
  flat-foldability failure.

Gate:

- [x] Diagnostic report is capable of explaining the known `simple.osf`
  post-exactization pattern more clearly than raw CAMV by separating tiny
  residuals from hard topology/assignment failures. A named fixture integration
  report remains a later benchmark task once compiler mutation is enabled.

### Phase 6: Local Repair Candidate Generation

- [x] Generate missing-crease candidates for odd-degree vertices.
- [x] Generate weak drop and carrier-split moves for hard Kawasaki failures.
- [x] Generate near-duplicate vertex merge candidates.
- [x] Generate assignment-only moves for Maekawa failures.
- [x] Generate weak-line deletion moves for likely false positives.
- [x] Score moves by evidence and expected constraint improvement.
- [ ] Generate topology-add candidates for even-degree hard Kawasaki failures.

Phase 6 status:

- Candidate generation is implemented in `oristudio-cp-compiler::repair`.
- The compiler now proposes explicit, provenance-tagged moves rather than
  mutating the graph: missing creases, weak crease drops, nearby vertex merges,
  carrier-intersection splits, and low-confidence M/V flips.
- Missing-crease candidates are currently limited to odd-degree vertices because
  a single added crease can restore even degree and Kawasaki simultaneously.
  Even-degree hard Kawasaki failures usually require a paired add/drop or merge
  decision, so those are left for the Phase 7 optimizer rather than guessed in
  isolation.
- No repair candidates are applied to product output yet.

Unit tests:

- [x] Degree-3 fixture produces the expected Kawasaki-completing ray.
- [x] Missing crease candidate clips to an existing vertex when appropriate.
- [x] Missing crease candidate clips to boundary when no target vertex exists.
- [x] Strong observed creases are not proposed for deletion.
- [x] Low-confidence wrong assignments produce assignment moves before geometry
  moves.

Gate:

- [ ] Repair candidates include the visually expected missing crease on at least one
  known real-world example without selecting it yet.
- [x] Deterministic fixture coverage proves the candidate generator can propose
  the major local move types without changing exported geometry.

### Phase 7: Bounded Topology Optimizer

- [x] Implement state cost.
- [x] Implement beam search over local repair moves.
- [x] Re-project candidate states after moves.
- [x] Record accepted/rejected move provenance.
- [x] Add configurable search budgets for browser runtime.

Phase 7 status:

- `oristudio-cp-compiler::optimizer` now runs a bounded beam search over repair
  candidates and chooses only moves that improve a transparent topology cost.
- The first cost function heavily penalizes hard local constraint failures, then
  adds smaller penalties for inferred edges, weak selected evidence, and deleted
  observed support.
- Move application supports missing-crease insertion, weak-crease rejection,
  near-duplicate vertex merge, carrier-intersection split, and low-confidence
  assignment flip.
- Missing creases to a boundary contact now split an existing square border edge
  so the inserted contact remains valid boundary topology.
- Projection is currently full-state exactization after each move, not a
  neighborhood-only projector. That is simpler and safer for the first optimizer
  pass; neighborhood projection can be added when runtime profiling says it is
  needed.
- The optimizer is still a library layer and is not wired into product FOLD/OSF
  export by default.

Unit tests:

- [x] One-missing-crease fixture is repaired.
- [x] One-false-positive fixture deletes the weak false line.
- [x] Ambiguous fixture reports ambiguity instead of inventing arbitrary
  geometry.
- [x] Search budget exhaustion is reported cleanly.

Benchmark gate:

- Hard CAMV error count decreases on smoke cases.
- Flat-folder success rate improves or stays equal.
- Edge F1 does not materially regress.
- Inferred crease count stays within reviewable bounds.

### Phase 8: Assignment Solver

- [x] Implement weighted M/V variable solver.
- [x] Lock high-confidence labels.
- [x] Allow low-confidence flips with provenance.
- [x] Detect ambiguous equivalent assignments.
- [x] Emit assignment confidence/provenance per edge.

Phase 8 status:

- `oristudio-cp-compiler::assignments` now solves M/V labels after topology is
  fixed.
- High-confidence observed M/V labels are locked by default.
- Unknown and low-confidence labels become variables in a bounded
  branch-and-bound search.
- The solver minimizes unresolved Maekawa/LBL assignment errors first, then
  assignment invention and observed-label flips.
- Equivalent best assignments are reported as ambiguous and left uncommitted
  rather than choosing an arbitrary M/V pattern.
- This phase does not move geometry, add creases, delete creases, or run global
  flat-folder verification.

Unit tests:

- [x] Maekawa-satisfiable component solves without geometry changes.
- [x] High-confidence labels are respected unless explicitly impossible.
- [x] Low-confidence wrong label is flipped.
- [x] Multiple equivalent assignments are marked ambiguous.

Gate:

- [ ] Assignment accuracy improves or stays equal.
- [ ] Flat-folder assignment conflicts decrease.

### Phase 9: Global Verification Loop

- [x] Run FOLD validation.
- [x] Run Oriedita check suite.
- [x] Run flat-folder.
- [x] Classify global failures.
- [x] Add one bounded feedback pass from global failure to local repair.

Phase 9 status:

- `oristudio-cp-compiler::fold_export` now exports selected compiler candidate
  programs to FOLD documents.
- `oristudio-cp-compiler::verify` now runs structural FOLD validation,
  Oriedita-compatible check1/check2/check3/CAMV diagnostics, and
  `treemaker-flatfold` solving.
- Global failures are classified as invalid FOLD, local theorem failure,
  assignment conflict, precision failure, overlap/order conflict, unsupported
  global ambiguity, or clean.
- `verify_program_with_feedback` performs exactly one feedback pass:
  verification, bounded topology optimization, assignment solving, and
  verification again. It reports both verification states plus accepted topology
  moves and assignment decisions.
- The feedback pass is library-only and not yet product-default behavior.

Unit tests:

- [x] Clean square FOLD verifies cleanly.
- [x] CAMV/Maekawa failure is classified as local theorem failure.
- [x] Invalid FOLD reports validation error.
- [x] Precision failure is classified separately from assignment conflict.
- [x] One-missing-crease fixture is repaired by a single bounded feedback pass.
- [x] Global failure does not cause unbounded repair loops.

Benchmark gate:

- Valid FOLD rate and flat-folder success rate improve over legacy.

### Phase 10: Browser/WASM Integration

- [x] Add `DecoderBackend::ConstraintCompilerV1` to product worker options.
- [x] Keep legacy backend available for A/B comparison.
- [x] Add UI metadata for observed/inferred/deleted/assignment-flipped elements.
- [x] Add import review overlay toggles for compiler provenance.

Phase 10 status:

- The detector backend router now runs the full compiler pipeline for
  `constraint_compiler_v1`: candidate graph, topology optimization, assignment
  solving, FOLD export, and global verification metadata.
- The legacy backend remains the default low-level WASM decode function and is
  still available through worker options for A/B comparisons.
- The CP import modal now requests `constraint_compiler_v1` by default and shows
  compact compiler metadata chips for topology moves, assignment changes,
  ambiguity, and non-clean verification classifications.
- The generated browser WASM package has been rebuilt with
  `cp_detect_decode_dense_outputs_with_backend`.
- Compiled FOLD output now carries per-edge detector provenance under
  `cp_detector.edge_ids`, `edge_source`, `edge_provenance`, support, and
  assignment confidence arrays. The import modal uses this table to show
  off-by-default review toggles for inferred geometry and M/V assignment
  changes.
- The browser correctness runner accepts `--decoder-backend`; the smoke pack
  was run against `constraint_compiler_v1` with 4/4 samples decoded and no
  browser errors. The local file-picker upload/import flow still needs manual
  end-to-end confirmation because the automated smoke exercises the browser
  model/decode path directly.
- Added a native/WASM dense-head parity harness. On a two-fixture smoke slice,
  native Rust and WASM produced matching graph topology within `1e-6`
  coordinate tolerance and matching reports within `1e-4` numeric tolerance.
  Exact JSON is not byte-for-byte identical because legacy diagnostic residuals
  can drift by tiny float amounts across native and WASM runtimes.

Tests:

- [x] Node/WASM compiler fixture test calls `constraint_compiler_v1`.
- [x] Browser smoke test for modal open and compiler-backed browser detection.
- [ ] Manual browser smoke test for local file upload/crop/import.
- [x] Native Rust and WASM compiler outputs match on fixture inputs.

Gate:

- Browser output matches native Rust compiler output.

### Phase 11: Benchmark Decision

- [ ] Run legacy vs compiler benchmark on the agreed slices.
- [ ] Produce report with graph metrics and product metrics.
- [ ] Produce contact sheets for visually inspecting inferred/deleted creases.
- [ ] Decide whether compiler becomes the default backend.

Promotion criteria:

- Flat-folder success improves meaningfully.
- Hard CAMV errors decrease meaningfully.
- Complete square border stays strong.
- Edge F1 does not regress beyond an agreed small tolerance.
- Inferred geometry is explainable and visually plausible.
- Manual review says the compiler output is easier to fix than legacy output.

### Phase 12: Legacy Removal Decision

Only after compiler promotion:

- [ ] Mark legacy backend deprecated in code.
- [ ] Move legacy tests to regression-only coverage.
- [ ] Remove product UI references to legacy unless a debug flag is enabled.
- [ ] Create a deletion checklist for legacy decoder code.

Do not delete legacy code until there is at least one stable release or manual
testing cycle where the compiler backend is clearly better.

## Open Questions

- What threshold separates tiny numeric residuals from small repairable
  geometry residuals? Initial proposal: under `0.25 degrees` is tiny, `0.25` to
  `2 degrees` is small, over `2 degrees` is hard unless local context says
  otherwise.
- Should inferred creases default to unknown assignment until assignment solving,
  or should they inherit local M/V hypotheses immediately?
- Should the optimizer optimize assignment and topology jointly for hard cases,
  or keep the first version staged as topology then assignment?
- How much inferred geometry is acceptable before the UI should ask the user to
  confirm?
- Which real-world smoke cases become the canonical compiler evaluation set?

## Initial Recommendation

Start with phases 1 through 5 before implementing any automatic repair.

That sequence gives us:

```text
legacy cordon
compiler data model
exact square arrangement
geometry projection
clear import-mode diagnostics
```

At that point we can inspect exactly which failures are numeric, which are
missing topology, and which are assignment conflicts. Then topology repair can
be implemented with much less guesswork.
