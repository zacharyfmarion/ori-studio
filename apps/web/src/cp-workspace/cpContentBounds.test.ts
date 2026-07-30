import { describe, expect, it } from 'vitest';
import { cpContentBounds, type CpOverlayBox } from './cpContentBounds';
import { createCpImage } from './images/cpImage';

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
