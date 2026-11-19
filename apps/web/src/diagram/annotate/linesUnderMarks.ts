/**
 * Which of a step's marks hide the lines of its picture they are drawn along
 * (`implementation-plans/diagram-annotate-lines-under-marks.md`): every
 * straight line mark that is drawn — a valley, mountain, hidden, solid or
 * uncreased line — that lies along a line the picture draws, an edge as much
 * as a crease. A line snapped to the picture's points lies exactly on the
 * line it was drawn along; one drawn by hand a hair off never does, so no
 * "was snap on" needs keeping.
 *
 * Nothing is stored: the marks say it each time a picture is painted
 * (`pictures/sceneUnderMarks.ts` leaves the lines out), so a mark moved off a
 * crease, deleted or undone gives the crease back with nothing more to undo,
 * and a file saved before this reads the same way.
 *
 * Pure: no DOM, no store; the lines a picture offers are read once per
 * picture object.
 */
import {
  isKnownAnnotation,
  type DiagramAnnotation,
  type DiagramAnnotationKind,
  type DiagramAsset,
  type DiagramScenePicture,
  type DiagramStep,
  type DiagramStepDiagramPicture,
  type DiagramStyle,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { diagramScenePaintStyle, diagramStyleKey, diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import { stepPictureSource } from '../pictures/paintDiagramStep';
import { stepDiagramScene, stepDiagramSheetBox } from '../pictures/paintStepDiagram';
import { storedScene } from '../pictures/pictureFrame';
import { hideableSceneLines, type CoveringMarks, type MarkPoint } from '../pictures/sceneUnderMarks';
import { stepAsDrawn, viewOfStep } from '../zoom/stepView';
import { fromBox } from '../zoom/zoomFrames';
import { ptInPictureUnits } from './canvasInk';
import { PICTURE_POINT_EPSILON } from './pictureGeometry';

/** The marks drawn as a straight line from `from` to `to`, which hide what they lie along. */
const LINE_MARKS: ReadonlySet<DiagramAnnotationKind> = new Set<DiagramAnnotationKind>([
  'valley-line',
  'mountain-line',
  'hidden-line',
  'solid-line',
  'uncreased-line',
]);

/**
 * How near a line of the picture lies to a mark to be under it, as a share
 * of the frame the mark is drawn on: near enough that less than half the
 * mark's width shows between the two inks, so the line reads as one with it
 * and through its gaps — a fold line mark's width and half an edge's, 0.0071
 * in the Diagram style's pens (0.35 mm on a 50 mm card). A flat fold draws a
 * line once per layer and spreads the layers apart by less: the example
 * crane's step 7 draws its precrease's second copy 0.0003 off the first, and
 * step 13 its flap's edges fanning out to 0.0066 off the edge its valley line
 * is snapped to. Read once per style object, which a diagram replaces rather
 * than edits.
 */
function markReach(style: DiagramStyle): number {
  let reach = reachByStyle.get(style);
  if (reach === undefined) {
    const { valleyDiagramCreases, mountainDiagramCreases, edges } = diagramSurfaceStyle(style);
    reach = ptInPictureUnits(Math.max(valleyDiagramCreases.width, mountainDiagramCreases.width) + edges.width / 2);
    reachByStyle.set(style, reach);
  }
  return reach;
}

const reachByStyle = new WeakMap<DiagramStyle, number>();

/** A line of a picture a mark can hide, in picture units, and its box. */
interface HideableLine {
  a: MarkPoint;
  b: MarkPoint;
  length: number;
  box: readonly [number, number, number, number];
}

/**
 * Whether a mark hides the picture's lines it lies along: a line mark this
 * build draws. An arrow, equal divisions and every other mark do not, nor
 * one set hidden.
 */
export function hidesLinesUnder(annotation: DiagramAnnotation): annotation is KnownDiagramAnnotation {
  return isKnownAnnotation(annotation) && annotation.hidden === undefined && LINE_MARKS.has(annotation.kind);
}

/**
 * The step's line marks that lie along a line of its picture they can hide,
 * their ends in picture units — an enlarged step's marks are in its
 * window's, and are put back in its picture's — or null where none does,
 * which is most steps: a step with no line marks reads nothing at all. An
 * upload or a fixed picture has no lines to read, so nothing on it is ever
 * hidden.
 */
export function linesUnderMarks(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle
): CoveringMarks | null {
  // Those it draws: an enlarged step keeps marks far off its window, and shows none of them.
  const marks = stepAsDrawn(step).annotations.filter(hidesLinesUnder);
  if (marks.length === 0) return null;
  const hideable = hideableLines(step, assets, style);
  if (hideable.length === 0) return null;
  const { toPicture, tolerance } = markFrame(step, style);
  const lines = marks
    .map((mark): readonly [MarkPoint, MarkPoint] => [toPicture(mark.from), toPicture(mark.to)])
    .filter(([from, to]) => lineCoverOf(from, to, hideable, tolerance) !== 'none');
  if (lines.length === 0) return null;
  return { lines, tolerance, key: `${tolerance}|${coveringKey(lines, PICTURE_POINT_EPSILON)}` };
}

/** How much of a picture's lines a mark lies along: all of each, a stretch of one, or none of any. */
export type LineCover = 'whole' | 'part' | 'none';

/**
 * How much of the step's picture's lines a line mark on it hides, as it is
 * put down: whole lines, a stretch of one — the mark ends partway along a
 * line, which goes on past it — or nothing; `none` too for a mark that hides
 * nothing it lies along (`hidesLinesUnder`).
 */
export function markLineCover(
  mark: KnownDiagramAnnotation,
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle
): LineCover {
  if (!hidesLinesUnder(mark)) return 'none';
  const { toPicture, tolerance } = markFrame(step, style);
  return lineCoverOf(toPicture(mark.from), toPicture(mark.to), hideableLines(step, assets, style), tolerance);
}

/**
 * Where a step's marks are drawn, in its picture's units: a mark's point
 * there — an enlarged step's marks are in its window's — and how near a line
 * lies to be under a mark ({@link markReach} of the frame they are drawn on,
 * a window's for an enlarged step), never finer than the picture's own
 * points are kept to.
 */
function markFrame(
  step: DiagramStep,
  style: DiagramStyle
): { toPicture: (point: MarkPoint) => MarkPoint; tolerance: number } {
  const window = viewOfStep(step).window;
  const frame = window ? Math.max(window.width, window.height) : 1;
  return {
    toPicture: (point) => (window ? fromBox(window, [point[0], point[1]]) : point),
    tolerance: Math.max(PICTURE_POINT_EPSILON, markReach(style) * frame),
  };
}

/**
 * How much of `lines` a mark from `from` to `to` lies along, in picture
 * units: a line lies under it where the shorter of the two lies on the
 * other's line, within `reach`, and they overlap by more than it. `part`
 * where it covers a stretch of a line and leaves the rest, else `whole`.
 * Every line is tried, its box first: a picture has thousands, and a mark
 * lies near few.
 */
function lineCoverOf(from: MarkPoint, to: MarkPoint, lines: readonly HideableLine[], reach: number): LineCover {
  const length = Math.hypot(to[0] - from[0], to[1] - from[1]);
  if (!(length > reach)) return 'none';
  const [minX, maxX] = [Math.min(from[0], to[0]) - reach, Math.max(from[0], to[0]) + reach];
  const [minY, maxY] = [Math.min(from[1], to[1]) - reach, Math.max(from[1], to[1]) + reach];
  const [ux, uy] = [(to[0] - from[0]) / length, (to[1] - from[1]) / length];
  let cover: LineCover = 'none';
  for (const line of lines) {
    const [x0, y0, x1, y1] = line.box;
    if (x1 < minX || x0 > maxX || y1 < minY || y0 > maxY) continue;
    const { a, b } = line;
    const along =
      line.length <= length
        ? offLine(a, from, to, length) <= reach && offLine(b, from, to, length) <= reach
        : offLine(from, a, b, line.length) <= reach && offLine(to, a, b, line.length) <= reach;
    if (!along) continue;
    // How far along the mark each of the line's ends lies, and so how much of the two is one.
    const s = (a[0] - from[0]) * ux + (a[1] - from[1]) * uy;
    const t = (b[0] - from[0]) * ux + (b[1] - from[1]) * uy;
    const overlap = Math.min(length, Math.max(s, t)) - Math.max(0, Math.min(s, t));
    if (!(overlap > reach)) continue;
    if (overlap < line.length - reach) return 'part';
    cover = 'whole';
  }
  return cover;
}

/** How far `point` lies off the line through `a` and `b`, `length` apart. */
function offLine([x, y]: MarkPoint, [ax, ay]: MarkPoint, [bx, by]: MarkPoint, length: number): number {
  return Math.abs((x - ax) * (by - ay) - (y - ay) * (bx - ax)) / length;
}

/** The lines of each picture a mark can hide, by what decides them: whether its aux lines are drawn, or its style. */
const hideableByScene = new WeakMap<DiagramScenePicture, { key: string; lines: readonly HideableLine[] }>();
const hideableByStepDiagram = new WeakMap<DiagramStepDiagramPicture, { key: string; lines: readonly HideableLine[] }>();

/** Any size will do for a References step's lines: they are read in units of its sheet. */
const READ_SHEET_MM = 50;

/**
 * The lines of a step's picture a mark can hide, in picture units, read once
 * per picture object from the scene it is painted from: what
 * `sceneUnderMarks` leaves out, as drawn — a crease another layer covers part
 * of is the pieces that show, where the snap reads the whole crease — so a
 * mark that lies along one always changes the picture. A captured scene's
 * frame is its bounds; a References step's, its sheet.
 */
function hideableLines(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle
): readonly HideableLine[] {
  const source = stepPictureSource(step, assets);
  switch (source?.kind) {
    case 'scene': {
      const aux = diagramScenePaintStyle(style, source.pattern).auxCreases.visible;
      const key = aux ? 'aux' : '';
      const known = hideableByScene.get(source.picture);
      if (known?.key === key) return known.lines;
      const scene = storedScene(source.picture);
      const { minX = 0, minY = 0, maxX = 0, maxY = 0 } = scene?.bounds ?? {};
      const longer = Math.max(maxX - minX, maxY - minY);
      const lines =
        scene && longer > 0
          ? hideableSceneLines(scene, aux).map(([a, b]) =>
              hideableLine([(a[0] - minX) / longer, (a[1] - minY) / longer], [(b[0] - minX) / longer, (b[1] - minY) / longer])
            )
          : [];
      hideableByScene.set(source.picture, { key, lines });
      return lines;
    }
    case 'step-diagram': {
      const key = diagramStyleKey(style);
      const known = hideableByStepDiagram.get(source.picture);
      if (known?.key === key) return known.lines;
      const { model, mirrored } = source.picture;
      const sheet = stepDiagramSheetBox(model, mirrored, READ_SHEET_MM);
      const longer = Math.max(sheet.width, sheet.height);
      const toPicture = ([x, y]: readonly [number, number]): MarkPoint => [(x - sheet.x) / longer, (y - sheet.y) / longer];
      const lines =
        longer > 0
          ? hideableSceneLines(stepDiagramScene(model, mirrored, style, READ_SHEET_MM), true).map(([a, b]) =>
              hideableLine(toPicture(a), toPicture(b))
            )
          : [];
      hideableByStepDiagram.set(source.picture, { key, lines });
      return lines;
    }
    case 'asset':
    case 'fixed':
    case undefined:
      return [];
  }
}

function hideableLine(a: MarkPoint, b: MarkPoint): HideableLine {
  return {
    a,
    b,
    length: Math.hypot(b[0] - a[0], b[1] - a[1]),
    box: [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])],
  };
}

/**
 * The lines as a key: each one's ends to the tolerance, the nearer the
 * origin first, in order — so the same lines in another order, or a mark
 * drawn the other way, leave out the same and share it.
 */
function coveringKey(lines: readonly (readonly [MarkPoint, MarkPoint])[], tolerance: number): string {
  const point = ([x, y]: MarkPoint) => `${Math.round(x / tolerance)},${Math.round(y / tolerance)}`;
  return lines
    .map(([a, b]) => [point(a), point(b)].sort().join('-'))
    .sort()
    .join(';');
}
