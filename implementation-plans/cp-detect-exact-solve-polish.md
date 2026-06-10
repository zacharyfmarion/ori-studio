# CP Detect Exact-Solve Polish: Crossing the Flat-Folder Precision Cliff

Status: Proposed implementation plan, 2026-06-10.
Branch: `cp-detect-exact-solve-polish` (off main @ 56127c6, post PR #56).

## Goal

Make `image → detect → exact solve → flat fold` succeed end-to-end, prioritized
on **treemaker-family** samples (in-distribution per product direction;
rabbit-ear's dense tiny folds are a known model-side limitation tracked in
create-pattern-detector `docs/v2-close-pair-junction-recovery.md`).

## Measured chain state (2026-06-10, all fresh)

1. **Topology** (junction-first-v1 + parity + cp-detector-v3): treemaker
   **4/7 strictly exact** + 1 sample missing exactly one edge; rabbit-ear 0/8.
2. **Exact solve works when topology is exact**: on `012950`
   (perfect reconstruction) it accepts in **0.087s**, Kawasaki 4.25° → 0.0029°,
   45 vertices moved ≤1px. The notorious 170–330s reject behavior
   (`candidate_status_failed`, `movement_budget_exceeded`, attempted moves of
   0.1–0.3 units) occurs **only** on imperfect topology.
3. **The flat-folder has a precision cliff at ~1e-4 relative coordinate
   noise**, measured with exactly-constructed Miura grids: folds at 40/220/420
   edges with exact coords and at noise ≤1e-4; at 1e-3 it fails with
   `assignment_conflict: conflicting implied assignments` — the **same error**
   detected graphs produce. That error is noise-induced layer-constraint
   inconsistency, not wrong M/V labels. Scale is NOT the folder's problem.
4. Everything we feed the folder sits at/past the cliff: GT packs are only
   millidegree-foldable (12/15 fail), and exact-solve output converges to
   ~3e-3° because its objective trades Kawasaki (σ 0.10°) against movement
   priors (σ 0.012) anchored to the noisy detected positions
   (`exact_solve.rs` residual families: Movement, BoundaryMovement,
   CarrierPrior, CarrierIncidence, Kawasaki).

**Conclusion:** the binding e2e lever is closing the ~1e-3 → ≤1e-4 precision
gap in the exact-solve output. Cheap, compiler-side, no GPU/model risk.

## Design

### Phase 1 — Two-stage polish in `solve_exact`

File: `crates/oristudio-cp-compiler/src/exact_solve.rs`.

After the existing solve **accepts**, run a polish pass:

- Rebuild the `SolveModel` with priors **re-anchored to the stage-1 solution**:
  vertex movement residuals measure deviation from the stage-1 points (not the
  original detected points), and `CarrierGroup::initial_theta/rho` re-anchor to
  stage-1 carrier params. Anchors then cost ~0 at the polish start and only
  prevent drift, instead of fighting the theorem residuals.
- Tighten theorem sigmas for the polish stage (new options, defaults chosen by
  ablation): `polish_kawasaki_sigma_radians` ≈ 0.01°,
  `polish_carrier_incidence_sigma` ≈ 1e-5, movement sigma can stay or loosen
  slightly (anchor is now self-consistent).
- Keep the polish behind `ExactSolveOptions { polish: bool }` (default **on**;
  the strict harness gets `--no-exact-polish` for A/B).
- Acceptance: polish result must not regress the stage-1 verdict — reuse the
  existing acceptance checks against the *original* input (movement budget
  measured from original detected points stays in force). If polish fails to
  improve `max_kawasaki_residual` / incidence, keep stage-1 output. Polish runs
  ONLY when stage 1 accepted, so the slow-flail path on bad topology is
  untouched.
- Optionally iterate (≤2 polish rounds with decaying sigmas) if round 1 lands
  short of target.

Target: `max_kawasaki_residual ≤ 1e-4°` and carrier incidence ≤ 1e-6 units on
exact-topology samples, runtime ≤ ~2s/sample for solve+polish.

### Phase 2 — Exact vertex reconstruction (if Phase 1 lands short)

After polish, recompute each free vertex as the weighted least-squares
intersection of its incident solved carriers (data already in
`span_to_carrier_group` / `carrier_groups`), making incidence consistent to
machine precision for well-conditioned vertices; skip vertices whose carriers
are near-parallel. This removes the residual-equilibrium floor entirely.

### Phase 3 — Assignment humility (contingency, only if conflicts persist)

Treemaker GT contains genuinely ambiguous creases (up to 98 'U' edges/sample);
the detector hard-assigns everything, and a wrong completion of an ambiguous
crease can cause `assignment_conflict` even at perfect geometry. If
geometric polish doesn't clear the folder on exact-topology samples: emit 'U'
to the folder for edges whose assignment confidence is below a threshold
(plumb through `fold_export`), letting the folder's layer solver choose. Keep
out of scope until Phases 1–2 are measured — the Miura noise experiment showed
geometry alone reproduces the failure signature.

### Guardrail — folder tolerance regression test

Add a `treemaker-flatfold` test constructing an exact Miura grid (~220 edges),
asserting (a) it solves, and (b) it still solves under 1e-5 relative coordinate
noise. Pins the cliff so future folder changes can't silently tighten it.

## Validation

1. Unit: polish drives a synthetic noisy fixture below 1e-4° Kawasaki; polish
   is skipped when stage 1 rejects; `--no-exact-polish` reproduces current
   behavior byte-for-byte.
2. **The keystone e2e check**: `compare_exact_solve_benchmark
   --candidate-source junction-first-v1 --junction-first-offset-cluster-radius-px 3`
   on the `012950` single-sample manifest (`/tmp/manifest-012950.json` recipe:
   filter the v3-close-pair dense cache manifest, absolutize tensor paths) —
   `exact_solved.verification.flat_folder_solved` must flip to true.
3. Full clean-15 run (flat folder enabled), family-bucketed. Gates,
   treemaker-first:
   - treemaker `flat_folder_solved` ≥ 3/7 end-to-end (stretch 5/7);
   - exact-solve runtime on accepted samples ≤ ~2s; no change to behavior on
     rejected/imperfect-topology samples;
   - strict topology metrics unchanged (polish moves vertices ≤ ~1px).
4. Inspector stage-6 spot check of a polished sample.

## Out of scope

- Rabbit-ear close-pair recall (model-side; see create-pattern-detector plan).
- Folder epsilon-widening (only as a measured last resort; the tolerance test
  gives the safe harness for it if ever needed).
- Exact-solve performance on imperfect topology (the flail path) — mitigated
  separately by topology quality, not this plan.

## Critical files

- `crates/oristudio-cp-compiler/src/exact_solve.rs` — polish phase, options,
  re-anchored model construction, (Phase 2) carrier-intersection reconstruction.
- `crates/oristudio-cp-detect/src/bin/compare_exact_solve_benchmark.rs` —
  `--no-exact-polish` flag.
- `crates/treemaker-flatfold/tests/` (or in-crate tests) — Miura tolerance
  guardrail.
- Context: `crates/oristudio-cp-compiler/src/verify.rs` (folder invocation),
  `crates/treemaker-flatfold/src/constraints.rs` (the assignment_conflict site).

## Findings (2026-06-10, post-implementation)

Phase 1 landed and exceeded its target: re-anchored polish reaches 1e-7..1e-12
degrees Kawasaki in ~0.2-7s, and the exact-solve stage reports **"solved" on
6/15 clean samples** (previously zero, ever). Acceptance subtlety: the
polished candidate must be judged in polish-model objective units; the
original objective re-rejects every successful polish by construction.

End-to-end folding remains **0/15**, and the failure ladder beyond the plan's
scope was peeled sample-by-sample:

1. assignment_conflict from noise — fixed by polish.
2. precision_failure in the folded-graph epsilon ladder — fixed by tighter
   polish (1e-6 deg target).
3. "non-overlapping face pair" — fixed: sliver-face eps-merges fed the
   constraint choice table non-distinct face quadruples
   (treemaker-flatfold/constraints.rs now skips shared-face edge pairs).
4. Residual layer-solver assignment_conflict. Root-caused on the two best
   debug vehicles:
   - 000346 (GT folds; detection solved at 3e-7 deg, zero M/V disagreements):
     a 4px GT border sliver (boundary contact 0.0038 units from a corner) was
     merged into the corner by detection; the crease terminates at the wrong
     point and the GT-labeled pattern becomes genuinely unfoldable. The
     tiny-feature/close-pair detection limit again, in border form.
   - 012950 (topologically exact, assignments exactly GT incl. 22 U edges,
     1e-7 deg geometry): still conflicts, as does GT itself; prime suspect is
     folded-space epsilon-merging of its 5px features corrupting the
     cell/overlap structure (the constraint guard removes the degenerate
     constraints but not the underlying merge). A finest-stable-plateau eps
     experiment did not fix it (reverted).

Conclusions:

- The exactization lever is DONE and valuable (prerequisite for everything;
  ship it). The folder's precision cliff is no longer the binding constraint
  for samples with correct structure.
- Flat-foldability is brittle to STRUCTURAL deviation: a single 4px-wrong
  crease endpoint flips global foldability. E2E folding therefore requires
  topology exact to GT including tiny features — re-coupling this plan to the
  close-pair/tiny-feature detection limit (model-side, see
  create-pattern-detector docs/v2-close-pair-junction-recovery.md).
- The remaining folder-side work is folded-space robustness around tiny
  features (eps-merge corrupting cells for patterns with ~5px creases) —
  exact/rational arithmetic on folded coordinates or feature-aware epsilon
  selection. That is a self-contained treemaker-flatfold project; the Miura
  tolerance guardrail and --dump-folds give it a harness.
