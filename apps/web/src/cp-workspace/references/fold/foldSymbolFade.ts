/**
 * A step's symbols — the arrow, the lettered marks, the rings — describe the
 * paper as it lies flat. Once a flap has lifted, a letter still printed where
 * its mark *was* refers to nothing, and an arrow from there points from
 * nowhere. So the symbols that ride the moving paper fade out as it lifts and
 * fade back in as it comes down, while those on the paper that stays put
 * stay put too.
 *
 * Pure: which flap a symbol rides is read off the fold's geometry once, and
 * the opacity is arithmetic on the pose the transport pushes each frame.
 */
import type { Point } from '../../../lib/geometry';
import { sideOf } from '../diagram/plannerDiagram';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import { arcSamplePoints } from '../stepDiagramGeometry';
import type { FoldPose } from './foldPlayback';
import type { FoldFlapScene, FoldScene } from './foldScene';

/** The swing by which a symbol on the moving paper has faded out entirely. */
export const SYMBOL_FADE_ANGLE = Math.PI / 4;

const point = (p: readonly [number, number]): Point => ({ x: p[0], y: p[1] });

/**
 * Where a symbol sits on the paper, in model space, or null for one that has
 * no place of its own. An arrow's place is where it leaves from: it is drawn
 * for the point that moves, and a line from there is what stops making sense.
 */
export function symbolAnchor(primitive: StepDiagramPrimitive): Point | null {
  switch (primitive.kind) {
    case 'sheet':
      return null;
    case 'line':
      return {
        x: (primitive.from[0] + primitive.to[0]) / 2,
        y: (primitive.from[1] + primitive.to[1]) / 2,
      };
    case 'arc':
      return point(arcSamplePoints(primitive)[0]);
    case 'fold-arrow':
      return point(arcSamplePoints(primitive.out)[0]);
    case 'region': {
      const n = primitive.corners.length;
      if (n === 0) return null;
      let x = 0;
      let y = 0;
      for (const corner of primitive.corners) {
        x += corner[0];
        y += corner[1];
      }
      return { x: x / n, y: y / n };
    }
    case 'turn-over':
    case 'point':
    case 'label':
      return point(primitive.at);
  }
}

/** Inside a convex polygon or on its edge, within `tolerance` of the edge. */
function insidePolygon(polygon: readonly Point[], p: Point, tolerance: number): boolean {
  const n = polygon.length;
  if (n < 3) return false;
  let area = 0;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  const orientation = Math.sign(area);
  if (orientation === 0) return false;
  for (let i = 0; i < n; i += 1) {
    const a = polygon[i]!;
    const b = polygon[(i + 1) % n]!;
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const cross = ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / length;
    if (cross * orientation < -tolerance) return false;
  }
  return true;
}

/** A symbol rides a flap when it sits on that flap's paper and not on the hinge. */
function ridesFlap(anchor: Point, flap: FoldFlapScene, tolerance: number): boolean {
  if (flap.whole) return true;
  if (sideOf(flap.chord, anchor) === 0) return false;
  return insidePolygon(flap.polygon, anchor, tolerance);
}

/**
 * Which of the fold's flaps a symbol rides, or null when it stays where it
 * is: on the paper that does not move, on the hinge itself, or off the
 * sheet altogether — the mark a flap is folded *to* is as often outside the
 * paper as on it, and it goes nowhere either way.
 */
export function symbolFlap(primitive: StepDiagramPrimitive, scene: FoldScene): number | null {
  const anchor = symbolAnchor(primitive);
  if (!anchor) return null;
  const tolerance = scene.sheetShortSide * 1e-9;
  const index = scene.flaps.findIndex((flap) => ridesFlap(anchor, flap, tolerance));
  return index < 0 ? null : index;
}

const smoothstep = (t: number): number => {
  const x = Math.max(0, Math.min(1, t));
  return x * x * (3 - 2 * x);
};

/**
 * How visible a symbol riding `flap` is under `pose`: 1 with the paper flat,
 * 0 once it has lifted through {@link SYMBOL_FADE_ANGLE}, and back to 1 the
 * same way as it comes down. A symbol on a flap that is not the one moving
 * — a twin's other half — is untouched.
 */
export function symbolOpacity(flap: number | null, pose: FoldPose | null): number {
  if (flap === null || !pose || pose.flap !== flap) return 1;
  return 1 - smoothstep(pose.angle / SYMBOL_FADE_ANGLE);
}
