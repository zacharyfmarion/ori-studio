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
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { PT_PER_CSS_PX, PT_PER_MM, paperSceneSvgBody } from '../../lib/paper/paperSvg';
import type {
  DiagramAsset,
  DiagramHanStyle,
  DiagramScenePicture,
  DiagramStep,
  DiagramStepDiagramPicture,
  DiagramStyle,
} from '../document/diagramDocument';
import { diagramStyleKey, diagramSurfaceStyle } from '../pictures/diagramPaperStyle';
import { paintSource, poseTransform, stepPictureSource, type StepPictureSource } from '../pictures/paintDiagramStep';
import { stepDiagramPaintStyle, stepDiagramScene } from '../pictures/paintStepDiagram';
import { fontFaceId } from '../fonts/diagramFontFaces';
import { setUploadText } from '../upload/uploadText';
import type { LayoutCell, LayoutStep, TextSetter } from './diagramPageLayout';

/** The size a References step's picture is measured at for its shape: any size does. */
const MEASURE_SHEET_MM = 50;

/** The family References' letters name on screen, which a page sets in its own font. */
const LABEL_FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

/** A picture drawn into its cell, and the text it sets: References' letters, an upload's text. */
export interface CellPicture {
  markup: string;
  /** What it draws, in pt: the drawing's own box, which a step's file is cropped to. */
  boundsPt: { x: number; y: number; width: number; height: number };
  /** The characters each face sets in the picture, by face id (`latin-700`). */
  text: { face: string; characters: string }[];
}

/** How a picture's own text is set: an upload's runs, its Han in the diagram's style. */
export interface PictureText {
  hanStyle: DiagramHanStyle;
  runs: TextSetter['runs'];
}

const scenes = new WeakMap<DiagramScenePicture, PaperScene | null>();

function sceneOf(picture: DiagramScenePicture): PaperScene | null {
  if (scenes.has(picture)) return scenes.get(picture)!;
  let scene: PaperScene | null;
  try {
    scene = readPaperScene(JSON.parse(picture.sceneJson));
  } catch {
    scene = null;
  }
  scenes.set(picture, scene);
  return scene;
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
 * What the layout needs of a step's picture: its size in pattern units, or
 * only a fit. `mmPerUnit` is the scale a first layout found, for a References
 * step whose marks' reach depends on it; without one it is measured at a
 * card's size.
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
  switch (source.kind) {
    case 'scene': {
      const scene = sceneOf(source.picture);
      const scale = source.picture.paperScale;
      return paper(scene && scale ? longerSide(scene.bounds) / scale : null);
    }
    case 'asset': {
      const scale = step.picture?.kind === 'asset' ? step.picture.paperScale : null;
      const posed = poseTransform(source.asset.widthPx, source.asset.heightPx, source.pose);
      return paper(scale ? Math.max(posed.widthPx, posed.heightPx) / scale : null);
    }
    case 'step-diagram': {
      const units = sentSheetUnits(step);
      if (units === null) return { kind: 'fit' };
      const sheetMm = mmPerUnit !== null ? units * mmPerUnit : MEASURE_SHEET_MM;
      return paper(units * drawingRatio(source.picture, style, sheetMm));
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
  const drawn = draw(source, step, style, box, cell.mmPerUnit, text);
  if (!drawn) return null;
  return { ...drawn, markup: prefixIds(drawn.markup, idPrefix) };
}

type Box = { x: number; y: number; size: number };

function draw(
  source: StepPictureSource,
  step: DiagramStep,
  style: DiagramStyle,
  box: Box,
  mmPerUnit: number | null,
  text: PictureText
): CellPicture | null {
  switch (source.kind) {
    case 'scene': {
      const scene = sceneOf(source.picture);
      if (!scene) return null;
      const scale = source.picture.paperScale;
      const span = longerSide(scene.bounds);
      const ptPerPx =
        mmPerUnit !== null && scale ? (mmPerUnit * PT_PER_MM) / scale : span > 0 ? box.size / span : PT_PER_CSS_PX;
      return { ...placedScene(scene, diagramSurfaceStyle(style), box, ptPerPx), text: [] };
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
      const scene = stepDiagramScene(source.picture.model, source.picture.mirrored, style, sheetMm);
      // Built at its size on the page: one scene px is one CSS px of it.
      const placed = placedScene(scene, stepDiagramPaintStyle(style), box, PT_PER_CSS_PX);
      const letters = labelsOf(source.picture);
      return {
        markup: placed.markup.replaceAll(`font-family="${LABEL_FONT}"`, `font-family="'Noto Sans', sans-serif"`),
        boundsPt: placed.boundsPt,
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
