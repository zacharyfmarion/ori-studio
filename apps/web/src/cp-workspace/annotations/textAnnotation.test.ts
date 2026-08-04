import { describe, expect, it } from 'vitest';
import {
  createTextAnnotation,
  emptyTextDoc,
  serializedStateToPlainText,
  textBoxFromDragCorners,
  textDocFromPlainText,
  validateTextAnnotation,
  validateTextAnnotations,
} from './textAnnotation';

describe('serializedStateToPlainText', () => {
  it('flattens an empty doc to an empty string', () => {
    expect(serializedStateToPlainText(emptyTextDoc())).toBe('');
  });

  it('joins blocks with newlines and concatenates inline runs', () => {
    const doc = textDocFromPlainText('hello\nworld');
    expect(serializedStateToPlainText(doc)).toBe('hello\nworld');
  });

  it('collects nested formatted runs', () => {
    const doc = {
      root: {
        type: 'root',
        children: [
          {
            type: 'paragraph',
            children: [
              { type: 'text', text: 'a', format: 1 },
              { type: 'text', text: 'b', format: 0 },
            ],
          },
          { type: 'heading', tag: 'h1', children: [{ type: 'text', text: 'c' }] },
        ],
      },
    } as never;
    expect(serializedStateToPlainText(doc)).toBe('ab\nc');
  });
});

describe('textDocFromPlainText round-trip', () => {
  it('inflates then flattens back to the same text', () => {
    for (const text of ['', 'one line', 'two\nlines', 'trailing\n']) {
      expect(serializedStateToPlainText(textDocFromPlainText(text))).toBe(text);
    }
  });
});

describe('textBoxFromDragCorners', () => {
  /** The corners `viewAlignedBoxCorners` produces for an unrotated view. */
  const corners = (ax: number, ay: number, bx: number, by: number) =>
    [
      { x: ax, y: ay },
      { x: ax, y: by },
      { x: bx, y: by },
      { x: bx, y: ay },
    ] as const;

  it('returns the centered box for a real drag', () => {
    expect(textBoxFromDragCorners(corners(1, 2, 5, 8), 0.5, 0)).toEqual({
      center: { x: 3, y: 5 },
      width: 4,
      height: 6,
      rotation: 0,
    });
  });

  it('normalizes direction (drag up-left)', () => {
    const box = textBoxFromDragCorners(corners(5, 8, 1, 2), 0.5, 0);
    expect(box?.center).toEqual({ x: 3, y: 5 });
    expect(box?.width).toBeCloseTo(4);
    expect(box?.height).toBeCloseTo(6);
  });

  it('returns null when the drag is below the minimum on both axes', () => {
    expect(textBoxFromDragCorners(corners(0, 0, 0.2, 0.2), 0.5, 0)).toBeNull();
  });

  it('clamps a thin drag up to the minimum on the small axis', () => {
    const box = textBoxFromDragCorners(corners(0, 0, 4, 0.1), 0.5, 0);
    expect(box?.width).toBeCloseTo(4);
    expect(box?.height).toBeCloseTo(0.5);
  });

  it('takes the marquee\u2019s extent and the view\u2019s orientation', () => {
    // A box dragged on a canvas turned 45 degrees: the corners arrive rotated,
    // so the extents come off them, while the angle is the view's upright one.
    const c = Math.SQRT1_2;
    const turned = [
      { x: 0, y: 0 },
      { x: -2 * c, y: 2 * c },
      { x: 4 * c - 2 * c, y: 4 * c + 2 * c },
      { x: 4 * c, y: 4 * c },
    ] as const;
    const box = textBoxFromDragCorners(turned, 0.1, Math.PI / 4);
    expect(box?.rotation).toBeCloseTo(Math.PI / 4);
    expect(box?.width).toBeCloseTo(4);
    expect(box?.height).toBeCloseTo(2);
    // Centre is the diagonal's midpoint, so it holds at any rotation.
    expect(box?.center.x).toBeCloseTo(c);
    expect(box?.center.y).toBeCloseTo(3 * c);
  });

  it('does not flip a box dragged up-and-left', () => {
    // The corners run press-to-cursor, so their edge directions reverse with the
    // drag. Reading the angle off them would render this box upside down.
    expect(textBoxFromDragCorners(corners(5, 8, 1, 2), 0.5, 0)?.rotation).toBe(0);
  });

  it('keeps the extent of a straight drag, which has one zero side', () => {
    const box = textBoxFromDragCorners(corners(3, 1, 3, 9), 0.5, 0);
    expect(box?.rotation).toBe(0);
    expect(box?.height).toBeCloseTo(8);
    expect(box?.width).toBeCloseTo(0.5);
  });
});

describe('createTextAnnotation', () => {
  it('produces a text-kind annotation with a synced plain-text cache', () => {
    const box = createTextAnnotation({ center: { x: 1, y: 2 }, doc: textDocFromPlainText('hi') });
    expect(box.kind).toBe('text');
    expect(box.center).toEqual({ x: 1, y: 2 });
    expect(box.plainText).toBe('hi');
    expect(box.id).toMatch(/^text-/);
    expect(box.width).toBeGreaterThan(0);
  });
});

describe('validateTextAnnotation', () => {
  it('accepts a well-formed box and normalizes fields', () => {
    const raw = {
      kind: 'text',
      id: 'text-1',
      center: { x: 0, y: 0 },
      width: 0.5,
      height: 0.1,
      rotation: 0,
      z: 3,
      opacity: 2, // clamped
      locked: false,
      hidden: false,
      doc: textDocFromPlainText('x'),
      plainText: 'x',
      fontSize: 0.04,
      autoHeight: true,
    };
    const box = validateTextAnnotation(raw);
    expect(box?.opacity).toBe(1);
    expect(box?.z).toBe(3);
  });

  it('rejects entries missing a doc or the text kind', () => {
    expect(validateTextAnnotation({ kind: 'image' })).toBeNull();
    expect(validateTextAnnotation({ kind: 'text', center: { x: 0, y: 0 }, width: 1, height: 1 })).toBeNull();
    expect(validateTextAnnotations('nope')).toEqual([]);
  });
});
