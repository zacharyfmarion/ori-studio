import type { SimulatorOrbitMode } from '../../lib/simulatorOrbit';
import { boxGestureEngine } from './engines/boxGesture';
import { pullGestureEngine } from './engines/pullGesture';
import type { SimulatorGestureEngine, SimulatorInputMode } from './types';

/** The parts of a `pointerdown` that decide what it is. */
export interface SimulatorPress {
  /** `PointerEvent.button`: 0 primary, 1 middle, 2 secondary. */
  button: number;
  /**
   * A primary press the platform turns into a context click: Ctrl-click on a
   * Mac, which fires `contextmenu` as a right click does.
   */
  contextClick: boolean;
  /** Meta is held: Cmd on a Mac. The navigate modifier, as in Edit. */
  meta: boolean;
  shift: boolean;
}

export type SimulatorPressRoute =
  /** Leave it to the context menu, which the `contextmenu` event opens. */
  | { kind: 'menu' }
  /** A button nothing answers (back, forward). */
  | { kind: 'ignore' }
  | { kind: 'orbit'; mode: SimulatorOrbitMode }
  /**
   * A tool's gesture. `holdsCamera`: the gesture moves the paper under the
   * cursor, so the camera must not rescale beneath it while it runs.
   */
  | { kind: 'gesture'; engine: SimulatorGestureEngine<unknown>; holdsCamera?: boolean };

function orbit(press: SimulatorPress): SimulatorPressRoute {
  return { kind: 'orbit', mode: press.shift ? 'roll' : 'orbit' };
}

/**
 * What a primary press does under each input mode. A `Record`, so a new mode
 * fails to typecheck until it says.
 */
const ROUTES: Record<SimulatorInputMode, (press: SimulatorPress) => SimulatorPressRoute> = {
  orbit,
  'pick-faces': () => ({
    kind: 'gesture',
    engine: boxGestureEngine as SimulatorGestureEngine<unknown>,
  }),
  pull: () => ({
    kind: 'gesture',
    engine: pullGestureEngine as SimulatorGestureEngine<unknown>,
    holdsCamera: true,
  }),
};

/**
 * What a press on the canvas does.
 *
 * Navigation first, so no tool can claim it: the secondary button belongs to
 * the context menu, and the middle button and Meta always orbit (Shift rolls).
 * That is the rule Edit keeps for panning — a Cmd-drag pans whatever tool is
 * armed — and it is what makes the canvas safe to turn with a tool in hand.
 */
export function routeSimulatorPress(
  press: SimulatorPress,
  input: SimulatorInputMode
): SimulatorPressRoute {
  if (press.button === 2 || press.contextClick) return { kind: 'menu' };
  if (press.button === 1) return orbit(press);
  if (press.button !== 0) return { kind: 'ignore' };
  if (press.meta) return orbit(press);
  return ROUTES[input](press);
}
