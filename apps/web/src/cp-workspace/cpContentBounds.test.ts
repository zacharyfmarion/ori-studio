import { describe, expect, it } from 'vitest';
import { cpContentBounds, type CpOverlayBox } from './cpContentBounds';
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
  primitives: OristudioCpFoldedRenderPrimitive[] = [squarePrimitive],
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
      foldedFigureUserAabb(figure),
    );
  });

  it('is null when nothing is placed', () => {
    expect(cpContentBounds({ lineSegments: [], modelToSvg })).toBeNull();
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
