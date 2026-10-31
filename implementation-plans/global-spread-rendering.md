# Restore global spread rendering

## Goal

Restore the user's preferred global layer-order presentation and remove the
pairwise/contour overhead that made interaction feel sluggish.

## Approach

Use global topological depth bands for every acyclic stack in live GPU drawing,
picking, and settled vector fills and ink. Retain the existing cyclic fallback.
Remove the hidden-mask contour experiment. Preserve the solver, shared vertices,
auxiliary line fixes, stable zoom, and lossless line-sweep optimization. Compare
capture output against the frozen global renderer and measure the large Bodo
cases, including live GPU work rather than just idle captures.

## Affected Areas

- Shared spread visibility and capture.
- GPU spread rendering.
- Visibility regression tests and local performance verification.

## Checklist

- [x] Restore global ordering and remove additional contour extraction.
- [x] Verify faces, ink and picking agree, including cycles and both sides.
- [x] Benchmark Bodo and cached Cpoogle cases against the previous versions.
- [x] Test the live browser path and run affected checks.
- [x] Update the existing PR and leave localhost running with global ordering.

## Result

Acyclic stacks now always use global topological depth bands. A chain A < B < C
therefore puts C in front of A wherever their projected faces overlap, even if
B is absent there. Faces at the same rank still use physical depth. Flat-crease
pieces retain the same rank. Truly cyclic stacks retain the established local
mask/physical fallback because they cannot have a consistent global ranking.

The GPU no longer constructs bounding boxes or blocker buffers for acyclic
stacks and releases any old mask buffers on a transition to global ranks.
Zoom still reuses resident geometry. Reveal updates, render transport, and
settled vector capture stay in their existing workers, with one replaceable
pending live frame. No new solve, cache, persistent format or geometry changes.

Removed the contour extractor and its capture integration. The lossless line
coverage sweep, material-owned boundary ink, auxiliary-line continuity and
stable framing fixes are retained.

## Validation

The restored output matched the frozen earlier global renderer byte-for-byte
on all 604 cached successful captures: 426 Cpoogle Truth and 178 Bodo scopes.
487 used global ranks; 117 retained cyclic fallback. This is one common pose
per case; earlier preparation failures and height solves were not rerun.

Five measured captures after warmup, rotated execution order, median CPU ms:

| Case | Repaired pairwise | Restored global |
| --- | ---: | ---: |
| Fish, saved angle | 92 | 74 |
| Bodo 147 | 56 | 47 |
| Bodo 168 | 276 | 211 |
| Bodo 204 | 444 | 289 |
| Horse | 150 | 144 |
| Lotus | 54 | 53 |

Capture timings exclude solving, projection, SVG serialization and idle delay.
The corpus sweep ran concurrently with build checks, so its absolute durations
are not used for speed claims. Large/cyclic captures can still take seconds.

Live worker turnaround in in-app Chromium at 800×600, 30 measured frames after
five warmups, including bitmap transfer/presentation (median ms):

| Case | Pairwise zoom | Global zoom | Pairwise reveal | Global reveal |
| --- | ---: | ---: | ---: | ---: |
| Bodo 147 | 55.9 | 25.8 | 34.9 | 28.5 |
| Bodo 168 | 57.3 | 15.6 | 35.3 | 30.5 |
| Bodo 204 | 29.5 | 9.9 | 44.4 | 36.2 |

This exercises the actual geometry/GPU worker path with the old rank-eligibility
test restored only in the local comparison worker. It excludes new solves and
React/input scheduling; it is not a universal frame-rate guarantee. Zoom does
not rebuild geometry; reveal does. Both modes use identical model/style inputs.

30 package tests and 37 focused web tests cover global order on newly overlapping
faces, flat groups, front/back and perspective views, cyclic fallback, line
intervals, capture serialization, zoom/framing and worker geometry reuse.
The production Pose component was exercised with Bodo 168 in in-app Chromium:
live reveal dragging, zoom and settled capture. Chrome Canary was attempted but
did not accept navigation input. This follow-up does not repeat full OSF import.
Package build, web lint, TypeScript, normal production build with all WASM hooks
and landing prerender, and diff checks passed.

Saved document pictures remain snapshots until recaptured; nudging Amount and
restoring it regenerates the artwork. No private inputs or benchmark harnesses
are committed. Rust/oracle/Tauri checks are not repeated because engines,
upstream algorithms, formats and the native shell did not change.
