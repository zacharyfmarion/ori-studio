/**
 * Core value types shared across the crease-pattern WebGL renderer.
 *
 * Part of the SVG -> WebGL migration; see
 * implementation-plans/webgl-canvas-workspace-migration.md.
 */

/** Drawing-buffer dimensions in device pixels, plus the ratio they encode. */
export interface Viewport {
  /** Backing-store width in device pixels. */
  width: number;
  /** Backing-store height in device pixels. */
  height: number;
  /** Device-pixel ratio already baked into {@link width}/{@link height}. */
  dpr: number;
}

/** 2D world camera: pan center (world units) and zoom (device px per world unit). */
export interface Camera {
  centerX: number;
  centerY: number;
  zoom: number;
}

/** Linear RGBA colour, each channel normalised to 0..1. */
export type Rgba = readonly [number, number, number, number];

/** 2D point in model (crease-pattern) coordinates. */
export interface ModelPoint {
  x: number;
  y: number;
}

/**
 * Affine mapping from model coordinates to device pixels (relative to the
 * canvas top-left), expressed as an origin plus basis vectors:
 *
 *   device = origin + model.x * ex + model.y * ey
 *
 * This form handles translation, scale, flips, and rotation without assuming a
 * uniform zoom, and is what the shaders consume. Phase 1 derives it by sampling
 * the SVG; Phase 2's owned camera will produce the same shape.
 */
export interface ViewTransform {
  origin: readonly [number, number];
  ex: readonly [number, number];
  ey: readonly [number, number];
}

/** Instanced stroke geometry, tightly packed for GPU upload. */
export interface StrokeGeometry {
  /** Segment start points in model coords: [x, y] * count. */
  a: Float32Array;
  /** Segment end points in model coords: [x, y] * count. */
  b: Float32Array;
  /** Per-segment RGBA colour: [r, g, b, a] * count. */
  color: Float32Array;
  /** Per-segment width multiplier applied to the draw's base width: [m] * count. */
  widthMul: Float32Array;
  /** Number of segments. */
  count: number;
}

/**
 * Instanced point geometry (crease points + vertices). Radii are in SVG user
 * units (they scale with zoom, matching the SVG); the renderer converts to
 * device px per frame.
 */
export interface PointGeometry {
  /** Center in model coords: [x, y] * count. */
  center: Float32Array;
  /** Radius in user units: [r] * count. */
  radius: Float32Array;
  /** Fill RGBA: [r, g, b, a] * count. */
  fill: Float32Array;
  /** Outline RGBA: [r, g, b, a] * count. */
  stroke: Float32Array;
  /** Number of points. */
  count: number;
}

/** Everything the renderer draws for one document, in GPU-ready form. */
export interface CpSceneData {
  strokes: StrokeGeometry;
  points: PointGeometry;
}
