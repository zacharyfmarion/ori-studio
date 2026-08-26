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
  /**
   * Draw order as a depth in `[0, 1]`, 0 farthest — `[d] * count`.
   *
   * Only meaningful to a depth-ordered program (see `createStrokeProgram`), and
   * only produced for generated folded figures. Absent everywhere else, where it
   * defaults to 0 and leaves plain painter order exactly as it was.
   */
  depth?: Float32Array;
  /** Number of segments. */
  count: number;
  /**
   * Screen-space dash patterns available to this geometry, as alternating on/off
   * run lengths in CSS px. Entry `i` occupies slot `i + 1`; slot 0 is always
   * solid. Omitted (or empty) draws everything solid.
   */
  dashPatterns?: readonly (readonly number[])[];
  /**
   * Per-segment dash slot: `[slot] * count`. Omitted means every segment uses
   * slot 1 — the uniform-dash case (measure guides, the operation frame).
   */
  dashSlot?: Float32Array;
}

/**
 * Dash slots a {@link StrokeGeometry} may address beyond solid.
 *
 * Four: Oriedita's mountain and valley take one each, an undecided crease needs
 * its own, and the fourth is that same undecided dash shifted along by one mark
 * so a *hinted* crease can be overdrawn in its direction's colour on alternate
 * dashes (`lib/oristudioCpLineStyle`). A slot is two `vec3` uniforms and one
 * comparison in the vertex stage; nothing per segment, since `dashSlot` is
 * already a float. Raising this cannot disturb a geometry that declares fewer
 * patterns — `dashTableUniforms` pads the rest with solid.
 */
export const MAX_DASH_SLOTS = 4;
/** Alternating on/off runs a single dash pattern may have. */
export const MAX_DASH_RUNS = 3;
/**
 * The dash overlays draw with (CSS px on/off) — measure guides and the Oriedita
 * operation-frame outline, which dash to read as scaffolding rather than crease.
 */
export const OVERLAY_DASH_PATTERN: readonly number[] = [11, 7];

/**
 * Instanced point geometry (crease points + vertices). Radii are in SVG user
 * units (they scale with zoom, matching the SVG); the renderer converts to
 * device px per frame.
 */
export interface PointGeometry {
  /** Center in model coords: [x, y] * count. */
  center: Float32Array;
  /** Radius: [r] * count. Units depend on {@link screenSpace} for that instance. */
  radius: Float32Array;
  /**
   * Per-instance sizing mode: 1 = constant screen size (markers — crease points
   * and derived vertices, radius in CSS px), 0 = scales with zoom (real
   * geometry — circle-packing circles, radius in SVG user units).
   */
  screenSpace: Float32Array;
  /** Fill RGBA: [r, g, b, a] * count. */
  fill: Float32Array;
  /** Outline RGBA: [r, g, b, a] * count. */
  stroke: Float32Array;
  /** Number of points. */
  count: number;
}

/** Marker shape ids for {@link MarkerGeometry} (must match the marker shader). */
export const MARKER_SHAPE = {
  disc: 0,
  ring: 1,
  triangle: 2,
  square: 3,
  pentagon: 4,
  cross: 5,
  /**
   * The one shape that is not part of Oriedita's error vocabulary.
   *
   * Every marker above means "this is wrong"; the diamond means "this is not
   * settled", and it carries both of the check's undecided states — filled where
   * an answer is waiting, hollow where none can be given. Hollowness is a fill
   * alpha the geometry builder chooses, exactly as it is for the ring, so this
   * is one shader branch and not two.
   */
  diamond: 6,
} as const;

/**
 * Instanced screen-space marker geometry: fixed-pixel shapes (diagnostic markers)
 * anchored at model points. Each instance is one shape at a constant device size,
 * with an SDF fill + outline in the fragment shader.
 */
export interface MarkerGeometry {
  /** Anchor in model coords: [x, y] * count. */
  center: Float32Array;
  /** Half-extent in CSS px: [px] * count (constant screen size). */
  size: Float32Array;
  /** Shape id per instance ({@link MARKER_SHAPE}): [id] * count. */
  shape: Float32Array;
  /** Fill RGBA: [r, g, b, a] * count. */
  fill: Float32Array;
  /** Outline RGBA: [r, g, b, a] * count. */
  stroke: Float32Array;
  /** Number of markers. */
  count: number;
}

/**
 * Instanced big-little-big sector wedges: a filled triangle per instance from a
 * vertex (model coords) out to two rim points placed a fixed *screen* radius along
 * two crease directions. Screen-scaled like {@link MarkerGeometry} (via markerScalePx)
 * so the wedges track the other diagnostic markers as the camera zooms.
 */
export interface WedgeGeometry {
  /** Vertex (fan apex) in model coords: [x, y] * count. */
  center: Float32Array;
  /** Model direction to the first rim point: [x, y] * count. */
  dir0: Float32Array;
  /** Model direction to the second rim point: [x, y] * count. */
  dir1: Float32Array;
  /** Rim radius in CSS px: [px] * count (screen-scaled by markerScalePx). */
  radiusPx: Float32Array;
  /** Fill RGBA: [r, g, b, a] * count. */
  color: Float32Array;
  /** Number of wedges. */
  count: number;
}

/** Triangulated fill geometry (folded-figure facets), in SVG user coordinates. */
export interface FillGeometry {
  /** Triangle vertex positions in user coords: [x, y] * vertexCount. */
  position: Float32Array;
  /** Per-vertex RGBA colour: [r, g, b, a] * vertexCount. */
  color: Float32Array;
  /** Vertex count (a multiple of 3). */
  count: number;
  /**
   * Draw order as a depth in `[0, 1]`, 0 farthest — `[d] * vertexCount`.
   *
   * See {@link StrokeGeometry.depth}. This is what lets a folded figure's fills
   * and strokes interleave correctly despite being drawn in two batched passes.
   */
  depth?: Float32Array;
}

/** Folded-figure geometry: triangulated fills plus edge strokes (user coords). */
export interface FoldedGeometry {
  fills: FillGeometry;
  strokes: StrokeGeometry;
}
