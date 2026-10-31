import { spreadPosePictureFrame, type SpreadPosePicture } from '../../diagram/pictures/spreadPosePicture';
import { clampReveal, sameSpread } from '../../cp-workspace/folded/layerSpreadSettings';
import { useSettledPosePicture } from '../../diagram/capture/useSettledPosePicture';
import { DiagramPoseStage, type DiagramPoseAnnotations } from './DiagramPoseStage';
import { poseGhostMarkup } from '../../diagram/zoom/paintZoomed';
import { spreadFrame } from '../../layer-spread/spreadFrame';
import { CAPTURE_PX_PER_UNIT } from '../../diagram/capture/captureGeometry';
import { sameCamera } from '../../diagram/capture/poseController';
import { cameraDegrees } from '../../diagram/pictures/cameraDegrees';
import { spreadCameraSide } from '../../layer-spread/presentation';
import { registerDiagramGestureCancel } from '../../diagram/useDiagramShortcuts';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { ConnectedSpread } from '@oristudio/layer-spread';
import type { OrbitView } from '@treemaker/origami-simulator';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { SpreadPresentation } from '../../layer-spread/presentation';
import { useSpreadRenderer } from '../../layer-spread/useSpreadRenderer';
import type { FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dWindowRenderSettings } from '../../cp-workspace/folded/folded3dWindow';
import { withRollAbsorbed } from '../../lib/simulatorOrbit';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import { SimulatorViewport, type SimulatorViewportHandle } from '../../simulator/SimulatorViewport';
import type { SimulatorViewHandle } from '../../simulator/simulatorViewRegistry';
import type { DiagramStyle } from '../../diagram/document/diagramDocument';
import { diagramPaperStyle } from '../../diagram/pictures/diagramPaperStyle';
import styles from './DiagramSpreadView.module.css';

const ignoreRenderSettings = () => {};

/** Fold and Diagram share the drawing pass. This host supplies Pose's existing
 * full-orbit controls only for the perspective presentation. */
export function DiagramSpreadView({
  view,
  spread,
  capturedSpread,
  picture,
  presentation,
  rotationDeg,
  style,
  onCamera,
  onReveal,
  registerLiveView,
  fallback,
  ghost = null,
  readOnly = false,
}: {
  view: ConnectedSpreadView;
  spread: ConnectedSpread;
  capturedSpread: ConnectedSpread;
  picture: SpreadPosePicture;
  presentation?: SpreadPresentation;
  rotationDeg: number;
  style: DiagramStyle;
  onCamera: (camera: FoldedFigureCamera) => void;
  onReveal: (reveal: [number, number]) => void;
  registerLiveView?: (view: SimulatorViewHandle) => () => void;
  fallback: ReactNode;
  ghost?: DiagramPoseAnnotations | null;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const viewport = useRef<SimulatorViewportHandle | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [orbit, setOrbit] = useState<OrbitView>(presentation?.camera ?? DEFAULT_FOLDED_3D_CAMERA);
  const [reveal, setReveal] = useState<[number, number]>(spread.reveal);
  const [zoom, setZoom] = useState(1);
  const [orderSide, setOrderSide] = useState(presentation?.orderSide ?? 'front');
  const spatial = presentation?.kind === 'perspective';
  const reportedCamera = useRef<FoldedFigureCamera | null>(null);
  const drag = useRef<{ id: number; x: number; y: number; start: [number, number]; shown: [number, number] } | null>(
    null,
  );
  const present = useCallback((bitmap: ImageBitmap) => viewport.current?.presentBitmap(bitmap), []);
  const { status, request } = useSpreadRenderer(view, present);
  const paper = useMemo(() => diagramPaperStyle(style), [style]);
  const settings = useMemo(
    () => folded3dWindowRenderSettings({ style: paper, displayStyle: 'Paper5', devicePixelRatio: 1 }),
    [paper],
  );
  useEffect(() => {
    if (!drag.current) setReveal(spread.reveal);
  }, [spread.reveal]);
  useEffect(() => {
    const camera = presentation?.camera ?? DEFAULT_FOLDED_3D_CAMERA;
    setOrbit(camera);
    setOrderSide(presentation?.orderSide ?? 'front');
    viewport.current?.setView(camera);
  }, [presentation?.camera, presentation?.orderSide]);
  useEffect(() => {
    if (status !== 'error' && spatial && registerLiveView)
      return registerLiveView({ setUpright: () => viewport.current?.setUpright() });
  }, [spatial, registerLiveView, status]);
  useEffect(() => {
    request({
      spread: { ...spread, reveal },
      presentation: spatial ? { kind: 'perspective', camera: withRollAbsorbed(orbit), orderSide } : undefined,
      rotationDeg,
      width: size.width,
      height: size.height,
      zoom,
      style: paper,
    });
  }, [request, spread, reveal, spatial, orbit, orderSide, rotationDeg, size, zoom, paper]);
  const pushCamera = useCallback(
    (camera: OrbitView, width: number, height: number) => {
      setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
      if (spatial) {
        setOrbit(camera);
        setOrderSide((side) => spreadCameraSide(camera, side));
        const shown = withRollAbsorbed(camera);
        // Resize/settings effects resend the same camera. They must not restart
        // the idle capture or invalidate one just because its busy state changed.
        if (!reportedCamera.current || !sameCamera(shown, reportedCamera.current)) {
          reportedCamera.current = shown;
          if (!readOnly) onCamera(shown);
        }
      }
    },
    [spatial, onCamera, readOnly],
  );
  useEffect(() => {
    if (!canvas || spatial) return;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      setZoom((z) => Math.max(0.2, Math.min(5, z * Math.exp(-event.deltaY * 0.001))));
    };
    canvas.addEventListener('wheel', wheel, { passive: false });
    return () => canvas.removeEventListener('wheel', wheel);
  }, [canvas, spatial]);
  useEffect(
    () =>
      registerDiagramGestureCancel(() => {
        const d = drag.current;
        if (!d) return false;
        drag.current = null;
        setReveal(d.start);
        return true;
      }),
    [],
  );
  const down = (event: PointerEvent) => {
    if (spatial || readOnly || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, start: reveal, shown: reveal };
  };
  const move = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    const box = event.currentTarget.getBoundingClientRect();
    const unit = Math.max(100, Math.min(box.width, box.height)) * 0.22;
    const xy: [number, number] = [d.start[0] + (event.clientX - d.x) / unit, d.start[1] + (event.clientY - d.y) / unit];
    d.shown = clampReveal(xy, d.shown);
    setReveal(d.shown);
  };
  const end = (event: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    if (event.type === 'pointercancel') {
      setReveal(d.start);
      return;
    }
    if (d.start[0] !== d.shown[0] || d.start[1] !== d.shown[1]) onReveal(d.shown);
  };
  const ghostMarkup = useMemo(() => {
    if (
      !ghost ||
      reveal[0] !== spread.reveal[0] ||
      reveal[1] !== spread.reveal[1] ||
      (spatial && !sameCamera(withRollAbsorbed(orbit), presentation?.camera ?? DEFAULT_FOLDED_3D_CAMERA))
    )
      return null;
    const frame = spreadFrame(view, rotationDeg, spatial, size.width, size.height, zoom),
      k = frame.scale / CAPTURE_PX_PER_UNIT;
    const b = ghost.bounds;
    return poseGhostMarkup(
      ghost.annotations,
      { x: frame.x + b.minX * k, y: frame.y + b.minY * k, width: (b.maxX - b.minX) * k, height: (b.maxY - b.minY) * k },
      style,
      ghost.zoom,
    );
  }, [ghost, reveal, spread.reveal, spatial, orbit, presentation?.camera, view, rotationDeg, size, zoom, style]);
  const pose = useMemo(() => ({ view, spread, reveal, orbit, orderSide, rotationDeg, spatial, zoom, size }),
    [view, spread, reveal, orbit, orderSide, rotationDeg, spatial, zoom, size]);
  const matchesCapture = sameSpread({ ...spread, reveal }, capturedSpread) &&
    (!spatial || (sameCamera(withRollAbsorbed(orbit), presentation!.camera) && orderSide === presentation!.orderSide));
  const settled = useSettledPosePicture(pose, matchesCapture ? picture.url : null);
  const pictureFrame = useMemo(() => spreadPosePictureFrame(picture, view, style, rotationDeg, spatial, size, zoom),
    [picture, view, style, rotationDeg, spatial, size, zoom]);
  const degrees = cameraDegrees(withRollAbsorbed(orbit));
  if (status === 'error') return <>{fallback}</>;
  return (
    <div
      className={styles.view}
      data-status={status}
      onPointerDownCapture={(event) => settled.down(event.pointerId)}
      onPointerUpCapture={(event) => settled.up(event.pointerId)}
      onPointerCancelCapture={(event) => settled.up(event.pointerId)}
      onLostPointerCapture={(event) => { settled.up(event.pointerId); end(event); }}
      onWheelCapture={settled.wake}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={end}
      onPointerCancel={end}
    >
      {status === 'preparing' && fallback}
      <DiagramPoseStage
        status={status}
        finalPicture={settled.url && <img className={styles.finalPicture} src={settled.url} alt="" draggable={false}
          style={pictureFrame ?? { transform: `scale(${spatial ? 1 : zoom})` }} data-framed={!!pictureFrame || undefined}
          data-pose-final-picture="" />}
        hidden={status === 'preparing'}
        cameraReadout={spatial}
        yaw={degrees.yaw}
        pitch={degrees.pitch}
        ghost={(!settled.url || picture.scene || picture.sceneFrame) && ghostMarkup ? { markup: ghostMarkup, ...size } : null}
        hint={spatial ? undefined : t('panels:diagram.spread.revealHint', 'Drag to reveal layers · Scroll to zoom')}
      >
        {(canvasClassName) => (
          <SimulatorViewport
            ref={viewport}
            canvasKey="connected-spread"
            onCanvasChange={setCanvas}
            interactive={spatial && !readOnly}
            gpuActive
            bitmapPresent
            transparentBackground
            viewCube={spatial}
            initialView={presentation?.camera ?? DEFAULT_FOLDED_3D_CAMERA}
            pushCamera={pushCamera}
            pushRenderSettings={ignoreRenderSettings}
            viewSettings={DEFAULT_SIMULATOR_SETTINGS}
            paperStyle={paper}
            renderSettings={settings}
            className={canvasClassName}
            ariaLabel={
              spatial
                ? t('panels:diagram.pose.view3d', 'Folded model in 3D: drag to turn it')
                : t('panels:diagram.spread.drag', 'Drag to reveal layers')
            }
            perfSurface="diagram-pose"
          />
        )}
      </DiagramPoseStage>
    </div>
  );
}
