import { useMemo } from 'react';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import type { ScenePoint } from '../../lib/paper/paperScene';
import { xrayDepthOf, type PicturePoint } from '../annotate/annotationModel';
import type { AnnotationDrawing } from '../annotate/annotationPrimitives';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import type { StepZoomView } from '../zoom/stepView';
import { fromBox, intoBox, outlineIntoBox } from '../zoom/zoomFrames';
import { zoomOutlineInset, zoomOutlinePoints } from '../zoom/zoomModel';
import { zoomEdgePen } from '../zoom/paintZoomed';
import { xrayFacesOf, xrayInside, xrayWindowMarkup, type XRayFaces } from './xrayScene';

/** An x-ray's window as the Annotate canvas draws it (Revision 3): its markup, in the drawing's px. */
export interface XRayInsideDrawn {
  id: string;
  /** The window's clip, the page's white, the faces left and the rim (`xrayWindowMarkup`). */
  markup: string;
  /** How many layers it takes away at its anchor, and how many there are: what the Layers pane says of it. */
  deep: number;
  stack: number;
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
 * surface paints one (`xrayWindowMarkup`): its step's own picture without the
 * layers it takes away, in the drawing's px, under the marks. None on a step
 * whose picture has no layers (R3-18b A): the x-ray is kept, but drawn nowhere
 * until the step has them again. On an enlarged step, its own picture's faces
 * in its window's units, held to its frame inside the frame's cut.
 */
export function xrayInsides({ step, drawing, shown, zoom, style, framePx, idPrefix }: XRayInsidesInput): readonly XRayInsideDrawn[] {
  if (!drawing || drawing.xRays.length === 0) return [];
  const xray = xrayFacesOf(step);
  if (!xray) return [];
  const marks = new Map<string, KnownDiagramAnnotation>();
  for (const annotation of shown) if (isKnownAnnotation(annotation) && annotation.kind === 'x-ray') marks.set(annotation.id, annotation);
  const window = zoom?.window ?? null;
  const unit = window ? Math.max(window.width, window.height) : 1;
  // A point of the stored scene, in the drawing's px: through picture units, and an enlarged step's window.
  const project = sceneToDrawing(xray, window, framePx);
  const surface = diagramScenePaintStyle(style, false);
  // Held to the frame within its cut, by half the cut's pen: the window's white stops at the cut's inner edge, so the
  // cut is drawn whole across it (review of 18e). Its rim is drawn whole, as on a picture shown whole.
  const cut = zoom ? zoomEdgePen(style, 1).width / 2 / framePx : 0;
  const bound = zoom
    ? zoomOutlinePoints(zoomOutlineInset(outlineIntoBox(zoom.window, zoom.frame), cut)).map(([x, y]): ScenePoint => [x * framePx, y * framePx])
    : null;
  return drawing.xRays.flatMap((drawn, index): XRayInsideDrawn[] => {
    const mark = marks.get(drawn.id);
    if (!mark) return [];
    const inMarks: PicturePoint = [drawn.window.x / framePx, drawn.window.y / framePx];
    const centre = window ? fromBox(window, inMarks) : inMarks;
    const inside = xrayInside(xray, {
      centre,
      radius: (drawn.window.r / framePx) * unit,
      depth: xrayDepthOf(mark),
      anchor: mark.anchor,
    });
    const markup = xrayWindowMarkup(
      inside.scene,
      { window: drawn.window, rim: drawn.rim, bound },
      surface,
      { project, unitsPerPt: PT_TO_CSS_PX },
      `${idPrefix}-${index}-`
    );
    return [{ id: drawn.id, markup, deep: inside.removal.deep, stack: inside.removal.stack.length }];
  });
}

/** The stored scene's px in a drawing `framePx` across its frame — an enlarged step's window's, when it is one. */
function sceneToDrawing(xray: XRayFaces, window: StepZoomView['window'] | null, framePx: number): (point: ScenePoint) => ScenePoint {
  const { minX, minY, maxX, maxY } = xray.frame.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return ([x, y]) => {
    const picture: PicturePoint = [(x - minX) / unit, (y - minY) / unit];
    const [u, v] = window ? intoBox(window, picture) : picture;
    return [u * framePx, v * framePx];
  };
}

/** {@link xrayInsides}, worked out again only when what it is drawn from changes. */
export function useXRayInsides(input: XRayInsidesInput): readonly XRayInsideDrawn[] {
  const { step, drawing, shown, zoom, style, framePx, idPrefix } = input;
  return useMemo(
    () => xrayInsides({ step, drawing, shown, zoom, style, framePx, idPrefix }),
    [step, drawing, shown, zoom, style, framePx, idPrefix]
  );
}
