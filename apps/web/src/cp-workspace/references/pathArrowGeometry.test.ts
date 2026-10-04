import { describe, expect, it } from 'vitest';
import { cubicTangent, measurePath, nearestOnPath, pathPointAt, type Cubic, type Vec2 } from '../../lib/cubicBezier';
import {
  arrowheadReach,
  arrowheadSize,
  createOverlayProjector,
  cubicPathData,
  foldArrowArc,
  foldReturnOffset,
  halfArrowheadPath,
  oneWayArrow,
  pathArrowGeometry,
  pathArrowSizes,
  pathReturn,
  polylinePathData,
  projectPath,
  type DiagramArc,
  type DiagramCubic,
  type SvgPoint,
} from './stepDiagramGeometry';

/** A page's projector: 200 px to the sheet, y up, the default pens and marks, 1.25 px to the ink. */
const PROJECT = createOverlayProjector({ origin: [0, 0], ex: [200, 0], ey: [0, -200] }, 1.25);
const sizesFor = (length: number) => pathArrowSizes(length, PROJECT);
const TOLERANCE = 0.05 * PROJECT.ink;

const distance = (a: Vec2 | SvgPoint, b: Vec2 | SvgPoint) => {
  const [ax, ay] = 'x' in a ? [a.x, a.y] : a;
  const [bx, by] = 'x' in b ? [b.x, b.y] : b;
  return Math.hypot(bx - ax, by - ay);
};

/** An arc as the one cubic that draws it (a sweep of 90° or less). */
function arcCubic(arc: DiagramArc): DiagramCubic {
  const sweep = (arc.ccw ? 1 : -1) * Math.abs(arc.to - arc.from);
  const k = (4 / 3) * Math.tan(Math.abs(sweep) / 4) * arc.radius;
  const at = (angle: number): [number, number] => [arc.center[0] + arc.radius * Math.cos(angle), arc.center[1] + arc.radius * Math.sin(angle)];
  const tangent = (angle: number): [number, number] => (arc.ccw ? [-Math.sin(angle), Math.cos(angle)] : [Math.sin(angle), -Math.cos(angle)]);
  const a = at(arc.from);
  const b = at(arc.to);
  const ta = tangent(arc.from);
  const tb = tangent(arc.to);
  return [a, [a[0] + ta[0] * k, a[1] + ta[1] * k], [b[0] - tb[0] * k, b[1] - tb[1] * k], b];
}

/** An S across the sheet, in sheet units, two segments. */
const S_PATH: DiagramCubic[] = [
  [
    [0.1, 0.5],
    [0.2, 0.75],
    [0.35, 0.7],
    [0.45, 0.5],
  ],
  [
    [0.45, 0.5],
    [0.55, 0.3],
    [0.75, 0.3],
    [0.85, 0.45],
  ],
];

/** A loop that comes back to end beside its tail. */
const LOOP: DiagramCubic[] = [
  [
    [0.4, 0.4],
    [0.9, 0.2],
    [0.9, 0.9],
    [0.42, 0.42],
  ],
];

/** Whether two runs of a polyline cross, anywhere but where neighbours meet. */
function selfCrossings(points: readonly Vec2[]): number {
  let crossings = 0;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  for (let i = 0; i + 1 < points.length; i += 1) {
    for (let j = i + 2; j + 1 < points.length; j += 1) {
      const [a, b, c, d] = [points[i]!, points[i + 1]!, points[j]!, points[j + 1]!];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) crossings += 1;
    }
  }
  return crossings;
}

describe('a path arrow’s size', () => {
  it('is capped by its length, not its chord: a loop that ends by its tail keeps a whole head', () => {
    const loop = projectPath(LOOP, PROJECT);
    const length = measurePath(loop).length;
    const chord = distance(loop[0]![0], loop[0]![3]);
    expect(chord).toBeLessThan(10);
    expect(pathArrowSizes(length, PROJECT).head).toBeCloseTo(8.5 * PROJECT.ink, 12);
    // And the head drawn is that whole head, tip to barbs.
    const { head } = pathArrowGeometry(loop, 'mountain', sizesFor, [], TOLERANCE)!;
    const back = { x: (head.barbs[0].x + head.barbs[1].x) / 2, y: (head.barbs[0].y + head.barbs[1].y) / 2 };
    expect(distance(head.tip, back)).toBeCloseTo(8.5 * PROJECT.ink, 9);
    // An arc over that chord gets the shortest head there is.
    const arc = foldArrowArc([0.4, 0.4], [0.42, 0.42], [0.5, 0.5])!;
    expect(arrowheadSize(arc, PROJECT)).toBeCloseTo(4 * PROJECT.pens.arrow.width * PROJECT.ink, 12);
    expect(arrowheadSize(arc, PROJECT)).toBeLessThan(pathArrowSizes(length, PROJECT).head * 0.7);
    // A short path is still capped by a share of itself, never below four strokes.
    expect(pathArrowSizes(10, PROJECT).head).toBe(Math.max(2.6, 4 * PROJECT.pens.arrow.width * PROJECT.ink));
    expect(pathArrowSizes(10, PROJECT).offset).toBeCloseTo(2.6, 12);
  });
});

describe('a one-way path arrow', () => {
  it('stops its shaft at the head’s notch, the head laid along the shaft where it stops', () => {
    const path = projectPath(S_PATH, PROJECT);
    const arrow = pathArrowGeometry(path, 'valley', sizesFor, [], TOLERANCE)!;
    const shaft = arrow.shaft!;
    const end = shaft[shaft.length - 1]![3];
    expect(distance(end, arrow.head.notch)).toBeLessThan(1e-9);
    const along = cubicTangent(shaft[shaft.length - 1]!, 1)!;
    const axis = [arrow.head.tip.x - arrow.head.notch.x, arrow.head.tip.y - arrow.head.notch.y];
    const size = Math.hypot(axis[0]!, axis[1]!);
    expect(axis[0]! / size).toBeCloseTo(along[0], 9);
    expect(axis[1]! / size).toBeCloseTo(along[1], 9);
    // The shaft is the path less the head's reach, and the tip lands within a hair of the path's end.
    const head = sizesFor(measurePath(path).length).head;
    expect(Math.abs(measurePath(shaft).length - (measurePath(path).length - arrowheadReach(head)))).toBeLessThan(0.02);
    // The hair is how far the curve bends off the head's axis over its reach: under a pixel here.
    expect(distance(arrow.head.tip, path[path.length - 1]![3])).toBeLessThan(0.1 * head);
  });

  it('draws an arc made a path as the arc arrow is drawn: the head where its head is, the barb on the same side', () => {
    const out = foldArrowArc([0.2, 0.3], [0.8, 0.35], [0.5, 0.5])!;
    const path = projectPath([arcCubic(out)], PROJECT);
    const head = arrowheadSize(out, PROJECT);
    // Long enough that neither cap applies, so the two are sized alike.
    expect(sizesFor(measurePath(path).length).head).toBeCloseTo(head, 12);
    const arc = oneWayArrow(out, PROJECT, head);
    for (const fold of ['valley', 'mountain'] as const) {
      const shaped = pathArrowGeometry(path, fold, sizesFor, [], TOLERANCE)!;
      expect(distance(shaped.head.tip, arc.head.tip)).toBeLessThan(0.01);
      expect(distance(shaped.head.notch, arc.head.notch)).toBeLessThan(0.01);
      const barb = (d: string) => d.split(' L ')[1]!.split(' ').map(Number);
      const [x, y] = barb(halfArrowheadPath(shaped.head, shaped.inside));
      const [ax, ay] = barb(halfArrowheadPath(arc.head, PROJECT(out.center)));
      expect(Math.hypot(x! - ax!, y! - ay!)).toBeLessThan(0.01);
    }
  });

  it('stops on the ring it lands on: a rim short of one at its end, on the near side of one it ends elsewhere in', () => {
    const path = projectPath(S_PATH, PROJECT);
    const tip = path[path.length - 1]![3];
    const free = pathArrowGeometry(path, 'valley', sizesFor, [], TOLERANCE)!;
    const rim = sizesFor(1000).rim;
    // A ring at its end, as a mark's own arrow lands: a rim along the path.
    const centred = pathArrowGeometry(path, 'valley', sizesFor, [{ x: tip[0], y: tip[1] }], TOLERANCE)!;
    expect(Math.abs(measurePath(free.shaft!).length - measurePath(centred.shaft!).length - rim)).toBeLessThan(0.02);
    // Ending inside a ring off its middle, or past it: the head's tip on the ring, not a rim back.
    for (const mark of [
      { x: tip[0] + 1, y: tip[1] },
      { x: tip[0] - 0.5 * rim, y: tip[1] + 0.3 * rim },
      { x: tip[0] + 0.9 * rim, y: tip[1] },
    ]) {
      const landed = pathArrowGeometry(path, 'valley', sizesFor, [mark], TOLERANCE)!;
      // Where the stroke now ends: its head's reach past its shaft.
      const measure = measurePath(path);
      const end = measurePath(landed.shaft!).length + arrowheadReach(sizesFor(measure.length).head);
      const [x, y] = pathPointAt(measure, end);
      expect(Math.hypot(x - mark.x, y - mark.y)).toBeCloseTo(rim, 1);
    }
    // A ring beyond the rim is not landed on.
    const near = pathArrowGeometry(path, 'valley', sizesFor, [{ x: tip[0] + rim * 1.1, y: tip[1] }], TOLERANCE)!;
    expect(measurePath(near.shaft!).length).toBeCloseTo(measurePath(free.shaft!).length, 9);
  });

  it('draws only its head when it is too short for a shaft, at its tail along its start', () => {
    const stub = projectPath([[[0.5, 0.5], [0.501, 0.5], [0.502, 0.5], [0.503, 0.5]]], PROJECT);
    const arrow = pathArrowGeometry(stub, 'mountain', sizesFor, [], TOLERANCE)!;
    expect(arrow.shaft).toBeNull();
    expect(distance(arrow.head.notch, stub[0]![0])).toBeLessThan(1e-9);
    expect(arrow.head.tip.x).toBeGreaterThan(arrow.head.notch.x);
    expect(pathArrowGeometry(projectPath([[[0.5, 0.5], [0.5, 0.5], [0.5, 0.5], [0.5, 0.5]]], PROJECT), 'valley', sizesFor, [], TOLERANCE)).toBeNull();
  });
});

describe('a straight path arrow', () => {
  it('puts a fold-and-unfold return on one side wherever it is drawn, not the side rounding picks', () => {
    const sides = new Set<number>();
    for (let k = 0; k < 40; k += 1) {
      for (const scale of [189, 283.46]) {
        const project = createOverlayProjector({ origin: [0, 0], ex: [scale, 0], ey: [0, -scale] }, 1.25);
        const a: [number, number] = [0.1 + 0.013 * k, 0.2 + 0.0071 * k];
        const d: [number, number] = [0.37 + 0.013 * k, 0.31 + 0.0071 * k];
        const path = projectPath([[a, a, d, d]], project);
        const arrow = pathArrowGeometry(path, 'fold-unfold', (length) => pathArrowSizes(length, project), [], 0.05 * project.ink)!;
        const [start, end] = [path[0]![0], path[0]![3]];
        const middle = arrow.back![Math.floor(arrow.back!.length / 2)]!;
        const cross = (end[0] - start[0]) * (middle[1] - start[1]) - (end[1] - start[1]) * (middle[0] - start[0]);
        sides.add(Math.sign(cross));
      }
    }
    expect(sides.size).toBe(1);
  });
});

describe('a fold-and-unfold path arrow', () => {
  const path = projectPath(S_PATH, PROJECT);
  const length = measurePath(path).length;
  const sizes = sizesFor(length);

  it('starts its shaft a rim in from the tail, a ring there or not, as the arc’s does', () => {
    const arrow = pathArrowGeometry(path, 'fold-unfold', sizesFor, [], TOLERANCE)!;
    expect(Math.abs(measurePath(arrow.shaft!).length - (length - sizes.rim))).toBeLessThan(0.02);
    expect(distance(arrow.shaft![0]![0], pathPointAt(measurePath(path), sizes.rim))).toBeLessThan(1e-9);
  });

  it('comes back from the tip to the opening beside the tail, on the side the path bulges to, and carries the head there', () => {
    const arrow = pathArrowGeometry(path, 'fold-unfold', sizesFor, [], TOLERANCE)!;
    const back = arrow.back!;
    const tail = path[0]![0];
    expect(distance(back[0]!, path[path.length - 1]![3])).toBeLessThan(1e-9);
    // The head's tip ends about the opening from the tail.
    expect(Math.abs(distance(arrow.head.tip, tail) - sizes.offset)).toBeLessThan(0.15 * sizes.offset);
    expect(distance(back[back.length - 1]!, arrow.head.notch)).toBeLessThan(1e-9);
    // The return keeps to one side of the shaft the whole way, even across the S's turn.
    const untrimmed = pathReturn(path, sizes.offset, TOLERANCE)!;
    const sides = untrimmed.slice(1).map((p) => {
      const nearest = nearestOnPath(path, p)!;
      const along = cubicTangent(path[nearest.segment]!, nearest.t)!;
      return Math.sign(along[0] * (p[1] - nearest.at[1]) - along[1] * (p[0] - nearest.at[0]));
    });
    expect(new Set(sides.filter((side) => side !== 0)).size).toBe(1);
    // …the side the S lies on more of: here its first, larger lobe, above the chord on the page.
    const middle = untrimmed[Math.floor(untrimmed.length * 0.8)]!;
    expect(middle[1]).toBeLessThan(pathPointAt(measurePath(path), length * 0.2)[1]);
    expect(selfCrossings(untrimmed)).toBe(0);
  });

  it('opens from nothing at the tip, wider in the middle than at the tail, as References’ return does', () => {
    const untrimmed = pathReturn(path, sizes.offset, TOLERANCE)!;
    const measure = measurePath(path);
    const gap = (share: number) => {
      const on = pathPointAt(measure, share * measure.length);
      return Math.min(...untrimmed.map((p) => distance(p, on)));
    };
    expect(gap(1)).toBeLessThan(1e-9);
    expect(gap(0)).toBeCloseTo(sizes.offset, 1);
    expect(gap(0.5)).toBeGreaterThan(sizes.offset / 2);
    // The arc's own return, for a 60° arc this long, stands off about as far in its middle.
    const out = foldArrowArc([0.1, 0.5], [0.85, 0.45], [0.5, 0.2])!;
    expect(foldReturnOffset(out, PROJECT)).toBeCloseTo(sizes.offset, 6);
  });

  it('cuts out the fold of a return round a bend tighter than its loop, rather than drawing a swallowtail', () => {
    // Two lobes either side of a dip far tighter than the loop is wide, on the loop's side (the golden's).
    const dip = projectPath(
      [
        [
          [0.52, 0.68],
          [0.55, 0.53],
          [0.66, 0.53],
          [0.69, 0.64],
        ],
        [
          [0.69, 0.64],
          [0.7, 0.69],
          [0.73, 0.69],
          [0.74, 0.64],
        ],
        [
          [0.74, 0.64],
          [0.77, 0.53],
          [0.9, 0.53],
          [0.93, 0.68],
        ],
      ],
      PROJECT
    );
    const back = pathReturn(dip, sizesFor(measurePath(dip).length).offset, TOLERANCE)!;
    expect(selfCrossings(back)).toBe(0);
    const arrow = pathArrowGeometry(dip, 'fold-unfold', sizesFor, [], TOLERANCE)!;
    expect(selfCrossings(arrow.back!)).toBe(0);
    // Round a bend on the loop's outside, nothing is cut: the hairpin's turn is joined round.
    const hairpin = projectPath(
      [
        [
          [0.1, 0.5],
          [0.5, 0.5],
          [0.5, 0.5],
          [0.52, 0.51],
        ],
        [
          [0.52, 0.51],
          [0.54, 0.52],
          [0.5, 0.53],
          [0.1, 0.53],
        ],
      ],
      PROJECT
    );
    const around = pathReturn(hairpin, sizes.offset, TOLERANCE)!;
    expect(selfCrossings(around)).toBe(0);
    // It goes round the far side of the turn, past the path's furthest reach.
    expect(Math.max(...around.map(([x]) => x))).toBeGreaterThan(Math.max(...hairpin.flat().map(([x]) => x)));
  });
});

describe('a path’s data', () => {
  it('moves to its start and draws a cubic for each segment; runs as lines', () => {
    const d = cubicPathData(projectPath(S_PATH, PROJECT));
    expect(d).toMatch(/^M [-\d.]+ [-\d.]+ C( [-\d.]+){6} C( [-\d.]+){6}$/);
    expect(cubicPathData([])).toBe('');
    expect(polylinePathData([[0, 0], [1, 2.5]])).toBe('M 0 0 L 1 2.5');
  });

  it('is the path through the projector, point for point', () => {
    const [[a, b, c, d]] = projectPath([S_PATH[0]!], PROJECT) as [Cubic];
    expect(a).toEqual([20, -100]);
    expect(b).toEqual([40, -150]);
    expect(c[0]).toBeCloseTo(70, 9);
    expect(d).toEqual([90, -100]);
  });
});
