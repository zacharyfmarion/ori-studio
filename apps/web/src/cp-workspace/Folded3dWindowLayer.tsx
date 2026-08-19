import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrbitView } from '@treemaker/origami-simulator';
import { useCpOverlayViews } from './cpOverlayViewStore';
import { overlayCssPerModel, overlayModelToCss } from './annotations/annotationTransform';
import { canvasWindowPlacement, windowScreenAngle } from './canvasObjects/canvasWindowPlacement';
import { useSettledScale } from './canvasObjects/useSettledScale';
import { foldedFigureBox } from './adapters/cpFoldedToScene';
import { folded3dMesh } from './folded/folded3dMesh';
import {
  folded3dFigureModel,
  folded3dFrameFillZoom,
  folded3dWindowRenderSettings,
  folded3dWindowView,
} from './folded/folded3dWindow';
import { folded3dPaperStyle } from './folded/folded3dStyle';
import { subscribeFolded3dOrbitCamera } from './folded/folded3dRuntime';
import { useFolded3dMeshRuntime } from './folded/useFolded3dMeshRuntime';
import { SimulatorViewport, type SimulatorViewportHandle } from '../simulator/SimulatorViewport';
import { DEFAULT_SIMULATOR_SETTINGS } from '../lib/simulatorSettings';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';

/**
 * DOM layer that renders 3D folded figures as GPU-drawn windows over the crease
 * pattern.
 *
 * The second window kind, and deliberately the *same* window: placement, the
 * settle rule, the shared worker canvas, the grow-only capped quantised drawing
 * buffer and the Y-flipped crop are all reused from the inline simulation, not
 * reimplemented. What differs is what is inside — a static mesh instead of a
 * running solver — and a folded figure is the cheaper of the two by a long way:
 * a simulation needs a live session, a figure needs one texture upload.
 *
 * A figure only appears here when it can actually be drawn this way; see
 * `canWindowFolded3dFigure`, which is also what stops the crease-pattern scene
 * drawing it. Everything else stays exactly as it is today.
 *
 * The windows take **no pointer events** in this phase. Selection, move, resize
 * and rotate belong to the shared `CanvasObjectOverlay` above, and the orbit
 * gesture still belongs to the crease-pattern canvas below, so the press rules
 * are untouched by the figure becoming a window.
 */

/**
 * Frame edge, in device pixels, the crease width is calibrated for. Below it the
 * linework shrinks with the window, so a fold reads the same at every size —
 * see `RenderSettings.creaseWidthReferenceEdge`. The same number and the same
 * argument as the inline simulation's.
 */
const CREASE_REFERENCE_EDGE = 512;

/** How fast the crease thins below the reference; 1 keeps its share of the paper. */
const CREASE_SHRINK_EXPONENT = 1;

/** Floor on the drawing-buffer edge. A window is small on purpose. */
const MIN_DEVICE_SIZE = 64;

export function Folded3dWindowLayer({
  figures,
  focusedId,
  staleIds,
}: {
  /** The 3D figures that can be windowed — see `folded3dWindowIds`. */
  figures: readonly OristudioCpFoldedFigureEntry[];
  focusedId: string | null;
  staleIds: ReadonlySet<string>;
}) {
  // Subscribed here rather than in the panel so this layer alone re-renders per
  // camera frame and the windows stay glued to the pattern while panning.
  //
  // `user`, not `model`. A folded figure's box is in SVG user space — the space
  // its render primitives and its stored placement offsets live in — while
  // annotations and inline simulations are in crease-pattern model space. Both
  // are `CpOverlayView`, so reading the wrong one type-checks cleanly and puts
  // every figure hundreds of units from where it belongs.
  //
  // Deliberately the *only* subscription here. The live orbit camera is not one
  // of them: a window takes it imperatively, because subscribing to it in the
  // layer re-renders every window in the document to turn one of them, and the
  // placement does not depend on it — a 3D figure's frame is fixed at fold time
  // and does not change shape when you turn what is inside it.
  const view = useCpOverlayViews()?.user ?? null;
  const pxPerModel = view ? overlayCssPerModel(view) : 1;
  const renderedPxPerModel = useSettledScale(pxPerModel);
  if (!view) return null;

  return (
    <div
      className="cp-folded-figure-window-layer"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        overflow: 'visible',
        // Beside the inline simulation layer (7), under the selection overlay
        // (8) so its handles stay grabbable. This does move a 3D figure above
        // the reference images and text annotations it used to sit under, and
        // above any flat figure it overlaps — an unavoidable consequence of
        // leaving the WebGL scene, since a flat figure stays in it.
        zIndex: 7,
      }}
    >
      {figures.map((figure) => {
        const box = foldedFigureBox(figure);
        if (!box) return null;
        const center = overlayModelToCss(view, box.center);
        const angle = windowScreenAngle(view, box.center, box.rotation);
        const placement = canvasWindowPlacement({
          box,
          center,
          angle,
          pxPerModel,
          renderedPxPerModel,
        });
        const style: CSSProperties = {
          position: 'absolute',
          // Everything the camera moves lives in the transform, position as well
          // as scale — see `canvasWindowPlacement`.
          left: 0,
          top: 0,
          width: placement.width,
          height: placement.height,
          transform: placement.transform,
          transformOrigin: '0 0',
          // Camera-dependent, so it cannot live in the stylesheet. Clips the
          // canvas too, via `overflow`.
          borderRadius: placement.cornerRadius,
          // The overlay above owns selection and transform, and the canvas below
          // owns the orbit. A window that took presses would take them from both.
          pointerEvents: 'none',
        };
        return (
          <Folded3dWindow
            key={figure.id}
            figure={figure}
            camera={figure.camera ?? null}
            focused={figure.id === focusedId}
            stale={staleIds.has(figure.id)}
            style={style}
            badgeStyle={placement.badge}
          />
        );
      })}
    </div>
  );
}

/** One window: a mesh in the worker, and a canvas that shows what it drew. */
function Folded3dWindow({
  figure,
  camera,
  focused,
  stale,
  style,
  badgeStyle,
}: {
  figure: OristudioCpFoldedFigureEntry;
  /**
   * The figure's **stored** viewpoint. A live gesture arrives separately, and
   * imperatively — see the subscription below.
   */
  camera: { yaw: number; pitch: number; zoom: number } | null;
  focused: boolean;
  stale: boolean;
  style: CSSProperties;
  badgeStyle: CSSProperties | null;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  const [, setCanvasEl] = useState<HTMLCanvasElement | null>(null);

  // Built once per render model. This is `earcut` over every cell ring, which is
  // why it is memoized on the model's identity and not on the figure's: a colour
  // change, a style change and every orbit frame leave the geometry alone. A
  // model too large to mesh comes back as a refusal rather than a throw, and the
  // figure it belongs to never reaches this layer — `canWindowFolded3dFigure`
  // checks the same budget from an integer pass.
  const model = folded3dFigureModel(figure);
  const mesh = useMemo(() => {
    if (!model) return null;
    const result = folded3dMesh(model);
    return result.kind === 'mesh' ? result.mesh : null;
  }, [model]);

  const presentFrame = useCallback((bitmap: ImageBitmap) => {
    viewportRef.current?.presentBitmap(bitmap);
  }, []);
  const { status, setCamera, setRenderSettings } = useFolded3dMeshRuntime({
    mesh,
    onFrame: presentFrame,
  });

  const renderSettings = useMemo(
    () =>
      figure.folded3d
        ? folded3dWindowRenderSettings({
            style: folded3dPaperStyle(figure.folded3d.model),
            displayStyle: figure.displayStyle,
            devicePixelRatio: typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1),
          })
        : undefined,
    [figure.folded3d, figure.displayStyle],
  );

  /**
   * The window's frame *is* the model's bounding sphere, so at zoom 1 the model
   * fills it exactly. The fill factor cancels `cameraUniforms`'s viewport
   * padding, which would otherwise draw every existing figure about 16% smaller
   * in the same box; the figure's own zoom then multiplies it, growing the model
   * inside a window whose size never changes.
   */
  const pushCamera = useCallback(
    (view: OrbitView, width: number, height: number) => {
      setCamera({ ...view, zoom: view.zoom * folded3dFrameFillZoom(width, height) }, width, height);
    },
    [setCamera],
  );

  // The camera is document state — undo, "view from the other side", and a drag
  // on the crease-pattern canvas all move it — so it is pushed in rather than
  // owned by the viewport, which is the reverse of a simulation.
  const figureView = useMemo(() => folded3dWindowView(camera), [camera]);
  useEffect(() => {
    viewportRef.current?.setView(figureView);
  }, [figureView]);

  /**
   * The live gesture: every move of a turn or a zoom, straight into the
   * viewport.
   *
   * Not a prop, and not `useSyncExternalStore`, because either would make a
   * camera frame a React render — of this component, of the layer above it and
   * of every other window in the layer. The mesh needs a uniform and a draw;
   * nothing about the DOM changes when a figure turns, so nothing about the DOM
   * should be recomputed. Exactly the rule `SimulatorViewport` states for solver
   * frames.
   *
   * Nothing arrives when the gesture ends: the store is written first, so the
   * camera to settle at comes back through {@link figureView}.
   */
  const figureId = figure.id;
  useEffect(
    () =>
      subscribeFolded3dOrbitCamera(figureId, (live) => {
        viewportRef.current?.setView(folded3dWindowView(live));
      }),
    [figureId],
  );

  return (
    <div
      className="cp-folded-figure-window"
      data-focused={focused || undefined}
      data-stale={stale || undefined}
      // A window that renders nothing looks the same whether it is still loading,
      // errored, or ready but never handed a frame. One glance in the inspector
      // rather than a bisect.
      data-status={status}
      style={style}
    >
      <SimulatorViewport
        ref={viewportRef}
        canvasKey="folded-3d"
        onCanvasChange={setCanvasEl}
        // The crease-pattern canvas still owns the orbit gesture, and the shared
        // overlay owns move and resize. Turning this on would take the press from
        // both of them.
        interactive={false}
        gpuActive
        bitmapPresent
        minDeviceSize={MIN_DEVICE_SIZE}
        transparentBackground
        creaseWidthReferenceEdge={CREASE_REFERENCE_EDGE}
        creaseWidthShrinkExponent={CREASE_SHRINK_EXPONENT}
        // Unused: `renderSettings` below replaces the palette outright, so the
        // app-wide simulator settings never reach this surface. A figure's
        // colours are its own document state.
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        renderSettings={renderSettings}
        initialView={figureView}
        pushCamera={pushCamera}
        pushRenderSettings={setRenderSettings}
        className="cp-folded-figure-window__canvas"
        ariaLabel={t(
          'panels:creasePattern.foldedFigure.windowAriaLabel',
          'Folded model, in three dimensions',
        )}
      />
      {badgeStyle && status === 'error' && (
        <span
          className="cp-folded-figure-window__badge cp-folded-figure-window__badge--error"
          style={badgeStyle}
        >
          {t('panels:creasePattern.foldedFigure.windowFailed', 'Could not draw this model')}
        </span>
      )}
    </div>
  );
}
