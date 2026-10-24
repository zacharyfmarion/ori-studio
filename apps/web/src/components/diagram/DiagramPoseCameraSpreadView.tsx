import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrbitView } from '@treemaker/origami-simulator';
import type { CameraLayerSpreadOptions } from '../../cp-workspace/folded/foldedLayerSpread';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { useCameraSpreadRuntime } from '../../cp-workspace/folded/useCameraSpreadRuntime';
import type { CameraSpreadHold } from '../../diagram/capture/captureSession';
import { sameCamera } from '../../diagram/capture/poseController';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { diagramScenePaintStyle, DIAGRAM_STYLE_POLICY } from '../../diagram/pictures/diagramPaperStyle';
import { cameraDegrees } from '../../diagram/pictures/cameraDegrees';
import { STEP_PICTURE_EDGE_CSS_PX } from '../../diagram/pictures/poseLineWeight';
import { poseGhostMarkup } from '../../diagram/zoom/paintZoomed';
import { resolvePaperStyle } from '../../lib/paper/paperStyleResolve';
import { cameraSpreadStoredView, cameraSpreadViewportView } from '../../cp-workspace/folded/cameraSpreadView';
import type { UprightViewHandle } from '../../viewport3d/viewport3dHandle';
import { Viewport3d, type Viewport3dHandle } from '../../viewport3d/Viewport3d';
import { Button } from '../ui/Button';
import { DiagramPoseStage, type DiagramPoseAnnotations } from './DiagramPoseStage';

/** Static lifted paper using the shared camera surface; no simulator lifecycle. */
export function DiagramPoseCameraSpreadView({
  view,
  spread,
  rotationDeg,
  style,
  onCamera,
  onGesture,
  consumeCameraCommit,
  registerLiveView,
  ghost,
  fallback,
  readOnly = false,
}: {
  view: CameraSpreadHold;
  spread: CameraLayerSpreadOptions;
  rotationDeg: number;
  style: DiagramStyle;
  consumeCameraCommit?: (camera: FoldedFigureCamera) => boolean;
  onCamera: (camera: FoldedFigureCamera) => void;
  onGesture?: (held: boolean, cancelled?: boolean) => void;
  registerLiveView: (view: UprightViewHandle) => () => void;
  ghost: DiagramPoseAnnotations | null;
  fallback: ReactNode;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const viewport = useRef<Viewport3dHandle | null>(null);
  const shown = useRef(cameraSpreadViewportView(spread.camera, rotationDeg));
  const [size, setSize] = useState({ width: 1, height: 1, dpr: 1 });
  const [atStored, setAtStored] = useState(true);
  const [degrees, setDegrees] = useState(() => cameraDegrees(spread.camera));
  const present = useCallback((bitmap: ImageBitmap) => {
    if (viewport.current) viewport.current.presentBitmap(bitmap);
    else bitmap.close();
  }, []);
  const { status, error, draw, retry } = useCameraSpreadRuntime(view.scene, present);
  const paint = useMemo(() => diagramScenePaintStyle(style, false), [style]);
  const push = useCallback(
    (camera: OrbitView, nextSize: typeof size) => {
      const kept = cameraSpreadStoredView(camera, rotationDeg);
      shown.current = camera;
      setAtStored(sameCamera(kept, spread.camera));
      setDegrees((previous) => {
        const next = cameraDegrees(kept);
        return previous.yaw === next.yaw && previous.pitch === next.pitch ? previous : next;
      });
      setSize((previous) =>
        previous.width === nextSize.width && previous.height === nextSize.height && previous.dpr === nextSize.dpr
          ? previous
          : nextSize
      );
      const settings = resolvePaperStyle(paint, DIAGRAM_STYLE_POLICY, {
        dpr: (nextSize.dpr * Math.min(nextSize.width, nextSize.height)) / STEP_PICTURE_EDGE_CSS_PX,
        background: [0, 0, 0],
        backgroundAlpha: 0,
        faceAlpha: 1,
        colorMode: 'paper',
        strainClip: 0,
        showFaces: true,
        showEdges: true,
      });
      // Widths are already sized for this viewport; the renderer only supersamples them.
      draw({ spread: { ...spread, camera: kept }, rotationDeg, surface: { ...nextSize, style: settings } });
      onCamera(kept);
    },
    [spread, rotationDeg, paint, draw, onCamera]
  );
  useEffect(() => {
    if (!consumeCameraCommit?.(spread.camera))
      viewport.current?.setView(cameraSpreadViewportView(spread.camera, rotationDeg));
  }, [spread.camera, rotationDeg, consumeCameraCommit]);
  useEffect(() => {
    push(shown.current, size);
  }, [push, size]);
  useEffect(
    () =>
      status !== 'error' && spread.projection !== 'diagram'
        ? registerLiveView({ setUpright: () => viewport.current?.setUpright() })
        : undefined,
    [status, spread.projection, registerLiveView]
  );
  const ghostMarkup = useMemo(() => {
    if (!ghost || !atStored) return null;
    const edge = Math.min(size.width, size.height);
    return poseGhostMarkup(
      ghost.annotations,
      { x: (size.width - edge) / 2, y: (size.height - edge) / 2, width: edge, height: edge },
      style,
      ghost.zoom
    );
  }, [ghost, atStored, size, style]);
  if (status === 'error')
    return (
      <>
        {fallback}
        <Button size="sm" onClick={retry} title={error ?? undefined}>
          {t('panels:diagram.pose.retrySpread', 'Retry live view')}
        </Button>
      </>
    );
  return (
    <DiagramPoseStage
      status={status}
      ghost={ghostMarkup ? { markup: ghostMarkup, ...size } : null}
      yaw={degrees.yaw}
      pitch={degrees.pitch}
      showAngles={spread.projection !== 'diagram'}
      hint={
        spread.projection === 'diagram' ? t('panels:diagram.pose.panHint', 'Drag to pan · Scroll to zoom') : undefined
      }
    >
      {(canvasClassName) => (
        <Viewport3d
          ref={viewport}
          initialView={cameraSpreadViewportView(spread.camera, rotationDeg)}
          onView={push}
          onGesture={onGesture}
          interactive={!readOnly}
          orbitEnabled={spread.projection !== 'diagram'}
          className={canvasClassName}
          label={t('panels:diagram.pose.cameraSpreadView', 'Spread model: drag to turn, middle-drag to pan')}
        />
      )}
    </DiagramPoseStage>
  );
}
