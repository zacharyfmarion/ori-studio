import { describe, expect, it } from 'vitest';
import { COVER_EPS, coversLine, linesAsLateAsUncovered, type DrawShape, type Point } from '../src/lineDrawOrder.js';
import { meshToPaperScene, withLinesDrawnLate, type PaperItem, type PaperLineItem } from '../src/paperScene.js';
import { prepareFoldModel } from '../src/prepare.js';
import { OrigamiModel } from '../src/model.js';
import { ReferenceSolver } from '../src/referenceSolver.js';
import { meshTopologyFor } from '../src/webgl/meshRenderer.js';
import { boundingRadius, cameraUniforms, centroid, sheetExtent } from '../src/webgl/camera.js';
import { fixtureByName } from '../bench/fixtures.js';

const SQUARE: Point[] = [
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
];

describe('whether a face covers a line', () => {
  it('covers a line that crosses its inside', () => {
    expect(coversLine([SQUARE], [-5, 5], [15, 5])).toBe(true);
  });

  it('covers a line wholly inside it', () => {
    expect(coversLine([SQUARE], [2, 2], [8, 3])).toBe(true);
  });

  it('does not cover a line along its own edge: the line’s own face', () => {
    expect(coversLine([SQUARE], [0, 0], [10, 0])).toBe(false);
    expect(coversLine([SQUARE], [2, 10], [7, 10])).toBe(false);
  });

  it('does not cover a line that meets it only at a corner', () => {
    expect(coversLine([SQUARE], [10, 10], [20, 14])).toBe(false);
    expect(coversLine([SQUARE], [0, 0], [-6, 3])).toBe(false);
  });

  it('does not cover a line that runs beside it', () => {
    expect(coversLine([SQUARE], [-3, -1], [12, -1])).toBe(false);
  });

  it('does not cover a line that dips inside it by less than the tolerance', () => {
    const dip = COVER_EPS / 2;
    expect(coversLine([SQUARE], [-5, -dip], [15, dip])).toBe(false);
    // Rounding of the kind a stored scene carries: a cut end a hair off the edge.
    expect(coversLine([SQUARE], [0, 0.007], [10, 0])).toBe(false);
  });

  it('covers a line that runs inside it by more than the tolerance', () => {
    expect(coversLine([SQUARE], [-5, 0.5], [15, 0.5])).toBe(true);
  });

  it('reads several rings as one even-odd set: a line in the hole is not covered', () => {
    const hole: Point[] = [
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ];
    expect(coversLine([SQUARE, hole], [4, 5], [6, 5])).toBe(false);
    expect(coversLine([SQUARE, hole], [1, 5], [6, 5])).toBe(true);
  });

  it('covers a line crossing a concave face only where the face is', () => {
    // An L: the notch at the top right is outside it.
    const ell: Point[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ];
    expect(coversLine([ell], [6, 6], [9, 9])).toBe(false);
    expect(coversLine([ell], [6, 6], [9, 2])).toBe(true);
  });
});

type Item = { id: string; shape: DrawShape };

const line = (id: string, a: Point, b: Point): Item => ({ id, shape: { kind: 'line', a, b } });
const face = (id: string, ring: Point[]): Item => ({ id, shape: { kind: 'face', rings: [ring] } });
const order = (items: Item[]) => linesAsLateAsUncovered(items, (item) => item.shape).map((item) => item.id);

/** The bottom edge of SQUARE: a crease on it, and the square its own face. */
const EDGE = line('edge', [0, 0], [10, 0]);
/** A face below the square, meeting the crease's left end only. */
const CORNER: Item = face('corner', [
  [0, 0],
  [-6, 3],
  [-8, -4],
]);
/** A face drawn over the crease's middle. */
const OVER: Item = face('over', [
  [4, -2],
  [6, -2],
  [6, 2],
  [4, 2],
]);

describe('the order lines are drawn in', () => {
  it('moves a line past its own face, which only touches it', () => {
    expect(order([EDGE, face('own', SQUARE)])).toEqual(['own', 'edge']);
  });

  it('moves a line past a face that meets it at a corner', () => {
    expect(order([EDGE, CORNER])).toEqual(['corner', 'edge']);
  });

  it('keeps a line under a face that covers it, and past the faces before that one', () => {
    expect(order([EDGE, face('own', SQUARE), OVER, CORNER])).toEqual(['own', 'edge', 'over', 'corner']);
  });

  it('leaves a line where it is when the next face covers it', () => {
    expect(order([face('own', SQUARE), EDGE, OVER])).toEqual(['own', 'edge', 'over']);
  });

  it('never moves a line past a fixed item', () => {
    const fixed: Item = { id: 'fixed', shape: { kind: 'fixed' } };
    expect(order([EDGE, fixed, face('own', SQUARE)])).toEqual(['edge', 'fixed', 'own']);
  });

  it('keeps the order of lines that land in one place, and of every face', () => {
    const second = line('second', [10, 0], [10, 10]);
    expect(order([EDGE, second, face('own', SQUARE), CORNER])).toEqual(['own', 'corner', 'edge', 'second']);
  });

  it('is the drawing itself when nothing moves', () => {
    expect(order([face('own', SQUARE), EDGE])).toEqual(['own', 'edge']);
    expect(order([])).toEqual([]);
  });
});

describe('a stored scene’s lines, drawn late', () => {
  const crease: PaperLineItem = {
    kind: 'line',
    role: 'valley',
    a: [0, 0],
    b: [10, 0],
    onBoundary: [false, false],
    hidden: false,
  };
  const own: PaperItem = { kind: 'face', face: 0, side: 'front', rings: [SQUARE], shade: 1, hidden: false };
  const markup: PaperItem = {
    kind: 'markup',
    svg: '<circle cx="5" cy="5" r="1"/>',
    bounds: { minX: 4, minY: 4, maxX: 6, maxY: 6 },
    hidden: false,
  };

  it('moves each line past the faces that only touch it, and keeps everything else', () => {
    const scene = { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, sheet: 10, items: [crease, own] };
    const late = withLinesDrawnLate(scene);
    expect(late.items).toEqual([own, crease]);
    expect(late.bounds).toBe(scene.bounds);
    expect(late.sheet).toBe(10);
  });

  it('never moves a line past markup, which is drawn over the paper', () => {
    const scene = { bounds: { minX: 0, minY: 0, maxX: 10, maxY: 10 }, sheet: 10, items: [crease, markup, own] };
    expect(withLinesDrawnLate(scene).items).toEqual([crease, markup, own]);
  });
});

/**
 * A Miura-ori folded part way, solved on the CPU: rows of pleats whose creases
 * meet at every vertex, the shape a pleated model's picture is made of.
 */
function foldedMiura() {
  const prepared = prepareFoldModel(fixtureByName('miura-8x8').build(), { triangulate: true });
  const model = new OrigamiModel(prepared);
  const solver = new ReferenceSolver(model, { foldPercent: 45 });
  solver.step(400);
  return {
    positions: model.positions.slice(),
    topology: meshTopologyFor(prepared),
    sheet: sheetExtent(model.originalPositions),
  };
}

const VIEWS = [
  { yaw: 0.4, pitch: -0.9, zoom: 1 },
  { yaw: 2.1, pitch: -1.3, zoom: 1 },
  { yaw: -0.8, pitch: 0.6, zoom: 1 },
];

/** Shortest distance between two segments; zero when they cross or touch. */
function segmentDistance(a: Point, b: Point, c: Point, d: Point): number {
  const cross = (o: Point, p: Point, q: Point) => (p[0] - o[0]) * (q[1] - o[1]) - (p[1] - o[1]) * (q[0] - o[0]);
  const d1 = cross(c, d, a);
  const d2 = cross(c, d, b);
  const d3 = cross(a, b, c);
  const d4 = cross(a, b, d);
  if (d1 * d2 < 0 && d3 * d4 < 0) return 0;
  const toSegment = ([x, y]: Point, [px, py]: Point, [qx, qy]: Point) => {
    const dx = qx - px;
    const dy = qy - py;
    const length = dx * dx + dy * dy;
    const t = length > 0 ? Math.max(0, Math.min(1, ((x - px) * dx + (y - py) * dy) / length)) : 0;
    return Math.hypot(x - px - t * dx, y - py - t * dy);
  };
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
}

/** Even-odd over the rings. */
function inside(rings: ReadonlyArray<ReadonlyArray<Point>>, [x, y]: Point): boolean {
  let odd = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < xj + ((y - yj) / (yi - yj)) * (xi - xj)) odd = !odd;
    }
  }
  return odd;
}

/** How far a point is from a face: zero inside it. */
function distanceTo(rings: ReadonlyArray<ReadonlyArray<Point>>, point: Point): number {
  if (inside(rings, point)) return 0;
  return Math.min(
    ...rings.flatMap((ring) =>
      ring.map((corner, index) => segmentDistance(point, point, corner, ring[(index + 1) % ring.length]!))
    )
  );
}

/**
 * Whether a face drawn after a line paints over ink of it that `cover` — the
 * first face after it that covers it, drawn after it anyway — leaves alone:
 * a point of the line within `reach` of the face and not of the cover.
 */
function eatsInk(
  rings: ReadonlyArray<ReadonlyArray<Point>>,
  l: PaperLineItem,
  cover: ReadonlyArray<ReadonlyArray<Point>> | null,
  reach: number
): boolean {
  const samples = 200;
  for (let k = 0; k <= samples; k += 1) {
    const t = k / samples;
    const point: Point = [l.a[0] + (l.b[0] - l.a[0]) * t, l.a[1] + (l.b[1] - l.a[1]) * t];
    if (distanceTo(rings, point) <= reach && (!cover || distanceTo(cover, point) > reach)) return true;
  }
  return false;
}

describe('a simulated fold’s picture', () => {
  const miura = foldedMiura();

  it.each(VIEWS)('draws no face over ink of a line it only touches, seen from %o', (view) => {
    const center = centroid(miura.positions);
    const camera = cameraUniforms(view, center, boundingRadius(miura.positions, center), 512, 512);
    const { items } = meshToPaperScene(miura.positions, miura.topology, camera, {
      sheet: miura.sheet,
      lighting: true,
      lightDir: [0.3, 0.5, 0.8],
    });
    // The ink a face drawn after a line would paint over: the line's own half
    // width and the painter's seam, at the default pens, with room to spare.
    const reach = 1.2;
    const offenders: string[] = [];
    let checked = 0;
    items.forEach((item: PaperItem, index) => {
      if (item.kind !== 'line' || item.hidden) return;
      checked += 1;
      const after = items.slice(index + 1).filter((later) => later.kind === 'face');
      const coverAt = after.findIndex((later) => coversLine(later.rings, item.a, item.b));
      const cover = coverAt < 0 ? null : after[coverAt]!.rings;
      // Up to the face that covers it: past that, anything may draw over it.
      for (const later of coverAt < 0 ? after : after.slice(0, coverAt)) {
        if (eatsInk(later.rings, item, cover, reach)) {
          offenders.push(`${item.role} line ${index} under face ${later.face}`);
          return;
        }
      }
    });
    expect(checked).toBeGreaterThan(50);
    expect(offenders).toEqual([]);
  });
});
