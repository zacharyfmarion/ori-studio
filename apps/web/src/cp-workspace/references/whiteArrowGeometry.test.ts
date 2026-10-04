import { describe, expect, it } from 'vitest';
import { STEP_DIAGRAM_LINE_WIDTH } from '../../diagram/pictures/paintStepDiagram';
import {
  cubicTangent,
  measurePath,
  nearestOnPath,
  pathPointAt,
  pathTangentAt,
  type Cubic,
  type Vec2,
} from '../../lib/cubicBezier';
import {
  DIAGRAM_PUSH_INK,
  DIAGRAM_WHITE_ARROW_INK,
  canvasDiagramInk,
  type DiagramWhiteArrowWidth,
} from './diagram/diagramInk';
import {
  outlineDistance,
  whiteArrowOutline,
  WHITE_ARROW_MITER_LIMIT,
  type WhiteArrowSize,
  type WhiteArrowTail,
} from './stepDiagramGeometry';

/** An annotation's ink on a page, in CSS px: what the outline is drawn in. */
const INK = canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH);
const TOLERANCE = 0.05 * INK;
const sized = (width: DiagramWhiteArrowWidth): WhiteArrowSize => {
  const { neck, headLength, headWidth } = DIAGRAM_WHITE_ARROW_INK[width];
  return { neck: neck * INK, headLength: headLength * INK, headWidth: headWidth * INK };
};
const REGULAR = sized('regular');
const HALF = REGULAR.neck / 2;

const distance = (a: Vec2, b: Vec2) => Math.hypot(b[0] - a[0], b[1] - a[1]);
const line = (a: Vec2, b: Vec2): Cubic => [
  a,
  [a[0] + (b[0] - a[0]) / 3, a[1] + (b[1] - a[1]) / 3],
  [a[0] + (2 * (b[0] - a[0])) / 3, a[1] + (2 * (b[1] - a[1])) / 3],
  b,
];
/** An arc as cubics of at most a quarter turn each, anticlockwise from `from` to `to` (radians). */
function arc(centre: Vec2, radius: number, from: number, to: number): Cubic[] {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / (Math.PI / 2)));
  return Array.from({ length: n }, (_, i): Cubic => {
    const a = from + ((to - from) * i) / n;
    const b = from + ((to - from) * (i + 1)) / n;
    const k = (4 / 3) * Math.tan((b - a) / 4) * radius;
    const at = (t: number): Vec2 => [centre[0] + radius * Math.cos(t), centre[1] + radius * Math.sin(t)];
    const pa = at(a);
    const pb = at(b);
    return [pa, [pa[0] - Math.sin(a) * k, pa[1] + Math.cos(a) * k], [pb[0] + Math.sin(b) * k, pb[1] - Math.cos(b) * k], pb];
  });
}

/** Whether two edges of a closed polygon cross, anywhere but where neighbours meet. */
function selfCrossings(ring: readonly Vec2[]): number {
  let crossings = 0;
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const n = ring.length;
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const [a, b, c, d] = [ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!];
      if (cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0) crossings += 1;
    }
  }
  return crossings;
}

const area = (ring: readonly Vec2[]) =>
  Math.abs(ring.reduce((sum, a, i) => sum + a[0] * ring[(i + 1) % ring.length]![1] - ring[(i + 1) % ring.length]![0] * a[1], 0)) / 2;

/** How far a point is from the path's centreline. */
const offPath = (path: readonly Cubic[], point: Vec2) => nearestOnPath(path, point)!.distance;

/** The outline with its tip and barbs left out: what is left is the shaft's sides and its tail. */
const shaftOf = (outline: readonly Vec2[]) => outline.slice(2, -1);

const outlineOf = (path: readonly Cubic[], tail: WhiteArrowTail = 'square', size = REGULAR) =>
  whiteArrowOutline(path, size, tail, TOLERANCE)!;

describe('white arrow widths', () => {
  it('print the template’s white arrow as regular, the push arrow’s as narrow, and 1.4 times regular as wide', () => {
    const mm = (ink: number) => (ink * INK * 25.4) / 96;
    // One annotation ink on a page.
    expect(mm(1)).toBeCloseTo(0.3307, 4);
    const { narrow, regular, wide } = DIAGRAM_WHITE_ARROW_INK;
    // `path4649` of origami_house_template.svg: a 3.577 mm neck, a head 3.949 mm long and 7.945 mm wide.
    expect(Math.abs(mm(regular.neck) - 3.577)).toBeLessThan(0.02);
    expect(Math.abs(mm(regular.headLength) - 3.949)).toBeLessThan(0.02);
    expect(Math.abs(mm(regular.headWidth) - 7.945)).toBeLessThan(0.02);
    expect(narrow).toEqual({
      neck: 2 * DIAGRAM_PUSH_INK.shaftHalf,
      headLength: DIAGRAM_PUSH_INK.head,
      headWidth: 2 * DIAGRAM_PUSH_INK.headHalf,
    });
    expect(mm(narrow.neck)).toBeCloseTo(2.117, 3);
    for (const key of ['neck', 'headLength', 'headWidth'] as const) expect(wide[key]).toBeCloseTo(1.4 * regular[key], 9);
    expect(mm(wide.neck)).toBeCloseTo(5.0, 2);
  });
});

describe('a straight white arrow', () => {
  const path = [line([0, 0], [100, 0])];
  const { neck, headLength, headWidth } = REGULAR;
  const back = 100 - headLength;

  it('is a shaft the neck wide and a straight-backed head, from the tip round: square tail', () => {
    const outline = outlineOf(path, 'square');
    const expected: Vec2[] = [
      [100, 0],
      [back, headWidth / 2],
      [back, neck / 2],
      [0, neck / 2],
      [0, -neck / 2],
      [back, -neck / 2],
      [back, -headWidth / 2],
    ];
    expect(outline).toHaveLength(expected.length);
    outline.forEach((p, i) => expect(distance(p, expected[i]!)).toBeLessThan(1e-9));
    expect(area(outline)).toBeCloseTo(neck * back + (headWidth * headLength) / 2, 9);
  });

  it('cuts a cleft tail as deep as the push arrow’s, for its width', () => {
    const outline = outlineOf(path, 'cleft');
    expect(outline).toHaveLength(8);
    const cleft = (DIAGRAM_PUSH_INK.cleft / (2 * DIAGRAM_PUSH_INK.shaftHalf)) * neck;
    expect(distance(outline[4]!, [cleft, 0])).toBeLessThan(1e-9);
    expect(distance(outline[3]!, [0, neck / 2])).toBeLessThan(1e-9);
    expect(distance(outline[5]!, [0, -neck / 2])).toBeLessThan(1e-9);
  });

  it('draws a pointed tail widening into the neck as the template’s does: 1 − (1 − u)^1.2 of it', () => {
    const outline = outlineOf(path, 'pointed');
    expect(outline.some((p) => distance(p, [0, 0]) < 1e-9)).toBe(true);
    const sides = shaftOf(outline);
    expect(sides.length).toBeGreaterThan(30);
    for (const [x, y] of sides) {
      const u = x / back;
      expect(Math.abs(Math.abs(y) - (neck / 2) * (1 - Math.pow(1 - u, 1.2)))).toBeLessThan(1e-9);
    }
    // Halfway, it is 0.565 of the neck: the template's `path4649` is 0.571 there.
    const middle = sides.reduce((best, p) => (Math.abs(p[0] - back / 2) < Math.abs(best[0] - back / 2) ? p : best));
    expect((2 * Math.abs(middle[1])) / neck).toBeGreaterThan(0.54);
    expect((2 * Math.abs(middle[1])) / neck).toBeLessThan(0.59);
  });
});

describe('a curved white arrow', () => {
  // A gentle arc, 60° of a 120 px circle.
  const gentle = arc([0, 0], 120, Math.PI / 3, (2 * Math.PI) / 3);

  it('puts a straight-backed head at the neck’s tangent, its tip a head’s length on along it', () => {
    const outline = outlineOf(gentle);
    const measure = measurePath(gentle);
    const neckAt = measure.length - REGULAR.headLength;
    const joint = pathPointAt(measure, neckAt);
    const [ax, ay] = pathTangentAt(measure, neckAt)!;
    const across = (w: number): Vec2 => [joint[0] - ay * w, joint[1] + ax * w];
    expect(distance(outline[0]!, [joint[0] + ax * REGULAR.headLength, joint[1] + ay * REGULAR.headLength])).toBeLessThan(1e-9);
    expect(distance(outline[1]!, across(REGULAR.headWidth / 2))).toBeLessThan(1e-9);
    expect(distance(outline[2]!, across(HALF))).toBeLessThan(1e-9);
    expect(distance(outline[outline.length - 2]!, across(-HALF))).toBeLessThan(1e-9);
    expect(distance(outline[outline.length - 1]!, across(-REGULAR.headWidth / 2))).toBeLessThan(1e-9);
  });

  it('offsets each side half the neck off the curve, and covers its area', () => {
    const outline = outlineOf(gentle);
    expect(selfCrossings(outline)).toBe(0);
    for (const p of shaftOf(outline)) expect(Math.abs(offPath(gentle, p) - HALF)).toBeLessThan(TOLERANCE);
    // A band of constant width has its width times its length for area.
    const shaft = measurePath(gentle).length - REGULAR.headLength;
    const expected = REGULAR.neck * shaft + (REGULAR.headWidth * REGULAR.headLength) / 2;
    expect(Math.abs(area(outline) / expected - 1)).toBeLessThan(2e-3);
  });

  it('keeps each side on its own side through an S’s inflection', () => {
    const s: Cubic[] = [
      [[0, 60], [40, -40], [70, -30], [80, 30]],
      [[80, 30], [90, 90], [120, 100], [160, 0]],
    ];
    for (const tail of ['square', 'cleft', 'pointed'] as const) {
      const outline = outlineOf(s, tail);
      expect(selfCrossings(outline)).toBe(0);
    }
    const outline = outlineOf(s);
    // Which side of travel each shaft point lies on: the side +1 run from the
    // neck to the tail, then side −1 back to the neck, with no point astray.
    const sides = shaftOf(outline).map((p) => {
      const near = nearestOnPath(s, p)!;
      const [tx, ty] = cubicTangent(s[near.segment]!, near.t)!;
      return Math.sign(tx * (p[1] - near.at[1]) - ty * (p[0] - near.at[0]));
    });
    const changes = sides.filter((sign, i) => i > 0 && sign !== sides[i - 1]).length;
    expect(changes).toBe(1);
    for (const p of shaftOf(outline)) expect(Math.abs(offPath(s, p) - HALF)).toBeLessThan(TOLERANCE);
    const shaft = measurePath(s).length - REGULAR.headLength;
    const expected = REGULAR.neck * shaft + (REGULAR.headWidth * REGULAR.headLength) / 2;
    expect(Math.abs(area(outline) / expected - 1)).toBeLessThan(5e-3);
  });

  it('cuts the fold out of the inside of a bend tighter than half its width, leaving a sharp inner corner', () => {
    // A hairpin bent at a fifth of the neck: the inside offset alone would
    // fold into a swallowtail. Its legs part at 40°, so past the bend they are
    // never nearer each other than the arrow is wide.
    const radius = REGULAR.neck / 5;
    const part = (20 * Math.PI) / 180;
    const bend = arc([0, 0], radius, part, Math.PI - part);
    const leg = 120;
    const start = bend[0]![0];
    const end = bend[bend.length - 1]![3];
    const down = (p: Vec2, sign: number): Vec2 => [p[0] + sign * Math.sin(part) * leg, p[1] - Math.cos(part) * leg];
    const hairpin = [line(down(start, 1), start), ...bend, line(end, down(end, -1))];
    for (const tail of ['square', 'cleft', 'pointed'] as const) expect(selfCrossings(outlineOf(hairpin, tail))).toBe(0);
    const outline = outlineOf(hairpin);
    // No point of the outline is nearer the centreline than half the neck: the
    // swallowtail's points all were.
    for (const p of shaftOf(outline)) expect(offPath(hairpin, p)).toBeGreaterThan(HALF - TOLERANCE);
    for (const p of shaftOf(outline)) expect(offPath(hairpin, p)).toBeLessThan(HALF + TOLERANCE);
    // The inner corner: where the legs' inside offsets meet, on the hairpin's axis.
    const inner = shaftOf(outline).filter((p) => Math.abs(p[0]) < 1e-6 && p[1] < 0);
    expect(inner).toHaveLength(1);
    expect(inner[0]![1]).toBeCloseTo(-HALF / Math.sin(part) + radius / Math.sin(part), 6);
  });

  it('draws a shaft bent across its own head as the two together, not crossing', () => {
    // A turn tighter than the neck just short of the head.
    const curl = [line([0, 40], [30, 40]), ...arc([30, 30], 10, Math.PI / 2, -Math.PI / 2 + 0.3)];
    const last = curl[curl.length - 1]![3];
    const path = [...curl, line(last, [last[0] + 20, last[1] - 4])];
    for (const tail of ['square', 'cleft', 'pointed'] as const) {
      for (const width of ['narrow', 'regular', 'wide'] as const) {
        expect(selfCrossings(whiteArrowOutline(path, sized(width), tail, TOLERANCE)!)).toBe(0);
      }
    }
  });
});

describe('a white arrow round a corner node', () => {
  const corner = (turn: number): Cubic[] => [
    line([0, 0], [80, 0]),
    line([80, 0], [80 + 80 * Math.cos(turn), 80 * Math.sin(turn)]),
  ];
  /** How far the outline stands off the node on the outside of the turn. */
  const farthest = (outline: readonly Vec2[], turn: number) => {
    const out: Vec2 = [Math.sin(turn), -1 - Math.cos(turn)];
    const outside = shaftOf(outline).filter((p) => (p[0] - 80) * out[0] + p[1] * out[1] > 0 && distance(p, [80, 0]) < 3 * HALF);
    return Math.max(...outside.map((p) => distance(p, [80, 0])));
  };

  it('mitres the outside while the mitre is within 1.5 half-widths', () => {
    const turn = (70 * Math.PI) / 180;
    const outline = outlineOf(corner(turn));
    expect(selfCrossings(outline)).toBe(0);
    expect(farthest(outline, turn)).toBeCloseTo(HALF / Math.cos(turn / 2), 9);
    expect(farthest(outline, turn)).toBeLessThan(WHITE_ARROW_MITER_LIMIT * HALF);
  });

  it('bevels it past the limit, as a stroke with that mitre limit does', () => {
    const limit = 2 * Math.acos(1 / WHITE_ARROW_MITER_LIMIT);
    for (const degrees of [120, 150]) {
      const turn = (degrees * Math.PI) / 180;
      const outline = outlineOf(corner(turn));
      expect(selfCrossings(outline)).toBe(0);
      expect(farthest(outline, turn)).toBeCloseTo(HALF, 9);
      // The bevel's two corners, each half the neck off the node.
      expect(shaftOf(outline).filter((p) => Math.abs(distance(p, [80, 0]) - HALF) < 1e-9)).toHaveLength(2);
    }
    expect(farthest(outlineOf(corner(limit - 1e-3)), limit)).toBeGreaterThan(1.49 * HALF);
    expect(farthest(outlineOf(corner(limit + 1e-3)), limit)).toBeCloseTo(HALF, 9);
  });

  it('rounds the outside of the same turn made smoothly, as the curve’s own offset is', () => {
    // The 120° turn as a bend of radius 2, a third of the half-width.
    const leave: Vec2 = [80 + Math.sqrt(3), 3];
    const smooth = [line([0, 0], [80, 0]), ...arc([80, 2], 2, -Math.PI / 2, Math.PI / 6), line(leave, [leave[0] - 40, leave[1] + 40 * Math.sqrt(3)])];
    const outline = outlineOf(smooth);
    expect(selfCrossings(outline)).toBe(0);
    for (const p of shaftOf(outline)) expect(Math.abs(offPath(smooth, p) - HALF)).toBeLessThan(TOLERANCE);
  });
});

describe('a short or broken white arrow', () => {
  it('draws the same shape smaller when the path is shorter than its head and a shaft', () => {
    const least = REGULAR.headLength + 1.5 * REGULAR.neck;
    for (const tail of ['square', 'cleft', 'pointed'] as const) {
      const whole = outlineOf([line([0, 0], [least, 0])], tail);
      const half = outlineOf([line([0, 0], [least / 2, 0])], tail);
      expect(half).toHaveLength(whole.length);
      half.forEach((p, i) => expect(distance(p, [whole[i]![0] / 2, whole[i]![1] / 2])).toBeLessThan(1e-9));
    }
    // A hair long is still an arrow, of a hair.
    const hair = outlineOf([line([5, 5], [5 + 1e-6, 5])]);
    expect(hair.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
  });

  it('is null for a path of no length, a broken point or a size of nothing', () => {
    const point: Cubic = [[3, 4], [3, 4], [3, 4], [3, 4]];
    expect(whiteArrowOutline([point, point], REGULAR, 'square', TOLERANCE)).toBeNull();
    expect(whiteArrowOutline([], REGULAR, 'square', TOLERANCE)).toBeNull();
    expect(whiteArrowOutline([line([0, 0], [Number.NaN, 0])], REGULAR, 'square', TOLERANCE)).toBeNull();
    expect(whiteArrowOutline([line([0, 0], [Infinity, 0])], REGULAR, 'square', TOLERANCE)).toBeNull();
    expect(whiteArrowOutline([line([0, 0], [100, 0])], { ...REGULAR, neck: 0 }, 'square', TOLERANCE)).toBeNull();
    expect(whiteArrowOutline([line([0, 0], [100, 0])], { ...REGULAR, headWidth: Number.NaN }, 'square', TOLERANCE)).toBeNull();
  });

  it('passes over nodes stacked on each other and handles drawn onto their nodes, as pathTangentAt does', () => {
    const [a, b, c]: Vec2[] = [[0, 0], [60, 10], [90, 70]];
    const plain = outlineOf([line(a, b), line(b, c)]);
    const stacked: Cubic = [b, b, b, b];
    const stackedVariants: Cubic[][] = [
      [line(a, b), stacked, line(b, c)],
      [[a, a, a, a], line(a, b), line(b, c)],
      [line(a, b), line(b, c), [c, c, c, c]],
    ];
    for (const path of stackedVariants) {
      const outline = outlineOf(path);
      expect(outline).toHaveLength(plain.length);
      outline.forEach((p, i) => expect(distance(p, plain[i]!)).toBeLessThan(1e-9));
    }
    // Handles on their nodes run the same lines at another pace: the same
    // outline, to within how finely a path is measured along its length.
    const onto = outlineOf([[a, a, b, b], [b, b, c, c]]);
    expect(onto).toHaveLength(plain.length);
    onto.forEach((p, i) => expect(distance(p, plain[i]!)).toBeLessThan(0.01));
  });

  it('never draws a point that is not a number, whatever the path', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const point = (): Vec2 => [random() * 200, random() * 200];
    for (let k = 0; k < 150; k += 1) {
      // Some nodes stacked on the one before, some handles drawn onto their nodes.
      const nodes: Vec2[] = [point()];
      for (let n = 1 + Math.floor(random() * 4); n > 0; n -= 1) nodes.push(random() < 0.15 ? nodes[nodes.length - 1]! : point());
      const path = nodes.slice(1).map((end, i): Cubic => {
        const start = nodes[i]!;
        const onto = random() < 0.2;
        return [start, onto ? start : point(), onto ? end : point(), end];
      });
      const tail = (['square', 'cleft', 'pointed'] as const)[k % 3]!;
      const width = (['narrow', 'regular', 'wide'] as const)[Math.floor(k / 3) % 3]!;
      const outline = whiteArrowOutline(path, sized(width), tail, TOLERANCE);
      if (!outline) {
        expect(measurePath(path).length).toBeLessThan(1e-9);
        continue;
      }
      expect(outline.length).toBeGreaterThanOrEqual(3);
      expect(outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    }
  });

  it('draws a path that crosses itself as offset, overlapping itself (not supported in v1)', () => {
    const crossing: Cubic[] = [[[0, 120], [220, 0], [-60, 0], [160, 120]]];
    const outline = outlineOf(crossing);
    expect(outline.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y))).toBe(true);
    expect(selfCrossings(outline)).toBeGreaterThan(0);
  });
});

describe('a press on a white arrow', () => {
  const gentle = arc([0, 0], 120, Math.PI / 3, (2 * Math.PI) / 3);
  const measure = measurePath(gentle);
  const at = (distanceAlong: number, across: number): Vec2 => {
    const p = pathPointAt(measure, distanceAlong);
    const [tx, ty] = pathTangentAt(measure, distanceAlong)!;
    return [p[0] - ty * across, p[1] + tx * across];
  };

  it('is inside anywhere within the outline, the curve’s hollow included, and measures to the edge outside it', () => {
    const outline = outlineOf(gentle);
    expect(outlineDistance(outline, at(measure.length / 2, 0))).toBe(0);
    expect(outlineDistance(outline, at(measure.length / 2, HALF * 0.9))).toBe(0);
    expect(outlineDistance(outline, at(measure.length - REGULAR.headLength / 2, 0))).toBe(0);
    // Off either side, by how far.
    expect(outlineDistance(outline, at(measure.length / 2, HALF + 3))).toBeCloseTo(3, 1);
    expect(outlineDistance(outline, at(measure.length / 2, -HALF - 3))).toBeCloseTo(3, 1);
    // Behind the head's barb, beside the shaft: outside, a unit off the head's back.
    const behind = at(measure.length - REGULAR.headLength - 1, (HALF + REGULAR.headWidth / 2) / 2);
    expect(outlineDistance(outline, behind)).toBeGreaterThan(0.9);
    expect(outlineDistance(outline, behind)).toBeLessThan(1.1);
  });

  it('is outside in a cleft tail’s notch and between a hairpin’s legs', () => {
    const cleft = outlineOf(gentle, 'cleft');
    expect(outlineDistance(cleft, at(0.1, 0))).toBeGreaterThan(0);
    expect(outlineDistance(cleft, at(REGULAR.neck, 0))).toBe(0);
    const hairpin = [line([0, 0], [0, 100]), ...arc([30, 100], 30, Math.PI, 0), line([60, 100], [60, 0])];
    expect(outlineDistance(outlineOf(hairpin), [30, 50])).toBeGreaterThan(10);
    expect(outlineDistance([], [0, 0])).toBe(Infinity);
  });
});
