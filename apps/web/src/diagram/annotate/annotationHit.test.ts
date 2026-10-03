import { describe, expect, it } from 'vitest';
import type { DiagramAnnotation, KnownDiagramAnnotation } from '../document/diagramDocument';
import { arrowApex } from './annotationModel';
import { arrowPolyline, hitAnnotation } from './annotationHit';

/** About the canvas's: an ink is about 0.0066 of the frame. */
const SIZES = { tolerance: 0.02, glyph: 0.05, label: 0.05, ink: 0.0066 };

const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.1, 0.5], to: [0.9, 0.5] };
const arrow: KnownDiagramAnnotation = { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.3], to: [0.6, 0.3], bend: 0.2 };
const sign: KnownDiagramAnnotation = { id: 'sign', kind: 'turn-over', from: [0.8, 0.8], to: [0.8, 0.8] };
const label: KnownDiagramAnnotation = { id: 'label', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'AB' };

describe('hitAnnotation', () => {
  it('takes a line by its length and an arrow by its arc, not its chord', () => {
    expect(hitAnnotation([line], [0.5, 0.51], SIZES, null)).toEqual({ annotationId: 'line', part: 'body' });
    expect(hitAnnotation([line], [0.5, 0.6], SIZES, null)).toBeNull();
    const apex = arrowApex(arrow.from, arrow.to, arrow.bend!);
    expect(hitAnnotation([arrow], apex, SIZES, null)?.annotationId).toBe('arrow');
    // The middle of the chord is a sagitta away from the arc.
    expect(hitAnnotation([arrow], [0.4, 0.3], SIZES, null)).toBeNull();
  });

  it('takes a sign within its reach, and a label within its letters', () => {
    expect(hitAnnotation([sign], [0.84, 0.8], SIZES, null)?.annotationId).toBe('sign');
    expect(hitAnnotation([sign], [0.9, 0.8], SIZES, null)).toBeNull();
    expect(hitAnnotation([label], [0.52, 0.51], SIZES, null)?.annotationId).toBe('label');
  });

  it('takes an end of the selected one before anything else', () => {
    expect(hitAnnotation([line], [0.9, 0.5], SIZES, 'line')).toEqual({ annotationId: 'line', part: 'to' });
    expect(hitAnnotation([line], [0.1, 0.5], SIZES, 'line')).toEqual({ annotationId: 'line', part: 'from' });
    // Unselected, an end is only its body.
    expect(hitAnnotation([line], [0.9, 0.5], SIZES, null)).toEqual({ annotationId: 'line', part: 'body' });
  });

  it('takes the topmost as drawn: a label over a line, whatever their order', () => {
    expect(hitAnnotation([label, line], [0.5, 0.5], SIZES, null)?.annotationId).toBe('label');
    expect(hitAnnotation([line, label], [0.5, 0.5], SIZES, null)?.annotationId).toBe('label');
  });

  it('takes a fold-and-unfold arrow by its return and its head, beside the outgoing arc', () => {
    const fold: KnownDiagramAnnotation = { id: 'fold', kind: 'fold-unfold-arrow', from: [0.2, 0.5], to: [0.7, 0.5], bend: 0.134 };
    // The head ends the return a little beside where the paper started: about 0.07 above it.
    const tight = { ...SIZES, tolerance: 0.005 };
    expect(hitAnnotation([fold], [0.199, 0.432], tight, null)?.annotationId).toBe('fold');
    expect(hitAnnotation([fold], [0.2, 0.36], tight, null)).toBeNull();
  });

  it('takes a hollow push anywhere on or in its outline, not only on its spine', () => {
    const push: KnownDiagramAnnotation = { id: 'push', kind: 'push-arrow', from: [0.2, 0.5], to: [0.6, 0.5] };
    const tight = { ...SIZES, tolerance: 0.005 };
    // The shaft's outline is about 0.021 off its spine, the head's barbs 0.05.
    expect(hitAnnotation([push], [0.4, 0.521], tight, null)?.annotationId).toBe('push');
    expect(hitAnnotation([push], [0.53, 0.545], tight, null)?.annotationId).toBe('push');
    expect(hitAnnotation([push], [0.4, 0.56], tight, null)).toBeNull();
  });

  it('takes a wide label by its ends', () => {
    const wide: KnownDiagramAnnotation = { id: 'wide', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: '谷折りして山折り' };
    const latin: KnownDiagramAnnotation = { ...wide, id: 'latin', text: 'fold here' };
    expect(hitAnnotation([wide], [0.69, 0.5], SIZES, null)?.annotationId).toBe('wide');
    expect(hitAnnotation([latin], [0.69, 0.5], SIZES, null)).toBeNull();
  });

  it('ignores one this build cannot read', () => {
    const unknown: DiagramAnnotation = { id: 'n', unknown: { id: 'n', kind: 'spiral' } };
    expect(hitAnnotation([unknown], [0.5, 0.5], SIZES, 'n')).toBeNull();
  });
});

describe('arrowPolyline', () => {
  it('runs from tail to tip through the apex', () => {
    const points = arrowPolyline(arrow, 8);
    expect(points[0]![0]).toBeCloseTo(0.2, 9);
    expect(points[8]![0]).toBeCloseTo(0.6, 9);
    const apex = arrowApex(arrow.from, arrow.to, arrow.bend!);
    expect(points[4]![0]).toBeCloseTo(apex[0], 9);
    expect(points[4]![1]).toBeCloseTo(apex[1], 9);
  });
});
