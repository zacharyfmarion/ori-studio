# Spread 3D orbit performance

## Goal

Keep rotation responsive in the Edit workspace, especially for Penguin, while
preserving the existing per-plane visibility and crease coverage contract.

## Approach

Measure the production folded-mesh hook and worker under continuous camera
input, and separately count and time the renderer's WebGL work. Bound pending
camera/settings work without discarding every completed frame during a drag.
Remove redundant visibility and mask work where equivalence can be proven;
retain physical depth between unrelated planes and local cycle fallback.

### Root causes and changes

The folded-mesh hook sent every camera input immediately, then rejected a reply
if *any newer request had been sent*. At sustained input faster than rendering,
all intermediate frames were thrown away while a backlog continued growing.
The simulator's own orbit path already coalesces input, but the folded-figure
hook had not adopted that behavior.

Camera and settings now share one in-flight frame request, with only the newest
absolute state waiting behind it. Every completed frame for the current mesh
can be presented. A mesh generation still invalidates late bitmaps and eviction
replies; the final pending state is sent on completion, including after failure.
Camera and settings are applied atomically in the worker. The existing orbit
diagnostics now count these folded-mesh requests too.

The spatial renderer also repeated full shader/texture/uniform setup for every
mask and face, expanded immutable relations every frame, and ran cycle fallback
passes even for acyclic planes. It now:

- Prepares both sides' direct-blocker schedules once per mesh. Per-plane eye
  classification remains live on every frame.
- Reuses a mask across adjacent faces with identical blockers and merges
  contiguous blocker index ranges. Painted face order stays unchanged.
- Skips paper fallback only on proven DAGs. Any cyclic plane retains the
  original per-pixel fallback and depth-failed coverage. The ink pass retains
  the survivor union and fallback on every plane: ribbons can extend beyond
  triangle coverage, and faint strokes there must keep their original blending.
- Reuses shader bindings/uniforms inside a synchronous draw batch. No cached GL
  state survives that scope, including an exception, so other meshes and the
  simulator can safely share the context.

### Measurements

Penguin, 100% spread, 1600 × 1600 device pixels, local Chromium, three-second
full orbit. The harness uses the actual Edit hook, Comlink worker and bitmap
presentation, without unrelated workspace UI. Timings vary with GPU/CPU load;
presentation counts below are callback arrivals, not monitor refresh rates.

| Measurement | Before | Optimized |
| --- | ---: | ---: |
| Views presented during 8 ms input | 191 / 375 requests | 273 / 375 requests |
| 95th-percentile presentation gap, 8 ms input | 40.2 ms | 17.4 ms |
| Mean CPU submission time, isolated renderer | 3.64 ms | 0.89 ms |
| Mean draw + blocking GPU readback, isolated renderer | 9.97 ms | 6.98 ms |
| Draw calls, sampled camera | 1,549 | 1,128 |
| Scalar uniform uploads, sampled camera | 14,982 | 18 |
| Views presented during 4 ms overload | 0 | 281 |
| Time to final frame after overload input stops | 1,721 ms | 11 ms |

Scheduling alone restored 234 intermediate frames in the overload run and
reduced its trailing delay to 24 ms, before renderer optimizations. No solve,
displacement, render resolution, ordering relation or spread limit was reduced.

The repeatable browser harness is
`scripts/layer-spread/spatial/orbit-benchmark.html?model=penguin&size=1600&interval=8`.
Use `interval=4` for overload. Reports append to the existing ignored
`artifacts/sim-perf/sim-perf.log` via the dev-only sink. Corpus data stays local.

## Affected Areas

- Folded 3D worker scheduling and runtime regression tests.
- Spatial GPU rendering and visibility preparation.
- Production browser checks and a repeatable orbit benchmark.

## Checklist

- [x] Record Penguin baseline using the production hook and worker.
- [x] Bound frame requests; present completed frames during ongoing input.
- [x] Reduce redundant draw work without changing visibility.
- [x] Check slow replies, mesh replacement, settings, and final camera delivery.
- [x] Re-run real GPU policy and corpus checks, then compare performance.
- [x] Run affected web/package validation and update the draft PR.

## Validation

- Web lint and typecheck; corrected the cleanup-ref lint warning and rechecked
  affected files without warnings. Shared TS packages rebuilt.
- Simulator package: 396 tests passed, one existing skip.
- Full web run: 18,127 passed, one expected failure, 26 skipped. One unrelated
  WASM suite's `beforeAll` hit its 10-second timeout while other tooling was
  running. An isolated rerun passed all 24 tests across that suite, the runtime,
  draw-plan and folded-source tests, including its three previously skipped tests.
- Production bundle and explicit landing prerender (37 pages).
- Nine real WebGL policy cases; 70 captures across seven examples and five
  amounts. 12,977 interior pixels agree with the CPU visibility/picking policy;
  four pre-existing independent cylinder contact ties remain separately reported.
- 48 whole-image RGBA comparisons against the pre-change renderer: strip,
  Penguin and cylinder, four orbit angles, two sizes, normal and faint ink.
  Every image was pixel-identical with antialiasing disabled. The temporary
  baseline and comparison harness stay under ignored `artifacts/spatial-production/`.
- Manual production-viewer Penguin orbit and settled capture comparison.

Rust/oracles, WASM rebuild and native shell checks were not repeated: this
change touches frontend scheduling and GPU submission only. No solver, model,
format, WASM interface or native-shell behavior changed. WebKit/Tauri graphics
were not profiled; recorded measurements are Chromium on this machine.
