import { describe, expect, it } from 'vitest';
import {
  applyFoldedPlacementToPoint,
  cpContradictionFaceFills,
  cpUserAnchorForLineIds,
  placeFoldedFigureBesideCp,
  cpFoldedToScene,
  foldedFigureBox,
  foldedFigureLocalGeometry,
  foldedFigureUserBounds,
} from './cpFoldedToScene';
import { cpModelToSvg } from '../../lib/creasePatternViewport';
import { IDENTITY_FOLDED_PLACEMENT } from '../../engine/oristudioCpTypes';
import type {
  FoldedFigurePlacement,
  OristudioCpContradictionFaceGeometry,
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedFigureSnapshot,
  OristudioCpFoldedRenderPrimitive,
} from '../../engine/oristudioCpTypes';

function figure(
  primitives: OristudioCpFoldedRenderPrimitive[],
  placement: FoldedFigurePlacement = IDENTITY_FOLDED_PLACEMENT
): OristudioCpFoldedFigureEntry {
  return {
    id: 'f1',
    title: 'f1',
    handle: null,
    sourceKind: 'generated-from-current-cp',
    sourceCpRevision: null,
    startingFaceId: null,
    displayStyle: 'preview' as OristudioCpFoldedFigureEntry['displayStyle'],
    status: 'ready',
    snapshot: null,
    renderSnapshot: { schema_version: 1, fixture: null, pass: null, primitives },
    placement,
    error: null,
  };
}

const solid = (r: number, g: number, b: number, a: number) =>
  ({ kind: 'color', color: { red: r, green: g, blue: b, alpha: a } }) as const;

describe('cpFoldedToScene', () => {
  it('triangulates a fill polygon into fill vertices', () => {
    const geo = cpFoldedToScene([
      figure([
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        },
      ]),
    ]);
    // a quad triangulates into 2 triangles = 6 vertices
    expect(geo.fills.count).toBe(6);
    expect(geo.strokes.count).toBe(0);
    // red, full alpha
    expect(geo.fills.color[0]).toBeCloseTo(1);
    expect(geo.fills.color[3]).toBeCloseTo(1);
  });

  it('emits edge segments for a stroke polygon', () => {
    const geo = cpFoldedToScene([
      figure([
        {
          sequence: 0,
          kind: 'stroke_polygon',
          style: {
            paint: solid(0, 0, 0, 255),
            stroke: { kind: 'basic', width: 2, end_cap: 0, line_join: 0, miter_limit: 4 },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 4, y: 0 },
              { x: 4, y: 4 },
            ],
          },
        },
      ]),
    ]);
    expect(geo.fills.count).toBe(0);
    expect(geo.strokes.count).toBe(2); // 3 points -> 2 segments
    expect(geo.strokes.widthMul[0]).toBeCloseTo(2);
  });

  it('skips figures without a render snapshot', () => {
    const geo = cpFoldedToScene([{ ...figure([]), renderSnapshot: null }]);
    expect(geo.fills.count).toBe(0);
    expect(geo.strokes.count).toBe(0);
  });
});

const strokeTriangle = (placement: FoldedFigurePlacement = IDENTITY_FOLDED_PLACEMENT) =>
  figure(
    [
      {
        sequence: 0,
        kind: 'stroke_polygon',
        style: {
          paint: solid(0, 0, 0, 255),
          stroke: { kind: 'basic', width: 1, end_cap: 0, line_join: 0, miter_limit: 4 },
          antialias: 'default',
        },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 8, y: 0 },
            { x: 8, y: 8 },
          ],
        },
      },
    ],
    placement
  );

describe('draw order as depth', () => {
  // The canvas batches every folded fill into one draw and every folded stroke
  // into another, which throws away the painter order the projector computed —
  // so a crease behind a face drew over it. The depth attribute is that order
  // made numeric, and these are the properties the depth test relies on.
  const twoPrimitives = (): OristudioCpFoldedRenderPrimitive[] => [
    {
      sequence: 0,
      kind: 'fill_polygon',
      style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
      geometry: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    },
    {
      sequence: 1,
      kind: 'stroke_polygon',
      style: {
        paint: solid(0, 0, 0, 255),
        stroke: { kind: 'basic', width: 1, end_cap: 0, line_join: 0, miter_limit: 4 },
        antialias: 'default',
      },
      geometry: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 10 },
        ],
      },
    },
  ];

  it('gives every primitive its own depth, increasing with sequence', () => {
    const geo = cpFoldedToScene([figure(twoPrimitives())]);
    const fill = geo.fills.depth!;
    const stroke = geo.strokes.depth!;
    expect(fill.length).toBe(geo.fills.count);
    expect(stroke.length).toBe(geo.strokes.count);
    // The fill is sequence 0 and the stroke sequence 1, so the stroke must be
    // nearer — that is the whole fix, in one assertion.
    expect(stroke[0]).toBeGreaterThan(fill[0]);
    // Inside (0, 1]: never 0, which is where a missing depth lands, and never
    // past the cleared value.
    for (const d of [...fill, ...stroke]) {
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(1);
    }
  });

  it('keeps two figures in their own depth bands, so they cannot interleave', () => {
    const first = { ...figure(twoPrimitives()), id: 'first' };
    const second = { ...figure(twoPrimitives()), id: 'second' };
    const geo = cpFoldedToScene([first, second]);
    const fill = geo.fills.depth!;
    // Every vertex of the second figure is nearer than every vertex of the
    // first, whatever their internal order — a later figure covers an earlier
    // one, which is what painter order did before.
    const half = fill.length / 2;
    const firstMax = Math.max(...Array.from(fill.slice(0, half)));
    const secondMin = Math.min(...Array.from(fill.slice(half)));
    expect(secondMin).toBeGreaterThan(firstMax);
  });

  it('is stable under placement, which only moves the figure', () => {
    const base = cpFoldedToScene([figure(twoPrimitives())]);
    const moved = cpFoldedToScene([
      figure(twoPrimitives(), { offset: { x: 40, y: 7 }, scale: 3, rotation: 1.2 }),
    ]);
    expect(Array.from(moved.fills.depth!)).toEqual(Array.from(base.fills.depth!));
  });
});

describe('folded figure placement', () => {
  /** The centre of the rendered geometry, which placement pivots on. */
  const drawnCenter = (entry: OristudioCpFoldedFigureEntry) => {
    const geo = cpFoldedToScene([entry]);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < geo.strokes.count * 2; i += 2) {
      for (const [x, y] of [
        [geo.strokes.a[i], geo.strokes.a[i + 1]],
        [geo.strokes.b[i], geo.strokes.b[i + 1]],
      ]) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
  };

  it('translates by the placement offset', () => {
    const base = cpFoldedToScene([strokeTriangle()]);
    const moved = cpFoldedToScene([
      strokeTriangle({ offset: { x: 100, y: -25 }, scale: 1, rotation: 0 }),
    ]);
    for (let i = 0; i < base.strokes.count * 2; i += 2) {
      expect(moved.strokes.a[i]).toBeCloseTo(base.strokes.a[i] + 100);
      expect(moved.strokes.a[i + 1]).toBeCloseTo(base.strokes.a[i + 1] - 25);
    }
  });

  it('scales about the figure centre, so the centre does not move', () => {
    const base = drawnCenter(strokeTriangle());
    const scaled = drawnCenter(
      strokeTriangle({ offset: { x: 0, y: 0 }, scale: 3, rotation: 0 })
    );
    expect(scaled.x).toBeCloseTo(base.x);
    expect(scaled.y).toBeCloseTo(base.y);
  });

  it('rotates every vertex about the figure centre', () => {
    // The pivot is preserved, not the bounding box: turning a triangle changes
    // the box it occupies, so the invariant to assert is the per-vertex map
    // v ↦ c0 + R(θ)(v − c0), with c0 the unplaced centre.
    const angle = Math.PI / 3;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const pivot = foldedFigureBox(strokeTriangle())!.center;
    const base = cpFoldedToScene([strokeTriangle()]);
    const rotated = cpFoldedToScene([
      strokeTriangle({ offset: { x: 0, y: 0 }, scale: 1, rotation: angle }),
    ]);
    for (let i = 0; i < base.strokes.count * 2; i += 2) {
      const dx = base.strokes.a[i] - pivot.x;
      const dy = base.strokes.a[i + 1] - pivot.y;
      expect(rotated.strokes.a[i]).toBeCloseTo(pivot.x + dx * cos - dy * sin);
      expect(rotated.strokes.a[i + 1]).toBeCloseTo(pivot.y + dx * sin + dy * cos);
    }
  });

  it('a half-turn maps every vertex to its reflection through the centre', () => {
    const base = cpFoldedToScene([strokeTriangle()]);
    const center = drawnCenter(strokeTriangle());
    const turned = cpFoldedToScene([
      strokeTriangle({ offset: { x: 0, y: 0 }, scale: 1, rotation: Math.PI }),
    ]);
    for (let i = 0; i < base.strokes.count * 2; i += 2) {
      expect(turned.strokes.a[i]).toBeCloseTo(2 * center.x - base.strokes.a[i]);
      expect(turned.strokes.a[i + 1]).toBeCloseTo(2 * center.y - base.strokes.a[i + 1]);
    }
  });

  it('leaves other figures unaffected', () => {
    const other = { ...strokeTriangle(), id: 'other' };
    const base = cpFoldedToScene([other]);
    const withPlaced = cpFoldedToScene([
      other,
      { ...strokeTriangle({ offset: { x: 500, y: 500 }, scale: 4, rotation: 1 }), id: 'placed' },
    ]);
    for (let i = 0; i < base.strokes.count * 2; i += 2) {
      expect(withPlaced.strokes.a[i]).toBeCloseTo(base.strokes.a[i]);
    }
  });

  it('caches local geometry per render snapshot so drags avoid re-triangulating', () => {
    const entry = strokeTriangle();
    const snapshot = entry.renderSnapshot!;
    const first = foldedFigureLocalGeometry(snapshot);
    const second = foldedFigureLocalGeometry(snapshot);
    expect(second).toBe(first);
    // A different snapshot object is a different cache entry.
    expect(foldedFigureLocalGeometry({ ...snapshot })).not.toBe(first);
  });
});

describe('foldedFigureBox', () => {
  it('scales the box extents and carries the rotation', () => {
    const base = foldedFigureBox(strokeTriangle())!;
    const placed = foldedFigureBox(
      strokeTriangle({ offset: { x: 10, y: 20 }, scale: 2, rotation: 0.5 })
    )!;
    expect(placed.width).toBeCloseTo(base.width * 2);
    expect(placed.height).toBeCloseTo(base.height * 2);
    expect(placed.rotation).toBeCloseTo(0.5);
    expect(placed.center.x).toBeCloseTo(base.center.x + 10);
    expect(placed.center.y).toBeCloseTo(base.center.y + 20);
  });

  it('is null for a figure that draws nothing', () => {
    expect(foldedFigureBox(figure([]))).toBeNull();
    expect(foldedFigureBox({ ...figure([]), renderSnapshot: null })).toBeNull();
  });

  it('gives a 3D figure a square frame that does not follow its projection', () => {
    // The bug: a 3D figure's box was the bounding box of whatever the projection
    // produced, so turning the model resized and shifted its chrome under the
    // cursor. A figure is a window onto the model, and a window does not change
    // shape because you turned what is inside it.
    const framed = (primitives: Parameters<typeof figure>[0]) => ({
      ...figure(primitives),
      frameRadius: 30,
    });
    // Two *different* projections of the same figure — as an orbit produces.
    const wide = foldedFigureBox(framed(strokeTriangle().renderSnapshot!.primitives))!;
    const tall = foldedFigureBox(
      framed([
        {
          sequence: 0,
          kind: 'stroke_polygon',
          style: {
            paint: solid(0, 0, 0, 255),
            stroke: { kind: 'basic', width: 1, end_cap: 0, line_join: 0, miter_limit: 4 },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 400 },
            ],
          },
        },
      ])
    )!;
    // Square, and the same box for two different projections — the point of the
    // frame. The side is `2 * frameRadius` carried into user coordinates by
    // `cpModelToSvg`, so it is asserted as square-and-stable rather than as a
    // number that restates the conversion.
    expect(wide.width).toBe(wide.height);
    expect(wide.width).toBeGreaterThan(0);
    expect(tall).toEqual(wide);
  });

  it('reports the box centre the drawing actually pivots about', () => {
    // The regression: a framed figure's box reported the placement offset alone
    // while `cpFoldedToScene` still pivoted on the local bbox centre, so the
    // overlay drew its invisible click polygon displaced from the visible figure
    // by exactly that centre — and the figure stopped responding to clicks.
    //
    // The contract is one point: whatever the box calls its centre, a local point
    // at the pivot must land there under the same placement the drawing uses.
    // `applyFoldedPlacementToPoint` is that placement, so this compares the two
    // halves against each other rather than against a remembered number.
    for (const placement of [
      IDENTITY_FOLDED_PLACEMENT,
      { offset: { x: 37, y: -11 }, scale: 1, rotation: 0 },
      { offset: { x: 37, y: -11 }, scale: 2.5, rotation: 0.9 },
    ]) {
      const entry = { ...strokeTriangle(placement), frameRadius: 30 };
      const box = foldedFigureBox(entry)!;
      // A framed figure pivots where the projection puts the model centroid,
      // which reaches this module through `cpModelToSvg` — so it is that point
      // in user coordinates, not user (0, 0). Getting this wrong is what put the
      // click polygon 380 units from the figure.
      const pivot = cpModelToSvg({ x: 0, y: 0 });
      const drawn = applyFoldedPlacementToPoint(pivot, placement, pivot);
      expect(box.center.x).toBeCloseTo(drawn.x);
      expect(box.center.y).toBeCloseTo(drawn.y);
    }
  });

  it('leaves a figure with no frame on its projected bounds', () => {
    // `frameRadius` is null on every flat figure, and on a 3D one written before
    // frames existed. Both keep the old behaviour — the box follows the drawing
    // — rather than collapsing to a square of side zero.
    const triangle = foldedFigureBox(strokeTriangle())!;
    const line = foldedFigureBox(
      figure([
        {
          sequence: 0,
          kind: 'stroke_polygon',
          style: {
            paint: solid(0, 0, 0, 255),
            stroke: { kind: 'basic', width: 1, end_cap: 0, line_join: 0, miter_limit: 4 },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 1, y: 0 },
              { x: 1, y: 400 },
            ],
          },
        },
      ])
    )!;
    expect(line.height).toBeGreaterThan(triangle.height * 10);
  });
});

describe('foldedFigureUserBounds', () => {
  const polygonFigure = () =>
    figure([
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      },
    ]);

  it('returns one non-empty bounds per drawable figure', () => {
    const [entry, ...rest] = foldedFigureUserBounds([polygonFigure()]);
    expect(rest).toHaveLength(0);
    expect(entry.id).toBe('f1');
    expect(entry.bounds.maxX).toBeGreaterThan(entry.bounds.minX);
    expect(entry.bounds.maxY).toBeGreaterThan(entry.bounds.minY);
  });

  it('shifts bounds by the placement offset', () => {
    const base = foldedFigureUserBounds([polygonFigure()])[0].bounds;
    const shifted = foldedFigureUserBounds([
      {
        ...polygonFigure(),
        placement: { offset: { x: 100, y: 50 }, scale: 1, rotation: 0 },
      },
    ])[0].bounds;
    expect(shifted.minX - base.minX).toBeCloseTo(100);
    expect(shifted.maxX - base.maxX).toBeCloseTo(100);
    expect(shifted.minY - base.minY).toBeCloseTo(50);
    expect(shifted.maxY - base.maxY).toBeCloseTo(50);
  });

  it('omits figures with no drawable geometry', () => {
    expect(foldedFigureUserBounds([figure([])])).toHaveLength(0);
    expect(foldedFigureUserBounds([{ ...figure([]), renderSnapshot: null }])).toHaveLength(0);
  });

  it('takes the AABB over the rotated corners, so a rotated figure stays enclosed', () => {
    const square = foldedFigureUserBounds([polygonFigure()])[0].bounds;
    const side = square.maxX - square.minX;
    const turned = foldedFigureUserBounds([
      { ...polygonFigure(), placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: Math.PI / 4 } },
    ])[0].bounds;
    // A square turned 45 degrees has a bounding box sqrt(2) times as wide.
    expect(turned.maxX - turned.minX).toBeCloseTo(side * Math.SQRT2);
    expect(turned.maxY - turned.minY).toBeCloseTo(side * Math.SQRT2);
  });
});

describe('cpContradictionFaceFills', () => {
  const quad = (x: number, y: number) => [
    { x, y },
    { x: x + 10, y },
    { x: x + 10, y: y + 10 },
    { x, y: y + 10 },
  ];

  function figureWithContradiction(
    faces: OristudioCpContradictionFaceGeometry | null
  ): OristudioCpFoldedFigureEntry {
    const snapshot = {
      contradiction_faces: faces,
    } as unknown as OristudioCpFoldedFigureSnapshot;
    return { ...figure([]), snapshot: faces ? snapshot : null };
  }

  it('is empty when no figure has a contradiction', () => {
    expect(cpContradictionFaceFills([figureWithContradiction(null)]).count).toBe(0);
  });

  it('triangulates both contradicting faces as translucent red, in model coords', () => {
    const geo = cpContradictionFaceFills([
      figureWithContradiction({ upper: quad(0, 0), lower: quad(20, 0) }),
    ]);
    // two quads -> 2 triangles each -> 12 vertices
    expect(geo.count).toBe(12);
    expect(geo.color[0]).toBeCloseTo(1); // red
    expect(geo.color[1]).toBeCloseTo(0);
    expect(geo.color[2]).toBeCloseTo(0);
    expect(geo.color[3]).toBeCloseTo(75 / 255); // Oriedita (255,0,0,75)
    // positions are the raw model coords (no SVG mapping): every vertex lies in
    // one of the two 10x10 quads.
    for (let i = 0; i < geo.count; i++) {
      const x = geo.position[i * 2];
      expect((x >= 0 && x <= 10) || (x >= 20 && x <= 30)).toBe(true);
    }
  });

  it('skips degenerate (sub-triangle) face rings', () => {
    const geo = cpContradictionFaceFills([
      figureWithContradiction({ upper: [{ x: 0, y: 0 }, { x: 1, y: 1 }], lower: quad(0, 0) }),
    ]);
    // upper has < 3 points -> dropped; lower quad -> 6 vertices
    expect(geo.count).toBe(6);
  });
});

describe('placeFoldedFigureBesideCp', () => {
  const paper = { right: 200, top: 40 };
  /** Mirrors FOLDED_FIGURE_GAP; kept local so the tests state their own setup. */
  const FIGURE_GAP = 48;

  it('parks the figure clear of the crease pattern', () => {
    const figure = polygonFigureNamed('a');
    const placed = { ...figure, placement: placeFoldedFigureBesideCp(figure, [], paper) };
    expect(foldedFigureUserBounds([placed])[0].bounds.minX).toBeGreaterThanOrEqual(paper.right);
  });

  it('lines the figure top up with the paper top', () => {
    const figure = polygonFigureNamed('a');
    const placed = { ...figure, placement: placeFoldedFigureBesideCp(figure, [], paper) };
    expect(foldedFigureUserBounds([placed])[0].bounds.minY).toBeCloseTo(paper.top);
  });

  it("parks a framed 3D figure by its box, not by what it draws", () => {
    // The bug: the slot was sized from the drawing's extent and the offset
    // measured from the drawing's centre, while `foldedFigureBox` reports the
    // framed square about the projected centroid. Two different rectangles, so a
    // fresh 3D fold's chrome overlapped the crease pattern it was parked beside
    // even though the model itself sat clear of it.
    //
    // An inline simulation cannot have this bug: the rectangle it reserves *is*
    // the box it is given. This asserts the same property here — the box the
    // figure ends up with clears the paper, not merely its drawing.
    const framed = { ...polygonFigureNamed('a'), frameRadius: 40 };
    const placed = { ...framed, placement: placeFoldedFigureBesideCp(framed, [], paper) };
    const box = foldedFigureBox(placed)!;
    expect(box.center.x - box.width / 2).toBeGreaterThanOrEqual(paper.right);
    expect(box.center.y - box.height / 2).toBeCloseTo(paper.top);
  });

  it('leaves a flat figure placed exactly where it was', () => {
    // The framed branch must not move a figure that has no frame: for those the
    // identity box *is* the drawing's bounds and centre, so this is a byte
    // check that flat placement is untouched.
    const figure = polygonFigureNamed('a');
    const placement = placeFoldedFigureBesideCp(figure, [], paper);
    const placed = { ...figure, placement };
    expect(foldedFigureUserBounds([placed])[0].bounds.minX).toBeGreaterThanOrEqual(paper.right);
    expect(foldedFigureUserBounds([placed])[0].bounds.minY).toBeCloseTo(paper.top);
  });

  it('places without scaling or rotating', () => {
    const placement = placeFoldedFigureBesideCp(polygonFigureNamed('a'), [], paper);
    expect(placement.scale).toBe(1);
    expect(placement.rotation).toBe(0);
  });

  it('keeps every figure in the row top-aligned', () => {
    const first = polygonFigureNamed('a');
    const firstPlaced = { ...first, placement: placeFoldedFigureBesideCp(first, [], paper) };
    const second = polygonFigureNamed('b');
    const secondPlaced = {
      ...second,
      placement: placeFoldedFigureBesideCp(second, [firstPlaced], paper),
    };
    expect(foldedFigureUserBounds([secondPlaced])[0].bounds.minY).toBeCloseTo(
      foldedFigureUserBounds([firstPlaced])[0].bounds.minY
    );
  });

  it('lines a second figure up beside the first instead of stacking', () => {
    const first = polygonFigureNamed('a');
    const firstPlaced = {
      ...first,
      placement: placeFoldedFigureBesideCp(first, [], paper),
    };
    const second = polygonFigureNamed('b');
    const secondPlaced = {
      ...second,
      placement: placeFoldedFigureBesideCp(second, [firstPlaced], paper),
    };
    const a = foldedFigureUserBounds([firstPlaced])[0].bounds;
    const b = foldedFigureUserBounds([secondPlaced])[0].bounds;
    expect(b.minX).toBeGreaterThan(a.maxX);
  });

  it('ignores a figure parked outside the row, instead of fleeing right of it', () => {
    // The bug this replaced: any figure anywhere raised a high-water mark, so
    // one dragged far below still flung the next fold off to the right.
    const far = {
      ...polygonFigureNamed('far'),
      placement: { offset: { x: 5000, y: 5000 }, scale: 1, rotation: 0 },
    };
    const next = polygonFigureNamed('b');
    const alone = placeFoldedFigureBesideCp(next, [], paper);
    const withFar = placeFoldedFigureBesideCp(next, [far], paper);
    expect(withFar).toEqual(alone);
  });

  it('reuses a hole left in the middle of the row', () => {
    const first = polygonFigureNamed('a');
    const firstPlaced = { ...first, placement: placeFoldedFigureBesideCp(first, [], paper) };
    const second = polygonFigureNamed('b');
    const secondPlaced = {
      ...second,
      placement: placeFoldedFigureBesideCp(second, [firstPlaced], paper),
    };
    const third = polygonFigureNamed('c');
    const thirdPlaced = {
      ...third,
      placement: placeFoldedFigureBesideCp(third, [firstPlaced, secondPlaced], paper),
    };
    // Delete the middle one; the next fold should take its slot back rather than
    // landing past the third.
    const refilled = placeFoldedFigureBesideCp(polygonFigureNamed('d'), [
      firstPlaced,
      thirdPlaced,
    ], paper);
    expect(refilled).toEqual(secondPlaced.placement);
  });

  it('skips a slot that is too narrow and takes the next one', () => {
    // A neighbour leaving a real gap in front of it, but only half as wide as
    // the figure needs — first-fit must pass it by rather than squeeze in.
    const size = figureSize();
    const tight = figureAt('tight', paper.right + FIGURE_GAP + size.width / 2, paper.top);
    const placed = {
      ...polygonFigureNamed('d'),
      placement: placeFoldedFigureBesideCp(polygonFigureNamed('d'), [tight], paper),
    };
    const tightBounds = foldedFigureUserBounds([tight])[0].bounds;
    expect(foldedFigureUserBounds([placed])[0].bounds.minX).toBeGreaterThanOrEqual(
      tightBounds.maxX
    );
  });

  it('clears a rotated neighbour in the row by its turned extent', () => {
    const turned = figureAt('turned', paper.right + 200, paper.top, Math.PI / 4);
    const next = polygonFigureNamed('b');
    const placed = {
      ...next,
      placement: placeFoldedFigureBesideCp(next, [turned], paper),
    };
    const turnedBounds = foldedFigureUserBounds([turned])[0].bounds;
    const placedBounds = foldedFigureUserBounds([placed])[0].bounds;
    // Either it fits in the gap before the turned figure, or it clears it —
    // never overlapping the turned figure's true (rotated) extent.
    const clears =
      placedBounds.maxX <= turnedBounds.minX || placedBounds.minX >= turnedBounds.maxX;
    expect(clears).toBe(true);
  });

  it('is identity for a figure that draws nothing', () => {
    expect(placeFoldedFigureBesideCp(figure([]), [], paper)).toEqual(
      IDENTITY_FOLDED_PLACEMENT
    );
  });
});

/** The unplaced footprint of the test figure, in user units. */
function figureSize(): { width: number; height: number } {
  const local = foldedFigureLocalGeometry(polygonFigureNamed('m').renderSnapshot!);
  const bounds = local.bounds!;
  return { width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY };
}

/** A test figure whose unrotated top-left sits at (left, top) in user units. */
function figureAt(
  id: string,
  left: number,
  top: number,
  rotation = 0
): OristudioCpFoldedFigureEntry {
  const entry = polygonFigureNamed(id);
  const bounds = foldedFigureLocalGeometry(entry.renderSnapshot!).bounds!;
  return {
    ...entry,
    placement: {
      offset: { x: left - bounds.minX, y: top - bounds.minY },
      scale: 1,
      rotation,
    },
  };
}

function polygonFigureNamed(id: string): OristudioCpFoldedFigureEntry {
  return {
    ...figure([
      {
        sequence: 0,
        kind: 'fill_polygon',
        style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
        geometry: {
          kind: 'polygon',
          points: [
            { x: 0, y: 0 },
            { x: 10, y: 0 },
            { x: 10, y: 10 },
            { x: 0, y: 10 },
          ],
        },
      },
    ]),
    id,
  };
}

describe('cpUserAnchorForLineIds', () => {
  const doc = (segments: { a: { x: number; y: number }; b: { x: number; y: number } }[]) => ({
    crease_pattern: { line_segments: segments },
  });
  /** Mirrors CANVAS_OBJECT_GAP; kept local so the tests state their own setup. */
  const FIGURE_GAP = 48;

  // Regression: an `.ori` worksheet holds several 400-unit patterns tiled across
  // a canvas thousands of units from the nominal paper square, so "near the
  // paper" is not an assumption the placement path may make. The figure has to
  // land beside the creases it came from wherever those creases are, measured
  // through the one canvas mapping (`cpModelToSvg`) that draws them.
  it('parks the figure beside creases that sit far from the paper square', () => {
    // A real region from lamprey-draft-v0.6.ori.
    const document = doc([{ a: { x: 259.7, y: 1744.2 }, b: { x: 659.7, y: 2144.2 } }]);
    const anchor = cpUserAnchorForLineIds(document, [1]);
    const placed = {
      ...polygonFigureNamed('a'),
      placement: placeFoldedFigureBesideCp(polygonFigureNamed('a'), [], anchor),
    };
    const bounds = foldedFigureUserBounds([placed])[0].bounds;

    // Adjacent to where those creases actually draw, one gap to their right and
    // aligned to their top -- not to the paper square, and not off in space.
    expect(bounds.minX).toBeCloseTo(cpModelToSvg({ x: 659.7, y: 0 }).x + FIGURE_GAP);
    expect(bounds.minY).toBeCloseTo(cpModelToSvg({ x: 0, y: 1744.2 }).y);
  });

  it('anchors to the folded creases, not the whole sheet', () => {
    // Two patterns in the sheet; folding only the right-hand one must anchor to
    // that one, so the figure lands beside what was folded.
    const document = doc([
      { a: { x: 0, y: 0 }, b: { x: 0.1, y: 0.1 } },
      { a: { x: 0.6, y: 0.5 }, b: { x: 0.9, y: 0.8 } },
    ]);
    const left = cpUserAnchorForLineIds(document, [1]);
    const right = cpUserAnchorForLineIds(document, [2]);
    expect(right.right).toBeGreaterThan(left.right);
    expect(right.top).toBeGreaterThan(left.top);
  });

  it('spans every folded crease', () => {
    const document = doc([
      { a: { x: 0.2, y: 0.4 }, b: { x: 0.3, y: 0.5 } },
      { a: { x: 0.7, y: 0.1 }, b: { x: 0.8, y: 0.2 } },
    ]);
    const both = cpUserAnchorForLineIds(document, [1, 2]);
    expect(both.right).toBe(cpUserAnchorForLineIds(document, [2]).right);
    expect(both.top).toBe(cpUserAnchorForLineIds(document, [2]).top);
  });

  it('ignores ids that resolve to nothing', () => {
    const document = doc([{ a: { x: 0.2, y: 0.2 }, b: { x: 0.4, y: 0.4 } }]);
    expect(cpUserAnchorForLineIds(document, [1, 99])).toEqual(
      cpUserAnchorForLineIds(document, [1])
    );
  });

  it('falls back to the paper square when nothing resolves', () => {
    const anchor = cpUserAnchorForLineIds(doc([]), [1]);
    expect(Number.isFinite(anchor.right)).toBe(true);
    expect(Number.isFinite(anchor.top)).toBe(true);
  });
});

describe('cpFoldedToScene figure opacity', () => {
  const square = [
    {
      sequence: 0,
      kind: 'fill_polygon',
      style: { paint: solid(255, 0, 0, 255), stroke: { kind: 'none' }, antialias: 'default' },
      geometry: {
        kind: 'polygon',
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
          { x: 10, y: 10 },
          { x: 0, y: 10 },
        ],
      },
    },
  ] as unknown as OristudioCpFoldedRenderPrimitive[];

  function alphas(geo: ReturnType<typeof cpFoldedToScene>): number[] {
    const out: number[] = [];
    for (let i = 3; i < geo.fills.color.length; i += 4) out.push(geo.fills.color[i]);
    return out;
  }

  it('draws figures fully opaque by default', () => {
    const geo = cpFoldedToScene([figure(square)]);
    expect(alphas(geo).every((a) => a === 1)).toBe(true);
  });

  it('scales only the alpha channel, leaving colour intact', () => {
    const geo = cpFoldedToScene([figure(square)], () => 0.45);
    expect(alphas(geo).every((a) => Math.abs(a - 0.45) < 1e-6)).toBe(true);
    // Red stays red: fading must not desaturate a user-chosen paper colour.
    expect(geo.fills.color[0]).toBe(1);
    expect(geo.fills.color[1]).toBe(0);
  });

  // The cached local geometry is keyed on the render snapshot, so a naive
  // implementation that baked opacity into it would serve the first figure's
  // alpha to the second.
  it('applies per-figure opacity even when two figures share a snapshot', () => {
    const shared = figure(square);
    const other = { ...shared, id: 'f2' };
    const geo = cpFoldedToScene([shared, other], (f) => (f.id === 'f2' ? 0.45 : 1));
    const values = alphas(geo);
    const half = values.length / 2;
    expect(values.slice(0, half).every((a) => a === 1)).toBe(true);
    expect(values.slice(half).every((a) => Math.abs(a - 0.45) < 1e-6)).toBe(true);
  });
});

describe('gradient paint', () => {
  /**
   * The shape a shadow band takes: a quad spanned by the shadowed edge and the
   * offset, with the gradient running along that same offset.
   */
  const shadowBand = (): OristudioCpFoldedRenderPrimitive => ({
    sequence: 0,
    kind: 'fill_path',
    style: {
      paint: {
        kind: 'gradient',
        from: { x: 0, y: 0 },
        from_color: { red: 0, green: 0, blue: 0, alpha: 50 },
        to: { x: 0, y: 10 },
        to_color: { red: 0, green: 0, blue: 0, alpha: 0 },
        cyclic: false,
      },
      stroke: { kind: 'none' },
      antialias: 'default',
    },
    geometry: {
      kind: 'path',
      commands: [
        { command: 'move_to', point: { x: 0, y: 0 } },
        { command: 'line_to', point: { x: 0, y: 10 } },
        { command: 'line_to', point: { x: 40, y: 10 } },
        { command: 'line_to', point: { x: 40, y: 0 } },
        { command: 'close' },
      ],
    },
  });

  it('fades a shadow band from its start colour to transparent', () => {
    const geo = cpFoldedToScene([figure([shadowBand()])]);

    const alphas = new Set<number>();
    for (let i = 3; i < geo.fills.color.length; i += 4) {
      alphas.add(Number(geo.fills.color[i].toFixed(6)));
    }

    // Both ends of the gradient are present, which a flat fill could not produce.
    expect(alphas.has(Number((50 / 255).toFixed(6)))).toBe(true);
    expect(alphas.has(0)).toBe(true);
  });

  it('places the opaque end on the shadowed edge and the clear end away from it', () => {
    const geo = cpFoldedToScene([figure([shadowBand()])]);

    // The gradient runs along +y, so every vertex's alpha must fall as y rises.
    const byY = new Map<number, number>();
    for (let v = 0; v < geo.fills.count; v++) {
      const y = Number(geo.fills.position[v * 2 + 1].toFixed(4));
      byY.set(y, geo.fills.color[v * 4 + 3]);
    }
    const ys = [...byY.keys()].sort((l, r) => l - r);
    expect(ys.length).toBeGreaterThan(1);

    const first = byY.get(ys[0]);
    const last = byY.get(ys[ys.length - 1]);
    expect(first).toBeDefined();
    expect(last).toBeDefined();
    expect(first as number).toBeGreaterThan(last as number);
  });

  it('keeps a solid fill uniform', () => {
    const geo = cpFoldedToScene([
      figure([
        {
          sequence: 0,
          kind: 'fill_polygon',
          style: {
            paint: solid(0, 0, 255, 128),
            stroke: { kind: 'none' },
            antialias: 'default',
          },
          geometry: {
            kind: 'polygon',
            points: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
            ],
          },
        },
      ]),
    ]);

    const alphas = new Set<number>();
    for (let i = 3; i < geo.fills.color.length; i += 4) alphas.add(geo.fills.color[i]);
    // Colours round-trip through a Float32Array, so compare with tolerance.
    expect(alphas.size).toBe(1);
    expect([...alphas][0]).toBeCloseTo(128 / 255, 6);
  });
});
