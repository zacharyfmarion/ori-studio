import type { UserBounds } from './renderer/camera';
import type { ModelPoint } from './renderer/types';
import type { CpImage } from './images/cpImage';
import { imageCornersModel } from './images/cpImagePlacement';
import { boxCornersModel } from './annotations/annotationTransform';

/**
 * A placed box the WebGL renderer does not draw itself — a text annotation or an
 * inline simulation window. Both live on their own DOM layers.
 */
export interface CpOverlayBox {
  center: ModelPoint;
  width: number;
  height: number;
  rotation: number;
  hidden: boolean;
}

export interface CpContentBoundsInput {
  lineSegments: readonly { a: ModelPoint; b: ModelPoint }[];
  images?: readonly CpImage[];
  overlayBoxes?: readonly CpOverlayBox[];
  /** Model space to SVG user space, since the camera frames in user coords. */
  modelToSvg: (point: ModelPoint) => { x: number; y: number };
}

/**
 * What the camera frames against: everything placed on the canvas, in SVG user
 * coordinates. Null when there is nothing placed at all.
 *
 * The reason this is its own function rather than a memo inside the canvas is
 * that it is a list of *kinds*, and a kind left off it is invisible to framing —
 * fitting to view then leaves that content off screen with nothing to suggest
 * why. Inline simulation windows were missing exactly this way. A list is easy
 * to forget to extend and easy to enumerate in a test, so it is enumerated.
 *
 * Hidden content is excluded because it is not drawn; framing to include
 * something invisible would just look like the camera was wrong.
 */
export function cpContentBounds(input: CpContentBoundsInput): UserBounds | null {
  const { lineSegments, images, overlayBoxes, modelToSvg } = input;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let has = false;

  const extend = (point: ModelPoint) => {
    const u = modelToSvg(point);
    if (u.x < minX) minX = u.x;
    if (u.y < minY) minY = u.y;
    if (u.x > maxX) maxX = u.x;
    if (u.y > maxY) maxY = u.y;
    has = true;
  };

  for (const segment of lineSegments) {
    extend(segment.a);
    extend(segment.b);
  }
  for (const image of images ?? []) {
    if (image.hidden) continue;
    for (const corner of imageCornersModel(image)) extend(corner);
  }
  for (const box of overlayBoxes ?? []) {
    if (box.hidden) continue;
    for (const corner of boxCornersModel(box)) extend(corner);
  }

  return has ? { minX, minY, maxX, maxY } : null;
}
