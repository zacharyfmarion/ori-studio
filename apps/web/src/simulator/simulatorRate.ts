/**
 * How fast the simulator is going, as the panel sees it: solver steps per
 * second and frames per second, over a window of about a second.
 *
 * Measured on the main thread from the frames the worker sends, so it is what
 * the user gets, transfer and all, not the solver's speed in isolation (for
 * that, see `bench/backendBench` in the simulator package). A frame that only
 * redrew (a camera move) counts towards frames per second and adds no steps.
 */

/** One window's answer. */
export interface SimulatorRate {
  stepsPerSecond: number;
  framesPerSecond: number;
}

export const SIMULATOR_RATE_WINDOW_MS = 1000;

export interface SimulatorRateMeter {
  /** Count one frame. Returns the window's rate when a window has closed, else null. */
  observe(stepsThisTick: number, now: number): SimulatorRate | null;
  /** Forget the open window: a new model, or the readout switched off. */
  reset(): void;
}

export function createSimulatorRateMeter(windowMs = SIMULATOR_RATE_WINDOW_MS): SimulatorRateMeter {
  let start: number | null = null;
  let frames = 0;
  let steps = 0;
  return {
    observe(stepsThisTick, now) {
      if (start === null) {
        start = now;
        frames = 0;
        steps = 0;
        return null;
      }
      frames += 1;
      steps += Math.max(0, stepsThisTick);
      const elapsed = now - start;
      if (elapsed < windowMs) return null;
      const rate = {
        stepsPerSecond: (steps * 1000) / elapsed,
        framesPerSecond: (frames * 1000) / elapsed,
      };
      start = now;
      frames = 0;
      steps = 0;
      return rate;
    },
    reset() {
      start = null;
    },
  };
}
