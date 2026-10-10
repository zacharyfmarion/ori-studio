/**
 * The marks' inks, worked out once per style (17e): every compile of a
 * step's marks asks for them — a page's layout compiles each step's at every
 * size it measures it at — and the faint crease's alpha among them is a
 * search over the paper's lightness that cost more than the compile itself.
 */
import { describe, expect, it, vi } from 'vitest';
import type { DiagramAnnotation, DiagramStyle } from '../document/diagramDocument';
import { annotationDrawing } from './annotationPrimitives';

const tokens = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../cp-workspace/references/usePaperStyleTokens', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../cp-workspace/references/usePaperStyleTokens')>();
  return {
    ...actual,
    referencesPaperTokens: (...args: Parameters<typeof actual.referencesPaperTokens>) => {
      tokens.count += 1;
      return actual.referencesPaperTokens(...args);
    },
  };
});

const MARKS: DiagramAnnotation[] = [
  { id: 'a', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.6, 0.2], bend: 0.1 },
  { id: 'b', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'P', halo: true },
];
const PAPER = { outline: [[0, 0], [1, 0], [1, 1], [0, 1]] as [number, number][], back: false };

describe('the marks’ inks', () => {
  it('are worked out once for a style, however often its marks are compiled, at whatever size', () => {
    const style: DiagramStyle = { preset: 'diagram' };
    const sizes = [100, 189, 400, 1e6];
    const drawings = sizes.map((framePx) => annotationDrawing(MARKS, { width: 1, height: 1 }, framePx, style, null, PAPER));
    expect(tokens.count).toBe(1);
    // The same inks each time: a halo filled with the sheet's face, the marks in the style's.
    expect(new Set(drawings.map((drawing) => drawing.labels[0]!.halo?.color)).size).toBe(1);
    expect(new Set(drawings.map((drawing) => drawing.context.inline))).toEqual(new Set([drawings[0]!.context.inline]));
  });

  it('follow the style: another style is worked out again', () => {
    const before = tokens.count;
    annotationDrawing(MARKS, { width: 1, height: 1 }, 189, { preset: 'default' }, null, PAPER);
    expect(tokens.count).toBe(before + 1);
  });
});
