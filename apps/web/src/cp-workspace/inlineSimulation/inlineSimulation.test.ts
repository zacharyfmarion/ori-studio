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
  ringsMatch,
  type InlineSimulation,
} from './inlineSimulation';

function line(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color = 'Red1'
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

function simulationOver(
  document: OristudioCpDocumentSnapshot,
  seg: CpSegment
): InlineSimulation {
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
    expect(boundariesMatch([UNIT_SQUARE, ring([[1, 1], [2, 1], [2, 2]])], [other])).toBe(false);
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

describe('resolving a window to its region', () => {
  const document = documentOf(SQUARE_LINES);

  it('finds the region again after ids renumber', () => {
    const created = simulationOver(document, segment(2, [UNIT_SQUARE]));
    // A new region appearing above/left shifts every later id; the boundary does
    // not move, which is exactly why it is the identity and the id is not.
    const renumbered = [
      segment(0, [ring([[0, -20], [5, -20], [5, -15]])]),
      segment(1, [UNIT_SQUARE]),
    ];

    expect(resolveInlineSimulationSegment(created, renumbered)?.id).toBe(1);
  });

  it('does not pick a neighbour when its own region is gone', () => {
    const created = simulationOver(document, segment(0, [UNIT_SQUARE]));
    const elsewhere = [segment(0, [ring([[50, 50], [60, 50], [60, 60], [50, 60]])])];

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
