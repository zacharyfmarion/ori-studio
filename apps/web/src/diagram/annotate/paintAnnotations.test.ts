import { describe, expect, it } from 'vitest';
import { DEFAULT_DIAGRAM_STYLE, type DiagramAnnotation, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { paintAsset } from '../pictures/paintDiagramStep';
import { annotationDrawing, annotationScene, annotationTextRuns, labelRuns } from './annotationPrimitives';
import { annotatedPicture, CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
const ASSET = { id: 'asset-1', kind: 'svg' as const, svg: SVG, widthPx: 400, heightPx: 300, bytes: SVG.length };
const FRAME = { width: 1, height: 0.75 };

const a = (id: string, kind: KnownDiagramAnnotation['kind'], extra: Partial<KnownDiagramAnnotation> = {}) =>
  ({ id, kind, from: [0.2, 0.3], to: [0.6, 0.3], ...extra }) as KnownDiagramAnnotation;

describe('annotationDrawing', () => {
  it('draws a crease line as a line in its role, and every other mark as a step-diagram shape', () => {
    const drawing = annotationDrawing(
      [
        a('v', 'valley-line'),
        a('m', 'mountain-line'),
        a('h', 'hidden-line'),
        a('arrow', 'valley-arrow', { bend: 0.1 }),
        a('push', 'push-arrow'),
        a('turn', 'turn-over', { to: [0.2, 0.3], axis: 'horizontal' }),
      ],
      FRAME,
      CARD_FRAME_PX,
      DEFAULT_DIAGRAM_STYLE
    );
    expect(drawing.lines.map((line) => line.role)).toEqual(['diagram-valley', 'diagram-mountain', 'diagram-hidden']);
    // Picture units at the frame's size: one unit is its longer side.
    expect(drawing.lines[0]!.a).toEqual([0.2 * CARD_FRAME_PX, 0.3 * CARD_FRAME_PX]);
    expect(drawing.primitives.map((primitive) => primitive.kind)).toEqual(['one-way-arrow', 'push-arrow', 'turn-over']);
    expect(drawing.primitiveIds).toEqual(['arrow', 'push', 'turn']);
    expect(drawing.width).toBeCloseTo(CARD_FRAME_PX, 9);
    expect(drawing.height).toBeCloseTo(0.75 * CARD_FRAME_PX, 9);
  });

  it('draws nothing for one it cannot read, or a label with no words', () => {
    const unknown: DiagramAnnotation = { id: 'n', unknown: { id: 'n', kind: 'spiral' } };
    const drawing = annotationDrawing([unknown, a('l', 'label', { text: '  ' })], FRAME, 100, DEFAULT_DIAGRAM_STYLE);
    expect(annotationScene(drawing)).toBeNull();
  });
});

describe('a label’s runs', () => {
  it('sets each script in its font, Han under the key the diagram’s style replaces', () => {
    expect(labelRuns('A 中文')).toEqual([
      { key: 'latin', text: 'A ' },
      { key: 'sc', text: '中文' },
    ]);
    // Kana makes a text Japanese, its Han too.
    expect(labelRuns('谷折り').map((run) => run.key)).toEqual(['jp']);
    expect(
      annotationTextRuns([a('l', 'label', { text: '中文' }), a('v', 'valley-line')], 'tc')
    ).toEqual([{ face: { key: 'tc', weight: 400 }, text: '中文' }]);
  });
});

describe('annotatedPicture', () => {
  const painted = paintAsset(ASSET);

  it('is the picture itself when nothing draws', () => {
    expect(annotatedPicture(painted, [], DEFAULT_DIAGRAM_STYLE)).toBe(painted.svg);
  });

  it('draws them over the picture, the size it is, ghosted when asked', () => {
    const svg = annotatedPicture(painted, [a('v', 'valley-line')], DEFAULT_DIAGRAM_STYLE, 0.3);
    const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
    expect(document.querySelector('parsererror')).toBeNull();
    const root = document.documentElement;
    expect([root.getAttribute('width'), root.getAttribute('height')]).toEqual(['400', '300']);
    expect(root.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 400 300');
    const ghost = root.querySelector(':scope > g[opacity]');
    expect(ghost?.getAttribute('opacity')).toBe('0.3');
    // The line, on the frame: a 400 px frame's 0.2 is 80 px.
    expect(Number(ghost?.querySelector('line')?.getAttribute('x1'))).toBe(80);
  });
});

describe('paintAnnotations', () => {
  it('reaches past the frame for an arrow that starts off it', () => {
    const box = { x: 10, y: 20, width: 100, height: 75 };
    const painted = paintAnnotations([a('p', 'push-arrow', { from: [-0.5, 0.3] })], box, 100, DEFAULT_DIAGRAM_STYLE)!;
    expect(painted.bounds.x).toBeLessThan(box.x - 40);
    expect(painted.bounds.y).toBeLessThanOrEqual(box.y);
  });

  it('sets the rotate glyph’s fraction in the diagram’s font, as a run a page counts', () => {
    const painted = paintAnnotations(
      [a('r', 'rotate', { rotate: { amount: 'eighth', direction: 'cw' } })],
      { x: 0, y: 0, width: 100, height: 75 },
      100,
      DEFAULT_DIAGRAM_STYLE
    )!;
    expect(painted.markup).toContain(`font-family="'Noto Sans', sans-serif" font-weight="700">1/8</text>`);
    expect(painted.markup).toContain('>1/8</text>');
    expect(painted.markup).not.toContain('Inter');
  });
});
