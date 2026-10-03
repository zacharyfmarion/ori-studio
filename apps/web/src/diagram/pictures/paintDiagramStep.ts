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
 * - a fixed picture, our own SVG for a fold with no layer order, as stored.
 *
 * Pure: no DOM, no store.
 */
import { DEFAULT_PAPER_SIZE_MM, type PaperPage, type PaperSizeMeasure } from '../../lib/paper/paperPage';
import { PT_PER_CSS_PX, paperSceneToSvg } from '../../lib/paper/paperSvg';
import { readPaperScene } from '../../lib/paper/paperSceneValidate';
import {
  isLockedStep,
  type DiagramAsset,
  type DiagramFixedPicture,
  type DiagramScenePicture,
  type DiagramStep,
  type DiagramStyle,
  type KnownDiagramAsset,
  type QuarterTurns,
} from '../document/diagramDocument';
import { SVG_NS } from '../upload/svgSanitize';
import { diagramSurfaceStyle } from './diagramPaperStyle';

export interface PaintedPicture {
  svg: string;
  widthPx: number;
  heightPx: number;
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
  if (asset.kind === 'svg' && posed.transform === '') {
    return { svg: asset.svg, widthPx: asset.widthPx, heightPx: asset.heightPx };
  }
  const body = assetMarkup(asset);
  const inner = posed.transform === '' ? body : `<g transform="${posed.transform}">${body}</g>`;
  const svg =
    `<svg xmlns="${SVG_NS}" width="${num(posed.widthPx)}" height="${num(posed.heightPx)}" ` +
    `viewBox="0 0 ${num(posed.widthPx)} ${num(posed.heightPx)}">${inner}</svg>`;
  return { svg, widthPx: posed.widthPx, heightPx: posed.heightPx };
}

/**
 * What a step's picture is drawn from, or `null` when it has none this build
 * can draw: an empty step, a newer build's, or one whose asset is missing.
 */
export type StepPictureSource =
  | { kind: 'asset'; asset: KnownDiagramAsset; pose: PicturePose }
  | { kind: 'scene'; picture: DiagramScenePicture; measure: PaperSizeMeasure }
  | { kind: 'fixed'; picture: DiagramFixedPicture };

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
      return {
        kind: 'scene',
        picture,
        // A crease pattern shows its sheet; a folded model's sheet is nowhere in it.
        measure: source?.kind === 'cp' && source.render.mode !== 'crease-pattern' ? 'figure' : 'sheet',
      };
    case 'fixed':
      return { kind: 'fixed', picture };
  }
}

/**
 * The page a step's scene is painted on: the size every picture opens at, no
 * page colour, and nothing buried — a capture has already dropped it.
 * `paddingMm` is the caller's: a card frames the picture itself, a file wants
 * the room an editor's export leaves.
 */
export function stepScenePage(paddingMm: number): PaperPage {
  return { sheet: { mm: DEFAULT_PAPER_SIZE_MM }, paddingMm, background: null, keepHiddenFaces: false };
}

/** The margin a card or the step detail gives a scene: the pens' own room, near enough. */
export const STEP_CARD_PADDING_MM = 1;

/**
 * A captured scene in the diagram's pens. `null` for a scene that does not
 * read: the file's validator has already checked it, so this is a guard, not
 * a path.
 */
export function paintScene(
  picture: DiagramScenePicture,
  measure: PaperSizeMeasure,
  style: DiagramStyle,
  paddingMm: number = STEP_CARD_PADDING_MM
): PaintedPicture | null {
  let raw: unknown;
  try {
    raw = JSON.parse(picture.sceneJson);
  } catch {
    return null;
  }
  const scene = readPaperScene(raw);
  if (!scene) return null;
  const painted = paperSceneToSvg(scene, diagramSurfaceStyle(style), stepScenePage(paddingMm), measure);
  return {
    svg: painted.svg,
    widthPx: painted.widthPt / PT_PER_CSS_PX,
    heightPx: painted.heightPt / PT_PER_CSS_PX,
  };
}

/** A source's picture as a standalone SVG document. */
export function paintSource(
  source: StepPictureSource,
  style: DiagramStyle,
  paddingMm?: number
): PaintedPicture | null {
  switch (source.kind) {
    case 'asset':
      return paintAsset(source.asset, source.pose);
    case 'scene':
      return paintScene(source.picture, source.measure, style, paddingMm);
    case 'fixed':
      return { svg: source.picture.svg, widthPx: source.picture.widthPx, heightPx: source.picture.heightPx };
  }
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
