/**
 * Step pictures on a page (D10): how big each one is in pattern units, for the
 * shared paper scale, and each drawn into its cell's box at its cell's scale.
 *
 * - A captured scene and a capture kept as a bitmap carry their paper scale
 *   (picture px per pattern unit). A References step's sheet is its region,
 *   whose size in pattern units is where it came from.
 * - An upload, a fold kept as a fixed picture and a 3D capture have no paper
 *   scale: they are fitted to their box.
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
import { diagramStyleKey, diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import { paintSource, poseTransform, stepPictureSource, type StepPictureSource } from '../pictures/paintDiagramStep';
import { stepDiagramPaintStyle, stepDiagramScene, stepDiagramSheetBox } from '../pictures/paintStepDiagram';
import { hasDrawnAnnotations, paintAnnotations } from '../annotate/paintAnnotations';
import { annotationDrawing, annotationReach } from '../annotate/annotationPrimitives';
import { frameOf } from '../annotate/annotationModel';
import { storedScene } from '../pictures/pictureFrame';
import { fontFaceId } from '../fonts/diagramFontFaces';
import { setUploadText } from '../upload/uploadText';
import type { LayoutCell, LayoutStep, TextSetter } from './diagramPageLayout';

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

/** A picture drawn, where its frame (D8) landed, in pt, and whether it was fitted to its box rather than scaled. */
interface DrawnPicture extends CellPicture {
  framePt: { x: number; y: number; width: number; height: number };
  fitted: boolean;
}

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
 * How far a step's annotations reach past its frame, as the longer side of
 * the picture and its annotations together per the frame's: 1 when they keep
 * to the picture. `picture` and `frame` are in CSS px at the size the frame
 * prints, which is the size the annotations are drawn at — their marks keep
 * their pt size, so the share depends on it, as a References step's letters do.
 */
function annotationReachRatio(step: DiagramStep, frame: Rect, picture: Rect, style: DiagramStyle): number {
  const pictureFrame = frameOf(frame.width, frame.height);
  const framePx = longerOf(frame);
  if (!pictureFrame || !(framePx > 0)) return 1;
  const reach = annotationReach(annotationDrawing(step.annotations, pictureFrame, framePx, style));
  const reached = union(picture, { ...reach, x: frame.x + reach.x, y: frame.y + reach.y });
  return longerOf(reached) / framePx;
}

function longerOf(rect: Rect): number {
  return Math.max(rect.width, rect.height);
}

/** A References step's drawing, and its sheet, in scene px with the sheet `sheetMm` across. */
function stepDiagramBoxes(picture: DiagramStepDiagramPicture, style: DiagramStyle, sheetMm: number) {
  const { bounds } = stepDiagramScene(picture.model, picture.mirrored, style, sheetMm);
  return {
    drawing: { x: bounds.minX, y: bounds.minY, width: bounds.maxX - bounds.minX, height: bounds.maxY - bounds.minY },
    sheet: stepDiagramSheetBox(picture.model, picture.mirrored, sheetMm),
  };
}

/**
 * What the layout needs of a step's picture: its size in pattern units, or
 * only a fit, room left for what its annotations reach past it. `mmPerUnit`
 * is the scale a first layout found, for marks whose reach depends on it — a
 * References step's letters, any step's annotations; without one they are
 * measured at a card's size.
 */
export function layoutPicture(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  mmPerUnit: number | null = null
): LayoutStep['picture'] {
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  const paper = (units: number | null): LayoutStep['picture'] =>
    units !== null && units > 0 && Number.isFinite(units) ? { kind: 'paper', extentUnits: units } : { kind: 'fit' };
  const annotated = hasDrawnAnnotations(step.annotations);
  /** A frame `width` × `height`, its longer side `units` pattern units: grown by what its annotations reach. */
  const withReach = (units: number, width: number, height: number): number => {
    if (!annotated || !(units > 0)) return units;
    const framePx = mmToCssPx(mmPerUnit !== null ? units * mmPerUnit : MEASURE_SHEET_MM);
    const longer = Math.max(width, height);
    const frame = { x: 0, y: 0, width: (width / longer) * framePx, height: (height / longer) * framePx };
    return units * annotationReachRatio(step, frame, frame, style);
  };
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      const scale = source.picture.paperScale;
      if (!scene || !scale) return { kind: 'fit' };
      const { minX, minY, maxX, maxY } = scene.bounds;
      return paper(withReach(longerSide(scene.bounds) / scale, maxX - minX, maxY - minY));
    }
    case 'asset': {
      const scale = step.picture?.kind === 'asset' ? step.picture.paperScale : null;
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      if (!scale) return { kind: 'fit' };
      return paper(withReach(Math.max(posed.widthPx, posed.heightPx) / scale, posed.widthPx, posed.heightPx));
    }
    case 'step-diagram': {
      const units = sentSheetUnits(step);
      if (units === null) return { kind: 'fit' };
      const sheetMm = mmPerUnit !== null ? units * mmPerUnit : MEASURE_SHEET_MM;
      if (!annotated) return paper(units * drawingRatio(source.picture, style, sheetMm));
      // Its letters and its annotations together, measured against its sheet.
      const { drawing, sheet } = stepDiagramBoxes(source.picture, style, sheetMm);
      return paper(units * Math.max(annotationReachRatio(step, sheet, drawing, style), 1));
    }
    case 'fixed':
      return { kind: 'fit' };
  }
}

/**
 * A step's picture drawn into its cell's box: at the cell's mm per pattern
 * unit when it has one, else fitted; centred either way. Null for a step with
 * nothing to draw.
 */
export function cellPicture(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  cell: Pick<LayoutCell, 'pictureMm' | 'mmPerUnit'>,
  idPrefix: string,
  text: PictureText
): CellPicture | null {
  const source = stepPictureSource(step, assets);
  if (!source) return null;
  const box = {
    x: cell.pictureMm.x * PT_PER_MM,
    y: cell.pictureMm.y * PT_PER_MM,
    size: cell.pictureMm.size * PT_PER_MM,
  };
  /** The picture drawn into `inner`, and its annotations on its frame. */
  const place = (inner: Box) => {
    const drawn = draw(source, step, style, inner, cell.mmPerUnit, text);
    if (!drawn) return null;
    const marks = paintAnnotations(step.annotations, drawn.framePt, longerOf(drawn.framePt) / PT_PER_CSS_PX, style);
    return { drawn, marks, reached: marks ? union(drawn.boundsPt, marks.bounds) : drawn.boundsPt };
  };
  let placed = place(box);
  if (!placed) return null;
  const { framePt: _frame, fitted: _fitted, ...plain } = placed.drawn;
  if (!placed.marks) return { ...plain, markup: prefixIds(plain.markup, idPrefix) };
  // Annotations that reach past the picture get room in the box: a fitted
  // picture shrinks so the two together fit, and the two together are
  // centred. A picture at the page's shared scale keeps it: the layout left
  // it room. Their reach grows with the picture's box at nearly a fixed rate
  // — their marks keep their pt size, an arrowhead short of its chord — so a
  // secant on the picture's size settles in a step or two.
  const inner = (size: number): Box => ({ x: box.x + (box.size - size) / 2, y: box.y + (box.size - size) / 2, size });
  const over = (reached: Rect) => longerOf(reached) > box.size * (1 + 1e-4);
  if (placed.drawn.fitted && over(placed.reached)) {
    let previous = { size: box.size, reach: longerOf(placed.reached) };
    let size = box.size * (box.size / previous.reach);
    for (let pass = 0; pass < 6; pass += 1) {
      const next = place(inner(size));
      if (!next) break;
      placed = next;
      const reach = longerOf(next.reached);
      if (!over(next.reached)) break;
      const rate = (previous.reach - reach) / (previous.size - size);
      previous = { size, reach };
      size = rate > 0 ? size - (reach - box.size) / rate : size * (box.size / reach);
      if (!(size > 0)) break;
    }
  }
  const { drawn, reached } = placed;
  const within =
    reached.x >= box.x - 1e-6 &&
    reached.y >= box.y - 1e-6 &&
    reached.x + reached.width <= box.x + box.size + 1e-6 &&
    reached.y + reached.height <= box.y + box.size + 1e-6;
  const dx = within ? 0 : box.x + box.size / 2 - (reached.x + reached.width / 2);
  const dy = within ? 0 : box.y + box.size / 2 - (reached.y + reached.height / 2);
  // A label is set as an upload's text is, its Han in the diagram's style.
  const usage = new Map(drawn.text.map(({ face, characters }) => [face, characters]));
  const markup = setUploadText(placed.marks!.markup, text.hanStyle, text.runs, (face, characters) =>
    usage.set(face, (usage.get(face) ?? '') + characters)
  );
  const both = `${drawn.markup}\n${markup}`;
  return {
    markup: prefixIds(dx === 0 && dy === 0 ? both : `<g transform="translate(${num(dx)} ${num(dy)})">${both}</g>`, idPrefix),
    boundsPt: { ...reached, x: reached.x + dx, y: reached.y + dy },
    text: [...usage].map(([face, characters]) => ({ face, characters })),
  };
}

type Rect = { x: number; y: number; width: number; height: number };

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

type Box = { x: number; y: number; size: number };

function draw(
  source: StepPictureSource,
  step: DiagramStep,
  style: DiagramStyle,
  box: Box,
  mmPerUnit: number | null,
  text: PictureText
): DrawnPicture | null {
  switch (source.kind) {
    case 'scene': {
      const scene = storedScene(source.picture);
      if (!scene) return null;
      const scale = source.picture.paperScale;
      const span = longerSide(scene.bounds);
      const ptPerPx =
        mmPerUnit !== null && scale ? (mmPerUnit * PT_PER_MM) / scale : span > 0 ? box.size / span : PT_PER_CSS_PX;
      const placed = placedScene(scene, diagramSurfaceStyle(style), box, ptPerPx);
      // A scene's frame is its bounds.
      return { ...placed, framePt: placed.boundsPt, text: [], fitted: !(mmPerUnit !== null && scale) };
    }
    case 'step-diagram': {
      const units = sentSheetUnits(step);
      const boxMm = box.size / PT_PER_MM;
      // Fitted: the sheet's size for a card first, then again at the size that gives.
      const fitted = () => {
        const first = boxMm / drawingRatio(source.picture, style, MEASURE_SHEET_MM);
        return boxMm / drawingRatio(source.picture, style, first);
      };
      const sheetMm = mmPerUnit !== null && units !== null ? units * mmPerUnit : fitted();
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
        fitted: !(mmPerUnit !== null && units !== null),
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
          : box.size / Math.max(painted.widthPx, painted.heightPx);
      const width = painted.widthPx * ptPerPx;
      const height = painted.heightPx * ptPerPx;
      const x = box.x + (box.size - width) / 2;
      const y = box.y + (box.size - height) / 2;
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
        fitted: !(mmPerUnit !== null && scale),
        text: [...usage].map(([face, characters]) => ({ face, characters })),
      };
    }
  }
}

/** A scene's elements at `ptPerPx`, its drawing centred in the box, and the box it fills. */
function placedScene(scene: PaperScene, style: PaperStyle, box: Box, ptPerPx: number) {
  const { bounds } = scene;
  const width = (bounds.maxX - bounds.minX) * ptPerPx;
  const height = (bounds.maxY - bounds.minY) * ptPerPx;
  const offsetX = box.x + (box.size - width) / 2;
  const offsetY = box.y + (box.size - height) / 2;
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
