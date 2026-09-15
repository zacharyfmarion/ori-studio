import type { CpDetectQuad } from '../../engine/cpDetectTypes';
import type { CpImageUpdate } from './cpImage';

/** A box in crease-pattern model units, as `lastOristudioCpImportAddPlacement` reports one. */
export interface ModelBox {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * How far, as a share of the quad's extent, an edge may lean before the quad
 * stops counting as axis-aligned. One percent is about half a degree on a
 * square: below it an affine box lines the creases up to within a pixel or
 * two at 1024 px; above it the image has to be replaced by the rectified
 * frame, because no scale-and-move of the original can match a skew.
 */
export const AXIS_ALIGNED_TOLERANCE = 0.01;

/** The opacity and lock every detection underlay gets. */
export const DETECT_UNDERLAY_OPACITY = 0.5;

function extent(quad: CpDetectQuad): { minX: number; minY: number; maxX: number; maxY: number } {
  const xs = [quad.top_left.x, quad.top_right.x, quad.bottom_right.x, quad.bottom_left.x];
  const ys = [quad.top_left.y, quad.top_right.y, quad.bottom_right.y, quad.bottom_left.y];
  return {
    minX: Math.min(...xs),
    minY: Math.min(...ys),
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}

/**
 * Whether the paper's outline in the source is a rectangle with its sides on
 * the pixel axes: the common case for a render, a screenshot or a scan, and
 * the case an original image can be registered by moving and scaling it.
 */
export function quadIsAxisAligned(quad: CpDetectQuad, tolerance = AXIS_ALIGNED_TOLERANCE): boolean {
  const box = extent(quad);
  const size = Math.max(box.maxX - box.minX, box.maxY - box.minY);
  if (!(size > 0)) return false;
  const limit = size * tolerance;
  const horizontal = (a: { y: number }, b: { y: number }) => Math.abs(a.y - b.y) <= limit;
  const vertical = (a: { x: number }, b: { x: number }) => Math.abs(a.x - b.x) <= limit;
  return (
    horizontal(quad.top_left, quad.top_right) &&
    horizontal(quad.bottom_left, quad.bottom_right) &&
    vertical(quad.top_left, quad.bottom_left) &&
    vertical(quad.top_right, quad.bottom_right)
  );
}

/**
 * Where the original image has to sit so that the paper's outline in it
 * coincides with the paper the pattern was imported onto.
 *
 * `source` is the image as the rectifier saw it — the annotation's cropped
 * pixels at the rectifier's working size — and `quad` the paper's corners in
 * those pixels. The annotation displays exactly that cropped region, so a
 * source pixel maps to the box by proportion, and matching the quad's extent
 * to the paper fixes the box's scale and position. Horizontal and vertical
 * scales are solved separately so the corners land exactly even when the
 * outline is a hair off square; the stretch that costs is well under the
 * tolerance the quad passed.
 *
 * Rotation is reset: the pattern is in the image's own pixel frame, so the
 * image must be axis-aligned in model space for the creases to lie on it,
 * whatever way the view happened to be turned when it was dropped.
 */
export function registerImageOntoPaper(args: {
  source: { width: number; height: number };
  quad: CpDetectQuad;
  paper: ModelBox;
}): CpImageUpdate | null {
  const box = extent(args.quad);
  const quadWidth = box.maxX - box.minX;
  const quadHeight = box.maxY - box.minY;
  if (!(quadWidth > 0) || !(quadHeight > 0) || !(args.source.width > 0) || !(args.source.height > 0)) {
    return null;
  }
  const kx = (args.paper.maxX - args.paper.minX) / quadWidth;
  const ky = (args.paper.maxY - args.paper.minY) / quadHeight;
  if (!(kx > 0) || !(ky > 0)) return null;
  const width = args.source.width * kx;
  const height = args.source.height * ky;
  const left = args.paper.minX - box.minX * kx;
  const top = args.paper.minY - box.minY * ky;
  return {
    center: { x: left + width / 2, y: top + height / 2 },
    width,
    height,
    rotation: 0,
  };
}
