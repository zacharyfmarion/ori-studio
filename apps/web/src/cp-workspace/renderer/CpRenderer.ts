import type {
  CpSceneData,
  FillGeometry,
  MarkerGeometry,
  PointGeometry,
  Rgba,
  StrokeGeometry,
  ViewTransform,
  Viewport,
} from './types';

/**
 * Backend-agnostic seam for the crease-pattern edit surface. A concrete
 * implementation (currently {@link ./reglRenderer}) owns a GPU context and
 * knows nothing about React; the mounting component drives its lifecycle.
 *
 * Scene geometry is uploaded once via {@link CpRenderer.setScene} and redrawn
 * cheaply each frame with a fresh camera via {@link CpRenderer.render}.
 */
export interface CpRenderer {
  /** Notify the renderer of a new drawing-buffer size (device pixels). */
  resize(viewport: Viewport): void;
  /** Upload (or replace) the geometry to draw. */
  setScene(scene: CpSceneData): void;
  /**
   * Replace only the crease-stroke buffer, leaving points and folded figures
   * untouched. Used to redraw the selected lines shifted during a move-drag
   * without re-uploading the rest of the scene each frame.
   */
  setStrokes(strokes: StrokeGeometry): void;
  /**
   * Replace only the point buffer (crease points, derived vertices, circles).
   * Used alongside {@link setStrokes} during a move-drag so the derived vertices
   * of the moved lines follow them without a full scene re-upload.
   */
  setPoints(points: PointGeometry): void;
  /** Upload (or clear) the view-dependent grid geometry, drawn behind the scene. */
  setGrid(strokes: StrokeGeometry | null): void;
  /**
   * Upload (or clear, with `null`) additive preview strokes drawn on top of the
   * scene — a tool's in-progress candidate crease. Model coords + the frame's
   * stroke width, like the committed creases.
   */
  setPreview(strokes: StrokeGeometry | null): void;
  /**
   * Upload (or clear, with `null`) overlay point markers drawn on top of
   * everything — cursor decorations such as the snap-target indicator.
   */
  setOverlayPoints(points: PointGeometry | null): void;
  /**
   * Diagnostic overlays (CAMV / check-fix), drawn above the crease pattern in model
   * coordinates. Strokes = segment highlights + operation-frame outline; fills =
   * sector wedges + frame region; markers = the fixed-size shape markers.
   */
  setDiagnosticStrokes(strokes: StrokeGeometry | null): void;
  setDiagnosticFills(fills: FillGeometry | null): void;
  setDiagnosticMarkers(markers: MarkerGeometry | null): void;
  /**
   * The Oriedita operation-frame outline (a dashed, screen-constant-width closed
   * loop in model coordinates), drawn above the crease pattern. `null` clears it.
   */
  setOverlayFrame(strokes: StrokeGeometry | null): void;
  /** Draw a single frame. Safe to call repeatedly. */
  render(frame: CpRenderFrame): void;
  /** Release all GPU resources. The renderer must not be used afterwards. */
  dispose(): void;
}

/** Everything needed to draw one frame (geometry comes from {@link CpRenderer.setScene}). */
export interface CpRenderFrame {
  /** Background colour the surface is cleared to before drawing. */
  clearColor: Rgba;
  /** Model → device-pixel transform for this frame. */
  view: ViewTransform;
  /** SVG user → device-pixel transform (for folded figures). */
  userView: ViewTransform;
  /** Crease stroke width in device pixels (constant screen size, zoom-independent). */
  strokeWidthPx: number;
  /** SVG user unit → device px (scales circle radii with zoom). */
  userScalePx: number;
  /** CSS px → device px (dpr): sizes marker points/vertices independent of zoom. */
  markerScalePx: number;
  /** Point outline width in device px (constant / non-scaling). */
  pointOutlinePx: number;
}
