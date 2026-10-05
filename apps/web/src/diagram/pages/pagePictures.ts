/**
 * Step pictures on a page (D10): how big each one is in pattern units, for the
 * shared paper scale, and each drawn into its cell's box at its cell's scale.
 *
 * - A captured scene and a capture kept as a bitmap carry their paper scale
 *   (picture px per pattern unit). A References step's sheet is its region,
 *   whose size in pattern units is where it came from.
 * - An upload, a fold kept as a fixed picture and a 3D capture have no paper
 *   scale: they are fitted to their box.
 * - Under `fit` a picture is drawn at its run's scale (`scaleRuns`): the
 *   paper keeps one size from step to step where it can.
 * - A picture is centred in the room the layout drew for it, which a tall
 *   one fills down its cell.
 * - A scene is drawn by the painter's body at the cell's projection, its pens
 *   at their pt widths. A References step is built at its sheet's size on the
 *   page, so its marks keep their pt size. Anything else is nested as itself.
 *
 * Everything a picture names by id is renamed under the cell's prefix, so two
 * cells drawn from one asset never share an id on a page. An upload's text is
 * set in the diagram's fonts (`uploadText.ts`), and a picture says what its
 * text sets in each face, for the page to embed.
 *
 * Pure: no DOM, no store.
 */
import type { PaperScene } from '@treemaker/origami-simulator';
import { INLINE_LABEL_FONT } from '../../cp-workspace/references/diagram/DiagramPrimitives';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, PT_PER_MM, mmToCssPx, paperSceneSvgBody } from '../../lib/paper/paperSvg';
import type {
  DiagramAsset,
  DiagramHanStyle,
  DiagramStep,
  DiagramStepDiagramPicture,
  DiagramStyle,
} from '../document/diagramDocument';
import { diagramScenePaintStyle, diagramStyleKey } from '../pictures/diagramPaperStyle';
import { paintSource, poseTransform, stepPictureSource, type StepPictureSource } from '../pictures/paintDiagramStep';
import { stepDiagramPaintStyle, stepDiagramScene, stepDiagramSheetBox } from '../pictures/paintStepDiagram';
import { hasDrawnAnnotations, paintAnnotations } from '../annotate/paintAnnotations';
import { annotationDrawing, annotationReach } from '../annotate/annotationPrimitives';
import { frameOf } from '../annotate/annotationModel';
import { storedScene } from '../pictures/pictureFrame';
import { fontFaceId } from '../fonts/diagramFontFaces';
import { setUploadText } from '../upload/uploadText';
import type { LayoutCell, LayoutStep, ReachLine, TextSetter } from './diagramPageLayout';

/** A picture whose size cannot be read: fitted, square. */
const UNSIZED: NonNullable<LayoutStep['picture']> = {
  kind: 'fit',
  width: 1,
  height: 1,
  frame: { width: 1, height: 1 },
  marks: { width: 0, height: 0 },
};

/**
 * A frame so large, in mm, that what a mark keeps at its pt size is nothing
 * beside it: a picture measured at it reaches only as far as its marks lie,
 * and grows as fast as it ever can.
 */
const GROWN_MM = 1e6;

/** How much smaller than its printed size a picture is measured again, for how its reach grows there. */
const MEASURE_NEAR = 0.05;

/** The size a References step's picture is measured at for its shape: any size does. */
const MEASURE_SHEET_MM = 50;


/** A picture drawn into its cell, and the text it sets: References' letters, an upload's text. */
export interface CellPicture {
  markup: string;
  /** What it draws, in pt: the drawing's own box, which a step's file is cropped to. */
  boundsPt: { x: number; y: number; width: number; height: number };
  /** The characters each face sets in the picture, by face id (`latin-700`). */
  text: { face: string; characters: string }[];
}

/**
 * A picture drawn, where its frame (D8) landed, in pt, and whether it was
 * fitted to its box rather than drawn at a scale the layout found for it.
 */
interface DrawnPicture extends CellPicture {
  framePt: { x: number; y: number; width: number; height: number };
  fitted: boolean;
}

/**
 * The size a layout draws a picture at, which its marks' reach depends on:
 * its mm per pattern unit, or its frame's longer side when it has no paper.
 * Null before a layout has found one.
 */
export type PictureMeasure = { mmPerUnit: number } | { frameMm: number } | null;

/** How a picture's own text is set: an upload's runs, its Han in the diagram's style. */
export interface PictureText {
  hanStyle: DiagramHanStyle;
  runs: TextSetter['runs'];
}

function longerSide({ minX, minY, maxX, maxY }: { minX: number; minY: number; maxX: number; maxY: number }) {
  return Math.max(maxX - minX, maxY - minY);
}

/** A References step's sheet, its longer side in pattern units; null when its region has no size. */
function sentSheetUnits(step: DiagramStep): number | null {
  if (step.source?.kind !== 'references-step') return null;
  const units = longerSide(step.source.region.bounds);
  return units > 0 && Number.isFinite(units) ? units : null;
}

/**
 * A References step's drawing across its longer side, per its sheet's longer
 * side, with the sheet `sheetMm` across. It depends on the size: the letters,
 * rings and arrowheads keep their pt size, so on a small sheet they reach
 * further past it.
 */
const drawingRatios = new WeakMap<DiagramStepDiagramPicture, Map<string, number>>();
function drawingRatio(picture: DiagramStepDiagramPicture, style: DiagramStyle, sheetMm: number): number {
  let bySize = drawingRatios.get(picture);
  if (!bySize) {
    bySize = new Map();
    drawingRatios.set(picture, bySize);
  }
  const key = `${diagramStyleKey(style)}|${sheetMm.toFixed(2)}`;
  let ratio = bySize.get(key);
  if (ratio === undefined) {
    const scene = stepDiagramScene(picture.model, picture.mirrored, style, sheetMm);
    ratio = scene.sheet > 0 ? Math.max(longerSide(scene.bounds) / scene.sheet, 1) : 1;
    bySize.set(key, ratio);
  }
  return ratio;
}

/**
 * The picture and what a step's annotations reach past its frame, together.
 * `picture` and `frame` are in CSS px at the size the frame prints, which is
 * the size the annotations are drawn at — their marks keep their pt size, so
 * how far they reach depends on it, as a References step's letters do.
 */
function reachedWith(step: DiagramStep, frame: Rect, picture: Rect, style: DiagramStyle): Rect {
  const pictureFrame = frameOf(frame.width, frame.height);
  const framePx = longerOf(frame);
  if (!pictureFrame || !(framePx > 0)) return picture;
  const reach = annotationReach(annotationDrawing(step.annotations, pictureFrame, framePx, style));
  return union(picture, { ...reach, x: frame.x + reach.x, y: frame.y + reach.y });
}

function longerOf(rect: Rect): number {
  return Math.max(rect.width, rect.height);
}

/**
 * A References step's drawing, and its sheet, in scene px with the sheet
 * `sheetMm` across. Kept per picture and size, as a layout asks for them on
 * every pass.
 */
const stepDiagramBoxCache = new WeakMap<DiagramStepDiagramPicture, Map<string, { drawing: Rect; sheet: Rect }>>();
function stepDiagramBoxes(picture: DiagramStepDiagramPicture, style: DiagramStyle, sheetMm: number) {
  let bySize = stepDiagramBoxCache.get(picture);
  if (!bySize) {
    bySize = new Map();
    stepDiagramBoxCache.set(picture, bySize);
  }
  const key = `${diagramStyleKey(style)}|${sheetMm.toFixed(2)}`;
  let boxes = bySize.get(key);
  if (!boxes) {
    const { bounds } = stepDiagramScene(picture.model, picture.mirrored, style, sheetMm);
    boxes = {
      drawing: { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY },
      sheet: stepDiagramSheetBox(picture.model, picture.mirrored, sheetMm),
    };
    bySize.set(key, boxes);
  }
  return boxes;
}

/**
 * What the layout needs of a step's picture: its width and height with what
 * its marks — a References step's letters, any step's annotations — reach
 * past its frame, in pattern units when it knows its paper, else per its
 * frame's longer side; and the frame alone.
 *
 * A mark is in part where it is on the picture, which grows with it, and in
 * part its pen and its head, its letter, its glyph, which keep their pt size;
 * and a glyph larger than the paper hides the paper's growth until the paper
 * outgrows it. So the reach is a line only near a scale: the picture is
 * measured at the size it prints at (`measure`, a first layout's, else a
 * card's) and a little smaller, for how fast its reach grows there (`width`,
 * `height`, in its units — held between nothing and how fast it grows at a
 * vast size, the most it can) and what it reaches past that line at no size
 * (`marks`, mm). The picture with its marks is `width × scale + marks.width`
 * across at the scale measured, exactly, and near it; never less than its
 * frame (`pictureExtent`).
 */
export function layoutPicture(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  measure: PictureMeasure = null
): LayoutStep['picture'] {
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  /** The frame's longer side in mm, `units` pattern units across when it knows its paper. */
  const frameMm = (units: number | null): number =>
    measure && 'frameMm' in measure
      ? measure.frameMm
      : measure && units !== null && units > 0
        ? units * measure.mmPerUnit
        : MEASURE_SHEET_MM;
  const annotated = hasDrawnAnnotations(step.annotations);
  /**
   * The picture measured by `at(frameMm)`, which gives the frame and what it
   * reaches with its marks, in px, its frame `frameMm` across its longer
   * side: at the size it prints, a little smaller, and at a vast size.
   */
  const measured = (units: number | null, at: (frameMm: number) => { frame: Rect; reached: Rect } | null) => {
    const printed = at(frameMm(units));
    const near = at(frameMm(units) * (1 - MEASURE_NEAR));
    const vast = at(GROWN_MM);
    if (!printed || !near || !vast) return UNSIZED;
    const paper = units !== null && units > 0 && Number.isFinite(units);
    const unitsAcross = paper ? units : 1;
    const across = longerOf(printed.frame);
    const nearAcross = longerOf(near.frame);
    const mmPerPx = 1 / mmToCssPx(1);
    /**
     * How the reach grows along one side, per px of the frame's longer side,
     * and what it reaches past that line at none, in px; a picture reaching
     * no further than its frame is its frame, exactly.
     */
    const line = (side: 'width' | 'height') => {
      if (printed.reached[side] === printed.frame[side] && near.reached[side] === near.frame[side]) {
        return { grows: printed.frame[side] / across, beyond: 0 };
      }
      const most = vast.reached[side] / longerOf(vast.frame);
      const slope = (printed.reached[side] - near.reached[side]) / (across - nearAcross);
      const grows = Number.isFinite(slope) ? Math.min(most, Math.max(0, slope)) : most;
      return { grows, beyond: printed.reached[side] - grows * across };
    };
    const [wide, tall] = [line('width'), line('height')];
    /**
     * How far the reach lies past one edge of the frame, as `line` measures
     * the whole: its growth held between the most a mark inside the frame
     * can shrink it, the frame's own side, and the most it grows at a vast
     * size.
     */
    const edge = (past: (measured: { frame: Rect; reached: Rect }) => number, side: 'width' | 'height'): ReachLine => {
      const [at, nearAt] = [Math.max(0, past(printed)), Math.max(0, past(near))];
      if (at === 0 && nearAt === 0) return { grows: 0, beyond: 0 };
      const most = Math.max(0, past(vast)) / longerOf(vast.frame);
      const slope = (at - nearAt) / (across - nearAcross);
      const grows = Number.isFinite(slope) ? Math.min(most, Math.max(-printed.frame[side] / across, slope)) : most;
      return { grows: grows * unitsAcross, beyond: (at - grows * across) * mmPerPx };
    };
    return {
      kind: paper ? ('paper' as const) : ('fit' as const),
      width: wide.grows * unitsAcross,
      height: tall.grows * unitsAcross,
      frame: { width: (printed.frame.width / across) * unitsAcross, height: (printed.frame.height / across) * unitsAcross },
      marks: { width: wide.beyond * mmPerPx, height: tall.beyond * mmPerPx },
      sides: {
        left: edge(({ frame, reached }) => frame.x - reached.x, 'width'),
        right: edge(({ frame, reached }) => reached.x + reached.width - (frame.x + frame.width), 'width'),
        top: edge(({ frame, reached }) => frame.y - reached.y, 'height'),
        bottom: edge(({ frame, reached }) => reached.y + reached.height - (frame.y + frame.height), 'height'),
      },
    };
  };
  /** A frame `width` × `height`, `units` pattern units across its longer side when known, with its annotations. */
  const framed = (units: number | null, width: number, height: number): LayoutStep['picture'] => {
    const longer = Math.max(width, height);
    if (!(longer > 0) || !Number.isFinite(longer)) return UNSIZED;
    return measured(units, (mm) => {
      const framePx = mmToCssPx(mm);
      const frame = { x: 0, y: 0, width: (width / longer) * framePx, height: (height / longer) * framePx };
      return { frame, reached: annotated ? reachedWith(step, frame, frame, style) : frame };
    });
  };
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      if (!scene) return UNSIZED;
      const scale = source.picture.paperScale;
      const units = scale ? longerSide(scene.bounds) / scale : null;
      const { minX, minY, maxX, maxY } = scene.bounds;
      return framed(units, maxX - minX, maxY - minY);
    }
    case 'asset': {
      const scale = step.picture?.kind === 'asset' ? step.picture.paperScale : null;
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      const units = scale ? Math.max(posed.widthPx, posed.heightPx) / scale : null;
      return framed(units, posed.widthPx, posed.heightPx);
    }
    case 'step-diagram': {
      // Its letters and its annotations together, measured against its sheet.
      return measured(sentSheetUnits(step), (mm) => {
        const { drawing, sheet } = stepDiagramBoxes(source.picture, style, mm);
        if (!(longerOf(sheet) > 0)) return null;
        return { frame: sheet, reached: annotated ? reachedWith(step, sheet, drawing, style) : drawing };
      });
    }
    case 'fixed':
      return framed(null, source.picture.widthPx, source.picture.heightPx);
  }
}

/**
 * A step's picture drawn into its cell: at the cell's mm per pattern unit
 * when it has one, its frame at the cell's size when it has no paper, else
 * fitted; centred, in the room the layout drew for it (`drawMm`) or else its
 * square box. Null for a step with nothing to draw.
 */
export function cellPicture(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  cell: Pick<LayoutCell, 'pictureMm' | 'mmPerUnit' | 'frameMm'> & Partial<Pick<LayoutCell, 'drawMm'>>,
  idPrefix: string,
  text: PictureText
): CellPicture | null {
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  const area = cell.drawMm ?? { x: cell.pictureMm.x, y: cell.pictureMm.y, w: cell.pictureMm.size, h: cell.pictureMm.size };
  const box: Rect = { x: area.x * PT_PER_MM, y: area.y * PT_PER_MM, width: area.w * PT_PER_MM, height: area.h * PT_PER_MM };
  /** The picture drawn into `inner`, `k` of its room, and its annotations on its frame. */
  const place = (inner: Rect, k = 1) => {
    // A scale the layout found shrinks with the room it is drawn into.
    const frame = cell.frameMm === null ? null : cell.frameMm * PT_PER_MM * k;
    const mmPerUnit = cell.mmPerUnit === null ? null : cell.mmPerUnit * k;
    const drawn = draw(source, step, style, inner, mmPerUnit, frame, text);
    if (!drawn) return null;
    const marks = paintAnnotations(step.annotations, drawn.framePt, longerOf(drawn.framePt) / PT_PER_CSS_PX, style);
    return { drawn, marks, reached: marks ? union(drawn.boundsPt, marks.bounds) : drawn.boundsPt };
  };
  let placed = place(box);
  if (!placed) return null;
  // Marks that reach past the picture — annotations, a References step's
  // letters — get room in the box: a fitted picture shrinks so the two
  // together fit, and the two together are centred. A picture at a scale the
  // layout found keeps it: the layout measured its marks at that scale and
  // left them room, or held the paper at its floor (`MARKS_FLOOR`) and let
  // them reach out. The reach grows at nearly a fixed rate as a picture
  // shrinks — its marks keep their pt size, an arrowhead short of its chord
  // — so a secant on the size settles in a step or two.
  const inner = (k: number): Rect => ({
    x: box.x + (box.width * (1 - k)) / 2,
    y: box.y + (box.height * (1 - k)) / 2,
    width: box.width * k,
    height: box.height * k,
  });
  /** How far the picture and its marks overrun the box, as the larger of their two sides' shares of its. */
  const overrun = (reached: Rect) => Math.max(reached.width / box.width, reached.height / box.height);
  if (placed.drawn.fitted && overrun(placed.reached) > 1 + 1e-4) {
    let previous = { k: 1, over: overrun(placed.reached) };
    let k = 1 / previous.over;
    for (let pass = 0; pass < 8; pass += 1) {
      const next = place(inner(k), k);
      if (!next) break;
      placed = next;
      const over = overrun(next.reached);
      if (over <= 1 + 1e-4) break;
      const rate = (previous.over - over) / (previous.k - k);
      previous = { k, over };
      k = rate > 0 ? k - (over - 1) / rate : k / over;
      if (!(k > 0)) break;
    }
  }
  const { drawn, reached } = placed;
  // A References step's letters are its drawing's own, so a sheet with no
  // annotations settles too: its letters may reach out, never its sheet.
  const dx = settle(reached.x, reached.width, box.x, box.width, drawn.framePt.x, drawn.framePt.width);
  const dy = settle(reached.y, reached.height, box.y, box.height, drawn.framePt.y, drawn.framePt.height);
  const shift = (markup: string) => (dx === 0 && dy === 0 ? markup : `<g transform="translate(${num(dx)} ${num(dy)})">${markup}</g>`);
  if (!placed.marks) {
    const { framePt: _frame, fitted: _fitted, ...plain } = drawn;
    return {
      ...plain,
      markup: prefixIds(shift(plain.markup), idPrefix),
      boundsPt: { ...plain.boundsPt, x: plain.boundsPt.x + dx, y: plain.boundsPt.y + dy },
    };
  }
  // A label is set as an upload's text is, its Han in the diagram's style.
  const usage = new Map(drawn.text.map(({ face, characters }) => [face, characters]));
  const markup = setUploadText(placed.marks!.markup, text.hanStyle, text.runs, (face, characters) =>
    usage.set(face, (usage.get(face) ?? '') + characters)
  );
  return {
    markup: prefixIds(shift(`${drawn.markup}\n${markup}`), idPrefix),
    boundsPt: { ...reached, x: reached.x + dx, y: reached.y + dy },
    text: [...usage].map(([face, characters]) => ({ face, characters })),
  };
}

type Rect = { x: number; y: number; width: number; height: number };

/**
 * How far, along one side, a picture and its marks (`at`, `size`) move to sit
 * in their room (`roomAt`, `roomSize`): not at all where they are in it;
 * centred in it where they fit it; and where they are more than it holds —
 * marks the layout let reach out — as near centred as keeps the paper itself
 * (`frameAt`, `frameSize`) in the room, so it never lands on a neighbour's.
 */
function settle(at: number, size: number, roomAt: number, roomSize: number, frameAt: number, frameSize: number): number {
  if (at >= roomAt - 1e-6 && at + size <= roomAt + roomSize + 1e-6) return 0;
  const centred = roomAt + roomSize / 2 - (at + size / 2);
  if (size <= roomSize) return centred;
  if (frameSize > roomSize) return roomAt + roomSize / 2 - (frameAt + frameSize / 2);
  return Math.min(Math.max(centred, roomAt - frameAt), roomAt + roomSize - (frameAt + frameSize));
}

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** The pt per px at which a `width` × `height` frame fits `box`, or its longer side is `framePt` across. */
function fitScale(box: Rect, width: number, height: number, framePt: number | null): number {
  if (framePt !== null) return framePt / Math.max(width, height);
  return Math.min(width > 0 ? box.width / width : Infinity, height > 0 ? box.height / height : Infinity);
}

/**
 * A picture drawn into `box`, centred: at `mmPerUnit` when it knows its
 * paper and has a scale, else its frame's longer side `framePt` across when
 * given, else fitted to the box.
 */
function draw(
  source: StepPictureSource,
  step: DiagramStep,
  style: DiagramStyle,
  box: Rect,
  mmPerUnit: number | null,
  framePt: number | null,
  text: PictureText
): DrawnPicture | null {
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      if (!scene) return null;
      const scale = source.picture.paperScale;
      const { minX, minY, maxX, maxY } = scene.bounds;
      const ptPerPx =
        mmPerUnit !== null && scale
          ? (mmPerUnit * PT_PER_MM) / scale
          : longerSide(scene.bounds) > 0
            ? fitScale(box, maxX - minX, maxY - minY, framePt)
            : PT_PER_CSS_PX;
      const placed = placedScene(scene, diagramScenePaintStyle(style, source.pattern), box, ptPerPx);
      // A scene's frame is its bounds.
      return { ...placed, framePt: placed.boundsPt, text: [], fitted: !(mmPerUnit !== null && scale) && framePt === null };
    }
    case 'step-diagram': {
      const units = sentSheetUnits(step);
      const boxMm = Math.min(box.width, box.height) / PT_PER_MM;
      // Fitted: the sheet's size for a card first, then again at the size that gives.
      const fitted = () => {
        const first = boxMm / drawingRatio(source.picture, style, MEASURE_SHEET_MM);
        return boxMm / drawingRatio(source.picture, style, first);
      };
      const sheetMm =
        mmPerUnit !== null && units !== null ? units * mmPerUnit : framePt !== null ? framePt / PT_PER_MM : fitted();
      const { model, mirrored } = source.picture;
      const scene = stepDiagramScene(model, mirrored, style, sheetMm);
      // Built at its size on the page: one scene px is one CSS px of it.
      const placed = placedScene(scene, stepDiagramPaintStyle(style), box, PT_PER_CSS_PX);
      const letters = labelsOf(source.picture);
      // Its frame is its sheet, wherever its letters reach.
      const sheet = stepDiagramSheetBox(model, mirrored, sheetMm);
      return {
        markup: placed.markup.replaceAll(`font-family="${INLINE_LABEL_FONT}"`, `font-family="'Noto Sans', sans-serif"`),
        boundsPt: placed.boundsPt,
        fitted: !(mmPerUnit !== null && units !== null) && framePt === null,
        framePt: {
          x: placed.boundsPt.x + (sheet.x - scene.bounds.minX) * PT_PER_CSS_PX,
          y: placed.boundsPt.y + (sheet.y - scene.bounds.minY) * PT_PER_CSS_PX,
          width: sheet.width * PT_PER_CSS_PX,
          height: sheet.height * PT_PER_CSS_PX,
        },
        text: letters === '' ? [] : [{ face: fontFaceId({ key: 'latin', weight: 700 }), characters: letters }],
      };
    }
    case 'asset':
    case 'fixed': {
      const painted = paintSource(source, style);
      if (!painted || !(painted.widthPx > 0) || !(painted.heightPx > 0)) return null;
      const scale =
        source.kind === 'asset' && step.picture?.kind === 'asset' ? step.picture.paperScale : null;
      const ptPerPx =
        mmPerUnit !== null && scale
          ? (mmPerUnit * PT_PER_MM) / scale
          : fitScale(box, painted.widthPx, painted.heightPx, framePt);
      const width = painted.widthPx * ptPerPx;
      const height = painted.heightPx * ptPerPx;
      const x = box.x + (box.width - width) / 2;
      const y = box.y + (box.height - height) / 2;
      const usage = new Map<string, string>();
      const body =
        source.kind === 'asset'
          ? setUploadText(withoutDeclaration(painted.svg), text.hanStyle, text.runs, (face, characters) =>
              usage.set(face, (usage.get(face) ?? '') + characters)
            )
          : withoutDeclaration(painted.svg);
      return {
        markup:
          `<svg x="${num(x)}" y="${num(y)}" width="${num(width)}" height="${num(height)}" ` +
          `viewBox="0 0 ${num(painted.widthPx)} ${num(painted.heightPx)}" overflow="visible">${body}</svg>`,
        boundsPt: { x, y, width, height },
        framePt: { x, y, width, height },
        fitted: !(mmPerUnit !== null && scale) && framePt === null,
        text: [...usage].map(([face, characters]) => ({ face, characters })),
      };
    }
  }
}

/** A scene's elements at `ptPerPx`, its drawing centred in the box, and the box it fills. */
function placedScene(scene: PaperScene, style: PaperStyle, box: Rect, ptPerPx: number) {
  const { bounds } = scene;
  const width = (bounds.maxX - bounds.minX) * ptPerPx;
  const height = (bounds.maxY - bounds.minY) * ptPerPx;
  const offsetX = box.x + (box.width - width) / 2;
  const offsetY = box.y + (box.height - height) / 2;
  const body = paperSceneSvgBody(scene, style, {
    project: ([x, y]) => [(x - bounds.minX) * ptPerPx + offsetX, (y - bounds.minY) * ptPerPx + offsetY],
    unitsPerPt: 1,
    keepHiddenFaces: false,
  });
  return {
    // Round joins, as the painter's own page has them.
    markup: `<g stroke-linejoin="round">\n${body}\n</g>`,
    boundsPt: { x: offsetX, y: offsetY, width, height },
  };
}

/** Every letter the step's labels set. */
function labelsOf(picture: DiagramStepDiagramPicture): string {
  const characters = new Set<string>();
  for (const primitive of picture.model.primitives) {
    if (primitive.kind === 'label') for (const character of primitive.text) characters.add(character);
  }
  return [...characters].join('');
}

/** An SVG document's markup without its XML declaration, to nest it. */
function withoutDeclaration(svg: string): string {
  return svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
}

/**
 * Every id a fragment declares or refers to, renamed under `prefix`: in
 * `id="…"`, `href="#…"` (and `xlink:href`) and `url(#…)`, inside tags only, so
 * no text a picture draws is touched. Our painters and the sanitizer write
 * references in no other form.
 */
export function prefixIds(markup: string, prefix: string): string {
  return markup.replace(/<[^>]*>/g, (tag) =>
    tag
      .replace(/(\sid=")([^"]*)"/g, (_, head: string, id: string) => `${head}${prefix}${id}"`)
      .replace(/(href=")#([^"]*)"/g, (_, head: string, id: string) => `${head}#${prefix}${id}"`)
      .replace(/url\(\s*(['"]?)#([^)'"]*)\1\s*\)/g, (_, quote: string, id: string) => `url(${quote}#${prefix}${id}${quote})`)
  );
}

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
