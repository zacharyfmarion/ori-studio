# Pose startup readiness

## Goal
Explain and reduce the Bodo fish delay after folding, and keep Pose visibly busy until its first interactive frame is ready.

## Approach
Measure cold scene reading, spread preparation/solve, and first-frame rendering. Optimize confirmed costs without changing geometry or layer ordering. Cover preparation and renderer startup with a pane-local loading state; preserve navigation and fast live gestures after readiness. End loading on failure and ignore stale results.

## Affected Areas
- Connected spread preparation and renderer startup
- Diagram Pose readiness hooks and viewport presentation
- Renderer resource lifecycle and focused tests

## Checklist
- [x] Measure cold and warm startup on Bodo fish
- [x] Implement lossless optimization for measured bottlenecks
- [x] Add pane-local loading through the first painted frame
- [x] Verify cancellation, failure, stale results and interaction
- [x] Run relevant validation and update the existing draft PR

## Measurements

Local browser benchmark, 800 × 600, using the production preparation service and render pipeline on Bodo steps 147, 168 and 204. Model loading/folding and whole-book parsing are outside these numbers. Fresh worker for each first frame; two first-frame samples per renderer. Timings are not device-independent budgets.

| Stage | 147 | 168 | 204 |
| --- | ---: | ---: | ---: |
| Cold source preparation + solve (unchanged) | 1.25 s | 1.09 s | 3.09 s |
| Same input with solve cached | 68 ms | 78 ms | 143 ms |
| First frame before, mean | 913 ms | 964 ms | 1,170 ms |
| First frame after, mean | 215 ms | 227 ms | 282 ms |
| Command/buffer setup before | 709–716 ms | 751–765 ms | 906–950 ms |
| Command/buffer setup after | 20–21 ms | 19–20 ms | 23 ms |

The toast belongs to the layer-order search, not all of Pose startup. After that search, Pose reads a render snapshot and paper scene, prepares shared vertices/order constraints, solves the heights, and initializes the graphics worker. The kernel's snapshot + scene read separately measured 30–45 ms in Node/WASM on these steps (excluding browser RPC). First-frame projection costs about 76–104 ms; stroke geometry about 20–23 ms. The dominant avoidable rendering cost was compiling the same REGL stroke command once for each of 785–940 faces.

The optimized command and unit quad are shared per WebGL context and depth mode. Segment buffers, drawing sequence, shaders, layer order and solver are unchanged. Reference counting frees the quad with its last owner; there is no retained model cache here. Initial 1-pixel layout placeholders no longer count as ready frames.

Warm zoom medians before/after: 15.75/14.59, 26.76/24.77 and 9.64/8.66 ms. Warm reveal medians: 29.43/28.81, 31.93/30.68 and 37.11/35.69 ms. These small differences are within normal browser timing variation; no live-loop speedup is claimed.

Raw local evidence (ignored): `artifacts/global-spread-perf/startup-comparison.json`, `startup-warm-comparison.json`, and the startup/production-Pose browser harnesses. No private models are committed.

## Loading behavior

A pane-local “Preparing pose…” spinner dims and intercepts the model while source reading/preparation/solving is pending, then through graphics startup until the first non-placeholder frame is painted. The previous picture stays visible underneath and the page does not shift. Step navigation remains usable. Once interactive, regular drag/zoom rendering and idle vector capture do not re-show the spinner. A changed model resets readiness; failure/timeout releases loading and uses the existing picture fallback; late completions cannot dismiss another model's loading state.


## Validation

- Before/after browser pixel hashes match for Bodo 147, 168, 204 plus Cpoogle Horse, Lotus and Ant (including cyclic stacking).
- Production Pose component browser check: startup spinner, leaving during the solve, reopening, reveal drag and zoom after readiness. This was a focused local harness, not a timed import of the full OSF book.
- 669 tests passed across 59 renderer, layer-spread, capture, Fold integration and Diagram suites. Used four workers and `NODE_OPTIONS=--no-experimental-webstorage` so jsdom supplies localStorage on this Node version. The initial high-concurrency run during the WASM build hit timeouts and Node's unsupported localStorage; the controlled rerun passed. Added tests cover shared buffer ownership, per-context/depth-mode isolation, first-frame readiness, failures, stale completions, navigation and inactive Pose.
- Normal production build (including WASM hooks and 37 prerendered pages) passed.
- Rust/native/oracle suites are not rerun: no engine, shell or file semantics changed.

- Web lint, TypeScript, translation integrity and diff checks passed. Final loading gestures and worker readiness were rechecked after review, including avoiding a React commit for every live bitmap. The final TS/catalog revision was rebundled and prerendered using the freshly rebuilt WASM artifacts.
