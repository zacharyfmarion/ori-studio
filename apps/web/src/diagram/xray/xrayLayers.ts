/**
 * How many layers an x-ray's anchor has under it (Revision 3): what its Depth
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
import { xrayAnchorPoint, xrayFacesOf, xrayStackAt } from './xrayScene';

/** The layers at an x-ray's anchor, the top first; null on a step whose picture has no layers to x-ray. */
export function xrayLayersUnder(step: DiagramStep, xray: Pick<KnownDiagramAnnotation, 'from' | 'anchor'>): number | null {
  const faces = xrayFacesOf(step);
  if (!faces) return null;
  const { window } = viewOfStep(step);
  const centre = window ? fromBox(window, xray.from) : xray.from;
  const at = xrayAnchorPoint(faces, centre, xray.anchor);
  return at ? xrayStackAt(faces, at).length : 0;
}

/**
 * The deepest an x-ray's Depth goes where its anchor has `layers` under it:
 * one fewer, as the bottom layer is never taken away — and never under one,
 * which off the paper takes nothing away.
 */
export function xrayDepthMax(layers: number): number {
  return Math.max(1, layers - 1);
}

/**
 * Whether a window centred at `centre` (the marks' units) has the paper under
 * its middle as the step draws it — off the paper it would take nothing away,
 * so none is laid there (review of 18e). Read on the picture as drawn, which a
 * step whose faces are still to be fetched has too. True where the picture
 * keeps no layers to tell by.
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
