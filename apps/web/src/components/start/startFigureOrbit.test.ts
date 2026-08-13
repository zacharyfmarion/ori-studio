import { describe, expect, it } from 'vitest';
import { normalizeAngle } from '../../lib/simulatorOrbit';
import {
  START_FIGURE_HOLD_MS,
  START_FIGURE_PITCH_BAND,
  START_FIGURE_SWEEP_PERIOD_MS,
  advanceStartFigureOrbit,
  beginStartFigureDrag,
  dragStartFigureOrbit,
  endStartFigureDrag,
  initialStartFigureOrbit,
  type StartFigureOrbitConfig,
  type StartFigureOrbitState,
} from './startFigureOrbit';

const CONFIG: StartFigureOrbitConfig = {
  yaw: Math.PI,
  pitch: -0.55,
  sweep: 0.45,
  reducedMotion: false,
};

/** Run the loop the component runs, at a fixed frame time. */
function run(
  state: StartFigureOrbitState,
  ms: number,
  config = CONFIG,
  frameMs = 16
): StartFigureOrbitState {
  let current = state;
  for (let elapsed = 0; elapsed < ms; elapsed += frameMs) {
    current = advanceStartFigureOrbit(current, frameMs, config);
  }
  return current;
}

describe('the auto sweep', () => {
  it('starts at the pose the asset chose', () => {
    const state = initialStartFigureOrbit(CONFIG);
    expect(state.yaw).toBe(CONFIG.yaw);
    expect(state.pitch).toBe(CONFIG.pitch);
    expect(state.mode).toBe('auto');
  });

  it('stays inside the sweep and reverses rather than spinning', () => {
    // Two full periods. A sweep that had become a spin would leave this range on
    // the first pass, and the point of the bounded travel is that the figure
    // never swings edge-on -- see the contact sheet in generate-start-figure.mjs.
    let state = initialStartFigureOrbit(CONFIG);
    let min = state.yaw;
    let max = state.yaw;
    for (let elapsed = 0; elapsed < START_FIGURE_SWEEP_PERIOD_MS * 2; elapsed += 16) {
      state = advanceStartFigureOrbit(state, 16, CONFIG);
      min = Math.min(min, state.yaw);
      max = Math.max(max, state.yaw);
    }
    expect(min).toBeGreaterThanOrEqual(CONFIG.yaw - CONFIG.sweep - 1e-9);
    expect(max).toBeLessThanOrEqual(CONFIG.yaw + CONFIG.sweep + 1e-9);
    // And it actually travelled, rather than sitting still and passing the bounds
    // check vacuously.
    expect(max - min).toBeGreaterThan(CONFIG.sweep);
  });

  it('reaches both ends of its travel within one period', () => {
    let state = initialStartFigureOrbit(CONFIG);
    let min = state.yaw;
    let max = state.yaw;
    for (let elapsed = 0; elapsed < START_FIGURE_SWEEP_PERIOD_MS; elapsed += 16) {
      state = advanceStartFigureOrbit(state, 16, CONFIG);
      min = Math.min(min, state.yaw);
      max = Math.max(max, state.yaw);
    }
    expect(max).toBeCloseTo(CONFIG.yaw + CONFIG.sweep, 2);
    expect(min).toBeCloseTo(CONFIG.yaw - CONFIG.sweep, 2);
  });

  it('never moves the pitch', () => {
    const state = run(initialStartFigureOrbit(CONFIG), START_FIGURE_SWEEP_PERIOD_MS);
    expect(state.pitch).toBe(CONFIG.pitch);
  });
});

describe('dragging', () => {
  it('turns the figure about its vertical axis', () => {
    const start = beginStartFigureDrag(initialStartFigureOrbit(CONFIG));
    const dragged = dragStartFigureOrbit(start, -100, 0, CONFIG);
    // Compared through `normalizeAngle`, because the resting pose is pi -- the
    // wrap boundary -- so a rightward drag comes back as a negative number
    // without ever having turned the short way.
    expect(normalizeAngle(dragged.yaw - start.yaw)).toBeCloseTo(1, 6);
    expect(dragged.pitch).toBe(start.pitch);
  });

  it('rejoins the sweep the short way round from across the wrap', () => {
    // The regression this file caught: with the pose at pi, a drag past the top
    // of the sweep normalizes to a negative yaw. Differencing that raw reads a
    // few degrees of travel as most of a turn, and the figure eases back the
    // long way round through every angle the sweep exists to avoid.
    const past = endStartFigureDrag(
      dragStartFigureOrbit(
        beginStartFigureDrag(initialStartFigureOrbit(CONFIG)),
        -60,
        0,
        CONFIG
      )
    );
    expect(past.yaw).toBeLessThan(0);

    let state = past;
    let travelled = 0;
    for (let elapsed = 0; elapsed < START_FIGURE_HOLD_MS + 20_000; elapsed += 16) {
      const next = advanceStartFigureOrbit(state, 16, CONFIG);
      travelled += Math.abs(normalizeAngle(next.yaw - state.yaw));
      state = next;
      if (state.mode === 'auto') break;
    }
    expect(state.mode).toBe('auto');
    // The short way is at most the drag's own overshoot plus the sweep; the long
    // way round is over 2*pi.
    expect(travelled).toBeLessThan(CONFIG.sweep + 0.6);
  });

  it('clamps the pitch to a narrow band however far it is dragged', () => {
    // "Not in all directions": a hard vertical drag must not put the figure on
    // its own axis, where a folded form becomes an unreadable sliver.
    let state = beginStartFigureDrag(initialStartFigureOrbit(CONFIG));
    for (let i = 0; i < 50; i += 1) state = dragStartFigureOrbit(state, 0, 200, CONFIG);
    expect(state.pitch).toBeCloseTo(CONFIG.pitch + START_FIGURE_PITCH_BAND, 6);

    for (let i = 0; i < 100; i += 1) state = dragStartFigureOrbit(state, 0, -200, CONFIG);
    expect(state.pitch).toBeCloseTo(CONFIG.pitch - START_FIGURE_PITCH_BAND, 6);
  });

  it('is not overridden by the sweep while the pointer is down', () => {
    const dragged = dragStartFigureOrbit(
      beginStartFigureDrag(initialStartFigureOrbit(CONFIG)),
      -220,
      0,
      CONFIG
    );
    const after = run(dragged, 3_000);
    expect(after).toEqual(dragged);
  });
});

describe('resuming after a release', () => {
  function released(): StartFigureOrbitState {
    return endStartFigureDrag(
      dragStartFigureOrbit(
        beginStartFigureDrag(initialStartFigureOrbit(CONFIG)),
        -180,
        90,
        CONFIG
      )
    );
  }

  it('holds where the user left it before taking the figure back', () => {
    const state = released();
    const held = run(state, START_FIGURE_HOLD_MS - 500);
    expect(held.mode).toBe('resuming');
    expect(held.yaw).toBeCloseTo(state.yaw, 9);
    expect(held.pitch).toBeCloseTo(state.pitch, 9);
  });

  it('eases back to the sweep and the resting pitch, without snapping', () => {
    const state = released();
    // One frame past the hold: the figure has begun moving, but nowhere near
    // arrived -- a snap would land it on the sweep in that single frame.
    const nudged = run(state, START_FIGURE_HOLD_MS + 16);
    expect(nudged.mode).toBe('resuming');
    expect(nudged.pitch).not.toBeCloseTo(CONFIG.pitch, 3);

    const settled = run(state, START_FIGURE_HOLD_MS + 20_000);
    expect(settled.mode).toBe('auto');
    expect(settled.pitch).toBeCloseTo(CONFIG.pitch, 6);
    expect(settled.yaw).toBeGreaterThanOrEqual(CONFIG.yaw - CONFIG.sweep - 1e-6);
    expect(settled.yaw).toBeLessThanOrEqual(CONFIG.yaw + CONFIG.sweep + 1e-6);
  });

  it('rejoins the sweep at the nearest point of its travel', () => {
    // Released near one end, it must not travel back across the whole sweep to
    // rejoin at the middle.
    const state = released();
    const settled = run(state, START_FIGURE_HOLD_MS + 20_000);
    const swept = Math.sin(settled.phase) * CONFIG.sweep + CONFIG.yaw;
    expect(settled.yaw).toBeCloseTo(swept, 6);
  });

  it('settles even under reduced motion, because a drag was asked for', () => {
    const config = { ...CONFIG, reducedMotion: true };
    const settled = run(released(), START_FIGURE_HOLD_MS + 20_000, config);
    expect(settled.mode).toBe('auto');
    expect(settled.pitch).toBeCloseTo(CONFIG.pitch, 6);
  });
});

describe('reduced motion', () => {
  it('freezes the ambient sweep at the resting pose', () => {
    const config = { ...CONFIG, reducedMotion: true };
    const state = run(initialStartFigureOrbit(config), 30_000, config);
    expect(state.yaw).toBe(CONFIG.yaw);
    expect(state.pitch).toBe(CONFIG.pitch);
  });

  it('still lets the figure be dragged', () => {
    const config = { ...CONFIG, reducedMotion: true };
    const dragged = dragStartFigureOrbit(
      beginStartFigureDrag(initialStartFigureOrbit(config)),
      -100,
      0,
      config
    );
    expect(dragged.yaw).not.toBe(CONFIG.yaw);
  });
});

describe('a figure with no sweep', () => {
  it('holds still rather than dividing by zero', () => {
    const config = { ...CONFIG, sweep: 0 };
    const state = run(initialStartFigureOrbit(config), 30_000, config);
    expect(state.yaw).toBeCloseTo(CONFIG.yaw, 9);
    expect(Number.isFinite(state.phase)).toBe(true);
  });
});
