import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import type { OrbitView } from '@treemaker/origami-simulator';
import { folded3dFrameRadius, type FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
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
import { cameraDegrees } from '../../diagram/pictures/cameraDegrees';
import { poseGhostMarkup } from '../../diagram/zoom/paintZoomed';
import { folded3dCaptureFrame } from '../../diagram/pictures/folded3dCaptureFrame';
import { poseCreaseReferenceEdge } from '../../diagram/pictures/poseLineWeight';
import { withRollAbsorbed } from '../../lib/simulatorOrbit';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import { SimulatorViewport, type SimulatorViewportHandle } from '../../simulator/SimulatorViewport';
import { simulatorDevicePixelRatio } from '../../simulator/simulatorDevicePixelRatio';
import type { SimulatorViewHandle } from '../../simulator/simulatorViewRegistry';
import { sameCamera } from '../../diagram/capture/poseController';
import { DiagramPoseStage, type DiagramPoseAnnotations } from './DiagramPoseStage';


/**
 * A step folded in 3D, live, to be turned in Pose (D5): the mesh Edit's 3D
 * window draws, in the simulator's worker, but taking the drag itself, with the
 * view cube for the named views. The camera the step stores is pushed in (an
 * undo or a named view moves it); every move is reported, and the hook captures
 * the picture once the view rests.
 *
 * Over it, the camera's yaw and pitch in the corner, how to turn it, and the
 * step's annotations ghosted (`ghost`) while the view shows the camera they
 * were drawn at — the capture's frame is found on the view by
 * `folded3dCaptureFrame`. A turn away hides them: they belong to that picture.
 *
 * Where the worker cannot draw — no WebGL2 there — `fallback` (the captured
 * picture) is shown instead, and the toolbar's named views still turn it.
 * While the view is up it is registered (`registerLiveView`) for the
 * toolbar's Set Upright, which only a live view can take its up from.
 */
export function DiagramPose3dView({
  view,
  camera,
  style,
  onCamera,
  registerLiveView,
  ghost,
  fallback,
}: {
  view: DiagramPoseSpatialView;
  camera: FoldedFigureCamera;
  style: DiagramStyle;
  onCamera: (camera: FoldedFigureCamera) => void;
  registerLiveView?: (view: SimulatorViewHandle) => () => void;
  /** The annotations to ghost, when they are in step with the stored picture; null otherwise. */
  ghost: DiagramPoseAnnotations | null;
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

  // What the view shows, for the readout and the ghost: its camera as the step
  // would store it, and its size in the device px it is drawn at. Each a
  // primitive or a value compared on the way in, so an orbit frame that moves
  // neither renders nothing.
  const storedRef = useRef(camera);
  useLayoutEffect(() => {
    storedRef.current = camera;
  }, [camera]);
  const [yaw, setYaw] = useState(() => cameraDegrees(camera).yaw);
  const [pitch, setPitch] = useState(() => cameraDegrees(camera).pitch);
  const showDegrees = useCallback((shown: FoldedFigureCamera) => {
    const degrees = cameraDegrees(shown);
    setYaw(degrees.yaw);
    setPitch(degrees.pitch);
  }, []);
  const [atStored, setAtStored] = useState(true);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);

  const pushCamera = useCallback(
    (orbit: OrbitView, width: number, height: number) => {
      // The frame is the model's bounding sphere, as in Edit's window and in
      // the captured scene (`folded3dSceneCamera`), so the two agree.
      setCamera({ ...orbit, zoom: orbit.zoom * folded3dFrameFillZoom(width, height) }, width, height);
      // A step's camera has no roll of its own: a Shift-drag or the cube's
      // ring is kept in its orientation, so what is captured is what is shown.
      const kept = withRollAbsorbed(orbit);
      const shown: FoldedFigureCamera = kept.orient
        ? { yaw: kept.yaw, pitch: kept.pitch, zoom: kept.zoom, orient: kept.orient }
        : { yaw: kept.yaw, pitch: kept.pitch, zoom: kept.zoom };
      showDegrees(shown);
      setAtStored(sameCamera(shown, storedRef.current));
      setSize((was) => (was?.width === width && was.height === height ? was : { width, height }));
      onCamera(shown);
    },
    [setCamera, onCamera, showDegrees]
  );
  // A new stored camera (the view rested and was captured, or an undo) is the
  // view's own: the next push says whether the view still shows it.
  useEffect(() => showDegrees(camera), [camera, showDegrees]);

  const frameRadius = useMemo(() => folded3dFrameRadius(view.model), [view]);
  const ghostMarkup = useMemo(() => {
    if (!ghost || !size || (ghost.annotations.length === 0 && !ghost.zoom)) return null;
    const frame = folded3dCaptureFrame(ghost.bounds, frameRadius, size.width, size.height);
    return frame ? poseGhostMarkup(ghost.annotations, frame, style, ghost.zoom) : null;
  }, [ghost, size, frameRadius, style]);

  const live = mesh !== null && status !== 'error';
  useEffect(
    () => (live && registerLiveView ? registerLiveView({ setUpright: () => viewportRef.current?.setUpright() }) : undefined),
    [live, registerLiveView]
  );

  if (!live) return <>{fallback}</>;
  return (
    <DiagramPoseStage
      status={status}
      ghost={ghostMarkup && atStored && size ? { markup: ghostMarkup, ...size } : null}
      yaw={yaw}
      pitch={pitch}
    >
      {(canvasClassName) => (
        <SimulatorViewport
          ref={viewportRef}
          canvasKey="diagram-pose-3d"
          onCanvasChange={setCanvas}
          interactive
          gpuActive
          bitmapPresent
          transparentBackground
          // Its lines grow with the stage as the step's picture does when Pose shows it there.
          creaseWidthReferenceEdge={poseCreaseReferenceEdge(simulatorDevicePixelRatio())}
          creaseWidthShrinkExponent={1}
          creaseWidthGrows
          viewSettings={DEFAULT_SIMULATOR_SETTINGS}
          paperStyle={paperStyle}
          renderSettings={renderSettings}
          viewCube
          initialView={stored}
          pushCamera={pushCamera}
          pushRenderSettings={setRenderSettings}
          className={canvasClassName}
          ariaLabel={t('panels:diagram.pose.view3d', 'Folded model in 3D: drag to turn it')}
          perfSurface="diagram-pose"
        />
      )}
    </DiagramPoseStage>
  );
}
