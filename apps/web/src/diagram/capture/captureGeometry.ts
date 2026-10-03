/**
 * The measures every capture shares, so a crease pattern, the flat model it
 * folds into and its 3D form come out at one scale, and are stored alike.
 *
 * Pure.
 */
import { foldedFigureUserPerModelUnit } from '../../cp-workspace/adapters/cpFoldedToScene';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type { PaperItem, PaperScene, SceneBounds, ScenePoint } from '../../lib/paper/paperScene';

export { turnClockwise } from '../../lib/geometry';

/**
 * Scene px per pattern unit: the size Edit draws a pattern and its folded
 * figure at 100%, which is also the space a 3D figure's scene is built in. One
 * scale for every capture is what makes a step's paper scale (D10) mean the
 * same thing on each.
 */
export const CAPTURE_PX_PER_UNIT = Number(
  // Rounded: the affine it is read off leaves float noise, and it is written into every step.
  foldedFigureUserPerModelUnit({ placement: IDENTITY_FOLDED_PLACEMENT }).toPrecision(12)
);

/** The extent of every item; zeros when there are none. */
export function sceneBoundsOf(items: readonly PaperItem[]): SceneBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const take = ([x, y]: ScenePoint) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  for (const item of items) {
    if (item.kind === 'face') item.rings.forEach((ring) => ring.forEach(take));
    else if (item.kind === 'line') {
      take(item.a);
      take(item.b);
    } else {
      take([item.bounds.minX, item.bounds.minY]);
      take([item.bounds.maxX, item.bounds.maxY]);
    }
  }
  return minX === Infinity ? { minX: 0, minY: 0, maxX: 0, maxY: 0 } : { minX, minY, maxX, maxY };
}

/**
 * A scene as a step keeps it (D2): nothing hidden — a page never shows a buried
 * face — no markup, and every coordinate to a fixed step, so the stored string
 * carries no float noise. The step is 0.01 scene px on a sheet of 400 px or
 * more, and finer on a smaller one, so no sheet loses its shape to it.
 */
export function storableScene(scene: PaperScene): PaperScene {
  const step = Math.min(0.01, Math.max(scene.sheet, 1e-9) / 40_000);
  const snap = (value: number) => {
    const snapped = Math.round(value / step) * step;
    // Round off the division's own noise, and never write -0.
    return Number(snapped.toPrecision(12)) + 0;
  };
  const point = ([x, y]: ScenePoint): ScenePoint => [snap(x), snap(y)];
  const items: PaperItem[] = [];
  for (const item of scene.items) {
    if (item.hidden || item.kind === 'markup') continue;
    if (item.kind === 'face') {
      items.push({ ...item, rings: item.rings.map((ring) => ring.map(point)) });
    } else {
      const { whole, ...line } = item;
      items.push({
        ...line,
        a: point(item.a),
        b: point(item.b),
        ...(whole ? { whole: { ...whole, a: point(whole.a), b: point(whole.b) } } : {}),
      });
    }
  }
  return { bounds: sceneBoundsOf(items), sheet: scene.sheet, items };
}
