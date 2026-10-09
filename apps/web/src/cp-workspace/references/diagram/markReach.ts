/**
 * How far a step diagram's marks reach as they are drawn (`DiagramPrimitives`):
 * the arrows, the turn and rotate glyphs, the rings and right angles — each
 * as far as its ink, and no further. A page's annotations and a step's own
 * marks on a Diagram page are measured with it, so the room the page leaves a
 * picture holds what is drawn in it. Measured as a page paints them, every
 * join of a stroke round (`paperSvg`) unless the mark mitres its own.
 */
import { cubicBounds, type Cubic } from '../../../lib/cubicBezier';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import {
  angleMarkArcPoints,
  angleMarkDrawn,
  arcExtremes,
  auxMarkPen,
  divisionsDrawn,
  divisionsStrokes,
  foldArrowDrawn,
  halfArrowheadCorners,
  oneWayArrowDrawn,
  pathArrowDrawn,
  pleatArrowDrawn,
  polylineMitres,
  pushArrowDrawn,
  rightAngleDrawn,
  rightAngleReach,
  rotateGlyphDrawn,
  starDrawn,
  eyeDrawn,
  strokedOutlinePoints,
  turnOverDrawn,
  whiteArrowDrawn,
  STAR_MITER_LIMIT,
  EYE_MITER_LIMIT,
  WHITE_ARROW_MITER_LIMIT,
  type Arrowhead,
  type DiagramArc,
  type DiagramProjector,
  type SvgPoint,
} from '../stepDiagramGeometry';
import { markOuterRadius, markRingWidth } from './labelLayout';

/** The primitives that are marks on a diagram, drawn over its lines in the arrow's pen or a ring's. */
export type DiagramMarkPrimitive = Extract<
  StepDiagramPrimitive,
  {
    kind:
      | 'fold-arrow'
      | 'one-way-arrow'
      | 'path-arrow'
      | 'push-arrow'
      | 'white-arrow'
      | 'turn-over'
      | 'rotate'
      | 'point'
      | 'right-angle'
      | 'angle-mark'
      | 'divisions'
      | 'star'
      | 'eye'
      | 'pleat-arrow';
  }
>;

const MARK_KINDS: ReadonlySet<StepDiagramPrimitive['kind']> = new Set<DiagramMarkPrimitive['kind']>([
  'fold-arrow',
  'one-way-arrow',
  'path-arrow',
  'push-arrow',
  'white-arrow',
  'turn-over',
  'rotate',
  'point',
  'right-angle',
  'angle-mark',
  'divisions',
  'star',
  'eye',
  'pleat-arrow',
]);

export function isDiagramMark(primitive: StepDiagramPrimitive): primitive is DiagramMarkPrimitive {
  return MARK_KINDS.has(primitive.kind);
}

/**
 * Each point a mark reaches as drawn by `project`, landing on the rings at
 * `marks`, and the room round it its ink takes (`take(x, y, pad)`), in the
 * projector's px.
 *
 * An arrow: its strokes half their pen round their curves' bounds — a round
 * cap or join, or a butt end's corners, reach no further — and its head as
 * drawn, filled to its corners, or a mountain's outline mitred round its own.
 */
export function markReach(
  primitive: DiagramMarkPrimitive,
  project: DiagramProjector,
  marks: readonly SvgPoint[],
  take: (x: number, y: number, pad: number) => void
): void {
  const pen = project.pens.arrow.width * project.ink;
  const arcStroke = (arc: DiagramArc | null) => {
    if (!arc) return;
    for (const { x, y } of arcExtremes(arc, project)) take(x, y, pen / 2);
  };
  const cubicStroke = (path: readonly Cubic[]) => {
    for (const cubic of path) {
      const box = cubicBounds(cubic);
      take(box.minX, box.minY, pen / 2);
      take(box.maxX, box.maxY, pen / 2);
    }
  };
  const polylineStroke = (points: readonly (readonly [number, number])[]) => {
    for (const [x, y] of points) take(x, y, pen / 2);
  };
  // A filled head is inside its tip and barbs: its back curves in to the notch.
  const filledHead = (head: Arrowhead) => {
    for (const { x, y } of [head.tip, ...head.barbs]) take(x, y, 0);
  };
  const mountainHead = (head: Arrowhead, centre: SvgPoint) => {
    for (const { x, y } of strokedOutlinePoints(halfArrowheadCorners(head, centre), pen)) take(x, y, 0);
  };
  switch (primitive.kind) {
    case 'fold-arrow': {
      const arrow = foldArrowDrawn(primitive.out, project, marks);
      if (!arrow) break;
      arcStroke(arrow.out);
      arcStroke(arrow.back);
      filledHead(arrow.head);
      break;
    }
    case 'one-way-arrow': {
      const arrow = oneWayArrowDrawn(primitive.out, project, marks);
      arcStroke(arrow.shaft);
      if (primitive.fold === 'mountain') mountainHead(arrow.head, project(primitive.out.center));
      else filledHead(arrow.head);
      break;
    }
    case 'path-arrow': {
      const arrow = pathArrowDrawn(primitive.path, primitive.fold, project, marks, primitive.back);
      if (!arrow) break;
      cubicStroke(arrow.shaft ?? []);
      polylineStroke(arrow.back ?? []);
      if (primitive.fold === 'mountain') mountainHead(arrow.head, arrow.inside);
      else filledHead(arrow.head);
      break;
    }
    case 'pleat-arrow': {
      // Its bolt, half its pen round each point and its Zs' mitres out past
      // that, and its head, filled.
      const arrow = pleatArrowDrawn(primitive.from, primitive.to, primitive.kinks, primitive.mirrored, project);
      if (!arrow) break;
      const shaft = arrow.shaft ?? [];
      polylineStroke(shaft.map(({ x, y }) => [x, y] as const));
      for (const { x, y } of polylineMitres(shaft, pen)) take(x, y, 0);
      filledHead(arrow.head);
      break;
    }
    case 'push-arrow': {
      // Its outline's corners, mitred.
      const outline = pushArrowDrawn(primitive.from, primitive.to, project);
      if (!outline) break;
      for (const { x, y } of strokedOutlinePoints(outline, pen)) take(x, y, 0);
      break;
    }
    case 'white-arrow': {
      // Its outline's corners, mitred as its stroke mitres them: to its own
      // limit, past which a corner is bevelled.
      const outline = whiteArrowDrawn(primitive.path, primitive.width, primitive.tail, project);
      if (!outline) break;
      for (const { x, y } of strokedOutlinePoints(outline, pen, WHITE_ARROW_MITER_LIMIT)) take(x, y, 0);
      break;
    }
    case 'turn-over': {
      // Its stroke's curves, half its pen round them, and its head, filled.
      const glyph = turnOverDrawn(primitive.at, primitive.axis, project);
      for (const { x, y } of glyph.corners) take(x, y, pen / 2);
      for (const { x, y } of glyph.head) take(x, y, 0);
      break;
    }
    case 'rotate': {
      // Its circle's box — a little more than its arcs reach at the gaps at
      // its sides — and its heads, filled, which a heavy pen makes longer.
      const glyph = rotateGlyphDrawn(primitive.at, primitive.direction, project);
      take(glyph.centre.x, glyph.centre.y, glyph.radius + pen / 2);
      for (const head of glyph.heads) for (const { x, y } of [head.tip, head.notch, ...head.barbs]) take(x, y, 0);
      break;
    }
    case 'point': {
      // The ring's outer edge: its radius and half its stroke.
      const { x, y } = project(primitive.at);
      take(x, y, markOuterRadius(project));
      break;
    }
    case 'right-angle': {
      // Its ∟ and its square, their ends cut square and their corners
      // mitred: all six points, in the aux lines' pen.
      const shape = rightAngleDrawn(primitive.at, primitive.toward, project);
      if (!shape) break;
      const reach = rightAngleReach(auxMarkPen(project));
      for (const part of ['legs', 'square'] as const) {
        shape[part].forEach(({ x, y }, index) => take(x, y, reach[part][index]));
      }
      break;
    }
    case 'angle-mark': {
      // Its arc and its ticks' ends, butt, in the ring's pen.
      const shape = angleMarkDrawn(primitive.at, primitive.arms, primitive.ticks, project);
      if (!shape) break;
      const pad = markRingWidth(project) / 2;
      for (const { x, y } of angleMarkArcPoints(shape)) take(x, y, pad);
      for (const [a, b] of shape.ticks) {
        take(a.x, a.y, pad);
        take(b.x, b.y, pad);
      }
      break;
    }
    case 'divisions': {
      // Every stroke's ends — the line, the dividers and the ticks — cut
      // square, half their one pen round them, and the count's box, upright.
      const shape = divisionsDrawn(primitive.from, primitive.to, primitive, project);
      if (!shape) break;
      for (const [a, b] of divisionsStrokes(shape)) {
        take(a.x, a.y, shape.pen / 2);
        take(b.x, b.y, shape.pen / 2);
      }
      if (shape.number) {
        const { at, halfWidth, halfHeight } = shape.number;
        take(at.x - halfWidth, at.y - halfHeight, 0);
        take(at.x + halfWidth, at.y + halfHeight, 0);
      }
      break;
    }
    case 'star': {
      // Its tips, turned and scaled: a filled star's own, an outlined one's
      // stroke mitred round them, as it is drawn.
      const star = starDrawn(primitive.at, primitive.angle, primitive.scale, project);
      const points = primitive.fill === 'black' ? star.points : strokedOutlinePoints(star.points, star.pen, STAR_MITER_LIMIT);
      for (const { x, y } of points) take(x, y, 0);
      break;
    }
    case 'eye': {
      // Its lids' ends, cut square, and their back corner, half the pen round
      // each, and that corner's mitre: its cornea and iris lie inside the
      // lids, so their strokes reach no further.
      const eye = eyeDrawn(primitive.at, primitive.angle, primitive.scale, project);
      for (const { x, y } of eye.lids) take(x, y, eye.pen / 2);
      for (const { x, y } of polylineMitres(eye.lids, eye.pen, EYE_MITER_LIMIT)) take(x, y, 0);
      break;
    }
    default: {
      // Every mark has its reach above: a new one is a compile error here
      // until it does, rather than cut off in a file.
      const _unreached: never = primitive;
      break;
    }
  }
}
