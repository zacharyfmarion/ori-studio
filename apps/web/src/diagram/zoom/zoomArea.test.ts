import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { annotationDrawing, annotationMarks, annotationReach } from '../annotate/annotationPrimitives';
import { CARD_FRAME_PX, paintAnnotations } from '../annotate/paintAnnotations';
import { DEFAULT_DIAGRAM_STYLE, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { frameWindow } from './zoomModel';

const style = DEFAULT_DIAGRAM_STYLE;
const frame = { width: 1, height: 0.75 };
const circle: KnownDiagramAnnotation = { id: 'circle', kind: 'zoom', from: [0.4, 0.3], to: [0.4, 0.3], radius: 0.15 };
const rounded: KnownDiagramAnnotation = {
  id: 'rounded',
  kind: 'zoom',
  from: [0.5, 0.4],
  to: [0.5, 0.4],
  size: [0.4, 0.2],
  angle: 30,
};

describe('an enlarge area, drawn on its step', () => {
  it('is its outline in the annotation pen and the arrows’ ink, as a close-up’s ring is', () => {
    const closeUp: KnownDiagramAnnotation = { id: 'c', kind: 'close-up', from: [0.2, 0.2], to: [0.7, 0.5], radius: 0.1 };
    const drawing = annotationDrawing([circle, closeUp], frame, CARD_FRAME_PX, style);
    const [area] = drawing.zoomAreas;
    expect(area).toMatchObject({ id: 'circle', casing: null, ink: drawing.closeUps[0]!.ink, pen: drawing.closeUps[0]!.pen });
    expect(area!.outline).toEqual({ centre: [0.4 * CARD_FRAME_PX, 0.3 * CARD_FRAME_PX], radius: 0.15 * CARD_FRAME_PX });
  });

  it('cases a rounded rectangle in white, a hairline 0.45 ink past its pen each side, turned with it; a circle on none (Z5)', () => {
    const drawing = annotationDrawing([rounded, circle], frame, CARD_FRAME_PX, style);
    const [area] = drawing.zoomAreas;
    const ink = drawing.context.project.ink;
    expect(area!.casing).toBeCloseTo(area!.pen + 0.9 * ink, 9);
    expect(area!.ground).toBe('#ffffff');
    const svg = renderToStaticMarkup(annotationMarks(drawing));
    // The casing under the outline, both turned; their corners 0.22 of the shorter side.
    const rects = [...svg.matchAll(/<rect [^>]*>/g)].map(([tag]) => tag);
    expect(rects).toHaveLength(2);
    expect(rects[0]).toContain('stroke="#ffffff"');
    expect(rects[1]).toContain(`stroke="${area!.ink}"`);
    for (const rect of rects) {
      expect(rect).toContain(`rx="${Number((0.22 * 0.2 * CARD_FRAME_PX).toFixed(3))}"`);
      expect(rect).toMatch(/transform="rotate\(30 /);
    }
    expect(svg.match(/<circle /g)).toHaveLength(1);
  });

  it('lies over the marks and under the close-ups, callouts and labels', () => {
    const arrow: KnownDiagramAnnotation = { id: 'a', kind: 'push-arrow', from: [0.1, 0.1], to: [0.3, 0.1] };
    const label: KnownDiagramAnnotation = { id: 'l', kind: 'label', from: [0.5, 0.5], to: [0.5, 0.5], text: 'A' };
    const svg = renderToStaticMarkup(annotationMarks(annotationDrawing([label, circle, arrow], frame, CARD_FRAME_PX, style)));
    const [arrowAt, areaAt, labelAt] = [svg.indexOf('<path'), svg.indexOf('<circle'), svg.indexOf('<text')];
    expect(arrowAt).toBeLessThan(areaAt);
    expect(areaAt).toBeLessThan(labelAt);
  });

  it('reaches its outline and half its casing, a turned rectangle by its turned box', () => {
    // Over the frame's top edge: what it reaches past it is the room a page leaves it.
    const high: KnownDiagramAnnotation = { ...rounded, from: [0.5, 0.02], to: [0.5, 0.02] };
    const drawing = annotationDrawing([high], { width: 1, height: 1 }, 100, style);
    const [area] = drawing.zoomAreas;
    const box = frameWindow(area!.outline);
    expect(annotationReach(drawing).y).toBeCloseTo(box.y - area!.casing! / 2, 9);
    // Turned 30°, its corners rounded: less than the sharp rectangle's 18.66 above its centre.
    expect(2 - box.y).toBeGreaterThan(10);
    expect(2 - box.y).toBeLessThan(18.66);
    // A circle past the frame's right side, by its radius and half its pen.
    const far: KnownDiagramAnnotation = { ...circle, from: [0.95, 0.5], to: [0.95, 0.5], radius: 0.2 };
    const out = annotationDrawing([far], { width: 1, height: 1 }, 100, style);
    const reach = annotationReach(out);
    expect(reach.x + reach.width).toBeCloseTo(115 + out.zoomAreas[0]!.pen / 2, 9);
  });

  it('is painted on a card and a page as on the canvas', () => {
    const painted = paintAnnotations([rounded], { x: 0, y: 0, width: 400, height: 300 }, CARD_FRAME_PX, style)!;
    expect(painted.markup).toContain('stroke="#ffffff"');
    expect(painted.markup.match(/<rect /g)).toHaveLength(2);
  });
});
