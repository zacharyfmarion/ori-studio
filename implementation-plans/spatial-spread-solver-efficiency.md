# 3D spread solver memory and performance

## Goal

Reduce the one-time memory and computation needed to prepare spatial layer
spread, preserving the opening objective, connected material, and rendering
policy. Investigate the supplied Tortoise model, which exceeds the current
100,000-crossing-sample limit, before increasing production budgets.

Investigation and production integration on 2026-11-03. The historical prototype
measurements below explain the chosen approach; production results follow them.

## Approach

### Measured baseline and candidates

Benchmark the release WASM solver in a fresh Chromium worker for each variant,
on the local development machine. Raise only the prototype's sample cap to
1,000,000 so Tortoise can reach the solve; retain the existing solver settings
and 20-second limit. Timings include sample generation, matrix construction and
solve, and exclude rendering. These are local measurements, not device-wide
performance guarantees.

| Tortoise variant | Preparation + solve | WASM memory capacity | Peak live Rust allocation | Solver variables | Solver constraints |
| --- | ---: | ---: | ---: | ---: | ---: |
| Current formulation, cap raised | 14.27 s | 499.0 MB | 485.1 MB | 286,656 | 592,836 |
| Exact duplicate merging, omit zero rows and redundant slack bounds | 7.06 s | 256.7 MB | 249.7 MB | 188,577 | 218,730 |
| Above, plus coefficient canonicalization at 1e-12 | 2.35 s | 108.3 MB | 92.8 MB | 56,806 | 86,959 |

MB means decimal megabytes. WASM capacity is the linear memory's byte length;
the live-allocation measurements come from an instrumented allocator, not a
browser process-memory estimate. Worker and JavaScript overhead are additional.
The initial uninstrumented browser baseline was 14.4–14.5 s and 499.0 MB.

The final candidate uses about 78% less WASM capacity and runs about 6.1 times
faster than the baseline in this experiment. Native release measurements also
improve: 10.88 s / 611.8 MB peak live allocation becomes 1.74 s / 117.7 MB.

### Production integration

Streaming compaction now releases duplicate rows during overlap preparation and
drops the lookup table before building the quadratic program. The final release
WASM solves Tortoise in **2.35 s with 94.7 MB of linear memory**, about 81% less
capacity than the original formulation. Its maximum vertex displacement change
from the original solve is 5.25e-7 in normalized coordinates. The material,
rigid-motion and acceptance tolerances are unchanged; the reported maximum order
violation includes the coefficient-rounding error bound conservatively.

The 100,000-sample admission limit now counts distinct nonzero crossing rows.
The 2,000,000-work guard includes overlap corners as well as triangle/pair work,
so repeated identical rows cannot run indefinitely. Gap objective samples also
have a 100,000-entry guard. Canonicalization falls back to the original row if
rounding would overflow or exceed a 2e-12 gap error at accepted displacements.

The production service terminates each completed spatial worker while retaining
its result cache. A real-browser test observed one worker created and terminated
for Tortoise, with 2.42 s for the first complete preparation and 0.64 ms for the
cached request. The reusable flat-spread worker policy remains unchanged.

### Where the memory goes

Tortoise has 1,059 material vertices and 1,242 faces. The geometry and rigid-group
motion account for 10,629 variables. The solver then creates **276,027 additional
slack variables**, one per overlap-corner sample, and two inequalities per slack.
Most of the problem is this penalty representation, not the material mesh.

In the baseline WASM measurement:

- Sample generation takes about 0.40 s and holds 35.8 MB of live allocations.
- The assembled rows/triplets hold about 139.8 MB before solver setup.
- Solver setup takes another 4.9 s; live allocations reach 457.2 MB, with a
  485.1 MB peak while constructing matrices and factorization data.
- Iteration takes about 8.8 s, with 43 iterations.

The final displacement array is only 25,416 bytes of numeric data
(1,059 × 3 × 8). The input JSON in this benchmark is 283,362 bytes.

### 1. Combine repeated crossing penalties

Each sample penalizes `w * max(0, -r·d)^2`. Samples with identical row `r` can
be replaced by one sample whose weight is the sum of their weights. This
preserves the mathematical objective, subject to floating-point summation.

The 276,027 samples include 12,407 identically zero rows. Exact row comparison
reduces the remaining problem to approximately 177,950 distinct nonzero rows
(native and WASM differ slightly in exact floating-point equality).

Many other rows differ only in the last few floating-point digits because
neighboring clipped triangles/cells recover the same barycentric point by
different arithmetic. Canonicalizing coefficients to a 1e-12 grid produces
46,177 nonzero rows on Tortoise. This step is a bounded numerical approximation,
unlike exact duplicate merging. In the experiment, the largest possible change
to a Tortoise sample's gap under the existing displacement bounds is 4.41e-13.
This does not by itself bound the optimizer's output difference; compare the
solved geometry as well.

Preserve the **original total crossing weight**, including zero rows, when
normalizing the penalty. Recomputing that total after dropping zero rows would
change the relative penalty strength and the spread appearance.

Integrate compaction while generating samples, so raw duplicate rows do not all
need to coexist. Bound raw geometry work separately from retained samples. Apply
the solver-size budget to the compacted representation; do not simply raise
the original raw-sample cap.

### 2. Remove the redundant slack lower bound

For each crossing, the current problem minimizes `w*s²`, with `w > 0`, subject
to `s >= -r·d` and `s >= 0`. For fixed `d`, minimizing the quadratic with only
the first inequality already gives `s = max(0, -r·d)`. The second inequality is
unnecessary for the optimum. Removing it preserves the minimized objective and
removes one constraint per retained crossing sample.

Retain the existing material displacement bounds, rigid-motion regularization,
gauge constraints, gap targets, and numerical acceptance checks.

### 3. Release worker memory after completion

The allocator reports less than 0.4 MB live after the solve and result assembly,
but WASM linear memory remains at its high-water capacity: 499 MB for the
baseline, 108 MB for the candidate. `SpreadService.finish` retains the successful
worker; subsequent figures can therefore retain a large allocation even after
the temporary solver data is freed.

Recycle the spatial worker after delivering a solution, while keeping the
existing bounded main-thread result cache. Rotation and amount changes reuse
the cached displacement field. This allows the browser to reclaim the worker's
linear memory; it does not lower the peak during a solve. Measured WASM init was
3–9 ms, small beside these solves. Preserve lease sharing, cancellation,
preemption and pending-request behavior in service tests.

### Validation so far

Compared the original formulation against the candidate on nine inputs: joined
strip, waterbomb, three-plane stacks, spikes, Penguin, Pangolin, kirigami
cylinder, separated rectangles, and Tortoise. All retained their successful
solve/no-stack status and passed the solver's existing residual checks.

Using production material-mesh and camera projection functions, compared every
vertex at 100% spread (internal amount 4), in twelve views per model at 1600 px.
The maximum projected change was 0.1055 px on Penguin, 0.0052 px on Pangolin,
and 0.0013 px on Tortoise. This is a vertex-position comparison, not a full
rendering/picking regression. The largest normalized 3D vertex difference at
unit spread was 4.41e-5 on Penguin; Tortoise's was 5.25e-7.

Native Pangolin preparation improved from 3.04 s to 0.48 s, and Penguin from
0.28 s to 0.08 s. Small cases sometimes take slightly longer due to compaction
overhead; their absolute times remain milliseconds.

The private inputs, isolated Rust/WASM probe, allocation instrumentation and
raw results stay under ignored `artifacts/spatial-production/`:

- `tortoise-bench/`: copied solver, raised experimental cap, variants and allocator.
- `tortoise-v{0,2,4}-wasm.json`: instrumented browser measurements.
- `spread-compaction-comparison.json`: nine-model native comparison.
- `compacted-projection-comparison.json`: production camera/mesh comparisons.
- `run-spread-probe.mjs`, `compare-spread-probes.py`, and
  `check-compacted-projection.mjs`: local experiment drivers.

No user corpus geometry is committed. No upstream folding or ordering behavior
is changed; this solver is original display-only functionality.

## Affected Areas

- `crates/oristudio-layer-spread/src/spatial.rs`: sample compaction, slack
  formulation, resource accounting and numerical validation.
- `crates/oristudio-layer-spread/tests/spatial.rs` and nearby unit tests:
  objective equivalence, normalization, tolerance bounds and geometry checks.
- `apps/web/src/layer-spread/spreadService.ts` and `spatialService.ts`: worker
  recycling with retained solution caching.
- Production WASM build and spatial rendering/capture regression harness.

## Checklist

- [x] Measure sample, matrix, solver and retained-worker memory separately.
- [x] Prototype exact duplicate/zero-row removal and redundant-bound removal.
- [x] Prototype bounded coefficient canonicalization; compare numerical results.
- [x] Measure native and browser Tortoise costs and compare nine model inputs.
- [x] Check projected vertex differences through production mesh/camera code.
- [x] Integrate streaming compaction with raw-work and compacted-size budgets.
- [x] Add exact weighted-penalty equivalence, zero-row normalization, rounding,
      and randomized/rotated geometry regression tests.
- [x] Integrate slack-bound removal and verify the original objective and
      acceptance checks on all regression cases.
- [x] Recycle completed spatial workers; test cache hits, shared leases,
      cancellation, preemption and queued requests.
- [x] Rebuild production WASM and repeat browser timing/memory measurements.
- [x] Run full spatial color, crease, picking, capture and orbit regressions,
      including Tortoise.

Focused validation includes 16 Rust tests (with a synthetic 147,000-sample
stack), Clippy on both spread crates with Rust 1.98, 154 web tests across 21
files, lint/typecheck, nine production WASM solves, and twelve Tortoise captures
across six amounts and both sides. Tortoise's 1,632 interior GPU face-ID checks
have no mismatches or contact ties. The complete nine-model renderer review
passes 108 captures and 18,024 interior checks; four independent cylinder
contact ties are reported separately. Twelve synthetic GPU/CPU visibility and
ink cases, forced raster fallback and unknown-order refusal also pass.

`npm run build:web` passes with its normal hooks: shared packages, every WASM
bridge, TypeScript, production bundling and the 37-page landing prerender. The
full web run passes 18,137 tests with one expected failure and 23 skips; three
unrelated Settings-modal tests hit their 5-second timeout while the build and
suite were running concurrently. An isolated rerun passes all 42 tests in that
file. The final targeted lint, workspace format and whitespace checks pass.

The final native app-browser orbit check at 1600 pixels presents 181 Penguin
frames during three seconds of continuous input, with a 19.2 ms p95 presentation
gap and 1.10 ms mean CPU draw submission. These are callback timings, not monitor
refresh rates.

**Remaining renderer cost:** Tortoise now opens successfully, but its dense
ordered masks still require 21,591 indexed draws and 1,762 line draws per frame
at the benchmarked view. At 1600 pixels, mean CPU submission is 28.1 ms and
GPU completion is 71.3 ms; continuous input presents 40 frames in three seconds,
with a 98.3 ms p95 gap. At 800 pixels it presents 52 frames, with a 64.9 ms p95
gap. No spread solve runs during either orbit. Dense-mask rendering needs a
separate batching/visibility optimization; the preparation improvements here
do not establish smooth orbiting for this larger model.

The example and orbit harnesses now resolve newly generated local fixture paths
at request time instead of using Vite's cached URL glob. Tortoise can be added
while the existing dev server stays running.

Unrelated Rust workspace crates, upstream oracles and native-shell checks were
not rerun: this changes original display-only solving and shared web worker
lifecycle, with no changes to folding, parsing, native commands or packaging.
