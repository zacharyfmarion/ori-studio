import createREGL from 'regl';
import type { CpRenderFrame, CpRenderer } from './CpRenderer';
import type { Rgba, Viewport } from './types';
import type { CpImage } from '../images/cpImage';
import type { CpSuppressionRegion } from '../annotations/suppressionRegion';
import { createStrokeProgram } from './programs/strokeProgram';
import { createPointProgram } from './programs/pointProgram';
import { createFillProgram } from './programs/fillProgram';
import { createMarkerProgram } from './programs/markerProgram';
import { createWedgeProgram } from './programs/wedgeProgram';
import { createImageProgram, type ImageDrawItem } from './programs/imageProgram';
import { createRegionProgram, type RegionDrawItem } from './programs/regionProgram';
import { readCssVarColor } from './cssColor';
import { CP_GL_ATTRIBUTES, CP_REQUIRED_EXTENSION } from './webglSupport';

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
   * Invoked when the canvas loses its WebGL context. This is the one graphics
   * failure that strikes a device which was drawing fine a second ago: iOS
   * reclaims GL contexts under memory pressure. Loss is silent otherwise —
   * draws become no-ops and the surface freezes on its last frame, which reads
   * as a hung editor.
   *
   * Nothing the host does here can bring the context back; it can only say so
   * and wait for {@link onContextRestored}.
   */
  onContextLost?: () => void;
  /**
   * Invoked once the browser has handed the canvas a live context back and regl
   * has re-created its own GL objects on it. The host rebuilds the renderer
   * *here*, not at loss: until this fires, `getContext` returns the same dead
   * context and every `getExtension` on it returns null, so a rebuild attempted
   * at loss fails with the same error a machine with no WebGL at all produces —
   * turning a recoverable blip into a permanent "canvas could not start".
   *
   * A rebuild rather than a redraw, because regl's restore is only partial: it
   * re-uploads buffers from its own copies but re-creates textures empty, so the
   * reference-image layer comes back blank unless the host re-uploads it.
   */
  onContextRestored?: () => void;
}

/**
 * Check-suppression regions take the theme's caution hue, which is what they
 * mean: inside this box some checks are not being reported. Deliberately not
 * `--accent-primary` — that is the selection colour on this surface, and a
 * standing region washed in it would read as permanently selected — and not
 * `--status-danger`, which the diagnostic markers already own.
 *
 * `--status-warning` is set by every theme (`themes/applyTheme` maps it from
 * `port.color`), so the fallback below is only reached before the theme has been
 * applied or under a test renderer with no stylesheet.
 */
const REGION_COLOR_VAR = '--status-warning';
/** `#d7a85c`, the default dark theme's `--status-warning`. */
const REGION_FALLBACK: Rgba = [0.843, 0.659, 0.361, 1];
/**
 * The border carries the region; the fill only tints it.
 *
 * A region is a *scope marker* over work the user is still editing — creases get
 * drawn, picked and dragged inside one — so the thing it must communicate is
 * "this boundary, here", not "this area is filled in". At the wash alpha this
 * started on the fill was the loud part and read as a highlight over the pattern,
 * so the split is deliberately lopsided: a fill low enough to be a tint you stop
 * noticing while working, and a border strong enough that the extent is still
 * unambiguous with the fill barely visible.
 *
 * Both are alphas over the same theme hue, so a theme still owns the colour.
 */
const REGION_FILL_ALPHA = 0.04;
/** See above: with the fill this light, the border is what states the extent. */
const REGION_BORDER_ALPHA = 0.85;
/** Border width in CSS px — constant screen size, like the grid and the frame. */
const REGION_BORDER_CSS = 1;

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
 * @throws if a WebGL context or {@link CP_REQUIRED_EXTENSION} cannot be had.
 * There is no software path, so the caller's only recourse is to say why — see
 * `cpWebglSupport` for the probe that names the gap ahead of this throw.
 */
export function createReglRenderer(
  canvas: HTMLCanvasElement,
  options: ReglRendererOptions = {}
): CpRenderer {
  const regl: Regl = createREGL({
    canvas,
    // Instanced strokes drive the whole renderer; require the extension up front
    // so failures surface here rather than at first draw.
    extensions: [CP_REQUIRED_EXTENSION],
    attributes: CP_GL_ATTRIBUTES,
  });

  // regl already owns the canvas's context-loss listeners: it preventDefault()s
  // the loss — which is what keeps the context eligible for restoration rather
  // than gone for good — and re-creates its GL objects before running the
  // restore callbacks. Hooking regl rather than the canvas is what puts the
  // host's rebuild after that work, on a context that is live again.
  let contextLost = false;
  regl.on('lost', () => {
    contextLost = true;
    options.onContextLost?.();
  });
  regl.on('restore', () => {
    contextLost = false;
    options.onContextRestored?.();
  });

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
  // Check-suppression regions: a translucent wash below the images, so a region
  // backs both the creases it quiets and any image being traced over. No GPU
  // resources beyond the program's shared quad.
  const regions = createRegionProgram(regl);
  let currentRegions: readonly CpSuppressionRegion[] = [];
  let hasRegions = false;
  // The only two depth-ordered programs on this surface. A generated folded
  // figure's fills and creases are one painter-ordered stream that these two
  // draws split in half, so without a depth test a crease behind a face draws
  // over it. Everything else here is genuinely 2D, and the imported forms below
  // are translucent, which a depth test would order wrongly.
  const foldedFills = createFillProgram(regl, { depthOrdered: true });
  const foldedStrokes = createStrokeProgram(regl, { depthOrdered: true });
  // Imported .fold folded-form frames: reference figures in user space, like folded.
  const importedFills = createFillProgram(regl);
  const importedStrokes = createStrokeProgram(regl);
  const previewStrokes = createStrokeProgram(regl);
  const points = createPointProgram(regl);
  const overlayPoints = createPointProgram(regl);
  // Diagnostic overlays (CAMV / check-fix markers + sector wedges + operation
  // frame): sparse, on top of the crease pattern.
  const diagnosticFills = createFillProgram(regl);
  const diagnosticMarkers = createMarkerProgram(regl);
  // Big-little-big sector wedges: screen-scaled fills at a vertex.
  const diagnosticWedges = createWedgeProgram(regl);
  // Operation-frame outline: a dashed, screen-constant closed loop above the CP.
  const overlayFrame = createStrokeProgram(regl);
  let viewport: Viewport = { width: 0, height: 0, dpr: 1 };
  let hasGrid = false;
  let hasImportedForms = false;
  let hasPreview = false;
  let hasOverlayPoints = false;
  let hasDiagnosticFills = false;
  let hasDiagnosticMarkers = false;
  let hasDiagnosticWedges = false;
  let hasOverlayFrame = false;
  let disposed = false;

  // Operation-frame outline width: SVG `.cp-operation-frame` is 1.5px non-scaling.
  const FRAME_WIDTH_CSS = 1.5;

  // Matches the pre-WebGL SVG grid stroke: 0.95px, non-scaling — constant
  // device px per dpr.
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

  // Build the per-frame region draw list, sorted back-to-front by z like the
  // images. There is no hidden check: `CpSuppressionRegion` forbids `hidden`, so
  // a region is always on screen wherever it is suppressing. Degenerate and
  // fully transparent boxes are skipped because they would draw nothing but
  // still cost a draw call.
  const buildRegionItems = (): RegionDrawItem[] => {
    const items: { z: number; item: RegionDrawItem }[] = [];
    for (const region of currentRegions) {
      if (!(region.width > 0) || !(region.height > 0) || region.opacity <= 0) continue;
      items.push({
        z: region.z,
        item: {
          center: [region.center.x, region.center.y],
          halfWidth: region.width / 2,
          halfHeight: region.height / 2,
          rotation: region.rotation,
          opacity: region.opacity,
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

    setRegions(next) {
      if (disposed) return;
      currentRegions = next;
      hasRegions = next.length > 0;
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
      // A lost context accepts draw calls and discards them; skipping the work
      // also keeps the frame the host presents from claiming to be current.
      if (disposed || contextLost) return;
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
      // Check-suppression regions sit directly on the grid, under everything
      // else they scope: the creases whose checks they silence *and* any
      // reference image being traced over. A region is a backdrop, so it is the
      // first thing drawn after the grid.
      //
      // Its colours are resolved here rather than uploaded with the geometry:
      // one `getComputedStyle` read per frame that has regions at all, which
      // costs nothing next to the unconditional one the clear colour already
      // does, and buys a theme switch that needs no re-upload and no dependency
      // on the call site remembering to re-run.
      if (hasRegions) {
        const items = buildRegionItems();
        if (items.length > 0) {
          const [r0, g0, b0] = readCssVarColor(canvas, REGION_COLOR_VAR, REGION_FALLBACK);
          regions.draw({
            view: frame.view,
            viewport,
            items,
            fill: [r0, g0, b0, REGION_FILL_ALPHA],
            border: [r0, g0, b0, REGION_BORDER_ALPHA],
            borderWidthPx: REGION_BORDER_CSS * viewport.dpr,
          });
        }
      }
      // Reference images sit above the grid but below the creases (trace-over).
      if (hasImages) {
        const items = buildImageItems();
        if (items.length > 0) images.draw({ view: frame.view, viewport, items });
      }
      strokes.draw({ view: frame.view, viewport, widthPx: frame.strokeWidthPx });
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
      // Folded figures are placed objects in user space, so they occlude the whole
      // crease pattern they sit over — vertices included. A vertex punching through
      // an opaque folded face read as the figure being translucent rather than on
      // top of the paper. Fills first, then their edges; fold stroke widths are in
      // user px (non-scaling): base = 1 css px (dpr device px) scaled per-segment
      // by the width multiplier.
      foldedFills.draw({ view: frame.userView, viewport });
      foldedStrokes.draw({ view: frame.userView, viewport, widthPx: viewport.dpr });
      // Imported .fold folded-form frames are placed the same way, in user space,
      // and stay in the same band as the generated figures above them.
      if (hasImportedForms) {
        importedFills.draw({ view: frame.userView, viewport });
        importedStrokes.draw({ view: frame.userView, viewport, widthPx: viewport.dpr });
      }
      // Diagnostic overlays sit above the crease pattern: fills (sector wedges /
      // frame region) underneath, with the shape markers on top. Nothing here
      // draws over a crease — see `CpDiagnosticMarkerStyle` for why.
      if (hasDiagnosticFills) {
        diagnosticFills.draw({ view: frame.view, viewport });
      }
      // BLB sector wedges scale with the markers (markerScalePx), under the shapes.
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
      strokes.dispose();
      gridStrokes.dispose();
      images.dispose();
      for (const texture of imageTextures.values()) texture.destroy();
      imageTextures.clear();
      regions.dispose();
      foldedFills.dispose();
      foldedStrokes.dispose();
      importedFills.dispose();
      importedStrokes.dispose();
      previewStrokes.dispose();
      points.dispose();
      overlayPoints.dispose();
      diagnosticFills.dispose();
      diagnosticMarkers.dispose();
      diagnosticWedges.dispose();
      overlayFrame.dispose();
      regl.destroy();
    },
  };
}
