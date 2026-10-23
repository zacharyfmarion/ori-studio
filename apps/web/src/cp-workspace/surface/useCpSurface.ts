import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import type { Point } from '../../lib/geometry';
import type { WheelGesturePreference } from '../../lib/wheelGesture';
import { reportError } from '../../monitoring';
import { useIsCoarsePointerSurface } from '../../platform/pointerSurface';
import type { CpRendererStatus } from '../CpRendererUnavailable';
import type { CpOverlayView } from '../CreasePatternWebglCanvas';
import { cpDpr } from '../cpDpr';
import { cpSizingScales } from '../cpSizingScales';
import {
  cameraZoomForPercent,
  fitUserCamera,
  fitUserCameraWithin,
  frameUserCameraOnBounds,
  modelViewFromCamera,
  unprojectDevicePoint,
  userBoundsInView,
  userBoundsVisibleShare,
  userCamerasEqual,
  userCameraToView,
  zoomUserCameraAt,
  type UserBounds,
  type UserCamera,
  type ViewportInset,
} from '../renderer/camera';
import type { CpRenderer } from '../renderer/CpRenderer';
import { readCssVarColor } from '../renderer/cssColor';
import { createReglRenderer } from '../renderer/reglRenderer';
import type { ModelPoint, Rgba, Viewport } from '../renderer/types';
import {
  awaitContextRestore,
  classifyCpWebglFailure,
  cpWebglSupport,
  describeCpWebglGap,
} from '../renderer/webglSupport';
import {
  CP_LINE_HIT_MIN_CSS,
  CP_LINE_HIT_MIN_CSS_COARSE,
  CP_LINE_HIT_RATIO,
  CP_POINT_HIT_MIN_CSS,
  CP_POINT_HIT_MIN_CSS_COARSE,
  CP_POINT_HIT_RATIO,
  cpHitRadiusModel,
} from '../snapRadius';
import { bindCpSurfaceInput, cpCanvasViewport } from './cpSurfaceInput';

/**
 * A props-driven crease-pattern surface on the renderer seam: one canvas, an
 * owned camera, and the gestures that move it.
 *
 * Owns the glue every such surface would otherwise copy from the Edit canvas:
 * the renderer's lifecycle (the support probe, a context lost at start or
 * mid-session, the camera kept across the rebuild), the drawing buffer's size,
 * the camera's first fit and its refit on `framingKey` (within the `inset` a
 * window over the canvas covers, for a caller that has one), pan / pinch /
 * wheel, a click told from a drag, the hover probe, and de-duplicated view and
 * zoom reports. It registers none of the Edit canvas's singletons and publishes into
 * no store.
 *
 * What it does not own is what the surface draws. The caller uploads its own
 * channels from effects keyed on {@link CpSurface.rendererGeneration}, reading
 * {@link CpSurface.rendererRef}, and answers {@link UseCpSurfaceOptions.hitTest}
 * for what a press would take. Which channel carries what — strokes, the folded
 * channel, overlays — is the caller's decision.
 *
 * Call it before the caller's upload effects: within one commit, its effects
 * then build the renderer and fit the camera before anything is uploaded to it.
 */

/** How far from a press a target still answers, model units, at the live zoom. */
export interface CpSurfaceHitRadii {
  /**
   * For a point target (a vertex): the tighter radius, so a line cannot shadow
   * its own endpoint — see `snapRadius.ts`.
   */
  point: number;
  /** For a line target (a crease). */
  line: number;
}

/** One frame's scales, for the pens the caller draws in. */
export interface CpSurfaceFrameScales {
  /** Device pixels per CSS pixel, under the shared cap (`cpDpr`). */
  ratio: number;
  /** The gentle line boost past the fit zoom (`cpSizingScales`). */
  widthBoost: number;
}

/** The stroke widths a frame draws at, device px (`CpRenderFrame`). */
export interface CpSurfaceStrokeWidths {
  strokeWidthPx: number;
  foldedStrokeWidthPx?: number;
}

export interface UseCpSurfaceOptions<Hit> {
  /** Model → SVG user space, the map the camera is built from; a change redraws. */
  modelToSvg: (point: Point) => Point;
  /** What the camera fits, in user space; null before there is anything to frame. */
  contentBounds: UserBounds | null;
  /** The camera refits when this changes (a new document), never on an edit. */
  framingKey: string;
  /**
   * What the content is, for a surface whose content changes in kind rather
   * than by edits alone — Fold's panes name the step on screen. When it
   * changes, the camera keeps its view while the new content still shows
   * there, and fits the content again where it would not:
   *
   * - a camera still where the surface last fitted it refits once the new
   *   content does not lie wholly in the part of the canvas that shows;
   * - a camera the user has moved — panned, zoomed — keeps their view while
   *   at least {@link KEEP_IN_VIEW_SHARE} of {@link keepInViewBounds} shows
   *   (`userBoundsVisibleShare`: most of it on screen, or it fills most of
   *   the screen), and refits once it would be mostly off screen.
   *
   * The same content growing moves nothing. Absent or null, never.
   */
  keepInViewKey?: string | null;
  /**
   * What must show of the content when {@link keepInViewKey} changes under a
   * camera the user has moved: the content's own extent where `contentBounds`
   * frames more (Fold's folded form, framed with the sheet it came from).
   * `contentBounds` when absent.
   */
  keepInViewBounds?: UserBounds | null;
  /**
   * How far in from each edge of the canvas something drawn over it covers
   * it, CSS px: a tool window across the bottom of a phone's pane. A fit
   * keeps the content in the rest (`fitUserCameraWithin`), and while the
   * camera is still where the last fit left it, a new inset fits it again —
   * the paper moves up as the window opens. A camera the user has moved
   * stays where it was put. Absent or null, the whole canvas.
   */
  inset?: CpSurfaceInset | null;
  wheelGesture: WheelGesturePreference;
  /** The user's snap radius, model units; sets the hit radii at the live zoom. */
  snapRadius: number;
  /**
   * What a press at `point` (model space) would take, within `radii`. Asked on
   * release for a click, and once a frame under a passing pointer.
   */
  hitTest: (point: ModelPoint, radii: CpSurfaceHitRadii) => Hit | null;
  /** The same target as a frame ago, by identity rather than position. */
  sameHit: (a: Hit, b: Hit) => boolean;
  /** A click landed: what it hit, or null for bare paper. */
  onPick: (hit: Hit | null) => void;
  /** The widths this frame's strokes draw at. */
  strokeWidths: (scales: CpSurfaceFrameScales) => CpSurfaceStrokeWidths;
  /** Model space → CSS px of the canvas box, each frame it changes. */
  onViewChange?: (view: CpOverlayView) => void;
  /**
   * The zoom as a percentage, for the viewport toolbar's readout. 100% is
   * actual size — one user unit to one CSS pixel — the editor's definition, so
   * the readouts agree about the same pattern. Reported when it changes.
   */
  onZoomPercentChange?: (percent: number) => void;
  /** The `surface` a renderer that fails to start is reported under. */
  errorSurface: string;
}

/** How far in from each edge of the canvas something over it covers it, CSS px. */
export type CpSurfaceInset = ViewportInset;

/** The camera verbs a viewport toolbar or a shortcut drives. Stable for the surface's life. */
export interface CpSurfaceControls {
  zoomIn: () => void;
  zoomOut: () => void;
  /** Zoom to a percentage, about the centre. */
  setZoomPercent: (percent: number) => void;
  /** Frame the whole content. */
  fit: () => void;
  /** Point the camera at user-space bounds without zooming out (a jump, not a fit). */
  frameUserBounds: (bounds: UserBounds) => void;
}

export interface CpSurface<Hit> {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  /** The live renderer; null while none is up. */
  rendererRef: RefObject<CpRenderer | null>;
  /**
   * Bumped when a lost context comes back and the renderer is rebuilt. Every
   * upload effect depends on it, so it re-runs against the new renderer.
   */
  rendererGeneration: number;
  /** Why nothing is drawn, for `CpRendererUnavailable`; null while drawing. */
  rendererStatus: CpRendererStatus | null;
  /** What the pointer is over: on hover, or under a finger while it is still a tap. */
  hovered: Hit | null;
  /** A contact is down. */
  dragging: boolean;
  /** Draw a frame now. Stable; a no-op while no renderer is up. */
  render: () => void;
  /** CSS px per user unit at the live camera; null before the first frame. Stable. */
  cssPerUserUnit: () => number | null;
  controls: CpSurfaceControls;
}

/**
 * How much of the content a camera the user has moved must still show for a
 * new step to keep their view (`userBoundsVisibleShare`): half — most of the
 * content on screen, or the content over most of the screen. Less, and the
 * content would arrive mostly off screen, so it is fitted instead.
 */
export const KEEP_IN_VIEW_SHARE = 0.5;

const CANVAS_BG_VAR = '--bg-primary';
const FALLBACK_CLEAR: Rgba = [0.157, 0.172, 0.204, 1];
const POINT_OUTLINE_CSS = 1.4;
const ZOOM_STEP = 1.25;

/** The shared CP policy — see `cpDpr.ts`; the editor renders under the same cap. */
const dpr = cpDpr;

/** Everything the imperative handlers read, refreshed every render without re-binding them. */
interface LiveOptions<Hit> extends UseCpSurfaceOptions<Hit> {
  /** The hit floors, in CSS px: fingertip-sized under a coarse pointer. */
  pointFloorCss: number;
  lineFloorCss: number;
}

/** An inset in CSS px, as the viewport's device px measure it. */
function deviceInset(inset: CpSurfaceInset, viewport: Viewport): ViewportInset {
  return {
    top: inset.top * viewport.dpr,
    right: inset.right * viewport.dpr,
    bottom: inset.bottom * viewport.dpr,
    left: inset.left * viewport.dpr,
  };
}

function sameView(a: CpOverlayView, b: CpOverlayView): boolean {
  return (
    a.origin[0] === b.origin[0] &&
    a.origin[1] === b.origin[1] &&
    a.ex[0] === b.ex[0] &&
    a.ex[1] === b.ex[1] &&
    a.ey[0] === b.ey[0] &&
    a.ey[1] === b.ey[1]
  );
}

export function useCpSurface<Hit>(options: UseCpSurfaceOptions<Hit>): CpSurface<Hit> {
  const { modelToSvg, framingKey, inset } = options;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CpRenderer | null>(null);
  const cameraRef = useRef<UserCamera | null>(null);
  const preservedCameraRef = useRef<UserCamera | null>(null);
  const fitRequestedRef = useRef(true);
  /** The camera the last fit made, copied: the live one is moved in place, so a match means nobody has. */
  const lastFitRef = useRef<UserCamera | null>(null);
  const renderNowRef = useRef<() => void>(() => undefined);
  /** Measure the canvas's box, apply it to the drawing buffer, then render. */
  const applySizeRef = useRef<() => void>(() => undefined);
  const [rendererStatus, setRendererStatus] = useState<CpRendererStatus | null>(null);
  const [rendererGeneration, setRendererGeneration] = useState(0);
  // What the pointer is over, and whether it is dragging — what the cursor
  // and the hover mark need. Both are mirrored in refs the raw handlers read
  // and write, and only pushed into state when the answer changes, so a
  // pointermove along the same crease re-renders nothing (the Edit canvas's
  // `applyCreaseHover` shape, `CreasePatternWebglCanvas.tsx`).
  const [hovered, setHovered] = useState<Hit | null>(null);
  const [dragging, setDragging] = useState(false);
  const hoveredRef = useRef<Hit | null>(null);
  // A fingertip is not a cursor: the hit floors grow under a coarse pointer,
  // and the mark under the finger shows on touch-down rather than on hover.
  const coarse = useIsCoarsePointerSurface();
  const pointFloorCss = coarse ? CP_POINT_HIT_MIN_CSS_COARSE : CP_POINT_HIT_MIN_CSS;
  const lineFloorCss = coarse ? CP_LINE_HIT_MIN_CSS_COARSE : CP_LINE_HIT_MIN_CSS;

  const liveRef = useRef<LiveOptions<Hit>>({ ...options, pointFloorCss, lineFloorCss });
  const lastViewRef = useRef<CpOverlayView | null>(null);
  const lastZoomPercentRef = useRef<number | null>(null);
  // Declared before every effect below, and the caller's effects come after
  // this hook's, so within one commit the handlers and uploads read this
  // render's values.
  useEffect(() => {
    liveRef.current = { ...options, pointFloorCss, lineFloorCss };
  });

  // --- Renderer lifecycle, camera, input -------------------------------------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const support = cpWebglSupport();
    if (!support.supported) {
      setRendererStatus({ kind: 'unsupported', detail: describeCpWebglGap(support.gap) });
      return;
    }

    let renderer: CpRenderer;
    try {
      renderer = createReglRenderer(canvas, {
        onContextLost: () => {
          preservedCameraRef.current = cameraRef.current;
          setRendererStatus({ kind: 'context-lost' });
        },
        onContextRestored: () => setRendererGeneration((generation) => generation + 1),
      });
    } catch (error) {
      const gap = classifyCpWebglFailure(canvas);
      // Already lost is a loss arriving early, not a gap — same handling as
      // `onContextLost`, and like it not reported. See the editor canvas.
      if (gap === 'context-lost-at-start') {
        preservedCameraRef.current = cameraRef.current;
        setRendererStatus({ kind: 'context-lost' });
        return awaitContextRestore(canvas, () =>
          setRendererGeneration((generation) => generation + 1)
        );
      }
      reportError(error, {
        surface: liveRef.current.errorSurface,
        tags: { webgl_gap: gap ?? 'unclassified' },
      });
      setRendererStatus({
        kind: 'unsupported',
        detail: gap
          ? describeCpWebglGap(gap)
          : error instanceof Error
            ? error.message
            : String(error),
      });
      return;
    }
    setRendererStatus(null);
    rendererRef.current = renderer;

    // Whether the canvas has a box to draw in, as the last size applied
    // measured it. One laid out at nothing (a dock not sized yet, a page in a
    // hidden tab) still has a 1 × 1 drawing buffer: a fit to that is a dot at
    // 0%, and nothing would fit it again. The fit waits for the box.
    let boxed = false;

    const ensureCamera = (viewport: Viewport): UserCamera | null => {
      if (preservedCameraRef.current) {
        cameraRef.current = preservedCameraRef.current;
        preservedCameraRef.current = null;
        fitRequestedRef.current = false;
        return cameraRef.current;
      }
      if (cameraRef.current && !fitRequestedRef.current) return cameraRef.current;
      const { contentBounds: bounds, inset } = liveRef.current;
      if (!bounds || !boxed) return cameraRef.current;
      fitRequestedRef.current = false;
      const fitted = inset
        ? fitUserCameraWithin(bounds, viewport, deviceInset(inset, viewport))
        : fitUserCamera(bounds, viewport);
      cameraRef.current = fitted;
      lastFitRef.current = { ...fitted };
      return cameraRef.current;
    };

    const reportView = (view: CpOverlayView) => {
      const seen = lastViewRef.current;
      if (seen !== null && sameView(seen, view)) return;
      lastViewRef.current = view;
      liveRef.current.onViewChange?.(view);
    };

    const reportZoom = (cam: UserCamera, ratio: number) => {
      const percent = Math.round((cam.zoom / ratio) * 100);
      if (percent === lastZoomPercentRef.current) return;
      lastZoomPercentRef.current = percent;
      liveRef.current.onZoomPercentChange?.(percent);
    };

    const renderNow = () => {
      const ratio = dpr();
      const viewport = cpCanvasViewport(canvas, ratio);
      if (viewport.width === 0 || viewport.height === 0) return;
      const cam = ensureCamera(viewport);
      if (!cam) return;
      const live = liveRef.current;
      const view = modelViewFromCamera(cam, viewport, live.modelToSvg);
      const userView = userCameraToView(cam, viewport);
      const bounds = live.contentBounds;
      const fitZoom = bounds ? fitUserCamera(bounds, viewport).zoom : cam.zoom;
      const { widthBoost, markerScalePx, pointScalePx } = cpSizingScales({
        camZoom: cam.zoom,
        fitZoom,
        ratio,
      });
      // A layer over this canvas draws through the same camera, in CSS
      // pixels rather than device ones.
      reportView({
        origin: [view.origin[0] / ratio, view.origin[1] / ratio],
        ex: [view.ex[0] / ratio, view.ex[1] / ratio],
        ey: [view.ey[0] / ratio, view.ey[1] / ratio],
      });
      reportZoom(cam, ratio);
      renderer.render({
        clearColor: readCssVarColor(canvas, CANVAS_BG_VAR, FALLBACK_CLEAR),
        view,
        userView,
        ...live.strokeWidths({ ratio, widthBoost }),
        userScalePx: cam.zoom,
        markerScalePx,
        pointScalePx,
        constantOutlinePx: POINT_OUTLINE_CSS * ratio,
        markerOutlinePx: POINT_OUTLINE_CSS * markerScalePx,
        // No crowded point layer to fade: a surface here marks the points it
        // means, on the overlay channel, rather than every vertex.
        pointOutlinePx: POINT_OUTLINE_CSS * pointScalePx,
        pointOpacity: 1,
      });
    };
    renderNowRef.current = renderNow;

    const applySize = () => {
      const rect = canvas.getBoundingClientRect();
      boxed = rect.width > 0 && rect.height > 0;
      const ratio = dpr();
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
      renderer.resize({ width, height, dpr: ratio });
      renderNow();
    };
    applySizeRef.current = applySize;
    // jsdom has no ResizeObserver; the size is then applied once.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(applySize);
    observer?.observe(canvas);
    applySize();

    const hitAt = (clientX: number, clientY: number): Hit | null => {
      const cam = cameraRef.current;
      if (!cam) return null;
      const ratio = dpr();
      const rect = canvas.getBoundingClientRect();
      const live = liveRef.current;
      const view = modelViewFromCamera(cam, cpCanvasViewport(canvas, ratio), live.modelToSvg);
      const model = unprojectDevicePoint(
        view,
        (clientX - rect.left) * ratio,
        (clientY - rect.top) * ratio
      );
      if (!model) return null;
      // `cpHitRadiusModel` wants CSS px per user unit; the camera zoom is in
      // device px, hence the ratio.
      const zoom = cam.zoom / ratio;
      return live.hitTest(model, {
        point: cpHitRadiusModel(live.snapRadius, zoom, CP_POINT_HIT_RATIO, live.pointFloorCss),
        line: cpHitRadiusModel(live.snapRadius, zoom, CP_LINE_HIT_RATIO, live.lineFloorCss),
      });
    };

    const applyHover = (next: Hit | null) => {
      const prev = hoveredRef.current;
      const same =
        prev === null || next === null ? prev === next : liveRef.current.sameHit(prev, next);
      if (same) return;
      hoveredRef.current = next;
      setHovered(next);
    };

    const unbindInput = bindCpSurfaceInput(canvas, {
      camera: () => cameraRef.current,
      render: renderNow,
      wheelGesture: () => liveRef.current.wheelGesture,
      hitAt,
      hover: applyHover,
      setDragging,
      pick: (hit) => liveRef.current.onPick(hit),
    });

    return () => {
      observer?.disconnect();
      unbindInput();
      renderNowRef.current = () => undefined;
      applySizeRef.current = () => undefined;
      rendererRef.current = null;
      renderer.dispose();
    };
  }, [rendererGeneration]);

  // --- Framing ---------------------------------------------------------------
  useEffect(() => {
    fitRequestedRef.current = true;
    renderNowRef.current();
  }, [framingKey]);

  // A new inset fits again only a camera still at the last fit: the paper
  // follows a window opening over it until the user takes the camera.
  const insetKey = inset ? `${inset.top} ${inset.right} ${inset.bottom} ${inset.left}` : '';
  useEffect(() => {
    const camera = cameraRef.current;
    const fit = lastFitRef.current;
    if (camera && fit && userCamerasEqual(camera, fit)) fitRequestedRef.current = true;
    // Measured first: an inset can arrive in the commit that resizes the canvas,
    // before its own observer has applied the size, and a fit to the old box
    // under the new inset has no room left — Fold's tool window coming back as
    // Repeat's bar closes, over a pane still at the bar's height.
    applySizeRef.current();
  }, [insetKey]);

  // Content of another kind keeps the view it arrives in while it shows
  // there, and is fitted where it would not: wholly, under the surface's own
  // fit; mostly, under a camera the user has moved.
  const keepInViewKey = options.keepInViewKey ?? null;
  useEffect(() => {
    if (keepInViewKey === null) return;
    const canvas = canvasRef.current;
    const camera = cameraRef.current;
    const { contentBounds: bounds, keepInViewBounds, inset: covered } = liveRef.current;
    if (!canvas || !camera || !bounds) return;
    const viewport = cpCanvasViewport(canvas, dpr());
    if (viewport.width === 0 || viewport.height === 0) return;
    const inset = covered ? deviceInset(covered, viewport) : null;
    const fit = lastFitRef.current;
    const shows =
      fit !== null && userCamerasEqual(camera, fit)
        ? userBoundsInView(bounds, camera, viewport, inset)
        : userBoundsVisibleShare(keepInViewBounds ?? bounds, camera, viewport, inset) >= KEEP_IN_VIEW_SHARE;
    if (shows) return;
    fitRequestedRef.current = true;
    renderNowRef.current();
  }, [keepInViewKey]);

  // A new map, not a new camera: the content moves in place (a reflection,
  // say) rather than refitting.
  useEffect(() => {
    renderNowRef.current();
  }, [modelToSvg]);

  const render = useCallback(() => renderNowRef.current(), []);
  const cssPerUserUnit = useCallback(() => {
    const cam = cameraRef.current;
    return cam ? cam.zoom / dpr() : null;
  }, []);

  const controls = useMemo<CpSurfaceControls>(() => {
    const viewport = (): Viewport | null => {
      const canvas = canvasRef.current;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return null;
      return cpCanvasViewport(canvas, dpr());
    };
    const zoomBy = (factor: number) => {
      const cam = cameraRef.current;
      const vp = viewport();
      if (!cam || !vp) return;
      zoomUserCameraAt(cam, vp, vp.width / 2, vp.height / 2, factor);
      renderNowRef.current();
    };
    return {
      zoomIn: () => zoomBy(ZOOM_STEP),
      zoomOut: () => zoomBy(1 / ZOOM_STEP),
      setZoomPercent: (percent) => {
        const cam = cameraRef.current;
        const vp = viewport();
        if (!cam || !vp) return;
        // The inverse of the zoom report: 100% is one user unit per CSS pixel.
        cam.zoom = cameraZoomForPercent(percent, vp.dpr);
        renderNowRef.current();
      },
      fit: () => {
        fitRequestedRef.current = true;
        renderNowRef.current();
      },
      frameUserBounds: (bounds) => {
        const cam = cameraRef.current;
        const vp = viewport();
        if (!cam || !vp) return;
        cameraRef.current = frameUserCameraOnBounds(
          bounds,
          vp,
          cam,
          liveRef.current.contentBounds
        );
        renderNowRef.current();
      },
    };
  }, []);

  return {
    canvasRef,
    rendererRef,
    rendererGeneration,
    rendererStatus,
    hovered,
    dragging,
    render,
    cssPerUserUnit,
    controls,
  };
}
