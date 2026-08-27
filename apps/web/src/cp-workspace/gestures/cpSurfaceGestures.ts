import {
  createCpTouchArbiter,
  type CpGestureAction,
  type CpGestureOrigin,
  type CpGesturePointer,
} from './cpTouchArbiter';
import type { GesturePoint, PinchTransform } from './pinchTransform';

/**
 * The one live {@link createCpTouchArbiter} for the crease-pattern surface, plus
 * the two wires that make a *shared* arbiter usable by layers that cannot see
 * each other's events.
 *
 * Deliberately module state rather than React state or a context, for the same
 * reason `cpOverlayViewStore` is: the participants are a WebGL canvas driving
 * itself at 60fps and a sibling SVG overlay, and routing contact ownership
 * through the (huge) CreasePatternPanel would re-render it per pointer sample.
 * One surface is mounted at a time — the same assumption that store already
 * makes — and `reset()` is what a rebuilt surface calls to prove it.
 *
 * The two wires:
 *
 * - **Abort fan-out.** `down()` can decide that a layer *other than the caller*
 *   must take back a press. The canvas gets no chance to notice a finger that
 *   landed on the overlay, so the overlay registers what to do and this module
 *   calls it. See {@link CpGestureOrigin}.
 * - **Transform sink.** Only the canvas owns a camera, but a pinch's
 *   `pointermove`s go to whichever layer captured that finger. A pinch anchored
 *   by a thumb resting on the canvas, with the index finger on a folded figure,
 *   delivers *every* moving sample to the overlay — so if a sample only reached
 *   the camera by being returned from the canvas' own `move()`, that gesture
 *   would zoom nothing at all. The sink is how any layer's sample gets there.
 *
 * Neither belongs in the arbiter: it is a pure state machine over pointer
 * sequences, and it stays testable without a camera precisely because it hands
 * back verdicts instead of calling anybody.
 */

/** Roll back whatever press this layer had in flight. */
type AbortHandler = () => void;

/** Apply a camera sample. Registered by the canvas, which owns the camera. */
type TransformSink = (transform: PinchTransform, anchor: GesturePoint) => void;

const arbiter = createCpTouchArbiter();
const abortHandlers = new Map<CpGestureOrigin, Set<AbortHandler>>();
let transformSink: TransformSink | null = null;

function fireAborts(origins: readonly CpGestureOrigin[]): void {
  for (const origin of origins) {
    const handlers = abortHandlers.get(origin);
    if (!handlers) continue;
    // Copied, because a handler is free to unregister itself while rolling back.
    for (const handler of [...handlers]) handler();
  }
}

export const cpSurfaceGestures = {
  /**
   * Arbitrate a press on `origin`, rolling back every layer it takes the
   * surface from — including, possibly, `origin` itself — before returning.
   *
   * Synchronous on purpose: callers act on the verdict in the same handler, and
   * a rollback deferred past that would race the press it is rolling back.
   */
  down(pointer: CpGesturePointer, origin: CpGestureOrigin): CpGestureAction {
    const verdict = arbiter.down(pointer, origin);
    fireAborts(verdict.abort);
    return verdict.action;
  },

  /**
   * Report a contact's motion, whichever layer captured it.
   *
   * A `transform` verdict reaches the camera through the sink rather than the
   * return value, so a layer with no camera can still drive one. Callers only
   * need the action, to decide whether their own gesture may act on this event.
   */
  move(pointer: CpGesturePointer): CpGestureAction {
    const verdict = arbiter.move(pointer);
    if (verdict.action === 'transform') transformSink?.(verdict.transform, verdict.anchor);
    return verdict.action;
  },

  /** Handles `pointerup` and `pointercancel` alike — both end a contact. */
  up(pointer: CpGesturePointer): CpGestureAction {
    return arbiter.up(pointer).action;
  },

  /** Register this layer's roll-back. Returns the detach. */
  onAbort(origin: CpGestureOrigin, handler: AbortHandler): () => void {
    const handlers = abortHandlers.get(origin) ?? new Set<AbortHandler>();
    abortHandlers.set(origin, handlers);
    handlers.add(handler);
    return () => {
      handlers.delete(handler);
    };
  },

  /**
   * Claim the camera. Returns the detach.
   *
   * Last claim wins, and there is only ever one claimant: a surface has one
   * camera, and the canvas that owns it registers on mount. Overwriting rather
   * than accumulating is what keeps a torn-down canvas from being handed
   * samples belonging to the one that replaced it.
   */
  setTransformSink(sink: TransformSink): () => void {
    transformSink = sink;
    return () => {
      if (transformSink === sink) transformSink = null;
    };
  },

  /**
   * Drop every contact — the surface is going away, or being rebuilt after a
   * WebGL context loss, which is exactly when nobody lifts a finger.
   */
  reset(): void {
    arbiter.reset();
  },

  /** Whether a camera gesture owns the surface. */
  isTransforming: (): boolean => arbiter.isTransforming(),

  /** Live contact count across every layer, for tests and diagnostics. */
  contactCount: (): number => arbiter.contactCount(),
};
