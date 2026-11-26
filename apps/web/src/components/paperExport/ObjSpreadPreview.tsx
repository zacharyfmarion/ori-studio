/**
 * An OBJ's preview, for a folded figure whose spread the dialog sets: its
 * paper in 3D, the layers lifted as the file lifts them, turned by dragging,
 * with the view cube for the named views.
 *
 * - **A flat figure** is drawn as the Diagram's Perspective 3D draws a spread
 *   at the figure's spread's version (`connectedDrawAmount`), by Fold and
 *   Diagram's renderer (`useSpreadRenderer`) into the simulator's viewport.
 * - **A 3D figure** is drawn as its window draws it, the spread a uniform on
 *   the solved displacement field (`usePreparedSpatialMesh`) at the figure's
 *   spread's version (`spatialDrawAmount`), by the 3D window's runtime, from
 *   the figure's own camera — as Pose draws a step folded in 3D.
 *
 * While the fold is read, folded again or solved it says so, and when it
 * cannot be, why.
 */
import type { ConnectedSpread } from '@oristudio/layer-spread';
import type { OrbitView } from '@treemaker/origami-simulator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_FOLDED_3D_CAMERA, type FoldedFigureCamera } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dMesh } from '../../cp-workspace/folded/folded3dMesh';
import type { SpatialSpread } from '../../cp-workspace/folded/foldedFigureSpread';
import {
  folded3dFrameFillZoom,
  folded3dWindowRenderSettings,
  folded3dWindowView,
} from '../../cp-workspace/folded/folded3dWindow';
import { useFolded3dMeshRuntime } from '../../cp-workspace/folded/useFolded3dMeshRuntime';
import { spatialDrawAmount } from '../../cp-workspace/folded/spatialSpreadSettings';
import { usePreparedSpatialMesh } from '../../cp-workspace/folded/useSpatialFoldedMesh';
import type { OristudioCpFolded3dRenderModel } from '../../engine/oristudioCpTypes';
import { spreadCameraSide, type SpreadPresentation } from '../../layer-spread/presentation';
import { useSpreadRenderer } from '../../layer-spread/useSpreadRenderer';
import type { ConnectedSpreadView } from '../../layer-spread/view';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import { withRollAbsorbed } from '../../lib/simulatorOrbit';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import type { PaperObjSpread } from '../../paperExport/paperExportTarget';
import type { PaperObjSpreadPreparation } from '../../paperExport/usePaperObjSpread';
import { SimulatorViewport, type SimulatorViewportHandle } from '../../simulator/SimulatorViewport';
import { simulatorDevicePixelRatio } from '../../simulator/simulatorDevicePixelRatio';
import styles from './ObjSpreadPreview.module.css';

const nothing = () => {};

export function ObjSpreadPreview({
  preparation,
  spread,
  style,
}: {
  preparation: PaperObjSpreadPreparation;
  spread: PaperObjSpread;
  /** The page's style as the figure's surface reads it: the paper's colours. */
  style: PaperStyle;
}) {
  if (preparation.status === 'ready') {
    const { view } = preparation;
    return view.kind === 'connected' ? (
      <ConnectedObjView view={view.view} version={view.version} spread={spread} style={style} />
    ) : (
      <SpatialObjView model={view.model} camera={view.camera} version={view.version} spread={spread} style={style} />
    );
  }
  return <ObjPreviewState failed={preparation.status === 'failed' ? preparation.message : null} />;
}

/** What the box says while there is no view: preparing, or why there is none. */
function ObjPreviewState({ failed }: { failed: string | null }) {
  const { t } = useTranslation();
  return (
    <span className={styles.state} data-failed={failed !== null || undefined}>
      {failed ?? t('dialogs:paperExport.preparing', 'Preparing preview…')}
    </span>
  );
}

/** The view's own state over it, until it draws: preparing, or that it could not. */
function ViewState({ status }: { status: 'preparing' | 'error' }) {
  const { t } = useTranslation();
  return (
    <ObjPreviewState
      failed={
        status === 'error'
          ? t('dialogs:paperExport.objPreviewFailed', 'This model couldn’t be drawn in 3D. Its OBJ can still be exported.')
          : null
      }
    />
  );
}

function ConnectedObjView({
  view,
  version,
  spread,
  style,
}: {
  view: ConnectedSpreadView;
  version: ConnectedSpread['version'];
  spread: PaperObjSpread;
  style: PaperStyle;
}) {
  const { t } = useTranslation();
  const viewport = useRef<SimulatorViewportHandle | null>(null);
  const [size, setSize] = useState({ width: 1, height: 1 });
  const [orbit, setOrbit] = useState<OrbitView>(DEFAULT_FOLDED_3D_CAMERA);
  const [orderSide, setOrderSide] = useState<SpreadPresentation['orderSide']>('front');
  const present = useCallback((bitmap: ImageBitmap) => viewport.current?.presentBitmap(bitmap), []);
  const { status, request } = useSpreadRenderer(view, present);
  const settings = useMemo(
    () => folded3dWindowRenderSettings({ style, displayStyle: 'Paper5', devicePixelRatio: 1 }),
    [style]
  );
  const pixelRatio = simulatorDevicePixelRatio();
  useEffect(() => {
    request({
      // No reveal: the camera shows the depth. The amount is the stored one; Perspective 3D lifts it by its version.
      spread: { kind: 'connected', version, amount: spread.on ? spread.amount : 0, reveal: [0, 0] },
      presentation: { kind: 'perspective', camera: withRollAbsorbed(orbit), orderSide },
      rotationDeg: 0,
      width: size.width,
      height: size.height,
      zoom: 1,
      pixelRatio,
      style,
    });
  }, [request, version, spread, orbit, orderSide, size, pixelRatio, style]);
  const pushCamera = useCallback((camera: OrbitView, width: number, height: number) => {
    setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    setOrbit(camera);
    setOrderSide((side) => spreadCameraSide(camera, side));
  }, []);
  return (
    <div className={styles.stage} data-status={status}>
      {status !== 'ready' && <ViewState status={status === 'error' ? 'error' : 'preparing'} />}
      <SimulatorViewport
        ref={viewport}
        canvasKey="obj-spread"
        onCanvasChange={nothing}
        interactive={status === 'ready'}
        gpuActive
        bitmapPresent
        transparentBackground
        viewCube
        initialView={DEFAULT_FOLDED_3D_CAMERA}
        pushCamera={pushCamera}
        pushRenderSettings={nothing}
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        paperStyle={style}
        renderSettings={settings}
        className={styles.canvas}
        ariaLabel={t('panels:diagram.pose.view3d', 'Folded model in 3D: drag to turn it')}
        perfSurface="paper-export-obj"
      />
    </div>
  );
}

function SpatialObjView({
  model,
  camera,
  version,
  spread,
  style,
}: {
  model: OristudioCpFolded3dRenderModel;
  camera: FoldedFigureCamera | null;
  version: SpatialSpread['version'];
  spread: PaperObjSpread;
  style: PaperStyle;
}) {
  const { t } = useTranslation();
  const viewport = useRef<SimulatorViewportHandle | null>(null);
  const spreads = spread.on && spread.amount > 0;
  // The fold as it lies, and its spread's base mesh — the solve the file was prepared from — to lift.
  const folded = useMemo(() => {
    const result = folded3dMesh(model, null);
    return result.kind === 'mesh' ? result.mesh : null;
  }, [model]);
  const { mesh: spatial } = usePreparedSpatialMesh(model, null, true);
  const mesh = spreads ? spatial : folded;
  const gain = spatial?.spreadGain;
  const present = useCallback((bitmap: ImageBitmap) => viewport.current?.presentBitmap(bitmap), []);
  const { status, setCamera, setRenderSettings } = useFolded3dMeshRuntime({ mesh, onFrame: present });
  const settings = useMemo(
    () => ({
      ...folded3dWindowRenderSettings({ style, displayStyle: 'Paper5', devicePixelRatio: simulatorDevicePixelRatio() }),
      // The spread is a uniform on the solved displacement, as the window lifts it.
      displacementScale: spreads ? spatialDrawAmount({ kind: 'spatial', version, amount: spread.amount }, gain) : 0,
    }),
    [style, spreads, version, spread.amount, gain]
  );
  const initial = useMemo(() => folded3dWindowView(camera), [camera]);
  const pushCamera = useCallback(
    (orbit: OrbitView, width: number, height: number) =>
      // Framed on the model's bounding sphere, as the figure's window frames it.
      setCamera({ ...orbit, zoom: orbit.zoom * folded3dFrameFillZoom(width, height) }, width, height),
    [setCamera]
  );
  const shown = mesh !== null && status === 'ready';
  return (
    <div className={styles.stage} data-status={shown ? 'ready' : status}>
      {!shown && <ViewState status={status === 'error' ? 'error' : 'preparing'} />}
      <SimulatorViewport
        ref={viewport}
        canvasKey="obj-spread-3d"
        onCanvasChange={nothing}
        interactive={shown}
        gpuActive
        bitmapPresent
        transparentBackground
        viewCube
        initialView={initial}
        pushCamera={pushCamera}
        pushRenderSettings={setRenderSettings}
        viewSettings={DEFAULT_SIMULATOR_SETTINGS}
        paperStyle={style}
        renderSettings={settings}
        className={styles.canvas}
        ariaLabel={t('panels:diagram.pose.view3d', 'Folded model in 3D: drag to turn it')}
        perfSurface="paper-export-obj-3d"
      />
    </div>
  );
}
