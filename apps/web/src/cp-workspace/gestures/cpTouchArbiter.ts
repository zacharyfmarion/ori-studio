/**
 * Who owns the crease-pattern *surface* when more than one thing is touching it.
 *
 * The canvas' `pointerdown` used to take no `pointerId`, `isPrimary` or
 * `pointerType` filter at all, so a second finger re-entered the whole tool
 * branch chain: on a real iPad, a two-finger pinch over the Line tool *drew a
 * second crease* (the second finger relocated the crease start; the first
 * finger's release committed it) and did not zoom. The user's instinctive first
 * gesture on a canvas silently corrupted their document.
 *
 * Arbitration is a state machine here, and pure, for the same reason
 * `tools/pointerRelease.ts` is: the precedence rule gets stated once and checked
 * by tests over whole pointer sequences, instead of being re-derived inside each
 * branch of a 120-line handler. What it does *not* own is the rollback — taking
 * back what an aborted press started touches a dozen pieces of canvas-local
 * mutable state, and a function taking fifteen arguments would be worse than the
 * inlining. This module decides; each layer acts.
 *
 * The three rules, in the order they are applied:
 *
 * 1. **A precision pointer owns the surface.** A mouse or a Pencil never
 *    pinches, and it preempts fingers already down — a palm resting beside the
 *    Pencil is not what the user is drawing with. Desktop behaviour is
 *    therefore bit-identical to before this module existed.
 * 2. **One finger forwards.** Single-touch drawing already worked and keeps
 *    working: one contact reaches the tool chain exactly as a mouse press does.
 * 3. **Two or more fingers are a camera gesture.** The press that was in flight
 *    is rolled back, and from then until the *last* contact lifts, nothing
 *    reaches the tool chain. That last part matters as much as the first: if
 *    lifting one finger of a pinch resumed drawing with the other, the bug
 *    would just move.
 *
 * **The surface is not the canvas element**, and the difference is what
 * {@link CpGestureOrigin} is for. Windows and images are grabbed through
 * `CanvasObjectOverlay`, a sibling DOM layer that captures the pointer and never
 * lets the press reach the canvas. While this arbiter was scoped to the canvas
 * element, a finger landing there was invisible to it — so a pinch with one
 * finger on a folded figure broke in *both* directions at once: the overlay
 * dragged the window, knowing nothing of any second contact, and rule 2 handed
 * the other finger to the tool chain because it looked like the only one on the
 * surface. Two fingers, one dragging and one drawing, and nothing pinching.
 *
 * So contacts carry the layer they landed on, rule 3 counts them all, and the
 * roll-back verdict names *which* layers have something to take back — the one
 * that asked is not necessarily the one that loses a press.
 */
import {
  contactCentroid,
  IDENTITY_PINCH,
  pinchTransform,
  type GesturePoint,
  type PinchTransform,
} from './pinchTransform';

/** The fields of a `PointerEvent` the arbiter reads; a plain object in tests. */
export interface CpGesturePointer {
  pointerId: number;
  pointerType: string;
  clientX: number;
  clientY: number;
}

/**
 * What the canvas should do with an event.
 *
 * - `forward` — run the existing single-pointer handler unchanged.
 * - `transform` — this contact is driving the camera; the tool chain never
 *   sees it.
 * - `ignore` — swallow it. A palm beside a Pencil, or a contact left over from
 *   a camera gesture that has not fully lifted.
 */
export type CpGestureAction = 'forward' | 'transform' | 'ignore';

/**
 * Which layer of the crease-pattern surface a contact landed on.
 *
 * Both take presses, both capture the pointer, and neither sees the other's
 * events — so the only place their contacts meet is here.
 */
export type CpGestureOrigin =
  /** The WebGL canvas: creases, tools, the camera. */
  | 'canvas'
  /** `CanvasObjectOverlay`: move/resize/rotate for windows, images, text. */
  | 'overlay';

export interface CpGestureDownVerdict {
  action: CpGestureAction;
  /**
   * Layers holding a forwarded press that this event has just taken the surface
   * from, and which must roll it back before anything else happens.
   *
   * A list rather than the boolean it replaces, because the layer that loses a
   * press is not always the layer that asked: a finger landing on the canvas
   * beside one already dragging a folded figure aborts the *overlay*. Empty for
   * the overwhelmingly common case of nothing being in flight anywhere.
   */
  abort: readonly CpGestureOrigin[];
}

export type CpGestureMoveVerdict =
  | { action: 'forward' | 'ignore' }
  | {
      action: 'transform';
      transform: PinchTransform;
      /**
       * Client point the zoom is anchored at: the contact set's centroid
       * *before* this sample. See `applyPinch` in the canvas for why the
       * previous centroid rather than the current one.
       */
      anchor: GesturePoint;
    };

export interface CpGestureUpVerdict {
  action: 'forward' | 'ignore';
}



/**
 * Pointer types that participate in camera gestures.
 *
 * Everything else — `mouse`, `pen`, and the empty string a synthetic or
 * jsdom-constructed event carries — is a precision instrument and keeps the
 * pre-existing single-pointer behaviour verbatim. Defaulting the *unknown* case
 * to precision is what keeps a synthesised event from being treated as a
 * finger; a new coarse pointer type would have to be added here on purpose.
 */
export function isCoarsePointer(pointerType: string): boolean {
  return pointerType === 'touch';
}

type ContactRole = CpGestureAction;

interface Contact {
  id: number;
  coarse: boolean;
  role: ContactRole;
  /** The layer this contact pressed on; see {@link CpGestureOrigin}. */
  origin: CpGestureOrigin;
  x: number;
  y: number;
}

export interface CpTouchArbiter {
  /**
   * `origin` defaults to `canvas`, which is every call site that predates the
   * overlay joining: with one layer in play the machine behaves exactly as it
   * did when it was scoped to the canvas element.
   */
  down(pointer: CpGesturePointer, origin?: CpGestureOrigin): CpGestureDownVerdict;
  move(pointer: CpGesturePointer): CpGestureMoveVerdict;
  /** Handles `pointerup` and `pointercancel` alike — both end a contact. */
  up(pointer: CpGesturePointer): CpGestureUpVerdict;
  /** Drop every contact — the surface is going away (unmount, context loss). */
  reset(): void;
  /** Live contact count, for tests and diagnostics. */
  contactCount(): number;
  /** Whether a camera gesture is in flight. */
  isTransforming(): boolean;
}

export function createCpTouchArbiter(): CpTouchArbiter {
  /** Every live contact, in the order it landed (Map preserves insertion). */
  const contacts = new Map<number, Contact>();
  /**
   * The contact positions the *last* transform sample was measured from, keyed
   * by the id list they were taken for. Rebased whenever the set changes, so a
   * finger joining or leaving mid-pinch contributes no phantom jump.
   */
  let previous: { ids: number[]; points: GesturePoint[] } | null = null;

  const inRole = (role: ContactRole): Contact[] =>
    [...contacts.values()].filter((contact) => contact.role === role);

  /**
   * What an event carrying no contact of its own does: the pre-existing
   * single-pointer behaviour, unless a camera gesture owns the surface.
   */
  const idleAction = (): 'forward' | 'ignore' =>
    inRole('transform').length > 0 ? 'ignore' : 'forward';

  const rebase = () => {
    const set = inRole('transform');
    previous = set.length
      ? { ids: set.map((c) => c.id), points: set.map((c) => ({ x: c.x, y: c.y })) }
      : null;
  };

  const add = (
    pointer: CpGesturePointer,
    role: ContactRole,
    origin: CpGestureOrigin
  ): Contact => {
    const contact: Contact = {
      id: pointer.pointerId,
      coarse: isCoarsePointer(pointer.pointerType),
      role,
      origin,
      x: pointer.clientX,
      y: pointer.clientY,
    };
    contacts.set(contact.id, contact);
    return contact;
  };

  /** The layers among `losing` that have a forwarded press to take back. */
  const abortList = (losing: readonly Contact[]): CpGestureOrigin[] => [
    ...new Set(losing.map((contact) => contact.origin)),
  ];

  /** No layer loses anything — the shape of almost every verdict. */
  const NOTHING_IN_FLIGHT: readonly CpGestureOrigin[] = [];

  return {
    down(pointer: CpGesturePointer, origin: CpGestureOrigin = 'canvas'): CpGestureDownVerdict {
      const existing = contacts.get(pointer.pointerId);
      if (existing) {
        // A second button on the same physical pointer — a right-click while
        // the left is held — re-fires `pointerdown` with the same id. Nothing
        // about ownership changes there; only the position is news.
        existing.x = pointer.clientX;
        existing.y = pointer.clientY;
        if (existing.role === 'transform') rebase();
        return { action: existing.role, abort: NOTHING_IN_FLIGHT };
      }

      if (!isCoarsePointer(pointer.pointerType)) {
        // Rule 1. Whatever was on the surface, it stops; the precision pointer
        // takes over. What has to be rolled back is any *forwarded* contact,
        // whatever kind it was: a mouse or a Pencil mid-drag has as much in
        // flight as a finger does, and an iPad carries both a trackpad pointer
        // and a Pencil at once. A camera gesture is the only role with nothing
        // to take back, because it has touched no document state.
        const abort = abortList(inRole('forward'));
        for (const contact of contacts.values()) contact.role = 'ignore';
        previous = null;
        add(pointer, 'forward', origin);
        return { action: 'forward', abort };
      }

      if (inRole('forward').some((contact) => !contact.coarse)) {
        // Rule 1, the other half: a finger arriving while a Pencil or mouse is
        // down is a palm, and is inert for as long as it stays down.
        add(pointer, 'ignore', origin);
        return { action: 'ignore', abort: NOTHING_IN_FLIGHT };
      }

      const transforming = inRole('transform');
      if (transforming.length > 0) {
        // A third finger joins the camera gesture rather than starting anything.
        add(pointer, 'transform', origin);
        rebase();
        return { action: 'transform', abort: NOTHING_IN_FLIGHT };
      }

      const forwarded = inRole('forward');
      if (forwarded.length > 0) {
        // Rule 3, and the whole reason this module exists: the second finger
        // converts the gesture instead of starting a second one. The forwarded
        // contact is promoted rather than dropped, so lifting either finger
        // leaves the other panning — and neither resumes drawing.
        //
        // Whose press is promoted decides who rolls back, which is why `abort`
        // is read off the contacts rather than assumed to be the caller: a
        // finger landing on the canvas beside one already dragging a window
        // aborts the overlay's drag, not anything of the canvas'.
        const abort = abortList(forwarded);
        for (const contact of forwarded) contact.role = 'transform';
        add(pointer, 'transform', origin);
        rebase();
        return { action: 'transform', abort };
      }

      // Rule 2: a lone finger draws, exactly as a mouse would.
      add(pointer, 'forward', origin);
      return { action: 'forward', abort: NOTHING_IN_FLIGHT };
    },

    move(pointer: CpGesturePointer): CpGestureMoveVerdict {
      const contact = contacts.get(pointer.pointerId);
      // A move with no press behind it is the ordinary hover case, and it is the
      // common one: a mouse or a Pencil moving over the canvas drives the snap
      // indicator and every tool preview without ever pressing. It forwards —
      // unless fingers are driving the camera, where a hover preview is noise.
      if (!contact) return { action: idleAction() };
      contact.x = pointer.clientX;
      contact.y = pointer.clientY;
      if (contact.role !== 'transform') return { action: contact.role };

      const set = inRole('transform');
      const next = set.map((c) => ({ x: c.x, y: c.y }));
      // The sample this one is differenced against, or null when the contact set
      // has changed since it was taken — a finger joining or leaving must not
      // read as the whole set jumping.
      const base =
        previous &&
        previous.ids.length === set.length &&
        previous.ids.every((id, index) => id === set[index].id)
          ? previous.points
          : null;
      const transform = base ? pinchTransform(base, next) : IDENTITY_PINCH;
      const anchor = contactCentroid(base ?? next) ?? { x: contact.x, y: contact.y };
      previous = { ids: set.map((c) => c.id), points: next };
      return { action: 'transform', transform, anchor };
    },

    up(pointer: CpGesturePointer): CpGestureUpVerdict {
      const contact = contacts.get(pointer.pointerId);
      // Same rule as an unpressed move, for the same reason: a release whose
      // press began on the DOM overlay above the canvas can still land here, and
      // the existing release routing already arbitrates that case through its own
      // flags (`textPressStarted` exists for it). Forwarding also keeps reaching
      // the tail of `onPointerUp`, which clears every gesture flag as a safety net.
      if (!contact) return { action: idleAction() };
      contacts.delete(pointer.pointerId);
      if (contact.role === 'transform') rebase();
      if (contacts.size === 0) previous = null;
      return { action: contact.role === 'forward' ? 'forward' : 'ignore' };
    },


    reset(): void {
      contacts.clear();
      previous = null;
    },

    contactCount: () => contacts.size,
    isTransforming: () => inRole('transform').length > 0,
  };
}
