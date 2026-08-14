# Inline simulation windows swallow the canvas pan

## Goal

A two-finger pan across the Edit canvas must not die when the cursor crosses an
inline simulation window. Today it does: the window takes the wheel, drops it,
and the crease pattern stops moving with nothing on screen to explain why.

## Approach

Root cause, in three steps:

1. `InlineSimulationLayer` gives a window `pointer-events: auto` when it is
   focused **or** when the shared selection overlay is inert
   (`overlayInteractive === false`). That second case is not rare: the panel
   computes `annotationsInteractive = cpToolState.phase !== 'active' || …`, and
   the phase is `active` from the moment any drawing tool is *armed* — so with a
   tool selected, every window on the canvas is taking pointer events.
2. A wheel event goes to the topmost element under the cursor, and there is no
   ancestor relationship between a window and the WebGL canvas — the canvas's
   `wheel` listener is on the canvas element itself. So the pan gesture never
   reaches it.
3. `SimulatorViewport`'s own wheel listener calls `preventDefault()` and then
   returns early unless the viewport is `interactive` (focused **and** the
   runtime is ready). Correctly claimed — nothing behind that canvas wants a
   browser page zoom — but nothing forwards it either. The gesture is dropped.

Every other piece of chrome over this canvas already solves this with
`useWheelPassthrough` (`CanvasObjectOverlay`, `CpTextAnnotationLayer`, the
floating toolbars via their `wheelTarget` prop). The inline simulation window is
the one overlay that never got it. So: attach the same hook to the window root,
resolving to the crease-pattern canvas through `resolveCpViewportCanvas` — the
same resolver `CpTextAnnotationLayer` uses from the same position in the tree.

Gated on the one case where the window legitimately owns the wheel: focused and
ready, where the inner canvas zooms the fold. That claim is deliberate and
matches the folded-figure window (`foldedOrbit.claimsWheel` in
`CreasePatternWebglCanvas`), so it is left alone; passing `undefined` to the hook
is its documented "leave the wheel alone" input.

### Second pass: whose gesture is it

The first pass fixed the silent stall, and left the *focused* window claiming any
wheel that crossed it — matching the folded-figure window. In use that is the
same bug with a different symptom: a pan begun out on the paper turns into a zoom
of a window the cursor was only passing over.

The missing idea is gesture ownership. A drag gets it free from pointer capture;
the wheel is the one input that cannot be captured, because it has no start and
no end — so every event goes to whatever is under the cursor at that instant.

`lib/wheelBurst.ts` supplies it: the first event of a burst fixes the owner, later
events are routed there regardless of the cursor, and the burst ends after the
wheel goes quiet (220ms — the idle bound `useFoldedFigures` already uses for its
zoom-commit, and the only end a wheel has). Three surfaces consult it:

- **The crease-pattern canvas** claims the burst, and forwards to the owner when
  that is someone else — so a zoom begun on a window survives the cursor leaving
  it, the mirror of the case that started this.
- **A focused window's viewport** asks before zooming, through a new optional
  `claimsWheel` prop on `SimulatorViewport` (the Simulate workspace fills its own
  pane, omits it, and is unchanged).
- **The window's passthrough** forwards to whichever surface owns the burst —
  including *another* window, which is why the owner token is the window's canvas
  rather than its frame.

Two things fall out for free. The folded figure's `claimsWheel` hit test is now
decided once per burst, so a pan crossing a focused folded figure keeps panning —
the same complaint, on the other window kind. And `forwardWheel` is one function:
`useWheelPassthrough`'s private wheel-clone moved into the module beside it.

## Affected Areas

- `apps/web/src/lib/wheelBurst.ts` (new) and its test
- `apps/web/src/hooks/useWheelPassthrough.ts` — forwards through the shared helper
- `apps/web/src/cp-workspace/InlineSimulationLayer.tsx`
- `apps/web/src/cp-workspace/InlineSimulationLayer.test.tsx` (new)
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — `onWheel` routing
- `apps/web/src/simulator/SimulatorViewport.tsx` — optional `claimsWheel`

## Checklist

- [x] Root-cause the swallow and confirm which state the report reproduces in
- [x] Attach `useWheelPassthrough` to the window, gated on the window's own claim
- [x] Regression test: wheel over an unclaimed window reaches the CP canvas; over
      a focused ready one it does not
- [x] Wheel-burst ownership so an in-flight gesture keeps its owner
- [x] Route the CP canvas, the window's viewport and the window's passthrough
      through it; decide the folded-figure claim once per burst
- [x] Tests: ownership primitive, pan crossing a focused window, zoom surviving
      the cursor leaving one
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] Draft PR
