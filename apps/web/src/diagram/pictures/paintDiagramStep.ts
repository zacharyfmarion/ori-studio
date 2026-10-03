/**
 * A step's picture as SVG markup (implementation-plans/diagram-workspace.md,
 * Paint contract): what a card shows, what Export picture writes, and — from
 * Phase 5 — what a page cell is composed from.
 *
 * Phase 2 paints uploads: the asset, in the source's pose. The pose is applied
 * here, around the shared asset, which is never rewritten (D5). An SVG asset
 * is nested as itself — its root already carries its size and viewBox, and its
 * ids are prefixed with its own id — so it stays vector wherever it is drawn.
 *
 * Pure: no DOM, no store.
 */
import {
  isLockedStep,
  type DiagramAsset,
  type DiagramStep,
  type KnownDiagramAsset,
  type QuarterTurns,
} from '../document/diagramDocument';
import { SVG_NS } from '../upload/svgSanitize';

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
export function stepPictureSource(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): { asset: KnownDiagramAsset; pose: PicturePose } | null {
  if (isLockedStep(step) || step.picture?.kind !== 'asset') return null;
  const asset = Object.hasOwn(assets, step.picture.assetId) ? assets[step.picture.assetId] : undefined;
  if (!asset || 'unknown' in asset) return null;
  const pose = step.source?.kind === 'upload' ? step.source : UPRIGHT;
  return { asset, pose: { rotationQuarterTurns: pose.rotationQuarterTurns, mirrored: pose.mirrored } };
}

/** A step's picture alone — no number, instruction or annotations — or `null`. */
export function paintStepPicture(
  step: DiagramStep,
  assets: Readonly<Record<string, DiagramAsset>>
): PaintedPicture | null {
  const source = stepPictureSource(step, assets);
  return source ? paintAsset(source.asset, source.pose) : null;
}

/** A number as SVG writes it: short, and never `1e-7`. */
function num(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 1000) / 1000);
}
