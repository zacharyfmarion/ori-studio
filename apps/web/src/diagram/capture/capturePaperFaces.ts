/**
 * A flat capture's faces on the paper (Revision 2): what an enlarged step's
 * frame is anchored to — `DiagramPaperFaces`, kept on the step's picture
 * beside its stored scene. Each wireframe point once, with its place on the
 * paper and on the unspread picture (the pose's side, turn and case, no
 * spread), and each face, hidden ones included, as a ring of those points
 * with its level: the faces stacked over it as the picture is seen.
 *
 * The drawn places are not kept: with a spread on, the stored scene holds
 * every face whole, one ring corner for corner with the face's own, and with
 * none they are the unspread ones.
 *
 * Pure: no store, no kernel calls — it reads the paper scene the capture has
 * already read.
 */
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { foldedPaintOrder } from '../../cp-workspace/folded/foldedFlatScene';
import { layerLevels } from '../../cp-workspace/folded/foldedLayerSpread';
import type { Point } from '../../lib/geometry';
import type { ScenePoint } from '../../lib/paper/paperScene';
import type { DiagramPaperFaces } from '../document/diagramDocument';
import { storedSceneStep } from './captureGeometry';

/**
 * Each face's level, by the kernel's scene: worked out once per scene object,
 * so a Pose session that turns and spreads the figure it holds again and again
 * orders its faces once.
 */
const levelsOf = new WeakMap<OristudioCpFoldedPaperScene, Int32Array>();

function faceLevels(kernel: OristudioCpFoldedPaperScene): Int32Array {
  let levels = levelsOf.get(kernel);
  if (!levels) {
    levels = layerLevels(kernel.faces.length, kernel.subfaces, foldedPaintOrder(kernel)).levels;
    levelsOf.set(kernel, levels);
  }
  return levels;
}

/** `value` to a multiple of `step`, without the division's noise, never -0. */
function rounded(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toPrecision(12)) + 0;
}

/**
 * A flat fold's faces as a step keeps them, for the picture `toScenePx`
 * places at `scale` scene px per kernel unit: paper places about the centre
 * of the paper's box, to the power of ten at or below the stored scene's step
 * over the scale; unspread places to the stored scene's step
 * (`storedSceneStep`), as the scene's own are. A face whose outline the
 * kernel could not name point for point on the paper has an empty ring;
 * none at all, when it named none.
 */
export function flatPaperFaces(
  kernel: OristudioCpFoldedPaperScene,
  toScenePx: (point: Point) => ScenePoint,
  scale: number
): DiagramPaperFaces | null {
  const sheet = kernel.sheet_points;
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { x, y } of sheet) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const [cx, cy] = Number.isFinite(minX) ? [(minX + maxX) / 2, (minY + maxY) / 2] : [0, 0];
  const sceneStep = storedSceneStep(kernel.sheet * scale);
  const paperStep = 10 ** Math.floor(Math.log10(sceneStep / scale));
  const named = kernel.faces.map(
    ({ points, outline }) =>
      points.length >= 3 &&
      points.length === outline.length &&
      points.every((vertex) => Number.isInteger(vertex) && vertex >= 0 && vertex < sheet.length)
  );
  // A fold named nowhere on its paper has nothing to anchor to.
  if (!named.includes(true)) return null;
  // Each point's unspread place, from the first face that names it: every face naming it places it alike.
  const unspread = new Array<ScenePoint | undefined>(sheet.length);
  kernel.faces.forEach(({ points, outline }, face) => {
    if (!named[face]) return;
    points.forEach((vertex, corner) => {
      unspread[vertex] ??= toScenePx(outline[corner]!);
    });
  });
  const levels = faceLevels(kernel);
  return {
    points: sheet.map(({ x, y }, vertex): [number, number, number, number] => {
      const [u, v] = unspread[vertex] ?? [0, 0];
      return [rounded(x - cx, paperStep), rounded(y - cy, paperStep), rounded(u, sceneStep), rounded(v, sceneStep)];
    }),
    rings: kernel.faces.map(({ points }, face) => (named[face] ? [...points] : [])),
    levels: kernel.faces.map((_, face) => levels[face] ?? 0),
  };
}
