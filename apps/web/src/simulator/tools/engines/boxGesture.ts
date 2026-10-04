import type {
  CssPoint,
  CssRect,
  SimulatorGestureEngine,
  SimulatorGestureOutput,
  SimulatorPointerInput,
} from '../types';

/**
 * How far a press may wander, per axis in CSS pixels, and still be a click.
 * Edit's `CLICK_MOVE_THRESHOLD`, measured the same way.
 */
export const SIMULATOR_CLICK_MOVE_THRESHOLD = 4;

export interface BoxGestureState {
  /** Where the press landed, or null while idle. */
  start: CssPoint | null;
  shift: boolean;
  touch: boolean;
  /** Set once the pointer has left the click threshold; it never goes back. */
  dragging: boolean;
}

const IDLE: BoxGestureState = { start: null, shift: false, touch: false, dragging: false };

function rectBetween(a: CssPoint, b: CssPoint): CssRect {
  return {
    left: Math.min(a.x, b.x),
    top: Math.min(a.y, b.y),
    right: Math.max(a.x, b.x),
    bottom: Math.max(a.y, b.y),
  };
}

function beyondThreshold(a: CssPoint, b: CssPoint): boolean {
  return (
    Math.abs(b.x - a.x) > SIMULATOR_CLICK_MOVE_THRESHOLD ||
    Math.abs(b.y - a.y) > SIMULATOR_CLICK_MOVE_THRESHOLD
  );
}

const nothing = (state: BoxGestureState): SimulatorGestureOutput<BoxGestureState> => ({
  state,
  preview: null,
  gesture: null,
});

/**
 * Press and drag a box, or press and release a click.
 *
 * A release within the click threshold is a click at the press point, wherever
 * the pointer drifted: the face under the press is the one that was aimed at.
 * Once a drag has left the threshold it stays a box, even if it comes back, so
 * a marquee on screen never turns into a click under the hand.
 */
export const boxGestureEngine: SimulatorGestureEngine<BoxGestureState> = {
  initialState: IDLE,

  reduce(state, input: SimulatorPointerInput) {
    switch (input.kind) {
      case 'down':
        return nothing({ start: input.point, shift: input.shift, touch: input.touch, dragging: false });

      case 'move': {
        const { start } = state;
        if (!start) return nothing(state);
        const dragging = state.dragging || beyondThreshold(start, input.point);
        const next = dragging === state.dragging ? state : { ...state, dragging };
        return {
          state: next,
          preview: dragging ? { marquee: rectBetween(start, input.point) } : null,
          gesture: null,
        };
      }

      case 'up': {
        const { start } = state;
        if (!start) return nothing(IDLE);
        const { shift, touch } = state;
        if (state.dragging || beyondThreshold(start, input.point)) {
          return {
            state: IDLE,
            preview: null,
            gesture: { kind: 'box', rect: rectBetween(start, input.point), shift, touch },
          };
        }
        return { state: IDLE, preview: null, gesture: { kind: 'click', point: start, shift, touch } };
      }

      case 'cancel':
        return nothing(IDLE);
    }
  },
};
