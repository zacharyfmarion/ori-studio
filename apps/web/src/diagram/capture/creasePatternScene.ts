/**
 * A crease-pattern step's picture (D5): the scope's paper as one face, and its
 * lines over it, each with the role that picks its pen. On a diagram a crease
 * pattern is an instruction, drawn as References draws a step: its mountains
 * and valleys in the diagram-crease pens — the folds to make — its aux lines
 * in the aux pen, as the creases already in the paper, and its border in the
 * edge pen. Built straight from the kernel's lines, with no fold.
 *
 * Pure: no store, no kernel.
 */
import type { OristudioCpDocumentSnapshot, FoldedSourceBounds } from '../../engine/oristudioCpTypes';
import type { Point } from '../../lib/geometry';
import type {
  PaperFaceItem,
  PaperItem,
  PaperLineItem,
  PaperLineRole,
  PaperScene,
  ScenePoint,
} from '../../lib/paper/paperScene';
import type { StepCreases } from './captureCreases';
import { CAPTURE_PX_PER_UNIT, sceneBoundsOf, turnClockwise } from './captureGeometry';

/** What a kernel line is on the paper, by its colour. */
function lineRole(color: string): PaperLineRole {
  switch (color) {
    case 'Black0':
      return 'edge';
    case 'Red1':
      return 'diagram-mountain';
    case 'Blue2':
      return 'diagram-valley';
    default:
      // Cyan3, and any other colour a construction line can carry.
      return 'aux';
  }
}

/** Which draws over which: aux lines under the folds, the paper's edge over all. */
const ROLE_LAYER: Partial<Record<PaperLineRole, number>> = {
  aux: 0,
  'diagram-mountain': 1,
  'diagram-valley': 1,
  edge: 2,
};

/**
 * The scope's creases as a scene, turned clockwise by `rotationDeg` about the
 * paper's centre, at {@link CAPTURE_PX_PER_UNIT}: the size Edit draws a
 * pattern at 100%, so a step and the model it folds into share one scale.
 */
export function creasePatternScene(
  document: OristudioCpDocumentSnapshot,
  creases: StepCreases,
  rotationDeg: number
): PaperScene {
  const paperBox = boxOf(creases.paper.flat());
  const span = Math.max(paperBox.maxX - paperBox.minX, paperBox.maxY - paperBox.minY);
  const epsilon = Math.max(span, 1) * 1e-6;
  const centre = { x: (paperBox.minX + paperBox.maxX) / 2, y: (paperBox.minY + paperBox.maxY) / 2 };
  const turn = turnClockwise(rotationDeg);
  const toScene = (point: Point): ScenePoint => {
    const turned = turn({ x: point.x - centre.x, y: point.y - centre.y });
    return [turned.x * CAPTURE_PX_PER_UNIT, turned.y * CAPTURE_PX_PER_UNIT];
  };

  const drawn: { role: PaperLineRole; a: Point; b: Point }[] = [];
  for (const id of creases.scopedLineIds) {
    const line = document.crease_pattern.line_segments[id - 1];
    if (!line) continue;
    if (Math.hypot(line.b.x - line.a.x, line.b.y - line.a.y) <= epsilon) continue;
    drawn.push({ role: lineRole(line.color), a: line.a, b: line.b });
  }
  drawn.sort((left, right) => (ROLE_LAYER[left.role] ?? 0) - (ROLE_LAYER[right.role] ?? 0));

  // Where lines meet: an end another line starts or ends at is a joint the
  // painter closes rather than caps.
  const ends = new Map<string, number>();
  const endKey = (point: Point) => `${point.x},${point.y}`;
  for (const { a, b } of drawn) {
    for (const end of [a, b]) ends.set(endKey(end), (ends.get(endKey(end)) ?? 0) + 1);
  }
  const folds = drawn.filter((line) => line.role !== 'aux');
  // An aux line's end retreats where it meets the paper's edge or a fold: the
  // face it lies on ends there (the Diagram preset's erode).
  const meetsFace = (point: Point) =>
    onRings(creases.paper, point, epsilon) ||
    folds.some((fold) => distanceToSegment(point, fold.a, fold.b) <= epsilon);

  const face: PaperFaceItem = {
    kind: 'face',
    face: 0,
    side: 'front',
    rings: creases.paper.map((ring) => ring.map(toScene)),
    shade: 1,
    hidden: false,
  };
  const items: PaperItem[] = [face];
  for (const { role, a, b } of drawn) {
    const item: PaperLineItem = {
      kind: 'line',
      role,
      a: toScene(a),
      b: toScene(b),
      onBoundary: role === 'aux' ? [meetsFace(a), meetsFace(b)] : [false, false],
      joined: [(ends.get(endKey(a)) ?? 0) > 1, (ends.get(endKey(b)) ?? 0) > 1],
      face: 0,
      hidden: false,
    };
    items.push(item);
  }
  return { bounds: sceneBoundsOf(items), sheet: span * CAPTURE_PX_PER_UNIT, items };
}

function boxOf(points: readonly Point[]): FoldedSourceBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
}

function onRings(rings: readonly Point[][], point: Point, epsilon: number): boolean {
  return rings.some((ring) =>
    ring.some((corner, index) => distanceToSegment(point, corner, ring[(index + 1) % ring.length]!) <= epsilon)
  );
}

function distanceToSegment(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t =
    lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}
