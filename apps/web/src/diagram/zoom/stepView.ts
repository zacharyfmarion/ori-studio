/**
 * What a step shows (Revision 2): its whole picture, or — enlarged — the
 * window of it its frame takes in. The one entry point every surface that
 * paints or annotates a step reads (cards, the canvas, Pose, the pages, step
 * files, Export Picture), so none of them can draw an enlarged step whole.
 *
 * An enlarged step's marks are in its window's units, the window's longer
 * side one unit, as a picture's frame is: so the window is the frame its
 * marks are drawn on, and every frame-relative size — a label's letters, the
 * shortest arrow, a paste's offset — stays right with no view scale.
 *
 * Pure: no store, no DOM; a memo per picture geometry.
 */
import { LineHitIndex, type IndexedSegment } from '../../cp-workspace/picking/lineHitIndex';
import { frameOf, type PictureFrame, type PicturePoint } from '../annotate/annotationModel';
import { pictureGeometry, type PictureCover, type PictureGeometry } from '../annotate/pictureGeometry';
import {
  stepById,
  type DiagramAsset,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramStyle,
  type DiagramZoomOutline,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { intoBox, stepWindow } from './zoomFrames';
import type { PictureBox } from './zoomModel';

/** An enlarged step's frame as it is shown: the frame, and its window. */
export interface StepZoomView {
  zoom: DiagramStepZoom;
  frame: DiagramZoomOutline;
  /** The frame's upright box, in the step's picture units. */
  window: PictureBox;
}

/** What a step shows: its window when it is enlarged and has a frame, else its whole picture. */
export interface StepView {
  step: DiagramStep;
  window: PictureBox | null;
  zoom: StepZoomView | null;
}

/** What a step shows ({@link StepView}). */
export function viewOfStep(step: DiagramStep): StepView {
  const window = stepWindow(step);
  const frame = step.zoom?.frame;
  return {
    step,
    window,
    zoom: window && frame && step.zoom ? { zoom: step.zoom, frame, window } : null,
  };
}

/** What the step with this id shows; null for a turn or an id not in the diagram. */
export function stepView(document: DiagramDocument, stepId: string): StepView | null {
  const step = stepById(document, stepId);
  return step ? viewOfStep(step) : null;
}

/**
 * The frame a view's marks are measured in, its longer side one unit: an
 * enlarged step's window, else the picture's own frame. Null for a step with
 * no picture to draw.
 */
export function viewFrame(view: StepView, assets: Readonly<Record<string, DiagramAsset>>): PictureFrame | null {
  if (view.window) return frameOf(view.window.width, view.window.height);
  return stepPictureFrame(view.step, assets);
}

/** How far past an enlarged step's window its picture is read for snapping, in window lengths. */
export const VIEW_GEOMETRY_MARGIN = 0.1;

/**
 * The last window each picture geometry was read through: one, since a step
 * shows one window at a time, and a frame dragged or resized gives a new one
 * at every move — kept them all, a long drag would hold hundreds of copies of
 * the picture's index alive as long as the picture.
 */
const windowed = new WeakMap<PictureGeometry, { key: string; geometry: PictureGeometry }>();

/**
 * A view's picture geometry — what marks snap to and what lies behind a flap
 * — in its window's units, and only what lies within the window grown by
 * `margin` window lengths: an enlarged step is never searched across its whole
 * model. A step that is not enlarged has its picture's own.
 */
export function viewGeometry(
  view: StepView,
  assets: Readonly<Record<string, DiagramAsset>>,
  style?: DiagramStyle,
  margin: number = VIEW_GEOMETRY_MARGIN
): PictureGeometry {
  const geometry = pictureGeometry(view.step, assets, style);
  if (!view.window) return geometry;
  const key = JSON.stringify([view.window, margin]);
  const known = windowed.get(geometry);
  if (known?.key === key) return known.geometry;
  const made = inWindow(geometry, view.window, margin);
  windowed.set(geometry, { key, geometry: made });
  return made;
}

/** A geometry mapped into a window's units, kept to the window grown by `margin` of its units. */
function inWindow(geometry: PictureGeometry, window: PictureBox, margin: number): PictureGeometry {
  const unit = Math.max(window.width, window.height);
  const [w, h] = [window.width / unit, window.height / unit];
  const into = (point: PicturePoint) => intoBox(window, point);
  const near = ([x, y]: PicturePoint) => x >= -margin && x <= w + margin && y >= -margin && y <= h + margin;
  const boxNear = (minX: number, minY: number, maxX: number, maxY: number) =>
    maxX >= -margin && minX <= w + margin && maxY >= -margin && minY <= h + margin;

  const points = geometry.points
    .map((vertex) => ({ ...vertex, at: into(vertex.at) }))
    .filter((vertex) => near(vertex.at));
  const segments: IndexedSegment[] = [];
  const orders: number[] = [];
  geometry.segments.forEach((segment) => {
    const [a, b] = [into([segment.a.x, segment.a.y]), into([segment.b.x, segment.b.y])];
    if (!boxNear(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]))) return;
    orders.push(geometry.layers?.orders[segment.id] ?? 0);
    segments.push({
      id: segments.length,
      a: { x: a[0], y: a[1] },
      b: { x: b[0], y: b[1] },
    });
  });
  const covers: PictureCover[] = [];
  for (const cover of geometry.layers?.covers ?? []) {
    const [minX, minY] = into([cover.box[0], cover.box[1]]);
    const [maxX, maxY] = into([cover.box[2], cover.box[3]]);
    if (!boxNear(minX, minY, maxX, maxY)) continue;
    covers.push({
      ring: cover.ring.map(into),
      order: cover.order,
      box: [minX, minY, maxX, maxY],
    });
  }
  return {
    kind: geometry.kind,
    trueAngles: geometry.trueAngles,
    crossings: geometry.crossings,
    points,
    segments,
    pointIndex: new LineHitIndex(points.map(({ at: [x, y] }, id) => ({ id, a: { x, y }, b: { x, y } }))),
    segmentIndex: new LineHitIndex(segments),
    layers: geometry.layers ? { orders, covers } : null,
  };
}
