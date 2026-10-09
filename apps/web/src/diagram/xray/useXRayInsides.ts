import { useMemo } from 'react';
import type { AnnotationDrawing } from '../annotate/annotationPrimitives';
import type { DiagramAnnotation, DiagramStep, DiagramStyle } from '../document/diagramDocument';
import type { StepZoomView } from '../zoom/stepView';
import { xrayMarks, xrayWindowOn, type XRayWindowDrawn } from './xrayPaint';
import { xrayFacesOf } from './xrayScene';

/** An x-ray's window as the Annotate canvas draws it (Revision 3): its markup, in the drawing's px. */
export interface XRayInsideDrawn extends XRayWindowDrawn {
  id: string;
}

/** What a canvas's x-rays' insides are drawn from. */
export interface XRayInsidesInput {
  /** The step: its faces, which a picture with no layers has none of (R3-18b A). */
  step: DiagramStep;
  /** The canvas's drawing, compiled with the frame `framePx` across. */
  drawing: AnnotationDrawing | null;
  /** The annotations as the canvas draws them, a drag's included: each x-ray's depth and anchor. */
  shown: readonly DiagramAnnotation[];
  /** An enlarged step's window (Revision 2): its marks are in its units, and its inside is held to its frame. */
  zoom: StepZoomView | null;
  style: DiagramStyle;
  framePx: number;
  /** What every id the markup declares starts with: one canvas's own. */
  idPrefix: string;
}

/**
 * Each x-ray's window on the Annotate canvas (Revision 3, 18e), as every
 * surface paints one (`xrayWindowOn`): its step's own picture without the
 * layers it takes away, in the drawing's px — the drawing's frame at the
 * origin — under the marks. None on a step whose picture has no layers
 * (R3-18b A): the x-ray is kept, but drawn nowhere until the step has them
 * again. On an enlarged step, its own picture's faces in its window's units,
 * held to its frame inside the frame's cut.
 */
export function xrayInsides({ step, drawing, shown, zoom, style, framePx, idPrefix }: XRayInsidesInput): readonly XRayInsideDrawn[] {
  if (!drawing || drawing.xRays.length === 0) return [];
  const faces = xrayFacesOf(step);
  if (!faces) return [];
  const marks = xrayMarks(shown);
  const place = { box: { x: 0, y: 0, width: drawing.width, height: drawing.height }, framePx };
  return drawing.xRays.flatMap((drawn, index): XRayInsideDrawn[] => {
    const mark = marks.get(drawn.id);
    if (!mark) return [];
    return [{ id: drawn.id, ...xrayWindowOn({ faces, zoom }, drawn, mark, place, style, `${idPrefix}-${index}-`) }];
  });
}

/** {@link xrayInsides}, worked out again only when what it is drawn from changes. */
export function useXRayInsides(input: XRayInsidesInput): readonly XRayInsideDrawn[] {
  const { step, drawing, shown, zoom, style, framePx, idPrefix } = input;
  return useMemo(
    () => xrayInsides({ step, drawing, shown, zoom, style, framePx, idPrefix }),
    [step, drawing, shown, zoom, style, framePx, idPrefix]
  );
}
