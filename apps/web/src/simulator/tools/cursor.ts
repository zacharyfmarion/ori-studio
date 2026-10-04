import type { SimulatorToolCursor } from './types';

export interface SimulatorCanvasCursorState {
  /** The active tool's own cursor. */
  tool: SimulatorToolCursor;
  /** An orbit drag is in progress, whatever started it. */
  orbiting: boolean;
  /** Meta is held, so a drag would orbit whatever the tool. */
  navigateModifierHeld: boolean;
}

/**
 * The simulator canvas's cursor: what a press here would do.
 *
 * Ranked the way `cpCanvasCursor` ranks Edit's: a drag already turning the
 * model keeps the closed hand, then the navigate modifier promises the open
 * one — because a Cmd-drag orbits under any tool — and only then the tool.
 */
export function simulatorCanvasCursor(
  state: SimulatorCanvasCursorState
): 'grab' | 'grabbing' | 'crosshair' {
  if (state.orbiting) return 'grabbing';
  if (state.navigateModifierHeld) return 'grab';
  return state.tool;
}
