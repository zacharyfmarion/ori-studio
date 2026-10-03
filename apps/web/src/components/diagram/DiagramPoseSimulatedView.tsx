import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Pause, Play, RotateCcw, StepForward } from 'lucide-react';
import { CARD_FRAME_PX, paintAnnotations } from '../../diagram/annotate/paintAnnotations';
import type { KnownCreases } from '../../diagram/capture/captureCreases';
import type { SimulatedRest } from '../../diagram/capture/poseController';
import {
  useDiagramSimulatedPose,
  type DiagramSimulatedPose,
} from '../../diagram/capture/useDiagramSimulatedPose';
import type {
  DiagramCpScope,
  DiagramSimulatedView,
  DiagramStyle,
} from '../../diagram/document/diagramDocument';
import { cameraDegrees } from '../../diagram/pictures/cameraDegrees';
import { diagramPaperStyle } from '../../diagram/pictures/diagramPaperStyle';
import { simulatedCaptureFrame } from '../../diagram/pictures/simulatedCaptureFrame';
import { DEFAULT_SIMULATOR_SETTINGS } from '../../lib/simulatorSettings';
import { SimulatorViewport } from '../../simulator/SimulatorViewport';
import { SIMULATED_FRAME_PX } from '../../store/workspaceStore/diagramCapture';
import { IconButton } from '../ui/IconButton';
import { Slider } from '../ui/Slider';
import { DiagramPoseStage, type DiagramPoseAnnotations } from './DiagramPoseStage';
import styles from './DiagramPoseSimulatedView.module.css';

/** Frame edge, in device pixels, the crease width is calibrated for: an inline window's. */
const CREASE_REFERENCE_EDGE = 512;

/** Nothing here needs the canvas element itself: the drag and the wheel are the viewport's. */
const ignoreCanvas = () => {};

/**
 * A step shown as Simulated, live in Pose (D19): the region's model in the
 * simulator, at the step's fold % and camera, to be folded with the transport
 * and turned with a drag or the view cube. Each rest is captured
 * (`useDiagramSimulatedPose`).
 *
 * The transport is handed to `toolbar`, the detail's Pose bar, between its
 * Show switch and its Reset. While the simulator cannot run here — no pattern
 * open, the region gone, no WebGL2 in its worker, a region with no model, a
 * solver that failed — the captured picture (`fallback`) shows with a line
 * saying why, and the bar still shows the step another way.
 */
export function DiagramPoseSimulatedView({
  stepId,
  scope,
  known,
  render,
  style,
  annotations,
  onRest,
  wantsRest,
  fallback,
  toolbar,
}: {
  stepId: string;
  scope: DiagramCpScope;
  /** What the step remembers of its creases: its sheet is folded wherever it is now. */
  known: KnownCreases;
  render: { foldPercent: number; view: DiagramSimulatedView };
  style: DiagramStyle;
  /** The annotations to ghost, when they are in step with the stored picture; null otherwise. */
  annotations: DiagramPoseAnnotations | null;
  onRest: (rest: SimulatedRest) => Promise<void>;
  /** Whether a rest at a pose would be captured: asked before its scene is drawn. */
  wantsRest: (pose: Pick<SimulatedRest, 'foldPercent' | 'view'>) => boolean;
  fallback: ReactNode;
  toolbar: (transport: ReactNode) => ReactNode;
}) {
  const { t } = useTranslation();
  const pose = useDiagramSimulatedPose({ stepId, scope, known, render, onRest, wantsRest });
  const paperStyle = useMemo(() => diagramPaperStyle(style), [style]);
  // The view opens where the step is; later poses come through `setView`.
  const [opening] = useState(render.view);
  const degrees = cameraDegrees(pose.view ?? render.view);

  const { size, atStored } = pose;
  const ghost = useMemo(() => {
    if (!annotations || !size || !atStored || annotations.annotations.length === 0) return null;
    const frame = simulatedCaptureFrame(annotations.bounds, SIMULATED_FRAME_PX, size.width, size.height);
    const markup = frame ? (paintAnnotations(annotations.annotations, frame, CARD_FRAME_PX, style)?.markup ?? null) : null;
    return markup ? { markup, ...size } : null;
  }, [annotations, size, atStored, style]);

  const live = pose.status === 'ready' || pose.status === 'loading';
  const note = useMemo(() => {
    switch (pose.status) {
      case 'no-gpu':
        return t(
          'panels:diagram.pose.simulatedNeedsGpu',
          'Folding it here needs WebGL2. Its picture stays as it is.'
        );
      case 'no-pattern':
        return t('panels:diagram.pose.simulatedNoPattern', 'Open its crease pattern in Edit to fold it here.');
      case 'missing':
        return t(
          'panels:diagram.pose.simulatedMissing',
          'Its pattern isn’t in the crease pattern any more: relink it to fold it here.'
        );
      case 'unavailable':
        return t('panels:diagram.pose.simulatedUnavailable', 'This pattern can’t be simulated.');
      case 'error':
        return pose.error ?? t('panels:diagram.pose.simulatedFailed', 'The simulation failed.');
      default:
        return null;
    }
  }, [pose.status, pose.error, t]);

  return (
    <>
      {pose.status !== 'ready' && fallback}
      {live && (
        <DiagramPoseStage
          status={pose.status}
          hidden={pose.status !== 'ready'}
          ghost={ghost}
          yaw={degrees.yaw}
          pitch={degrees.pitch}
        >
          {(canvasClassName) => (
            <SimulatorViewport
              ref={pose.viewportRef}
              canvasKey="diagram-pose-simulated"
              onCanvasChange={ignoreCanvas}
              interactive={pose.status === 'ready'}
              gpuActive={pose.runtime.gpuActive}
              bitmapPresent
              transparentBackground
              creaseWidthReferenceEdge={CREASE_REFERENCE_EDGE}
              creaseWidthShrinkExponent={1}
              viewSettings={DEFAULT_SIMULATOR_SETTINGS}
              paperStyle={paperStyle}
              viewCube
              initialView={opening}
              pushCamera={pose.pushCamera}
              pushRenderSettings={pose.runtime.setRenderSettings}
              className={canvasClassName}
              ariaLabel={t('panels:diagram.pose.viewSimulated', 'Simulated model: drag to turn it')}
              perfSurface="diagram-pose-simulated"
            />
          )}
        </DiagramPoseStage>
      )}
      {note && (
        <p className={styles.note} role="status">
          {note}
        </p>
      )}
      {toolbar(<DiagramSimulatedTransport pose={pose} />)}
    </>
  );
}

/**
 * The simulator's transport in Pose, as Simulate's: back to flat, play or
 * pause, a step on, and the fold % to scrub. Live only while the simulator is.
 */
function DiagramSimulatedTransport({ pose }: { pose: DiagramSimulatedPose }) {
  const { t } = useTranslation();
  const disabled = pose.status !== 'ready';
  const percent = Math.round(pose.foldPercent);
  const play = pose.playing
    ? t('panels:diagram.pose.pause', 'Pause')
    : t('panels:diagram.pose.play', 'Play');
  return (
    <>
      <IconButton
        size="sm"
        title={`${t('panels:diagram.pose.backToFlat', 'Back to Flat')} (Home)`}
        aria-label={t('panels:diagram.pose.backToFlat', 'Back to Flat')}
        disabled={disabled}
        onClick={pose.rewind}
      >
        <RotateCcw size={15} />
      </IconButton>
      <IconButton size="sm" title={`${play} (Space)`} aria-label={play} disabled={disabled} onClick={pose.togglePlay}>
        {pose.playing ? <Pause size={15} /> : <Play size={15} />}
      </IconButton>
      <IconButton
        size="sm"
        title={`${t('panels:diagram.pose.foldStep', 'Fold a Step')} (→)`}
        aria-label={t('panels:diagram.pose.foldStep', 'Fold a Step')}
        disabled={disabled}
        onClick={pose.step}
      >
        <StepForward size={15} />
      </IconButton>
      <Slider
        className={styles.scrub}
        min={0}
        max={100}
        step={1}
        value={percent}
        disabled={disabled}
        aria-label={t('panels:diagram.pose.foldPercent', 'Fold percent')}
        aria-valuetext={t('panels:diagram.pose.percent', '{{value}}%', { value: percent })}
        onChange={pose.scrub}
      />
      <output className={styles.percent}>{t('panels:diagram.pose.percent', '{{value}}%', { value: percent })}</output>
    </>
  );
}
