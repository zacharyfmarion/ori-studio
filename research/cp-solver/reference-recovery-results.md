# Precise construction recovery

## Status

Candidate implementation: `codex/cp-exact-recovery`, following merged #387.
Native, browser and independent procedural replays, repository tests and the
production build are complete. [Draft PR #389](https://github.com/zacharyfmarion/ori-studio/pull/389) is open and
unmerged. Local app: http://127.0.0.1:5176/welcome. See the [experiment notebook](reference-recovery-log.md)
for every candidate and rejection, including research-to-research regressions.

## Frozen comparison

The gate contains 421 recognition outputs with correct physical topology and
assignments. The outcome compares the complete graph, **including AUX**, to the
reference `.cp` geometry through the unchanged canonical graph evaluator. All
431 inputs are replayed, including ten assignment-defect controls. Reference
coordinates are opened only for scoring after each study finishes.

| Complete graph outcome | Merged baseline | S070 browser |
| --- | ---: | ---: |
| Literal coordinate equality | 0/421 | 0/421 |
| Within 1e-12 paper width | 38/421 | 276/421 |
| Within 1e-9 paper width | 178/421 | 285/421 |

Both numerical thresholds have zero lost merged-baseline matches. Browser
maximum solve time is **24.551 seconds**, including worker startup (median
0.372s, p95 9.373s); all 421 valid cases pass the existing product checks within
25 seconds. Native counts agree, with maximum 24.477s. The controls remain failed or ambiguous,
never completed solves. Local foldability alone does not count as recovery.

The previously observed development/holdout split remains 330/91. It is not a
blind holdout. Native and browser counts are 234/51 at 1e-9 and 227/49 at 1e-12.
The separate independent procedural checks read no real crease patterns.

## Selected method

After the existing solver reconstructs the full graph, including AUX vertices:

1. Tighten the numerical solution of recognized direction and held-symmetry
   equations. The ordinary solver keeps its existing tolerances.
2. Generate nearby rational and square-root constructions from bounded integer
   expressions. Choose independent anchors by the simplicity of the resulting
   graph and its displacement from the observation. This uses no trained model.
3. When the linear proposal fails the original checks, propagate anchors with
   nonlinear Kawasaki equations and sparse Newton refinement.
4. Refine supported grids and straight carriers whose exact endpoints determine
   their positions. Preserve already-recognized coordinates, including dependent
   coordinates that could otherwise move during back-substitution.
5. Rejudge every proposal against the original graph, pins, movement limits and
   foldability checks. Each stage spends the same total solve deadline and
   reserves time for validation; a rejected proposal retains the previous solve.

The browser and native desktop use the same Rust implementation. The shared
frontend enables this policy for recognition and whole-region solving. The
Rust option remains opt-in for other API callers. Existing desktop bundles keep
their existing solver, and no model registry or model asset changes are needed.

## Limits and stopping evidence

This is an empirical plateau for the tested construction searches, **not a
proved theoretical maximum**. S070 still misses 136 complete references: 53
small, 71 medium, ten large and two giant patterns. Most remaining misses are
therefore not explained by graph size alone.

The notebook includes rejected wider dictionaries, additional radicals,
relative-distance constructions, nonlinear refinement variants, observation
weights and bounded beam search. Some recover new cases while selecting valid
but incorrect alternatives in others. The last beam experiment gains two
primary cases over its immediate prototype, but replacing the composed solver
loses four and gains three. Relative constructions similarly trade gains for
losses. A final stronger observation prior gains five and loses six development
cases relative to its immediate prototype. These are recorded, rather than
selecting the best answer per case using
the reference.

Twenty-seven development examples have independently checked alternative
geometries preserving every edge direction and the recognized coordinate facts
used in that experiment. They demonstrate underdefinition of those constraints;
they do not establish an upper bound on all possible construction priors. Of
those 27, 22 remain unmatched in S070 and five are recovered by its prior.
More iterations cannot determine an author's choice between equally admissible
geometries without additional evidence. A stronger geometric prior or more
information from the image may still improve these counts.

## Independent checks

The shared application entry point solves the three procedural grids at 1,089,
4,225 and 9,409 vertices in 0.461s, 3.944s and 18.262s respectively; all match
complete reference graphs at 1e-12. The corrected Knight solves in 9.200s;
it has no reference geometry, so this is not a recovery claim.

Fresh rational/surd crosses with AUX, four rotations and shuffled vertex IDs
recover 20/24 references at both numerical thresholds. The four misses select
a simpler nearby construction instead of 11/32. Eight continuous controls
also move, demonstrating that this prior can change an already-valid free
coordinate; it does not infer author intent from foldability alone. Pins remain
hard constraints. These failures are retained in the reported evidence.

## Repository validation

- Rust workspace: 2,208 passing tests; seven pre-existing ignored tests.
- Seventeen focused recovery tests cover AUX carriers, pins, precise rationals
  and surds, dependent coordinates, held symmetry, half-angle directions,
  nonlinear propagation and deadline exhaustion.
- Workspace clippy, Rust formatting and diff checks pass.
- Web lint/typecheck, all 6,993 tests and the normal production build pass.
  Tests/build use Node 22.14.0, matching CI's major version. The first web run
  under the shell's Node 26 failed on unavailable `localStorage`; the original
  failed log and successful rerun are retained. No test workaround was added.
- Independent exact-audit unit tests pass. Browser measurements use actual
  workers and the product entry point, including AUX and large-grid checks.

The separate external C++/Java/JS port oracles were not rebuilt: no vendored or
ported algorithm, parser or serializer changed. Their ordinary workspace tests
ran with the rest of the suite. No separate desktop packaging run was needed;
the desktop crate was covered by workspace tests/clippy, and both transports
call the same compiler entry point. No upstream parity claim was expanded.

## Reproduction

The final frozen candidate is under ignored
`artifacts/cp-solver/S070-protected-coordinates/`. It contains the native binary,
WASM, source snapshot, input/options hashes, per-case outputs and independent
audits. Use `run_solver_study.py`, `run_browser_solver_study.mjs`,
`score_solver_study.py`, `audit_exact_recovery.py`, and
`compare_recovery_studies.py` in `scripts/cp-detect/research/`.
The latter refuses comparisons with added/dropped cases or a changed gate.

Timing hardware: Apple M1 Max, ten physical CPU cores, 64 GiB memory. Browser
environment and WASM hashes are recorded in the replay protocol. Timing jobs
run sequentially and separately from builds and test suites.

No real CP training, cloud resources, private Alligator validation, production
publication or merge occurred in this follow-up.

Durable archive location:
`/Users/zacharymarion/Documents/datasets/create-pattern-detector/research/cp-reference-recovery-2026-09-16/`.
Its manifest records per-file SHA256 values for 179,498 files (29.50 GB logical
size; APFS clone copy). Generated CPs and per-case outputs
remain outside Git.
