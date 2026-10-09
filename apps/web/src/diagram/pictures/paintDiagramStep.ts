/**
 * A step's picture as SVG markup (implementation-plans/diagram-workspace.md,
 * Paint contract): what a card shows, what Export picture writes, and — from
 * Phase 5 — what a page cell is composed from.
 *
 * Three kinds of picture are painted:
 * - an asset (an upload, or a capture too detailed to keep as vector), in the
 *   upload's pose. The pose is applied here, around the shared asset, which is
 *   never rewritten (D5). An SVG asset is nested as itself — its root already
 *   carries its size and viewBox, and its ids are prefixed with its own id — so
 *   it stays vector wherever it is drawn;
 * - a captured scene, in the diagram's pens (D9): a crease pattern measured by
 *   its sheet, a folded model by the figure itself;
 * - a fixed picture, our own SVG for a fold with no layer order, as stored;
 * - a References step, its card's diagram built at the size it is painted at
 *   (`paintStepDiagram.ts`, D6).
 *
 * Pure: no DOM, no store.
 */
import { DEFAULT_PAPER_SIZE_MM, type PaperPage, type PaperSizeMeasure } from '../../lib/paper/paperPage';
import type { PaperScene } from '../../lib/paper/paperScene';
import { PT_PER_CSS_PX, pageMarginPt, pagePtPerPx, paperSceneToSvg } from '../../lib/paper/paperSvg';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import {
  isLockedStep,
  type DiagramAsset,
  type DiagramFixedPicture,
  type DiagramScenePicture,
  type DiagramStep,
  type DiagramStepDiagramPicture,
  type DiagramStyle,
  type KnownDiagramAsset,
  type QuarterTurns,
} from '../document/diagramDocument';
import { SVG_NS } from '../upload/svgSanitize';
import { diagramScenePaintStyle, sceneDrawnOf, type DiagramSceneDrawn } from './diagramPaperStyle';
import { paintStepDiagram } from './paintStepDiagram';

/** A box in a painted picture, in its CSS px. */
export interface PictureBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PaintedPicture {
  svg: string;
  widthPx: number;
  heightPx: number;
  /** The picture's frame (D8) on it: where its annotations are measured from. */
  frame: PictureBox;
}

export interface PicturePose {
  rotationQuarterTurns: QuarterTurns;
  mirrored: boolean;
}

export const UPRIGHT: PicturePose = { rotationQuarterTurns: 0, mirrored: false };

/**
 * The transform that draws a `width` × `height` box in a pose, and the posed
 * box's size. Mirrored left to right first, then turned clockwise; the result
 * sits at the origin. `''` for the upright pose.
 */
export function poseTransform(
  width: number,
  height: number,
  pose: PicturePose
): { transform: string; widthPx: number; heightPx: number } {
  const parts: string[] = [];
  switch (pose.rotationQuarterTurns) {
    case 1:
      parts.push(`translate(${num(height)} 0) rotate(90)`);
      break;
    case 2:
      parts.push(`translate(${num(width)} ${num(height)}) rotate(180)`);
      break;
    case 3:
      parts.push(`translate(0 ${num(width)}) rotate(270)`);
      break;
  }
  // Listed last, so applied first: an SVG transform list runs right to left.
  if (pose.mirrored) parts.push(`translate(${num(width)} 0) scale(-1 1)`);
  const sideways = pose.rotationQuarterTurns % 2 === 1;
  return {
    transform: parts.join(' '),
    widthPx: sideways ? height : width,
    heightPx: sideways ? width : height,
  };
}

/** An asset as markup in its own box, at the origin. */
function assetMarkup(asset: KnownDiagramAsset): string {
  if (asset.kind === 'svg') return asset.svg;
  return `<image width="${num(asset.widthPx)}" height="${num(asset.heightPx)}" preserveAspectRatio="none" href="${asset.src}"/>`;
}

/** An asset in a pose, as a standalone SVG document. The asset itself when upright. */
export function paintAsset(asset: KnownDiagramAsset, pose: PicturePose = UPRIGHT): PaintedPicture {
  const posed = poseTransform(asset.widthPx, asset.heightPx, pose);
  const frame = { x: 0, y: 0, width: posed.widthPx, height: posed.heightPx };
  if (asset.kind === 'svg' && posed.transform === '') {
    return { svg: asset.svg, widthPx: asset.widthPx, heightPx: asset.heightPx, frame };
  }
  const body = assetMarkup(asset);
  const inner = posed.transform === '' ? body : `<g transform="${posed.transform}">${body}</g>`;
  const svg =
    `<svg xmlns="${SVG_NS}" width="${num(posed.widthPx)}" height="${num(posed.heightPx)}" ` +
    `viewBox="0 0 ${num(posed.widthPx)} ${num(posed.heightPx)}">${inner}</svg>`;
  return { svg, widthPx: posed.widthPx, heightPx: posed.heightPx, frame };
}

/**
 * A captured scene, and what it draws: a crease pattern — measured by its
 * sheet, its aux lines the paper's existing creases — or a folded model or a
 * simulation, measured by the figure itself, its sheet nowhere in it, each
 * in its own pens (`diagramScenePaintStyle`).
 */
export interface SceneSource {
  kind: 'scene';
  picture: DiagramScenePicture;
  drawn: DiagramSceneDrawn;
}

/** What a scene's page size measures: a crease pattern's sheet, a folded model's figure. */
export function sceneMeasure(drawn: DiagramSceneDrawn): PaperSizeMeasure {
  return drawn === 'pattern' ? 'sheet' : 'figure';
}

/**
 * What a step's picture is drawn from, or `null` when it has none this build
 * can draw: an empty step, a newer build's, or one whose asset is missing.
 */
export type StepPictureSource =
  | { kind: 'asset'; asset: KnownDiagramAsset; pose: PicturePose }
  | SceneSource
  | { kind: 'fixed'; picture: DiagramFixedPicture }
  | { kind: 'step-diagram'; picture: DiagramStepDiagramPicture };

export function stepPictureSource(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): StepPictureSource | null {
  const { picture, source } = step;
  if (isLockedStep(step) || !picture) return null;
  switch (picture.kind) {
    case 'asset': {
      const asset = Object.hasOwn(assets, picture.assetId) ? assets[picture.assetId] : undefined;
      if (!asset || 'unknown' in asset) return null;
      // A capture kept as a bitmap is drawn as it was captured.
      const pose = source?.kind === 'upload' ? source : UPRIGHT;
      return {
        kind: 'asset',
        asset,
        pose: { rotationQuarterTurns: pose.rotationQuarterTurns, mirrored: pose.mirrored },
      };
    }
    case 'scene':
      return { kind: 'scene', picture, drawn: sceneDrawnOf(source?.kind === 'cp' ? source.render : null) };
    case 'fixed':
      return { kind: 'fixed', picture };
    case 'step-diagram':
      return { kind: 'step-diagram', picture };
  }
}

/**
 * The page a step's scene is painted on: the size every picture opens at —
 * `scale` times it for a close-up's inside (15f) — no page colour, and
 * nothing buried: a capture has already dropped it. `paddingMm` is the
 * caller's: a card frames the picture itself, a file wants the room an
 * editor's export leaves.
 */
export function stepScenePage(paddingMm: number, scale = 1): PaperPage {
  return { sheet: { mm: DEFAULT_PAPER_SIZE_MM * scale }, paddingMm, background: null, keepHiddenFaces: false };
}

/** The margin a card or the step detail gives a scene: the pens' own room, near enough. */
export const STEP_CARD_PADDING_MM = 1;

/**
 * A scene with only the items whose extent meets `cull` — a box in picture
 * units, the scene's bounds' longer side one — kept: what an enlarged step's
 * window shows of it (Revision 2), so a step that shows a corner of a model
 * does not carry the whole of it into every card and page. Its bounds and
 * sheet are kept, so whatever it is painted at, what is left lies where it
 * did. The scene itself with no box.
 */
export function sceneCulledTo(scene: PaperScene, cull: PictureBox | null | undefined): PaperScene {
  if (!cull) return scene;
  const { minX, minY, maxX, maxY } = scene.bounds;
  const longer = Math.max(maxX - minX, maxY - minY);
  if (!(longer > 0)) return scene;
  const box = {
    minX: minX + cull.x * longer,
    minY: minY + cull.y * longer,
    maxX: minX + (cull.x + cull.width) * longer,
    maxY: minY + (cull.y + cull.height) * longer,
  };
  const items = scene.items.filter((item) => {
    const extent = itemExtent(item);
    return extent.maxX >= box.minX && extent.minX <= box.maxX && extent.maxY >= box.minY && extent.minY <= box.maxY;
  });
  return items.length === scene.items.length ? scene : { ...scene, items };
}

/** What an item of a scene covers, in scene px. */
function itemExtent(item: PaperScene['items'][number]): { minX: number; minY: number; maxX: number; maxY: number } {
  if (item.kind === 'markup') return item.bounds;
  const points = item.kind === 'face' ? item.rings.flat() : [item.a, item.b];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * A captured scene in the diagram's pens, `scale` times the size every
 * picture opens at, its pens at their print weight — only what lies over
 * `cull` (picture units) when given ({@link sceneCulledTo}). `null` for a
 * scene that does not read: the file's validator has already checked it, so
 * this is a guard, not a path.
 */
export function paintScene(
  { picture, drawn }: SceneSource,
  style: DiagramStyle,
  paddingMm: number = STEP_CARD_PADDING_MM,
  scale = 1,
  cull: PictureBox | null = null
): PaintedPicture | null {
  const measure = sceneMeasure(drawn);
  let raw: unknown;
  try {
    raw = JSON.parse(picture.sceneJson);
  } catch {
    return null;
  }
  const read = readPaperScene(raw);
  if (!read) return null;
  const scene = sceneCulledTo(read, cull);
  const surface = diagramScenePaintStyle(style, drawn);
  const page = stepScenePage(paddingMm, scale);
  const painted = paperSceneToSvg(scene, surface, page, measure);
  // The frame is the scene's bounds, which the painter puts at the margin.
  const ptPerPx = pagePtPerPx(scene, page, measure);
  const marginPx = pageMarginPt(surface, page) / PT_PER_CSS_PX;
  const { bounds } = scene;
  return {
    svg: painted.svg,
    widthPx: painted.widthPt / PT_PER_CSS_PX,
    heightPx: painted.heightPt / PT_PER_CSS_PX,
    frame: {
      x: marginPx,
      y: marginPx,
      width: ((bounds.maxX - bounds.minX) * ptPerPx) / PT_PER_CSS_PX,
      height: ((bounds.maxY - bounds.minY) * ptPerPx) / PT_PER_CSS_PX,
    },
  };
}

/**
 * A source's picture as a standalone SVG document, `scale` times the size
 * every picture opens at — a close-up's inside (15f). A scene and a
 * References step are painted afresh at that size, so their lines, letters
 * and arrowheads keep their print weight; an upload and a fixed picture are
 * drawn larger whole, their own strokes with them ({@link enlargedPicture}).
 * A scene keeps only what lies over `cull` when given ({@link sceneCulledTo}).
 */
export function paintSource(
  source: StepPictureSource,
  style: DiagramStyle,
  paddingMm?: number,
  scale = 1,
  cull: PictureBox | null = null
): PaintedPicture | null {
  switch (source.kind) {
    case 'asset':
      return enlargedPicture(paintAsset(source.asset, source.pose), scale);
    case 'scene':
      return paintScene(source, style, paddingMm, scale, cull);
    case 'fixed': {
      const { svg, widthPx, heightPx } = source.picture;
      return enlargedPicture({ svg, widthPx, heightPx, frame: { x: 0, y: 0, width: widthPx, height: heightPx } }, scale);
    }
    case 'step-diagram':
      // On the page every picture opens at, as a scene is: built at its size.
      return paintStepDiagram(
        source.picture.model,
        source.picture.mirrored,
        style,
        stepScenePage(paddingMm ?? STEP_CARD_PADDING_MM, scale)
      );
  }
}

/**
 * A painted picture drawn `scale` times as large, whole — its own strokes
 * with it: how an upload, or a fold kept as a fixed picture, is drawn larger.
 * The picture itself at a scale of one.
 */
export function enlargedPicture(painted: PaintedPicture, scale: number): PaintedPicture {
  if (scale === 1) return painted;
  const { svg, widthPx, heightPx, frame } = painted;
  const inner = svg.replace(/^\s*<\?xml[^>]*\?>\s*/, '');
  return {
    svg:
      `<svg xmlns="${SVG_NS}" width="${num(widthPx * scale)}" height="${num(heightPx * scale)}" ` +
      `viewBox="0 0 ${num(widthPx)} ${num(heightPx)}">${inner}</svg>`,
    widthPx: widthPx * scale,
    heightPx: heightPx * scale,
    frame: { x: frame.x * scale, y: frame.y * scale, width: frame.width * scale, height: frame.height * scale },
  };
}

/** A step's picture alone — no number, instruction or annotations — or `null`. */
export function paintStepPicture(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>,
  style: DiagramStyle,
  paddingMm?: number
): PaintedPicture | null {
  const source = stepPictureSource(step, assets);
  return source ? paintSource(source, style, paddingMm) : null;
}

/** A number as SVG writes it: short, and never `1e-7`. */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
