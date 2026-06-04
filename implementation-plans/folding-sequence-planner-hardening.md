# Folding Sequence Planner Hardening

## Goal

Improve the current crease-pattern-to-folding-sequence implementation from a
research preview into a more trustworthy deterministic planner.

The near-term target is not a universal origami diagram generator. It is a
validated partial planner that can:

- certify why an accepted step is a simple fold or named local complex move;
- preserve or explicitly diagnose layer-order ambiguity;
- split unresolved crease sets into useful regions instead of one large manual
  collapse;
- expose honest, step-local previews in the web UI;
- collect planner traces for future ranking experiments without letting ML
  validate or invent folds.

## Approach

Keep the production planner symbolic and deterministic. ML can only become a
future offline ranker over already-valid symbolic candidates after the trace
corpus is large enough and replay tests show no behavioral drift.

### 1. Baseline Current Behavior

Document the current planner contract before changing behavior:

- target-state resolution uses `treemaker-flatfold`;
- search runs backward from the selected target state;
- simple folds are detected by boundary-endpoint topology;
- complex moves are recognized by active crease groups around an interior
  vertex;
- accepted complex transforms currently reset candidate crease assignments,
  rerun target solving, and emit a macro step;
- the web simulator interpolates fold angles between before and after states.

Add regression fixtures that freeze this baseline so future improvements can be
measured as better complete/partial/unsupported outcomes rather than silent
semantic drift.

### 2. Add Step Certificates

Introduce an explicit certificate for every accepted `InstructionStep`.

Each certificate should include:

- the candidate crease group and affected face component;
- the move recognizer that accepted it;
- precondition checks, such as active assignments, local topology, sector angle
  checks, and layer-order requirements;
- postcondition checks, such as inactive crease deltas, folded-coordinate
  residuals, topology preservation, and target-state validity;
- any intentionally relaxed invariant with a diagnostic code.

Planner output can keep the existing public step shape, but certificates should
be serializable for tests, traces, and debug UI inspection.

### 3. Replace Boundary-Only Simple Folds

Generalize simple-fold detection from boundary-endpoint creases to face-graph
separations.

Implementation direction:

- build the face adjacency graph for active creases;
- for each candidate crease or crease chain, identify the moving face component;
- verify that the reverse operation can be modeled as a rigid reflection of that
  component;
- preserve layer-order constraints across the reflected component;
- support multi-layer book folds and edge-to-edge folds;
- keep rejected candidates with machine-readable reasons in planner traces.

This should reduce unnecessary `manual_collapse` steps on common bases while
still rejecting ambiguous or non-rigid cases.

### 4. Tighten Named Complex Moves

Split topology-only complex recognition into move-specific recognizers:

- `reverse_fold`: verify the local face graph, hinge direction, and MV pattern.
- `squash_fold`: verify the spread/squash fan, center vertex, symmetric or
  explicitly accepted sector geometry, and layer behavior.
- `rabbit_ear`: verify the three/four-crease motif, sector collapse, and
  produced flap direction.
- `molecule_collapse`: keep as a macro only when all local subregions have
  certificates or when the move is explicitly classified as a simultaneous
  macro collapse.

If a region does not satisfy a named recognizer, emit a generic
`local_collapse` or `manual_collapse` style result rather than a named technique.

### 5. Make Layer Order Search-Aware

Include selected layer-order information in sequence state identity and scoring.

Implementation direction:

- extend state keys beyond active assignments so different valid face-order
  states do not collapse together;
- record whether a step preserves, relaxes, or recomputes layer order;
- add an option to require unique layer order for user-facing sequence plans;
- surface solution-limit truncation prominently in diagnostics and UI state.

This should make ambiguous targets safer and prevent the planner from appearing
more certain than the target solve actually is.

### 6. Improve Unresolved Regions

Replace the single unresolved region fallback with connected and classified
regions.

Implementation direction:

- split unresolved active creases by face/vertex connectivity;
- attach candidate recognizer failures to each region;
- distinguish unsupported simultaneous collapse, ambiguous layer order,
  non-rigid local transform, and search-budget exhaustion;
- give each region stable IDs and affected face/crease lists for UI highlights.

Partial plans should become useful diagnostics, not just a prelude to one large
manual collapse.

### 7. Align Simulation And UI Honesty

Keep visual previews clearly scoped to what has been validated.

Implementation direction:

- mark manual and uncertified macro steps as approximate previews;
- show certificate status, confidence, and diagnostics in the Sequence panel;
- avoid presenting interpolated fold-angle animation as proof of physical
  foldability;
- support side-by-side before, after, and affected-region views for each step;
- expose unresolved-region highlights directly from planner output.

### 8. Build Validation And Corpus Review

Add stronger tests before expanding user-facing claims:

- golden fixtures for simple folds, multi-layer book folds, rabbit ear, squash,
  molecule, ambiguous target, and unsupported simultaneous collapse;
- negative fixtures that look similar but must not be accepted as named moves;
- property-style tests for state/certificate validation invariants;
- replay tests for planner traces and scoring;
- optional corpus harness runs that record complete, partial, unsupported, and
  invalid rates without committing private corpus files.

The acceptance metric should prioritize fewer false named steps over more
optimistic complete plans.

### 9. Prepare ML Only As Offline Ranking

Keep runtime behavior independent of ML.

After at least 500 successful symbolic traces exist, consider an offline
experiment that ranks already-valid candidates. The model input should be trace
features such as candidate type, local graph shape, region size, score delta,
diagnostics, and later success. The model output must not create candidates,
validate geometry, override certificates, or convert unsupported regions into
instructions.

Any ML experiment should have a replay harness that compares symbolic-only and
ranked search order on the same fixture/corpus set.

## Affected Areas

- `crates/treemaker-sequence` for state keys, certificates, recognizers,
  reverse transforms, unresolved regions, search scoring, and traces.
- `crates/treemaker-fold` for reusable FOLD topology, face graph, and geometric
  helper APIs if they become broadly useful.
- `crates/treemaker-flatfold` only where sequence planning needs explicit
  target-state metadata or stable layer-order diagnostics from the solver.
- `crates/treemaker-wasm` for serializing certificates, diagnostics, and new
  options to the web app.
- `apps/web/src/lib/sequenceSimulation.ts` and Sequence/Simulator panels for
  honest step previews, region highlights, and certificate diagnostics.
- `tests/fixtures/folding-sequence` for positive and negative planning
  fixtures.
- `crates/oracle-tests` for fixture, corpus, and optional oracle cross-checks.
- `implementation-plans/folding-sequence-ml-readiness.md` if the trace corpus
  eventually justifies an offline ranker experiment.

## Checklist

- [x] Freeze baseline planner behavior with fixture and trace regressions.
- [x] Define serializable step certificate types and validation helpers.
- [x] Add certificate output for existing simple and complex accepted steps.
- [x] Replace boundary-only simple fold detection with face-graph reflection
      checks.
- [x] Add negative tests for simple-fold lookalikes that must stay unsupported.
- [ ] Split complex move recognition into move-specific recognizers.
- [x] Downgrade uncertified named complex moves to generic local/manual collapse.
- [x] Include layer-order information in state identity, scoring, and
      diagnostics.
- [x] Split unresolved regions by connectivity and attach recognizer failure
      reasons.
- [x] Update WASM types and web UI to display certificate and preview certainty.
- [ ] Add corpus/replay reporting for complete, partial, unsupported, and invalid
      rates.
- [ ] Revisit offline ML ranking only after the successful symbolic trace count
      reaches the threshold in the ML-readiness plan.
