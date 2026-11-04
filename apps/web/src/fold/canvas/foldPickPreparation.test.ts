import { describe, expect, it } from 'vitest';
import { flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldPickData, foldPickIndex, hydrateFoldPick, resolveFoldPick } from './foldPicking';
import { prepareFoldSheetBindings } from './foldPickPreparation';
import { foldPaneSpreadMap } from './foldPaneSpreadMap';
import { DEFAULT_AFFINE_SPREAD, DEFAULT_DEPTH_SPREAD } from '../../cp-workspace/folded/layerSpreadSettings';

describe('prepared Fold picking', () => {
  it('rehydrates plain worker data into working spatial queries', () => {
    const scene = flatSquareScene(), landmarks = flatSquareLandmarks();
    const original = foldPickIndex(scene, landmarks, []);
    const restored = hydrateFoldPick(scene, structuredClone(foldPickData(original)));
    for (const pane of ['folded', 'crease-pattern'] as const) for (const at of [{ x: 0, y: 0 }, { x: .5, y: .5 }, { x: .03, y: .04 }]) {
      const args = [pane, at, { point: .04, line: .04 }, { snap: 'point', free: false, edges: true }] as const;
      expect(resolveFoldPick(restored, ...args)).toEqual(resolveFoldPick(original, ...args));
    }
  });
  it('reuses the exact CP index while preserving spread target order, provenance and visible portions', () => {
    const scene = flatSquareScene(), landmarks = flatSquareLandmarks();
    const marks = [{ at: [.3, .3] as const, mark: 'm' }];
    const base = foldPickIndex(scene, landmarks, marks);
    const bindings = prepareFoldSheetBindings(scene, landmarks);
    for (const spread of [DEFAULT_AFFINE_SPREAD, DEFAULT_DEPTH_SPREAD]) {
      const before = foldPickIndex(scene, landmarks, marks, foldPaneSpreadMap(scene, spread));
      const after = foldPickIndex(scene, landmarks, marks, foldPaneSpreadMap(scene, spread, undefined, bindings), base);
      expect(after.creasePattern).toBe(base.creasePattern);
      expect(after.subfaces).toBe(base.subfaces);
      expect(foldPickData(after)).toEqual(foldPickData(before));
    }
  });
});
