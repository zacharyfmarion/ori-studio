import type { CanvasAnnotation } from '../annotations/annotation';
import type { CpSuppressionRegion } from '../annotations/suppressionRegion';
import type { CpImage } from '../images/cpImage';
import { cpSolveFramePoint, type CpSolveFrameTransform } from '../../engine/cpExactSolveTypes';
import type { CpDetectQuad } from '../../engine/cpDetectTypes';
import { reportError } from '../../monitoring';

/** Map the current solver paper into the current reference image, including
 * document rotation, reflection, scale, image rotation and image cropping. */
export function regionSourceQuad(image: CpImage, frame: CpSolveFrameTransform): CpDetectQuad | null {
  if (!(image.width > 0 && image.height > 0 && image.crop.w > 0 && image.crop.h > 0)) return null;
  const cos = Math.cos(image.rotation), sin = Math.sin(image.rotation);
  const corners = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map((p) => {
    const model = cpSolveFramePoint(frame, p);
    const dx = model.x - image.center.x, dy = model.y - image.center.y;
    return {
      x: (image.crop.x + ((dx * cos + dy * sin) / image.width + .5) * image.crop.w) * image.naturalWidth,
      y: (image.crop.y + ((-dx * sin + dy * cos) / image.height + .5) * image.crop.h) * image.naturalHeight,
    };
  });
  if (corners.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y)
    || p.x < 0 || p.x > image.naturalWidth || p.y < 0 || p.y > image.naturalHeight)) return null;
  const [top_left, top_right, bottom_right, bottom_left] = corners;
  return { top_left, top_right, bottom_right, bottom_left };
}

/** Re-measure against the rebuilt graph. Original observations may survive
 * reindexing/splitting, but the engine checks stroke geometry and assignment. */
export async function measureRegionSourceImage(
  input: unknown,
  frame: CpSolveFrameTransform,
  region: CpSuppressionRegion,
  annotations: readonly CanvasAnnotation[],
): Promise<{ input: unknown; seconds: number }> {
  const image = annotations.find((a): a is CpImage => a.id === region.imageId && a.kind === 'image');
  const quad = image && regionSourceQuad(image, frame);
  if (!image || !quad) return { input, seconds: 0 };
  const started = performance.now();
  try {
    const bitmap = await createImageBitmap(await (await fetch(image.src)).blob());
    let pixels: ImageData;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width; canvas.height = bitmap.height;
      const context = canvas.getContext('2d');
      if (!context) return { input, seconds: (performance.now() - started) / 1000 };
      context.drawImage(bitmap, 0, 0);
      pixels = context.getImageData(0, 0, bitmap.width, bitmap.height);
    } finally { bitmap.close(); }
    const { getCpDetectClient } = await import('../../store/workspaceStore/cpDetectRuntime');
    const client = await getCpDetectClient();
    const previous = region.solveInput ? {
      input: region.solveInput,
      // Review & Fix's stored underlay has the same fixed paper inset at every
      // resolution. Its crop and document transform are handled in `quad`.
      quad: { top_left: { x: 32, y: 32 }, top_right: { x: image.naturalWidth - 32, y: 32 },
        bottom_right: { x: image.naturalWidth - 32, y: image.naturalHeight - 32 },
        bottom_left: { x: 32, y: image.naturalHeight - 32 } },
    } : undefined;
    return { input: await client.measureSourceImage(input, pixels, quad, previous), seconds: (performance.now() - started) / 1000 };
  } catch (error) {
    // An unavailable reference image must not disable ordinary graph solving.
    reportError(error, { surface: 'cp_region_source_image' });
    return { input, seconds: (performance.now() - started) / 1000 };
  }
}
