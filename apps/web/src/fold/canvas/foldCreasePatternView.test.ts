import { describe, expect, it } from 'vitest';
import { modelViewFromCamera, unprojectDevicePoint } from '../../cp-workspace/renderer/camera';
import { foldUnitToUser } from './foldCanvasGeometry';
import { foldCpModelToUser } from './foldCreasePatternView';

const SHEET = [[2, 3], [4, 3], [2.5, 4]] as const;

describe('the Fold CP viewing side', () => {
  it('turns an asymmetric, off-origin sheet left to right and returns exactly to the front', () => {
    const front = foldCpModelToUser(SHEET, 'front');
    const back = foldCpModelToUser(SHEET, 'back');
    expect(back({ x: 2.5, y: 4 })).toEqual(foldUnitToUser({ x: 3.5, y: 4 }));
    expect(back({ x: 2, y: 3 })).toEqual(front({ x: 4, y: 3 }));
    expect(foldCpModelToUser(SHEET, 'front')({ x: 2.5, y: 4 })).toEqual(front({ x: 2.5, y: 4 }));
  });

  it('unprojects clicks and overlay positions into the original sheet frame on either side, while panned and zoomed', () => {
    for (const side of ['front', 'back'] as const) {
      const view = modelViewFromCamera(
        { centerX: 300, centerY: -420, zoom: 1.7, rotation: 0.3 },
        { width: 800, height: 600, dpr: 2 },
        foldCpModelToUser(SHEET, side)
      );
      for (const [x, y] of [...SHEET, [2.7, 3.4]]) {
        const device = { x: view.origin[0] + view.ex[0] * x + view.ey[0] * y, y: view.origin[1] + view.ex[1] * x + view.ey[1] * y };
        const picked = unprojectDevicePoint(view, device.x, device.y)!;
        expect(picked.x).toBeCloseTo(x, 10);
        expect(picked.y).toBeCloseTo(y, 10);
      }
    }
  });
});
