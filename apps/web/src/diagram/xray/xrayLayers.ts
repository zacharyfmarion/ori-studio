/**
 * How many steps an x-ray's window peels (Revision 3, 18g): what its Depth
 * stepper counts to and its notice says, worked out as its window draws it
 * (`xrayScene.ts`) — on an enlarged step, its marks in the window's units.
 *
 * Pure but for the faces' memo per picture.
 */
import type { PicturePoint } from '../annotate/annotationModel';
import { facesAt } from '../annotate/behindFlaps';
import type { DiagramAsset, DiagramStep, DiagramStyle, KnownDiagramAnnotation } from '../document/diagramDocument';
import { markGeometry, viewOfStep } from '../zoom/stepView';
import { fromBox } from '../zoom/zoomFrames';
import { xrayFacesOf, xrayPeel, xrayPeelPoint } from './xrayScene';

/** The steps an x-ray's window peels (R3-34 A); null on a step whose picture has no layers to x-ray. */
export function xrayStepsIn(step: DiagramStep, xray: Pick<KnownDiagramAnnotation, 'from' | 'radius' | 'anchor'>): number | null {
  const faces = xrayFacesOf(step);
  if (!faces) return null;
  const { window } = viewOfStep(step);
  const centre = window ? fromBox(window, xray.from) : xray.from;
  const radius = (xray.radius ?? 0) * (window ? Math.max(window.width, window.height) : 1);
  return xrayPeel(faces, { centre, radius }, xrayPeelPoint(faces, centre, xray.anchor)).length;
}

/**
 * The deepest an x-ray's Depth goes where its window has `steps`: all of
 * them, as the bottom layer is never among them — and never under one, which
 * a window with nothing to take away has.
 */
export function xrayDepthMax(steps: number): number {
  return Math.max(1, steps);
}

/**
 * Whether a window centred at `centre` (the marks' units) has the paper under
 * its middle as the step draws it — one laid off the paper is refused (review
 * of 18e). Read on the picture as drawn, which a step whose faces are still
 * to be fetched has too. True where the picture keeps no layers to tell by.
 */
export function xrayCentreOnPaper(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  centre: PicturePoint
): boolean {
  const { layers } = markGeometry(step, assets, style);
  return layers === null || facesAt(layers, centre, true).length > 0;
}
