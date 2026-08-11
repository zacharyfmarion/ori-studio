import { describe, expect, it } from 'vitest';

import {
  advanceFoldedFigureOrbit,
  beginFoldedFigureOrbit,
  foldedFigureOrbitChanged,
  foldedFigureOrbitClaimsPress,
} from './foldedFigureOrbitGesture';
import { DEFAULT_FOLDED_3D_CAMERA } from './foldedFigure3dProjection';
import {
  SIMULATOR_ORBIT_SENSITIVITY,
  nextSimulatorOrbitView,
} from '../../lib/simulatorOrbit';
import type { AnnotationBox } from '../annotations/annotationTransform';

const BOX: AnnotationBox = { center: { x: 100, y: 100 }, width: 40, height: 20, rotation: 0 };

describe('foldedFigureOrbitClaimsPress', () => {
  it('declines every press while nothing is focused', () => {
    expect(foldedFigureOrbitClaimsPress(null, 'a', BOX, { x: 100, y: 100 })).toBe(false);
  });

  it('declines a press on a figure that is selected but not the focused one', () => {
    // The whole reason focus is a second press: an unfocused figure must keep
    // its move gesture, or nudging one becomes impossible.
    expect(foldedFigureOrbitClaimsPress('a', 'b', BOX, { x: 100, y: 100 })).toBe(false);
  });

  it('claims a press inside the focused figure', () => {
    expect(foldedFigureOrbitClaimsPress('a', 'a', BOX, { x: 100, y: 100 })).toBe(true);
  });

  it('declines a press outside the focused figure, so the canvas keeps it', () => {
    expect(foldedFigureOrbitClaimsPress('a', 'a', BOX, { x: 400, y: 400 })).toBe(false);
  });

  it('declines when the figure has no box — mid-fold, errored, or drawing nothing', () => {
    expect(foldedFigureOrbitClaimsPress('a', 'a', null, { x: 100, y: 100 })).toBe(false);
  });

  it('follows the box rotation rather than its axis-aligned bounds', () => {
    const turned: AnnotationBox = { ...BOX, rotation: Math.PI / 2 };
    // (100, 115) is outside the unrotated 40x20 box and inside it once turned a
    // quarter turn, so an axis-aligned test would answer this one wrong.
    expect(foldedFigureOrbitClaimsPress('a', 'a', BOX, { x: 100, y: 115 })).toBe(false);
    expect(foldedFigureOrbitClaimsPress('a', 'a', turned, { x: 100, y: 115 })).toBe(true);
  });
});

describe('orbit', () => {
  it('anchors on the camera the press landed on', () => {
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 10, y: 20 });
    expect(drag).toEqual({
      x: 10,
      y: 20,
      yaw: DEFAULT_FOLDED_3D_CAMERA.yaw,
      pitch: DEFAULT_FOLDED_3D_CAMERA.pitch,
    });
  });

  it('is measured from the press, not integrated frame to frame', () => {
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 0, y: 0 });
    const direct = advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 60, y: 0 });
    // Same anchor, same endpoint, reached in two reads instead of one: identical,
    // because nothing accumulates in the camera between moves.
    const viaMidpoint = advanceFoldedFigureOrbit(
      advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 30, y: 0 }),
      drag,
      { x: 60, y: 0 }
    );
    expect(viaMidpoint.yaw).toBeCloseTo(direct.yaw, 12);
    expect(viaMidpoint.pitch).toBeCloseTo(direct.pitch, 12);
  });

  it('turns a figure by exactly what the same drag turns a simulation (R7)', () => {
    // The shared-sensitivity guarantee. If someone forks the constant or the
    // formula, a figure and a simulation stop agreeing and this fails.
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 5, y: 5 });
    const point = { x: 85, y: -35 };
    const figure = advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, point);
    const simulation = nextSimulatorOrbitView(
      { ...DEFAULT_FOLDED_3D_CAMERA },
      drag,
      point
    );
    expect(figure.yaw).toBe(simulation.yaw);
    expect(figure.pitch).toBe(simulation.pitch);
    // And the constant is genuinely in play, so the assertion above is not
    // comparing two copies of "unchanged".
    expect(figure.yaw).not.toBe(DEFAULT_FOLDED_3D_CAMERA.yaw);
    expect(SIMULATOR_ORBIT_SENSITIVITY).toBeGreaterThan(0);
  });

  it('carries zoom through untouched — scroll does not zoom a focused figure', () => {
    const camera = { ...DEFAULT_FOLDED_3D_CAMERA, zoom: 2.5 };
    const drag = beginFoldedFigureOrbit(camera, { x: 0, y: 0 });
    expect(advanceFoldedFigureOrbit(camera, drag, { x: 200, y: 200 }).zoom).toBe(2.5);
  });

  it('reports a press-and-release with no movement as no orbit at all', () => {
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 42, y: 7 });
    const after = advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 42, y: 7 });
    expect(foldedFigureOrbitChanged(DEFAULT_FOLDED_3D_CAMERA, after)).toBe(false);
  });

  it('returns the anchor bit-exactly on a zero-distance drag, not merely close', () => {
    // `normalizeAngle` loses a ULP round-tripping an in-range angle, so the
    // shared orbit alone answers a click with a camera ~1e-17 from where it
    // started. Exact equality is the assertion that would fail if that guard
    // were dropped; `toBeCloseTo` would not.
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 42, y: 7 });
    const after = advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 42, y: 7 });
    expect(after.yaw).toBe(DEFAULT_FOLDED_3D_CAMERA.yaw);
    expect(after.pitch).toBe(DEFAULT_FOLDED_3D_CAMERA.pitch);
    // And the drift it is guarding against is real, so this test is not vacuous.
    const unguarded = nextSimulatorOrbitView({ ...DEFAULT_FOLDED_3D_CAMERA }, drag, {
      x: 42,
      y: 7,
    });
    expect(unguarded.pitch).not.toBe(DEFAULT_FOLDED_3D_CAMERA.pitch);
  });

  it('returns to the anchor when a drag wanders and comes back', () => {
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 42, y: 7 });
    advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 200, y: -90 });
    const back = advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 42, y: 7 });
    expect(foldedFigureOrbitChanged(DEFAULT_FOLDED_3D_CAMERA, back)).toBe(false);
  });

  it('reports a real turn as a change, so it takes its one undo entry', () => {
    const drag = beginFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, { x: 0, y: 0 });
    const after = advanceFoldedFigureOrbit(DEFAULT_FOLDED_3D_CAMERA, drag, { x: 40, y: 12 });
    expect(foldedFigureOrbitChanged(DEFAULT_FOLDED_3D_CAMERA, after)).toBe(true);
  });
});
