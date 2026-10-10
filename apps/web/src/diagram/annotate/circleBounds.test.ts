import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createAnnotation, carryAnnotation } from './annotationModel';
import { hitAnnotation } from './annotationHit';
import { annotationDrawing, annotationMarks } from './annotationPrimitives';
import { DEFAULT_DIAGRAM_STYLE } from '../document/diagramDocument';

const frame = { width: 1, height: 1 };
const sizes = { tolerance: 0.005, glyph: 0.05, label: 0.05, ink: 0.0066, calloutPen: 0.0025, px: 0.0025 };

describe('circular drawing bounds', () => {
  it.each(['circle', 'close-up', 'zoom', 'x-ray'] as const)('%s uses opposite corners in either direction, including outside the model', (kind) => {
    for (const [start, end] of [[[-0.2, -0.2], [0.4, 0.4]], [[0.4, 0.4], [-0.2, -0.2]]] as const) {
      const drawn = createAnnotation(kind, [...start], [...end], frame);
      expect(drawn.from).toEqual([expect.closeTo(0.1, 12), expect.closeTo(0.1, 12)]);
      expect(drawn.radius).toBeCloseTo(0.3, 12);
    }
    const empty = createAnnotation(kind, [-0.6, -0.6], [-0.4, -0.4], frame);
    expect(empty.from).toEqual([-0.5, -0.5]);
    expect(empty.radius).toBeCloseTo(0.1, 12);
  });

  it.each(['circle', 'close-up', 'zoom', 'x-ray'] as const)('%s also draws from center to radius, including outside the model', (kind) => {
    const drawn = createAnnotation(kind, [-0.2, -0.2], [0.1, 0.2], frame, undefined, undefined, 'center');
    expect(drawn.from).toEqual([-0.2, -0.2]);
    expect(drawn.radius).toBeCloseTo(0.5, 12);
    const clicked = createAnnotation(kind, [0.3, 0.4], [0.3, 0.4], frame, undefined, undefined, 'center');
    const boundsClick = createAnnotation(kind, [0.3, 0.4], [0.3, 0.4], frame);
    expect({ ...clicked, id: '' }).toEqual({ ...boundsClick, id: '' });
  });

  it('uses the larger dragged dimension, like a square-constrained oval', () => {
    const drawn = createAnnotation('circle', [0, 0], [0.4, 0.2], frame);
    expect(drawn.from).toEqual([0.2, 0.2]);
    expect(drawn.radius).toBe(0.2);
  });

  it('draws and hits the actual ring, and scales it with its picture', () => {
    const drawn = createAnnotation('circle', [0.2, 0.2], [0.8, 0.8], frame);
    const svg = renderToStaticMarkup(annotationMarks(annotationDrawing([drawn], frame, 100, DEFAULT_DIAGRAM_STYLE)));
    expect(Number(/<circle[^>]*\sr="([^"]+)"/.exec(svg)?.[1])).toBeCloseTo(30, 9);
    expect(hitAnnotation([drawn], [0.8, 0.5], sizes, null)?.annotationId).toBe(drawn.id);
    expect(hitAnnotation([drawn], [0.52, 0.5], sizes, null)).toBeNull();
    const moved = carryAnnotation(drawn, { point: ([x, y]) => [x * 2, y * 2], vector: ([x, y]) => [x * 2, y * 2], turnDeg: 0, mirrors: false });
    expect(moved.radius).toBeCloseTo(0.6, 12);
  });
});
