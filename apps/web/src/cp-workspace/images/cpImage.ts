/**
 * Reference images placed on the crease-pattern canvas — the first *superset
 * feature* (a capability Oriedita has no concept of). See
 * `apps/web/docs/superset-features.md` for the pattern this establishes and
 * `implementation-plans/image-support-edit-workspace.md` for the full design.
 *
 * This module is deliberately a **leaf**: pure types, constants, and helpers
 * with no DOM/GPU/store dependencies, so it can be imported by the persistence
 * layer (`lib/nativeProjectFile`), the renderer, and the store alike, and unit
 * tested headlessly.
 *
 * Images live in a web-side layer, never in the `oristudio-cp` kernel, so every
 * Oriedita-format export omits them automatically.
 */

/**
 * Longest-edge cap applied when an image is imported (§1.1 of the plan). The
 * source is downscaled + re-encoded once to this bound; the capped blob is the
 * single source of truth for both the GPU texture and the `.osf` file. Bounds
 * VRAM and file size in one step.
 */
export const IMAGE_MAX_DIMENSION = 2048;

/** JPEG quality used when re-encoding opaque images on import. */
export const IMAGE_JPEG_QUALITY = 0.85;

/**
 * Total embedded-image byte budget past which `.osf` save shows a soft,
 * non-blocking "this project embeds ~N MB of images" notice (§6.1). Keyed on
 * total bytes, not image count.
 */
export const IMAGE_TOTAL_BYTES_WARN = 25 * 1024 * 1024;

/** Rotation snap increment (15°) applied while Shift is held during a rotate. */
export const IMAGE_ROTATION_SNAP_RADIANS = Math.PI / 12;

/** Normalized crop rectangle into the source image, components in 0..1. */
export interface CpImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CpImage {
  /** Stable unique id. */
  id: string;
  /**
   * The capped, re-encoded image as a base64 data URL — the single source of
   * truth. Feeds both the GPU texture and `.osf`; there is no separate original.
   */
  src: string;
  /** Capped-blob pixel dimensions (each ≤ {@link IMAGE_MAX_DIMENSION}). */
  naturalWidth: number;
  naturalHeight: number;
  /** Placement center in crease-pattern *model* coordinates. */
  center: { x: number; y: number };
  /** Displayed size in model units (pre-rotation quad extent). */
  width: number;
  height: number;
  /** Rotation about {@link center}, radians, counter-clockwise. */
  rotation: number;
  /** Normalized crop into the source (default covers the whole image). */
  crop: CpImageCrop;
  /** 0..1. */
  opacity: number;
  /** When locked, the image ignores hit-testing and edits. */
  locked: boolean;
  /** When hidden, the image is not drawn. */
  hidden: boolean;
  /** Draw order within the image layer (higher = in front). */
  z: number;
}

/** A partial update to an existing image (its `id` never changes). */
export type CpImageUpdate = Partial<Omit<CpImage, 'id'>>;

export function defaultCpImageCrop(): CpImageCrop {
  return { x: 0, y: 0, w: 1, h: 1 };
}

function generateCpImageId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined'
      ? (globalThis.crypto as Crypto | undefined)
      : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `image-${cryptoObj.randomUUID()}`;
  }
  return `image-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface CreateCpImageInput {
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  center: { x: number; y: number };
  width: number;
  height: number;
  id?: string;
  rotation?: number;
  crop?: CpImageCrop;
  opacity?: number;
  locked?: boolean;
  hidden?: boolean;
  z?: number;
}

export function createCpImage(input: CreateCpImageInput): CpImage {
  return {
    id: input.id ?? generateCpImageId(),
    src: input.src,
    naturalWidth: input.naturalWidth,
    naturalHeight: input.naturalHeight,
    center: { x: input.center.x, y: input.center.y },
    width: input.width,
    height: input.height,
    rotation: input.rotation ?? 0,
    crop: input.crop ? { ...input.crop } : defaultCpImageCrop(),
    opacity: input.opacity ?? 1,
    locked: input.locked ?? false,
    hidden: input.hidden ?? false,
    z: input.z ?? 0,
  };
}

/**
 * Approximate the bytes an image contributes to a serialized `.osf` — the
 * base64 data URL is what gets written, so its character length is the payload
 * weight. Used for the total-bytes save warning.
 */
export function cpImageEmbeddedBytes(image: CpImage): number {
  return image.src.length;
}

export function totalCpImageBytes(images: readonly CpImage[]): number {
  return images.reduce((sum, image) => sum + cpImageEmbeddedBytes(image), 0);
}

/**
 * Defensively validate/normalize images read from a `.osf` file. Mirrors the
 * lenient style of `nativeProjectFile` validators: unknown/invalid entries are
 * dropped rather than throwing, so a malformed image never blocks opening a
 * project.
 */
export function validateCpImages(value: unknown): CpImage[] {
  if (!Array.isArray(value)) return [];
  const images: CpImage[] = [];
  for (const entry of value) {
    const image = validateCpImage(entry);
    if (image) images.push(image);
  }
  return images;
}

function validateCpImage(value: unknown): CpImage | null {
  if (!isRecord(value)) return null;
  const src = value.src;
  if (typeof src !== 'string' || src.length === 0) return null;
  const center = validatePoint(value.center);
  if (!center) return null;
  const naturalWidth = finiteNumber(value.naturalWidth);
  const naturalHeight = finiteNumber(value.naturalHeight);
  const width = positiveNumber(value.width);
  const height = positiveNumber(value.height);
  if (naturalWidth === null || naturalHeight === null || width === null || height === null) {
    return null;
  }
  return {
    id: typeof value.id === 'string' && value.id.length > 0 ? value.id : generateCpImageId(),
    src,
    naturalWidth,
    naturalHeight,
    center,
    width,
    height,
    rotation: finiteNumber(value.rotation) ?? 0,
    crop: validateCrop(value.crop),
    opacity: clamp01(finiteNumber(value.opacity) ?? 1),
    locked: value.locked === true,
    hidden: value.hidden === true,
    z: finiteNumber(value.z) ?? 0,
  };
}

function validateCrop(value: unknown): CpImageCrop {
  if (!isRecord(value)) return defaultCpImageCrop();
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  const w = finiteNumber(value.w);
  const h = finiteNumber(value.h);
  if (x === null || y === null || w === null || h === null || w <= 0 || h <= 0) {
    return defaultCpImageCrop();
  }
  return { x, y, w, h };
}

function validatePoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
