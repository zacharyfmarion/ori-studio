/**
 * An OBJ's preview, for a flat folded figure: its paper in 3D, the layers
 * lifted by the dialog's spread, drawn as the Diagram's Perspective 3D draws
 * a spread (`perspectiveSpread`) — which is the file's geometry — and turned
 * by dragging, as Pose turns a perspective step. Fold and Diagram's renderer
 * draws it (`useSpreadRenderer`) into the simulator's viewport.
 *
 * While the fold is read, folded again or solved it says so, and when it
 * cannot be, why.
 */
import type { OrbitView } from '@treemaker/origami-simulator';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DEFAULT_FOLDED_3D_CAMERA } from '../../cp-workspace/folded/folded3dCamera';
import { folded3dWindowRenderSettings } from '../../cp-workspace/folded/folded3dWindow';
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
  const { t } = useTranslation();
  if (preparation.status === 'ready') return <ObjSpreadView view={preparation.view} spread={spread} style={style} />;
  return (
    <span className={styles.state} data-failed={preparation.status === 'failed' || undefined}>
      {preparation.status === 'failed'
        ? preparation.message
        : t('dialogs:paperExport.preparing', 'Preparing preview…')}
    </span>
  );
}

function ObjSpreadView({ view, spread, style }: { view: ConnectedSpreadView; spread: PaperObjSpread; style: PaperStyle }) {
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
      // No reveal: the camera shows the depth. The amount is the stored one; Perspective 3D lifts it.
      spread: { kind: 'connected', version: 1, amount: spread.on ? spread.amount : 0, reveal: [0, 0] },
      presentation: { kind: 'perspective', camera: withRollAbsorbed(orbit), orderSide },
      rotationDeg: 0,
      width: size.width,
      height: size.height,
      zoom: 1,
      pixelRatio,
      style,
    });
  }, [request, spread, orbit, orderSide, size, pixelRatio, style]);
  const pushCamera = useCallback((camera: OrbitView, width: number, height: number) => {
    setSize((was) => (was.width === width && was.height === height ? was : { width, height }));
    setOrbit(camera);
    setOrderSide((side) => spreadCameraSide(camera, side));
  }, []);
  return (
    <div className={styles.stage} data-status={status}>
      {status !== 'ready' && (
        <span className={styles.state} data-failed={status === 'error' || undefined}>
          {status === 'error'
            ? t('dialogs:paperExport.objPreviewFailed', 'This model couldn’t be drawn in 3D. Its OBJ can still be exported.')
            : t('dialogs:paperExport.preparing', 'Preparing preview…')}
        </span>
      )}
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
