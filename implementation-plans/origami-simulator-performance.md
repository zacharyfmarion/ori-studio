# Origami Simulator Performance Overhaul

## Goal

Take Ori Studio's origami simulator from "freezes the tab on a medium model" to a
world-class interactive folding simulator: 60fps UI at all times, models of
50k+ vertices interactive, and hundreds of solver steps per frame — by porting
upstream's GPU solver faithfully, rather than by incrementally optimising the
CPU port we currently have.

### Measured starting point

Miura-ori grids, triangulated, `foldPercent: 60`, Node/V8 (Apple Silicon).
Reproduce with the Phase 0 bench harness.

| model  | vertices | faces  | ms/solver-step |
| ------ | -------- | ------ | -------------- |
| small  | 289      | 512    | 1.05           |
| medium | 1,089    | 2,048  | 4.9            |
| large  | 3,249    | 6,272  | 15.9           |
| xl     | 6,561    | 12,800 | 32.8           |

Because `simulatorRunConfig.ts` uses **fixed step counts independent of model
size**, one `requestAnimationFrame` callback currently does:

| action                 | steps | 1,089 vertices | 6,561 vertices |
| ---------------------- | ----- | -------------- | -------------- |
| initial settle         | 300   | 1.5 s          | 9.8 s          |
| play tick (one rAF)    | 160   | 780 ms         | 5.2 s          |
| settle tick            | 200   | 980 ms         | 6.6 s          |
| "accurate" settle tick | 900   | 4.4 s          | 30 s           |

The canvas-2D software rasterizer in `SimulatorPanel.tsx` adds a further
15–50 ms per draw (viewport-bound, not model-bound) plus a full
`getImageData`/`putImageData` round trip.

### Targets

| Metric                                | Today       | Phase 1  | Phase 2  |
| ------------------------------------- | ----------- | -------- | -------- |
| Longest main-thread task during play  | 780 ms–30 s | < 8 ms   | < 4 ms   |
| Solver ms/step @ 1,089 v              | 4.9         | 4.9      | ~0.01    |
| Solver ms/step @ 6,561 v              | 32.8        | 32.8     | ~0.02    |
| Render cost (main thread)             | 15–50 ms    | 15–50 ms | ~0       |
| Largest interactive model @ 60fps     | ~300 v      | ~300 v   | ~50,000+ |
| Steps/frame @ 10k v, 60fps            | ~0          | ~0       | 200+     |

Note what Phase 1 does and does not do: it does **not** make the simulator
faster. It makes it *responsive* — the UI stops freezing because physics moves
off the main thread. All of the speed comes from Phase 2. This is deliberate;
see "Why no fast-JS phase" below.

Phase 2 figures are projections from upstream's demonstrated behaviour and
standard GPU throughput reasoning. They are the hypothesis this plan is built
to test, and Phase 0 is designed to test the riskiest part of it first.

### Why no fast-JS phase

An earlier draft of this plan had a Phase 1 that rewrote the CPU solver
zero-allocation. A working prototype exists and is verified at **6.5–8.1×
faster with output identical to one float32 ULP** (5.96e-8 = 2⁻²⁴).

It is not in this plan, because Phase 2 obsoletes it. Shipping an 8× CPU solver
three weeks before a 1000× GPU solver replaces it is two implementations, two
parity surfaces, and two sets of tests for a benefit that expires. The roles it
would have played are covered:

- **Headless / CI / oracle** → `ReferenceSolver` already does this, and is the
  thing we actually want tests pinned to.
- **No-WebGL2 fallback** → `ReferenceSolver` in a worker. Slow, but WebGL2 is
  94.67% global and present in every current major browser, so this path is a
  correctness guarantee, not a performance one.
- **Something shippable soon** → Phase 1 delivers that far more cheaply, by
  moving the *existing* solver off the main thread.

The prototype stays in `bench/` as a measurement artifact and an upper bound on
what CPU optimisation is worth, so the option can be revived cheaply if Phase 2
stalls. It is not productionised, not shipped, and not maintained.

### Why WebGL2 and not straight to WebGPU

WebGPU would be the natural target if it were universally available. It isn't:
**83.63% global, and Firefox desktop still ships it disabled by default**, with
Safari desktop only partial from 26.0. WebGL2 is **94.67%** and fully supported
in every current major browser.

That gap alone rules out WebGPU as a sole backend, but two further points make
WebGL2 the right *primary* target rather than a stepping stone:

- **The desktop shell.** Tauri uses the system webview — WKWebView on macOS,
  WebKitGTK on Linux — and both trail Chrome badly on WebGPU. A WebGPU-only
  simulator would likely not run in Ori Studio's own desktop build.
- **Parity.** Upstream's solver *is* WebGL fragment shaders. Porting to WebGL2
  is close to transliteration and can be gated against upstream directly.
  Porting to WebGPU compute is a re-architecture (fragment passes over textures
  → compute over storage buffers), which is a much weaker parity claim.

So WebGL2 is the destination, not a waypoint. WebGPU appears in this plan only
as a **conditional, deferred** optimisation (Phase 3), to be built if and only
if measurement justifies it after Phase 2 ships.

### Relationship to upstream

Upstream (`amandaghassaei/OrigamiSimulator`, MIT, commit `7855983`) is **not a
library**. It has no `package.json`, no module exports, and `dynamicSolver.js`
alone contains 97 references to a browser-global `globals` object; the solver
shaders live inside `<script>` blocks in `index.html`. It is a monolithic page
app built on jQuery, bootstrap, flat-ui, dat.gui, a bundled old three.js and
WebVR, which owns the document, the canvas, the camera and the entire UI.

So this package is not a reimplementation-for-its-own-sake — it exists because
the solver had to be extracted from that app to be embeddable. What we traded
away in the extraction was upstream's GPU solver, which is the entire
performance thesis of the Ghassaei/Demaine/Gershenfeld paper. **This plan is how
we pay that back**, by porting those shaders directly.

Vendor upstream into `third_party/` alongside `treemaker-5.0.1`, `oriedita`,
`flat-folder` and `box-pleating-studio`. Right now this port has **no reference
source in-tree**, a gap against the repo's own porting discipline in `AGENTS.md`
("the canonical behavioural reference is `third_party/...`"). MIT licensing
makes this straightforward.

**Upstream's data layout is already CSR.** Verified in
`js/dynamic/dynamicSolver.js`: `meta = [beamMetaIndex, numBeams,
nodeCreaseMetaIndex, numCreases]` and `meta2 = [nodeFaceMetaIndex, numFaces]` —
an offset and count per node indexing into flat `beamMeta` / `nodeCreaseMeta` /
`nodeFaceMeta` textures. This is good news twice over: the faithful port and the
unbounded-valence design are the same design, so there is no tension between
parity and handling the high-degree vertices that TreeMaker-generated crease
patterns produce.

### Feature parity with upstream

Ported today: the dynamic solver (Euler + Verlet), FOLD ingest, triangulation,
crease parameters, strain.

Upstream capabilities **not** ported. Scope decided 2026-07-23: **GPU solver
only.** The rest are separate simulation modes rather than parts of the
interactive folding path, so none of them block or belong in this plan.

| Upstream | What it is | Status |
| --- | --- | --- |
| GPU solver (`GPUMath.js` + `index.html` shaders) | The performance thesis | **Phase 2 — in** |
| `rigidSolver.js` (225 lines) | Rigid-origami (Tachi-style) solve | Out — own plan if wanted |
| `staticSolver.js` (285 lines) | Static equilibrium solve | Out — own plan if wanted |
| `curvedFolding.js` (2,882 lines) | Curved creases, ruling-aware triangulation | Out — own plan if wanted |
| `importer.js` | SVG / OPX / CP import | Out — this app already imports these |
| `saveSTL.js`, `saveFOLD.js` | Mesh export | Out — overlaps existing export |
| `VRInterface.js`, `videoAnimator.js` | WebVR, video capture | Out |

Capabilities **we** have that upstream lacks: FOLD-in/frame-out library API,
TypeScript types, headless Node testability (upstream needs a browser + GPU,
which is why it has no tests), per-crease fold profiles, segment simulation,
and sequence-step simulation. These are what the GPU port must not regress.

### If you want self-intersection anyway

Verified against upstream at commit `7855983`: there is **no** collision,
self-intersection, layer-ordering or penetration code anywhere in `js/` or
`index.html`. The only `faceOrder` hits are winding-direction fixes. Upstream's
model is axial + crease + face constraints only, and the paper passes through
itself. Adding collision is therefore *beyond* upstream parity, not part of it.

It is a legitimate thing to want — the paper passing through itself is the most
obvious "this isn't real" artifact. It is simply a much larger project than
everything else here combined (it is open research). Two things make it more
tractable in this repo than elsewhere:

- `third_party/flat-folder` (Jason S. Ku) already computes valid **layer
  orderings** for flat-foldable crease patterns, and is already vendored.
- Phase 2 puts the whole state on the GPU, where broad-phase collision fits
  naturally.

Recommendation: land Phases 0–2 first, then scope self-intersection as its own
plan on top of the GPU backend. Doing it before the GPU work means building it
twice.

### Non-goals

- **Changing the physics.** Every phase must reproduce upstream's behaviour.
  This is a performance project, not a modelling project.
- **Stepping-stone implementations.** Nothing gets built that a later phase is
  already scheduled to delete. Where two phases would touch the same code path,
  they merge (see Phase 2, which is deliberately solver *and* renderer).
- **A Rust/wasm solver.** See "Deferred: the Rust core question".
- **Self-intersection / layer ordering.** Above.

## Approach

### The seams

1. **`SolverBackend`** — `ReferenceSolver` (CPU, headless, the oracle) and
   `WebglSolver` (GPU, the product path) behind one interface, selected by
   capability detection with a user override.
2. **The GPU context boundary.** In Phase 2 the solver and renderer share a
   single WebGL2 context on an `OffscreenCanvas` in a worker. This is not
   incidental — it is what allows positions to never touch the CPU, which is
   where nearly all of the speed comes from.

Note there is no separate renderer seam in the way the earlier draft had it.
That draft built a renderer reading positions from a `SharedArrayBuffer` and
then rewrote it in the next phase to read from a GPU texture. That rewrite is
exactly the throwaway work this plan is structured to avoid, so the renderer is
built once, against the texture.

### The oracle discipline

This is what makes an aggressive GPU port safe. The repo already runs a C++
TreeMaker oracle for engine parity; same discipline here, with **two** oracles.

**`ReferenceSolver` is the local oracle.** The current `DynamicSolver` is
renamed, frozen, and documented as the behavioural definition. Never optimised
again. Pure TypeScript, runs headless in Node.

**Upstream itself is the stronger oracle**, and it is what turns "exact parity
with upstream" from an aspiration into a gate: drive the vendored upstream app
in Playwright, run its GPU solver on our fixtures, capture positions as golden
traces. Then `ReferenceSolver` is validated against *the original* rather than
against its own past behaviour.

Do this in Phase 0, before any porting, because it answers two questions we
would otherwise be guessing at:

- **Does our TypeScript port already diverge from upstream?** Nobody had ever
  checked. **Answered 2026-07-23: no.** Across all 9 non-degenerate fixtures the
  triangulated topology matches exactly (same vertex count, no mismatches) and
  step-1 divergence is exactly one float32 ULP. The port is faithful, so
  everything built on it starts from a sound base.
- **What CPU-vs-GPU tolerance is actually achievable** for this algorithm? See
  the measured table under Tier C below.

Upstream's `saveFOLD.js` gives a clean extraction path, so this needs no
patching of its internals; fixture injection goes through its file-import path.

**Three tolerance tiers:**

- **Tier A — bit-tight (≤ 1 float32 ULP).** Same arithmetic, same order,
  different layout. Applies to any CPU-side refactor.
- **Tier B — numerically close (≤ 1e-5 after 1,000 steps).** Reassociated
  arithmetic or different transcendental implementations.
- **Tier C — behaviourally equivalent.** GPU backends. Vendor `atan2`/`acos`
  differ in the last bits, accumulation order is nondeterministic, and the
  crease-angle unwrap can amplify a ULP into a 2π branch divergence. Bit
  comparison is meaningless; instead assert divergence stays under the measured
  threshold and all invariants below hold.

  **Measured 2026-07-23** (`npm run bench:upstream-parity`, ReferenceSolver vs
  upstream's GPU solver, 9 non-degenerate fixtures, `foldPercent: 60`):

  | steps | worst max-abs divergence |
  | --- | --- |
  | 1 | 5.96e-8 (exactly 1 float32 ULP) |
  | 10 | 9.54e-7 |
  | 100 | 8.94e-6 |
  | 1000 | 1.42e-5 |

  Two things this settles. First, **divergence saturates**: 10× more steps from
  100 to 1000 buys only 1.6× more divergence, because the damped system is
  dissipative and pulls trajectories back together rather than amplifying
  chaotically. A fixed threshold over a long horizon is therefore meaningful,
  which is what makes Tier C viable at all. Second, step-1 divergence being
  exactly one ULP means the two implementations are doing identical arithmetic —
  the growth is float32 storage, not an algorithmic difference.

  A second sweep (`npm run bench:unwrap-spike`, 54 configurations across
  `foldPercent` 80/99/100 and 200/1000 steps) pushed the worst case to
  **1.30e-4** — fully-folded creases over long horizons drift slightly further
  than the `foldPercent: 60` sweep above.

  **Tier C threshold: 1e-3.** Set from the 1.30e-4 worst case with ~8× headroom,
  and still two orders of magnitude below the 1e-2 catastrophe threshold, so the
  gate can distinguish float32 noise from a real 2π flip. Re-derive with both
  commands if the fixture set changes.

**Backend-independent invariants** — property tests that catch what tolerance
checks miss:

- **Determinism within a backend.** Same input twice → identical output.
  (Nondeterminism *across* vendors is expected; *within* a run it is a bug.)
- **Energy monotonicity.** `foldPercent` static, `damping > 0` → total energy
  non-increasing. Catches integrator sign errors that tolerance tests pass.
- **Symmetry preservation.** Symmetric CP folds symmetrically. Catches gather
  and indexing bugs that scramble a subset of vertices.
- **No NaN, no Inf, ever.** Currently papered over by scattered
  `Number.isFinite` guards; those become assertions in test builds.
- **Rest state is a fixed point.** `foldPercent: 0` from flat → zero
  displacement.

**Fixture set** — must include the shapes that break things:

- `book-fold` (existing, 4 vertices — smoke test)
- Miura grids at 8×8 / 32×32 / 80×80 (scaling curve)
- a real TreeMaker-generated CP (the actual product workload)
- a bird base (irregular valence, non-grid topology)
- a box-pleated CP (high crease density — stress case)
- degenerate cases: zero-area faces, boundary-only edges, an edge incident to
  more than two faces, a very high-valence vertex, a disconnected component

### Scheduling: budget, not step counts

`stepsPerFrame: 100` is the root design bug, and it is **backend-independent** —
a GPU solver driven by `foldChangeSettleBatch: 900` on a huge model still
stalls. A 10× bigger model should converge 10× slower in wall-clock, not produce
a 10× longer frame.

Replace fixed counts with a `SimulationClock` owning a per-tick **time budget**,
**convergence detection** (max |velocity| and max |Δposition| below epsilon) so
settling stops when settled rather than after a fixed frame count, and **step
accounting** so the UI can report steps/sec and convergence honestly.

---

## Phase 0 — Oracles and baselines

Land measurement and reference infrastructure before changing behaviour, so
every later claim is measured rather than asserted. This phase also front-loads
the single biggest technical risk in the plan (§0.4).

Working benchmarks already exist in the session scratchpad
(`sim-perf/`) and should be productionised into
`packages/origami-simulator/bench/`.

### 0.1 Benchmarks

Fixture generators, `npm run bench:sim` with committed baseline JSON, a
browser-side end-to-end frame benchmark (Node timings miss `getImageData`, style
recalc, compositing), and a `longtask` PerformanceObserver harness — the metric
the user actually feels.

### 0.2 Vendor upstream

`third_party/origami-simulator` at commit `7855983`, with a
`README.treemaker.md` like the other vendored trees. Repoint `provenance.ts` and
`NOTICE` at the in-tree path.

### 0.3 Upstream oracle harness

Playwright-driven upstream, fixture injection via its import path, extraction
via `saveFOLD`. Then: check the existing port against upstream for the first
time, fix any divergence found, and derive the empirical CPU-vs-GPU tolerance
that sets the real Tier C threshold.

### 0.4 De-risk `thetaCalc` before committing to Phase 2 — RESOLVED, GO

The known hazard in the whole plan is the crease-angle unwrap:

```js
if (diff < -5) diff += TWO_PI;
else if (diff > 5) diff -= TWO_PI;
```

Vendor differences in `atan2` near that branch boundary can flip a crease by a
full turn — a *visible catastrophic* divergence, not a small numerical one.

**Resolved 2026-07-23 by `npm run bench:unwrap-spike`: go.** The upstream oracle
turned out to make this directly measurable without writing any new shader code,
because upstream *is* the GPU implementation of this exact pass. A 2π flip would
show as divergence of order the moment arm (~1e0); the noise floor is ~1e-5.

54 configurations — every non-degenerate fixture × `foldPercent` 80/99/100
(putting target angles at and just off the ±180° branch cut, where theta is
pinned to the branch) × 200 and 1000 steps. Worst observed divergence
**1.30e-4**, i.e. 77× below the 1e-2 catastrophe threshold. No flips anywhere.

**Caveat, deliberately not papered over:** this is one GPU — Apple Silicon via
Chromium/ANGLE-Metal. Cross-vendor (NVIDIA, AMD, Intel, Mali/Adreno) is
unverified and cannot be verified on this machine. The spike is committed and
runs anywhere, so re-run it on other hardware when available; the CI SwiftShader
job (§2.7) gives a second, different implementation cheaply. Treat a
catastrophic result there as a real finding, not a flaky test.

## Phase 1 — Unblock the main thread

Small, cheap, and **entirely carried forward into Phase 2** — the worker shell,
control plane, scheduler and panel decomposition are all backend-independent.
It fixes the reported symptom in days rather than weeks, and it de-risks the
plan: if Phase 2 stalls on §0.4, the simulator is responsive rather than frozen
in the meantime.

It runs the **existing** `ReferenceSolver`. It does not make anything faster.

### 1.1 `SolverBackend` seam

```ts
interface SolverBackend {
  step(count: number): void;
  setFoldPercent(percent: number): void;
  setFoldProfile(profile: FoldProfile | null): void;
  setMaterial(options: Partial<SimulatorOptions>): void;
  reset(): void;
  readPositions(into: Float32Array): void;
  readDiagnostics(): SimulatorDiagnostics;
  dispose(): void;
}
```

`ReferenceSolver` implements it; `WebglSolver` joins in Phase 2. The existing
`OrigamiSimulatorController` surface is preserved so `SimulatorPanel` keeps
working throughout.

### 1.2 `SimulationClock`

Budget scheduling and convergence detection as above. Replaces
`initialSettleSteps` / `foldChangeImmediateSteps` / `foldChangeSettleBatch` /
`foldChangeSettleFrames` / `foldPlayStepBatch` in `simulatorRunConfig.ts`. Keep
`fast`/`accurate` as *quality* settings (timestep scale, convergence epsilon)
rather than step counts.

### 1.3 Worker

- `apps/web/src/workers/simulatorWorker.ts` +
  `store/workspaceStore/simulatorRuntime.ts`, following the comlink pattern of
  the five existing workers.
- **Control plane:** comlink (`loadModel`, `setFoldPercent`, `setMaterial`,
  `setFoldProfile`, `reset`, `run`, `pause`).
- **Data plane: keep it simple.** Transferable `ArrayBuffer` double-buffering.
  Phase 2 eliminates the CPU→main-thread position path entirely, so this
  transport only ever serves the no-WebGL2 fallback. Do **not** build the
  SharedArrayBuffer triple-buffer here; revisit only if the CPU path turns out
  to be long-lived. (COOP/COEP are already set in `vite.config.ts` and
  `public/_headers`, so SAB is available if it is ever wanted.)
- **`prepareFoldModel` moves into the worker** — it is O(n) heavy (earcut
  triangulation, edge indexing) and currently runs on the main thread. Only the
  FOLD document crosses.

### 1.4 Panel decomposition

`SimulatorPanel.tsx` is 1,564 lines mixing model preparation, solver driving, a
complete software renderer, and UI. Split into a `useSimulatorRuntime` hook
(worker lifecycle, play/pause), an isolated render module (replaced wholesale in
Phase 2), and UI. Must not regress segment simulation, sequence-step simulation,
the prepared-model cache, or the fast/accurate control — **write tests for
those paths before the refactor, not after**.

### Phase 1 exit criteria

- No main-thread task exceeds 8 ms during play on the 6,561-vertex fixture.
- Golden traces and invariants pass against `ReferenceSolver`.
- Segment and sequence-step simulation verified unchanged.

## Phase 2 — The GPU port (WebGL2)

Split into two sub-phases:

- **2a — GPU solver. DONE.** Built to fit the Phase 1 worker: the solve runs on
  an `OffscreenCanvas` WebGL2 context *inside the worker*, positions read back
  there and transferred to the main thread for the canvas-2D renderer.
- **2b — GPU renderer, in the worker, zero-readback. CURRENT.**

**Decision (2026-07-23): build the renderer directly in the worker, sharing the
solver's GL context, rather than a main-thread renderer first.** An earlier draft
had 2b as a main-thread WebGL renderer and 2c as a later move into the worker.
That is throwaway rework — the vertex path (attribute upload vs `texelFetch`) and
the host (main thread vs worker) both change between them. Going straight to
render-in-worker delivers both wins in one build: rendering leaves the software
rasterizer (fixes orbit/zoom), *and* positions never touch the CPU (removes the
per-frame readback+transfer during play). Performance is the priority and the
extra complexity is accepted.

Honest calibration of the wins, so they are not oversold:

- **Off the software rasterizer** is the large, felt win — it fixes the reported
  orbit/zoom jank and general render slowness. Orbit/zoom need no new positions,
  so they become a re-draw with a new camera uniform, near-free at any size.
- **Zero-readback** is an *incremental* steady-state win on top: it removes one
  `readPixels` stall + one transfer + one re-upload per frame **during play/fold
  only** (orbit/zoom already have the positions on the GPU). Real, worth having,
  largest at high vertex counts — but not a 10× of everything, and an earlier
  note calling it that was wrong.

### Why the renderer is the bottleneck (evidence, 2026-07-23)

User report after 2a shipped: "still slow to zoom and rotate, slow in general on
larger CPs." This is the decisive clue. **Zoom and rotate do not run the solver
at all** — `handleCanvasPointerMove` and `handleCanvasWheel` only update the
camera and call `drawCurrentFrame`. So the jank is entirely the renderer: every
mouse-move during an orbit runs the full canvas-2D software rasterizer
(`projectPositions` → `triangleOrder` sort → per-pixel `rasterizeDepthTriangle`
→ `getImageData`/`putImageData`), 15–50 ms per event on a large CP at 2400×1200
device pixels.

The GPU solver did nothing for this because the solver was never what made
camera manipulation slow. This is exactly what 2b targets.

### 2a — GPU solver (DONE)

A direct, verbatim port of upstream's five shader blocks
(`normalCalc` → `thetaCalc` → `updateCreaseGeo` → `velocityCalc` →
`positionCalc`) on WebGL2 float textures, CSR topology matching upstream's
layout, parity-gated against ReferenceSolver at 1.79e-7 in real Chromium. Lives
in `src/webgl/` (`glCore`, `passes`, `packing`, `webglSolver`), selected by the
worker's backend ladder. See the checklist for the exact done/remaining split
(Euler done; Verlet remains).

### 2b — GPU renderer, in the worker, zero-readback

The renderer moves into the worker and shares the solver's single WebGL2
context, so there is one context and it lives on the **visible** canvas:

- The panel creates the canvas and hands it to the worker via
  `transferControlToOffscreen()`. The worker's `GlCore` is created on that
  canvas, not the current throwaway 2×2 one.
- The solver's compute passes render to their FBOs (off-screen textures) exactly
  as now. A new **render pass** draws to the default framebuffer — the visible
  canvas — reading vertex positions straight from the solver's `u_lastPosition`
  texture via `texelFetch(u_lastPosition, ...)` on `gl_VertexID`, adding
  `originalPosition`. Positions never leave the GPU: no `readPixels`, no
  transfer, no re-upload.
- The main thread keeps ownership of interaction. Camera (orbit/zoom), view
  settings, highlights, palette and canvas size are forwarded to the worker over
  comlink; the worker re-issues the render pass. A camera-only change runs no
  solver work and no readback — just one draw call — which is the fix for the
  reported jank.

Everything the software rasterizer does by hand comes free or nearly free:

- **Depth buffer replaces the painter's-algorithm sort** — `triangleOrder` and
  its per-face allocation + `reduce`-in-comparator disappear.
- **Two-tone paper** via `gl_FrontFacing`; **lighting** and **normals** in the
  fragment shader (screen-space derivatives), no CPU normal pass.
- **Edges** as a `LINES` draw with `polygonOffset`; hidden-line mode a second
  pass with an inverted depth test — cheaper and more correct than the current
  depth-surface probe.
- **X-ray** via alpha blend with depth write off.
- **Highlights** and **strain colours** as per-crease/vertex data the render pass
  samples; strain becomes a GPU quantity rather than a CPU walk.
- **Real orbit camera** with projection matrices, replacing the hand-rolled
  yaw/pitch projection. (The per-frame `getComputedStyle`/`getBoundingClientRect`
  stalls were already removed in the committed `perf(simulator): stop re-reading
  layout, style and fit every frame`.)

Reference model to follow for the WebGL2 host and draw structure: the existing
`apps/web/src/cp-workspace/renderer/` (regl). The solver's `GlCore` already has
the context, program and texture machinery, so the render pass is added there
rather than via a second library.

**Sequencing that keeps the tree working at each commit:**

1. Add the render pass + camera to `GlCore`/`WebglSolver`, still on the 2×2
   canvas, and parity-check geometry headlessly (projected vertex positions vs
   the CPU projection) — tool-checkable.
2. Add the `transferControlToOffscreen` plumbing and the camera/settings comlink
   surface; render to the visible canvas behind a flag, canvas-2D still default.
3. Flip the default to WebGL once the user confirms the visual result and
   orbit/zoom smoothness in a visible window; delete the canvas-2D rasterizer and
   adopt-or-delete `three.ts`.

Also enables **async diagnostics**: max/average strain as a reduction pass to a
1×1 texture, read via `fenceSync` + PBO every K frames — never a synchronous
`readPixels`, which would reintroduce the stall this phase removes.

### 2b verification

The renderer's output is pixels, which the headless automation pane cannot
verify (hidden → rAF throttled to zero, no reliable pixel readback). Two layers:
tool-checkable here (compiles, no GL errors, geometry/projection parity vs the
CPU path, canvas-2D fallback intact); visual result and orbit/zoom smoothness by
the user in a visible window. Because this path is worker-hosted and cannot be
smoke-tested from the panel test, the render pass must expose a headless
geometry check (project a fixture's vertices through the camera and compare to
the reference projection) so a regression is caught without eyes.

### GPU testing note

Headless WebGL2 in Node is not practical (`headless-gl` is WebGL1 and
unmaintained). GPU parity is tested in real Chromium via Playwright (Phase 0's
harness) — already in place for the solver (`bench:gpu-parity`).

### Phase 2 exit criteria

- **2a:** Tier C parity against the reference/upstream oracle across the fixture
  set (done: 1.79e-7). Automatic, tested fallback when WebGL2 is absent (done).
- **2b:** orbit/zoom on a large CP is smooth (user-verified); geometry/projection
  parity vs the CPU path passes headlessly; zero synchronous readbacks in the
  steady-state loop; canvas-2D rasterizer deleted once the WebGL path is
  confirmed; visual checklist passes: paper/x-ray, faces, edges, hidden lines,
  lighting, highlights, strain colours, segment highlighting; verified on the
  Tauri WKWebView.
- **Stretch:** 10k-vertex model sustains 200+ steps/frame at 60fps.

## Phase 3 — WebGPU (conditional, deferred)

**Not scheduled.** Build only if, after Phase 2 ships, measurement shows the
WebGL2 backend is the bottleneck *and* WebGPU availability has improved enough
to be worth a second GPU backend (today: 83.63%, Firefox desktop disabled by
default, Tauri's system webviews trailing).

If those conditions are met, the work is additive rather than a rewrite, because
the seams from Phases 1–2 already isolate the backend:

- Compute shaders replace fragment passes; storage buffers replace textures. The
  CSR arrays map directly onto storage buffers.
- Many solver steps per submit, eliminating per-pass fullscreen-quad and
  state-change overhead — the dominant remaining cost at small model sizes.
- Zero-copy render interop: the position storage buffer *is* the vertex buffer.
- Timestamp queries for true per-pass GPU profiling.

Exit criterion if built: measurably beats WebGL2 on the large fixtures. **If it
doesn't, keep WebGL2 as the default and say so** — the ladder makes that a cheap
outcome, and reporting it honestly is the point of having measured.

---

## Deferred: the Rust core question

A Rust/wasm solver would buy perhaps 2–4× over an optimised JS solver — and far
less than the GPU path, on a workload this parallel. It also costs a copy at
every wasm↔JS boundary unless positions stay in wasm memory.

Where it *would* earn its keep is architectural: putting the solver in
`treemaker-core` would let the CLI, oracle tests, and the Tauri desktop shell
share one implementation, and would give a deterministic reference faster than
the TypeScript one. That is a real argument — but architectural, not
performance, and it should be decided on its own merits rather than smuggled in
as a performance fix. Recorded so the option isn't silently lost.

## Risks

| Risk | Mitigation |
| --- | --- |
| GPU `atan2` divergence flips crease angles by 2π | **Phase 0.4** — spiked before anything is built on it, not discovered late |
| Our existing port already diverges from upstream | **Phase 0.3** — checked for the first time, before porting on top of it |
| Tier C tolerance guessed wrong | **Phase 0.3** — measured from real upstream CPU-vs-GPU runs |
| GPU parity untestable in CI | Phase 0's Playwright harness is the same infrastructure; cost paid once |
| Phase 2 stalls, leaving nothing shipped | Phase 1 is independently shippable and fixes the reported symptom |
| WebGL2 absent on some target | `ReferenceSolver` worker fallback, capability-detected and tested |
| Tauri webview GL quirks | Test the desktop shell explicitly in Phase 2, not at the end |
| Panel decomposition regresses segment/sequence simulation | Tests for those paths land **before** the refactor (§1.4) |

## Affected Areas

**`third_party/`**

- `origami-simulator/` — new: vendored upstream at `7855983` (MIT)

**`packages/origami-simulator/`**

- `src/dynamicSolver.ts` → `src/referenceSolver.ts` (frozen oracle)
- `src/solvers/` — new: `SolverBackend`, `webglSolver.ts`
- `src/simulationClock.ts` — new: budget scheduling + convergence
- `src/gpuMath.ts` — vestigial today; becomes the real WebGL2 layer
- `src/shaders.ts` — a solid-colour clear today; becomes the ported solver passes
- `src/render/` — new: GL renderer reading from the position texture
- `src/model.ts`, `src/prepare.ts` — CSR precomputation, fused diagnostics
- `src/three.ts` — dead code; adopt in Phase 2 or delete
- `bench/` — new: fixtures, benchmarks, baselines, the unshipped fast-solver prototype
- `tests/` — golden traces, tolerance tiers, invariant property tests

**`apps/web/src/`**

- `components/panels/SimulatorPanel.tsx` — decomposed; software rasterizer deleted
- `simulator/` — new: runtime hook, canvas host
- `workers/simulatorWorker.ts`, `store/workspaceStore/simulatorRuntime.ts` — new
- `lib/simulatorRunConfig.ts` — step counts → budgets and quality settings
- `lib/preparedModelCache.ts`, `lib/sequenceSimulation.ts`, `lib/simulatorOrbit.ts` — follow the new seams

**Cross-cutting**

- New UI strings (backend indicator, steps/sec, convergence) need the full i18n
  flow per `apps/web/CLAUDE.md`: inline English → `i18n:extract` → translate all
  8 locales → `i18n:stamp` → `i18n:check`.
- CI gains a browser-test job (Phase 0 harness, reused for Phase 2 parity).

## Checklist

### Phase 0 — Oracles and baselines

- [ ] Productionise scratchpad benchmarks into `packages/origami-simulator/bench/`
- [ ] Fixture generators: Miura, box-pleat, bird base, degenerate cases
- [ ] Add a real TreeMaker-generated CP fixture
- [ ] `npm run bench:sim` with committed baseline JSON
- [ ] Browser-side end-to-end frame benchmark page
- [ ] `longtask` PerformanceObserver assertion harness
- [ ] Vendor upstream into `third_party/origami-simulator` (MIT, `7855983`) with `README.treemaker.md`
- [ ] Repoint `provenance.ts` / `NOTICE` at the in-tree path
- [ ] Playwright upstream-oracle harness (fixture injection + `saveFOLD` extraction)
- [ ] **Check the existing port against upstream** — first time ever; fix divergence before building on it
- [ ] Derive the empirical CPU-vs-GPU tolerance; set the real Tier C threshold
- [ ] **Spike `thetaCalc` unwrap on real hardware across vendors**; decide and document any deviation
- [ ] Go/no-go on Phase 2 based on the spike

### Phase 1 — Unblock the main thread

- [ ] Rename `DynamicSolver` → `ReferenceSolver`; document as the oracle
- [ ] Generate and commit golden traces at steps {1, 10, 100, 1000}
- [ ] Invariant property tests: determinism, energy, symmetry, NaN-freedom, rest fixed point
- [ ] Define `SolverBackend`; adapt `ReferenceSolver` to it
- [ ] `SimulationClock`: time budget + convergence detection
- [ ] Replace fixed step counts in `simulatorRunConfig.ts` with budgets/quality
- [ ] Tests for segment + sequence-step simulation (**before** the refactor)
- [ ] `simulatorWorker.ts` + `simulatorRuntime.ts` (comlink control plane)
- [ ] Transferable double-buffer data plane (explicitly *not* the SAB triple-buffer)
- [ ] Move `prepareFoldModel` into the worker
- [ ] Decompose `SimulatorPanel.tsx`: `useSimulatorRuntime`, render module, UI
- [ ] Exit gate: no main-thread task > 8 ms on the xl fixture during play

### Phase 2a — The GPU solver (WebGL2) — DONE

- [x] WebGL2 + `EXT_color_buffer_float` capability detection (`glCore`)
- [x] Port `GPUMath.js` semantics into a ping-pong FBO layer (`glCore`, not the vestigial `gpuMath.ts`)
- [x] Pack state textures; pack CSR topology (`meta` / `meta2` + neighbour textures) (`packing`)
- [x] Port `normalCalc`, `thetaCalc` (ping-ponged), `updateCreaseGeo`, `velocityCalc`, `positionCalc` — verbatim from upstream (`passes`)
- [x] `WebglSolver` implements `SolverBackend`; runs the five-pass solve loop
- [x] **Parity gate: worst 1.79e-7 vs ReferenceSolver across 9 fixtures, ULP-level** (`bench:gpu-parity`, real Chromium)
- [x] Backend ladder + `preferGpu` override + GPU/CPU indicator in the panel (i18n across 8 locales)
- [x] Runs on `OffscreenCanvas` in the worker; WebGL2 + float FBO confirmed working there (ANGLE Metal)
- [ ] Port both Verlet variants + parity gate (Euler only so far; Verlet falls back to reference)
- [ ] Async diagnostics reduction (`fenceSync` + PBO) — currently a sync readback per frame in the worker

### Phase 2b — GPU renderer, in the worker, zero-readback — DONE

One WebGL2 context on the visible canvas, shared by solver and renderer; the
render pass reads positions from the solver's `u_lastPosition` texture via
`texelFetch`, so they never touch the CPU. Fixes orbit/zoom (off the software
rasterizer) and removes the per-frame readback+transfer in one build — no
main-thread-renderer intermediate to throw away.

Step 1 — render pass:
- [x] Render program + real orbit camera (projection in the vertex shader) in `GlCore`/`meshRenderer`
- [x] Vertex shader `texelFetch`es `u_lastPosition` (+ `originalPosition`) by `gl_VertexID` — no readback
- [x] Depth buffer replaces painter's sort; `triangleOrder` gone (depth on the canvas context, fixed post-launch)
- [x] Shader normals (screen-space derivatives), `gl_FrontFacing` two-tone, fragment lighting
- [x] Creases coloured by assignment (M/V/B) as thick screen-space ribbons; facet/triangulation edges dropped
- [x] X-ray (alpha + depth-write off); strain as a GPU quantity (from the velocity texture's error channel)
- [x] **Headless render-coverage check** in `bench:gpu-parity` (compile + non-degenerate silhouette)

Step 2 — worker plumbing:
- [x] Panel hands the canvas to the worker via `transferControlToOffscreen()`; `GlCore` binds it
- [x] Camera/view-settings/size/palette forwarded over comlink; worker re-issues the render pass
- [x] Palette on theme change; size from `ResizeObserver`

Step 3 — cut over:
- [x] User-verified: performance "hilariously better"; depth occlusion correct; creases legible
- [ ] Verify on the Tauri WKWebView explicitly (in progress — the GPU-vs-CPU badge tells which path engaged)
- [x] GPU is the default when supported; `three.ts` deleted (unused)
- [x] **Deviation: the canvas-2D rasterizer is kept as the no-WebGL2 fallback**, not deleted. It is the only
      renderer for the ~5% without WebGL2 float (and any WKWebView that lacks it); deleting it would blank
      their canvas. Feature-frozen, reached only when the GPU path is unavailable.
- [ ] Async diagnostics reduction (`fenceSync` + PBO) — deferred; the per-tick velocity readback already
      yields strain, and it has not shown up as a cost. Revisit only if profiling flags it.
- [ ] Stretch gate: 10k vertices at 200+ steps/frame, 60fps — not formally measured; the perf instrumentation
      is in place to check on demand.

Remaining perf tuning that landed here (found via the instrumentation, see the git log): the GPU tick is
bounded by a fixed step count, not a CPU-time budget (a CPU budget over-queues async GPU work that the
convergence readback then flushes in one stall), and the readouts are throttled off the 60fps re-render path.

### Phase 3 — WebGPU (only if measurement justifies it)

- [ ] Re-evaluate WebGPU availability and Tauri webview support
- [ ] Confirm from Phase 2 profiling that the WebGL2 backend is the bottleneck
- [ ] If both hold: storage buffers, compute pipelines, multi-step submit, timestamp queries
- [ ] Benchmark vs WebGL2; **keep WebGL2 as default if it doesn't win, and say so**

### Cross-cutting

- [ ] i18n flow for all new strings (extract → translate 8 locales → stamp → check)
- [ ] `PORTING.md` / package README updated with the backend architecture and oracle discipline
- [ ] Benchmark baselines refreshed at each phase exit
- [ ] CI: bench regression gate + browser parity job
