# Visible contours for pairwise spread

This experiment was removed when the user chose
[global spread rendering](global-spread-rendering.md). The lossless
line-coverage sweep remains; the contour pass is no longer in the app.

## Goal

Restore the pairwise-order experiment after the canceled rollback, close the
fish's missing outline, and measure its cost against both the existing pairwise
renderer and global ordering before choosing a permanent policy.

## Approach

Reuse the final visible polygons to identify otherwise hidden original paper
edges that separate two visible faces. Add only those missing contour intervals;
do not outline triangulation or change stacking, heights, or connectivity. Keep
exact clipping in the capture worker on idle. Profile and optimize existing
capture work without changing its output. Keep a local comparison with the
global-order version and keep private models outside version control.

## Affected Areas

- Shared layer-spread vector clipping and contour extraction.
- Settled connected-paper capture.
- Local render comparison and corpus benchmark.

## Checklist

- [x] Undo the canceled global-order rollback.
- [x] Add bounded visible-contour extraction with synthetic regression tests.
- [x] Inspect the supplied fish angle in Chrome Canary.
- [x] Benchmark cached Cpoogle/Bodo captures and optimize hot paths.
- [x] Verify geometry equivalence outside the added contours.
- [x] Run affected checks and update the existing draft PR.

## Result and performance

The fish corner is a contour between faces 39 and 72 along the boundary of
hidden face 45. Mask 45 clips face 39, then face 72 hides mask 45's own ink.
The new pass closes this short contour along its actual boundary; it does not
move either original stroke endpoint. It retains the small geometric notch.

Contour extraction reuses the resolved polygons, queries a bounded spatial
tree, and analytically classifies coverage on either side of original material
edges. It never adds triangulation seams, auxiliary lines, or boundaries within
a flat crease group. It adds ink only when neither adjacent visible face owns
that original edge. Shared original edges are visited once. No solver, mesh,
layer-order, picking, or stored pose changes are involved.

Line capture now sweeps conservative triangle coverage intervals, keeping the
original cuts, midpoint predicates, candidate order and tie-breaking. This
reduces repeated coverage tests without moving existing line endpoints. The
capture owns all scratch memory; there is no new persistent cache.

On 604 cached successful inputs (426 Cpoogle Truth and 178 Bodo scopes), every
existing output item matched the prior pairwise renderer byte-for-byte. Only
new contour lines were appended: 81 Cpoogle cases and 34 Bodo cases, at most 11
and 6 segments respectively. All completed within the contour work budget.
This is one common pose per input, not proof of every model/angle combination.
The previous full corpus's pre-capture failures were not retried, and no new
height solves were run.

Five measured repetitions after warm-up, alternating variant execution order,
on the same cached poses; median vector-capture CPU milliseconds:

| Case | Previous pairwise | Repaired pairwise | Global ordering |
| --- | ---: | ---: | ---: |
| Fish, supplied saved angle | 79 | 90 | 68 |
| Bodo 147 | 74 | 51 | 43 |
| Bodo 168 | 286 | 270 | 236 |
| Bodo 204 | 530 | 433 | 309 |
| Horse | 175 | 149 | 162 |
| Lotus | 57 | 54 | 54 |

The broader single-run sweep used two Node workers and alternated old/new
execution order. Bodo median changed from 105 to 88 ms; Cpoogle median from
21 to 24 ms. Total capture CPU fell about 26% in each set, driven by the larger
cases. Contour extraction has a small-model cost; this is not a uniform speedup.
The slowest new Cpoogle capture was still about five seconds. Times exclude
folding, solving, projection, SVG serialization, worker transport and idle delay.

## Validation and limits

- 38 package tests cover hidden blockers, shared edges, visible third-party
  occluders, flat groups, translated/thin geometry, front/back order,
  perspective, complexity bounds and line-sweep intervals.
- 37 focused web tests across 13 suites, including serialized contour capture
  and preserving whole material anchors.
- Package build, lint, TypeScript, normal production build with WASM hooks and
  landing prerender, and diff checks passed. The existing draft PR is #563.
- Chrome Canary displayed the repaired supplied pose through the production
  Pose component and exercised the global-order comparison. In-app Chromium
  inspected the final fish and Bodo 168 vector captures.
- The local comparison under ignored `artifacts/layer-spread-review/` contains
  six poses and three renderings: global, prior pairwise and repaired pairwise.
  Private inputs, captures, benchmark reports and screenshots are not committed.
- The exact contour pass runs only in settled vector capture. The live GPU
  preview and raster complexity fallback retain the previous outline behavior;
  a missing contour can remain visible during input until the vector lands.
- Saved pictures remain snapshots until recaptured. No Rust/oracle/Tauri suite
  is needed for this follow-up: engines, file semantics and native shell are
  unchanged. No claim is made of universal visual correctness.
