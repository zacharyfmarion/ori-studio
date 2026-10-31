# Layer spread interaction and capture performance

## Goal

Double main Pose layer-reveal drag sensitivity and reduce the long waits on
large Bodo fish drawings, preserving the current solve and rendered result.

## Approach

Measure the current pipeline over external cpoogle Truth models and Bodo
scoped steps. Separate fold/preparation/solve from pose projection, final face
clipping and final ink clipping. Keep an immutable baseline bundle and compare
optimized outputs on identical projected geometry. Prioritize avoiding repeated
work and allocation; do not simplify geometry, reduce quality, or change solver
weights/tolerances to obtain a speedup. Report exclusions/timeouts explicitly.

## Affected Areas

- Diagram Pose drag mapping.
- Shared layer-spread vector visibility and capture.
- Live render worker geometry reuse during zoom/resize.
- External-corpus benchmark tooling (no private model data in git).

## Checklist

- [x] Double main-view drag sensitivity and verify interaction.
- [x] Record cpoogle/Bodo baseline stage timings and coverage.
- [x] Optimize measured bottlenecks with output equivalence checks.
- [x] Run correctness tests, production build and browser checks.
- [x] Record before/after timings, limitations and PR handoff.

## Implementation

Main Pose dragging maps movement to reveal with half the former pixel distance
per unit. The radial control, inner exclusion and maximum reveal are unchanged.

Final ink clipping prepares barycentric coefficients once per triangle. For an
acyclic stack, any covering higher-ranked face conclusively hides the line;
lower-ranked faces cannot beat its known owner. All original interval cuts are
retained, including cuts from lower faces. Equal-ranked faces and cycles keep
the existing depth/tie rule. Cyclic membership queries reuse capture-local
stamped arrays instead of allocating sets per sample. Scratch data is released
with the capture; the persistent solve-cache policy is unchanged.

The live worker keeps its already-uploaded geometry across diagram zoom/resize.
Source, spread, rotation, presentation (including perspective camera zoom), and
style changes invalidate it. Drawing still uses the latest viewport dimensions
and scale. No solver weights, numerical tolerances, render detail, or quality
fallbacks changed.

## Validation

- 352 focused web tests across 46 suites, plus 17 shared geometry tests passed.
  New tests cover doubled drag distance, repeated cyclic visibility membership,
  1,000 seeded visibility-policy comparisons, and geometry upload invalidation.
- Web lint, TypeScript, package build, normal production build (including WASM
  hooks and landing prerender), and diff checks passed.
- Chrome Canary opened the supplied external Bodo file at step 168. Changing
  Amount and restoring it recaptured the picture with the corrected outlines.
  Diagram/Perspective switching and camera-side toolbar changes also completed.
  The original file was not saved. Native coordinate dragging still reports
  `windowNotFoundAtPosition`; pointer checks used in-app Chromium.
- In-app Chromium: a 36 px main-view drag in a 648 px-high viewport changed
  reveal from 50% to 72% as expected; the resting cursor is `grab`. Wheel zoom
  retained reveal and displayed the settled image at the new size. Perspective
  switching, full orbit and zoom rendered correctly.
- No new Rust, upstream fold semantics, native-shell behavior or file-format
  changes: Rust workspace/oracles and interactive Tauri were not repeated.
  The full web suite was not repeated; this pass targets rendering and gesture
  suites. Other browser engines and physical touch devices were not measured.

## Benchmark method

Freeze baseline and candidate JS with `scripts/layer-spread/bundle-benchmark.mjs`.
Run `benchmark.mjs prepare` with an external cpoogle root and optional external
scoped Bodo CP snapshots, then `compare` on those exact saved projected meshes.
The scripts document the commands. All model inputs, prepared meshes, output
signatures and machine-specific reports stay outside the checkout.

cpoogle uses every `truth.fold`, first layer solution, amount 100%, reveal
`[0.8, 0.6]`, front Diagram. The Bodo set contains the 191 flat-fold scopes from
the external OSF benchmark; each uses the app's selected-crease folding path
and step 168's spread settings (amount 103%, reveal approximately
`[-1.7892, 0.8938]`). It measures the same settings across those geometries,
not each step's saved legacy spread. Initial whole-document Bodo harness
attempts were discarded and rerun using the correct scoped selection.

One bounded Node worker runs at a time. Report folding, scene preparation,
spread input preparation, solving, projection, polygon clipping and ink clipping
separately. Startup, input parsing, IPC, SVG serialization and UI idle delay are
excluded from capture-stage timings. Use 12 s fold/capture and 15 s solve
deadlines; errors and timeouts stay in the report. These are CPU stage timings,
not end-to-end user latency. Compare SHA-256 signatures of every polygon and
visible-line interval, including exact floating-point endpoints.

## Results (2026-10-31)

Apple M1 Max, Node 26.8.1, current production WASM. All 484 cpoogle Truth models
and 191 Bodo scopes were attempted. Baseline and candidate captures run
sequentially; no simultaneous benchmark workers. The benchmark paused while
the production build ran. Additional alternating before/after repetitions
below isolate representative cases from the longer sweep.

| Capture CPU time, matched cases | Before median | After median | Before p95 | After p95 |
| --- | ---: | ---: | ---: | ---: |
| cpoogle, 416 cases | 160 ms | 36 ms | 6,491 ms | 437 ms |
| Bodo, 178 cases | 1,577 ms | 205 ms | 4,169 ms | 651 ms |

Mean capture time decreased from 1,057 to 142 ms for matched cpoogle cases, and
from 1,768 to 255 ms for Bodo. These aggregate distributions do not imply that
every individual model has the ratio of their medians.

Three fresh-worker repetitions per implementation, alternating order:

| Case | Before median | After median | Speedup |
| --- | ---: | ---: | ---: |
| Bodo step 168 | 3,844 ms | 363 ms | 10.6× |
| Bodo step 188 | 6,563 ms | 474 ms | 13.8× |
| Bodo step 204 | 8,415 ms | 535 ms | 15.7× |
| Horse — birb | 527 ms | 183 ms | 2.9× |
| Aknosom — Rei Sueoka | 9,810 ms | 425 ms | 23.1× |

All **594 baseline-comparable captures are byte-identical** in polygon and
line interval data. The optimized version completed all **604 prepared cases**:
426 cpoogle plus 178 Bodo. Ten cpoogle baselines exceeded the 12 s capture
ceiling; all ten optimized captures completed. A separate extended offline
check of the cyclic Alice model also matched byte-for-byte: 22.82 s baseline,
6.58 s optimized. No product deadline was raised. The remaining nine former
timeouts have no completed baseline signature, so output equivalence is not
claimed for those nine individually. All 604 saved solutions passed the
product's version/finite/bounds/warp/slope validation.

Excluded before capture: cpoogle had 17 fold errors, 3 fold timeouts and 38 solve
errors/resource rejections. Bodo had 11 unavailable paper scenes and 2 solve
errors. These are reported, not silently dropped or counted as successful
models. The initial Bodo harness errors are not part of these totals.

Solving itself is unchanged: successful cpoogle solves averaged 584 ms (median
129 ms, p95 3,059 ms, maximum 6,853 ms); Bodo averaged 555 ms (median 572 ms,
p95 1,062 ms, maximum 3,344 ms). Cold folding, solving, transfer, SVG work and
the existing idle interval remain additional costs. Slow cyclic captures can
still take seconds. No blanket claim of instantaneous loading or rendering.

External evidence: `/tmp/ori-spread-perf-20261031/summary.json`, `baseline.json`,
`candidate.json`, `paired.json`, and `cyclic-baseline-extended.json`. Canary
capture: `/tmp/ori-spread-perf-20261031/canary-bodo-168.png`. Original OSF/CPs,
prepared scenes, signatures and generated WASM are not committed. The existing
draft PR #563 carries this follow-up.
