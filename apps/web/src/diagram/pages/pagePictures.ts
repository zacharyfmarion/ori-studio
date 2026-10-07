/**
 * Step pictures on a page (D10): how big each one is in pattern units, for the
 * shared paper scale, and each drawn into its cell's box at its cell's scale.
 *
 * - A captured scene and a capture kept as a bitmap carry their paper scale
 *   (picture px per pattern unit). A References step's sheet is its region,
 *   whose size in pattern units is where it came from.
 * - An upload, a fold kept as a fixed picture and a 3D capture have no paper
 *   scale: they are fitted to their box.
 * - A picture is drawn at its run's scale (`scaleRuns`): the paper keeps one
 *   size from step to step where it can.
 * - A picture is centred in the room the layout drew for it, which a tall
 *   one fills down its cell.
 * - A scene is drawn by the painter's body at the cell's projection, its pens
 *   at their pt widths. A References step is built at its sheet's size on the
 *   page, so its marks keep their pt size. Anything else is nested as itself.
 *
 * An enlarged step (Revision 2) is its window: its frame's box, laid out by
 * what of it prints — all of it, or for a cut frame the paper inside it and
 * the boundary's pieces (`zoomContentBox`) — at the size the layout gives
 * enlarged steps, its own picture drawn larger under a clip in the frame's
 * shape, its boundary over it, and its marks — in the window's units — on the
 * window, as on any frame. It is measured, and kept in its room, by what lies
 * inside its window (Zach, 2026-10-07): a mark reaching out of it is drawn
 * whole but counts only inside it, and one wholly outside it not at all
 * (`marksTouchingWindow`), so marks copied in from the whole picture cannot
 * shrink it.
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
import {
  PT_PER_CSS_PX,
  PT_PER_MM,
  SEAM_STROKE_WIDTH_PT,
  mmToCssPx,
  paperSceneSvgBody,
  widestPenPt,
} from '../../lib/paper/paperSvg';
import type {
  DiagramAsset,
  DiagramHanStyle,
  DiagramStep,
  DiagramStepDiagramPicture,
  DiagramStyle,
} from '../document/diagramDocument';
import { diagramScenePaintStyle, diagramStyleKey } from '../pictures/diagramPaperStyle';
import {
  paintSource,
  poseTransform,
  sceneCulledTo,
  stepPictureSource,
  type StepPictureSource,
} from '../pictures/paintDiagramStep';
import { stepDiagramPaintStyle, stepDiagramScene, stepDiagramSheetBox } from '../pictures/paintStepDiagram';
import { hasDrawnAnnotations, paintAnnotations, type CloseUpPicture } from '../annotate/paintAnnotations';
import { annotationDrawing, annotationReach } from '../annotate/annotationPrimitives';
import { frameOf } from '../annotate/annotationModel';
import type { PictureLayers } from '../annotate/pictureGeometry';
import { markPaper, marksTouchingWindow, stepAsDrawn, viewGeometry, viewOfStep } from '../zoom/stepView';
import {
  paintZoomed,
  windowBox,
  zoomCull,
  zoomEdgePen,
  zoomedSource,
  zoomPlacement,
  type ZoomedSource,
} from '../zoom/paintZoomed';
import type { PictureBox } from '../zoom/zoomModel';
import { zoomContentBox } from '../zoom/zoomContent';
import { storedScene } from '../pictures/pictureFrame';
import { prefixIds } from '../pictures/prefixIds';
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
  /**
   * Where its frame (D8) landed, in pt, as placed in its room: the box its
   * marks are drawn on — an enlarged step's window. Where a mark on it
   * prints: an enlarge area's centre, which the arrow after it is lifted to.
   */
  framePt: { x: number; y: number; width: number; height: number };
  /** The characters each face sets in the picture, by face id (`latin-700`). */
  text: { face: string; characters: string }[];
}

/**
 * A picture drawn, where its frame (D8) landed, in pt, and whether it was
 * fitted to its box rather than drawn at a scale the layout found for it.
 * `paperPt`, where it is not its frame, is what of it is kept in its room:
 * an enlarged step's content, the window's empty part aside.
 */
interface DrawnPicture extends CellPicture {
  fitted: boolean;
  paperPt?: Rect;
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
 * How many pattern units a step's whole picture is across its longer side,
 * for one that knows its paper, or null for one only ever fitted (or none):
 * how large an enlarged step's frame would print among its neighbours.
 */
export function wholeUnitsAcross(step: DiagramStep, assets: Readonly<Record<string, DiagramAsset>>): number | null {
  const source = stepPictureSource(step, assets);
  const units = source ? unitsAcross(source, step) : null;
  return units !== null && units > 0 && Number.isFinite(units) ? units : null;
}

/**
 * How many pattern units a picture's frame is across its longer side, for
 * one that knows its paper — a capture's scene or bitmap at its paper scale,
 * a References step's sheet — or null for one only ever fitted: how a layout's
 * mm per pattern unit becomes the size its frame prints at.
 */
function unitsAcross(source: StepPictureSource, step: DiagramStep): number | null {
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      const scale = source.picture.paperScale;
      return scene && scale ? longerSide(scene.bounds) / scale : null;
    }
    case 'asset': {
      const scale = step.picture?.kind === 'asset' ? step.picture.paperScale : null;
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      return scale ? Math.max(posed.widthPx, posed.heightPx) / scale : null;
    }
    case 'step-diagram':
      return sentSheetUnits(step);
    case 'fixed':
      return null;
  }
}

/**
 * The longer side a step's picture frame prints at in `cell`, in mm: the
 * frame size a fitted picture's run gives it, its pattern units at the
 * cell's mm per unit, or — for a picture the layout found no scale for, as
 * an upload under the Paper scale — the size the page fits it to its room
 * at ({@link fittedFrameMm}). Null for a step with no picture.
 */
export function printedFrameMm(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  cell: Pick<LayoutCell, 'mmPerUnit' | 'frameMm' | 'pictureMm'> & Partial<Pick<LayoutCell, 'drawMm'>>
): number | null {
  if (cell.frameMm !== null) return cell.frameMm;
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  const units = cell.mmPerUnit === null ? null : unitsAcross(source, step);
  if (units !== null && units > 0 && Number.isFinite(units)) return units * cell.mmPerUnit!;
  const area = cell.drawMm ?? { w: cell.pictureMm.size, h: cell.pictureMm.size };
  // An enlarged step's frame is its window (Revision 2): fitted, as a picture with no paper is.
  const shown = viewOfStep(step).window;
  const mm = shown ? fittedBoxMm(shown.width, shown.height, area) : fittedFrameMm(source, style, area);
  return mm !== null && mm > 0 && Number.isFinite(mm) ? mm : null;
}

/**
 * The longer side, in mm, a picture with no scale is drawn at, fitted to a
 * room `area` mm (`draw`) — before what its marks reach shrinks it to make
 * room for them (`cellPicture`), which takes a little off a picture whose
 * marks reach out: near enough to judge their print sizes by.
 */
function fittedFrameMm(source: StepPictureSource, style: DiagramStyle, area: { w: number; h: number }): number | null {
  const fitted = (width: number, height: number) => fittedBoxMm(width, height, area);
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      if (!scene) return null;
      const { minX, minY, maxX, maxY } = scene.bounds;
      return fitted(maxX - minX, maxY - minY);
    }
    case 'asset': {
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      return fitted(posed.widthPx, posed.heightPx);
    }
    case 'fixed':
      return fitted(source.picture.widthPx, source.picture.heightPx);
    case 'step-diagram':
      return fittedSheetMm(source.picture, style, Math.min(area.w, area.h));
  }
}

/** The longer side, in mm, of a `width` × `height` box fitted to a room `area` mm; null for one of no size. */
function fittedBoxMm(width: number, height: number, area: { w: number; h: number }): number | null {
  const box: Rect = { x: 0, y: 0, width: area.w, height: area.h };
  return width > 0 && height > 0 ? fitScale(box, width, height, null) * Math.max(width, height) : null;
}

/**
 * A References step's sheet fitted to a square `boxMm` across, with its
 * letters: the sheet's size for a card first, then again at the size that
 * gives, as its letters keep their pt size.
 */
function fittedSheetMm(picture: DiagramStepDiagramPicture, style: DiagramStyle, boxMm: number): number {
  const first = boxMm / drawingRatio(picture, style, MEASURE_SHEET_MM);
  return boxMm / drawingRatio(picture, style, first);
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
 * `layers`, the picture's, draw a mark behind a flap as the page will (15e).
 */
function reachedWith(step: DiagramStep, frame: Rect, picture: Rect, style: DiagramStyle, layers: PictureLayers | null): Rect {
  const pictureFrame = frameOf(frame.width, frame.height);
  const framePx = longerOf(frame);
  if (!pictureFrame || !(framePx > 0)) return picture;
  const reach = annotationReach(annotationDrawing(step.annotations, pictureFrame, framePx, style, layers));
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
  whole: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  measure: PictureMeasure = null
): LayoutStep['picture'] {
  // An enlarged step's marks far off its window are neither drawn nor measured.
  const step = stepAsDrawn(whole);
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
  const view = viewOfStep(step);
  // A flat fold's layers, in the marks' units: a mark behind a flap is drawn dotted under it (15e).
  const layers = annotated ? viewGeometry(view, assets, style).layers : null;
  /**
   * The picture measured by `at(frameMm)`, which gives the frame and what it
   * reaches with its marks, in px, its frame `frameMm` across its longer
   * side: at the size it prints, a little smaller, and at a vast size. An
   * enlarged step's (`window`): its frame its content, `window` of its units
   * across, at its window `frameMm` across.
   */
  const measured = (
    units: number | null,
    at: (frameMm: number) => { frame: Rect; reached: Rect } | null,
    window?: number
  ) => {
    const printed = at(frameMm(units));
    const near = at(frameMm(units) * (1 - MEASURE_NEAR));
    const vast = at(GROWN_MM);
    if (!printed || !near || !vast) return UNSIZED;
    const paper = units !== null && units > 0 && Number.isFinite(units);
    const unitsAcross = window ?? (paper ? units : 1);
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
      kind: window !== undefined ? ('zoom' as const) : paper ? ('paper' as const) : ('fit' as const),
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
  /**
   * A frame `width` × `height`, `units` pattern units across its longer side
   * when known, its ink `inkPx` past it all round, with its annotations.
   */
  const framed = (units: number | null, width: number, height: number, inkPx = 0): LayoutStep['picture'] => {
    const longer = Math.max(width, height);
    if (!(longer > 0) || !Number.isFinite(longer)) return UNSIZED;
    return measured(units, (mm) => {
      const framePx = mmToCssPx(mm);
      const frame = { x: 0, y: 0, width: (width / longer) * framePx, height: (height / longer) * framePx };
      const inked = grown(frame, inkPx);
      return { frame, reached: annotated ? reachedWith(step, frame, inked, style, layers) : inked };
    });
  };
  // An enlarged step is its window (Revision 2), laid out by what of it
  // prints: its content box, the boundary's pen half past it, its marks on
  // the window — only what of them lies inside it (Zach, 2026-10-07).
  // Measured at one content box, the overshoot's at its printed size, which
  // is all that changes it.
  const zoomed = view.zoom ? zoomedSource(step, assets) : null;
  if (zoomed) {
    const window = frameOf(zoomed.view.window.width, zoomed.view.window.height);
    if (!window) return UNSIZED;
    const content = zoomContentBox(zoomed.view, zoomed.silhouette, frameMm(null));
    const contentShare = Math.max(content.width, content.height);
    if (!(contentShare > 0)) return UNSIZED;
    const pen = zoomEdgePen(style, 1).width / 2;
    const touching = marksTouchingWindow(zoomed.view.window, step.annotations);
    const sizedBy = touching === step.annotations ? step : { ...step, annotations: [...touching] };
    const marked = hasDrawnAnnotations(touching);
    return measured(
      null,
      (mm) => {
        const unitPx = mmToCssPx(mm);
        const frame = { x: 0, y: 0, width: window.width * unitPx, height: window.height * unitPx };
        const paper = {
          x: content.x * unitPx,
          y: content.y * unitPx,
          width: content.width * unitPx,
          height: content.height * unitPx,
        };
        const inked = grown(paper, pen);
        const inside = marked ? intersection(reachedWith(sizedBy, frame, inked, style, layers), frame) : null;
        return { frame: paper, reached: inside ? union(inked, inside) : inked };
      },
      contentShare
    );
  }
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      if (!scene) return UNSIZED;
      const { minX, minY, maxX, maxY } = scene.bounds;
      return framed(unitsAcross(source, step), maxX - minX, maxY - minY, inkPt(diagramScenePaintStyle(style, source.pattern)) / PT_PER_CSS_PX);
    }
    case 'asset': {
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      return framed(unitsAcross(source, step), posed.widthPx, posed.heightPx);
    }
    case 'step-diagram': {
      // Its letters, its marks, its lines' ink past its sheet and its annotations together, measured against its sheet.
      const ink = inkPt(stepDiagramPaintStyle(style)) / PT_PER_CSS_PX;
      return measured(unitsAcross(source, step), (mm) => {
        const { drawing, sheet } = stepDiagramBoxes(source.picture, style, mm);
        if (!(longerOf(sheet) > 0)) return null;
        const inked = union(drawing, grown(sheet, ink));
        return { frame: sheet, reached: annotated ? reachedWith(step, sheet, inked, style, layers) : inked };
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
  whole: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  cell: Pick<LayoutCell, 'pictureMm' | 'mmPerUnit' | 'frameMm'> & Partial<Pick<LayoutCell, 'drawMm'>>,
  idPrefix: string,
  text: PictureText
): CellPicture | null {
  // An enlarged step's marks far off its window are neither drawn nor measured.
  const step = stepAsDrawn(whole);
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  // A flat fold's layers, in the marks' units: a mark behind a flap is drawn dotted under it (15e).
  const layers = hasDrawnAnnotations(step.annotations) ? viewGeometry(viewOfStep(step), assets, style).layers : null;
  // A References picture's sheet: a label's halo is filled with the face it stands on (17b).
  const textPaper = markPaper(step, assets);
  // An enlarged step draws its window (Revision 2), a close-up's inside included.
  const zoomed = zoomedSource(step, assets);
  const drawPicture = (inner: Rect, mmPerUnit: number | null, framePt: number | null) =>
    zoomed ? drawZoomed(zoomed, step, style, inner, framePt, text) : draw(source, step, style, inner, mmPerUnit, framePt, text);
  const area = cell.drawMm ?? { x: cell.pictureMm.x, y: cell.pictureMm.y, w: cell.pictureMm.size, h: cell.pictureMm.size };
  const box: Rect = { x: area.x * PT_PER_MM, y: area.y * PT_PER_MM, width: area.w * PT_PER_MM, height: area.h * PT_PER_MM };
  // An enlarged step keeps in its room what lies inside its window, as it was measured: its marks past it overflow.
  const touching = zoomed ? marksTouchingWindow(zoomed.view.window, step.annotations) : step.annotations;
  /** The picture drawn into `inner`, `k` of its room, and its annotations on its frame. */
  const place = (inner: Rect, k = 1) => {
    // A scale the layout found shrinks with the room it is drawn into.
    const frame = cell.frameMm === null ? null : cell.frameMm * PT_PER_MM * k;
    const mmPerUnit = cell.mmPerUnit === null ? null : cell.mmPerUnit * k;
    const drawn = drawPicture(inner, mmPerUnit, frame);
    if (!drawn) return null;
    const framePx = longerOf(drawn.framePt) / PT_PER_CSS_PX;
    const marks = paintAnnotations(step.annotations, drawn.framePt, framePx, style, layers, { paper: textPaper });
    if (!marks) return { drawn, marks, reached: drawn.boundsPt };
    if (!zoomed) return { drawn, marks, reached: union(drawn.boundsPt, marks.bounds) };
    const counted =
      touching === step.annotations ? marks : paintAnnotations(touching, drawn.framePt, framePx, style, layers, { paper: textPaper });
    const inside = counted ? intersection(counted.bounds, drawn.framePt) : null;
    return { drawn, marks, reached: inside ? union(drawn.boundsPt, inside) : drawn.boundsPt };
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
  const paper = drawn.paperPt ?? drawn.framePt;
  const dx = settle(reached.x, reached.width, box.x, box.width, paper.x, paper.width);
  const dy = settle(reached.y, reached.height, box.y, box.height, paper.y, paper.height);
  const shift = (markup: string) => (dx === 0 && dy === 0 ? markup : `<g transform="translate(${num(dx)} ${num(dy)})">${markup}</g>`);
  const framePt = { ...drawn.framePt, x: drawn.framePt.x + dx, y: drawn.framePt.y + dy };
  if (!placed.marks) {
    const { fitted: _fitted, paperPt: _paper, ...plain } = drawn;
    return {
      ...plain,
      markup: prefixIds(shift(plain.markup), idPrefix),
      boundsPt: { ...plain.boundsPt, x: plain.boundsPt.x + dx, y: plain.boundsPt.y + dy },
      framePt,
    };
  }
  // The marks drawn where the picture settled, as the page prints them: a
  // label set as an upload's text is, its Han in the diagram's style, and
  // each close-up's inside painted (15f) — the picture drawn again into it,
  // `scale` times larger, its own text counted with the rest.
  const usage = new Map(drawn.text.map(({ face, characters }) => [face, characters]));
  const count = (face: string, characters: string) => usage.set(face, (usage.get(face) ?? '') + characters);
  const closeUpPicture: CloseUpPicture = (scale, frame, prefix) => {
    const inside = drawPicture(frame, null, scale * longerOf(drawn.framePt));
    if (!inside) return null;
    for (const { face, characters } of inside.text) count(face, characters);
    // Drawn centred in the frame's box: moved so its frame is the close-up's,
    // where a References step's letters reach past one side of its sheet.
    const [x, y] = [frame.x - inside.framePt.x, frame.y - inside.framePt.y];
    const inPlace = Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9;
    return prefixIds(inPlace ? inside.markup : `<g transform="translate(${num(x)} ${num(y)})">${inside.markup}</g>`, prefix);
  };
  const setText = (markup: string) => setUploadText(markup, text.hanStyle, text.runs, count);
  const framePx = longerOf(drawn.framePt) / PT_PER_CSS_PX;
  const marks = paintAnnotations(step.annotations, drawn.framePt, framePx, style, layers, { closeUpPicture, setText, paper: textPaper });
  return {
    markup: prefixIds(shift(`${drawn.markup}\n${marks?.markup ?? ''}`), idPrefix),
    boundsPt: { ...reached, x: reached.x + dx, y: reached.y + dy },
    framePt,
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

/**
 * How far a picture's lines' ink reaches past their geometry when painted in
 * `paint`, in pt: half its widest pen, or a seam's, as the painter's own page
 * leaves it (`pageMarginPt`) — an outline is stroked on its line, and a
 * crease's round cap at the paper's edge reaches past it.
 */
function inkPt(paint: PaperStyle): number {
  return Math.max(widestPenPt(paint), SEAM_STROKE_WIDTH_PT) / 2;
}

/** `rect` grown by `by` on every side. */
function grown(rect: Rect, by: number): Rect {
  return { x: rect.x - by, y: rect.y - by, width: rect.width + 2 * by, height: rect.height + 2 * by };
}

/** What two rects share, or null where they do not meet. */
function intersection(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  return right >= x && bottom >= y ? { x, y, width: right - x, height: bottom - y } : null;
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
  text: PictureText,
  cull: PictureBox | null = null
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
      const placed = placedScene(sceneCulledTo(scene, cull), diagramScenePaintStyle(style, source.pattern), box, ptPerPx);
      // A scene's frame is its bounds; its ink reaches past them.
      return {
        ...placed,
        boundsPt: grown(placed.boundsPt, inkPt(diagramScenePaintStyle(style, source.pattern))),
        framePt: placed.boundsPt,
        text: [],
        fitted: !(mmPerUnit !== null && scale) && framePt === null,
      };
    }
    case 'step-diagram': {
      const units = sentSheetUnits(step);
      const boxMm = Math.min(box.width, box.height) / PT_PER_MM;
      const sheetMm =
        mmPerUnit !== null && units !== null
          ? units * mmPerUnit
          : framePt !== null
            ? framePt / PT_PER_MM
            : fittedSheetMm(source.picture, style, boxMm);
      const { model, mirrored } = source.picture;
      const scene = stepDiagramScene(model, mirrored, style, sheetMm);
      // Built at its size on the page: one scene px is one CSS px of it.
      const placed = placedScene(scene, stepDiagramPaintStyle(style), box, PT_PER_CSS_PX);
      const letters = labelsOf(source.picture);
      // Its frame is its sheet, wherever its letters reach; its lines' ink reaches past it.
      const sheet = stepDiagramSheetBox(model, mirrored, sheetMm);
      const sheetPt = {
        x: placed.boundsPt.x + (sheet.x - scene.bounds.minX) * PT_PER_CSS_PX,
        y: placed.boundsPt.y + (sheet.y - scene.bounds.minY) * PT_PER_CSS_PX,
        width: sheet.width * PT_PER_CSS_PX,
        height: sheet.height * PT_PER_CSS_PX,
      };
      return {
        markup: placed.markup.replaceAll(`font-family="${INLINE_LABEL_FONT}"`, `font-family="'Noto Sans', sans-serif"`),
        boundsPt: union(placed.boundsPt, grown(sheetPt, inkPt(stepDiagramPaintStyle(style)))),
        fitted: !(mmPerUnit !== null && units !== null) && framePt === null,
        framePt: sheetPt,
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

/**
 * An enlarged step's window drawn into `box` (Revision 2): what of it prints
 * — its content box, all of a whole frame's window or a cut frame's paper and
 * boundary pieces (`zoomContentBox`) — centred in the box, the window's
 * longer side `framePt` across when given, else what fits the content to the
 * box; the step's own picture drawn under it larger by its own painter —
 * only what lies near the window — and moved so its frame is where the window
 * puts it, clipped to the frame, the boundary over it. Its frame is the
 * window; what it draws, and keeps in its room, its content.
 */
function drawZoomed(
  zoomed: ZoomedSource,
  step: DiagramStep,
  style: DiagramStyle,
  box: Rect,
  framePt: number | null,
  text: PictureText
): DrawnPicture | null {
  const { view, source, pictureFrame, silhouette } = zoomed;
  const shape = frameOf(view.window.width, view.window.height);
  if (!shape) return null;
  /** The content at a window `longer` pt across, in the window's units. */
  const contentAt = (longer: number) => zoomContentBox(view, silhouette, longer / PT_PER_MM);
  let longer = framePt ?? fitScale(box, shape.width, shape.height, null);
  if (framePt === null) {
    // Fitted by its content, which a cut frame's overshoot, at its printed size, makes: twice is near enough.
    for (let pass = 0; pass < 2; pass += 1) {
      const content = contentAt(longer);
      longer = fitScale(box, content.width, content.height, null);
    }
  }
  if (!(longer > 0) || !Number.isFinite(longer)) return null;
  const content = contentAt(longer);
  // The content's middle on the box's: the window wherever that puts it.
  const placed = windowBox(
    shape,
    longer,
    box.x + box.width / 2 - (content.x + content.width / 2) * longer,
    box.y + box.height / 2 - (content.y + content.height / 2) * longer
  );
  const placement = zoomPlacement(view, pictureFrame, placed);
  const printedMm = longer / PT_PER_MM;
  const target = placement.pictureFrame;
  const inside = draw(source, step, style, target, null, longerOf(target), text, zoomCull(view, printedMm));
  // Drawn centred in its box: moved so its frame is where the window puts it,
  // where a References step's letters reach past one side of its sheet.
  const [dx, dy] = inside ? [target.x - inside.framePt.x, target.y - inside.framePt.y] : [0, 0];
  const inPlace = Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9;
  const picture = inside && (inPlace ? inside.markup : `<g transform="translate(${num(dx)} ${num(dy)})">${inside.markup}</g>`);
  const painted = paintZoomed(view, placement, picture, {
    style,
    silhouette,
    unitsPerPx: PT_PER_CSS_PX,
    printedMm,
    idPrefix: '',
  });
  const paperPt = {
    x: placed.x + content.x * longer,
    y: placed.y + content.y * longer,
    width: content.width * longer,
    height: content.height * longer,
  };
  // What it draws: its content, and the boundary's pen half past it.
  const half = (painted.bounds.width - placed.width) / 2;
  return {
    markup: painted.markup,
    boundsPt: grown(paperPt, half),
    framePt: placed,
    paperPt,
    fitted: framePt === null,
    text: inside?.text ?? [],
  };
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

function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
