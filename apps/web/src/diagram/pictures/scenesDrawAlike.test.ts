import { describe, expect, it } from 'vitest';
import type { PaperItem, ScenePoint } from '../../lib/paper/paperScene';
import { face, FIXTURE_SHEET_PX, line, sceneOf, SQUARE } from '../../lib/paper/paperScene.fixtures';
import { storedSceneStep } from '../capture/captureGeometry';
import { DRAWN_ALIKE_WITHIN, scenesDrawAlike } from './scenesDrawAlike';

const HALF = FIXTURE_SHEET_PX / 2;
/** Two faces side by side and the crease between them, as a clipped spread picture draws them. */
const LEFT: ScenePoint[] = [[0, 0], [HALF, 0], [HALF, FIXTURE_SHEET_PX], [0, FIXTURE_SHEET_PX]];
const RIGHT: ScenePoint[] = [[HALF, 0], [FIXTURE_SHEET_PX, 0], [FIXTURE_SHEET_PX, FIXTURE_SHEET_PX], [HALF, FIXTURE_SHEET_PX]];
const CREASE = line('valley', [HALF, 0], [HALF, FIXTURE_SHEET_PX]);
const items = (): PaperItem[] => [face([LEFT]), face([RIGHT], { face: 1 }), CREASE];
/** The largest shift two drawings of one picture may show: a share of its longer side, the fixture's sheet. */
const WITHIN = DRAWN_ALIKE_WITHIN * FIXTURE_SHEET_PX;

/** The picture with the right face's far corner moved by `by` along x. */
function cornerMoved(by: number) {
  const moved: ScenePoint[] = RIGHT.map(([x, y], k) => (k === 1 ? [x + by, y] : [x, y]));
  return sceneOf([face([LEFT]), face([moved], { face: 1 }), CREASE]);
}

describe('two stored scenes drawn alike', () => {
  it('reads one picture as itself, and as itself drawn by a hair otherwise', () => {
    expect(scenesDrawAlike(sceneOf(items()), sceneOf(items()))).toBe(true);
    expect(scenesDrawAlike(sceneOf(items()), cornerMoved(0.9 * WITHIN))).toBe(true);
    expect(scenesDrawAlike(cornerMoved(0.9 * WITHIN), sceneOf(items()))).toBe(true);
  });

  it('reads a picture moved past a fifth of a thousandth of its size as another, both ways', () => {
    expect(scenesDrawAlike(sceneOf(items()), cornerMoved(1.5 * WITHIN))).toBe(false);
    expect(scenesDrawAlike(cornerMoved(1.5 * WITHIN), sceneOf(items()))).toBe(false);
    expect(scenesDrawAlike(sceneOf(items()), cornerMoved(1))).toBe(false);
  });

  it('reads a sliver one drawing has and the other lacks as the same picture', () => {
    // A clipped piece the least height change adds, along the crease: nothing anyone sees.
    const sliver = face([[[HALF, 10], [HALF + 0.001, 10], [HALF + 0.001, 60], [HALF, 60]]], { face: 2 });
    expect(scenesDrawAlike(sceneOf(items()), sceneOf([...items(), sliver]))).toBe(true);
    expect(scenesDrawAlike(sceneOf([...items(), sliver]), sceneOf(items()))).toBe(true);
    // One that reaches into the face is a piece anyone would see.
    const piece = face([[[HALF, 10], [HALF + 5, 10], [HALF + 5, 60], [HALF, 60]]], { face: 2 });
    expect(scenesDrawAlike(sceneOf(items()), sceneOf([...items(), piece]))).toBe(false);
  });

  it('reads the lines as part of the drawing', () => {
    const away = line('mountain', [10, 10], [40, 40]);
    expect(scenesDrawAlike(sceneOf(items()), sceneOf([...items(), away]))).toBe(false);
    // A line along an edge the other draws is drawn there already.
    expect(scenesDrawAlike(sceneOf(items()), sceneOf([...items(), line('edge', [0, 0], [HALF, 0])]))).toBe(true);
  });

  it('allows a picture a few of its stored grid steps, however small it is', () => {
    const tiny = (by: number) => sceneOf([face([SQUARE.map(([x, y], k): ScenePoint => [x * 1e-4 + (k === 2 ? by : 0), y * 1e-4])])]);
    const step = storedSceneStep(FIXTURE_SHEET_PX);
    expect(scenesDrawAlike(tiny(0), tiny(2 * step))).toBe(true);
    expect(scenesDrawAlike(tiny(0), tiny(8 * step))).toBe(false);
  });
});
