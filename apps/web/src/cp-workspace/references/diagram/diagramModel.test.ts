import { describe, expect, it } from 'vitest';
import type { StepDiagramPrimitive } from '../referenceFinderDiagramToPrimitives';
import { flipDirection, seenFromTheBack } from './diagramModel';

/**
 * A mountain seen from the front is a valley seen from the back.
 *
 * The pattern states its assignment from the front, so a picture of the back
 * has to say the other thing — at exactly the moment the folder has turned the
 * paper over and cannot check for themselves.
 */
describe('the paper’s other side', () => {
  it('swaps a crease’s direction and nothing else', () => {
    expect(flipDirection('mountain')).toBe('valley');
    expect(flipDirection('valley')).toBe('mountain');
    expect(flipDirection('unassigned')).toBe('unassigned');
  });

  it('renames the creases in a picture, and leaves the picture alone', () => {
    const primitives: StepDiagramPrimitive[] = [
      { kind: 'line', from: [0, 0], to: [1, 0], style: 'mountain', dashPhase: 0.4 },
      { kind: 'line', from: [0, 1], to: [1, 1], style: 'valley' },
      { kind: 'line', from: [0, 2], to: [1, 2], style: 'pinch-mountain' },
      { kind: 'line', from: [0, 3], to: [1, 3], style: 'pinch-valley' },
      // Not directions: context, a reference, the paper's own edge.
      { kind: 'line', from: [0, 4], to: [1, 4], style: 'crease' },
      { kind: 'line', from: [0, 5], to: [1, 5], style: 'highlight' },
      { kind: 'point', at: [0.5, 0.5], style: 'highlight' },
    ];
    const back = seenFromTheBack(primitives);
    expect(back.map((p) => (p.kind === 'line' ? p.style : p.kind))).toEqual([
      'valley',
      'mountain',
      'pinch-valley',
      'pinch-mountain',
      'crease',
      'highlight',
      'point',
    ]);
    // Where every line is, and which references the step names, are properties
    // of the paper rather than of the side you are standing on.
    for (const [i, primitive] of back.entries()) {
      const front = primitives[i];
      if (primitive.kind !== 'line' || front.kind !== 'line') continue;
      expect(primitive.from).toEqual(front.from);
      expect(primitive.to).toEqual(front.to);
      expect(primitive.dashPhase).toBe(front.dashPhase);
    }
  });

  it('is its own inverse', () => {
    const primitives: StepDiagramPrimitive[] = [
      { kind: 'line', from: [0, 0], to: [1, 0], style: 'mountain' },
      { kind: 'line', from: [0, 1], to: [1, 1], style: 'pinch-valley' },
    ];
    expect(seenFromTheBack(seenFromTheBack(primitives))).toEqual(primitives);
  });
});
