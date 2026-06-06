# Browser Local Fold Certification

## Goal

Replace topology-only named complex fold steps with deterministic certificates
that are safe to run in the browser.

The first target is the current "local reverse fold candidate" behavior. A step
should only be named as a reverse fold when the local geometry, mountain/valley
pattern, affected face graph, and before/after folded coordinates support that
claim. Otherwise the planner should downgrade the step to a generic local or
manual collapse with actionable diagnostics.

This plan intentionally does not try to prove a continuous collision-free fold
motion. The browser-safe target is a fast static/local certificate that prevents
obvious false named moves and makes the preview honest.

## Approach

### 1. Keep Certification Local And Deterministic

Run certificates in `treemaker-sequence` over small FOLD neighborhoods:

- the candidate center vertex;
- incident active creases and their assignments;
- adjacent faces, sectors, and face adjacency across candidate creases;
- affected face components before and after the candidate transform;
- local face-order constraints already produced by the flat-fold solver.

These checks are graph and 2D geometry operations over a small neighborhood, so
they should be much cheaper than the target flat-fold solve already running in
the browser through WASM.

### 2. Add Candidate Geometry Snapshots

For each named local candidate, construct a serializable local snapshot:

- center vertex id and incident edge order around the vertex;
- sector angles in paper coordinates;
- incident assignments in circular order;
- adjacent face ids for each candidate crease;
- connected affected face component;
- boundary edges that keep the move local;
- candidate diagnostics for missing faces, duplicate creases, non-manifold
  edges, degenerate sectors, or boundary-center vertices.

Use this snapshot in tests, certificates, trace output, and optional debug UI.

### 3. Certify Reverse Fold Candidates First

Upgrade reverse-fold recognition from "three active creases meet at an interior
vertex" to a real local recognizer.

Required fast checks:

- exactly three relevant active M/V creases are incident to the center vertex;
- the center vertex is interior and the local edge/face fan is manifold;
- the three creases appear in a valid local order with non-degenerate sector
  angles;
- the MV assignment pattern matches one of the accepted inside/outside reverse
  fold patterns;
- the affected faces form the expected flap/pocket component rather than an
  arbitrary connected region;
- removing the candidate creases still leaves a valid reverse state.

Then add a before/after coordinate residual check:

- compare the planner's `before_state` and `after_state` folded vertices for
  the local component;
- verify unchanged faces stay rigid;
- verify the candidate crease endpoints stay coincident with the expected hinge
  relationships;
- reject or downgrade when the after state cannot be explained by the local
  reverse-fold model within a small tolerance.

### 4. Add Browser-Safe Layer Checks

Use available face orders to reject obviously impossible named moves:

- identify local face-order pairs involving affected faces;
- verify the move does not require a face to pass through an unrelated layer;
- detect ambiguous local stacking and emit a diagnostic instead of claiming a
  verified named move;
- keep the global target solver as the authority for valid solved states, but
  do not let "target resolved" alone certify the named move.

These checks should stay bounded to affected faces and neighboring overlaps.

### 5. Downgrade Instead Of Over-Naming

When a named recognizer fails, preserve the planner's usefulness:

- emit a `local_collapse` step when the region is connected and target-resolved
  but not a certified named fold;
- emit a `manual_collapse` or unresolved region when the region is non-local,
  ambiguous, or unsupported;
- include recognizer failure diagnostics in certificates and trace output;
- show the Sequence panel copy as "local collapse" rather than "reverse fold"
  for uncertified candidates.

### 6. Keep Expensive Proofs Out Of The Browser Path

Do not block the browser sequence planner on:

- continuous folding motion search;
- full collision-free path proof;
- global nonlinear rigid origami simulation;
- exhaustive layer-order enumeration beyond the configured flat-fold solver
  limits.

Those can become optional offline or high-accuracy tools later. The browser path
should focus on deterministic local certificates and clear downgrades.

### 7. Validate With Positive And Negative Fixtures

Add fixtures that make the new behavior measurable:

- positive inside reverse fold;
- positive outside reverse fold;
- three-crease fan that is not a reverse fold;
- wrong MV pattern;
- degenerate or near-zero sector;
- non-manifold local face fan;
- target-resolved macro collapse that must downgrade to local collapse;
- the Lizard CP that exposed the current false/confusing step.

For the Lizard fixture, assert both the generated certificate diagnostics and
the user-facing step kind/label so future changes do not silently reintroduce
overconfident naming.

## Affected Areas

- `crates/treemaker-sequence` for local candidate snapshots, recognizers,
  certificates, downgrades, and tests.
- `crates/treemaker-fold` if local topology helpers become reusable outside the
  sequence crate.
- `crates/treemaker-wasm` for any new serialized certificate or trace fields.
- `apps/web/src/components/panels/SequencePanel.tsx` for displaying downgraded
  step labels and recognizer failure diagnostics.
- `tests/fixtures/folding-sequence` for focused positive/negative CP fixtures.
- External corpus/debug fixtures for the Lizard CP if the source file cannot be
  committed.

## Checklist

- [ ] Add local candidate snapshot data structures and serialization tests.
- [ ] Implement local face fan, sector-angle, and incident-assignment helpers.
- [ ] Replace reverse-fold crease-count recognition with a certified
      recognizer.
- [ ] Add before/after folded-coordinate residual checks for reverse folds.
- [ ] Add bounded local face-order checks for affected faces.
- [ ] Downgrade failed named candidates to generic local/manual collapse with
      diagnostics.
- [ ] Add positive and negative reverse-fold fixtures.
- [ ] Add a regression/debug fixture or harness entry for the Lizard CP.
- [ ] Surface recognizer failure diagnostics clearly in the Sequence panel.
- [ ] Run web/WASM sequence validation and document browser performance on the
      fixture set.
