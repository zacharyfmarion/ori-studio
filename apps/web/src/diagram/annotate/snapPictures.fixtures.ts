import type { StepDiagramModel } from '../../cp-workspace/references/referenceFinderDiagramToPrimitives';
import { sheetCorners } from '../../cp-workspace/references/stepDiagramGeometry';
import type { PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import type { DiagramCpRender, DiagramPicture, DiagramStep } from '../document/diagramDocument';
import { cpStep, referencesStep } from '../document/diagramSteps.fixtures';
import { stepDiagramToPicture } from '../pictures/paintStepDiagram';
import type { PicturePoint } from './annotationModel';
import pictures from './__fixtures__/snapPictures.json';

/**
 * Real step pictures for the snapping and right-angle tests, as the app
 * captured them (`__fixtures__/snapPictures.json`): Zach's crane diagram's
 * crease pattern, three flat folds (one from the back) and two References
 * steps (one mirrored), and box_90's crease pattern and 3D fold — both his
 * own files.
 *
 * Beside them, each picture read the long way — every point and segment
 * straight from the stored picture, crossings pair by pair — for the tests to
 * hold the index to.
 */

interface FixturePicture {
  name: string;
  render?: unknown;
  side?: 'front' | 'back';
  picture: unknown;
}

function stepOf({ name, render, side, picture }: FixturePicture): DiagramStep {
  const base = render ? cpStep(name, render as DiagramCpRender) : referencesStep(name, { side: side ?? 'front' });
  return { ...base, picture: picture as DiagramPicture };
}

export const REAL_PICTURES: readonly { name: string; step: DiagramStep }[] = (pictures as FixturePicture[]).map(
  (fixture) => ({ name: fixture.name, step: stepOf(fixture) })
);

export function realPicture(name: string): DiagramStep {
  const found = REAL_PICTURES.find((entry) => entry.name === name);
  if (!found) throw new Error(`no fixture ${name}`);
  return found.step;
}

export type Segment = [PicturePoint, PicturePoint];

/** A picture read the long way: its points to snap to, its segments, and whether its own lines cross. */
export function readLongWay(step: DiagramStep): { points: PicturePoint[]; segments: Segment[]; crossings: boolean } {
  const { picture, source } = step;
  if (picture?.kind === 'step-diagram') {
    const model: StepDiagramModel = picture.model;
    const map = stepDiagramToPicture(model, picture.mirrored);
    const corners = sheetCorners(model.sheet).map(map);
    const segments: Segment[] = corners.map((corner, index) => [corner, corners[(index + 1) % 4]!]);
    const points = [...corners];
    for (const primitive of model.primitives) {
      if (primitive.kind === 'line' && primitive.style !== 'arrow') {
        segments.push([map(primitive.from), map(primitive.to)]);
        points.push(map(primitive.from), map(primitive.to));
      }
      if (primitive.kind === 'point') points.push(map(primitive.at));
    }
    return { points, segments, crossings: true };
  }
  if (picture?.kind !== 'scene' || source?.kind !== 'cp') throw new Error('a scene of a linked pattern');
  const mode = source.render.mode;
  const scene = JSON.parse(picture.sceneJson) as PaperScene;
  const { minX, minY, maxX, maxY } = scene.bounds;
  const longer = Math.max(maxX - minX, maxY - minY);
  const map = ([x, y]: ScenePoint): PicturePoint => [(x - minX) / longer, (y - minY) / longer];
  const points: PicturePoint[] = [];
  const segments: Segment[] = [];
  for (const item of scene.items) {
    if (item.kind === 'face' && mode !== 'folded-3d' && mode !== 'simulated') {
      for (const ring of item.rings) {
        ring.forEach((at, index) => {
          points.push(map(at));
          segments.push([map(at), map(ring[(index + 1) % ring.length]!)]);
        });
      }
    }
    if (item.kind === 'line') {
      const { a, b } = item.whole ?? item;
      points.push(map(a), map(b));
      segments.push([map(a), map(b)]);
    }
  }
  return { points, segments, crossings: mode === 'crease-pattern' };
}

export const distance = (a: PicturePoint, b: PicturePoint) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function onSegment(at: PicturePoint, [a, b]: Segment): boolean {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((at[0] - a[0]) * dx + (at[1] - a[1]) * dy) / (dx * dx + dy * dy)));
  return distance(at, [a[0] + t * dx, a[1] + t * dy]) < 1e-6;
}

/** Every proper crossing, all four ends kept off it, found pair by pair. */
export function allCrossings(segments: readonly Segment[]): PicturePoint[] {
  const found: PicturePoint[] = [];
  segments.forEach(([a, b], i) => {
    for (const [c, d] of segments.slice(i + 1)) {
      const rx = b[0] - a[0];
      const ry = b[1] - a[1];
      const sx = d[0] - c[0];
      const sy = d[1] - c[1];
      const denominator = rx * sy - ry * sx;
      if (Math.abs(denominator) < 1e-12) continue;
      // Along one line, to a stored scene's rounding: no crossing.
      const offFirst = (p: PicturePoint) => Math.abs((p[0] - a[0]) * ry - (p[1] - a[1]) * rx) / Math.hypot(rx, ry);
      const offSecond = (p: PicturePoint) => Math.abs((p[0] - c[0]) * sy - (p[1] - c[1]) * sx) / Math.hypot(sx, sy);
      if ((offFirst(c) <= 5e-5 && offFirst(d) <= 5e-5) || (offSecond(a) <= 5e-5 && offSecond(b) <= 5e-5)) continue;
      const t = ((c[0] - a[0]) * sy - (c[1] - a[1]) * sx) / denominator;
      const u = ((c[0] - a[0]) * ry - (c[1] - a[1]) * rx) / denominator;
      if (t < 0 || t > 1 || u < 0 || u > 1) continue;
      const at: PicturePoint = [a[0] + t * rx, a[1] + t * ry];
      if ([a, b, c, d].some((end) => distance(end, at) < 1e-4)) continue;
      found.push(at);
    }
  });
  return found;
}

/** Pointers on a grid over the frame and a little past it. */
export function pointerGrid(step: number): PicturePoint[] {
  const out: PicturePoint[] = [];
  for (let x = -0.05; x <= 1.05; x += step) for (let y = -0.05; y <= 1.05; y += step) out.push([x, y]);
  return out;
}

/** Whether two unit directions are square to each other, within a degree. */
export function square([ax, ay]: PicturePoint, [bx, by]: PicturePoint): boolean {
  return Math.abs(ax * bx + ay * by) < Math.sin(Math.PI / 180);
}
