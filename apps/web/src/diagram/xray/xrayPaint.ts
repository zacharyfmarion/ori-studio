/**
 * An x-ray's window on every surface (Revision 3, 18f): the canvas, a step
 * card, an enlarged step's card, the pages — the Pages view, print, the PDF,
 * the one-sheet SVG — and a ZIP's step files, and Pose's ghosts. Each places
 * the step's marks on its picture's frame in its own units (`DrawingPlace`),
 * and every one of them paints a window through {@link xrayWindowOn}, with
 * the one drawing `xrayWindowMarkup` makes: so a window prints as the canvas
 * shows it.
 *
 * - Only a step whose picture has layers draws one ({@link xraySurfaceOf}):
 *   on any other the x-ray is kept, but drawn nowhere, rim included (R3-18b
 *   A), and no surface's reach grows for it.
 * - On an enlarged step, its own picture's faces in its window's units, held
 *   to its frame inside the frame's cut, so the cut is drawn whole across it.
 * - Pose draws the rim alone (R3-19 A): its inside is the stored picture's,
 *   which a live pose is not.
 * - A close-up over a window shows the picture plain (R3-20 B): no surface
 *   hands its close-ups' insides a painter.
 *
 * Pure: no DOM, no store.
 */
import type { ScenePoint } from '../../lib/paper/paperScene';
import { PT_TO_CSS_PX } from '../../lib/paper/paperStyle';
import { xrayDepthOf, type PicturePoint } from '../annotate/annotationModel';
import type { AnnotationXRay } from '../annotate/annotationPrimitives';
import type { DrawingPlace, XRayPainter } from '../annotate/paintAnnotations';
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { diagramScenePaintStyle } from '../pictures/diagramPaperStyle';
import { zoomEdgePen } from '../zoom/paintZoomed';
import { viewOfStep, type StepZoomView } from '../zoom/stepView';
import { fromBox, intoBox, outlineIntoBox } from '../zoom/zoomFrames';
import { zoomOutlineInset, zoomOutlinePoints } from '../zoom/zoomModel';
import { xrayFacesOf, xrayInside, xrayRimMarkup, xrayWindowMarkup, type XRayFaces } from './xrayScene';

/** How a surface draws a window: its inside and rim, or its rim alone (Pose, R3-19 A). */
export type XRayLook = 'window' | 'rim';

/** A step's x-rays as its surfaces draw them: its faces, the window it shows, and how. */
export interface XRaySurface {
  faces: XRayFaces;
  /** An enlarged step's view: its marks are in its window's units, and each inside is held to its frame. */
  zoom: StepZoomView | null;
  look: XRayLook;
}

/**
 * A step's x-rays as its surfaces draw them, `look` — or null on a picture
 * with no layers to x-ray (`xrayFacesOf`), where none is drawn (R3-18b A).
 */
export function xraySurfaceOf(step: DiagramStep, look: XRayLook = 'window'): XRaySurface | null {
  const faces = xrayFacesOf(step);
  return faces ? { faces, zoom: viewOfStep(step).zoom, look } : null;
}

/** One x-ray's window as a surface paints it, and what the Layers pane says of it. */
export interface XRayWindowDrawn {
  /**
   * The window's clip, the page's white over the paper it takes away, the
   * faces left and the rim (`xrayWindowMarkup`), in the surface's units.
   */
  markup: string;
  /** How many layers it takes away at its anchor, and how many there are. */
  deep: number;
  stack: number;
}

/**
 * One x-ray's window — `drawn`, as the step's drawing compiled it — on a
 * surface whose drawing lands on `place`: its step's picture without the
 * layers `mark` takes away, in the surface's units, its faces' pens and its
 * rim at their print weight there. Every id it declares starts with
 * `idPrefix`.
 */
export function xrayWindowOn(
  surface: Pick<XRaySurface, 'faces' | 'zoom'>,
  drawn: AnnotationXRay,
  mark: KnownDiagramAnnotation,
  place: DrawingPlace,
  style: DiagramStyle,
  idPrefix: string
): XRayWindowDrawn {
  const { faces, zoom } = surface;
  const { box, framePx } = place;
  // The frame's longer side in the surface's units, and its units per drawing px.
  const longer = Math.max(box.width, box.height);
  const k = longer / framePx;
  const window = zoom?.window ?? null;
  const unit = window ? Math.max(window.width, window.height) : 1;
  const inMarks: PicturePoint = [drawn.window.x / framePx, drawn.window.y / framePx];
  const inside = xrayInside(faces, {
    centre: window ? fromBox(window, inMarks) : inMarks,
    radius: (drawn.window.r / framePx) * unit,
    depth: xrayDepthOf(mark),
    anchor: mark.anchor,
  });
  // On an enlarged step, held to its frame within its cut, by half the cut's pen: the window's white stops at the
  // cut's inner edge, so the cut is drawn whole across it (review of 18e). Its rim is drawn whole.
  const cut = zoom ? zoomEdgePen(style, 1).width / 2 / framePx : 0;
  const bound = zoom
    ? zoomOutlinePoints(zoomOutlineInset(outlineIntoBox(zoom.window, zoom.frame), cut)).map(
        ([x, y]): ScenePoint => [box.x + x * longer, box.y + y * longer]
      )
    : null;
  const markup = xrayWindowMarkup(
    inside,
    { window: placedWindow(drawn, box, k), rim: placedRim(drawn, k), bound },
    diagramScenePaintStyle(style, false),
    { project: sceneOnSurface(faces, window, box, longer), unitsPerPt: PT_TO_CSS_PX * k },
    idPrefix
  );
  return { markup, deep: inside.removal.deep, stack: inside.removal.stack.length };
}

/** A window's centre and radius on a surface, `k` of its units to a drawing px. */
function placedWindow({ window }: AnnotationXRay, box: DrawingPlace['box'], k: number) {
  return { x: box.x + window.x * k, y: box.y + window.y * k, r: window.r * k };
}

/** A window's rim on a surface, `k` of its units to a drawing px: its print weight there. */
function placedRim({ rim }: AnnotationXRay, k: number) {
  return { width: rim.width * k, color: rim.color };
}

/**
 * A point of the stored scene on a surface: into picture units, into an
 * enlarged step's window's, and onto the frame, `longer` of the surface's
 * units across its longer side.
 */
function sceneOnSurface(
  faces: XRayFaces,
  window: StepZoomView['window'] | null,
  box: DrawingPlace['box'],
  longer: number
): (point: ScenePoint) => ScenePoint {
  const { minX, minY, maxX, maxY } = faces.frame.bounds;
  const unit = Math.max(maxX - minX, maxY - minY);
  return ([x, y]) => {
    const picture: PicturePoint = [(x - minX) / unit, (y - minY) / unit];
    const [u, v] = window ? intoBox(window, picture) : picture;
    return [box.x + u * longer, box.y + v * longer];
  };
}

/** The x-rays among `annotations`, by id: each window's depth and anchor. */
export function xrayMarks(annotations: readonly DiagramAnnotation[]): Map<string, KnownDiagramAnnotation> {
  const marks = new Map<string, KnownDiagramAnnotation>();
  for (const annotation of annotations) {
    if (isKnownAnnotation(annotation) && annotation.kind === 'x-ray') marks.set(annotation.id, annotation);
  }
  return marks;
}

/**
 * The painter a surface hands `paintAnnotations` for a step's x-rays
 * (`XRayPainter`): each window `surface.look` — its inside and rim, or its
 * rim alone — each in a group of its own, under the marks.
 */
export function xrayPainter(surface: XRaySurface, style: DiagramStyle): XRayPainter {
  return (drawing, annotations, place, idPrefix) => {
    if (drawing.xRays.length === 0) return '';
    const k = Math.max(place.box.width, place.box.height) / place.framePx;
    const marks = surface.look === 'window' ? xrayMarks(annotations) : null;
    return drawing.xRays
      .map((drawn, index) => {
        if (!marks) return `<g data-x-ray-window="">${xrayRimMarkup(placedWindow(drawn, place.box, k), placedRim(drawn, k))}</g>`;
        const mark = marks.get(drawn.id);
        if (!mark) return '';
        return `<g data-x-ray-window="">${xrayWindowOn(surface, drawn, mark, place, style, `${idPrefix}${index}-`).markup}</g>`;
      })
      .join('');
  };
}
