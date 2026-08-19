import { describe, expect, it } from 'vitest';
import { normalizeAngle } from '../../lib/simulatorOrbit';
import {
  START_FIGURE_HOLD_MS,
  START_FIGURE_TURN_PERIOD_MS,
  advanceStartFigureOrbit,
  beginStartFigureDrag,
  dragStartFigureOrbit,
  endStartFigureDrag,
  initialStartFigureOrbit,
  type StartFigureOrbitConfig,
  type StartFigureOrbitState,
} from './startFigureOrbit';

const CONFIG: StartFigureOrbitConfig = { yaw: 0, reducedMotion: false };

/** Run the loop the component runs, at a fixed frame time. */
function run(
  state: StartFigureOrbitState,
  ms: number,
  config = CONFIG,
  frameMs = 16,
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

describe('one axis', () => {
  it('has no state but the yaw and the mode', () => {
    // The point of the module, asserted structurally: pitch is not
    // representable here, so nothing can drift it. A change that reintroduces
    // it has to change this test, which is the intent.
    expect(Object.keys(initialStartFigureOrbit(CONFIG)).sort()).toEqual(['holdMs', 'mode', 'yaw']);
  });

  it('takes no vertical delta at all', () => {
    // Not "ignores it" — there is no parameter to pass one to.
    expect(dragStartFigureOrbit.length).toBe(2);
  });
});

describe('the turn', () => {
  it('starts at the pose the asset chose', () => {
    const state = initialStartFigureOrbit(CONFIG);
    expect(state.yaw).toBe(CONFIG.yaw);
    expect(state.mode).toBe('auto');
  });

  it('goes all the way round, so the side and the back are seen', () => {
    const travelled = travel(initialStartFigureOrbit(CONFIG), START_FIGURE_TURN_PERIOD_MS);
    expect(travelled).toBeCloseTo(Math.PI * 2, 1);
  });

  it('keeps turning the same way past a full revolution', () => {
    const travelled = travel(initialStartFigureOrbit(CONFIG), START_FIGURE_TURN_PERIOD_MS * 2.5);
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
    const dragged = dragStartFigureOrbit(start, -100);
    expect(normalizeAngle(dragged.yaw - start.yaw)).toBeCloseTo(1, 6);
  });

  it('lets a drag carry the figure all the way round', () => {
    // Yaw is unclamped on purpose: every angle is a legitimate view of a
    // turntable, so there is nothing to stop the user reaching the back.
    let state = beginStartFigureDrag(initialStartFigureOrbit(CONFIG));
    let travelled = 0;
    for (let i = 0; i < 20; i += 1) {
      const next = dragStartFigureOrbit(state, -40);
      travelled += normalizeAngle(next.yaw - state.yaw);
      state = next;
    }
    expect(Math.abs(travelled)).toBeGreaterThan(Math.PI * 2);
  });

  it('is not overridden by the turn while the pointer is down', () => {
    const dragged = dragStartFigureOrbit(
      beginStartFigureDrag(initialStartFigureOrbit(CONFIG)),
      -220,
    );
    expect(run(dragged, 3_000)).toEqual(dragged);
  });
});

describe('resuming after a release', () => {
  function released(): StartFigureOrbitState {
    return endStartFigureDrag(
      dragStartFigureOrbit(beginStartFigureDrag(initialStartFigureOrbit(CONFIG)), -180),
    );
  }

  it('holds where the user left it before taking the figure back', () => {
    const state = released();
    const held = run(state, START_FIGURE_HOLD_MS - 500);
    expect(held.mode).toBe('resuming');
    expect(held.yaw).toBeCloseTo(state.yaw, 9);
  });

  it('keeps the yaw the user chose rather than travelling back to the front', () => {
    // Every yaw is a legitimate view, so there is no canonical angle to return
    // to — and returning to one would undo the drag in front of the user.
    const state = released();
    const resumed = run(state, START_FIGURE_HOLD_MS + 16);
    expect(resumed.mode).toBe('auto');
    expect(normalizeAngle(resumed.yaw - state.yaw)).toBeLessThan(0.02);
  });

  it('picks the turn back up from wherever it was left', () => {
    const settled = run(released(), START_FIGURE_HOLD_MS + 100);
    expect(settled.mode).toBe('auto');
    const after = advanceStartFigureOrbit(settled, 16, CONFIG);
    expect(normalizeAngle(after.yaw - settled.yaw)).toBeGreaterThan(0);
  });

  it('hands the figure back even under reduced motion, rather than sticking', () => {
    // The `auto` early-return must not swallow the hold, or a released drag
    // would leave the state in `resuming` forever.
    const config = { ...CONFIG, reducedMotion: true };
    const settled = run(released(), START_FIGURE_HOLD_MS + 100, config);
    expect(settled.mode).toBe('auto');
  });
});

describe('reduced motion', () => {
  it('freezes the ambient turn at the resting pose', () => {
    const config = { ...CONFIG, reducedMotion: true };
    const state = run(initialStartFigureOrbit(config), 60_000, config);
    expect(state.yaw).toBe(CONFIG.yaw);
  });

  it('still lets the figure be dragged', () => {
    const dragged = dragStartFigureOrbit(
      beginStartFigureDrag(initialStartFigureOrbit({ ...CONFIG, reducedMotion: true })),
      -100,
    );
    expect(dragged.yaw).not.toBe(CONFIG.yaw);
  });
});
