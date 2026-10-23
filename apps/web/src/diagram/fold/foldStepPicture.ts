/**
 * A Fold step's picture as a Diagram step keeps it (fold-workspace plan D11,
 * D17): made from what the Fold engine says of the step's states, through
 * the same paper-scene route every captured picture takes, so it is drawn in
 * the diagram's pens, measured, anchored and posed as a linked pattern's is.
 *
 * - **Units.** A Fold sheet's longer side is drawn as long as Edit draws its
 *   paper ({@link PATTERN_PER_SHEET_UNIT} pattern units), y down as Edit's
 *   model is — what every canvas shows of Fold's y-up frames — so a page
 *   sizes a Fold step and an Edit capture alike (D10).
 * - **Crease pattern.** The step's own state's creases (`creasePatternPaperScene`,
 *   Fold's own builder): the folds earlier steps made in the fold pens, the
 *   precreases in the aux pen, and — for the state before the step — the
 *   creases the step makes in the diagram pens, its instruction. About the
 *   sheet's middle, turned, on either side's colour; with Flip creases on
 *   the back, turned over side to side as a linked pattern's is.
 * - **Folded.** The state shown — the one the step folds from (`before`), or
 *   the one it lands (`after`) — is the kernel scene's shape already
 *   (`FoldScene`), taken into pattern units and, for the back, turned over:
 *   mirrored, every stack read from the other end, every face's other side
 *   up. Then `flatScenePicture`, with its faces on the paper.
 * - **Marks.** Before a fold, its line and its arrow, from the engine's
 *   picture of the step (`FoldActionGeometry`), as the Diagram's own
 *   annotations, tagged as the source's (`imported: 'untouched'`) so a
 *   refresh brings the step's own again and the author's stay. Drawn on the
 *   folded picture, which is in the frame they are given in.
 *
 * Pure: no React, no store, no engine.
 */

import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { creasePatternPaperScene } from '../../fold/canvas/foldPaneScenes';
import type { FoldScene } from '../../fold/engine/foldEngineWire';
import { foldStateFrame } from '../../fold/sequence/foldStateFrame';
import { ORIEDITA_PAPER_SIZE } from '../../lib/creasePatternViewport';
import { DIAGRAM_PUSH_INK } from '../../lib/stepDiagram/diagramInk';
import { INK_UNITS } from '../annotate/canvasInk';
import { turnClockwise, type Point } from '../../lib/geometry';
import type { PaperLineRole, PaperScene, ScenePoint } from '../../lib/paper/paperScene';
import { storedSheetThumbnail, type SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { withCarriedAnnotations } from '../annotate/annotationCarry';
import { arrowApex, createAnnotation, MAX_BEHIND_LAYERS, type PictureFrame, type PicturePoint } from '../annotate/annotationModel';
import { flatScenePicture, storeScene, type CapturedPicture } from '../capture/captureFolded';
import { CAPTURE_PX_PER_UNIT } from '../capture/captureGeometry';
import {
  creasePatternSide,
  creasesFlipped,
  isKnownAnnotation,
  randomDiagramId,
  type DiagramAnnotationKind,
  type DiagramCpRender,
  type DiagramFoldMoment,
  type DiagramIdFactory,
  type DiagramPleatKinks,
  type DiagramScenePicture,
  type DiagramStep,
  type KnownDiagramAnnotation,
} from '../document/diagramDocument';
import { storedAnnotations } from '../document/diagramFile';
import { storedScene } from '../pictures/pictureFrame';
import { repeatCalloutMark, type FoldRepeatCallout } from './foldRepeatCallout';
import type { FoldStepAction } from './foldStepMarkPlan';

/** Pattern units per Fold sheet unit: a Fold sheet the size Edit draws its paper. */
export const PATTERN_PER_SHEET_UNIT = ORIEDITA_PAPER_SIZE;

/** A Fold frame's point in pattern units, y down. */
export function sheetToPattern({ x, y }: Point): Point {
  return { x: x * PATTERN_PER_SHEET_UNIT, y: -y * PATTERN_PER_SHEET_UNIT };
}

/** A point of a scene seen from `side`: the back is the front mirrored left to right. */
function seenFrom(side: 'front' | 'back'): (point: Point) => Point {
  return side === 'back' ? ({ x, y }) => ({ x: -x, y }) : (point) => point;
}

/**
 * A Fold state's scene as the kernel's paper scene, in pattern units, seen
 * from `side`: the front as Fold shows it (its view applied), or the model
 * turned over — every point mirrored, every stack read from the other end and
 * every face showing its other side — as the kernel's back pass is. Where
 * each point lies on the sheet is the paper's, whichever side shows.
 */
export function foldScenePattern(scene: FoldScene, side: 'front' | 'back'): OristudioCpFoldedPaperScene {
  const look = seenFrom(side);
  const place = (point: Point): Point => look(sheetToPattern(point));
  const back = side === 'back';
  return {
    schema_version: scene.schema_version,
    flipped: back ? !scene.flipped : scene.flipped,
    sheet: scene.sheet * PATTERN_PER_SHEET_UNIT,
    faces: scene.faces.map((face) => ({
      outline: face.outline.map(place),
      points: [...face.points],
      front_up: back ? !face.front_up : face.front_up,
      edges: face.edges.map((edge) => ({ from: place(edge.from), to: place(edge.to), kind: edge.kind })),
    })),
    subfaces: scene.subfaces.map((subface) => ({
      polygon: subface.polygon.map(place),
      faces_top_to_bottom: back ? [...subface.faces_top_to_bottom].reverse() : [...subface.faces_top_to_bottom],
    })),
    aux_lines: scene.aux_lines.map((line) => ({ from: place(line.from), to: place(line.to), face: line.face })),
    sheet_points: scene.sheet_points.map(sheetToPattern),
  };
}

/** The step's own state, whose creases its crease pattern and thumbnail draw. */
export interface FoldStepOwnState {
  scene: FoldScene;
  /** How many steps led to it (`FoldStateSummary.step`): what its creases' `made_at` counts. */
  step: number;
  /** The sheet's outline, counter-clockwise, in sheet coordinates. */
  sheet: readonly (readonly [number, number])[];
  /**
   * How many steps led to the state the step folds from — for a run of steps
   * drawn as one (`foldPrecreaseMerge.ts`), its last step's state `own`, the
   * state its first folds from. Every crease made since is the step's own (a
   * Repeat's every operation's, a run's every precrease's), and its crease
   * pattern draws them all as the instruction. One step before `step` when
   * absent.
   */
  since?: number;
}

export interface FoldStepPictureInput {
  /** The state the picture shows: the step's parent's for `before`, its own for `after`. */
  shown: FoldScene;
  own: FoldStepOwnState;
  moment: DiagramFoldMoment;
  /**
   * What the step does — a run's first — on the state it folds from, its
   * marks placed by its references (`foldStepMarkPlan.ts`); null for a turn,
   * a rotation or an import.
   */
  action: FoldStepAction | null;
  /** Repeat's affected material in the starting pose, with localized callout words. */
  repeat?: FoldRepeatCallout;
  /**
   * What a run's later steps do, each in the frame `shown` is drawn in
   * (`foldPrecreaseMerge.ts`): their lines and arrows join the first's, on
   * the one picture. Absent for one step.
   */
  merged?: readonly FoldStepAction[];
}

export interface FoldStepPicture {
  captured: CapturedPicture;
  /** The step's own marks, in the picture's units, tagged as its source's; empty when it brings none. */
  marks: KnownDiagramAnnotation[];
  /** The step's crease pattern, small, as a step keeps it. */
  thumbnail: SheetThumbnail;
}

/** The step's crease pattern as a thumbnail, as the Fold strip draws it. */
export function foldStepThumbnail(own: FoldStepOwnState): SheetThumbnail {
  return foldStateFrame(own.scene).pattern ?? storedSheetThumbnail(null);
}

/** The middle of the sheet's box, in pattern units: what a crease pattern is turned about. */
function sheetMiddle(sheet: FoldStepOwnState['sheet']): Point {
  const placed = sheet.map(([x, y]) => sheetToPattern({ x, y }));
  const xs = placed.map((point) => point.x);
  const ys = placed.map((point) => point.y);
  return xs.length > 0
    ? { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 }
    : { x: 0, y: 0 };
}

/**
 * The step's crease pattern, as `render` poses it: about the sheet's middle,
 * turned, on its side's colour. With Flip creases on the back the paper is
 * turned over side to side, as a linked pattern's is (`creasePatternScene`):
 * mirrored about the sheet's vertical middle before it is turned, and every
 * mountain drawn as a valley and every valley as a mountain.
 */
function creasePatternPicture(input: FoldStepPictureInput, render: Extract<DiagramCpRender, { mode: 'crease-pattern' }>): CapturedPicture {
  const { own, moment } = input;
  const middle = sheetMiddle(own.sheet);
  const turn = turnClockwise(render.rotationDeg);
  const flipped = creasesFlipped(render);
  const across = flipped ? -1 : 1;
  const toScenePx = (point: Point): ScenePoint => {
    const placed = sheetToPattern(point);
    const turned = turn({ x: across * (placed.x - middle.x), y: placed.y - middle.y });
    return [turned.x * CAPTURE_PX_PER_UNIT, turned.y * CAPTURE_PX_PER_UNIT];
  };
  const scene = creasePatternPaperScene(own.scene, {
    // Before the step its creases are its instruction; after it, folds like any.
    display: { stepCreases: moment === 'before', precreases: true },
    sheet: own.sheet,
    step: own.step,
    ...(own.since !== undefined ? { since: own.since } : {}),
    place: { toScenePx, sheetPx: PATTERN_PER_SHEET_UNIT * CAPTURE_PX_PER_UNIT },
    side: creasePatternSide(render),
  });
  return storeScene(flipped ? withFoldsTurnedOver(scene) : scene, CAPTURE_PX_PER_UNIT, null);
}

/** A fold's pen seen from the paper's other side: a mountain is a valley there, and a valley a mountain. */
const TURNED_OVER_ROLE: Partial<Record<PaperLineRole, PaperLineRole>> = {
  mountain: 'valley',
  valley: 'mountain',
  'diagram-mountain': 'diagram-valley',
  'diagram-valley': 'diagram-mountain',
};

/** `scene` with every mountain and valley swapped, the instruction's with them; every item where it was. */
function withFoldsTurnedOver(scene: PaperScene): PaperScene {
  return {
    ...scene,
    items: scene.items.map((item) =>
      item.kind === 'line' ? { ...item, role: TURNED_OVER_ROLE[item.role] ?? item.role } : item
    ),
  };
}

/** The stored scene a captured picture draws, for the frame its marks are in. */
function capturedScene(captured: CapturedPicture): PaperScene | null {
  if (captured.kind === 'over-budget') return captured.scene;
  return captured.picture.kind === 'scene' ? storedScene(captured.picture) : null;
}

/** Whether a point of the picture, in its units, lies on its paper: on a face of the scene it is drawn from. */
function paperTest(scene: PaperScene, longer: number): (point: PicturePoint) => boolean {
  const { minX, minY } = scene.bounds;
  const rings = scene.items.flatMap((item) => (item.kind === 'face' ? item.rings : []));
  return ([u, v]) => {
    const [x, y] = [minX + u * longer, minY + v * longer];
    let inside = false;
    for (const ring of rings) {
      for (let k = 0, j = ring.length - 1; k < ring.length; j = k, k += 1) {
        const [ax, ay] = ring[k]!;
        const [bx, by] = ring[j]!;
        if (ay > y !== by > y && x < ax + ((y - ay) / (by - ay)) * (bx - ax)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  };
}

/** How close to a line, in picture units, an arrow's arc runs along it rather than past it. */
const ALONG_A_LINE = 0.012;

function distanceToSegment([x, y]: PicturePoint, [ax, ay]: PicturePoint, [bx, by]: PicturePoint): number {
  const length2 = (bx - ax) ** 2 + (by - ay) ** 2;
  const t = length2 > 0 ? Math.min(1, Math.max(0, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / length2)) : 0;
  return Math.hypot(x - (ax + (bx - ax) * t), y - (ay + (by - ay) * t));
}

/**
 * A fold arrow bowed the way that keeps more of it over the paper, and then
 * the way that runs along fewer of the step's lines: the way a new arrow bows
 * (away from the picture's middle), unless the other way does better. Over
 * the paper means its arc's apex and the stretch beyond it, and beside its
 * ends on the bowed side, where a fold-and-unfold arrow's return runs; along
 * a line, the points of its arc that lie on one of `lines`.
 */
function bowedOverPaper(
  arrow: KnownDiagramAnnotation,
  onPaper: (point: PicturePoint) => boolean,
  lines: readonly (readonly [PicturePoint, PicturePoint])[]
): KnownDiagramAnnotation {
  const { bend, from, to } = arrow;
  if (bend === undefined) return arrow;
  const chord = Math.hypot(to[0] - from[0], to[1] - from[1]);
  const middle: PicturePoint = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
  const score = (sagitta: number) => {
    const apex = arrowApex(from, to, sagitta);
    const out: PicturePoint = [apex[0] - middle[0], apex[1] - middle[1]];
    const length = Math.hypot(out[0], out[1]);
    if (!(length > 0) || !(chord > 0)) return 0;
    const beside = (end: PicturePoint): PicturePoint => [end[0] + (out[0] / length) * chord * 0.12, end[1] + (out[1] / length) * chord * 0.12];
    const kept = [apex, [middle[0] + out[0] * 1.6, middle[1] + out[1] * 1.6] as PicturePoint, beside(from), beside(to)].filter(onPaper).length;
    // The arc, near enough: the parabola through its ends and its apex.
    const control: PicturePoint = [2 * apex[0] - middle[0], 2 * apex[1] - middle[1]];
    let along = 0;
    for (let k = 1; k < 10; k += 1) {
      const t = k / 10;
      const point: PicturePoint = [
        (1 - t) ** 2 * from[0] + 2 * t * (1 - t) * control[0] + t ** 2 * to[0],
        (1 - t) ** 2 * from[1] + 2 * t * (1 - t) * control[1] + t ** 2 * to[1],
      ];
      if (lines.some(([a, b]) => distanceToSegment(point, a, b) < ALONG_A_LINE)) along += 1;
    }
    return kept * 10 - along;
  };
  return score(-bend) > score(bend) ? { ...arrow, bend: -bend } : arrow;
}

/**
 * A push arrow's length from tail to tip, in picture units: two and a
 * quarter times its head's width, the short hollow arrow Yoshizawa–Randlett
 * diagrams push a point or a spine in with — its head, and a shaft not much
 * longer. The engine says where the push lands and which way it comes from;
 * how long it is drawn is the diagram's.
 */
export const FOLD_PUSH_ARROW_LENGTH = 2.25 * 2 * DIAGRAM_PUSH_INK.headHalf * INK_UNITS;

/** A push arrow's tail: on the way from `from` to `tip`, {@link FOLD_PUSH_ARROW_LENGTH} back from the tip. */
function pushTail(from: PicturePoint, tip: PicturePoint): PicturePoint {
  const length = Math.hypot(from[0] - tip[0], from[1] - tip[1]);
  if (!(length > 0)) return from;
  const scale = FOLD_PUSH_ARROW_LENGTH / length;
  return [tip[0] + (from[0] - tip[0]) * scale, tip[1] + (from[1] - tip[1]) * scale];
}

/**
 * The step's marks on the flat picture `captured` is: its fold's line — the
 * stretches of it the moving paper is creased along that the viewer sees, a
 * stretch under a layer that stays not drawn, and a pinch's rest of it
 * dotted (`uncreased-line`); every crease of a rabbit ear,
 * a petal fold, a squash or a swivel the viewer sees — the points it names
 * circled (`foldStepMarkPlan.ts`), and its arrow from the paper it moves to
 * where it lands, dotted from an end under layers (15e), bowed over the
 * paper rather than off it where it can be; a precrease's arrow comes back.
 * A compound fold's push — its tip where the engine puts it, its length the
 * diagram's own ({@link FOLD_PUSH_ARROW_LENGTH}) — or pleat arrow too. Seen from the back, every fold
 * is named from there (RM7) and its layers are not the front's, so no end is
 * marked behind.
 */
export function foldStepMarks(
  action: FoldStepAction | null,
  captured: CapturedPicture,
  render: Extract<DiagramCpRender, { mode: 'folded-flat' }>,
  newId: DiagramIdFactory = randomDiagramId,
  repeat?: FoldRepeatCallout,
): KnownDiagramAnnotation[] {
  const scene = capturedScene(captured);
  if (!scene) return [];
  const { minX, minY, maxX, maxY } = scene.bounds;
  const longer = Math.max(maxX - minX, maxY - minY);
  if (!(longer > 0)) return [];
  const frame: PictureFrame = { width: (maxX - minX) / longer, height: (maxY - minY) / longer };
  const look = seenFrom(render.side);
  const turn = turnClockwise(render.rotationDeg);
  const toPicture = (point: Point): PicturePoint => {
    const turned = turn(look(sheetToPattern(point)));
    return [(turned.x * CAPTURE_PX_PER_UNIT - minX) / longer, (turned.y * CAPTURE_PX_PER_UNIT - minY) / longer];
  };
  if (repeat) {
    const callout = repeatCalloutMark(repeat, frame, toPicture, render.side, newId);
    return callout ? storedAnnotations([callout]) : [];
  }
  if (!action) return [];
  const back = render.side === 'back';
  // As the viewer sees it, from the side the picture shows.
  const valley = (action.direction === 'valley') !== back;
  const mark = (kind: DiagramAnnotationKind, from: Point, to: Point): KnownDiagramAnnotation =>
    createAnnotation(kind, toPicture(from), toPicture(to), frame, newId);
  const onPaper = paperTest(scene, longer);
  const marks: KnownDiagramAnnotation[] = [];
  const spans = action.spans.length > 0 ? action.spans : action.line ? [{ from: action.line[0], to: action.line[1], hidden: false }] : [];
  // Only the stretches the viewer sees: one under a layer that stays is not drawn.
  for (const span of spans) {
    if (span.hidden) continue;
    const spanValley = ((span.direction ?? action.direction) === 'valley') !== back;
    marks.push(mark(spanValley ? 'valley-line' : 'mountain-line', span.from, span.to));
  }
  // A pinch's line where it is not creased, dotted.
  for (const stretch of action.uncreased ?? []) marks.push(mark('uncreased-line', stretch.from, stretch.to));
  // The points it names — a crease's ends, the points a fold brings together — as the Diagram's point circles.
  for (const ring of action.rings ?? []) {
    const circle = mark('circle', ring.at, ring.at);
    const behind = back ? 0 : Math.min(ring.behind, MAX_BEHIND_LAYERS);
    marks.push(behind > 0 ? { ...circle, behind: { from: behind } } : circle);
  }
  if (action.grip) {
    const { at, image, hidden_at: over, hidden_image: overImage } = action.grip;
    const kind: DiagramAnnotationKind =
      action.kind === 'precrease' ? 'fold-unfold-arrow' : valley ? 'valley-arrow' : 'mountain-arrow';
    const lines = marks.filter((each) => each.kind.endsWith('-line')).map((each) => [each.from, each.to] as const);
    const arrow = bowedOverPaper(mark(kind, at, image), onPaper, lines);
    const from = back ? 0 : Math.min(over, MAX_BEHIND_LAYERS);
    const to = back || overImage === null ? 0 : Math.min(overImage, MAX_BEHIND_LAYERS);
    marks.push(from > 0 || to > 0 ? { ...arrow, behind: { ...(from > 0 ? { from } : {}), ...(to > 0 ? { to } : {}) } } : arrow);
  }
  if (action.push) {
    const tip = toPicture(action.push.toward);
    marks.push(createAnnotation('push-arrow', pushTail(toPicture(action.push.at), tip), tip, frame, newId));
  }
  if (action.pleat) {
    const kinks = Math.min(5, Math.max(1, Math.round(action.pleat.kinks))) as DiagramPleatKinks;
    marks.push({ ...mark('pleat-arrow', action.pleat.from, action.pleat.to), ...(kinks > 1 ? { kinks } : {}) });
  }
  // As the file holds them, every one Fold's own.
  return storedAnnotations(marks.map((annotation) => ({ ...annotation, imported: 'untouched' as const })));
}

/**
 * A Fold step's picture in `render`'s pose, its marks, and its thumbnail.
 * `render` is a crease pattern or a flat fold; the marks are a flat fold's,
 * before the step, when it folds.
 *
 * A spread picture's marks are placed on the picture as it lies flat — the
 * engine says where the fold's line and arrow are on the paper unspread — and
 * carried onto the spread one as a pose that spreads a step carries every
 * mark (`withCarriedAnnotations`): each point with the face it lies on. So a
 * step pulled with its spread, and one spread in the Diagram after it was
 * pulled, show their marks in one place.
 */
export function foldStepPicture(
  input: FoldStepPictureInput,
  render: DiagramCpRender,
  newId: DiagramIdFactory = randomDiagramId
): FoldStepPicture {
  const thumbnail = foldStepThumbnail(input.own);
  if (render.mode === 'crease-pattern') {
    return { captured: creasePatternPicture(input, render), marks: [], thumbnail };
  }
  if (render.mode !== 'folded-flat') throw new Error(`A Fold step is not shown ${render.mode}`);
  const pattern = foldScenePattern(input.shown, render.side);
  const captured = flatScenePicture(pattern, render.rotationDeg, render.spread);
  const merged = input.merged ?? [];
  if (input.moment !== 'before' || (!input.action && !input.repeat && merged.length === 0)) {
    return { captured, marks: [], thumbnail };
  }
  // A run's later steps' lines and arrows join the first's, on the one picture.
  const marksOn = (picture: CapturedPicture, pose: Extract<DiagramCpRender, { mode: 'folded-flat' }>) => [
    ...foldStepMarks(input.action, picture, pose, newId, input.repeat),
    ...merged.flatMap((action) => foldStepMarks(action, picture, pose, newId)),
  ];
  if (!render.spread) return { captured, marks: marksOn(captured, render), thumbnail };
  const { spread: _spread, ...flatRender } = render;
  const flat = flatScenePicture(pattern, render.rotationDeg);
  const marks = marksOn(flat, flatRender);
  return { captured, marks: marksCarriedOntoSpread(marks, { flat, flatRender }, { captured, render }, thumbnail), thumbnail };
}

/**
 * `marks`, placed on the unspread picture, carried onto the spread one with
 * the faces they lie on: the carry a diagram step's own spread verb makes,
 * run on the two pictures as one step would hold them. Left where they were
 * when either picture is not a stored scene (one too detailed to keep as a
 * drawing), which no carry can read.
 */
function marksCarriedOntoSpread(
  marks: KnownDiagramAnnotation[],
  from: { flat: CapturedPicture; flatRender: Extract<DiagramCpRender, { mode: 'folded-flat' }> },
  to: { captured: CapturedPicture; render: Extract<DiagramCpRender, { mode: 'folded-flat' }> },
  thumbnail: SheetThumbnail
): KnownDiagramAnnotation[] {
  if (marks.length === 0) return marks;
  const scene = (captured: CapturedPicture) =>
    captured.kind === 'picture' && captured.picture.kind === 'scene' ? captured.picture : null;
  const [flat, spread] = [scene(from.flat), scene(to.captured)];
  if (!flat || !spread) return marks;
  // One step, before and after its spread: the carry asks only that the
  // pictures are of one link, so the link's own ids do not matter here.
  const step = (render: DiagramCpRender, picture: DiagramScenePicture): DiagramStep => ({
    id: 'step-carry',
    revision: 0,
    source: { kind: 'fold-step', sequence: '', step: '', moment: 'before', path: '', state: '', engine: 0, thumbnail, render },
    picture,
    annotations: marks,
    annotatedPictureKey: picture.key,
    text: '',
    breakBefore: false,
  });
  const carried = withCarriedAnnotations(step(from.flatRender, flat), step(to.render, spread), {});
  return carried.annotations.filter(isKnownAnnotation);
}
