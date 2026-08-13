import { describe, expect, it } from 'vitest';
import { normalizeAngle } from '../../lib/simulatorOrbit';
import {
  START_FIGURE_HOLD_MS,
  START_FIGURE_PITCH_BAND,
  START_FIGURE_TURN_PERIOD_MS,
  advanceStartFigureOrbit,
  beginStartFigureDrag,
  dragStartFigureOrbit,
  endStartFigureDrag,
  initialStartFigureOrbit,
  type StartFigureOrbitConfig,
  type StartFigureOrbitState,
} from './startFigureOrbit';

const CONFIG: StartFigureOrbitConfig = {
  yaw: 0,
  // The pitch the turntable requires: screen-up equals the model's Y axis, which
  // is the axis yaw turns about, only here. See the module header.
  pitch: -Math.PI / 2,
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

/** Total yaw travelled, following the short way across each wrap. */
function travel(from: StartFigureOrbitState, ms: number, config = CONFIG): number {
  let state = from;
  let total = 0;
  for (let elapsed = 0; elapsed < ms; elapsed += 16) {
    const next = advanceStartFigureOrbit(state, 16, config);
    total += normalizeAngle(next.yaw - state.yaw);
    state = next;
  }
  return total;
}

describe('the turn', () => {
  it('starts at the pose the asset chose', () => {
    const state = initialStartFigureOrbit(CONFIG);
    expect(state.yaw).toBe(CONFIG.yaw);
    expect(state.pitch).toBe(CONFIG.pitch);
    expect(state.mode).toBe('auto');
  });

  it('goes all the way round, so the side and the back are seen', () => {
    // The behaviour this replaced was a bounded sweep, which only ever showed
    // the front. A full revolution per period is the difference.
    const travelled = travel(initialStartFigureOrbit(CONFIG), START_FIGURE_TURN_PERIOD_MS);
    expect(travelled).toBeCloseTo(Math.PI * 2, 1);
  });

  it('keeps turning the same way past a full revolution', () => {
    const travelled = travel(
      initialStartFigureOrbit(CONFIG),
      START_FIGURE_TURN_PERIOD_MS * 2.5
    );
    expect(travelled).toBeCloseTo(Math.PI * 5, 1);
  });

  it('reaches the side and the back on the way round', () => {
    let state = initialStartFigureOrbit(CONFIG);
    const seen = { side: false, back: false };
    for (let elapsed = 0; elapsed < START_FIGURE_TURN_PERIOD_MS; elapsed += 16) {
      state = advanceStartFigureOrbit(state, 16, CONFIG);
      const turned = Math.abs(normalizeAngle(state.yaw - CONFIG.yaw));
      if (Math.abs(turned - Math.PI / 2) < 0.05) seen.side = true;
      if (Math.abs(turned - Math.PI) < 0.05) seen.back = true;
    }
    expect(seen).toEqual({ side: true, back: true });
  });

  it('never moves the pitch, which is what keeps up pointing up', () => {
    const state = run(initialStartFigureOrbit(CONFIG), START_FIGURE_TURN_PERIOD_MS);
    expect(state.pitch).toBe(CONFIG.pitch);
  });

  it('stays bounded rather than accumulating turns without limit', () => {
    // A yaw that grew forever would lose float precision on a page left open,
    // and `normalizeAngle` is what keeps it in (-pi, pi].
    const state = run(initialStartFigureOrbit(CONFIG), START_FIGURE_TURN_PERIOD_MS * 20);
    expect(state.yaw).toBeGreaterThan(-Math.PI - 1e-9);
    expect(state.yaw).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});

describe('dragging', () => {
  it('turns the figure about its vertical axis', () => {
    const start = beginStartFigureDrag(initialStartFigureOrbit(CONFIG));
    const dragged = dragStartFigureOrbit(start, -100, 0, CONFIG);
    expect(normalizeAngle(dragged.yaw - start.yaw)).toBeCloseTo(1, 6);
    expect(dragged.pitch).toBe(start.pitch);
  });

  it('lets a drag carry the figure all the way round', () => {
    // Yaw is unclamped on purpose: every angle is a legitimate view of a
    // turntable, so there is nothing to stop the user reaching the back.
    let state = beginStartFigureDrag(initialStartFigureOrbit(CONFIG));
    let travelled = 0;
    for (let i = 0; i < 20; i += 1) {
      const next = dragStartFigureOrbit(state, -40, 0, CONFIG);
      travelled += normalizeAngle(next.yaw - state.yaw);
      state = next;
    }
    expect(Math.abs(travelled)).toBeGreaterThan(Math.PI * 2);
  });

  it('clamps the pitch to a narrow band however far it is dragged', () => {
    // "Not in all directions": a hard vertical drag must not put the camera on
    // the model's own axis, where a folded form becomes an unreadable sliver.
    let state = beginStartFigureDrag(initialStartFigureOrbit(CONFIG));
    for (let i = 0; i < 50; i += 1) state = dragStartFigureOrbit(state, 0, 200, CONFIG);
    expect(state.pitch).toBeCloseTo(CONFIG.pitch + START_FIGURE_PITCH_BAND, 6);

    for (let i = 0; i < 100; i += 1) state = dragStartFigureOrbit(state, 0, -200, CONFIG);
    expect(state.pitch).toBeCloseTo(CONFIG.pitch - START_FIGURE_PITCH_BAND, 6);
  });

  it('is not overridden by the turn while the pointer is down', () => {
    const dragged = dragStartFigureOrbit(
      beginStartFigureDrag(initialStartFigureOrbit(CONFIG)),
      -220,
      0,
      CONFIG
    );
    expect(run(dragged, 3_000)).toEqual(dragged);
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

  it('eases the pitch back without snapping', () => {
    const state = released();
    const nudged = run(state, START_FIGURE_HOLD_MS + 16);
    expect(nudged.mode).toBe('resuming');
    expect(nudged.pitch).not.toBeCloseTo(CONFIG.pitch, 3);

    const settled = run(state, START_FIGURE_HOLD_MS + 20_000);
    expect(settled.mode).toBe('auto');
    expect(settled.pitch).toBeCloseTo(CONFIG.pitch, 6);
  });

  it('keeps the yaw the user chose rather than travelling back to the front', () => {
    // Every yaw is a legitimate view, so there is no canonical angle to return
    // to — and returning to one would undo the drag in front of the user.
    const state = released();
    const settled = advanceStartFigureOrbit(
      { ...state, holdMs: 0 },
      16,
      CONFIG
    );
    expect(settled.yaw).toBeCloseTo(state.yaw, 9);
  });

  it('picks the turn back up from wherever it was left', () => {
    const state = released();
    const settled = run(state, START_FIGURE_HOLD_MS + 20_000);
    expect(settled.mode).toBe('auto');
    const after = advanceStartFigureOrbit(settled, 16, CONFIG);
    expect(normalizeAngle(after.yaw - settled.yaw)).toBeGreaterThan(0);
  });

  it('settles even under reduced motion, because a drag was asked for', () => {
    const config = { ...CONFIG, reducedMotion: true };
    const settled = run(released(), START_FIGURE_HOLD_MS + 20_000, config);
    expect(settled.mode).toBe('auto');
    expect(settled.pitch).toBeCloseTo(CONFIG.pitch, 6);
  });
});

describe('reduced motion', () => {
  it('freezes the ambient turn at the resting pose', () => {
    const config = { ...CONFIG, reducedMotion: true };
    const state = run(initialStartFigureOrbit(config), 60_000, config);
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
