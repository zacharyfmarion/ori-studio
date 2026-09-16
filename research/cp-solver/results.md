# Clean-topology geometric solving — September 16, 2026

The browser replay solves **531/531 supported clean repaired graphs** and
**421/421 recognition outputs with correct topology and assignments** within
25 seconds. Maximum measured times are 10.98s and 20.52s respectively, including
fresh worker startup and export. All 24 independent procedural cases pass too.
This is a shared Rust/WASM algorithm improvement; no model training, download,
or cloud resources were needed.

## What changed

The previous policy returned early on accepted-but-ambiguous geometry and used
only lattice snapping above 1,500 spans. A large non-grid pattern could therefore
fail without trying a geometric method. The new bounded policy retains exact
ordinary results and tries direct-coordinate feasibility projection when needed.

Newton steps use sparse, matrix-free LSQR to satisfy Kawasaki and local crimp
equalities. Angle-family and explicit-carrier proposals share one deadline.
Numerical step regularization and relative normal-residual stopping handle
redundant systems. The first unconstrained attempt leaves time for a detected
angle family; if that hypothesis fails, unrestricted solving remains available.

Two false-constraint bugs also mattered: document rebuilding and judging
inferred carriers used detector-sized bins that could group distinct dense
pleats onto one line. Stated/solved geometry now uses numerical collinearity for
those groups. Explicit source-carrier IDs remain hard constraints. The existing
checker and residual thresholds are unchanged, as are assignments and topology.

Automatic import and whole-region repair enable the bounded policy by default,
with a 25-second solve budget. Compact recognition also retains the existing
one-minute combined inference/solve budget. Existing solve analytics, cancellation,
AUX reconstruction, movement limits, and vertex pins remain in use.

## Baseline and final browser results

All cases come from the frozen `real_benchmark` inventory. Real CPs are used only
for evaluation. The previously observed holdout is explicitly not a blind test;
S014 responds to failures discovered in that replay. No case-name dispatch or
truth geometry is supplied to solving.

The baseline is the frozen native S000 solver; the selected column is the full
S015 browser replay with the S016 timing audit. These are status/reference
comparisons, not a claim of a browser speedup over a browser baseline.

| Input gate | Baseline strictly Solved at 25s | Selected browser results |
| --- | ---: | ---: |
| Repaired topology, all 545 inputs | 484 | 531 |
| Repaired topology, 531 supported clean inputs | 484 | 531 |
| Repaired topology, 24 giant inputs | 6 | 23 |
| Recognition-exact topology and assignments, 421 inputs | 404 | 421 |
| Recognition-exact topology, including assignment defects, 431 inputs | 404 | 421 |

The repaired-topology improvement adds 47 strict solves with no losses.
Reference recovery at the existing unrounded 2px metric increases from 453 to
494 of 526 reference-scored inputs, with 41 gains and no losses. Correct
recognition inputs add 17 strict solves and 15 reference recoveries (372 to 387),
also without losses. Reference agreement and exact local geometric validity
are different outcomes: the constraint system can have several nearby valid
solutions. This is not 100% recovery of an author's exact original coordinates.

The full repaired denominator retains 14 failures: twelve non-square or
non-quadrilateral boundary import refusals, one self-edge, and one input with
a degenerate edge and invalid boundary contacts. The recognition-exact-topology
gate contains 431 inputs; ten have incompatible mountain/valley or degree
constraints and remain failures. Geometry solving does not recolor their creases.

No size cutoff is applied. The repaired-graph browser results by complexity are:

| Complexity | Solved / all inputs | Maximum successful solve |
| --- | ---: | ---: |
| Small | 236 / 242 | 0.85s |
| Medium | 214 / 219 | 10.98s |
| Large | 58 / 60 | 10.01s |
| Giant | 23 / 24 | 2.54s |

Across successful repaired inputs, median time is 0.072s and p95 is 1.87s.
For correct recognition outputs, median is 0.301s and p95 is 7.99s. Complete
counts, timing values and evidence hashes are in [browser-summary.json](browser-summary.json).

## Independent procedural checks

Twelve nonuniform orthogonal grids use three fixed random seeds at 8, 24, 40 and
64 cells, with 0.0005-unit coordinate noise and valid 3M/1V assignments. The largest
has 4,225 vertices and 8,320 edges. All twelve solve in the browser, maximum
12.79s, compared with two native timeouts before the numerical/scheduling fixes.
All twelve also recover their generated references within 2px. The selected
native replay's maximum was 4.84s.

Twelve additional single-vertex patterns have arbitrary sector angles and ray
orientations, with noisy boundary contacts. All solve in the browser, maximum
0.068s; nine match their particular reference at 2px. These deliberately underdetermined cases illustrate
why a checker-clean answer is not proof of recovering a unique original design.

## Measurement and limits

`Solved` requires the existing Kawasaki, CAMV/crimp, assignment, carrier,
crossing, boundary, and movement checks. Accepted ambiguous improvements do not
count. These checks establish local geometric validity, not a proof of global
layer-order feasibility. Finite benchmarks do not establish a guarantee for
unbounded complexity or every device.

Native exploratory timings ran alongside development work. Browser measurements
use fresh actual solve workers, include startup/export, and run one case at a
time on Apple M1 Max with 64 GB RAM, Chromium 148.0.7778.96. The first 256
repaired development cases overlapped unrelated workspace tests; all 256 were
repeated after test/build jobs finished, with identical success/refusal counts.
The timing summary uses those isolated repeats. The slowest recognized case
from each split was repeated too: 20.509s and 20.505s, both successful. Neither
the original observations nor failed cases are discarded from the archive.

An initial research-probe bug omitted the inverse FOLD frame transform when
scoring S000. The corrected baseline score is 453, not 178. The correction verifies
identical normalized input coordinates before applying recorded transforms;
neither solve status nor runtime is changed. Original artifacts are retained.

## Reproduction and delivery

See the chronological [notebook](2026-09-16-log.md) and [protocol](README.md).
`run_solver_study.py` freezes binary/options/input hashes and separates truth
scoring from solving; `run_browser_solver_study.mjs` records the actual WASM,
worker, normalized-input, and script hashes. `score_solver_study.py` scores a
completed run without invoking a solver. Generated CPs and per-case artifacts
remain outside Git under `artifacts/cp-solver/`.

Durable evidence is archived at
`/Users/zacharymarion/Documents/datasets/create-pattern-detector/research/cp-solver-2026-09-16/`.
Its manifest records SHA256 hashes for 35,507 files (7.28 GB logical size),
including frozen executables, final WASM, every per-case report, reference
scoring, validation logs and the source patch. The APFS copy shares unchanged
disk blocks. Real-pattern artifacts are not committed to the repository.

Validation passed: Rust workspace tests and workspace clippy; web lint,
typecheck, all 6,899 tests, and production build. After the final inferred-carrier
change, the compiler/detect/detect-WASM tests and clippy, focused web tests,
lint/typecheck, Rust formatting and diff checks were repeated. Tests cover AUX
junction restoration, a pin on an AUX junction, explicit carrier constraints,
movement refusal, numerical rank deficiency, and deadline refusal. No separate
external upstream oracle was run: upstream checker behavior is unchanged.

This ships as code through the ordinary web/WASM and desktop builds. Model
registries and model files are unchanged, so existing desktop installations
continue to use their existing code and compatible model channel. The local
default enables the new policy for imports and region/whole-pattern solves.
Customers receive it through a subsequent code deployment or desktop update.
No PR merge, production deployment, model publication, or desktop release has been
performed for this solver phase. A merge requires the user's explicit go-ahead.

Delivery: [draft PR #387](https://github.com/zacharyfmarion/ori-studio/pull/387).
The local app remains available at `http://127.0.0.1:5176/welcome`.
