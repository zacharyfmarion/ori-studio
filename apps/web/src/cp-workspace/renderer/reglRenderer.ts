import createREGL from 'regl';
import type { CpRenderFrame, CpRenderer } from './CpRenderer';
import type { CpSceneData, Viewport } from './types';
import { createStrokeProgram } from './programs/strokeProgram';
import { createPointProgram } from './programs/pointProgram';
import { createFillProgram } from './programs/fillProgram';
import { createMarkerProgram } from './programs/markerProgram';
import { createWedgeProgram } from './programs/wedgeProgram';

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
  const gridStrokes = createStrokeProgram(regl);
  const foldedFills = createFillProgram(regl);
  const foldedStrokes = createStrokeProgram(regl);
  // Imported .fold folded-form frames: reference figures in user space, like folded.
  const importedFills = createFillProgram(regl);
  const importedStrokes = createStrokeProgram(regl);
  const previewStrokes = createStrokeProgram(regl);
  const points = createPointProgram(regl);
  const overlayPoints = createPointProgram(regl);
  // Diagnostic overlays (CAMV / check-fix markers + segment highlights + operation
  // frame): sparse, on top of the crease pattern.
  const diagnosticStrokes = createStrokeProgram(regl);
  const diagnosticFills = createFillProgram(regl);
  const diagnosticMarkers = createMarkerProgram(regl);
  // Little-big-little sector wedges: screen-scaled fills at a vertex.
  const diagnosticWedges = createWedgeProgram(regl);
  // Operation-frame outline: a dashed, screen-constant closed loop above the CP.
  const overlayFrame = createStrokeProgram(regl);
  let viewport: Viewport = { width: 0, height: 0, dpr: 1 };
  let hasGrid = false;
  let hasImportedForms = false;
  let hasPreview = false;
  let hasOverlayPoints = false;
  let hasDiagnosticStrokes = false;
  let hasDiagnosticFills = false;
  let hasDiagnosticMarkers = false;
  let hasDiagnosticWedges = false;
  let hasOverlayFrame = false;
  let disposed = false;

  // Operation-frame outline width: SVG `.cp-operation-frame` is 1.5px non-scaling.
  const FRAME_WIDTH_CSS = 1.5;

  // SVG `.cp-grid-line` is 0.95px, non-scaling — constant device px per dpr.
  const GRID_WIDTH_CSS = 0.95;

  return {
    resize(next) {
      viewport = next;
    },

    setScene(scene: CpSceneData) {
      if (disposed) return;
      strokes.setData(scene.strokes);
      points.setData(scene.points);
      foldedFills.setData(scene.folded.fills);
      foldedStrokes.setData(scene.folded.strokes);
    },

    setStrokes(next) {
      if (disposed) return;
      strokes.setData(next);
    },

    setPoints(next) {
      if (disposed) return;
      points.setData(next);
    },

    setGrid(grid) {
      if (disposed) return;
      hasGrid = grid !== null && grid.count > 0;
      if (grid) gridStrokes.setData(grid);
    },

    setImportedForms(folded) {
      if (disposed) return;
      hasImportedForms = folded !== null && (folded.fills.count > 0 || folded.strokes.count > 0);
      if (folded) {
        importedFills.setData(folded.fills);
        importedStrokes.setData(folded.strokes);
      }
    },

    setPreview(preview) {
      if (disposed) return;
      hasPreview = preview !== null && preview.count > 0;
      if (preview) previewStrokes.setData(preview);
    },

    setOverlayPoints(next) {
      if (disposed) return;
      hasOverlayPoints = next !== null && next.count > 0;
      if (next) overlayPoints.setData(next);
    },

    setDiagnosticStrokes(next) {
      if (disposed) return;
      hasDiagnosticStrokes = next !== null && next.count > 0;
      if (next) diagnosticStrokes.setData(next);
    },

    setDiagnosticFills(next) {
      if (disposed) return;
      hasDiagnosticFills = next !== null && next.count > 0;
      if (next) diagnosticFills.setData(next);
    },

    setDiagnosticMarkers(next) {
      if (disposed) return;
      hasDiagnosticMarkers = next !== null && next.count > 0;
      if (next) diagnosticMarkers.setData(next);
    },

    setDiagnosticWedges(next) {
      if (disposed) return;
      hasDiagnosticWedges = next !== null && next.count > 0;
      if (next) diagnosticWedges.setData(next);
    },

    setOverlayFrame(next) {
      if (disposed) return;
      hasOverlayFrame = next !== null && next.count > 0;
      if (next) overlayFrame.setData(next);
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
      // Grid sits behind the crease pattern.
      if (hasGrid) {
        gridStrokes.draw({ view: frame.view, viewport, widthPx: GRID_WIDTH_CSS * viewport.dpr });
      }
      strokes.draw({ view: frame.view, viewport, widthPx: frame.strokeWidthPx });
      // Folded figures are placed objects in user space; fills first, then their
      // edges. Fold stroke widths are in user px (non-scaling): base = 1 css px
      // (dpr device px) scaled per-segment by the width multiplier.
      foldedFills.draw({ view: frame.userView, viewport });
      foldedStrokes.draw({ view: frame.userView, viewport, widthPx: viewport.dpr });
      // Imported .fold folded-form frames are placed the same way, in user space.
      if (hasImportedForms) {
        importedFills.draw({ view: frame.userView, viewport });
        importedStrokes.draw({ view: frame.userView, viewport, widthPx: viewport.dpr });
      }
      // Points and vertices sit on top of the crease lines.
      points.draw({
        view: frame.view,
        viewport,
        userScalePx: frame.userScalePx,
        markerScalePx: frame.markerScalePx,
        outlinePx: frame.pointOutlinePx,
      });
      // Diagnostic overlays sit above the crease pattern: fills (sector wedges /
      // frame region) under the segment highlights, with the shape markers on top.
      if (hasDiagnosticFills) {
        diagnosticFills.draw({ view: frame.view, viewport });
      }
      if (hasDiagnosticStrokes) {
        diagnosticStrokes.draw({ view: frame.view, viewport, widthPx: frame.strokeWidthPx });
      }
      // LBL sector wedges scale with the markers (markerScalePx), under the shapes.
      if (hasDiagnosticWedges) {
        diagnosticWedges.draw({ view: frame.view, viewport, scalePx: frame.markerScalePx });
      }
      if (hasDiagnosticMarkers) {
        diagnosticMarkers.draw({
          view: frame.view,
          viewport,
          scalePx: frame.markerScalePx,
          outlinePx: frame.pointOutlinePx,
        });
      }
      // Operation-frame outline (dashed, screen-constant width) sits above the CP.
      if (hasOverlayFrame) {
        overlayFrame.draw({ view: frame.view, viewport, widthPx: FRAME_WIDTH_CSS * viewport.dpr });
      }
      // A tool's in-progress candidate crease draws on top of everything.
      if (hasPreview) {
        previewStrokes.draw({ view: frame.view, viewport, widthPx: frame.strokeWidthPx });
      }
      // Cursor decorations (snap indicator) sit on the very top.
      if (hasOverlayPoints) {
        overlayPoints.draw({
          view: frame.view,
          viewport,
          userScalePx: frame.userScalePx,
          markerScalePx: frame.markerScalePx,
          outlinePx: frame.pointOutlinePx,
        });
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      strokes.dispose();
      gridStrokes.dispose();
      foldedFills.dispose();
      foldedStrokes.dispose();
      importedFills.dispose();
      importedStrokes.dispose();
      previewStrokes.dispose();
      points.dispose();
      overlayPoints.dispose();
      diagnosticStrokes.dispose();
      diagnosticFills.dispose();
      diagnosticMarkers.dispose();
      diagnosticWedges.dispose();
      overlayFrame.dispose();
      regl.destroy();
    },
  };
}
