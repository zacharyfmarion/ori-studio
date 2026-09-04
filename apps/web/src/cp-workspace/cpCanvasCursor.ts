/**
 * The crease-pattern canvas' cursor, as a function of what can pan it.
 *
 * Three gestures pan the canvas -- the hand tool, the middle button, and
 * Cmd+drag -- and only the first used to show a cursor, so the other two panned
 * with no feedback at all. One helper now answers for all of them.
 *
 * Wheel and two-finger pans deliberately leave the cursor alone: there is no
 * press to begin or end, so a grab cursor would flicker on every scroll. Figma
 * makes the same distinction.
 */
import { useSyncExternalStore } from 'react';
import { readHeldModifiers, subscribeHeldModifiers } from '../keyboard/heldModifiers';

/**
 * Is the pan modifier held right now?
 *
 * `meta`, not the platform accel -- upstream's rule verbatim
 * (`Canvas.java:267` maps `isMetaDown()` to BUTTON2, whose handler pans), and
 * Ctrl is already crease-colour inversion. The pointer handler reads the same
 * rule off the event it is handling, which is the event-time truth; this is the
 * between-events answer the cursor needs. Both spell the rule `meta` and there
 * is nowhere else it should be spelled.
 */
export function isPanModifierHeld(): boolean {
  return readHeldModifiers().meta;
}

/**
 * Track the pan modifier for the cursor.
 *
 * The snapshot is a boolean on purpose: a primitive compares by value, so the
 * coarse subscription (which fires on *any* modifier change) costs nothing --
 * React bails out unless this particular answer flipped.
 */
export function usePanModifierHeld(): boolean {
  return useSyncExternalStore(subscribeHeldModifiers, isPanModifierHeld);
}

export interface CpCanvasCursorState {
  /** The hand tool is selected, so any drag pans. */
  panToolActive: boolean;
  /** The pan modifier (Cmd) is held, so a drag would pan. */
  panModifierHeld: boolean;
  /** A pan drag is in progress, whatever started it. */
  panDragging: boolean;
  /**
   * The pointer is over a focused 3D folded figure, so a drag *here* turns it.
   *
   * Same two glyphs as pan, because it is the same gesture to the hand: press
   * and drag to move a view. Without it a focused figure looks exactly like a
   * selected one and "press to focus" has no feedback on the canvas.
   *
   * Deliberately about the **pointer**, not about focus. Keyed on focus alone it
   * dressed the whole canvas in a grab cursor the moment a fold completed —
   * promising a gesture everywhere except the one place it worked.
   */
  foldedOrbitHovered?: boolean;
  /** An orbit drag is in progress, which keeps the closed hand while it leaves the figure. */
  foldedOrbitDragging?: boolean;
  /**
   * The pointer is over something selectable — a crease, a point, a circle.
   *
   * Set only where a click would select what is under the cursor — which is not
   * the same as "no tool is armed", since the canvas rests with Box Select
   * armed. The canvas gates this on the tool's *click action* instead. A draw
   * tool owns its own cursor and hover preview, so this stays false under one.
   */
  creaseHovered?: boolean;
  /**
   * The pointer is over a vertex the Move Vertex tool would grab.
   *
   * Its own flag rather than folding into {@link creaseHovered}, because the two
   * describe different presses — a crease under the cursor gets selected, a
   * vertex under this tool gets dragged — and they take the glyphs that say so.
   */
  vertexGrabbable?: boolean;
}

/**
 * The cursor to apply, or `undefined` to leave it to CSS and the active tool.
 */
export function cpCanvasCursor(
  state: CpCanvasCursorState
): 'grab' | 'grabbing' | 'pointer' | undefined {
  if (state.panDragging || state.foldedOrbitDragging) return 'grabbing';
  if (state.panToolActive || state.panModifierHeld) return 'grab';
  if (state.foldedOrbitHovered) return 'grab';
  // Below pan and orbit for the same reason the crease hover is: a Cmd-drag pans
  // whatever is under the cursor. Above the crease hover because it is the more
  // specific claim — with Move Vertex armed, a press on a vertex drags it.
  if (state.vertexGrabbable) return 'grab';
  // Last, so every pan and orbit affordance outranks it: those describe what a
  // press will *do*, and a crease under the cursor does not change that a
  // Cmd-drag pans.
  if (state.creaseHovered) return 'pointer';
  return undefined;
}
