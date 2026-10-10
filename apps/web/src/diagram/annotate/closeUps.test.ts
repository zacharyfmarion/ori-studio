import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { paintAsset, paintSource, UPRIGHT } from '../pictures/paintDiagramStep';
import { hitAnnotation } from './annotationHit';
import {
  CLOSE_UP_GAP,
  CLOSE_UP_SCALE,
  DEFAULT_CLOSE_UP_RADIUS,
  DEFAULT_CLOSE_UP_SCALE,
  MAX_CLOSE_UP_RADIUS,
  MIN_CLOSE_UP_RADIUS,
  annotationEnds,
  behindEnds,
  canBeShaped,
  carriesText,
  carryAnnotation,
  cleanAnnotation,
  closeUpFrame,
  closeUpScaleWithin,
  closeUpShape,
  createAnnotation,
  flipsArc,
  isDegenerate,
  mirrorMove,
  moveAnnotation,
  moveAnnotationEnd,
  placedByClick,
  withCloseUpRing,
  withCloseUpScale,
  type PictureMove,
} from './annotationModel';
import { annotationDrawing, annotationReach, annotationScene } from './annotationPrimitives';
import { annotatedPicture, CARD_FRAME_PX, paintAnnotations, type CloseUpPicture } from './paintAnnotations';

const closeUp = (extra: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id: 'zoom',
  kind: 'close-up',
  from: [0.5, 0.3],
  to: [1.21, 0.3],
  radius: 0.08,
  scale: 2,
  ...extra,
});
const valley: KnownDiagramAnnotation = { id: 'crease', kind: 'valley-line', from: [0.45, 0.3], to: [0.55, 0.3] };

describe('a new close-up (15f)', () => {
  it('is dragged between bounding corners, its close-up put beside the picture on the near side at twice', () => {
    // A frame taller than wide: beside it, right of an area in its right half.
    const made = createAnnotation('close-up', [0.4, 0.2], [0.6, 0.4], { width: 0.7, height: 1 }, () => 'z');
    expect(made).toEqual({
      id: 'z',
      kind: 'close-up',
      from: [expect.closeTo(0.5, 12), expect.closeTo(0.3, 12)],
      to: [expect.closeTo(0.7 + CLOSE_UP_GAP + 0.2, 12), expect.closeTo(0.3, 12)],
      radius: expect.closeTo(0.1, 12),
      scale: DEFAULT_CLOSE_UP_SCALE,
    });
    // Left of one in its left half.
    const left = createAnnotation('close-up', [0.1, 0.5], [0.3, 0.7], { width: 0.7, height: 1 });
    expect(left.to[0]).toBeCloseTo(-(CLOSE_UP_GAP + 0.2), 12);
    expect(left.to[1]).toBeCloseTo(0.6, 12);
    // A frame wider than tall: above or below it, the nearer.
    const below = createAnnotation('close-up', [0.45, 0.4], [0.55, 0.5], { width: 1, height: 0.6 });
    expect(below.to).toEqual([0.5, expect.closeTo(0.6 + CLOSE_UP_GAP + 0.1, 12)]);
    const above = createAnnotation('close-up', [0.25, 0.05], [0.35, 0.15], { width: 1, height: 0.6 });
    expect(above.to).toEqual([0.3, expect.closeTo(-(CLOSE_UP_GAP + 0.1), 12)]);
  });

  it('is put down with a click a corner’s worth, and no larger than the picture', () => {
    const clicked = createAnnotation('close-up', [0.5, 0.5], [0.5, 0.5], { width: 1, height: 1 });
    expect(clicked.radius).toBe(DEFAULT_CLOSE_UP_RADIUS);
    expect(placedByClick('close-up')).toBe(true);
    expect(isDegenerate(clicked, MIN_CLOSE_UP_RADIUS)).toBe(false);
    expect(createAnnotation('close-up', [0.5, 0.5], [3, 0.5], { width: 1, height: 1 }).radius).toBe(MAX_CLOSE_UP_RADIUS);
  });

  it('is two circles, not ends: nothing to shape, flip, write in or put behind', () => {
    expect(annotationEnds({ kind: 'close-up' })).toEqual([]);
    expect(behindEnds('close-up')).toEqual([]);
    expect(canBeShaped('close-up')).toBe(false);
    expect(flipsArc('close-up')).toBe(false);
    expect(carriesText('close-up')).toBe(false);
  });
});

describe('a close-up’s shape (15f)', () => {
  it('rings its area and its close-up, a line between them along their centres, rim to rim', () => {
    const shape = closeUpShape(closeUp());
    expect(shape.area).toEqual({ centre: [0.5, 0.3], radius: 0.08 });
    expect(shape.inset.centre).toEqual([1.21, 0.3]);
    expect(shape.inset.radius).toBeCloseTo(0.16, 12);
    expect(shape.line![0]).toEqual([0.58, 0.3]);
    expect(shape.line![1][0]).toBeCloseTo(1.05, 12);
    // Where the rings meet, no line.
    expect(closeUpShape(closeUp({ to: [0.7, 0.3] })).line).toBeNull();
  });

  it('draws the picture inside it larger about the area’s middle, landed on the close-up’s', () => {
    const shape = closeUpShape(closeUp());
    const frame = closeUpFrame(shape, { width: 1, height: 0.75 });
    // The area's middle, a picture point, lands on the close-up's middle.
    expect(frame.x + 2 * 0.5).toBeCloseTo(1.21, 12);
    expect(frame.y + 2 * 0.3).toBeCloseTo(0.3, 12);
    expect([frame.width, frame.height]).toEqual([2, 1.5]);
  });
});

describe('resizing a close-up by its rings (15f)', () => {
  it('sizes its area by the area’s ring, the close-up growing with it at its scale', () => {
    expect(withCloseUpRing(closeUp(), 'from', 0.12)).toMatchObject({ radius: 0.12, scale: 2 });
    expect(withCloseUpRing(closeUp(), 'from', 0.001).radius).toBe(MIN_CLOSE_UP_RADIUS);
    expect(withCloseUpRing(closeUp(), 'from', 2).radius).toBe(MAX_CLOSE_UP_RADIUS);
  });

  it('scales it by the close-up’s ring: to a hundredth, Shift to halves, within its range', () => {
    expect(withCloseUpRing(closeUp(), 'to', 0.24)).toMatchObject({ radius: 0.08, scale: 3 });
    expect(withCloseUpRing(closeUp(), 'to', 0.2).scale).toBe(2.5);
    expect(withCloseUpRing(closeUp(), 'to', 0.1897).scale).toBe(2.37);
    expect(withCloseUpRing(closeUp(), 'to', 0.1897, true).scale).toBe(2.5);
    expect(withCloseUpRing(closeUp(), 'to', 0.05).scale).toBe(CLOSE_UP_SCALE.min);
    // Halves start at the first half past the least scale.
    expect(withCloseUpRing(closeUp(), 'to', 0.05, true).scale).toBe(1.5);
    expect(withCloseUpRing(closeUp(), 'to', 1).scale).toBe(CLOSE_UP_SCALE.max);
    expect(closeUpScaleWithin(Number.NaN)).toBe(DEFAULT_CLOSE_UP_SCALE);
    expect(withCloseUpScale(closeUp(), 2.345).scale).toBe(2.35);
  });
});

describe('a close-up as this build writes it (15f)', () => {
  it('is kept exactly, the same object, when it already is — its scale never rounded', () => {
    const odd = closeUp({ radius: 0.0712345, scale: 2.345 });
    expect(cleanAnnotation(odd)).toBe(odd);
    const unsaid = closeUp();
    delete unsaid.scale;
    expect(cleanAnnotation(unsaid)).toBe(unsaid);
  });

  it('holds its area, its scale and its centres to what this build draws', () => {
    expect(cleanAnnotation(closeUp({ radius: 2, scale: 9, to: [6, 0.3] }))).toEqual(
      closeUp({ radius: MAX_CLOSE_UP_RADIUS, scale: CLOSE_UP_SCALE.max, to: [4, 0.3] })
    );
    expect(cleanAnnotation(closeUp({ radius: undefined })).radius).toBe(DEFAULT_CLOSE_UP_RADIUS);
  });
});

describe('moving and carrying a close-up (15f)', () => {
  it('moves whole by its line, and either circle alone', () => {
    expect(moveAnnotation(closeUp(), [0.1, -0.1])).toMatchObject({
      from: [0.6, expect.closeTo(0.2, 12)],
      to: [expect.closeTo(1.31, 12), expect.closeTo(0.2, 12)],
    });
    expect(moveAnnotationEnd(closeUp(), 'to', [1.1, 0.8])).toMatchObject({ from: [0.5, 0.3], to: [1.1, 0.8] });
    expect(moveAnnotationEnd(closeUp(), 'from', [0.4, 0.4])).toMatchObject({ from: [0.4, 0.4], to: [1.21, 0.3] });
  });

  it('goes with its area as a callout’s point does, its close-up kept beside it, turned and mirrored with the picture', () => {
    // Mirrored: the close-up goes over to the other side, its size kept.
    const mirrored = carryAnnotation(closeUp(), mirrorMove({ width: 1, height: 1 }));
    expect(mirrored.from).toEqual([0.5, 0.3]);
    expect(mirrored.to[0]).toBeCloseTo(-0.21, 12);
    expect(mirrored).toMatchObject({ radius: expect.closeTo(0.08, 12), scale: 2 });
    // A quarter turn clockwise: beside it below.
    const turned = carryAnnotation(closeUp(), { point: ([x, y]) => [1 - y, x], mirrors: false, turnDeg: 90 });
    expect(turned.from).toEqual([0.7, 0.5]);
    expect(turned.to[0]).toBeCloseTo(0.7, 12);
    expect(turned.to[1]).toBeCloseTo(1.21, 12);
    // A spread that draws the picture smaller in a larger frame: the area shrinks with the picture, never spread by a face.
    const spread: PictureMove = {
      point: ([x, y]) => [x * 0.5 + 0.25 + (x > 0.5 ? 0.2 : 0), y * 0.5],
      mirrors: false,
      turnDeg: 0,
      vector: ([x, y]) => [x * 0.5, y * 0.5],
    };
    const carried = carryAnnotation(closeUp(), spread);
    expect(carried.from).toEqual([0.5, 0.15]);
    expect(carried.to[0]).toBeCloseTo(0.5 + 0.355, 12);
    expect(carried.radius).toBeCloseTo(0.04, 12);
    expect(carried.scale).toBe(2);
  });
});

describe('pressing a close-up (15f)', () => {
  const SIZES = { tolerance: 0.02, glyph: 0.05, label: 0.05, ink: 0.0066, calloutPen: 0.0025, px: 0.0025 };

  it('takes either circle by its inside, alone, and the whole by its line', () => {
    expect(hitAnnotation([closeUp()], [1.25, 0.35], SIZES, null)).toEqual({ annotationId: 'zoom', part: 'circle', end: 'to' });
    expect(hitAnnotation([closeUp()], [0.52, 0.31], SIZES, null)).toEqual({ annotationId: 'zoom', part: 'circle', end: 'from' });
    expect(hitAnnotation([closeUp()], [0.8, 0.305], SIZES, null)).toEqual({ annotationId: 'zoom', part: 'body' });
    expect(hitAnnotation([closeUp()], [0.8, 0.5], SIZES, null)).toBeNull();
  });

  it('resizes the selected one by either ring, and moves it by its inside', () => {
    expect(hitAnnotation([closeUp()], [1.21, 0.3 + 0.165], SIZES, 'zoom')).toEqual({ annotationId: 'zoom', part: 'ring', end: 'to' });
    expect(hitAnnotation([closeUp()], [0.5, 0.3 - 0.075], SIZES, 'zoom')).toEqual({ annotationId: 'zoom', part: 'ring', end: 'from' });
    expect(hitAnnotation([closeUp()], [1.21, 0.3], SIZES, 'zoom')).toEqual({ annotationId: 'zoom', part: 'circle', end: 'to' });
    // Unselected, its ring is its circle.
    expect(hitAnnotation([closeUp()], [1.21, 0.3 + 0.165], SIZES, null)).toEqual({ annotationId: 'zoom', part: 'circle', end: 'to' });
  });

  it('lies under every other mark, as its inside is painted', () => {
    const across: KnownDiagramAnnotation = { id: 'across', kind: 'mountain-line', from: [1, 0.3], to: [1.4, 0.3] };
    expect(hitAnnotation([across, closeUp()], [1.21, 0.31], SIZES, null)?.annotationId).toBe('across');
  });

  it('is taken by its centres’ dots and its rings once selected, over the marks its area holds', () => {
    // A fold through the middle of its area: unselected, a press there is the fold's.
    expect(hitAnnotation([valley, closeUp()], [0.5, 0.3], SIZES, null)?.annotationId).toBe('crease');
    expect(hitAnnotation([valley, closeUp()], [0.505, 0.3], SIZES, 'zoom')).toEqual({ annotationId: 'zoom', part: 'circle', end: 'from' });
    // Away from its dots, the fold is still the fold's.
    expect(hitAnnotation([valley, closeUp()], [0.54, 0.3], SIZES, 'zoom')?.annotationId).toBe('crease');
    // A ring as small as a press: its ring or its dot, whichever is nearer.
    const small = closeUp({ radius: 0.015 });
    expect(hitAnnotation([small], [0.5, 0.3 - 0.013], SIZES, 'zoom')).toEqual({ annotationId: 'zoom', part: 'ring', end: 'from' });
    expect(hitAnnotation([small], [0.5, 0.3 - 0.004], SIZES, 'zoom')).toEqual({ annotationId: 'zoom', part: 'circle', end: 'from' });
  });
});

describe('a close-up drawn (15f)', () => {
  const frame = { width: 1, height: 0.75 };

  it('is two rings and a line in the annotation pen, and where its inside shows the picture larger', () => {
    const drawing = annotationDrawing([closeUp()], frame, 100, DEFAULT_DIAGRAM_STYLE);
    expect(drawing.primitives).toEqual([]);
    const [drawn] = drawing.closeUps;
    expect(drawn).toMatchObject({ id: 'zoom', area: { x: 50, y: 30, r: 8 }, scale: 2, ground: '#ffffff' });
    expect(drawn!.inset).toEqual({ x: 121, y: 30, r: expect.closeTo(16, 9) });
    expect(drawn!.line!.a).toEqual([expect.closeTo(58, 9), 30]);
    expect(drawn!.line!.b[0]).toBeCloseTo(105, 9);
    expect(drawn!.frame).toEqual({ x: expect.closeTo(21, 9), y: expect.closeTo(-30, 9), width: 200, height: 150 });
    // The annotation pen — a circle's ring's, a callout's line's — in the arrows' ink.
    const callout = annotationDrawing(
      [{ id: 'c', kind: 'callout', from: [0.2, 0.5], to: [0.6, 0.5], text: 'A' }],
      frame,
      100,
      DEFAULT_DIAGRAM_STYLE
    ).callouts[0]!;
    expect(drawn!.pen).toBe(callout.linePen);
    expect(drawn!.ink).toBe(callout.ink);
    const markup = annotationScene(drawing)!.items.find((item) => item.kind === 'markup');
    expect(markup && 'svg' in markup ? markup.svg : '').toContain(`stroke-width="${Number(drawn!.pen.toFixed(3))}"`);
  });

  it('reaches as far as its close-up’s ring and half its pen', () => {
    const drawing = annotationDrawing([closeUp()], frame, 100, DEFAULT_DIAGRAM_STYLE);
    const reach = annotationReach(drawing);
    const { inset, pen } = drawing.closeUps[0]!;
    expect(reach.x + reach.width).toBeCloseTo(inset.x + inset.r + pen / 2, 9);
    expect(reach.y).toBeCloseTo(Math.min(0, inset.y - inset.r - pen / 2), 9);
  });
});

describe('a close-up painted (15f)', () => {
  const box = { x: 10, y: 20, width: 200, height: 150 };
  /** A picture that says where it was asked to paint, its one element named. */
  const picture: CloseUpPicture = (scale, frame, idPrefix) => {
    const [x, y, width, height] = [frame.x, frame.y, frame.width, frame.height].map((value) => Math.round(value * 1000) / 1000);
    return `<line id="${idPrefix}picture" data-scale="${scale}" x1="${x}" y1="${y}" x2="${width}" y2="${height}"/>`;
  };

  it('is its rings only where no picture is painted inside it, as Pose ghosts it', () => {
    const painted = paintAnnotations([closeUp(), valley], box, 100, DEFAULT_DIAGRAM_STYLE)!;
    expect(painted.markup).not.toContain('clipPath');
    expect(painted.markup).not.toContain('fill="#ffffff"');
    expect(painted.markup.match(/<circle/g)).toHaveLength(2);
  });

  it('paints its inside under the marks: white, the picture larger, the other marks with it, clipped to its ring', () => {
    const painted = paintAnnotations([closeUp(), valley], box, 100, DEFAULT_DIAGRAM_STYLE, null, { closeUpPicture: picture })!;
    const { markup } = painted;
    // Two target units per drawing px: the close-up at (252, 80), 32 across its radius.
    expect(markup).toContain('<clipPath id="annotation-close-up-0"><circle cx="252" cy="80" r="32"/></clipPath>');
    expect(markup).toContain('<g clip-path="url(#annotation-close-up-0)"><circle cx="252" cy="80" r="32" fill="#ffffff"/>');
    // The picture asked for at twice, its frame twice the box's about the area's middle.
    expect(markup).toContain('<line id="annotation-close-up-0-picture" data-scale="2" x1="52" y1="-40" x2="400" y2="300"/>');
    // The crease again inside, twice as long, in the same pen; and under the picture's own marks.
    expect(markup).toContain('x1="232.00" y1="80.00" x2="272.00" y2="80.00" stroke="#231f20" stroke-width="2.00"');
    expect(markup).toContain('x1="100.00" y1="80.00" x2="120.00" y2="80.00" stroke="#231f20" stroke-width="2.00"');
    expect(markup.indexOf('annotation-close-up-0-picture')).toBeLessThan(markup.indexOf('x1="100.00"'));
    // Never itself inside itself: its two rings, once.
    expect(markup.match(/<circle[^>]*fill="none"/g)).toHaveLength(2);
    // Its rings reach no further painted inside than out.
    expect(painted.bounds).toEqual(paintAnnotations([closeUp(), valley], box, 100, DEFAULT_DIAGRAM_STYLE)!.bounds);
  });

  it('sets the marks’ text, inside and out, and never the picture’s', () => {
    const setText = (markup: string) => markup.replaceAll('<line', '<line data-set=""');
    const { markup } = paintAnnotations([closeUp(), valley], box, 100, DEFAULT_DIAGRAM_STYLE, null, {
      closeUpPicture: picture,
      setText,
    })!;
    expect(markup).toContain('<line id="annotation-close-up-0-picture"');
    expect(markup.match(/<line data-set=""/g)!.length).toBeGreaterThanOrEqual(2);
  });

  it('nests the picture painted larger in a card, its frame on the close-up’s and its ids its own', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"><rect id="a" width="400" height="300"/></svg>';
    const asset = { id: 'asset-1', kind: 'svg' as const, svg, widthPx: 400, heightPx: 300, bytes: svg.length };
    const source = { kind: 'asset' as const, asset, pose: UPRIGHT };
    const card = annotatedPicture(paintAsset(asset), [closeUp()], DEFAULT_DIAGRAM_STYLE, 1, null, (scale) =>
      paintSource(source, DEFAULT_DIAGRAM_STYLE, undefined, scale)
    );
    // The frame's longer side, 400 px: the close-up's frame from (84, −120), 800 × 600, the asset drawn twice as large.
    expect(card).toContain('<svg x="84" y="-120" width="800" height="600" viewBox="0 0 800 600" overflow="visible">');
    expect(card).toContain('id="annotation-close-up-0-a"');
    expect(card).toContain('<rect id="a"');
    // Ghosted, as Pose shows it: its rings.
    expect(annotatedPicture(paintAsset(asset), [closeUp()], DEFAULT_DIAGRAM_STYLE, 0.35)).not.toContain('clipPath');
    expect(CARD_FRAME_PX).toBeGreaterThan(0);
  });
});
