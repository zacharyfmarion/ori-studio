import { IMAGE_JPEG_QUALITY, IMAGE_MAX_DIMENSION } from './cpImage';

/**
 * Import pipeline (§1.1 of the plan): decode a dropped/picked image file, cap its
 * longest edge to {@link IMAGE_MAX_DIMENSION}, and re-encode it once. The capped,
 * re-encoded data URL is the single source of truth — it feeds both the GPU
 * texture and the `.osf` file; the original bytes are not retained.
 *
 * Re-encode by content: PNG for sources that can carry transparency
 * (PNG/WebP/GIF), JPEG otherwise (photographs are far smaller as JPEG). This is
 * the main lever on `.osf` size.
 */

export interface ImportedImageSource {
  /** Capped, re-encoded image as a base64 data URL. */
  src: string;
  /** Capped pixel dimensions (each ≤ IMAGE_MAX_DIMENSION). */
  naturalWidth: number;
  naturalHeight: number;
}

const TRANSPARENT_SOURCE_TYPES = new Set(['image/png', 'image/webp', 'image/gif']);

export function isSupportedImageFile(file: File): boolean {
  return file.type.startsWith('image/');
}

function cappedDimensions(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= IMAGE_MAX_DIMENSION) return { width, height };
  const scale = IMAGE_MAX_DIMENSION / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Decode + cap + re-encode. Throws if the file cannot be decoded as an image.
 */
export async function importImageFile(file: File): Promise<ImportedImageSource> {
  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = cappedDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get a 2D canvas context to import the image');
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bitmap, 0, 0, width, height);
    const keepAlpha = TRANSPARENT_SOURCE_TYPES.has(file.type);
    const src = keepAlpha
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', IMAGE_JPEG_QUALITY);
    return { src, naturalWidth: width, naturalHeight: height };
  } finally {
    bitmap.close();
  }
}
