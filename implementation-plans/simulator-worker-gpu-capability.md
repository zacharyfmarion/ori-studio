# Simulator worker GPU capability

## Goal

Stop the simulator committing a canvas to a rendering path the worker cannot
actually provide.

Reported from Discord: on Bazzite (Linux → WebKitGTK), the Simulate tab fails
with `InvalidStateError` — *"The object is in an invalid state."* — and inline
simulation windows render blank with no message. Both are the same root cause,
and folded 3D figure windows share it.

Every one of those three surfaces takes an **exclusive, irreversible** context on
its visible canvas *before* knowing whether the worker can render on the GPU:

| Surface | Commitment | When the worker declines |
| --- | --- | --- |
| Simulate tab | `transferControlToOffscreen()` → placeholder | `getContext('2d')` **throws** → the reported error |
| Inline window | `getContext('bitmaprenderer')` | `getContext('2d')` **returns null** → silent blank |
| Folded 3D window | `bitmaprenderer` via the same viewport | silent blank |

The commitment is predicted by `webglRenderSupported()`, which probes
**main-thread** WebGL2 and the mere existence of the `OffscreenCanvas` global.
That is a different question from the one being asked. On WebKitGTK the
main-thread answer is yes and the worker answer is no, so the prediction is
wrong in exactly the environment that matters.

All three surfaces already have a correct fallback (canvas-2D, an explanatory
badge, 2D reprojection). None of them reach it, because the predicate that arms
them is measuring the wrong thread.

## Approach

Ask the worker instead of predicting, and treat the worker's actual answer as
ground truth.

1. **Worker probe.** `probeGpuRender()` on the session API builds a throwaway
   `OffscreenCanvas`, runs the *same* `GlCore.create` predicate `createBackend`
   uses (so the two cannot drift), then disposes it **and releases the GL
   context** — contexts are capped at four per worker, so a leaked probe context
   would evict a live session.

2. **One cached answer, shared by all three surfaces.** A new
   `simulator/workerGpuSupport.ts` owns the cached result, a promise-based
   accessor for async callers, and a `useWorkerGpuSupport()` hook returning
   `boolean | null` (`null` = not yet known) for synchronous ones.

3. **The load result outranks the probe.** If a load was made with `preferGpu`
   and comes back `backend: 'reference'` anyway, the worker has *demonstrated*
   it cannot render — so mark support unsupported and remount a fresh canvas.
   This is what makes recovery loop-free: the retry runs with the cache already
   false, so it takes the CPU path instead of committing another canvas. It also
   covers causes a probe cannot predict (context-cap eviction, driver loss).

`webglRenderSupported()` stays, narrowed to the main-thread question it actually
answers, and is no longer used to decide worker render paths.

Deliberately **not** in scope: main-thread WebGL2 as a middle tier between
worker-GPU and CPU. It would help Linux a lot — main-thread WebGL2 demonstrably
works on the reporter's machine — but the solver and renderer share one GL
context, so it means running the session on the main thread, which is the thing
the worker architecture exists to prevent. Separate piece of work.

## Affected Areas

- `apps/web/src/simulator/simulatorSession.ts` — `probeGpuRender()`
- `apps/web/src/simulator/workerGpuSupport.ts` — new shared capability module
- `apps/web/src/simulator/useSimulatorRuntime.ts` — await the probe before
  committing the canvas; recover when the backend contradicts it
- `apps/web/src/components/panels/SimulatorPanel.tsx` — canvas generation in the
  React key
- `apps/web/src/cp-workspace/InlineSimulationLayer.tsx` — worker-authoritative
  `gpuAvailable`
- `apps/web/src/cp-workspace/folded/useFoldedFigures.ts` — same

## Checklist

- [x] `probeGpuRender()` in the worker session, releasing its context
- [x] `workerGpuSupport.ts` with cache, async accessor, hook, test reset
- [x] `useSimulatorRuntime` awaits the probe before transfer/bitmap attach
- [x] Backend-contradicts-probe recovery marks unsupported and remounts once
- [x] `SimulatorPanel` folds the generation into `canvasKey`
- [x] `InlineSimulationLayer` and `useFoldedFigures` on the shared predicate
- [x] Tests: probe gating, no transfer when unsupported, recovery path
- [x] `npm run lint:web`, `typecheck:web`, `test:web`
