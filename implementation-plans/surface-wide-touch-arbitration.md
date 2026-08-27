# Surface-wide touch arbitration

## Goal

A two-finger gesture anywhere on the crease-pattern surface pans and zooms the
camera — including when one of the fingers happens to land on a folded-figure
window, an inline-simulation window, a reference image or a text box.

Today it does not. `cpTouchArbiter` is scoped to the `<canvas>` element, so it
only ever counts contacts that land on the canvas itself. A finger that lands on
`CanvasObjectOverlay`'s chrome is invisible to it, which breaks the gesture in
two directions at once:

- the overlay starts a move/resize/rotate drag with pointer capture, knowing
  nothing about any other contact; and
- the arbiter sees a *single* contact — the other finger — so rule 2 applies and
  that finger reaches the tool chain.

The result is the bug as reported: the window drags, the second finger draws,
and nothing pinches. It is the same class of bug the arbiter was written to fix
(`a second finger drew a second crease`), one layer up.

## Approach

Promote the arbiter from canvas-scoped to **surface-scoped**: one instance,
shared by every layer that takes presses on the CP surface, with each contact
tagged by the layer it landed on.

Rule 3 then reads the way it always meant to — *two or more fingers on the
surface are a camera gesture* — rather than "two or more fingers on the canvas
element".

Three consequences shape the API:

1. **Abort becomes a notification, not a return value.** When a canvas press
   promotes an overlay drag to a camera gesture, the layer that must roll back
   is not the one that called `down()`. So each layer registers
   `onAbort(origin, fn)` and the arbiter fires the origins that just lost an
   in-flight press. `down()` returning `abortInFlight` could only ever answer
   for its own caller, so it goes.
2. **Transform becomes a notification too.** A pinch with a thumb resting on the
   canvas and the index finger on a folded figure delivers its `pointermove`s to
   the *overlay*. If transforms were returned from `move()`, that motion would
   only reach the camera on the next canvas-side move — a stationary thumb would
   zoom nothing. The camera owner registers `onTransform` instead, and any
   layer's move can drive it.
3. With both of those out, verdicts collapse to a bare `CpGestureAction`.

The rules themselves are unchanged, and so is every single-pointer path: with
one origin in play the state machine behaves exactly as it does today.

## Affected Areas

- `apps/web/src/cp-workspace/gestures/cpTouchArbiter.ts` — origins, abort and
  transform subscriptions, verdicts collapse to `CpGestureAction`.
- `apps/web/src/cp-workspace/gestures/cpSurfaceGestures.ts` (new) — the one live
  arbiter for the surface, same module-singleton reasoning as
  `cpOverlayViewStore`.
- `apps/web/src/cp-workspace/CreasePatternWebglCanvas.tsx` — consume the shared
  instance; register `abortInFlightGesture` and `applyPinch`.
- `apps/web/src/cp-workspace/CanvasObjectOverlay.tsx` — arbitrate every press,
  keep reporting contact motion while a camera gesture owns the surface, and
  roll an aborted drag back to where it started.
- Tests for both, plus the arbiter's own sequence tests extended to two origins.

## Checklist

- [x] `CpGestureOrigin` + origin-tagged contacts in the arbiter
- [x] `abort` names the layers to roll back; the fan-out and the transform sink
      live in `cpSurfaceGestures`, which keeps the arbiter a pure state machine
- [x] Shared `cpSurfaceGestures` instance
- [x] Canvas consumes the shared instance
- [x] Overlay arbitrates presses and rolls back on abort
- [x] Arbiter sequence tests cover cross-origin preemption
- [x] Overlay tests cover "second finger cancels the drag"
- [x] `npm run lint:web` / `typecheck:web` / `test:web`
- [x] Wiring confirmed in the running app, not just per module: synthetic touch
      sequences dispatched at the real canvas and the real overlay chrome moved
      the camera by exactly the finger-spread ratio (3.0 for a 3× spread) and
      snapped an in-flight text-box drag back to its start
- [ ] Confirmed on a real touch device (needs hands; synthetic pointer events
      exercise our routing, but not the browser's own multi-touch delivery)

## Not covered

A **focused** inline-simulation window orbits its fold on drag, and that press
is taken by `SimulatorViewport`'s own canvas rather than by the overlay — the
overlay deliberately makes a focused window's body inert (`inertBodyIds`). So a
pinch with one finger on a focused simulation still has the old shape: the
simulation orbits and the canvas sees a single finger.

Left out because the fix is a different one, not a bigger version of this one.
`SimulatorViewport` is shared with the Simulate workspace and knows nothing
about the CP surface, so either `InlineSimulationLayer` intercepts the whole
press/move/release sequence in the capture phase, or the viewport grows a way to
decline a press — and unlike a window drag there is no obvious roll-back, since
an orbit is view state that the canvas' own abort path deliberately *commits*
rather than reverts.

Folded figures are unaffected: their windows take no pointer events at all, and
the orbit gesture belongs to the crease-pattern canvas, which arbitrates already.
