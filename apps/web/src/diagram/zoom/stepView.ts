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
import { closeUpShape, frameOf, type PictureFrame, type PicturePoint } from '../annotate/annotationModel';
import { pictureGeometry, type PictureCover, type PictureGeometry } from '../annotate/pictureGeometry';
import {
  isKnownAnnotation,
  stepById,
  type DiagramAnnotation,
  type DiagramAsset,
  type DiagramDocument,
  type DiagramStep,
  type DiagramStepZoom,
  type DiagramStyle,
  type DiagramZoomOutline,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { stepPictureFrame } from '../pictures/pictureFrame';
import { intoBox, stepWindow } from './zoomFrames';
import { frameWindow, zoomOutlineOf, type PictureBox } from './zoomModel';

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

/**
 * A step's picture geometry in the units its marks are in — its window's on
 * an enlarged step, else its picture's — what a mark snaps to, opens a right
 * angle on, divides, or lies behind a flap of.
 */
export function markGeometry(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style?: DiagramStyle
): PictureGeometry {
  return viewGeometry(viewOfStep(step), assets, style);
}

/**
 * The marks an enlarged step draws (Revision 2, Edge cases): every one but
 * those lying wholly outside its window grown by a window each way, which are
 * kept — the Layers pane lists them — but neither drawn nor measured: a mark
 * carried in from the whole picture, far off the window, would otherwise
 * shrink the step to make room for it. `window` in picture units; the marks
 * in the window's own. The list itself when it keeps them all.
 */
export function marksInWindow(window: PictureBox, annotations: readonly DiagramAnnotation[]): readonly DiagramAnnotation[] {
  return marksNear(window, annotations, 1);
}

/**
 * The marks an enlarged step is sized by (Zach, 2026-10-07): those touching
 * its window. One lying wholly outside it — a mark Duplicate Step copied in
 * from the whole picture, say — is kept, badged in the Layers pane, and
 * counts neither for the size the page and its file print the step at nor
 * for Annotate's fit; of one reaching out of the window only what lies inside
 * it counts, its reach clipped there by whoever measures it. Which are drawn
 * is {@link marksInWindow}'s. The list itself when every mark touches it.
 */
export function marksTouchingWindow(window: PictureBox, annotations: readonly DiagramAnnotation[]): readonly DiagramAnnotation[] {
  return marksNear(window, annotations, 0);
}

/** The marks within `windows` windows of a window, each way; `window` in picture units, the marks in its own. */
function marksNear(window: PictureBox, annotations: readonly DiagramAnnotation[], windows: number): readonly DiagramAnnotation[] {
  const frame = frameOf(window.width, window.height);
  if (!frame) return annotations;
  const near = (mark: DiagramAnnotation) => {
    if (!isKnownAnnotation(mark)) return true;
    const [minX, minY, maxX, maxY] = markExtent(mark);
    const [across, down] = [windows * frame.width, windows * frame.height];
    return maxX >= -across && minX <= frame.width + across && maxY >= -down && minY <= frame.height + down;
  };
  return annotations.every(near) ? annotations : annotations.filter(near);
}

/**
 * What a mark's points span, its rings' radii round them and an area's
 * outline: near enough to tell one far off a window.
 */
function markExtent(mark: KnownDiagramAnnotation): [number, number, number, number] {
  const points: PicturePoint[] = [mark.from, mark.to];
  if (mark.other) points.push(mark.other);
  for (const node of [...(mark.path ?? []), ...(mark.back ?? [])]) {
    points.push(node.at);
    if (node.in) points.push(node.in);
    if (node.out) points.push(node.out);
  }
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  const take = ([x, y]: PicturePoint, r = 0) => {
    minX = Math.min(minX, x - r);
    minY = Math.min(minY, y - r);
    maxX = Math.max(maxX, x + r);
    maxY = Math.max(maxY, y + r);
  };
  for (const point of points) take(point);
  if (mark.kind === 'close-up') {
    const { area, inset } = closeUpShape(mark);
    take(area.centre, area.radius);
    take(inset.centre, inset.radius);
  } else if (mark.kind === 'zoom') {
    // An area: a circle, or a rounded rectangle about `from` turned by its angle.
    const { x, y, width, height } = frameWindow(zoomOutlineOf(mark));
    take([x, y]);
    take([x + width, y + height]);
  } else if (mark.radius !== undefined) take(mark.from, mark.radius);
  return [minX, minY, maxX, maxY];
}

/** A step as it is drawn: an enlarged step without the marks it keeps but does not draw ({@link marksInWindow}). */
export function stepAsDrawn(step: DiagramStep): DiagramStep {
  const window = stepWindow(step);
  if (!window) return step;
  const annotations = marksInWindow(window, step.annotations);
  return annotations === step.annotations ? step : { ...step, annotations: [...annotations] };
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
