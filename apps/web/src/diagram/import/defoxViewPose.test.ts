import { describe, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { halfFoldOnSheetKernelScene } from '../capture/capture.fixtures';
import { asDefoxShowed, defoxViewTurn } from './defoxViewPose';

/**
 * The half fold of `halfFoldOnSheetKernelScene` as Defox saves it: its unit
 * sheet folded along y = ½, the near half held still and the far half laid
 * over it — or the far half held and the near laid over — seen as `params`
 * says.
 */
function snapshot(params: { flip0?: boolean; rotate?: number }, held: 'near' | 'far' = 'near'): string {
  const V = [[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 1], [1, 1]];
  const Vf =
    held === 'near'
      ? [[0, 0], [1, 0], [1, 0.5], [0, 0.5], [0, 0], [1, 0]]
      : [[0, 1], [1, 1], [1, 0.5], [0, 0.5], [0, 1], [1, 1]];
  return JSON.stringify({
    fold: { V, Vf, FV: [[0, 1, 2, 3], [3, 2, 5, 4]], Ff: held === 'near' ? [false, true] : [true, false] },
    params: { flip0: false, rotate: 0.5, ...params },
  });
}

/** The kernel's back pass of a scene: mirrored side to side, each face showing its other side. */
function turnedOver(scene: OristudioCpFoldedPaperScene): OristudioCpFoldedPaperScene {
  return {
    ...scene,
    flipped: !scene.flipped,
    faces: scene.faces.map((face) => ({
      ...face,
      outline: face.outline.map(({ x, y }) => ({ x: -x, y })),
      front_up: !face.front_up,
    })),
  };
}

describe('the pose a saved Defox view shows a fold in', () => {
  it('is no turn for a view of the fold as the kernel holds it', () => {
    expect(defoxViewTurn(snapshot({}), halfFoldOnSheetKernelScene())).toEqual({ reflected: false, rotationDeg: 0 });
  });

  it('turns as the view is turned: an eighth for Defox’s rotate of 0.625', () => {
    expect(defoxViewTurn(snapshot({ rotate: 0.625 }), halfFoldOnSheetKernelScene())).toEqual({ reflected: false, rotationDeg: 45 });
  });

  it('says a view turned over shows the paper’s other side', () => {
    expect(defoxViewTurn(snapshot({ flip0: true }), halfFoldOnSheetKernelScene())?.reflected).toBe(true);
  });

  it('reads the view through Defox’s own fold: the other half held still and turned over is the kernel’s turned half round', () => {
    expect(defoxViewTurn(snapshot({ flip0: true }, 'far'), halfFoldOnSheetKernelScene())).toEqual({ reflected: false, rotationDeg: 180 });
  });

  it('turns the fold over to the side the view showed, and measures its turn there', async () => {
    const front = halfFoldOnSheetKernelScene();
    const turnOver = vi.fn(async () => turnedOver(front));
    const pose = await asDefoxShowed(snapshot({ flip0: true, rotate: 0.625 }), { side: 'front', rotationDeg: 0 }, front, turnOver);
    expect(turnOver).toHaveBeenCalledWith('back');
    // Defox turns by an eighth and then mirrors (`N.mat`); the back pass is
    // mirrored first and turned after, so the same picture is an eighth the
    // other way round.
    expect(pose).toEqual({ side: 'back', rotationDeg: 315 });
  });

  it('leaves the pose as it was where the view says nothing', async () => {
    const turnOver = vi.fn(async () => null);
    const pose = { side: 'front' as const, rotationDeg: 30, foldCase: 1 };
    expect(await asDefoxShowed('{"fold":', pose, halfFoldOnSheetKernelScene(), turnOver)).toBe(pose);
    expect(turnOver).not.toHaveBeenCalled();
  });
});
