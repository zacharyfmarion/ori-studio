import { describe, expect, it } from 'vitest';
import {
  createTextAnnotation,
  emptyTextDoc,
  serializedStateToPlainText,
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
