import { describe, expect, it } from 'vitest';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { Point } from '../../lib/geometry';
import type {
  OristudioCpDocumentSnapshot,
  OristudioCpLineSegment,
} from '../../engine/oristudioCpTypes';
import {
  boundariesMatch,
  createInlineSimulation,
  isInlineSimulationStale,
  resolveInlineSimulationSegment,
  ringCorners,
  ringsMatch,
  type InlineSimulation,
} from './inlineSimulation';

function line(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color = 'Red1',
): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    color,
    active: 'Inactive0',
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
    selected: 0,
  };
}

function documentOf(lines: OristudioCpLineSegment[]): OristudioCpDocumentSnapshot {
  return {
    crease_pattern: { line_segments: lines, points: [], circles: [] },
  } as unknown as OristudioCpDocumentSnapshot;
}

function ring(points: Array<[number, number]>): Point[] {
  return points.map(([x, y]) => ({ x, y }));
}

function segment(id: number, boundary: Point[][]): CpSegment {
  const all = boundary.flat();
  return {
    id,
    faceIndices: [],
    boundary,
    bounds: {
      minX: Math.min(...all.map((p) => p.x)),
      minY: Math.min(...all.map((p) => p.y)),
      maxX: Math.max(...all.map((p) => p.x)),
      maxY: Math.max(...all.map((p) => p.y)),
    },
  };
}

const UNIT_SQUARE = ring([
  [0, 0],
  [10, 0],
  [10, 10],
  [0, 10],
]);

const SQUARE_LINES = [
  line(0, 0, 10, 0, 'Black0'),
  line(10, 0, 10, 10, 'Black0'),
  line(10, 10, 0, 10, 'Black0'),
  line(0, 10, 0, 0, 'Black0'),
  line(0, 0, 10, 10),
];

function simulationOver(document: OristudioCpDocumentSnapshot, seg: CpSegment): InlineSimulation {
  return createInlineSimulation({
    id: 'sim-1',
    segment: seg,
    document,
    cpLineIds: document.crease_pattern.line_segments.map((_, index) => index + 1),
    z: 1,
    view: { yaw: 0, pitch: 0, zoom: 1 },
  });
}

describe('ring matching', () => {
  it('matches a ring to itself', () => {
    expect(ringsMatch(UNIT_SQUARE, UNIT_SQUARE)).toBe(true);
  });

  it('ignores where the traversal started', () => {
    const rotated = [...UNIT_SQUARE.slice(2), ...UNIT_SQUARE.slice(0, 2)];
    expect(ringsMatch(UNIT_SQUARE, rotated)).toBe(true);
  });

  it('ignores winding direction', () => {
    // Traversal order is an artifact of how the ring was traced, not of the
    // region, and re-segmenting can produce either.
    expect(ringsMatch(UNIT_SQUARE, [...UNIT_SQUARE].reverse())).toBe(true);
  });

  it('rejects a different ring of the same length', () => {
    const shifted = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [1, 10],
    ]);
    expect(ringsMatch(UNIT_SQUARE, shifted)).toBe(false);
  });

  it('ignores vertices that only subdivide an edge', () => {
    // A rim vertex is wherever something met the border, so a crease ending on
    // the rim puts one there and editing that crease takes it away — the same
    // polygon, a different list of points. Observed live on a saved file: a
    // region's ring went from 52 points to 46 with identical area and every
    // point of each lying on the other's outline, and the window reported its
    // region as gone.
    const subdivided = ring([
      [0, 0],
      [4, 0],
      [7, 0],
      [10, 0],
      [10, 10],
      [5, 10],
      [0, 10],
    ]);
    expect(ringsMatch(UNIT_SQUARE, subdivided)).toBe(true);
    expect(ringsMatch(subdivided, UNIT_SQUARE)).toBe(true);
  });

  it('still rejects a ring that a subdivision cannot explain', () => {
    // The relaxation must not reach a *different* polygon: dropping collinear
    // points leaves the shape untouched, so a corner that moved still fails.
    const dented = ring([
      [0, 0],
      [4, 0],
      [7, 1],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    expect(ringsMatch(UNIT_SQUARE, dented)).toBe(false);
  });

  it('keeps a degenerate ring comparable', () => {
    // Every point on one line encloses nothing, so there are no corners to
    // reduce to. It must not collapse to an empty ring and start matching
    // everything.
    const collinear = ring([
      [0, 0],
      [5, 0],
      [10, 0],
    ]);
    expect(ringsMatch(collinear, UNIT_SQUARE)).toBe(false);
    expect(ringsMatch(collinear, collinear)).toBe(true);
  });

  it('matches the same region however its holes changed', () => {
    // Holes are not part of a region's identity. Drawing any interior crease
    // re-infers the faces and can open new pockets: a region traced as one ring
    // before an edit routinely comes back as several after. Observed live —
    // adding a single mountain crease inside a square turned [16] into
    // [16, 4, 3, 3]. Requiring every ring to match would make the region
    // unrecognisable after exactly the edit that refreshing exists to absorb.
    const holeA = ring([
      [1, 1],
      [2, 1],
      [2, 2],
    ]);
    const holeB = ring([
      [6, 6],
      [7, 6],
      [7, 7],
    ]);
    expect(boundariesMatch([UNIT_SQUARE, holeA, holeB], [UNIT_SQUARE])).toBe(true);
    expect(boundariesMatch([UNIT_SQUARE], [UNIT_SQUARE, holeB])).toBe(true);
  });

  it('still rejects a different region that happens to carry holes', () => {
    const other = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [1, 10],
    ]);
    expect(
      boundariesMatch(
        [
          UNIT_SQUARE,
          ring([
            [1, 1],
            [2, 1],
            [2, 2],
          ]),
        ],
        [other],
      ),
    ).toBe(false);
  });

  it('picks the enclosing ring regardless of tracing order', () => {
    const hole = ring([
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ]);
    // Rings arrive in whatever order the rim walk produced, so the outer one is
    // identified by area rather than by position.
    expect(boundariesMatch([hole, UNIT_SQUARE], [UNIT_SQUARE, hole])).toBe(true);
  });
});

/**
 * The shapes the reduction has to survive.
 *
 * Region rims are not squares. Box pleating produces combs and crosses, a
 * region cut around a flap is routinely non-convex, and a region traced around
 * curved input can carry hundreds of points that only *look* like an edge. The
 * property under test is the same for all of them: the polygon is unchanged.
 */
describe('reducing a ring to its corners', () => {
  /** `n` evenly spaced points added along every edge — no shape change. */
  function subdivide(ring: readonly Point[], n: number): Point[] {
    const out: Point[] = [];
    for (let i = 0; i < ring.length; i += 1) {
      const a = ring[i]!;
      const b = ring[(i + 1) % ring.length]!;
      out.push(a);
      for (let k = 1; k <= n; k += 1) {
        const t = k / (n + 1);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  }

  /** Twice the enclosed area, unsigned: the invariant every case below asserts. */
  function area2(polygon: readonly Point[]): number {
    let total = 0;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
      total += (polygon[j]!.x - polygon[i]!.x) * (polygon[j]!.y + polygon[i]!.y);
    }
    return Math.abs(total);
  }

  const L_SHAPE = ring([
    [0, 0],
    [120, 0],
    [120, 50],
    [50, 50],
    [50, 120],
    [0, 120],
  ]);

  /** Five points and five reflex notches — the reduction must keep all ten. */
  const STAR = Array.from({ length: 10 }, (_, i) => {
    const radius = i % 2 === 0 ? 60 : 24;
    const angle = (Math.PI * 2 * i) / 10 - Math.PI / 2;
    return { x: 60 + radius * Math.cos(angle), y: 60 + radius * Math.sin(angle) };
  });

  /** Three slots cut into a block, as a box-pleated rim routinely looks. */
  const COMB = ring([
    [0, 120],
    [120, 120],
    [120, 0],
    [100, 0],
    [100, 60],
    [80, 60],
    [80, 0],
    [60, 0],
    [60, 60],
    [40, 60],
    [40, 0],
    [20, 0],
    [20, 60],
    [0, 60],
  ]);

  const CROSS = ring([
    [40, 0],
    [80, 0],
    [80, 40],
    [120, 40],
    [120, 80],
    [80, 80],
    [80, 120],
    [40, 120],
    [40, 80],
    [0, 80],
    [0, 40],
    [40, 40],
  ]);

  const CIRCLE_64 = Array.from({ length: 64 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 64;
    return { x: 60 + 60 * Math.cos(angle), y: 60 + 60 * Math.sin(angle) };
  });

  const shapes: Array<[string, Point[], number]> = [
    ['non-convex L', L_SHAPE, 1],
    ['star', STAR, 1],
    ['comb', COMB, 1],
    ['cross', CROSS, 3],
  ];

  it.each(shapes)('reduces a subdivided %s to exactly its corners', (_name, shape, density) => {
    const dense = subdivide(shape, density);
    expect(dense.length).toBeGreaterThan(shape.length);
    const corners = ringCorners(dense);
    expect(corners).toHaveLength(shape.length);
    // The vertex that would break a convex-hull approach: every one of these has
    // reflex corners, and dropping one silently shrinks the region.
    expect(area2(corners)).toBeCloseTo(area2(shape), 6);
    expect(ringsMatch(dense, shape)).toBe(true);
  });

  it('leaves a smooth polygon alone', () => {
    // 64 points around a circle, none of them collinear. Over-reducing here would
    // be the dangerous failure — two different curved regions flattening onto the
    // same few points and matching each other.
    expect(ringCorners(CIRCLE_64)).toHaveLength(64);
  });

  it('keeps the tip of a zero-width spur', () => {
    // A slit into the region: the tip's two neighbours are the same point, so
    // there is no line to be collinear with. Dropping it would erase the slit.
    const spur = ring([
      [0, 0],
      [120, 0],
      [120, 60],
      [60, 60],
      [60, 30],
      [60, 60],
      [0, 60],
    ]);
    expect(ringCorners(spur)).toHaveLength(7);
  });

  it('handles a ring whose first point is mid-edge', () => {
    // Where the rim walk started is an artifact, so the wrap-around neighbour has
    // to be considered like any other.
    const startsMidEdge = ring([
      [60, 0],
      [120, 0],
      [120, 120],
      [0, 120],
      [0, 0],
    ]);
    expect(ringCorners(startsMidEdge)).toHaveLength(4);
  });

  it('keeps a shallow corner and drops one below the tolerance', () => {
    // Both sides of `BOUNDARY_EPSILON` (1e-6 model units). Region coordinates run
    // in the hundreds to tens of thousands, so a real corner clears this by
    // several orders of magnitude — the 1e-3 case is already far outside it.
    const shallow = ring([
      [0, 0],
      [60, 1e-3],
      [120, 0],
      [120, 120],
      [0, 120],
    ]);
    const belowTolerance = ring([
      [0, 0],
      [60, 1e-9],
      [120, 0],
      [120, 120],
      [0, 120],
    ]);
    expect(ringCorners(shallow)).toHaveLength(5);
    expect(ringCorners(belowTolerance)).toHaveLength(4);
    expect(ringsMatch(shallow, belowTolerance)).toBe(false);
  });

  it('survives repeated points', () => {
    // A repeat makes its neighbour's test meaningless — a point is always exactly
    // on a line starting at its own position — so a pair of them used to take a
    // real corner down too, leaving nothing to reduce to.
    const repeated = ring([
      [0, 0],
      [0, 0],
      [120, 0],
      [120, 120],
      [120, 120],
      [0, 120],
    ]);
    expect(ringCorners(repeated)).toHaveLength(4);
    expect(ringsMatch(repeated, UNIT_SQUARE)).toBe(false);
  });

  it('keeps a fully degenerate ring comparable', () => {
    // Every point on one line encloses nothing, so there are no corners to reduce
    // to. It must not collapse to an empty ring and start matching everything.
    const collinear = ring([
      [0, 0],
      [40, 0],
      [80, 0],
      [120, 0],
    ]);
    expect(ringCorners(collinear)).toHaveLength(4);
    expect(ringsMatch(collinear, UNIT_SQUARE)).toBe(false);
  });

  it('reduces a large ring, and still matches at that size', () => {
    // Rims of a few hundred points are ordinary on a dense pattern; this is an
    // order past the worst observed. Both passes are linear in the ring, and the
    // reduction is what keeps the O(n^2) rotation search in `ringsMatch` down to
    // the corner count.
    const polygon = Array.from({ length: 2000 }, (_, i) => {
      const angle = (Math.PI * 2 * i) / 2000;
      return { x: 60 + 60 * Math.cos(angle), y: 60 + 60 * Math.sin(angle) };
    });
    const dense = subdivide(polygon, 2);
    expect(dense).toHaveLength(6000);
    expect(ringCorners(dense)).toHaveLength(2000);
    expect(ringsMatch(dense, polygon)).toBe(true);
  });
});

describe('resolving a window to its region', () => {
  const document = documentOf(SQUARE_LINES);

  it('finds the region again after ids renumber', () => {
    const created = simulationOver(document, segment(2, [UNIT_SQUARE]));
    // A new region appearing above/left shifts every later id; the boundary does
    // not move, which is exactly why it is the identity and the id is not.
    const renumbered = [
      segment(0, [
        ring([
          [0, -20],
          [5, -20],
          [5, -15],
        ]),
      ]),
      segment(1, [UNIT_SQUARE]),
    ];

    expect(resolveInlineSimulationSegment(created, renumbered)?.id).toBe(1);
  });

  it('does not pick a neighbour when its own region is gone', () => {
    const created = simulationOver(document, segment(0, [UNIT_SQUARE]));
    const elsewhere = [
      segment(0, [
        ring([
          [50, 50],
          [60, 50],
          [60, 60],
          [50, 60],
        ]),
      ]),
    ];

    // Nearest-match would return the only candidate here, and the window would
    // silently start simulating a different part of the pattern.
    expect(resolveInlineSimulationSegment(created, elsewhere)).toBeNull();
  });

  it('distinguishes a concave region from one sitting in its notch', () => {
    // An L and a small square in the L's notch. Their bounding boxes overlap
    // heavily and the L's contains the square's outright, so a box comparison
    // cannot tell them apart.
    const lShape = ring([
      [0, 0],
      [10, 0],
      [10, 4],
      [4, 4],
      [4, 10],
      [0, 10],
    ]);
    const inNotch = ring([
      [5, 5],
      [9, 5],
      [9, 9],
      [5, 9],
    ]);
    const created = simulationOver(document, segment(0, [lShape]));
    const segments = [segment(0, [inNotch]), segment(1, [lShape])];

    expect(resolveInlineSimulationSegment(created, segments)?.id).toBe(1);
  });

  it('distinguishes concentric regions', () => {
    // A frame and its inner square: routine in box pleating, and near-identical
    // bounding boxes.
    const frameOuter = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ]);
    const frameHole = ring([
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ]);
    const inner = ring([
      [3, 3],
      [7, 3],
      [7, 7],
      [3, 7],
    ]);
    const created = simulationOver(document, segment(0, [frameOuter, frameHole]));
    const segments = [segment(0, [inner]), segment(1, [frameOuter, frameHole])];

    expect(resolveInlineSimulationSegment(created, segments)?.id).toBe(1);
  });

  it('picks the right unit among repeated ones', () => {
    const unitAt = (dx: number) =>
      ring([
        [dx, 0],
        [dx + 4, 0],
        [dx + 4, 4],
        [dx, 4],
      ]);
    const created = simulationOver(document, segment(1, [unitAt(10)]));
    const segments = [segment(0, [unitAt(0)]), segment(1, [unitAt(5)]), segment(2, [unitAt(10)])];

    // The hint says 1, but region 1 is now a different unit; the boundary wins.
    expect(resolveInlineSimulationSegment(created, segments)?.id).toBe(2);
  });

  it('finds its region after a rim crease was removed', () => {
    // The shipped failure. A crease ending on the region's border contributes a
    // rim vertex; deleting it drops that vertex and leaves the region identical.
    // Resolution used to return null, which meant the window could never be
    // rebuilt and came back from a file as a permanently empty frame — while
    // reading `Out of date`, since the crease change is exactly what makes it
    // stale.
    const withRimCrease = ring([
      [0, 0],
      [10, 0],
      [10, 10],
      [6, 10],
      [0, 10],
    ]);
    const created = simulationOver(document, segment(0, [withRimCrease]));
    const afterDelete = [segment(0, [UNIT_SQUARE])];

    expect(resolveInlineSimulationSegment(created, afterDelete)?.id).toBe(0);
  });
});

describe('inline simulation staleness', () => {
  const document = documentOf(SQUARE_LINES);
  const created = simulationOver(document, segment(0, [UNIT_SQUARE]));

  it('is not stale against the document it was made from', () => {
    // The fingerprint is taken over the reselected set, not the ids the window
    // was created from; taking it over the originating ids would make every
    // window read as stale the instant it appeared.
    expect(isInlineSimulationStale(document, created)).toBe(false);
  });

  it('notices a changed fold angle', () => {
    // The symptom that surfaced this: dialling a crease from a full fold to 90
    // degrees changes what the simulation would show, but every field the
    // fingerprint covered stayed put, so the window went on claiming to match.
    // Colour was a crease's whole fold identity when this hash was written; it
    // is half of it now.
    const angled = documentOf([
      ...SQUARE_LINES.slice(0, 4),
      { ...line(0, 0, 10, 10), fold_magnitude: 90 * 1e7 },
    ]);
    expect(isInlineSimulationStale(angled, created)).toBe(true);
  });

  it('notices an angle changing again, not just leaving flat', () => {
    const ninety = documentOf([
      ...SQUARE_LINES.slice(0, 4),
      { ...line(0, 0, 10, 10), fold_magnitude: 90 * 1e7 },
    ]);
    const created90 = simulationOver(ninety, segment(0, [UNIT_SQUARE]));
    expect(isInlineSimulationStale(ninety, created90)).toBe(false);

    const fortyFive = documentOf([
      ...SQUARE_LINES.slice(0, 4),
      { ...line(0, 0, 10, 10), fold_magnitude: 45 * 1e7 },
    ]);
    expect(isInlineSimulationStale(fortyFive, created90)).toBe(true);
  });

  it('notices a moved crease', () => {
    const moved = documentOf([...SQUARE_LINES.slice(0, 4), line(0, 0, 10, 9)]);
    expect(isInlineSimulationStale(moved, created)).toBe(true);
  });

  it('notices a recoloured crease', () => {
    const recoloured = documentOf([...SQUARE_LINES.slice(0, 4), line(0, 0, 10, 10, 'Blue2')]);
    expect(isInlineSimulationStale(recoloured, created)).toBe(true);
  });

  it('notices a crease added inside the region', () => {
    const added = documentOf([...SQUARE_LINES, line(0, 10, 10, 0)]);
    expect(isInlineSimulationStale(added, created)).toBe(true);
  });

  it('ignores a crease added well outside the region', () => {
    const elsewhere = documentOf([...SQUARE_LINES, line(50, 50, 60, 60)]);
    expect(isInlineSimulationStale(elsewhere, created)).toBe(false);
  });

  it('ignores an aux-coloured crease inside the region', () => {
    // Deliberate, and shared with folded figures. An aux line does reach the
    // simulation mesh — it splits faces and becomes a flat facet crease — but a
    // flat crease across a facet changes the discretization, not the folded
    // form. Construction lines are drawn constantly; marking a window stale for
    // one would be noise.
    const scribbled = documentOf([...SQUARE_LINES, line(2, 2, 8, 8, 'Cyan3')]);
    expect(isInlineSimulationStale(scribbled, created)).toBe(false);
  });

  it('stays quiet when it has no provenance to compare', () => {
    const noProvenance: InlineSimulation = {
      ...created,
      sourceBounds: null,
      sourceFingerprint: null,
    };
    expect(isInlineSimulationStale(document, noProvenance)).toBe(false);
  });
});

describe('where a new window parks', () => {
  const document = documentOf(SQUARE_LINES);
  const seg = segment(0, [UNIT_SQUARE]);

  function place(blockers: Array<{ minX: number; minY: number; maxX: number; maxY: number }>) {
    return createInlineSimulation({
      id: 'sim-place',
      segment: seg,
      document,
      cpLineIds: document.crease_pattern.line_segments.map((_, index) => index + 1),
      z: 1,
      view: { yaw: 0, pitch: 0, zoom: 1 },
      blockers,
    }).box;
  }

  it('parks beside the region rather than on top of it', () => {
    // Written over its own creases, a window hides exactly the thing you opened
    // it to compare against.
    const box = place([]);
    expect(box.center.x - box.width / 2).toBeGreaterThan(10);
  });

  it('aligns its top with the region it came from', () => {
    const box = place([]);
    expect(box.center.y - box.height / 2).toBe(0);
  });

  it('clears something already parked in the same band', () => {
    const first = place([]);
    const firstLeft = first.center.x - first.width / 2;
    const second = place([
      { minX: firstLeft, minY: 0, maxX: firstLeft + first.width, maxY: first.height },
    ]);
    expect(second.center.x - second.width / 2).toBeGreaterThanOrEqual(firstLeft + first.width);
  });

  it('ignores something parked well below the band', () => {
    const alone = place([]);
    const withDistant = place([{ minX: 0, minY: 900, maxX: 999, maxY: 999 }]);
    expect(withDistant.center.x).toBe(alone.center.x);
  });
});
