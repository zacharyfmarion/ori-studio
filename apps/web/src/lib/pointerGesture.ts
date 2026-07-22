import type { Point } from './geometry';

/**
 * How far the pointer must travel before a press counts as a drag rather than a
 * click. Below it, a press-and-release is a click even if the hand wobbled.
 */
export const DRAG_START_THRESHOLD_PX = 4;

/**
 * Whether a pointer gesture has travelled far enough to be a drag.
 *
 * Both BP panes classify press gestures this way — the tree to tell "add a leaf
 * here" from "rotate this subtree", the packing pane to tell a click-select from
 * a flap or device drag. Sharing the predicate keeps a click meaning the same
 * thing in both, and keeps the threshold a single number.
 *
 * Points are in client (screen) pixels, so the threshold is a real distance on
 * screen and does not change with zoom.
 */
export function hasPassedDragThreshold(
  from: Point,
  to: Point,
  threshold = DRAG_START_THRESHOLD_PX
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) >= threshold;
}

let pointersDown = 0;
let listening = false;
let pending: (() => void)[] = [];

function flushPending(): void {
  if (pending.length === 0) return;
  const queued = pending;
  pending = [];
  requestAnimationFrame(() => {
    for (const run of queued) run();
  });
}

/**
 * Start counting pointers. Call it before a gesture can begin — the count can
 * only be right for presses that happen after the listeners are attached.
 */
export function trackPointerGestures(): void {
  if (listening) return;
  listening = true;
  // Capture phase, so the count is right even when a handler stops propagation.
  window.addEventListener('pointerdown', () => {
    pointersDown += 1;
  }, true);
  const release = () => {
    pointersDown = Math.max(0, pointersDown - 1);
    if (pointersDown === 0) flushPending();
  };
  window.addEventListener('pointerup', release, true);
  window.addEventListener('pointercancel', release, true);
  // A gesture interrupted by losing the window never delivers pointerup.
  window.addEventListener('blur', () => {
    pointersDown = 0;
    flushPending();
  });
}

/**
 * Run `run` once no pointer is being held down.
 *
 * For work that reflows the layout — activating a Dockview panel, say. A reflow
 * mid-gesture swaps out the DOM nodes the gesture is running against, so the
 * element holding pointer capture stops receiving moves and the drag dies. It is
 * not enough to defer by a frame: a click is over within one, but a drag lasts
 * as long as the user holds the button, so the reflow just lands further inside
 * it. Waiting for the button to come up is the only bound that covers both.
 *
 * With no pointer down (a menu command, a shortcut) this is a plain rAF.
 */
/** Whether the user is currently holding a pointer down. */
export function isPointerDown(): boolean {
  return pointersDown > 0;
}

export function runAfterPointerGesture(run: () => void): void {
  if (typeof window === 'undefined') {
    run();
    return;
  }
  trackPointerGestures();
  if (pointersDown === 0) {
    requestAnimationFrame(run);
    return;
  }
  pending.push(run);
}
