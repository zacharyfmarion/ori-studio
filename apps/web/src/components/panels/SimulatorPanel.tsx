import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { simulatorAccuracyLabel, simulatorAccuracyTitle } from '../../i18n/enumLabels';
import type { TFunction } from 'i18next';
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Layers3,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  StepForward,
  Sun,
  Waves,
} from 'lucide-react';
import type {
  FoldDocument as SimulatorFoldDocument,
  RenderSettings,
} from '@treemaker/origami-simulator';
import {
  useSimulatorRuntime,
  type SimulatorFrameView,
  type SimulatorModelView,
} from '../../simulator/useSimulatorRuntime';
import type { SimulatorRenderModel } from '../../simulator/renderModel';
import { buildSequenceStepSimulation } from '../../lib/sequenceSimulation';
import { buildSegmentFold, resolveCpSegments } from '../../lib/creasePatternSegmentation';
import { SimulatorSegmentsSidebar } from './SimulatorSegmentsPanel';
import {
  STEP_SIMULATION_ACCURACY_OPTIONS,
  simulatorRunConfig,
  type StepSimulationAccuracy,
} from '../../lib/simulatorRunConfig';
import {
  nextSimulatorOrbitView,
  type SimulatorOrbitView as SimulatorView,
} from '../../lib/simulatorOrbit';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useWorkspaceCapabilities } from '../../store/workspaceStore/useWorkspaceCapabilities';
import { IconButton } from '../ui/IconButton';
import { SegmentedControl } from '../ui/SegmentedControl';
import { NextDocumentAction } from './NextDocumentAction';

type LoadState = 'idle' | 'loading' | 'ready' | 'empty' | 'error';
type SimulatorRenderMode = 'paper' | 'xray';

interface SimulatorViewSettings {
  renderMode: SimulatorRenderMode;
  showFaces: boolean;
  showEdges: boolean;
  showHiddenLines: boolean;
  lighting: boolean;
}

interface SimulatorHighlights {
  creases: Set<number>;
  faces: Set<number>;
}

interface DragState {
  pointerId: number;
  x: number;
  y: number;
  yaw: number;
  pitch: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
  depth: number;
}

interface ScreenPoint extends ProjectedPoint {
  sx: number;
  sy: number;
}

interface DepthSurface {
  depths: Float32Array;
  width: number;
  height: number;
}

const PAPER_EDGE_DEPTH_EPSILON = 0.006;
const INITIAL_FOLD_PERCENT = 0;
const DEFAULT_VIEW: SimulatorView = { yaw: 0, pitch: 0.38, zoom: 1 };
const DEFAULT_VIEW_SETTINGS: SimulatorViewSettings = {
  renderMode: 'paper',
  showFaces: true,
  showEdges: true,
  showHiddenLines: false,
  lighting: true,
};
const PAPER_LIGHT_DIRECTION = normalizeVector({ x: -0.45, y: 0.58, z: 0.68 });
const EMPTY_HIGHLIGHTS: SimulatorHighlights = {
  creases: new Set(),
  faces: new Set(),
};

export function SimulatorPanel() {
  const { t } = useTranslation();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // The solver lives in a worker; this component only holds the latest frame it
  // published and draws it. There is no controller, no model and no step loop on
  // this thread any more.
  const modelRef = useRef<SimulatorModelView | null>(null);
  const frameRef = useRef<SimulatorFrameView | null>(null);
  const playRafRef = useRef<number | null>(null);
  const viewRef = useRef<SimulatorView>({ ...DEFAULT_VIEW });
  const viewSettingsRef = useRef<SimulatorViewSettings>(DEFAULT_VIEW_SETTINGS);
  const highlightsRef = useRef<SimulatorHighlights>(EMPTY_HIGHLIGHTS);
  const dragRef = useRef<DragState | null>(null);
  const foldPercentRef = useRef(INITIAL_FOLD_PERCENT);
  const sourceKeyRef = useRef<string | null>(null);
  // Tracks the runtime's gpuActive without a stale closure, so the pointer/draw
  // handlers can branch on it synchronously.
  const gpuActiveRef = useRef(false);
  // The mounted canvas element, as state (not just a ref) so the runtime hook
  // re-runs once it exists and can transfer it to the worker.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  const setCanvas = useCallback((element: HTMLCanvasElement | null) => {
    canvasRef.current = element;
    setCanvasEl(element);
  }, []);

  const creaseCount = useWorkspaceStore((state) => state.project.creases.length);
  // Editable (hand-drawn / imported) crease patterns live in the oristudio CP
  // document, not `project.creases`, so they are a valid simulation source even
  // when `creaseCount` is 0.
  const hasEditableCp = useWorkspaceStore((state) => state.oristudioCpDocument !== null);
  const foldArtifacts = useWorkspaceStore((state) => state.foldArtifacts);
  const foldArtifactRevision = useWorkspaceStore((state) => state.foldArtifactRevision);
  const selectedSegmentId = useWorkspaceStore((state) => state.selectedSegmentId);
  const foldArtifactError = useWorkspaceStore((state) => state.foldArtifactError);
  const foldArtifactStatus = useWorkspaceStore((state) => state.foldArtifactStatus);
  const sequencePlan = useWorkspaceStore((state) => state.sequencePlan);
  const sequenceSimulationFocus = useWorkspaceStore((state) => state.sequenceSimulationFocus);
  const setSequenceSimulationFocus = useWorkspaceStore((state) => state.setSequenceSimulationFocus);
  const ensureFoldArtifacts = useWorkspaceStore((state) => state.ensureFoldArtifacts);
  const refreshFoldArtifacts = useWorkspaceStore((state) => state.refreshFoldArtifacts);
  const capabilities = useWorkspaceCapabilities();

  const [foldPercent, setFoldPercent] = useState(INITIAL_FOLD_PERCENT);
  const [loadState, setLoadState] = useState<LoadState>('idle');
  const [modelError, setModelError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [strain, setStrain] = useState(0);
  const [modelStats, setModelStats] = useState({ vertices: 0, triangles: 0 });
  const [backend, setBackend] = useState<'webgl2' | 'reference' | null>(null);
  const [viewSettings, setViewSettings] = useState<SimulatorViewSettings>(DEFAULT_VIEW_SETTINGS);
  const [stepAccuracy, setStepAccuracy] = useState<StepSimulationAccuracy>('fast');
  const refreshCapability = capabilities['simulator.refresh'];
  const stepSimulationResult = useMemo(
    () =>
      sequenceSimulationFocus.kind === 'sequence_step'
        ? buildSequenceStepSimulation(sequencePlan, sequenceSimulationFocus.stepId)
        : null,
    [sequencePlan, sequenceSimulationFocus]
  );
  const activeStepSimulation = stepSimulationResult?.ok ? stepSimulationResult.simulation : null;
  const stepSimulationError =
    stepSimulationResult && !stepSimulationResult.ok ? stepSimulationResult.reason : null;
  const simulatorMode = sequenceSimulationFocus.kind === 'sequence_step' ? 'step' : 'whole';
  const runConfig = useMemo(
    () => simulatorRunConfig(simulatorMode, stepAccuracy),
    [simulatorMode, stepAccuracy]
  );
  // Segment the whole document's fold and simulate only the selected pattern.
  // Memoized so a new sub-fold object is not produced on every render (which
  // would thrash the prepare/dispose effect). Sequence-step mode is unaffected.
  const activeSegmentId = useMemo(() => {
    if (activeStepSimulation || simulatorMode !== 'whole') return null;
    const segments = resolveCpSegments(foldArtifacts);
    if (segments.length <= 1) return null;
    const segment = segments.find((candidate) => candidate.id === selectedSegmentId) ?? segments[0];
    return segment?.id ?? null;
  }, [activeStepSimulation, foldArtifacts, selectedSegmentId, simulatorMode]);
  const simulationFold = useMemo(() => {
    if (activeStepSimulation) return activeStepSimulation.fold;
    const wholeFold = foldArtifacts?.simulation_model?.fold ?? foldArtifacts?.fold ?? null;
    if (!wholeFold) return null;
    if (activeSegmentId !== null) {
      const segment = resolveCpSegments(foldArtifacts).find((c) => c.id === activeSegmentId);
      if (segment) return buildSegmentFold(wholeFold, segment);
    }
    return wholeFold;
  }, [activeStepSimulation, foldArtifacts, activeSegmentId]);
  const simulationFoldProfile = activeStepSimulation?.foldProfile ?? null;
  const simulationModelError =
    stepSimulationError ?? (!activeStepSimulation ? foldArtifacts?.simulation_model_error : null);
  const simulationSourceKey = activeStepSimulation
    ? `step:${activeStepSimulation.step.id}:${activeStepSimulation.beforeState.id}:${activeStepSimulation.afterState.id}`
    : sequenceSimulationFocus.kind === 'sequence_step'
      ? `step-error:${sequenceSimulationFocus.stepId}:${stepSimulationError ?? 'unknown'}`
      : `whole:${foldArtifacts ? foldArtifactRevision : 'empty'}:${activeSegmentId ?? 'all'}`;

  // In GPU-render mode the worker owns the canvas and draws; this no-ops. In CPU
  // mode it rasterises the latest frame on the main thread.
  const drawCurrentFrame = useCallback(() => {
    if (gpuActiveRef.current) return;
    const canvas = canvasRef.current;
    const model = modelRef.current;
    const frame = frameRef.current;
    if (!canvas || !model || !frame || !frame.positions) return;
    drawFrame(canvas, model, frame, viewRef.current, viewSettingsRef.current, highlightsRef.current);
  }, []);

  const handleFrame = useCallback(
    (frame: SimulatorFrameView) => {
      frameRef.current = frame;
      setStep(frame.step);
      setStrain(frame.maxEdgeStrain);
      setFoldPercent(frame.foldPercent);
      foldPercentRef.current = frame.foldPercent;
      drawCurrentFrame();
    },
    [drawCurrentFrame]
  );

  // A fold profile (segment/sequence-step simulation) uses a solver path the GPU
  // renderer does not cover, so those keep the canvas-2D path.
  const allowGpuRender = !simulationFoldProfile;

  const runtime = useSimulatorRuntime({
    fold: simulationFold as SimulatorFoldDocument | null,
    foldProfile: simulationFoldProfile,
    solverOptions: runConfig.solverOptions,
    triangulate: simulationFold ? foldNeedsTriangulation(simulationFold) : true,
    canvas: canvasEl,
    allowGpuRender,
    onFrame: handleFrame,
  });

  const {
    status: runtimeStatus,
    model: runtimeModel,
    playing,
    setPlaying,
    gpuActive,
    setCamera: pushCamera,
    setRenderSettings: pushRenderSettings,
  } = runtime;

  useEffect(() => {
    gpuActiveRef.current = gpuActive;
  }, [gpuActive]);

  // Device-pixel drawing-buffer size of the canvas. In GPU mode the worker needs
  // it to size its render; read from the element's box (which exists even once
  // control is transferred). Declared before the effects that call it.
  const deviceSize = useCallback(() => {
    const canvas = canvasRef.current;
    const rect = canvas?.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    return {
      width: Math.max(360, Math.floor((rect?.width || 720) * dpr)),
      height: Math.max(360, Math.floor((rect?.height || 720) * dpr)),
    };
  }, []);

  // Apply the current orbit view: forward it to the worker (GPU) or redraw on
  // the main thread (CPU). This is what makes orbit/zoom cheap in GPU mode -- one
  // small message and a texture-fed redraw, no solver work.
  const pushView = useCallback(() => {
    if (gpuActiveRef.current) {
      const { width, height } = deviceSize();
      pushCamera(viewRef.current, width, height);
    } else {
      drawCurrentFrame();
    }
  }, [deviceSize, drawCurrentFrame, pushCamera]);

  useEffect(() => {
    modelRef.current = runtimeModel;
    invalidateSimulatorSurface(canvasRef.current);
    if (runtimeModel) {
      setModelStats({ vertices: runtimeModel.vertexCount, triangles: runtimeModel.faceCount });
      setBackend(runtimeModel.backend);
    } else {
      setModelStats({ vertices: 0, triangles: 0 });
      setBackend(null);
    }
    drawCurrentFrame();
  }, [runtimeModel, drawCurrentFrame]);

  useEffect(() => {
    viewSettingsRef.current = viewSettings;
    if (gpuActiveRef.current) {
      const canvas = canvasRef.current;
      if (canvas) pushRenderSettings(toRenderSettings(canvas, viewSettings));
    } else {
      drawCurrentFrame();
    }
  }, [drawCurrentFrame, pushRenderSettings, viewSettings]);

  useEffect(() => {
    highlightsRef.current = activeStepSimulation
      ? {
          creases: new Set(activeStepSimulation.affectedCreases),
          faces: new Set(activeStepSimulation.affectedFaces),
        }
      : EMPTY_HIGHLIGHTS;
    drawCurrentFrame();
  }, [activeStepSimulation, drawCurrentFrame]);

  // Reset the fold target when the source model genuinely changes, so switching
  // segment or sequence step does not inherit the previous scrub position.
  useEffect(() => {
    if (sourceKeyRef.current === simulationSourceKey) return;
    sourceKeyRef.current = simulationSourceKey;
    foldPercentRef.current = INITIAL_FOLD_PERCENT;
    setFoldPercent(INITIAL_FOLD_PERCENT);
    setPlaying(false);
  }, [simulationSourceKey, setPlaying]);

  // Load/error state is derived from the runtime plus the surrounding document
  // state; there is no separate solver lifecycle to track any more.
  useEffect(() => {
    if (simulatorMode === 'step') {
      if (stepSimulationError) {
        setModelError(stepSimulationError);
        setLoadState('error');
      } else if (activeStepSimulation) {
        setModelError(null);
        setLoadState(runtimeStatus === 'ready' ? 'ready' : 'loading');
      } else {
        setModelError(t('panels:simulator.stepSimulationUnavailable', 'Step simulation unavailable.'));
        setLoadState('error');
      }
      return;
    }

    if (creaseCount === 0 && !hasEditableCp) {
      setPlaying(false);
      setModelError(null);
      setLoadState('empty');
      return;
    }

    if (runtime.error) {
      setModelError(runtime.error);
      setLoadState('error');
      return;
    }

    if (foldArtifacts) {
      setModelError(simulationModelError ?? null);
      if (simulationModelError) {
        setLoadState('error');
        return;
      }
      setLoadState(runtimeStatus === 'ready' ? 'ready' : 'loading');
      return;
    }

    setModelError(null);
    if (foldArtifactStatus === 'loading') {
      setLoadState('loading');
      return;
    }
    if (foldArtifactStatus === 'error') {
      setModelError(foldArtifactError ?? t('panels:simulator.unavailable', 'Simulator unavailable'));
      setLoadState('error');
      return;
    }
    setLoadState('loading');
    void ensureFoldArtifacts();
  }, [
    creaseCount,
    hasEditableCp,
    foldArtifacts,
    foldArtifactError,
    foldArtifactStatus,
    ensureFoldArtifacts,
    simulationModelError,
    simulatorMode,
    activeStepSimulation,
    stepSimulationError,
    runtimeStatus,
    runtime.error,
    setPlaying,
    t,
  ]);

  // Scrubbing the fold slider settles to the new target in the worker rather
  // than stepping a fixed batch here.
  const setFoldTarget = useCallback(
    (percent: number) => {
      const next = clamp(percent, 0, 100);
      setPlaying(false);
      foldPercentRef.current = next;
      setFoldPercent(next);
      runtime.settleTo(next);
    },
    [runtime, setPlaying]
  );

  const stepFoldTarget = useCallback(() => {
    setFoldTarget(
      Math.min(
        100,
        Math.floor(foldPercentRef.current / runConfig.foldStepPercent + 1) * runConfig.foldStepPercent
      )
    );
  }, [runConfig.foldStepPercent, setFoldTarget]);

  const replayFromFlat = useCallback(() => {
    setPlaying(false);
    foldPercentRef.current = 0;
    setFoldPercent(0);
    runtime.reset();
  }, [runtime, setPlaying]);

  // Play advances the fold target over time; the worker does the solving, so
  // this callback only ever computes a number and hands it over.
  useEffect(() => {
    if (!playing || typeof window === 'undefined' || runtimeStatus !== 'ready') return;

    if (foldPercentRef.current >= 100) {
      foldPercentRef.current = 0;
      setFoldPercent(0);
      runtime.reset();
    }

    let previousTime: number | null = null;
    const tick = (time: number) => {
      if (previousTime === null) previousTime = time;
      const elapsedSeconds = Math.min(0.08, (time - previousTime) / 1000);
      previousTime = time;
      const nextPercent = Math.min(
        100,
        foldPercentRef.current + elapsedSeconds * runConfig.foldPlayPercentPerSecond
      );

      foldPercentRef.current = nextPercent;
      runtime.setFoldPercent(nextPercent);

      if (nextPercent >= 100) {
        playRafRef.current = null;
        setPlaying(false);
        return;
      }
      playRafRef.current = window.requestAnimationFrame(tick);
    };

    playRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (playRafRef.current !== null) window.cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
    };
  }, [playing, runtime, runConfig.foldPlayPercentPerSecond, runtimeStatus, setPlaying]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined' || !canvasEl) return;
    const observer = new ResizeObserver(() => {
      // Size is cached, so the cache is what has to notice a resize. The
      // observer also fires once on observe, which is how the worker first
      // learns the canvas's real (post-layout) size in GPU mode -- the
      // transferred canvas starts at the default 300x150 otherwise.
      invalidateSimulatorSurface(canvasEl);
      pushView();
    });
    observer.observe(canvasEl);
    return () => observer.disconnect();
  }, [canvasEl, pushView]);

  // The palette is read from CSS custom properties, so it has to be re-read when
  // the theme flips. Watching the documentElement's class/data attributes covers
  // both the app's own toggle and an OS-level change.
  useEffect(() => {
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(() => {
      invalidateSimulatorSurface(canvasRef.current);
      drawCurrentFrame();
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, [drawCurrentFrame]);

  useEffect(() => {
    drawCurrentFrame();
  }, [drawCurrentFrame]);

  const resetView = useCallback(() => {
    viewRef.current = { ...DEFAULT_VIEW };
    pushView();
  }, [pushView]);

  // When the GPU path becomes active (first load, or after a mode switch), send
  // the worker the current camera and settings so it does not draw with
  // defaults.
  useEffect(() => {
    if (!gpuActive) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    pushRenderSettings(toRenderSettings(canvas, viewSettingsRef.current));
    pushView();
  }, [gpuActive, pushRenderSettings, pushView]);

  const handleCanvasPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (loadState !== 'ready') return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      yaw: viewRef.current.yaw,
      pitch: viewRef.current.pitch,
    };
  };

  const handleCanvasPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    viewRef.current = nextSimulatorOrbitView(viewRef.current, drag, {
      x: event.clientX,
      y: event.clientY,
    });
    pushView();
  };

  const handleCanvasPointerEnd = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  };

  const handleCanvasWheel = (event: ReactWheelEvent<HTMLCanvasElement>) => {
    if (loadState !== 'ready') return;
    event.preventDefault();
    viewRef.current = {
      ...viewRef.current,
      zoom: clamp(viewRef.current.zoom * Math.exp(-event.deltaY * 0.001), 0.45, 4),
    };
    pushView();
  };

  const errorDetail =
    stepSimulationError ?? modelError ?? foldArtifactError ?? t('panels:simulator.unavailable', 'Simulator unavailable');
  const statusLabel =
    loadState === 'ready'
      ? t('panels:simulator.stats', '{{vertices}} vertices | {{triangles}} triangles', {
          vertices: modelStats.vertices,
          triangles: modelStats.triangles,
        })
      : loadState === 'loading'
        ? t('panels:simulator.loading', 'Loading')
        : loadState === 'empty'
          ? t('panels:simulator.noCreasePattern', 'No crease pattern')
          : loadState === 'error'
            ? shortStatus(errorDetail, t)
            : t('panels:simulator.idle', 'Idle');

  return (
    <div className="simulator-workspace">
      <SimulatorSegmentsSidebar />
      <section className="panel-shell simulator-panel">
      <div className="panel-toolbar">
        <div className="panel-toolbar__group">
          <Waves size={14} />
          <span className="panel-title">{t('panels:simulator.title', 'Simulator')}</span>
        </div>
        {/* Scope controls hidden while the Sequence panel is hidden (always "whole"). */}
        <div className="panel-toolbar__group simulator-scope-controls" style={{ display: 'none' }}>
          <SegmentedControl
            aria-label={t('panels:simulator.scope', 'Simulator scope')}
            value={simulatorMode}
            onChange={(mode) => {
              if (mode === 'whole') {
                setSequenceSimulationFocus({ kind: 'whole' });
                return;
              }
              if (sequenceSimulationFocus.kind === 'sequence_step') return;
              const firstStep = sequencePlan?.steps[0];
              if (firstStep) {
                setSequenceSimulationFocus({ kind: 'sequence_step', stepId: firstStep.id });
              }
            }}
            options={[
              {
                value: 'whole',
                label: t('panels:simulator.scopeWhole', 'Whole'),
                title: t('panels:simulator.scopeWholeTitle', 'Simulate the whole crease pattern'),
              },
              {
                value: 'step',
                label: t('panels:simulator.scopeStep', 'Step'),
                title: t('panels:simulator.scopeStepTitle', 'Simulate the selected sequence step'),
              },
            ]}
          />
          {activeStepSimulation && (
            <span className="simulator-step-chip">
              {t('panels:simulator.stepChip', 'Step {{n}}: {{kind}}', {
                n: activeStepSimulation.stepIndex + 1,
                kind: formatKind(activeStepSimulation.step.kind),
              })}
            </span>
          )}
          {activeStepSimulation?.warning && (
            <span className="simulator-step-chip simulator-step-chip--warn">
              <AlertTriangle size={12} />
              {t('panels:simulator.manualPreview', 'Manual preview')}
            </span>
          )}
          {simulatorMode === 'step' && (
            <div className="simulator-accuracy-controls">
              <SegmentedControl
                aria-label={t('panels:simulator.stepAccuracy', 'Step simulation accuracy')}
                value={stepAccuracy}
                onChange={setStepAccuracy}
                options={STEP_SIMULATION_ACCURACY_OPTIONS.map((option) => ({
                  ...option,
                  label: simulatorAccuracyLabel(t, option.value),
                  title: simulatorAccuracyTitle(t, option.value),
                }))}
              />
            </div>
          )}
        </div>
        <div
          className="panel-toolbar__group simulator-view-settings"
          aria-label={t('panels:simulator.viewSettings', 'Simulator view settings')}
        >
          <SegmentedControl
            aria-label={t('panels:simulator.renderMode', 'Simulator render mode')}
            value={viewSettings.renderMode}
            onChange={(renderMode) => setViewSettings((current) => ({ ...current, renderMode }))}
            options={[
              {
                value: 'paper',
                label: t('panels:simulator.renderPaper', 'Paper'),
                title: t('panels:simulator.renderPaperTitle', 'Paper rendering'),
              },
              {
                value: 'xray',
                label: t('panels:simulator.renderXray', 'X-ray'),
                title: t('panels:simulator.renderXrayTitle', 'X-ray rendering'),
              },
            ]}
          />
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:simulator.faces', 'Faces')}
            tooltipSide="bottom"
            isActive={viewSettings.showFaces}
            onClick={() => setViewSettings((current) => ({ ...current, showFaces: !current.showFaces }))}
          >
            <Square size={14} />
          </IconButton>
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:simulator.creaseLines', 'Crease Lines')}
            tooltipSide="bottom"
            isActive={viewSettings.showEdges}
            onClick={() => setViewSettings((current) => ({ ...current, showEdges: !current.showEdges }))}
          >
            {viewSettings.showEdges ? <Eye size={14} /> : <EyeOff size={14} />}
          </IconButton>
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:simulator.hiddenLines', 'Hidden Lines')}
            tooltipSide="bottom"
            isActive={viewSettings.showHiddenLines}
            onClick={() =>
              setViewSettings((current) => ({
                ...current,
                showHiddenLines: !current.showHiddenLines,
              }))
            }
            disabled={!viewSettings.showEdges}
          >
            <Layers3 size={14} />
          </IconButton>
          <IconButton
            size="sm"
            variant="toolbar"
            title={t('panels:simulator.lighting', 'Lighting')}
            tooltipSide="bottom"
            isActive={viewSettings.lighting}
            onClick={() => setViewSettings((current) => ({ ...current, lighting: !current.lighting }))}
          >
            <Sun size={14} />
          </IconButton>
        </div>
      </div>
      <div className="panel-body simulator-panel__body">
        <canvas
          // Keyed on the render path: a fold profile switches to the canvas-2D
          // path, and a canvas whose control was transferred to the worker can
          // never take a 2D context, so it must be a fresh element.
          key={allowGpuRender ? 'gl' : '2d'}
          ref={setCanvas}
          className="simulator-canvas"
          data-lighting={viewSettings.lighting || undefined}
          aria-label={t(
            'panels:simulator.canvasAriaLabel',
            'Origami folded-base simulator. Drag to rotate, scroll to zoom, double-click to reset view.'
          )}
          title={t('panels:simulator.canvasTitle', 'Drag to rotate, scroll to zoom, double-click to reset view')}
          onPointerDown={handleCanvasPointerDown}
          onPointerMove={handleCanvasPointerMove}
          onPointerUp={handleCanvasPointerEnd}
          onPointerCancel={handleCanvasPointerEnd}
          onDoubleClick={resetView}
          onWheel={handleCanvasWheel}
        />
        {loadState !== 'ready' && (
          <div className="simulator-panel__empty">
            <span title={loadState === 'error' ? errorDetail : undefined}>{statusLabel}</span>
            {loadState === 'error' && <small>{errorDetail}</small>}
            {loadState === 'empty' && <NextDocumentAction />}
          </div>
        )}
      </div>
      <div className="simulator-controls">
        <div className="simulator-transport" aria-label={t('panels:simulator.controls', 'Simulation controls')}>
          <IconButton
            size="sm"
            title={t('panels:simulator.refresh', 'Refresh')}
            tooltipSide="top"
            onClick={() => {
              setPlaying(false);
              setModelError(null);
              void refreshFoldArtifacts();
            }}
            disabled={!refreshCapability.enabled}
          >
            <RefreshCw size={14} />
          </IconButton>
          <IconButton
            size="sm"
            title={playing ? t('panels:simulator.pause', 'Pause') : t('panels:simulator.play', 'Play')}
            tooltipSide="top"
            onClick={() => setPlaying(!playing)}
            disabled={loadState !== 'ready'}
          >
            {playing ? <Pause size={14} /> : <Play size={14} />}
          </IconButton>
          <IconButton
            size="sm"
            title={t('panels:simulator.step', 'Step')}
            tooltipSide="top"
            onClick={stepFoldTarget}
            disabled={loadState !== 'ready'}
          >
            <StepForward size={14} />
          </IconButton>
          <IconButton
            size="sm"
            title={t('panels:simulator.reset', 'Reset')}
            tooltipSide="top"
            onClick={replayFromFlat}
            disabled={loadState !== 'ready'}
          >
            <RotateCcw size={14} />
          </IconButton>
        </div>
        <label className="simulator-slider">
          <span>
            {simulatorMode === 'step'
              ? t('panels:simulator.step', 'Step')
              : t('panels:simulator.fold', 'Fold')}
          </span>
          <input
            aria-label={
              simulatorMode === 'step'
                ? t('panels:simulator.stepPercent', 'Step percent')
                : t('panels:simulator.foldPercent', 'Fold percent')
            }
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(foldPercent)}
            onChange={(event) => setFoldTarget(Number(event.currentTarget.value))}
            disabled={loadState !== 'ready'}
          />
          <output>{t('panels:simulator.percent', '{{value}}%', { value: Math.round(foldPercent) })}</output>
        </label>
        <div className="simulator-readout">
          <span>{statusLabel}</span>
          <span>{t('panels:simulator.stepReadout', 'Step {{n}}', { n: step })}</span>
          <span>{t('panels:simulator.strain', 'Strain {{value}}', { value: strain.toFixed(4) })}</span>
          {backend && (
            <span
              title={
                backend === 'webgl2'
                  ? t('panels:simulator.backendGpuTitle', 'Solving on the GPU (WebGL2)')
                  : t('panels:simulator.backendCpuTitle', 'Solving on the CPU (WebGL2 unavailable)')
              }
            >
              {backend === 'webgl2'
                ? t('panels:simulator.backendGpu', 'GPU')
                : t('panels:simulator.backendCpu', 'CPU')}
            </span>
          )}
        </div>
      </div>
      </section>
    </div>
  );
}


function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function shortStatus(message: string, t: TFunction): string {
  const trimmed = message.trim();
  if (!trimmed) return t('panels:simulator.unavailable', 'Simulator unavailable');
  const sentence = trimmed.split(/[.;]\s+/u)[0] ?? trimmed;
  return sentence.length > 54 ? `${sentence.slice(0, 51)}...` : sentence;
}

function formatKind(kind: string): string {
  return kind.replaceAll('_', ' ');
}

function foldNeedsTriangulation(fold: SimulatorFoldDocument): boolean {
  return fold.faces_vertices.some((face) => face.length !== 3);
}

/**
 * Per-canvas cache for the things `drawFrame` needs but that do not change per
 * frame: drawing-buffer size (layout), palette (computed style), and the
 * framing radius used by the auto-fit.
 *
 * Invalidated by the panel on resize and on theme change. This is deliberately
 * keyed off the canvas element so it survives re-renders and dies with it.
 */
interface SimulatorSurface {
  width: number;
  height: number;
  dpr: number;
  palette: SimulatorPalette;
  framingRadius: (positions: Float32Array) => number;
}

const surfaceCache = new WeakMap<HTMLCanvasElement, SimulatorSurface>();

export function invalidateSimulatorSurface(canvas: HTMLCanvasElement | null): void {
  if (canvas) surfaceCache.delete(canvas);
}

function surfaceFor(canvas: HTMLCanvasElement): SimulatorSurface {
  const cached = surfaceCache.get(canvas);
  if (cached) return cached;

  const rect = canvas.getBoundingClientRect();
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  let radius: number | null = null;

  const surface: SimulatorSurface = {
    width: Math.max(360, Math.floor((rect.width || 720) * dpr)),
    height: Math.max(360, Math.floor((rect.height || 720) * dpr)),
    dpr,
    palette: readSimulatorPalette(canvas),
    framingRadius: (positions) => {
      // Measured from the first frame after a (re)fit and held, so the folded
      // form shrinks on screen as it actually shrinks.
      radius ??= boundsRadius(positions);
      return radius;
    },
  };
  surfaceCache.set(canvas, surface);
  return surface;
}

function drawFrame(
  canvas: HTMLCanvasElement,
  model: SimulatorRenderModel,
  frame: SimulatorFrameView,
  view: SimulatorView,
  settings: SimulatorViewSettings,
  highlights: SimulatorHighlights
): void {
  // Canvas size and palette are cached rather than read per frame. Both used to
  // be recomputed on every draw: getBoundingClientRect forces layout and
  // getComputedStyle forces style recalc, so a 60fps loop was paying for two
  // full style/layout flushes per frame purely to learn things that only change
  // on resize and on theme change.
  const surface = surfaceFor(canvas);
  const { width, height, dpr } = surface;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const palette = surface.palette;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = palette.canvas;
  ctx.fillRect(0, 0, width, height);

  // Only the canvas-2D path calls this, and only with a frame that carries
  // positions (GPU-render frames are null and drawn by the worker).
  const positions = frame.positions;
  if (!positions) return;

  const projected = projectPositions(positions, view);
  const padding = Math.max(28, Math.min(width, height) * 0.08);
  const availableSize = Math.max(1, Math.min(width, height) - padding * 2);
  // Framing radius is measured once per model rather than per frame. Refitting
  // every frame made the model visibly "breathe" as it folded -- the sheet gets
  // smaller as it closes, so the auto-fit zoomed in to compensate -- and cost
  // three extra full walks of the position array per draw.
  const scale = (availableSize / (2 * surface.framingRadius(positions))) * view.zoom;
  const map = (point: ProjectedPoint) => ({
    x: width / 2 + point.x * scale,
    y: height / 2 - point.y * scale,
  });

  const triangles = triangleOrder(model.indices, projected);
  const faceAlpha = settings.renderMode === 'xray' ? 0.48 : 1;
  const surfaceEdgeAlpha = settings.renderMode === 'xray' ? 0.5 : 0.92;

  if (settings.renderMode === 'paper' && settings.showFaces) {
    if (settings.lighting) {
      drawProjectedPaperShadow(ctx, triangles, projected, map, width, height, dpr);
    }
    const depthSurface = drawPaperFacesWithDepth(
      ctx,
      model,
      frame,
      triangles,
      projected,
      map,
      width,
      height,
      palette,
      highlights,
      settings.lighting
    );
    if (depthSurface) {
      if (settings.showEdges) {
        drawVisibleEdges(ctx, model, projected, map, dpr, 0.94, palette, highlights, depthSurface);
        if (settings.showHiddenLines) {
          drawAllEdges(ctx, model, projected, map, dpr, 0.26, true, palette, highlights);
        }
      }
      return;
    }
  }

  for (const triangle of triangles) {
    if (settings.showFaces) {
      const highlighted = highlights.faces.has(triangle.faceIndex);
      const a = map(projected[triangle.vertices[0]] ?? { x: 0, y: 0, depth: 0 });
      const b = map(projected[triangle.vertices[1]] ?? { x: 0, y: 0, depth: 0 });
      const c = map(projected[triangle.vertices[2]] ?? { x: 0, y: 0, depth: 0 });
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fillStyle = triangleColor(
        triangle.vertices,
        palette,
        faceAlpha,
        projected,
        settings.lighting
      );
      ctx.fill();
      if (highlighted) {
        ctx.fillStyle = palette.highlightFace;
        ctx.fill();
        ctx.strokeStyle = palette.highlight;
        ctx.globalAlpha = 0.9;
        ctx.lineWidth = Math.max(1.4, dpr * 1.2);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (settings.showEdges && settings.showFaces) {
      drawTriangleEdges(ctx, model, triangle, projected, map, dpr, surfaceEdgeAlpha, palette, highlights);
    }
  }

  if (settings.showEdges && (!settings.showFaces || settings.showHiddenLines)) {
    drawAllEdges(
      ctx,
      model,
      projected,
      map,
      dpr,
      settings.showFaces ? 0.34 : 0.95,
      settings.showFaces && settings.renderMode === 'paper',
      palette,
      highlights
    );
  }
}

function normalizeVector(vector: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  const length = Math.hypot(vector.x, vector.y, vector.z);
  if (length < 0.0001) return { x: 0, y: 0, z: 1 };
  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
}

function projectPositions(positions: Float32Array, view: SimulatorView): ProjectedPoint[] {
  const center = boundsCenter(positions);
  const points: ProjectedPoint[] = [];
  const cosYaw = Math.cos(view.yaw);
  const sinYaw = Math.sin(view.yaw);
  const cosPitch = Math.cos(view.pitch);
  const sinPitch = Math.sin(view.pitch);

  for (let index = 0; index < positions.length; index += 3) {
    const dx = (positions[index] ?? 0) - center.x;
    const dy = (positions[index + 1] ?? 0) - center.y;
    const dz = (positions[index + 2] ?? 0) - center.z;
    const yawX = cosYaw * dx + sinYaw * dz;
    const yawZ = -sinYaw * dx + cosYaw * dz;
    points.push({
      x: yawX,
      y: cosPitch * yawZ - sinPitch * dy,
      depth: sinPitch * yawZ + cosPitch * dy,
    });
  }
  return points;
}

// Centroid (mean of vertex positions) rather than the bounding-box midpoint, so
// the orbit pivot and framing sit on the object's visual center. For an
// asymmetric folded shape the bbox midpoint is offset from the mass center,
// which makes the model swing around an off-center point while orbiting.
function boundsCenter(positions: Float32Array): { x: number; y: number; z: number } {
  let sumX = 0;
  let sumY = 0;
  let sumZ = 0;
  let count = 0;
  for (let index = 0; index < positions.length; index += 3) {
    sumX += positions[index] ?? 0;
    sumY += positions[index + 1] ?? 0;
    sumZ += positions[index + 2] ?? 0;
    count += 1;
  }
  if (count === 0) return { x: 0, y: 0, z: 0 };
  return { x: sumX / count, y: sumY / count, z: sumZ / count };
}

function boundsRadius(positions: Float32Array): number {
  const center = boundsCenter(positions);
  let radius = 0;
  for (let index = 0; index < positions.length; index += 3) {
    radius = Math.max(
      radius,
      Math.hypot(
        (positions[index] ?? 0) - center.x,
        (positions[index + 1] ?? 0) - center.y,
        (positions[index + 2] ?? 0) - center.z
      )
    );
  }
  return Math.max(0.001, radius);
}

interface OrderedTriangle {
  faceIndex: number;
  vertices: [number, number, number];
}

interface SimulatorPalette {
  canvas: string;
  mountain: string;
  valley: string;
  border: string;
  flat: string;
  highlight: string;
  highlightFace: string;
  highlightFaceRgb: [number, number, number];
  paperFrontRgb: [number, number, number];
  paperBackRgb: [number, number, number];
}

function parseCssRgb(value: string, fallback: [number, number, number]): [number, number, number] {
  const hex = value.trim().replace('#', '');
  if (hex.length === 6) {
    const r = Number.parseInt(hex.slice(0, 2), 16);
    const g = Number.parseInt(hex.slice(2, 4), 16);
    const b = Number.parseInt(hex.slice(4, 6), 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  if (hex.length === 3) {
    const r = Number.parseInt(hex[0]! + hex[0], 16);
    const g = Number.parseInt(hex[1]! + hex[1], 16);
    const b = Number.parseInt(hex[2]! + hex[2], 16);
    if (Number.isFinite(r) && Number.isFinite(g) && Number.isFinite(b)) return [r, g, b];
  }
  const match = value.match(/-?\d+(\.\d+)?/g);
  if (match && match.length >= 3) {
    return [Number(match[0]), Number(match[1]), Number(match[2])];
  }
  return fallback;
}

function readSimulatorPalette(canvas: HTMLCanvasElement): SimulatorPalette {
  const styles = getComputedStyle(canvas);
  const cssVar = (name: string, fallback: string) =>
    styles.getPropertyValue(name).trim() || fallback;

  return {
    canvas: cssVar('--bg-canvas', '#0c0f12'),
    mountain: cssVar('--status-danger', '#e06c75'),
    valley: cssVar('--accent-primary', '#5fb3a5'),
    border: cssVar('--text-primary', '#e8edf0'),
    flat: cssVar('--text-secondary', '#aeb9bf'),
    highlight: cssVar('--status-warning', '#f0c674'),
    highlightFace: 'rgb(240 198 116 / 0.3)',
    highlightFaceRgb: [240, 198, 116],
    paperFrontRgb: parseCssRgb(cssVar('--sim-paper-front', '#4f83d6'), [79, 131, 214]),
    paperBackRgb: parseCssRgb(cssVar('--sim-paper-back', '#f2f0e7'), [242, 240, 231]),
  };
}

// Map the panel's view settings + theme palette into the GPU renderer's
// settings. Colours are 0..1 there; the palette is 0..255 / CSS strings.
function toRenderSettings(
  canvas: HTMLCanvasElement,
  settings: SimulatorViewSettings
): RenderSettings {
  const palette = readSimulatorPalette(canvas);
  const norm = (rgb: [number, number, number]): [number, number, number] => [
    rgb[0] / 255,
    rgb[1] / 255,
    rgb[2] / 255,
  ];
  return {
    frontColor: norm(palette.paperFrontRgb),
    backColor: norm(palette.paperBackRgb),
    edgeColor: norm(parseCssRgb(palette.border, [232, 237, 240])),
    background: norm(parseCssRgb(palette.canvas, [12, 15, 18])),
    lightDir: [PAPER_LIGHT_DIRECTION.x, PAPER_LIGHT_DIRECTION.y, PAPER_LIGHT_DIRECTION.z],
    showFaces: settings.showFaces,
    showEdges: settings.showEdges,
    lighting: settings.lighting,
    faceAlpha: settings.renderMode === 'xray' ? 0.48 : 1,
  };
}

function triangleOrder(indices: Uint32Array, projected: ProjectedPoint[]): OrderedTriangle[] {
  const triangles: OrderedTriangle[] = [];
  for (let index = 0; index < indices.length; index += 3) {
    triangles.push({
      faceIndex: Math.floor(index / 3),
      vertices: [indices[index] ?? 0, indices[index + 1] ?? 0, indices[index + 2] ?? 0],
    });
  }
  return triangles.sort((a, b) => averageDepth(a, projected) - averageDepth(b, projected));
}

function drawProjectedPaperShadow(
  ctx: CanvasRenderingContext2D,
  triangles: OrderedTriangle[],
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  width: number,
  height: number,
  dpr: number
): void {
  const size = Math.min(width, height);
  const shadowOffset = Math.max(5 * dpr, size * 0.018);
  const shadowBlur = Math.max(10 * dpr, size * 0.03);
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.24)';
  ctx.shadowBlur = shadowBlur;
  ctx.shadowOffsetX = shadowOffset;
  ctx.shadowOffsetY = shadowOffset * 1.15;
  ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
  ctx.beginPath();

  for (const triangle of triangles) {
    const a = map(projected[triangle.vertices[0]] ?? { x: 0, y: 0, depth: 0 });
    const b = map(projected[triangle.vertices[1]] ?? { x: 0, y: 0, depth: 0 });
    const c = map(projected[triangle.vertices[2]] ?? { x: 0, y: 0, depth: 0 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(c.x, c.y);
    ctx.closePath();
  }

  ctx.fill();
  ctx.restore();
}

function averageDepth(triangle: OrderedTriangle, projected: ProjectedPoint[]): number {
  return triangle.vertices.reduce((total, vertex) => total + (projected[vertex]?.depth ?? 0), 0) / 3;
}

function drawPaperFacesWithDepth(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  frame: SimulatorFrameView,
  triangles: OrderedTriangle[],
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  width: number,
  height: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  lighting: boolean
): DepthSurface | null {
  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    return null;
  }

  const depths = new Float32Array(width * height);
  depths.fill(-Infinity);

  for (const triangle of triangles) {
    const points = triangle.vertices.map((vertex) => {
      const projectedPoint = projected[vertex] ?? { x: 0, y: 0, depth: 0 };
      const screen = map(projectedPoint);
      return {
        ...projectedPoint,
        sx: screen.x,
        sy: screen.y,
      };
    }) as [ScreenPoint, ScreenPoint, ScreenPoint];
    const color = triangleRasterColor(
      triangle.vertices,
      highlights.faces.has(triangle.faceIndex),
      palette,
      projected,
      lighting
    );
    rasterizeDepthTriangle(imageData, depths, width, height, points, color);
  }

  ctx.putImageData(imageData, 0, 0);
  return { depths, width, height };
}

function rasterizeDepthTriangle(
  imageData: ImageData,
  depths: Float32Array,
  width: number,
  height: number,
  points: [ScreenPoint, ScreenPoint, ScreenPoint],
  color: [number, number, number, number]
): void {
  const [a, b, c] = points;
  const area = edgeFunction(a, b, c);
  if (Math.abs(area) < 0.0001) return;

  const minX = clamp(Math.floor(Math.min(a.sx, b.sx, c.sx)), 0, width - 1);
  const maxX = clamp(Math.ceil(Math.max(a.sx, b.sx, c.sx)), 0, width - 1);
  const minY = clamp(Math.floor(Math.min(a.sy, b.sy, c.sy)), 0, height - 1);
  const maxY = clamp(Math.ceil(Math.max(a.sy, b.sy, c.sy)), 0, height - 1);
  const data = imageData.data;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const sample = { sx: x + 0.5, sy: y + 0.5 };
      const w0 = edgeFunction(b, c, sample);
      const w1 = edgeFunction(c, a, sample);
      const w2 = edgeFunction(a, b, sample);
      const inside =
        area > 0
          ? w0 >= -0.001 && w1 >= -0.001 && w2 >= -0.001
          : w0 <= 0.001 && w1 <= 0.001 && w2 <= 0.001;
      if (!inside) continue;

      const n0 = w0 / area;
      const n1 = w1 / area;
      const n2 = w2 / area;
      const depth = n0 * a.depth + n1 * b.depth + n2 * c.depth;
      const pixelIndex = y * width + x;
      if (depth < (depths[pixelIndex] ?? -Infinity)) continue;

      depths[pixelIndex] = depth;
      const offset = pixelIndex * 4;
      data[offset] = color[0];
      data[offset + 1] = color[1];
      data[offset + 2] = color[2];
      data[offset + 3] = color[3];
    }
  }
}

function edgeFunction(
  a: Pick<ScreenPoint, 'sx' | 'sy'>,
  b: Pick<ScreenPoint, 'sx' | 'sy'>,
  point: Pick<ScreenPoint, 'sx' | 'sy'>
): number {
  return (point.sx - a.sx) * (b.sy - a.sy) - (point.sy - a.sy) * (b.sx - a.sx);
}

// The paper is two-tone: the colored (front) side shows when a face's screen
// winding matches PAPER_FRONT_WINDING; folded-over faces reveal the light back.
// Flip this if the flat sheet renders white instead of colored.
const PAPER_FRONT_WINDING: 1 | -1 = 1;

function triangleFaceRgb(
  triangle: number[],
  projected: ProjectedPoint[],
  palette: SimulatorPalette
): [number, number, number] {
  const a = projected[triangle[0]];
  const b = projected[triangle[1]];
  const c = projected[triangle[2]];
  if (!a || !b || !c) return palette.paperFrontRgb;
  const winding = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  return winding * PAPER_FRONT_WINDING >= 0 ? palette.paperFrontRgb : palette.paperBackRgb;
}

function triangleColor(
  triangle: number[],
  palette: SimulatorPalette,
  alpha = 1,
  projected?: ProjectedPoint[],
  lighting = false
): string {
  const base = projected ? triangleFaceRgb(triangle, projected, palette) : palette.paperFrontRgb;
  const [r, g, b] = lighting && projected
    ? shadeRgb(base, triangleLightIntensity(triangle, projected))
    : base;
  return alpha >= 1 ? `rgb(${r} ${g} ${b})` : `rgb(${r} ${g} ${b} / ${alpha})`;
}

function triangleRasterColor(
  triangle: number[],
  highlighted: boolean,
  palette: SimulatorPalette,
  projected: ProjectedPoint[],
  lighting: boolean
): [number, number, number, number] {
  const base = triangleFaceRgb(triangle, projected, palette);
  const shaded = lighting ? shadeRgb(base, triangleLightIntensity(triangle, projected)) : base;
  const rgb = highlighted ? blendRgb(shaded, palette.highlightFaceRgb, 0.3) : shaded;
  return [rgb[0], rgb[1], rgb[2], 255];
}

function triangleLightIntensity(triangle: number[], projected: ProjectedPoint[]): number {
  const a = projected[triangle[0]];
  const b = projected[triangle[1]];
  const c = projected[triangle[2]];
  if (!a || !b || !c) return 1;
  const normal = triangleNormal(a, b, c);
  if (!normal) return 1;
  const oriented = normal.z < 0
    ? { x: -normal.x, y: -normal.y, z: -normal.z }
    : normal;
  const diffuse = Math.max(0, dotVector(oriented, PAPER_LIGHT_DIRECTION));
  return clamp(0.74 + diffuse * 0.3 + oriented.z * 0.04, 0.68, 1.08);
}

function triangleNormal(
  a: ProjectedPoint,
  b: ProjectedPoint,
  c: ProjectedPoint
): { x: number; y: number; z: number } | null {
  const ux = b.x - a.x;
  const uy = b.y - a.y;
  const uz = b.depth - a.depth;
  const vx = c.x - a.x;
  const vy = c.y - a.y;
  const vz = c.depth - a.depth;
  const normal = {
    x: uy * vz - uz * vy,
    y: uz * vx - ux * vz,
    z: ux * vy - uy * vx,
  };
  const length = Math.hypot(normal.x, normal.y, normal.z);
  if (length < 0.0001) return null;
  return {
    x: normal.x / length,
    y: normal.y / length,
    z: normal.z / length,
  };
}

function dotVector(
  a: { x: number; y: number; z: number },
  b: { x: number; y: number; z: number }
): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function shadeRgb(color: [number, number, number], intensity: number): [number, number, number] {
  if (intensity <= 1) {
    return [
      Math.round(color[0] * intensity),
      Math.round(color[1] * intensity),
      Math.round(color[2] * intensity),
    ];
  }
  const lift = Math.min(0.16, intensity - 1);
  return [
    Math.round(color[0] + (255 - color[0]) * lift),
    Math.round(color[1] + (255 - color[1]) * lift),
    Math.round(color[2] + (255 - color[2]) * lift),
  ];
}

function blendRgb(
  base: [number, number, number],
  overlay: [number, number, number],
  alpha: number
): [number, number, number] {
  return [
    Math.round(base[0] * (1 - alpha) + overlay[0] * alpha),
    Math.round(base[1] * (1 - alpha) + overlay[1] * alpha),
    Math.round(base[2] * (1 - alpha) + overlay[2] * alpha),
  ];
}

function drawTriangleEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  triangle: OrderedTriangle,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights
): void {
  const faceEdges = model.facesEdges[triangle.faceIndex] ?? [];
  const pairs: Array<[number, number]> = [
    [triangle.vertices[0], triangle.vertices[1]],
    [triangle.vertices[1], triangle.vertices[2]],
    [triangle.vertices[2], triangle.vertices[0]],
  ];
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1.2, dpr * 1.05);
  pairs.forEach(([from, to], side) => {
    drawEdgeSegment(
      ctx,
      model,
      projected,
      map,
      from,
      to,
      faceEdges[side] ?? findEdge(model.edgesVertices, from, to),
      alpha,
      palette,
      highlights,
      dpr
    );
  });
}

function drawAllEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  dashed: boolean,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights
): void {
  ctx.setLineDash(dashed ? [Math.max(3, dpr * 3), Math.max(3, dpr * 3)] : []);
  ctx.lineWidth = Math.max(1.5, dpr * 1.25);
  model.edgesVertices.forEach((edge, index) => {
    drawEdgeSegment(ctx, model, projected, map, edge[0], edge[1], index, alpha, palette, highlights, dpr);
  });
  ctx.setLineDash([]);
}

function drawVisibleEdges(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  dpr: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  depthSurface: DepthSurface
): void {
  ctx.setLineDash([]);
  ctx.lineWidth = Math.max(1.5, dpr * 1.25);
  model.edgesVertices.forEach((edge, index) => {
    drawVisibleEdgeSegment(
      ctx,
      model,
      projected,
      map,
      edge[0],
      edge[1],
      index,
      alpha,
      palette,
      highlights,
      dpr,
      depthSurface
    );
  });
}

function drawEdgeSegment(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  from: number,
  to: number,
  edgeIndex: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  dpr: number
): void {
  const a = map(projected[from] ?? { x: 0, y: 0, depth: 0 });
  const b = map(projected[to] ?? { x: 0, y: 0, depth: 0 });
  const assignment = model.edgesAssignment[edgeIndex];
  const highlighted = highlights.creases.has(edgeIndex);
  const previousLineWidth = ctx.lineWidth;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = highlighted ? palette.highlight : edgeColor(assignment, palette);
  ctx.globalAlpha = highlighted ? 1 : edgeAlpha(assignment, alpha);
  if (highlighted) ctx.lineWidth = Math.max(ctx.lineWidth, dpr * 3);
  ctx.stroke();
  ctx.lineWidth = previousLineWidth;
  ctx.globalAlpha = 1;
}

function drawVisibleEdgeSegment(
  ctx: CanvasRenderingContext2D,
  model: SimulatorRenderModel,
  projected: ProjectedPoint[],
  map: (point: ProjectedPoint) => { x: number; y: number },
  from: number,
  to: number,
  edgeIndex: number,
  alpha: number,
  palette: SimulatorPalette,
  highlights: SimulatorHighlights,
  dpr: number,
  depthSurface: DepthSurface
): void {
  const fromProjected = projected[from] ?? { x: 0, y: 0, depth: 0 };
  const toProjected = projected[to] ?? { x: 0, y: 0, depth: 0 };
  const a = map(fromProjected);
  const b = map(toProjected);
  const assignment = model.edgesAssignment[edgeIndex];
  const highlighted = highlights.creases.has(edgeIndex);
  const previousLineWidth = ctx.lineWidth;
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
  let segmentStart: { x: number; y: number } | null = null;
  let previousVisible: { x: number; y: number } | null = null;

  ctx.strokeStyle = highlighted ? palette.highlight : edgeColor(assignment, palette);
  ctx.globalAlpha = highlighted ? 1 : edgeAlpha(assignment, alpha);
  if (highlighted) ctx.lineWidth = Math.max(ctx.lineWidth, dpr * 3);

  const flushSegment = () => {
    if (!segmentStart || !previousVisible) return;
    ctx.beginPath();
    ctx.moveTo(segmentStart.x, segmentStart.y);
    ctx.lineTo(previousVisible.x, previousVisible.y);
    ctx.stroke();
  };

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const point = {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      depth: fromProjected.depth + (toProjected.depth - fromProjected.depth) * t,
    };
    if (edgePointIsVisible(point, depthSurface)) {
      segmentStart ??= point;
      previousVisible = point;
    } else {
      flushSegment();
      segmentStart = null;
      previousVisible = null;
    }
  }
  flushSegment();

  ctx.lineWidth = previousLineWidth;
  ctx.globalAlpha = 1;
}

function edgePointIsVisible(
  point: { x: number; y: number; depth: number },
  depthSurface: DepthSurface
): boolean {
  const x = Math.round(point.x);
  const y = Math.round(point.y);
  if (x < 0 || y < 0 || x >= depthSurface.width || y >= depthSurface.height) return false;
  const surfaceDepth = depthSurface.depths[y * depthSurface.width + x];
  if (surfaceDepth === undefined || !Number.isFinite(surfaceDepth)) return true;
  return point.depth >= surfaceDepth - PAPER_EDGE_DEPTH_EPSILON;
}

function findEdge(edges: [number, number][], from: number, to: number): number {
  return edges.findIndex(
    (edge) => (edge[0] === from && edge[1] === to) || (edge[0] === to && edge[1] === from)
  );
}

function edgeColor(assignment: string | undefined, palette: SimulatorPalette): string {
  if (assignment === 'M') return palette.mountain;
  if (assignment === 'V') return palette.valley;
  if (assignment === 'B') return palette.border;
  return palette.flat;
}

function edgeAlpha(assignment: string | undefined, alpha: number): number {
  if (assignment === 'F') return alpha * 0.55;
  if (!assignment) return alpha * 0.32;
  return alpha;
}
