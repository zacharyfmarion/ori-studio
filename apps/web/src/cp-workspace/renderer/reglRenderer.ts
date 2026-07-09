import createREGL from 'regl';
import type { CpRenderFrame, CpRenderer } from './CpRenderer';
import type { CpSceneData, Viewport } from './types';
import { createStrokeProgram } from './programs/strokeProgram';

// regl ships as a UMD module (`export = REGL`), so its instance type is reached
// via the factory's return type rather than a named export.
type Regl = ReturnType<typeof createREGL>;

/**
 * regl-backed {@link CpRenderer}. Owns the WebGL context for a single canvas and
 * composes the per-layer draw programs (currently strokes).
 *
 * @throws if a WebGL context cannot be created (caller should fall back to SVG).
 */
export function createReglRenderer(canvas: HTMLCanvasElement): CpRenderer {
  const regl: Regl = createREGL({
    canvas,
    // Instanced strokes drive the whole renderer; require the extension up front
    // so failures surface here rather than at first draw.
    extensions: ['ANGLE_instanced_arrays'],
    attributes: {
      antialias: true,
      alpha: false,
      premultipliedAlpha: true,
      // On-demand renderer: we only redraw on mount/resize/state change, not
      // every frame, so preserve the buffer to survive compositor repaints
      // between renders. (Revisit if we move to continuous per-frame drawing.)
      preserveDrawingBuffer: true,
    },
  });

  const strokes = createStrokeProgram(regl);
  let viewport: Viewport = { width: 0, height: 0, dpr: 1 };
  let disposed = false;

  return {
    resize(next) {
      viewport = next;
    },

    setScene(scene: CpSceneData) {
      if (disposed) return;
      strokes.setData(scene.strokes);
    },

    render(frame: CpRenderFrame) {
      if (disposed) return;
      // Nothing to draw into a zero-area buffer (e.g. a collapsed panel).
      if (viewport.width === 0 || viewport.height === 0) return;
      // We drive regl outside regl.frame(), so poll() to sync its cached GL
      // viewport to the current drawing-buffer size before clearing.
      regl.poll();
      const [r, g, b, a] = frame.clearColor;
      regl.clear({ color: [r, g, b, a], depth: 1 });
      strokes.draw({ view: frame.view, viewport, widthPx: frame.strokeWidthPx });
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      strokes.dispose();
      regl.destroy();
    },
  };
}
