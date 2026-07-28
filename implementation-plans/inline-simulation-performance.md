# Inline Simulation Performance

Follow-on to `inline-simulation-windows.md`, which shipped the feature. This is
about what a profile of it showed.

## Goal

Make the number and size of open simulation windows stop being a performance
variable. Today, zooming the crease pattern with a few windows open stutters,
and the windows themselves fall behind their own solver.

Two independent causes, both measured (see Evidence). Neither is a tuning
problem; both are a value living on the wrong side of a boundary.

The bar: resizing a window, or having several windows at different sizes, should
cost nothing measurable, and a running fold should not re-render the crease
pattern panel.

## Evidence

A 7.2 s production trace (`PROFILE=1` build) while zooming with several windows
open — `perf/traces/sim_scrolling.json.gz`.

| Thread | Busy | Dominated by |
| --- | --- | --- |
| Simulator worker | 78% | `renderGpu`, 88% of it — reached only from `setCamera` |
| GPU process | 75% | — |
| Main thread | 42% | the inline-simulation staleness memo, 901 ms of it |

Inside `renderGpu`, actual GL command submission is **~95 ms of 5.4 s**. Almost
none of the worker's time is spent drawing.

### Cause 1 — the worker reallocates its drawing buffer on every render

`SimulatorViewport.deviceSize()` reports the window's exact size in device
pixels, and `renderGpu` resizes the shared `renderCanvas` to match. During a zoom
that size changes every frame. Worse, every window shares one canvas, so windows
at different sizes thrash it against each other on every message even at a fixed
zoom — which is why this shows up as "a few simulations and it degrades".

Measured in the production page, same context attributes, same draw, three
windows at three sizes, no zooming:

| Architecture | p50 | p95 |
| --- | --- | --- |
| Today: resize the canvas per window | 2.22 ms | 2.99 ms |
| Fixed canvas, sub-viewport, uncropped transfer | 0.00 ms | 0.00 ms |
| **Fixed canvas, sub-viewport, `createImageBitmap` crop** | **0.02 ms** | 0.03 ms |
| Fixed canvas, always render at full size | 0.00 ms | 0.00 ms |

Zooming a single window costs the same 2.19 ms per render — 132 ms/s at 60 fps,
per window.

A trap worth recording: `renderGpu`'s own timer starts *after* the resize, so the
`sim-perf` readout reports a healthy render time and cannot see any of this. The
instrumentation that exists to catch this was blind to it.

### Cause 2 — the fold readout invalidates a document-derived memo at 15 Hz

`InlineSimulationLayer.handleFrame` publishes `foldPercent` to the store every
66 ms. `foldPercent` sits in the same descriptor as the provenance fields, so
that write produces a new `oristudioCpInlineSimulations` array — a dependency of
the `staleIds` memo in `useInlineSimulations`, which then walks every crease in
the document for every window.

29 executions in 7.2 s, 901 ms total (28% of main-thread busy time), including
one 508 ms and one 188 ms stall. Those are the visible stutters.

## Approach

### 1. Decouple the render target from the window

One shared canvas is forced on us: browsers cap WebGL contexts at four per worker
(measured in the parent plan's Phase 0), so windows cannot each have their own.
But that only forces one *context*. Nothing required the drawing buffer to be
resized to whatever is being drawn right now, and that is the whole cost.

So: keep the canvas **grow-only**, sized to the largest render any window has
asked for. Draw each window into a `gl.viewport` of its own size, and crop on the
way out with `createImageBitmap(canvas, x, y, w, h)`. Each window still receives a
bitmap of exactly its own size, with no wasted fill, and the canvas resizes only
when a window exceeds every size seen so far — rare, and bounded.

Window size stops being a performance variable. Resize freely, open as many as
the session cap allows, at any mix of sizes.

Three details that are easy to get wrong:

- **`createImageBitmap` is async** where `transferToImageBitmap` is sync. This
  changes the return type of `renderGpu` and therefore of `setCamera`,
  `setRenderSettings` and the tick path. All of them already cross comlink, so
  callers are async regardless; the change is internal to the worker API.
- **`transferToImageBitmap` implicitly clears the canvas**, and the current code
  relies on that (there is a comment saying so). `createImageBitmap` does not.
  `MeshRenderer.render` already issues `gl.clear`, so this is probably already
  covered — verify rather than assume, and note that `gl.clear` respects the
  scissor box, not the viewport.
- **Y-flip.** GL's origin is bottom-left, the bitmap's is top-left, so the crop
  rect is `(0, canvasHeight - h, w, h)`. Wrong is visible, which is the good kind
  of wrong.

### 2. `foldPercent` out of the store descriptor

`InlineSimulation` currently mixes two kinds of data with different lifetimes:

| | Changes | Fields |
| --- | --- | --- |
| Identity and provenance | when the user acts | `id`, `box`, `z`, `view`, `sourceBoundary`, `sourceBounds`, `sourceFingerprint`, `segmentIdHint` |
| Transport | 15×/s while folding | `foldPercent` |

They share one object in one store array, so every consumer reading the array for
the first reason is invalidated by writes for the second. The staleness memo is
the victim that showed up in the profile; `canvasObjects`, the panel render and
every other descriptor-keyed memo are the same shape.

The architecture already has the right seam. `inlineSimulationRuntime.ts` is a
side table outside the store, and its own doc comment states the rule:

> the descriptor in the store is plain JSON and is exactly what would be written
> to disk if these ever persist … nothing here drives a render, and a fold
> arriving should not re-render the (very large) crease-pattern panel.

That is precisely the rule `foldPercent` violates. Its lifetime fits the side
table too: keyed by simulation id, cleared only on delete or document replace, so
it survives a window losing focus — which is the constraint that put it in the
store in the first place (a blurred window gives up its solver session and
reseeds from this on refocus).

Moving it needs one new thing: the floating toolbar's readout and slider
currently re-render because the store write re-renders the whole panel. They will
need their own subscription to the side table. That is the point of the change —
the 15 Hz re-render collapses from "the entire crease-pattern panel plus every
descriptor-keyed memo" to "one floating toolbar".

### 3. An invariant test, not a dependency list

The narrow version of fix 2 is to key `staleIds` on the provenance fields only.
Rejected as a *standalone* fix: a hand-maintained dependency list is a rule
written where nothing can tell when it is broken. Someone adds a field to
`InlineSimulation`, the memo silently starts recomputing at 15 Hz again, and this
plan gets written a second time.

The guard is a test that asserts the real invariant:

> While a fold is advancing, `oristudioCpInlineSimulations` keeps the same array
> identity.

That is "per-frame work does not write document state", which fails on *any*
reintroduction of the pattern regardless of which field is used, rather than on
one field being forgotten in one array. Structure makes today's bug
unrepresentable; this test is what keeps it that way.

## Affected Areas

- `packages/origami-simulator/src/webgl/meshRenderer.ts` — viewport-relative
  rendering, and confirming the clear covers what the crop reads.
- `apps/web/src/simulator/simulatorSession.ts` — `renderGpu` grow-only canvas +
  crop; async return threaded through `setCamera`, `setRenderSettings`, tick.
- `apps/web/src/simulator/SimulatorViewport.tsx` — no longer needs to think about
  quantising; still reports its true size.
- `apps/web/src/simulator/useSimulatorRuntime.ts` — awaits the bitmap.
- `apps/web/src/cp-workspace/inlineSimulation/inlineSimulation.ts` — `foldPercent`
  leaves the descriptor type.
- `apps/web/src/cp-workspace/inlineSimulation/inlineSimulationRuntime.ts` — gains
  the fold percentage and a subscription.
- `apps/web/src/cp-workspace/inlineSimulation/useInlineSimulations.ts` — no longer
  routes the readout through the store.
- `apps/web/src/cp-workspace/InlineSimulationLayer.tsx` — publishes to the side
  table.
- `apps/web/src/cp-workspace/InlineSimulationInspector.tsx` — subscribes for its
  readout and slider.
- `apps/web/src/store/workspaceStore/slices/creasePatternSlice.ts` — the
  descriptor's create/update path.

## Checklist

### Phase 1 — Worker: decouple the render target from the window

- [ ] Grow-only `renderCanvas`: resize only when a request exceeds the current
      size, never to shrink.
- [ ] Render into `gl.viewport(0, 0, w, h)`; confirm the clear covers the crop
      region (scissor, not viewport).
- [ ] Crop out with `createImageBitmap(canvas, 0, canvasHeight - h, w, h)`;
      thread the async return through `setCamera`, `setRenderSettings`, tick.
- [ ] Move `renderGpu`'s timer to cover the whole function, so `sim-perf` can
      see a regression of this kind next time.
- [ ] Unit test: rendering at several sizes in sequence never shrinks the canvas
      and always returns a bitmap of the requested size.
- [ ] Re-measure: three windows at three sizes, and a fast zoom. Target is the
      0.02 ms row.

### Phase 2 — `foldPercent` out of the descriptor

- [ ] Add the fold percentage + a subscribe/notify to
      `inlineSimulationRuntime.ts`.
- [ ] `InlineSimulationLayer` publishes there instead of calling `onFoldPercent`.
- [ ] `InlineSimulationInspector` subscribes for its readout and slider;
      scrubbing writes to the same place.
- [ ] Refocus still reseeds the solver from the stored percentage (the bug the
      parent plan fixed — do not regress it).
- [ ] Remove `foldPercent` from `InlineSimulation`; update the create path and
      the fixtures.
- [ ] Confirm the descriptor is still exactly what would be persisted, so the
      parent plan's deferred Phase 7 stays an addition rather than a rewrite.

### Phase 3 — Keep it that way

- [ ] Test: while a fold advances, `oristudioCpInlineSimulations` keeps the same
      array identity.
- [ ] Test: `staleIds` is referentially stable across a fold advancing.
- [ ] Capture a fresh trace and record the numbers below the Evidence table.

## Decisions and rejected alternatives

**Quantise the render size to 128 px steps.** The first fix considered, and
initially recommended. It removes the per-frame resize during a zoom (measured:
p50 2.19 ms → 0.00 ms) but not the multi-window case — N windows in N size
buckets thrash exactly as before, just at whatever rate you switch between them.
Zach caught this. Superseded by the sub-viewport approach, which subsumes it and
has no tuning constant to get wrong.

**Restrict window resizing.** Considered as a way to avoid the thrash. Rejected:
it trades a user-facing capability for a problem that turned out to be an
implementation detail, and the capability was requested explicitly.

**Always render at the full canvas size (row D, 0.00 ms).** Simpler than the crop
and stays synchronous. Rejected: every small window then pays the largest
window's fill cost. Free at the benchmark's 4,000 triangles, not obviously free
at a real 14k-vertex mesh, and wasteful in a way that would quietly get worse as
window counts grow.

**Fixed canvas with an uncropped transfer (row B, 0.00 ms).** The bitmap is then
canvas-sized with the content in one corner, so the crop has to happen at present
time — and `bitmaprenderer` takes a whole bitmap and cannot crop. Working around
it means a 2D context and a copy per window, which is worse than the 0.02 ms the
worker-side crop costs.

**Key `staleIds` on the provenance fields only.** Correct as a mechanical step,
rejected as the fix. See Approach §3.

**Give each window its own GL context.** Not available: four contexts per worker,
measured in the parent plan's Phase 0. This constraint is what produced the
shared canvas, and it is worth keeping written down — the shared canvas is not
incidental, but the shared canvas *size* always was.
