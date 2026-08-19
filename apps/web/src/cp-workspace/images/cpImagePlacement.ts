import type { CpImage, CpImageCrop } from './cpImage';
import {
  HANDLE_SIGNS,
  MIN_BOX_EXTENT,
  boxContainsModelPoint,
  boxCornersModel,
  type AnnotationResizeHandle,
  type AnnotationResizeResult,
  type Vec2,
} from '../annotations/annotationTransform';

/**
 * Image-specific placement: sizing a freshly dropped image, and cropping.
 *
 * The camera projection and the rotated-box transform (move / resize / rotate /
 * hit-test) are shared by every manipulable canvas object and live in
 * `annotations/annotationTransform`. Only what genuinely depends on an image
 * having *source pixels* stays here.
 *
 * Kept DOM-free so it is unit-testable.
 */

/**
 * Model-space size for a freshly dropped image: preserve the source aspect ratio
 * and scale so the larger side spans `targetModelExtent` model units.
 */
export function fitImageModelSize(
  naturalWidth: number,
  naturalHeight: number,
  targetModelExtent: number,
): { width: number; height: number } {
  const aspect = naturalWidth > 0 && naturalHeight > 0 ? naturalWidth / naturalHeight : 1;
  if (aspect >= 1) {
    return { width: targetModelExtent, height: targetModelExtent / aspect };
  }
  return { width: targetModelExtent * aspect, height: targetModelExtent };
}

/**
 * The four corners of an image's quad in model space, in order TL, TR, BR, BL
 * (before crop — crop only affects texturing, not the quad).
 */
export function imageCornersModel(image: CpImage): [Vec2, Vec2, Vec2, Vec2] {
  return boxCornersModel(image);
}

/** Smallest allowed crop fraction on an axis, so a crop can't vanish. */
const MIN_CROP_FRACTION = 1e-3;

export interface CpImageCropResult extends AnnotationResizeResult {
  crop: CpImageCrop;
}

/**
 * Crop an image by dragging one of its handles to `pointerModel`. Unlike resize,
 * the source pixels keep their on-screen density: the visible quad shrinks/grows
 * to reveal or hide part of the source, and the crop rectangle moves with it. The
 * opposite corner/edge (and the pixels there) stay anchored. Crop stays within
 * the source (0..1). Pure.
 */
export function cropImage(
  image: CpImage,
  handle: AnnotationResizeHandle,
  pointerModel: Vec2,
): CpImageCropResult {
  const { sx, sy } = HANDLE_SIGNS[handle];
  const cos = Math.cos(image.rotation);
  const sin = Math.sin(image.rotation);
  const u: Vec2 = { x: cos, y: sin };
  const v: Vec2 = { x: -sin, y: cos };
  const hw = image.width / 2;
  const hh = image.height / 2;

  const anchorLocalX = -sx * hw;
  const anchorLocalY = -sy * hh;
  const anchor: Vec2 = {
    x: image.center.x + u.x * anchorLocalX + v.x * anchorLocalY,
    y: image.center.y + u.y * anchorLocalX + v.y * anchorLocalY,
  };
  const dx = pointerModel.x - anchor.x;
  const dy = pointerModel.y - anchor.y;
  const du = dx * u.x + dy * u.y;
  const dv = dx * v.x + dy * v.y;

  // Source-fraction per model unit — held constant so pixels don't scale.
  const densityX = image.crop.w / image.width;
  const densityY = image.crop.h / image.height;

  let width = sx !== 0 ? Math.abs(du) : image.width;
  let height = sy !== 0 ? Math.abs(dv) : image.height;
  let cropX = image.crop.x;
  let cropY = image.crop.y;
  let cropW = image.crop.w;
  let cropH = image.crop.h;

  if (sx !== 0) {
    cropW = densityX * width;
    if (sx > 0)
      cropX = image.crop.x; // left edge anchored
    else cropX = image.crop.x + image.crop.w - cropW; // right edge anchored
    // Clamp within the source; keep density by re-deriving width from the crop.
    if (cropX < 0) {
      cropW += cropX;
      cropX = 0;
    }
    if (cropX + cropW > 1) cropW = 1 - cropX;
    cropW = Math.max(cropW, MIN_CROP_FRACTION);
    width = Math.max(cropW / densityX, MIN_BOX_EXTENT);
  }
  if (sy !== 0) {
    cropH = densityY * height;
    if (sy > 0) cropY = image.crop.y;
    else cropY = image.crop.y + image.crop.h - cropH;
    if (cropY < 0) {
      cropH += cropY;
      cropY = 0;
    }
    if (cropY + cropH > 1) cropH = 1 - cropY;
    cropH = Math.max(cropH, MIN_CROP_FRACTION);
    height = Math.max(cropH / densityY, MIN_BOX_EXTENT);
  }

  // The moving edge stays on its own side of the box (crop never flips).
  const offX = sx !== 0 ? (sx * width) / 2 : 0;
  const offY = sy !== 0 ? (sy * height) / 2 : 0;
  return {
    center: {
      x: anchor.x + u.x * offX + v.x * offY,
      y: anchor.y + u.y * offX + v.y * offY,
    },
    width,
    height,
    crop: { x: cropX, y: cropY, w: cropW, h: cropH },
  };
}

/** True if `model` lies inside the image's rotated quad. */
export function imageContainsModelPoint(image: CpImage, model: Vec2): boolean {
  return boxContainsModelPoint(image, model);
}

/**
 * Topmost image (highest z, then latest in array) whose quad contains the given
 * model point, skipping hidden and locked images. Returns null when none match.
 */
export function imageAtModelPoint(images: readonly CpImage[], model: Vec2): CpImage | null {
  let best: CpImage | null = null;
  for (const image of images) {
    if (image.hidden || image.locked) continue;
    if (!imageContainsModelPoint(image, model)) continue;
    // Higher z wins; on ties the later array entry (painted on top) wins.
    if (!best || image.z >= best.z) best = image;
  }
  return best;
}
