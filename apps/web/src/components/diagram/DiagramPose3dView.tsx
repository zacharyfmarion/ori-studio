import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrbitView } from '@treemaker/origami-simulator';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dMesh } from '../../cp-workspace/folded/folded3dMesh';
import {
  folded3dFrameFillZoom,
  folded3dWindowRenderSettings,
  folded3dWindowView,
} from '../../cp-workspace/folded/folded3dWindow';
import { useFolded3dMeshRuntime } from '../../cp-workspace/folded/useFolded3dMeshRuntime';
import type { DiagramPoseSpatialView } from '../../diagram/capture/useDiagramLinkedPose';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { diagramPaperStyle } from '../../diagram/pictures/diagramPaperStyle';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import { SimulatorViewport, type SimulatorViewportHandle } from '../../simulator/SimulatorViewport';
import styles from './DiagramPose3dView.module.css';

/** Frame edge, in device pixels, the crease width is calibrated for: Edit's window's. */
const CREASE_REFERENCE_EDGE = 512;

/**
 * A step folded in 3D, live, to be turned in Pose (D5): the mesh Edit's 3D
 * window draws, in the simulator's worker, but taking the drag itself, with the
 * view cube for the named views. The camera the step stores is pushed in (an
 * undo or a named view moves it); every move is reported, and the hook captures
 * the picture once the view rests.
 *
 * Where the worker cannot draw — no WebGL2 there — `fallback` (the captured
 * picture) is shown instead, and the toolbar's named views still turn it.
 */
export function DiagramPose3dView({
  view,
  camera,
  style,
  onCamera,
  fallback,
}: {
  view: DiagramPoseSpatialView;
  camera: FoldedFigureCamera;
  style: DiagramStyle;
  onCamera: (camera: FoldedFigureCamera) => void;
  fallback: ReactNode;
}) {
  const { t } = useTranslation();
  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  const [, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const mesh = useMemo(() => {
    const result = folded3dMesh(view.model, view.aux);
    return result.kind === 'mesh' ? result.mesh : null;
  }, [view]);
  const present = useCallback((bitmap: ImageBitmap) => viewportRef.current?.presentBitmap(bitmap), []);
  const { status, setCamera, setRenderSettings } = useFolded3dMeshRuntime({ mesh, onFrame: present });

  const paperStyle = useMemo(() => diagramPaperStyle(style), [style]);
  const renderSettings = useMemo(
    () =>
      folded3dWindowRenderSettings({
        style: paperStyle,
        displayStyle: 'Paper5',
        devicePixelRatio: typeof window === 'undefined' ? 1 : (window.devicePixelRatio ?? 1),
      }),
    [paperStyle]
  );

  // The stored camera, pushed in whenever it changes from outside the drag.
  const stored = useMemo(() => folded3dWindowView(camera), [camera]);
  useEffect(() => {
    viewportRef.current?.setView(stored);
  }, [stored]);

  const pushCamera = useCallback(
    (orbit: OrbitView, width: number, height: number) => {
      // The frame is the model's bounding sphere, as in Edit's window and in
      // the captured scene (`folded3dSceneCamera`), so the two agree.
      setCamera({ ...orbit, zoom: orbit.zoom * folded3dFrameFillZoom(width, height) }, width, height);
      onCamera(
        orbit.orient
          ? { yaw: orbit.yaw, pitch: orbit.pitch, zoom: orbit.zoom, orient: orbit.orient }
          : { yaw: orbit.yaw, pitch: orbit.pitch, zoom: orbit.zoom }
      );
    },
    [setCamera, onCamera]
  );

  if (!mesh || status === 'error') return <>{fallback}</>;
  return (
    <div className={styles.view} data-status={status}>
      <SimulatorViewport
        ref={viewportRef}
        canvasKey="diagram-pose-3d"
        onCanvasChange={setCanvas}
        interactive
        gpuActive
        bitmapPresent
        transparentBackground
        creaseWidthReferenceEdge={CREASE_REFERENCE_EDGE}
        creaseWidthShrinkExponent={1}
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        paperStyle={paperStyle}
        renderSettings={renderSettings}
        viewCube
        initialView={stored}
        pushCamera={pushCamera}
        pushRenderSettings={setRenderSettings}
        className={styles.canvas}
        ariaLabel={t('panels:diagram.pose.view3d', 'Folded model in 3D: drag to turn it')}
        perfSurface="diagram-pose"
      />
    </div>
  );
}
