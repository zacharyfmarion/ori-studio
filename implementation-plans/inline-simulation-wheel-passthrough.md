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

Not changed: a wheel over a *focused, ready* window still zooms that window's
fold rather than panning the canvas, for either wheel-gesture preference. That is
existing intended behavior shared with folded figures, and changing it is a
product decision rather than part of this bug.

## Affected Areas

- `apps/web/src/cp-workspace/InlineSimulationLayer.tsx`
- `apps/web/src/cp-workspace/InlineSimulationLayer.test.tsx` (new)

## Checklist

- [x] Root-cause the swallow and confirm which state the report reproduces in
- [x] Attach `useWheelPassthrough` to the window, gated on the window's own claim
- [x] Regression test: wheel over an unclaimed window reaches the CP canvas; over
      a focused ready one it does not
- [x] `npm run lint:web`, `npm run typecheck:web`, `npm run test:web`
- [x] Draft PR
