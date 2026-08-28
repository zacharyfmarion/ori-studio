import { describe, expect, it } from 'vitest';
import {
  cpContentBounds,
  cpPlacedObjectBounds,
  cpSizingBounds,
  cpTrimmedCreaseBounds,
  unionBounds,
  type CpOverlayBox,
} from './cpContentBounds';
import { createCpImage } from './images/cpImage';
import { foldedFigureUserAabb } from './adapters/cpFoldedToScene';
import { IDENTITY_FOLDED_PLACEMENT } from '../engine/oristudioCpTypes';
import type {
  OristudioCpFoldedFigureEntry,
  OristudioCpFoldedRenderPrimitive,
} from '../engine/oristudioCpTypes';

// Model space and user space differ in the real canvas; an identity keeps the
// assertions about *what is included* rather than about the transform.
const modelToSvg = (p: { x: number; y: number }) => p;
const crease = { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } };

const boxAt = (x: number, y: number, hidden = false): CpOverlayBox => ({
  center: { x, y },
  width: 20,
  height: 20,
  rotation: 0,
  hidden,
});

const imageAt = (x: number, y: number, hidden = false) => ({
  ...createCpImage({
    src: 'data:image/png;base64,AAAA',
    naturalWidth: 10,
    naturalHeight: 10,
    center: { x, y },
    width: 20,
    height: 20,
  }),
  hidden,
});

/**
 * A folded figure occupying the user-space square (0,0)-(10,10) before placement.
 * Its render primitives are already in SVG user coordinates, which is the point
 * of the coordinate-space test below.
 */
const squarePrimitive: OristudioCpFoldedRenderPrimitive = {
  sequence: 0,
  kind: 'fill_polygon',
  style: {
    paint: { kind: 'color', color: { red: 255, green: 0, blue: 0, alpha: 255 } },
    stroke: { kind: 'none' },
    antialias: 'default',
  },
  geometry: {
    kind: 'polygon',
    points: [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
    ],
  },
};

const foldedFigureAt = (
  offset: { x: number; y: number },
  primitives: OristudioCpFoldedRenderPrimitive[] = [squarePrimitive]
): OristudioCpFoldedFigureEntry => ({
  id: 'generated-1',
  title: 'Folded model 1',
  handle: 1,
  sourceKind: 'generated-from-current-cp',
  sourceCpRevision: null,
  startingFaceId: null,
  displayStyle: 'Paper5',
  status: 'ready',
  snapshot: null,
  renderSnapshot: { schema_version: 1, fixture: null, pass: null, primitives },
  placement: { ...IDENTITY_FOLDED_PLACEMENT, offset },
  error: null,
});

describe('what the camera frames against', () => {
  it('includes the creases', () => {
    const bounds = cpContentBounds({ lineSegments: [crease], modelToSvg });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('includes inline simulation windows', () => {
    // The bug: windows live on their own DOM layer, so nothing here saw them and
    // fitting to view framed the creases alone — leaving a window off screen
    // with nothing to suggest why.
    const bounds = cpContentBounds({
      lineSegments: [crease],
      overlayBoxes: [boxAt(200, 0)],
      modelToSvg,
    });
    expect(bounds?.maxX).toBe(210);
  });

  it('includes reference images', () => {
    const bounds = cpContentBounds({
      lineSegments: [crease],
      images: [imageAt(-100, 0)],
      modelToSvg,
    });
    expect(bounds?.minX).toBe(-110);
  });

  it('grows to hold every kind at once', () => {
    const bounds = cpContentBounds({
      lineSegments: [crease],
      images: [imageAt(-100, 0)],
      overlayBoxes: [boxAt(200, 0), boxAt(0, -300)],
      modelToSvg,
    });
    expect(bounds).toEqual({ minX: -110, minY: -310, maxX: 210, maxY: 10 });
  });

  it('skips hidden content, which is not drawn', () => {
    // Framing to include something invisible just looks like a broken camera.
    const bounds = cpContentBounds({
      lineSegments: [crease],
      images: [imageAt(-500, 0, true)],
      overlayBoxes: [boxAt(500, 0, true)],
      modelToSvg,
    });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('frames placed content even with no creases at all', () => {
    // A window opened over an empty document still has to be reachable.
    const bounds = cpContentBounds({
      lineSegments: [],
      overlayBoxes: [boxAt(50, 50)],
      modelToSvg,
    });
    expect(bounds).toEqual({ minX: 40, minY: 40, maxX: 60, maxY: 60 });
  });

  it('includes folded figures', () => {
    // The same bug inline simulation windows had. A figure is parked to the
    // right of its source creases by construction (`placeFoldedFigureBesideCp`
    // anchors it one gap past `anchor.right`), so on a pattern with a figure
    // beside it and nothing further out, framing the creases alone cuts it off.
    const figure = foldedFigureAt({ x: 200, y: 0 });
    const bounds = cpContentBounds({
      lineSegments: [crease],
      foldedFigures: [figure],
      modelToSvg,
    });
    const figureBounds = foldedFigureUserAabb(figure)!;
    expect(figureBounds.maxX).toBeGreaterThan(10);
    expect(bounds?.maxX).toBeCloseTo(figureBounds.maxX);
  });

  it('leaves the bounds alone for a figure already inside them', () => {
    const bounds = cpContentBounds({
      lineSegments: [crease],
      overlayBoxes: [boxAt(5000, 5000)],
      foldedFigures: [foldedFigureAt({ x: 0, y: 0 })],
      modelToSvg,
    });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 5010, maxY: 5010 });
  });

  it('does not put folded figures through modelToSvg', () => {
    // A figure is already in SVG user space — the space its render primitives
    // land in once `foldedFigureLocalGeometry` has projected them — while every
    // other input here is model space. Projecting it a second time would place
    // it at the paper transform's scale, the mistake bf484295 was about.
    //
    // Pinned by giving the same figure two very different `modelToSvg`s: its
    // contribution must not move.
    const foldedFigures = [foldedFigureAt({ x: 0, y: 0 })];
    const identity = cpContentBounds({ lineSegments: [], foldedFigures, modelToSvg });
    const scaled = cpContentBounds({
      lineSegments: [],
      foldedFigures,
      modelToSvg: (p) => ({ x: p.x * 100, y: p.y * 100 }),
    });
    expect(scaled).toEqual(identity);
    expect(identity).toEqual(foldedFigureUserAabb(foldedFigures[0]));
  });

  it('skips a figure that draws nothing', () => {
    // No primitives, or no snapshot at all: nothing on screen, nothing to frame.
    const bounds = cpContentBounds({
      lineSegments: [crease],
      foldedFigures: [
        foldedFigureAt({ x: 9000, y: 9000 }, []),
        { ...foldedFigureAt({ x: 9000, y: 9000 }), renderSnapshot: null },
      ],
      modelToSvg,
    });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
  });

  it('frames a document whose only content is a folded figure', () => {
    // A figure has to be reachable even with the creases deleted out from under it.
    const figure = foldedFigureAt({ x: 50, y: 50 });
    expect(cpContentBounds({ lineSegments: [], foldedFigures: [figure], modelToSvg })).toEqual(
      foldedFigureUserAabb(figure)
    );
  });

  it('is null when nothing is placed', () => {
    expect(cpContentBounds({ lineSegments: [], modelToSvg })).toBeNull();
  });

  it('skips non-finite coordinates instead of poisoning the extent', () => {
    // A NaN compares false both ways, so without a guard it would leave the
    // extent alone yet still mark the box as populated; an infinity would
    // swallow it whole. Either way the camera fit that consumes this gets a
    // meaningless answer.
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      const bounds = cpContentBounds({
        lineSegments: [crease, { a: { x: bad, y: bad }, b: { x: 5, y: 5 } }],
        modelToSvg,
      });
      expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 10 });
    }
  });

  it('is null when every placed point is non-finite', () => {
    expect(
      cpContentBounds({
        lineSegments: [{ a: { x: Number.NaN, y: 0 }, b: { x: 1, y: Number.NaN } }],
        modelToSvg,
      })
    ).toBeNull();
  });

  it('keeps a merely far-away point so fitting to view still frames it', () => {
    // Only undrawable coordinates are rejected. A real but distant vertex is
    // content, and dropping it here would hide it from "Fit to view".
    const bounds = cpContentBounds({
      lineSegments: [crease, { a: { x: 1e9, y: 1e9 }, b: { x: 1e9, y: 1e9 } }],
      modelToSvg,
    });
    expect(bounds).toEqual({ minX: 0, minY: 0, maxX: 1e9, maxY: 1e9 });
  });

  it('accounts for a rotated box by its corners', () => {
    // A window can be rotated; its footprint is the rotated extent, not the
    // unrotated one.
    const bounds = cpContentBounds({
      lineSegments: [],
      overlayBoxes: [{ ...boxAt(0, 0), rotation: Math.PI / 4 }],
      modelToSvg,
    });
    expect(bounds!.maxX).toBeCloseTo(Math.sqrt(2) * 10, 5);
  });
});

describe('cpSizingBounds', () => {
  /**
   * A stand-in for a real pattern: creases tiling a 0..100 square, both
   * directions. The crossing direction matters — it is what puts many samples on
   * each extreme coordinate, which is the property that makes trimming inert on
   * real content (a CP's paper edge carries a vertex for every crease meeting
   * it). A one-directional fixture has two samples per extreme and would be
   * trimmed away, which is a fact about the fixture, not about crease patterns.
   */
  const grid = (n = 50) => {
    const at = (i: number) => (i / (n - 1)) * 100;
    return [
      ...Array.from({ length: n }, (_, i) => ({ a: { x: at(i), y: 0 }, b: { x: at(i), y: 100 } })),
      ...Array.from({ length: n }, (_, i) => ({ a: { x: 0, y: at(i) }, b: { x: 100, y: at(i) } })),
    ];
  };

  it('matches the raw bounds on a healthy pattern', () => {
    // The trim must be inert on real content: a CP's edges carry many vertices
    // at the same extreme, so discarding a few percent does not move it.
    const lineSegments = grid();
    expect(cpSizingBounds({ lineSegments, modelToSvg })).toEqual(
      cpContentBounds({ lineSegments, modelToSvg })
    );
  });

  it('ignores a stray far-away crease that would otherwise set the scale', () => {
    const lineSegments = [...grid(), { a: { x: -3.4e14, y: 3.4e14 }, b: { x: -550, y: 550 } }];
    // Framing still has to reach it...
    expect(cpContentBounds({ lineSegments, modelToSvg })!.minX).toBe(-3.4e14);
    // ...but sizing reads the same as if it were never drawn.
    expect(cpSizingBounds({ lineSegments, modelToSvg })).toEqual(
      cpContentBounds({ lineSegments: grid(), modelToSvg })
    );
  });

  it('keeps an image at full extent rather than trimming it away', () => {
    // Images are few and deliberately placed, so no percentile applies to them:
    // a document's only reference image must not drop out of its own scale.
    const bounds = cpSizingBounds({
      lineSegments: grid(),
      images: [imageAt(400, 400)],
      modelToSvg,
    });
    expect(bounds!.maxX).toBe(410);
    expect(bounds!.maxY).toBe(410);
  });

  it('falls back to the raw bounds when there are no creases to trim', () => {
    const input = { lineSegments: [], overlayBoxes: [boxAt(0, 0)], modelToSvg };
    expect(cpSizingBounds(input)).toEqual(cpContentBounds(input));
  });

  it('is null when nothing is placed', () => {
    expect(cpSizingBounds({ lineSegments: [], modelToSvg })).toBeNull();
  });

  it('keeps the finite endpoint of a half-unusable crease', () => {
    // One endpoint being undrawable does not make the other one stop existing.
    // Deliberately a tiny fixture: `floor(n * 0.02)` is 0 below 50 endpoints, so
    // nothing is trimmed here and this isolates the filter from the percentile.
    const lineSegments = [
      { a: { x: 0, y: 0 }, b: { x: 10, y: 10 } },
      { a: { x: Number.NaN, y: 0 }, b: { x: 40, y: 40 } },
      { a: { x: 0, y: Number.POSITIVE_INFINITY }, b: { x: 50, y: 50 } },
    ];
    expect(cpSizingBounds({ lineSegments, modelToSvg })).toEqual({
      minX: 0,
      minY: 0,
      maxX: 50,
      maxY: 50,
    });
  });

  it('reads the same through an axis-flipping transform', () => {
    // Selecting in model space is only sound because `modelToSvg` cannot reorder
    // an axis. A negative axis still cannot, so the result must simply come back
    // mirrored rather than inside out. A screen-style flip about y=200 rather
    // than plain negation, so a mirrored extreme is a distinct number from an
    // unmirrored one at both ends.
    const lineSegments = grid();
    const flipY = (p: { x: number; y: number }) => ({ x: p.x, y: 200 - p.y });
    expect(cpSizingBounds({ lineSegments, modelToSvg: flipY })).toEqual({
      minX: 0,
      minY: 100,
      maxX: 100,
      maxY: 200,
    });
  });

  it('selects the same extremes a full sort would, over randomised input', () => {
    // The quickselect replacing `Array.sort` is the part of this most able to be
    // subtly wrong — off by one at the trim index, or wrong on ties. Pin it
    // against the obvious implementation rather than against fixed expectations.
    const reference = (values: number[]) => {
      const sorted = [...values].sort((a, b) => a - b);
      const drop = Math.floor(sorted.length * 0.02);
      return { min: sorted[drop], max: sorted[sorted.length - 1 - drop] };
    };

    // A deterministic LCG: a seeded sequence keeps a failure reproducible.
    let seed = 0x2f6e2b1;
    const next = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };

    for (const count of [1, 2, 3, 24, 25, 26, 50, 99, 100, 501]) {
      for (const spread of [1, 1000]) {
        // Heavy ties at both ends are the realistic shape (a paper edge carries
        // many vertices at one coordinate) and the case a naive partition trips
        // on, so bias towards them rather than sampling uniformly.
        const xs = Array.from({ length: count }, () => {
          const r = next();
          if (r < 0.3) return 0;
          if (r > 0.7) return spread;
          return Math.round(r * spread);
        });
        const lineSegments = xs.map((x) => ({ a: { x, y: x }, b: { x, y: x } }));
        const expected = reference([...xs, ...xs]);
        const bounds = cpSizingBounds({ lineSegments, modelToSvg })!;
        expect({ min: bounds.minX, max: bounds.maxX }).toEqual(expected);
        expect({ min: bounds.minY, max: bounds.maxY }).toEqual(expected);
      }
    }
  });

  it('composes from the two halves the canvas memoises separately', () => {
    // The canvas does not call `cpSizingBounds`; it calls the halves so it can
    // key them on different deps. They must still add up to the same answer.
    const lineSegments = grid();
    const input = { lineSegments, images: [imageAt(400, 400)], modelToSvg };
    expect(
      unionBounds(
        cpTrimmedCreaseBounds(lineSegments, modelToSvg),
        cpPlacedObjectBounds({ images: [imageAt(400, 400)], modelToSvg })
      )
    ).toEqual(cpSizingBounds(input));
  });
});
