import type { CpSceneData, Rgba, StrokeGeometry, ViewTransform, Viewport } from './types';

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
  /** Upload (or clear) the view-dependent grid geometry, drawn behind the scene. */
  setGrid(strokes: StrokeGeometry | null): void;
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
  /** Stroke width in device pixels. */
  strokeWidthPx: number;
  /** SVG user unit → device px (scales point radii with zoom). */
  userScalePx: number;
  /** Point outline width in device px (constant / non-scaling). */
  pointOutlinePx: number;
}
