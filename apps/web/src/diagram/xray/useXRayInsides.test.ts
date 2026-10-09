import { describe, expect, it } from 'vitest';
import { annotationDrawing } from '../annotate/annotationPrimitives';
import { CARD_FRAME_PX } from '../annotate/canvasInk';
import { DEFAULT_DIAGRAM_STYLE, type DiagramStep, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { zoomEdgePen } from '../zoom/paintZoomed';
import { viewOfStep } from '../zoom/stepView';
import { outlineIntoBox } from '../zoom/zoomFrames';
import { craneStep } from '../zoom/zoom.fixtures';
import { xrayInsides } from './useXRayInsides';

/** Zach's crane, step 22 (`zoom.fixtures.ts`), with a window on its body, two layers deep. */
const xray: KnownDiagramAnnotation = { id: 'xray', kind: 'x-ray', from: [0.45, 0.6], to: [0.45, 0.6], radius: 0.08, depth: 2 };

function insides(step: DiagramStep, marks: KnownDiagramAnnotation[] = [xray]) {
  const frame = stepPictureFrame(step, {})!;
  const drawing = annotationDrawing(marks, frame, CARD_FRAME_PX, DEFAULT_DIAGRAM_STYLE);
  return xrayInsides({
    step,
    drawing,
    shown: marks,
    zoom: viewOfStep(step).zoom,
    style: DEFAULT_DIAGRAM_STYLE,
    framePx: CARD_FRAME_PX,
    idPrefix: 'x',
  });
}

/** The step shown as its crease pattern (Show As, D19): its picture kept, its render changed. */
function asPattern(step: DiagramStep): DiagramStep {
  if (step.source?.kind !== 'cp') throw new Error('a linked step');
  return { ...step, source: { ...step.source, render: { mode: 'crease-pattern', rotationDeg: 0 } } };
}

describe('an x-ray’s window on the Annotate canvas (Revision 3, 18e)', () => {
  it('is painted as every surface paints one: its clip, the page’s white over what it takes away, the faces left and its rim, in the drawing’s px', () => {
    const [inside, ...more] = insides(craneStep('S.none'));
    expect(more).toEqual([]);
    expect(inside!.id).toBe('xray');
    expect(inside!.deep).toBe(2);
    expect(inside!.stack).toBeGreaterThan(2);
    expect(inside!.markup).toMatch(/^<defs><clipPath id="x-0-clip"><circle /);
    // The window where the drawing has it: picture units times the frame's px.
    expect(inside!.markup).toContain(`cx="${Number((0.45 * CARD_FRAME_PX).toFixed(3))}"`);
    expect(inside!.markup).toContain('<g data-x-ray-ground="" fill="#ffffff"');
    expect(inside!.markup).toMatch(/<path [^>]*fill=/);
    expect(inside!.markup).toMatch(/stroke-width="[\d.]+"\/>$/);
    // With a spread the same window, in the spread picture's places.
    expect(insides(craneStep('S.affine'))[0]!.deep).toBe(2);
  });

  it('is drawn nowhere on a picture with no layers (R3-18b A), and drawn again once it has them: Show As and back', () => {
    const step = craneStep('S.none');
    expect(insides(asPattern(step))).toEqual([]);
    // Shown back as its flat fold, the window is drawn as it was.
    expect(insides({ ...step, source: step.source })).toEqual(insides(step));
    expect(insides(step)).toHaveLength(1);
    // A flat fold whose faces were never kept: none until they are fetched, or a Refresh keeps them.
    expect(insides(craneStep('S.none', { faces: false }))).toEqual([]);
  });

  it('on an enlarged step, its own picture’s faces in its window’s units, held to its frame', () => {
    const whole = craneStep('S.none');
    const enlarged: DiagramStep = {
      ...whole,
      zoom: { from: 'area', shape: 'circle', frame: { centre: [0.45, 0.6], radius: 0.2 } },
    };
    const window = viewOfStep(enlarged).zoom!.window;
    // The same window on the paper, in the window's units: its centre in the middle, its radius grown.
    const inWindow: KnownDiagramAnnotation = { ...xray, from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.08 / Math.max(window.width, window.height) };
    const [inside] = insides(enlarged, [inWindow]);
    expect(inside!.deep).toBe(insides(whole)[0]!.deep);
    expect(inside!.markup).toContain('<clipPath id="x-0-bound"><polygon ');
    // Held inside the frame's cut by half its pen, so the cut is drawn whole across the window (review of 18e).
    const frame = outlineIntoBox(window, enlarged.zoom!.frame!);
    const half = zoomEdgePen(DEFAULT_DIAGRAM_STYLE, 1).width / 2;
    const points = /<clipPath id="x-0-bound"><polygon points="([^"]+)"/.exec(inside!.markup)![1]!.split(' ').map((pair) => pair.split(',').map(Number));
    for (const [x, y] of points) {
      const away = Math.hypot(x! - frame.centre[0] * CARD_FRAME_PX, y! - frame.centre[1] * CARD_FRAME_PX);
      expect(away).toBeCloseTo(frame.radius! * CARD_FRAME_PX - half, 2);
    }
  });
});
