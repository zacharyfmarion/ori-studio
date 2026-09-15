import type { CpImageCrop } from '../cp-workspace/images/cpImage';

/**
 * The window event that opens the Detect dialog. `File ▸ Detect CP from
 * Image…` dispatches it bare; the canvas-image entry dispatches it with a
 * {@link CpDetectCanvasImageDetail} so the dialog opens on the crop step with
 * the image already loaded.
 */
export const CP_DETECT_OPEN_EVENT = 'ori-studio:detect-cp-image';

/**
 * A reference image handed to the Detect dialog from the Edit canvas.
 *
 * Carries the annotation's capped data URL rather than a `File`: the original
 * bytes are gone once an image is imported (`cpImageImport.ts`), and the
 * rectifier downsizes to 1024 px anyway. `crop` is the annotation's, so an
 * image the user cropped on canvas is detected as cropped. `annotationId` lets
 * the dialog report back to the suggestion pill and, once the pattern is
 * imported, register it onto the image.
 */
export interface CpDetectCanvasImageDetail {
  source: 'canvas-suggestion';
  annotationId: string;
  image: {
    src: string;
    naturalWidth: number;
    naturalHeight: number;
    crop: CpImageCrop;
  };
}

export function isCpDetectCanvasImageDetail(value: unknown): value is CpDetectCanvasImageDetail {
  if (typeof value !== 'object' || value === null) return false;
  const detail = value as Partial<CpDetectCanvasImageDetail>;
  return (
    detail.source === 'canvas-suggestion' &&
    typeof detail.annotationId === 'string' &&
    typeof detail.image === 'object' &&
    detail.image !== null &&
    typeof detail.image.src === 'string'
  );
}

/** Open the Detect dialog on a canvas image. */
export function openCpDetectWithCanvasImage(detail: CpDetectCanvasImageDetail): void {
  window.dispatchEvent(new CustomEvent(CP_DETECT_OPEN_EVENT, { detail }));
}
