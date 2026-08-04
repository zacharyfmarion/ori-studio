import type { UserBounds } from './renderer/camera';
import type { ModelPoint } from './renderer/types';
import type { CpImage } from './images/cpImage';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import { imageCornersModel } from './images/cpImagePlacement';
import { boxCornersModel } from './annotations/annotationTransform';
import { foldedFigureUserAabb } from './adapters/cpFoldedToScene';

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
  /**
   * Folded figures placed beside the pattern.
   *
   * Separate from {@link overlayBoxes} because they are already in **SVG user**
   * coordinates — the space their render primitives land in — while every other
   * input here is in model space and passes through `modelToSvg`. Putting them
   * through it as well would place them at the paper transform's scale, which is
   * the mistake `bf484295` was about.
   */
  foldedFigures?: readonly OristudioCpFoldedFigureEntry[];
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
 * why. Inline simulation windows were missing exactly this way, and so were
 * folded figures. A list is easy to forget to extend and easy to enumerate in a
 * test, so it is enumerated.
 *
 * The kinds, as of now: creases, reference images, overlay boxes (text
 * annotations and inline simulation windows), and folded figures.
 *
 * Hidden content is excluded because it is not drawn; framing to include
 * something invisible would just look like the camera was wrong.
 */
export function cpContentBounds(input: CpContentBoundsInput): UserBounds | null {
  const { lineSegments, images, overlayBoxes, foldedFigures, modelToSvg } = input;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let has = false;

  /** Take in a point already in SVG user space. */
  const extendUser = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    has = true;
  };

  const extend = (point: ModelPoint) => {
    const u = modelToSvg(point);
    extendUser(u.x, u.y);
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
  for (const figure of foldedFigures ?? []) {
    // Already user space, so `extendUser` rather than `extend`. Null means the
    // figure draws nothing, which is the same as hidden for framing purposes.
    const aabb = foldedFigureUserAabb(figure);
    if (!aabb) continue;
    extendUser(aabb.minX, aabb.minY);
    extendUser(aabb.maxX, aabb.maxY);
  }

  return has ? { minX, minY, maxX, maxY } : null;
}
