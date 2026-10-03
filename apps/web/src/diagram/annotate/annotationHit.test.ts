import { describe, expect, it } from 'vitest';
import type { DiagramAnnotation, KnownDiagramAnnotation } from '../document/diagramDocument';
import { arrowApex } from './annotationModel';
import { arrowPolyline, hitAnnotation } from './annotationHit';

const SIZES = { tolerance: 0.02, glyph: 0.05, label: 0.05 };

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
