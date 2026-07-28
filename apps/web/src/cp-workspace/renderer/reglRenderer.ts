import createREGL from 'regl';
import type { CpRenderFrame, CpRenderer } from './CpRenderer';
import type { CpSceneData, Viewport } from './types';
import type { CpImage } from '../images/cpImage';
import { createStrokeProgram } from './programs/strokeProgram';
import { createPointProgram } from './programs/pointProgram';
import { createFillProgram } from './programs/fillProgram';
import { createMarkerProgram } from './programs/markerProgram';
import { createWedgeProgram } from './programs/wedgeProgram';
import { createImageProgram, type ImageDrawItem } from './programs/imageProgram';

// regl ships as a UMD module (`export = REGL`), so its instance type is reached
// via the factory's return type rather than a named export.
type Regl = ReturnType<typeof createREGL>;
type Texture = ReturnType<Regl['texture']>;

export interface ReglRendererOptions {
  /**
   * Invoked when an async image texture finishes loading, so the host can
   * schedule a redraw (the image was not yet drawable when {@link CpRenderer.setImages}
   * returned).
   */
  onAsyncLoad?: () => void;
  /**
   * Invoked when the canvas loses its WebGL context. Every regl resource dies
   * with it, so there is nothing this module can repair — the host has to build
   * a new renderer. Loss is silent otherwise: draws become no-ops and the
   * surface simply freezes on its last frame, which reads as a hung editor.
   *
   * The event is preventDefault()ed first, which is what keeps the context
   * eligible for restoration rather than gone for good.
   */
  onContextLost?: () => void;
}

/** Decode an image `src` (data URL) to a GPU-ready bitmap, off the main thread. */
async function decodeImageBitmap(src: string): Promise<ImageBitmap | null> {
  try {
    const response = await fetch(src);
    const blob = await response.blob();
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
}

/**
 * regl-backed {@link CpRenderer}. Owns the WebGL context for a single canvas and
 * composes the per-layer draw programs (currently strokes).
 *
 * @throws if a WebGL context cannot be created (caller should fall back to SVG).
 */
export function createReglRenderer(
  canvas: HTMLCanvasElement,
  options: ReglRendererOptions = {}
): CpRenderer {
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

  const onContextLost = (event: Event) => {
    event.preventDefault();
    options.onContextLost?.();
  };
  canvas.addEventListener('webglcontextlost', onContextLost);

  const strokes = createStrokeProgram(regl);
  const gridStrokes = createStrokeProgram(regl);
  // Reference-image layer: one textured quad per image, above the grid, below
  // the creases. Textures are cached by `src` so transform-only updates never
  // re-upload, and evicted when no image references them.
  const images = createImageProgram(regl);
  const imageTextures = new Map<string, Texture>();
  const imageLoading = new Set<string>();
  let currentImages: readonly CpImage[] = [];
  let hasImages = false;
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

  // Build the per-frame image draw list from the current layer: skip hidden
  // images and those whose texture is still decoding, sorted back-to-front by z.
  const buildImageItems = (): ImageDrawItem[] => {
    const items: { z: number; item: ImageDrawItem }[] = [];
    for (const image of currentImages) {
      if (image.hidden) continue;
      const texture = imageTextures.get(image.src);
      if (!texture) continue;
      items.push({
        z: image.z,
        item: {
          texture,
          center: [image.center.x, image.center.y],
          halfWidth: image.width / 2,
          halfHeight: image.height / 2,
          rotation: image.rotation,
          crop: [image.crop.x, image.crop.y, image.crop.w, image.crop.h],
          opacity: image.opacity,
        },
      });
    }
    items.sort((a, b) => a.z - b.z);
    return items.map((entry) => entry.item);
  };

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

    setFolded(folded) {
      if (disposed) return;
      foldedFills.setData(folded.fills);
      foldedStrokes.setData(folded.strokes);
    },

    setGrid(grid) {
      if (disposed) return;
      hasGrid = grid !== null && grid.count > 0;
      if (grid) gridStrokes.setData(grid);
    },

    setImages(next) {
      if (disposed) return;
      currentImages = next;
      hasImages = next.length > 0;
      const neededSrcs = new Set(next.map((image) => image.src));
      // Evict textures no longer referenced by any image.
      for (const [src, texture] of imageTextures) {
        if (!neededSrcs.has(src)) {
          texture.destroy();
          imageTextures.delete(src);
        }
      }
      // Upload any newly referenced sources (async, deduped by src).
      for (const src of neededSrcs) {
        if (imageTextures.has(src) || imageLoading.has(src)) continue;
        imageLoading.add(src);
        void decodeImageBitmap(src).then((bitmap) => {
          imageLoading.delete(src);
          if (disposed || !bitmap) return;
          // The image may have been removed while decoding.
          if (!currentImages.some((image) => image.src === src)) return;
          imageTextures.set(
            src,
            regl.texture({
              // regl's TS types predate ImageBitmap; it is valid at runtime
              // (passed straight to texImage2D).
              data: bitmap as unknown as HTMLCanvasElement,
              premultiplyAlpha: true,
              // NPOT-safe on WebGL1: linear filtering, clamp wrap, no mipmaps.
              min: 'linear',
              mag: 'linear',
              wrapS: 'clamp',
              wrapT: 'clamp',
              flipY: false,
            })
          );
          options.onAsyncLoad?.();
        });
      }
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
      // Grid sits behind everything as the coordinate backdrop.
      if (hasGrid) {
        gridStrokes.draw({ view: frame.view, viewport, widthPx: GRID_WIDTH_CSS * viewport.dpr });
      }
      // Reference images sit above the grid but below the creases (trace-over).
      if (hasImages) {
        const items = buildImageItems();
        if (items.length > 0) images.draw({ view: frame.view, viewport, items });
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
      // Crease points and vertices are content: they ride `pointScalePx` and
      // shrink in lockstep with the pattern. Circles in this same layer are real
      // geometry, outlined by a constant hairline like the creases.
      points.draw({
        view: frame.view,
        viewport,
        userScalePx: frame.userScalePx,
        markerScalePx: frame.pointScalePx,
        userOutlinePx: frame.constantOutlinePx,
        markerOutlinePx: frame.pointOutlinePx,
        // Circles are geometry and stay put; the point/vertex markers fade out.
        userOpacity: 1,
        markerOpacity: frame.pointOpacity,
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
        // Diagnostics annotate the pattern, so they shrink and fade with it
        // rather than pinning at a constant size over a collapsing CP.
        diagnosticMarkers.draw({
          view: frame.view,
          viewport,
          scalePx: frame.markerScalePx,
          outlinePx: frame.markerOutlinePx,
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
        // Cursor decorations keep the affordance scale and a fixed outline — a
        // snap ring that shrank with the paper would stop reading as a target.
        overlayPoints.draw({
          view: frame.view,
          viewport,
          userScalePx: frame.userScalePx,
          markerScalePx: frame.markerScalePx,
          userOutlinePx: frame.constantOutlinePx,
          markerOutlinePx: frame.constantOutlinePx,
          userOpacity: 1,
          markerOpacity: 1,
        });
      }
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      canvas.removeEventListener('webglcontextlost', onContextLost);
      strokes.dispose();
      gridStrokes.dispose();
      images.dispose();
      for (const texture of imageTextures.values()) texture.destroy();
      imageTextures.clear();
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
