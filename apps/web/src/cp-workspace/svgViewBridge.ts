import { viewTransformFromSamples } from './renderer/camera';
import type { ModelPoint, ViewTransform } from './renderer/types';

/**
 * THROWAWAY Phase-1 bridge. While the SVG renderer still owns pan/zoom
 * (react-zoom-pan-pinch), the WebGL overlay mirrors it exactly by sampling the
 * live SVG's screen transform. Phase 2 replaces this with an owned camera and
 * this file is deleted. See implementation-plans/webgl-canvas-workspace-migration.md.
 */
export interface SampledView {
  /** model -> device-pixel transform (relative to the canvas top-left). */
  view: ViewTransform;
  /** CSS px per SVG user unit — used to size strokes defined in user units. */
  userScale: number;
}

/**
 * Derive the model→device transform by pushing three reference model points
 * through the same pipeline the SVG uses: model → user (viewBox) coords
 * ({@link modelToSvg}) → screen → device pixels relative to the canvas.
 *
 * We map user→screen via the SVG's `getBoundingClientRect()` and `viewBox`
 * rather than `getScreenCTM()`: the pan/zoom lives in a CSS transform on an
 * ancestor `<div>` (react-zoom-pan-pinch), which `getScreenCTM()` ignores but
 * `getBoundingClientRect()` reflects. Assumes no rotation (true for this editor).
 *
 * Returns `null` if the SVG is not laid out (zero-size viewBox/box).
 */
export function sampleView(
  svg: SVGSVGElement,
  canvas: HTMLCanvasElement,
  modelToSvg: (point: ModelPoint) => ModelPoint,
  dpr: number
): SampledView | null {
  const box = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  if (vb.width === 0 || vb.height === 0 || box.width === 0 || box.height === 0) return null;
  const canvasRect = canvas.getBoundingClientRect();

  const scaleX = box.width / vb.width;
  const scaleY = box.height / vb.height;

  const toDevice = (model: ModelPoint): ModelPoint => {
    const user = modelToSvg(model);
    const screenX = box.left + (user.x - vb.x) * scaleX;
    const screenY = box.top + (user.y - vb.y) * scaleY;
    return { x: (screenX - canvasRect.left) * dpr, y: (screenY - canvasRect.top) * dpr };
  };

  const view = viewTransformFromSamples(
    toDevice({ x: 0, y: 0 }),
    toDevice({ x: 1, y: 0 }),
    toDevice({ x: 0, y: 1 })
  );
  // user -> css px scale (drives stroke width, which is defined in user units).
  const userScale = scaleX;
  return { view, userScale };
}
