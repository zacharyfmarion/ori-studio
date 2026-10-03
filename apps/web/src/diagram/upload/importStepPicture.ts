import { importImageFile } from '../../cp-workspace/images/cpImageImport';
import { isDecodableImageType, isSvgImage } from '../../lib/imageFormats';
import { decodeSvgText } from '../../lib/svgImage';
import { FileTooLargeError, type PickedFile } from '../../platform/fileService';
import {
  SVG_READ_MAX_BYTES,
  SVG_STORED_MAX_BYTES,
  browserSanitizeEnv,
  finishRasters,
  sanitizeNotices,
  sanitizeSvg,
  type PendingRaster,
  type SanitizeEnv,
  type SanitizeNotice,
} from './svgSanitize';

/** The most a raster upload may be before it is read. It is re-encoded to 2048 px. */
export const RASTER_READ_MAX_BYTES = 20 * 1024 * 1024;

/**
 * A file to import, wherever it came from: a picker, a drop, the desktop
 * shell. The platform's unread file: on the web its size is known before
 * reading, so the caps run first; on desktop the shell enforces the cap as it
 * reads, and `read` rejects with {@link FileTooLargeError} past it.
 */
export type PictureFile = PickedFile;

/** What a picture's bytes became: sanitized markup, or a re-encoded raster. */
export type ImportedPictureContent =
  | { kind: 'svg'; svg: string; widthPx: number; heightPx: number }
  | { kind: 'raster'; src: string; widthPx: number; heightPx: number };

/** The file's kind, for the report and for analytics; never its name. */
export type ImportedPictureFormat = 'svg' | 'png' | 'jpeg' | 'webp' | 'other';

export type ImportedPicture =
  | {
      ok: true;
      content: ImportedPictureContent;
      /** What the stored form costs, for the save notice and the history cap. */
      bytes: number;
      format: ImportedPictureFormat;
      /** The file's own size, once known: for analytics, bucketed. */
      fileBytes: number | null;
      /** What changed in the look, for a Notice. Empty for a faithful import. */
      notices: SanitizeNotice[];
    }
  | {
      ok: false;
      format: ImportedPictureFormat;
      fileBytes: number | null;
      /**
       * `too_large`: past a size cap, before or after sanitizing. `rejected`:
       * an SVG the sanitizer refused (hostile, malformed, or not SVG at all).
       * `unsupported`: not a picture this app reads. `unreadable`: a raster
       * that would not decode.
       */
      reason: 'too_large' | 'rejected' | 'unsupported' | 'unreadable';
    };

const EXTENSION_FORMATS: Record<string, ImportedPictureFormat> = {
  svg: 'svg',
  png: 'png',
  jpg: 'jpeg',
  jpeg: 'jpeg',
  webp: 'webp',
};

/** What a file is, by its reported type and then its extension. */
export function pictureFormat(file: Pick<PictureFile, 'name' | 'type'>): ImportedPictureFormat {
  if (isSvgImage(file.type, file.name)) return 'svg';
  const essence = file.type.split(';')[0].trim().toLowerCase();
  if (essence === 'image/png') return 'png';
  if (essence === 'image/jpeg' || essence === 'image/jpg') return 'jpeg';
  if (essence === 'image/webp') return 'webp';
  const extension = file.name.match(/\.([^.\\/]+)$/)?.[1]?.toLowerCase() ?? '';
  return EXTENSION_FORMATS[extension] ?? 'other';
}

/** Whether a file is worth offering to {@link importStepPicture} at all. */
export function isStepPictureFile(file: Pick<PictureFile, 'name' | 'type'>): boolean {
  return pictureFormat(file) !== 'other' || isDecodableImageType(file.type);
}

export interface ImportDependencies {
  /** Re-encode a raster file to a capped PNG or JPEG data URL. */
  encodeRaster: (file: File) => Promise<{ src: string; width: number; height: number }>;
  env: SanitizeEnv;
}

const defaultDependencies = (): ImportDependencies => ({
  encodeRaster: async (file) => {
    const imported = await importImageFile(file);
    return { src: imported.src, width: imported.naturalWidth, height: imported.naturalHeight };
  },
  env: browserSanitizeEnv(),
});

/**
 * Turn one picked or dropped file into stored picture content.
 *
 * An SVG is sanitized (D7) with `assetId` as its id prefix, and every raster
 * inside it re-encoded, which also strips EXIF and GPS data; the result must
 * fit {@link SVG_STORED_MAX_BYTES}. A PNG, JPEG or WebP (or anything else the
 * browser decodes) is re-encoded to at most 2048 px. Nothing the file held
 * reaches the page except through that.
 */
export async function importStepPicture(
  file: PictureFile,
  assetId: string,
  dependencies: ImportDependencies = defaultDependencies()
): Promise<ImportedPicture> {
  const format = pictureFormat(file);
  // The platform's figure where it has one; a desktop pick is sized by its read.
  let fileBytes: number | null = file.size > 0 ? file.size : null;
  const fail = (reason: Extract<ImportedPicture, { ok: false }>['reason']): ImportedPicture => ({
    ok: false,
    format,
    fileBytes,
    reason,
  });
  if (format === 'svg') {
    if (file.size > SVG_READ_MAX_BYTES) return fail('too_large');
    let text: string;
    try {
      const bytes = await file.read(SVG_READ_MAX_BYTES);
      fileBytes = bytes.byteLength;
      text = decodeSvgText(bytes);
    } catch (error) {
      return fail(error instanceof FileTooLargeError ? 'too_large' : 'unreadable');
    }
    const sanitized = sanitizeSvg(text, { idPrefix: assetId, mode: 'import', env: dependencies.env });
    if (!sanitized.ok) return fail('rejected');
    const finished = await finishRasters(sanitized, dependencies.env, (raster) =>
      reencodeEmbedded(raster, dependencies)
    );
    if (finished.svg.length > SVG_STORED_MAX_BYTES) return fail('too_large');
    return {
      ok: true,
      content: { kind: 'svg', svg: finished.svg, widthPx: finished.widthPx, heightPx: finished.heightPx },
      bytes: finished.svg.length,
      format,
      fileBytes,
      notices: sanitizeNotices(finished.report),
    };
  }
  if (!isStepPictureFile(file)) return fail('unsupported');
  if (file.size > RASTER_READ_MAX_BYTES) return fail('too_large');
  try {
    const bytes = await file.read(RASTER_READ_MAX_BYTES);
    fileBytes = bytes.byteLength;
    const type = file.type || mimeForFormat(format);
    // A copy, so the part is backed by a plain ArrayBuffer whatever `read` returned.
    const encoded = await dependencies.encodeRaster(new File([new Uint8Array(bytes)], file.name, { type }));
    // What a load accepts, checked now: a canvas that could not encode hands
    // back `data:,`, which would be stored and then dropped on the next open.
    if (!STORED_RASTER.test(encoded.src)) return fail('unreadable');
    return {
      ok: true,
      content: { kind: 'raster', src: encoded.src, widthPx: encoded.width, heightPx: encoded.height },
      bytes: encoded.src.length,
      format,
      fileBytes,
      notices: [],
    };
  } catch (error) {
    return fail(error instanceof FileTooLargeError ? 'too_large' : 'unreadable');
  }
}

/** The form a stored bitmap takes, which the file reader insists on. */
const STORED_RASTER = /^data:image\/(?:png|jpeg);base64,/;

function mimeForFormat(format: ImportedPictureFormat): string {
  switch (format) {
    case 'png':
      return 'image/png';
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return '';
  }
}

async function reencodeEmbedded(
  raster: PendingRaster,
  dependencies: ImportDependencies
): Promise<string | null> {
  try {
    const comma = raster.dataUrl.indexOf(',');
    const binary = atob(raster.dataUrl.slice(comma + 1));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    const encoded = await dependencies.encodeRaster(new File([bytes], 'embedded', { type: raster.mime }));
    return STORED_RASTER.test(encoded.src) ? encoded.src : null;
  } catch {
    return null;
  }
}

/**
 * Order files as a person numbering steps would: `step-2` before `step-10`,
 * whatever the platform's picker returned them in.
 */
export function naturalFileOrder<T extends { name: string }>(files: readonly T[]): T[] {
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return [...files].sort((a, b) => collator.compare(a.name, b.name));
}
