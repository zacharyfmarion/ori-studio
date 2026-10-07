import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { canvasDiagramInk, DIAGRAM_LINE_INK } from '../../cp-workspace/references/diagram/diagramInk';
import { REFERENCE_COLORS } from '../../themes/applyTheme';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStyle, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { ANNOTATION_PALETTE, REFERENCE_LINE_COLOR, annotationColorName, isAnnotationColor } from './annotationColors';
import { annotationEventColor, annotationEventKind } from './annotationEventKind';
import { annotationDrawing, annotationInkColor, annotationMarks, calloutPen } from './annotationPrimitives';
import { STEP_DIAGRAM_LINE_WIDTH } from '../pictures/paintStepDiagram';
import { BEHIND_LAYERS } from './behindMarks.cases';
import { annotationClipboard, pastedAnnotations } from './annotationClipboard';
import { hitAnnotation } from './annotationHit';
import { carriesColor, cleanAnnotation, flipAnnotation, flipChangesMark, mirrorMove, carryAnnotation, withColor } from './annotationModel';
import { placePoint } from './annotateSnap';
import { drawnLines } from './pictureSnap';
import { annotation as snapAnnotation, uploadStep } from './pictureSnap.fixtures';
import { lineKindOf } from './lineTypes';
import { CARD_FRAME_PX, paintAnnotations } from './paintAnnotations';

/** Every element of one tag in the markup, as its attributes. */
function elements(markup: string, tag: string): Record<string, string>[] {
  return [...markup.matchAll(new RegExp(`<${tag}[^>]*>`, 'g'))].map((match) =>
    Object.fromEntries([...match[0].matchAll(/([a-zA-Z0-9-]+)="([^"]*)"/g)].map((attr) => [attr[1], attr[2]]))
  );
}

const FRAME = { width: 1, height: 0.75 };
const CARD = { x: 0, y: 0, width: 400, height: 300 };
const line = (more: Partial<KnownDiagramAnnotation> = {}): KnownDiagramAnnotation => ({
  id: 'solid',
  kind: 'solid-line',
  from: [0.1, 0.32],
  to: [0.5, 0.32],
  ...more,
});
/** A style whose arrows are drawn in an ink of their own. */
const BLUE_ARROWS: DiagramStyle = { style: { ...DEFAULT_PAPER_STYLE, arrows: { ...DEFAULT_PAPER_STYLE.arrows, color: '#336699' } } };
const drawn = (annotation: KnownDiagramAnnotation, style: DiagramStyle = DEFAULT_DIAGRAM_STYLE) =>
  elements(renderToStaticMarkup(annotationMarks(annotationDrawing([annotation], FRAME, CARD_FRAME_PX, style))), 'line');

describe('a solid line (17a)', () => {
  it('is References’ own line in its reference pen: the arrow’s weight, with no floor, its ends round', () => {
    const drawing = annotationDrawing([line({ color: '#1971c2' })], FRAME, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
    expect(drawing.lines).toEqual([]);
    expect(drawing.primitives).toEqual([{ kind: 'line', from: [0.1, -0.32], to: [0.5, -0.32], style: 'highlight', ink: '#1971c2' }]);
    const [stroke] = drawn(line({ color: '#1971c2' }));
    // The style's arrow pen at its pt width, as a callout's outline is: thinner
    // than the canvas's floor for a reference line, which it does not take.
    const arrow = calloutPen(DEFAULT_DIAGRAM_STYLE);
    expect(Number(stroke!['stroke-width'])).toBeCloseTo(arrow, 9);
    expect(arrow).toBeLessThan(DIAGRAM_LINE_INK.highlight.width * canvasDiagramInk(STEP_DIAGRAM_LINE_WIDTH));
    expect(stroke).toMatchObject({ stroke: '#1971c2', 'stroke-linecap': 'round', x1: String(0.1 * CARD_FRAME_PX) });
    expect(stroke!['stroke-dasharray']).toBeUndefined();
  });

  it('is in the style’s arrow ink with no colour of its own, so a change of style recolours it', () => {
    expect(drawn(line())[0]!.stroke).toBe(annotationInkColor(DEFAULT_DIAGRAM_STYLE));
    expect(annotationInkColor(BLUE_ARROWS)).toBe('#336699');
    expect(drawn(line(), BLUE_ARROWS)[0]!.stroke).toBe('#336699');
  });

  it('prints a colour of its own as given, in any style', () => {
    for (const style of [DEFAULT_DIAGRAM_STYLE, { preset: 'default' } as const, BLUE_ARROWS]) {
      expect(drawn(line({ color: '#e8590c' }), style)[0]!.stroke).toBe('#e8590c');
    }
  });

  it('is dotted behind a flap in its own pen and colour, and drawn whole on a picture that knows no layers', () => {
    const behind = line({ color: '#2f9e44', behind: { to: 1 } });
    const markup = paintAnnotations([behind], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE, BEHIND_LAYERS)!.markup;
    const pieces = elements(markup, 'line');
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) expect(piece.stroke).toBe('#2f9e44');
    expect(pieces.some((piece) => piece['stroke-dasharray'] !== undefined)).toBe(true);
    expect(pieces.every((piece) => piece['stroke-width'] === pieces[0]!['stroke-width'])).toBe(true);
    const { behind: _behind, ...front } = behind;
    expect(paintAnnotations([behind], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)).toEqual(
      paintAnnotations([front], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)
    );
  });

  it('reaches past the frame by its pen’s half-width round each end', () => {
    // From off the picture's left edge, so its round end sets the reach.
    const off = line({ from: [-0.2, 0.3], to: [0.5, 0.3] });
    const half = calloutPen(DEFAULT_DIAGRAM_STYLE) / 2;
    const { bounds } = paintAnnotations([off], CARD, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE)!;
    // The card's frame is 400 target units to the frame's CARD_FRAME_PX.
    const k = 400 / CARD_FRAME_PX;
    expect(bounds.x).toBeCloseTo((-0.2 * CARD_FRAME_PX - half) * k, 6);
  });
});

describe('its colours (17a, RM2)', () => {
  it('are the style’s ink, References’ magenta and five print colours', () => {
    expect(REFERENCE_LINE_COLOR).toBe(REFERENCE_COLORS.light.input);
    expect(ANNOTATION_PALETTE.map((entry) => entry.name)).toEqual(['reference', 'red', 'orange', 'green', 'blue', 'purple']);
    for (const { color } of ANNOTATION_PALETTE) expect(isAnnotationColor(color)).toBe(true);
  });

  it('are named for the events, never by value', () => {
    expect(annotationColorName(undefined)).toBe('ink');
    expect(annotationColorName('#C91D87')).toBe('reference');
    expect(annotationColorName('#1971c2')).toBe('blue');
    expect(annotationColorName('#123456')).toBe('custom');
    expect(annotationEventKind(line())).toBe('solid_line');
    expect(annotationEventColor(line({ color: '#7048e8' }))).toBe('purple');
    expect(annotationEventColor(line())).toBe('ink');
    // No other mark has a colour to send.
    expect(annotationEventColor({ kind: 'valley-line' })).toBeUndefined();
  });

  it('are stored only as #rrggbb', () => {
    for (const value of ['#c91d87', '#ABCDEF']) expect(isAnnotationColor(value), value).toBe(true);
    for (const value of ['c91d87', '#c91d8', '#c91d877', 'magenta', 'rgb(1, 2, 3)', 3, null]) {
      expect(isAnnotationColor(value), String(value)).toBe(false);
    }
  });
});

describe('a solid line, edited (17a)', () => {
  const blue = line({ color: '#1971c2' });

  it('alone of every kind has a colour, which another kind of line drops', () => {
    expect(carriesColor('solid-line')).toBe(true);
    for (const kind of ['valley-line', 'mountain-line', 'hidden-line', 'label', 'valley-arrow', 'circle'] as const) {
      expect(carriesColor(kind), kind).toBe(false);
    }
    expect(withColor(blue, null)).toEqual(line());
    expect(withColor(line(), '#e03131')).toEqual(line({ color: '#e03131' }));
    // A solid line made a valley line, as the Layers pane's Type makes it.
    const valley = withColor({ ...blue, kind: lineKindOf('valley') }, blue.color ?? null);
    expect(valley).toEqual({ ...line(), kind: 'valley-line' });
    expect(cleanAnnotation({ ...blue, kind: 'valley-line' })).toEqual({ ...line(), kind: 'valley-line' });
    // Kept as it is where it is one; one that is no colour a mark stores is dropped.
    expect(cleanAnnotation(blue)).toBe(blue);
    expect(cleanAnnotation(line({ color: 'magenta' }))).toEqual(line());
  });

  it('keeps its colour through a flip, a turn of its picture and the clipboard', () => {
    const flipped = flipAnnotation(blue, 'vertical');
    expect(flipChangesMark(blue, 'horizontal')).toBe(true);
    expect(flipped.color).toBe('#1971c2');
    expect(carryAnnotation(blue, mirrorMove(FRAME)).color).toBe('#1971c2');
    const [pasted] = pastedAnnotations(annotationClipboard([blue], 'step-1'), 'step-2', () => 'annotation-1');
    expect(pasted).toEqual({ ...blue, id: 'annotation-1' });
  });

  it('is pressed along its length, as every line is', () => {
    const sizes = { tolerance: 0.02, glyph: 0.05, label: 0.05, ink: 0.0066, calloutPen: 0.0025 };
    expect(hitAnnotation([blue], [0.3, 0.33], sizes, null)).toEqual({ annotationId: 'solid', part: 'body' });
    expect(hitAnnotation([blue], [0.3, 0.4], sizes, null)).toBeNull();
    expect(hitAnnotation([blue], [0.5, 0.325], sizes, 'solid')).toEqual({ annotationId: 'solid', part: 'to' });
  });

  it('is pressed where it is drawn: among the marks, in the order they were added, over the pens’ lines', () => {
    const sizes = { tolerance: 0.02, glyph: 0.05, label: 0.05, ink: 0.0066, calloutPen: 0.0025 };
    const push: KnownDiagramAnnotation = { id: 'push', kind: 'push-arrow', from: [0.1, 0.32], to: [0.5, 0.32] };
    // Drawn after the arrow, over it: the press is the line's; drawn before, under it, the arrow's.
    expect(hitAnnotation([push, blue], [0.3, 0.32], sizes, null)?.annotationId).toBe('solid');
    expect(hitAnnotation([blue, push], [0.3, 0.32], sizes, null)?.annotationId).toBe('push');
    // A valley line added after it is still drawn under it, in the diagram's pen.
    const valley: KnownDiagramAnnotation = { id: 'valley', kind: 'valley-line', from: [0.3, 0.1], to: [0.3, 0.6] };
    expect(hitAnnotation([blue, valley], [0.3, 0.32], sizes, null)?.annotationId).toBe('solid');
  });

  it('is snapped to, at its ends and where it crosses another line', () => {
    expect(drawnLines([blue, { ...line(), id: 'v', kind: 'valley-line' }]).map((each) => each.a)).toEqual([
      { x: 0.1, y: 0.32 },
      { x: 0.1, y: 0.32 },
    ]);
    const upload = uploadStep();
    const context = { step: upload.step, assets: upload.assets, enabled: true, radius: 0.02, style: DEFAULT_DIAGRAM_STYLE };
    const solid = snapAnnotation({ kind: 'solid-line', from: [0.2, 0.2], to: [0.6, 0.2], color: '#e03131' });
    expect(placePoint({ ...context, annotations: [solid] }, [0.61, 0.21], { free: false })).toEqual({
      at: [0.6, 0.2],
      target: { at: [0.6, 0.2], kind: 'annotation' },
    });
    const across = snapAnnotation({ kind: 'valley-line', from: [0.4, 0.1], to: [0.4, 0.3] });
    expect(placePoint({ ...context, annotations: [solid, across] }, [0.405, 0.205], { free: false }).at).toEqual([0.4, 0.2]);
  });
});
