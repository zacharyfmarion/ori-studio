import { selectProject } from '../../store/workspaceStore/designTabs';
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  simulatorAccuracyLabel,
  simulatorAccuracyTitle,
} from "../../i18n/enumLabels";
import type { TFunction } from "i18next";
import {
  AlertTriangle,
  ArrowUpToLine,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  StepForward,
  Waves,
} from "lucide-react";
import type { FoldDocument as SimulatorFoldDocument } from "@treemaker/origami-simulator";
import {
  useSimulatorRuntime,
  type SimulatorFrameView,
} from "../../simulator/useSimulatorRuntime";
import { buildSequenceStepSimulation } from "../../lib/sequenceSimulation";
import {
  buildSegmentSimulationFold,
  resolveCpSegments,
} from "../../lib/creasePatternSegmentation";
import { SimulatorSegmentsSidebar } from "./SimulatorSegmentsPanel";
import {
  STEP_SIMULATION_ACCURACY_OPTIONS,
  simulatorRunConfig,
  type StepSimulationAccuracy,
} from "../../lib/simulatorRunConfig";
import {
  SimulatorViewport,
  type SimulatorViewportHandle,
} from "../../simulator/SimulatorViewport";
import { announceUprightSet } from "../../lib/uprightFeedback";
import { useSimulatorShortcuts } from "../../simulator/useSimulatorShortcuts";
import { FoldPlayhead } from "../../simulator/foldPlayhead";
import { SimulatorExportMenu } from "../../simulator/SimulatorExportMenu";
import { useSimulatorViewExport } from "../../simulator/useSimulatorViewExport";
import {
  foldNeedsTriangulation,
  type SimulatorHighlights,
  EMPTY_HIGHLIGHTS,
} from "../../simulator/canvas2dFrame";
import { simulatorMaterialOptions } from "../../lib/simulatorSettings";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useWorkspaceCapabilities } from "../../store/workspaceStore/useWorkspaceCapabilities";
import { IconButton } from "../ui/IconButton";
import { SegmentedControl } from "../ui/SegmentedControl";
import { NextDocumentAction } from "./NextDocumentAction";
// Registers `__simCapabilityProbe()` in dev builds; no-op in production.
import "../../simulator/capabilityProbe";

type LoadState = "idle" | "loading" | "ready" | "empty" | "error";


// Readouts (step/strain/fold%) update at most this often; see handleFrame.
const READOUT_INTERVAL_MS = 66;
const INITIAL_FOLD_PERCENT = 0;

export function SimulatorPanel() {
  const { t } = useTranslation();
  // The solver lives in a worker and the drawing surface lives in
  // SimulatorViewport; this component owns neither. It resolves *what* to
  // simulate from the document, and drives playback.
  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  const playRafRef = useRef<number | null>(null);
  const playheadRef = useRef(new FoldPlayhead(INITIAL_FOLD_PERCENT));
  const sourceKeyRef = useRef<string | null>(null);
  const lastReadoutRef = useRef(0);
  // The mounted canvas element, as state (not just a ref) so the runtime hook
  // re-runs once it exists and can transfer it to the worker.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);

  const creaseCount = useWorkspaceStore(
    (state) => selectProject(state).creases.length,
  );
  // Editable (hand-drawn / imported) crease patterns live in the oristudio CP
  // document, not `project.creases`, so they are a valid simulation source even
  // when `creaseCount` is 0.
  const hasEditableCp = useWorkspaceStore(
    (state) => state.oristudioCpDocument !== null,
  );
  const foldArtifacts = useWorkspaceStore((state) => state.foldArtifacts);
  const foldArtifactRevision = useWorkspaceStore(
    (state) => state.foldArtifactRevision,
  );
  const selectedSegmentId = useWorkspaceStore(
    (state) => state.selectedSegmentId,
  );
  const foldArtifactError = useWorkspaceStore(
    (state) => state.foldArtifactError,
  );
  const foldArtifactStatus = useWorkspaceStore(
    (state) => state.foldArtifactStatus,
  );
  const sequencePlan = useWorkspaceStore((state) => state.sequencePlan);
  const sequenceSimulationFocus = useWorkspaceStore(
    (state) => state.sequenceSimulationFocus,
  );
  const setSequenceSimulationFocus = useWorkspaceStore(
    (state) => state.setSequenceSimulationFocus,
  );
  const ensureFoldArtifacts = useWorkspaceStore(
    (state) => state.ensureFoldArtifacts,
  );
  const refreshFoldArtifacts = useWorkspaceStore(
    (state) => state.refreshFoldArtifacts,
  );
  const capabilities = useWorkspaceCapabilities();

  const [foldPercent, setFoldPercent] = useState(INITIAL_FOLD_PERCENT);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [strain, setStrain] = useState(0);
  const [modelStats, setModelStats] = useState({ vertices: 0, triangles: 0 });
  const [backend, setBackend] = useState<"webgl2" | "reference" | null>(null);
  // Render/material/solver settings live in the store: the options pane is a
  // sibling panel, so this panel applies them but does not own them.
  const viewSettings = useWorkspaceStore((state) => state.simulatorSettings);
  const setSimulatorSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  const [stepAccuracy, setStepAccuracy] =
    useState<StepSimulationAccuracy>("fast");
  const refreshCapability = capabilities["simulator.refresh"];
  const stepSimulationResult = useMemo(
    () =>
      sequenceSimulationFocus.kind === "sequence_step"
        ? buildSequenceStepSimulation(
            sequencePlan,
            sequenceSimulationFocus.stepId,
          )
        : null,
    [sequencePlan, sequenceSimulationFocus],
  );
  const activeStepSimulation = stepSimulationResult?.ok
    ? stepSimulationResult.simulation
    : null;
  const stepSimulationError =
    stepSimulationResult && !stepSimulationResult.ok
      ? stepSimulationResult.reason
      : null;
  const simulatorMode =
    sequenceSimulationFocus.kind === "sequence_step" ? "step" : "whole";
  const runConfig = useMemo(
    () => simulatorRunConfig(simulatorMode, stepAccuracy),
    [simulatorMode, stepAccuracy],
  );
  // Segment the whole document's fold and simulate only the selected pattern.
  // Memoized so a new sub-fold object is not produced on every render (which
  // would thrash the prepare/dispose effect). Sequence-step mode is unaffected.
  const activeSegmentId = useMemo(() => {
    if (activeStepSimulation || simulatorMode !== "whole") return null;
    const segments = resolveCpSegments(foldArtifacts);
    if (segments.length <= 1) return null;
    const segment =
      segments.find((candidate) => candidate.id === selectedSegmentId) ??
      segments[0];
    return segment?.id ?? null;
  }, [activeStepSimulation, foldArtifacts, selectedSegmentId, simulatorMode]);
  const simulationFold = useMemo(() => {
    if (activeStepSimulation) return activeStepSimulation.fold;
    const wholeFold =
      foldArtifacts?.simulation_model?.fold ?? foldArtifacts?.fold ?? null;
    if (!wholeFold) return null;
    if (activeSegmentId !== null) {
      const segment = resolveCpSegments(foldArtifacts).find(
        (c) => c.id === activeSegmentId,
      );
      if (segment && foldArtifacts) return buildSegmentSimulationFold(foldArtifacts, segment);
    }
    return wholeFold;
  }, [activeStepSimulation, foldArtifacts, activeSegmentId]);
  const simulationFoldProfile = activeStepSimulation?.foldProfile ?? null;
  const simulationModelError =
    stepSimulationError ??
    (!activeStepSimulation ? foldArtifacts?.simulation_model_error : null);
  const simulationSourceKey = activeStepSimulation
    ? `step:${activeStepSimulation.step.id}:${activeStepSimulation.beforeState.id}:${activeStepSimulation.afterState.id}`
    : sequenceSimulationFocus.kind === "sequence_step"
      ? `step-error:${sequenceSimulationFocus.stepId}:${stepSimulationError ?? "unknown"}`
      : `whole:${foldArtifacts ? foldArtifactRevision : "empty"}:${activeSegmentId ?? "all"}`;

  const handleFrame = useCallback(
    (frame: SimulatorFrameView) => {
      // Reported, not assigned: a frame carries the target as it was when the
      // worker ticked, so during playback it is a round-trip out of date and
      // writing it would drag the fold back to where it had already been. The
      // playhead is what decides which of the two writers is in charge.
      playheadRef.current.report(frame.foldPercent);
      // Straight to the viewport, not through state: at 60fps a re-render per
      // frame would starve the loop this is reporting on.
      viewportRef.current?.showFrame(frame);

      // Throttle the readout state to ~15Hz. These three setStates re-render the
      // whole panel, and at 60fps that re-render was starving the main-thread rAF
      // that drives the solver loop -- so the readouts, meant to *reflect*
      // progress, were throttling it. A step counter and strain value do not need
      // 60Hz; the frame itself (canvas) still updates every frame. Always flush
      // the final converged frame so the readouts land on the settled values.
      const now = performance.now();
      if (
        frame.converged ||
        now - lastReadoutRef.current > READOUT_INTERVAL_MS
      ) {
        lastReadoutRef.current = now;
        setStep(frame.step);
        setStrain(frame.maxStrain);
        setFoldPercent(frame.foldPercent);
      }
    },
    [],
  );

  // A fold profile (segment/sequence-step simulation) uses a solver path the GPU
  // renderer does not cover, so those keep the canvas-2D path.
  const allowGpuRender = !simulationFoldProfile;

  // The run profile sets the work budget (steps per frame and so on); the user's
  // material and stability choices layer on top. Memoized so a new options object
  // does not re-trigger the runtime's load effect on every render.
  const solverOptions = useMemo(
    () => ({ ...runConfig.solverOptions, ...simulatorMaterialOptions(viewSettings) }),
    [runConfig.solverOptions, viewSettings],
  );

  const runtime = useSimulatorRuntime({
    fold: simulationFold as SimulatorFoldDocument | null,
    foldProfile: simulationFoldProfile,
    solverOptions,
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
    setFoldPercent: pushFoldPercent,
    reset: resetSolver,
    setCamera: pushCamera,
    setRenderSettings: pushRenderSettings,
    setMaterial: pushMaterial,
  } = runtime;

  const exportView = useSimulatorViewExport(runtime.exportSvg);

  // Apply material/stability edits to the live solver. The load effect ignores
  // solverOptions on purpose -- reloading the model would throw away the current
  // fold -- so the pane's changes reach the solver through here instead. Both
  // backends recompute their timestep on a material change.
  useEffect(() => {
    if (runtimeStatus !== "ready") return;
    pushMaterial(simulatorMaterialOptions(viewSettings));
  }, [runtimeStatus, pushMaterial, viewSettings]);

  useEffect(() => {
    viewportRef.current?.setModel(runtimeModel);
    if (runtimeModel) {
      setModelStats({
        vertices: runtimeModel.vertexCount,
        triangles: runtimeModel.faceCount,
      });
      setBackend(runtimeModel.backend);
    } else {
      setModelStats({ vertices: 0, triangles: 0 });
      setBackend(null);
    }
  }, [runtimeModel]);

  // Creases and faces a sequence step is emphasising, for the CPU renderer.
  const highlights = useMemo<SimulatorHighlights>(
    () =>
      activeStepSimulation
        ? {
            creases: new Set(activeStepSimulation.affectedCreases),
            faces: new Set(activeStepSimulation.affectedFaces),
          }
        : EMPTY_HIGHLIGHTS,
    [activeStepSimulation],
  );

  // Reset the fold target when the source model genuinely changes, so switching
  // segment or sequence step does not inherit the previous scrub position.
  useEffect(() => {
    if (sourceKeyRef.current === simulationSourceKey) return;
    sourceKeyRef.current = simulationSourceKey;
    playheadRef.current.set(INITIAL_FOLD_PERCENT);
    setFoldPercent(INITIAL_FOLD_PERCENT);
    setPlaying(false);
  }, [simulationSourceKey, setPlaying]);

  // Load/error state is derived from the runtime plus the surrounding document
  // state; there is no separate solver lifecycle to track any more.
  useEffect(() => {
    if (simulatorMode === "step") {
      if (stepSimulationError) {
        setModelError(stepSimulationError);
        setLoadState("error");
      } else if (activeStepSimulation) {
        setModelError(null);
        setLoadState(runtimeStatus === "ready" ? "ready" : "loading");
      } else {
        setModelError(
          t(
            "panels:simulator.stepSimulationUnavailable",
            "Step simulation unavailable.",
          ),
        );
        setLoadState("error");
      }
      return;
    }

    if (creaseCount === 0 && !hasEditableCp) {
      setPlaying(false);
      setModelError(null);
      setLoadState("empty");
      return;
    }

    if (runtime.error) {
      setModelError(runtime.error);
      setLoadState("error");
      return;
    }

    if (foldArtifacts) {
      setModelError(simulationModelError ?? null);
      if (simulationModelError) {
        setLoadState("error");
        return;
      }
      setLoadState(runtimeStatus === "ready" ? "ready" : "loading");
      return;
    }

    setModelError(null);
    if (foldArtifactStatus === "loading") {
      setLoadState("loading");
      return;
    }
    if (foldArtifactStatus === "error") {
      setModelError(
        foldArtifactError ??
          t("panels:simulator.unavailable", "Simulator unavailable"),
      );
      setLoadState("error");
      return;
    }
    setLoadState("loading");
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
      playheadRef.current.set(next);
      setFoldPercent(next);
      runtime.settleTo(next);
    },
    [runtime, setPlaying],
  );

  const stepFoldTarget = useCallback(() => {
    setFoldTarget(
      Math.min(
        100,
        Math.floor(playheadRef.current.value / runConfig.foldStepPercent + 1) *
          runConfig.foldStepPercent,
      ),
    );
  }, [runConfig.foldStepPercent, setFoldTarget]);

  const replayFromFlat = useCallback(() => {
    setPlaying(false);
    playheadRef.current.set(0);
    setFoldPercent(0);
    runtime.reset();
  }, [runtime, setPlaying]);

  // Play advances the fold target over time; the worker does the solving, so
  // this callback only ever computes a number and hands it over.
  useEffect(() => {
    if (!playing || typeof window === "undefined" || runtimeStatus !== "ready")
      return;

    const playhead = playheadRef.current;
    if (playhead.begin().rewound) {
      setFoldPercent(0);
      resetSolver();
    }

    let previousTime: number | null = null;
    const tick = (time: number) => {
      if (previousTime === null) previousTime = time;
      const elapsedSeconds = Math.min(0.08, (time - previousTime) / 1000);
      previousTime = time;
      const nextPercent = playhead.advance(
        elapsedSeconds,
        viewSettings.foldPlayPercentPerSecond,
      );

      pushFoldPercent(nextPercent);

      if (nextPercent >= 100) {
        playRafRef.current = null;
        setPlaying(false);
        return;
      }
      playRafRef.current = window.requestAnimationFrame(tick);
    };

    playRafRef.current = window.requestAnimationFrame(tick);
    return () => {
      if (playRafRef.current !== null)
        window.cancelAnimationFrame(playRafRef.current);
      playRafRef.current = null;
      playhead.end();
    };
    // The two solver calls rather than `runtime`, which is a fresh object every
    // render: the readouts below re-render this panel many times a second, so
    // depending on it tore this loop down and rebuilt it just as often, and each
    // rebuild reset `previousTime` and lost that frame's advance.
  }, [
    playing,
    pushFoldPercent,
    resetSolver,
    viewSettings.foldPlayPercentPerSecond,
    runtimeStatus,
    setPlaying,
  ]);

  // Resize, theme re-read, orbit and zoom all live in the viewport now; the
  // panel only reaches for the two the keyboard drives.
  const resetView = useCallback(() => {
    viewportRef.current?.resetView();
  }, []);

  const zoomBy = useCallback((factor: number) => {
    viewportRef.current?.zoomBy(factor);
  }, []);

  // Scrub the fold by a signed delta. setFoldTarget clamps 0-100 and pauses
  // playback, so a manual scrub always stops an in-progress play.
  const nudgeFold = useCallback(
    (deltaPercent: number) => {
      setFoldTarget(playheadRef.current.value + deltaPercent);
    },
    [setFoldTarget],
  );

  // Keyboard controls, through the shared dispatcher rather than a window
  // listener of our own. The panel is no longer the only thing that can hold a
  // simulation, so "only mounted here" stopped being a scoping argument.
  useSimulatorShortcuts({
    active: loadState === "ready",
    foldStepPercent: runConfig.foldStepPercent,
    handlers: {
      playPause: () => setPlaying(!playing),
      nudgeFold,
      setFoldPercent: setFoldTarget,
      replay: replayFromFlat,
      resetView,
      zoomBy,
      toggleSetting: (key) => {
        // Hidden lines only mean anything while crease lines are drawn.
        if (key === "showHiddenLines" && !viewSettings.showEdges) return;
        setSimulatorSetting(key, !viewSettings[key]);
      },
    },
  });

  const errorDetail =
    stepSimulationError ??
    modelError ??
    foldArtifactError ??
    t("panels:simulator.unavailable", "Simulator unavailable");
  const statusLabel =
    loadState === "ready"
      ? t(
          "panels:simulator.stats",
          "{{vertices}} vertices | {{triangles}} triangles",
          {
            vertices: modelStats.vertices,
            triangles: modelStats.triangles,
          },
        )
      : loadState === "loading"
        ? t("panels:simulator.loading", "Loading")
        : loadState === "empty"
          ? t("panels:simulator.noCreasePattern", "No crease pattern")
          : loadState === "error"
            ? shortStatus(errorDetail, t)
            : t("panels:simulator.idle", "Idle");

  return (
    <div className="simulator-workspace">
      <SimulatorSegmentsSidebar />
      <section className="panel-shell simulator-panel">
        <div className="panel-toolbar">
          <div className="panel-toolbar__group">
            <Waves size={14} />
            <span className="panel-title">
              {t("panels:simulator.title", "Simulator")}
            </span>
          </div>
          <div className="panel-toolbar__group">
            {/*
              Which way the model is up. Here rather than in the view pane because
              it is something you reach for *while* positioning a model — it acts
              on the thing beside it, and the options pane is for settings you
              configure once.

              No matching "clear": the way back is the view reset (0 / Home, or
              double-click the canvas), which drops the orientation with the
              angles. See `SimulatorViewport.resetView`.
            */}
            {/*
              `toolbar` to match the export control beside it. Omitting the
              variant gives the ghost look, which sat next to the export button's
              filled one and read as two different kinds of control rather than
              two actions. `SimulatorExportMenu` defaults to `toolbar` and this
              panel does not override it, so that is the look this header has.
            */}
            <IconButton
              size="sm"
              variant="toolbar"
              title={t("panels:simulator.setUpright", "Set upright")}
              disabled={loadState !== "ready"}
              onClick={() => {
                viewportRef.current?.setUpright();
                announceUprightSet(t);
              }}
            >
              <ArrowUpToLine size={14} />
            </IconButton>
            <SimulatorExportMenu
              onExport={exportView}
              disabled={loadState !== "ready"}
            />
          </div>
          {/* Scope controls hidden while the Sequence panel is hidden (always "whole"). */}
          <div
            className="panel-toolbar__group simulator-scope-controls"
            style={{ display: "none" }}
          >
            <SegmentedControl
              aria-label={t("panels:simulator.scope", "Simulator scope")}
              value={simulatorMode}
              onChange={(mode) => {
                if (mode === "whole") {
                  setSequenceSimulationFocus({ kind: "whole" });
                  return;
                }
                if (sequenceSimulationFocus.kind === "sequence_step") return;
                const firstStep = sequencePlan?.steps[0];
                if (firstStep) {
                  setSequenceSimulationFocus({
                    kind: "sequence_step",
                    stepId: firstStep.id,
                  });
                }
              }}
              options={[
                {
                  value: "whole",
                  label: t("panels:simulator.scopeWhole", "Whole"),
                  title: t(
                    "panels:simulator.scopeWholeTitle",
                    "Simulate the whole crease pattern",
                  ),
                },
                {
                  value: "step",
                  label: t("panels:simulator.scopeStep", "Step"),
                  title: t(
                    "panels:simulator.scopeStepTitle",
                    "Simulate the selected sequence step",
                  ),
                },
              ]}
            />
            {activeStepSimulation && (
              <span className="simulator-step-chip">
                {t("panels:simulator.stepChip", "Step {{n}}: {{kind}}", {
                  n: activeStepSimulation.stepIndex + 1,
                  kind: formatKind(activeStepSimulation.step.kind),
                })}
              </span>
            )}
            {activeStepSimulation?.warning && (
              <span className="simulator-step-chip simulator-step-chip--warn">
                <AlertTriangle size={12} />
                {t("panels:simulator.manualPreview", "Manual preview")}
              </span>
            )}
            {simulatorMode === "step" && (
              <div className="simulator-accuracy-controls">
                <SegmentedControl
                  aria-label={t(
                    "panels:simulator.stepAccuracy",
                    "Step simulation accuracy",
                  )}
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
        </div>
        <div className="panel-body simulator-panel__body">
          <SimulatorViewport
            ref={viewportRef}
            canvasKey={allowGpuRender ? "gl" : "2d"}
            onCanvasChange={setCanvasEl}
            interactive={loadState === "ready"}
            gpuActive={gpuActive}
            viewSettings={viewSettings}
            highlights={highlights}
            pushCamera={pushCamera}
            pushRenderSettings={pushRenderSettings}
            perfSurface="simulate-panel"
            className="simulator-canvas"
            ariaLabel={t(
              "panels:simulator.canvasAriaLabel",
              "Origami folded-base simulator. Drag to rotate, scroll to zoom, double-click to reset view.",
            )}
            title={t(
              "panels:simulator.canvasTitle",
              "Drag to rotate, scroll to zoom, double-click to reset view",
            )}
          />
          {loadState !== "ready" && (
            <div className="simulator-panel__empty">
              <span title={loadState === "error" ? errorDetail : undefined}>
                {statusLabel}
              </span>
              {loadState === "error" && <small>{errorDetail}</small>}
              {loadState === "empty" && <NextDocumentAction />}
            </div>
          )}
        </div>
        <div className="simulator-controls">
          <div
            className="simulator-transport"
            aria-label={t("panels:simulator.controls", "Simulation controls")}
          >
            <IconButton
              size="sm"
              title={t("panels:simulator.refresh", "Refresh")}
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
              title={`${
                playing
                  ? t("panels:simulator.pause", "Pause")
                  : t("panels:simulator.play", "Play")
              } (Space)`}
              aria-label={
                playing
                  ? t("panels:simulator.pause", "Pause")
                  : t("panels:simulator.play", "Play")
              }
              tooltipSide="top"
              onClick={() => setPlaying(!playing)}
              disabled={loadState !== "ready"}
            >
              {playing ? <Pause size={14} /> : <Play size={14} />}
            </IconButton>
            <IconButton
              size="sm"
              title={`${t("panels:simulator.step", "Step")} (→)`}
              aria-label={t("panels:simulator.step", "Step")}
              tooltipSide="top"
              onClick={stepFoldTarget}
              disabled={loadState !== "ready"}
            >
              <StepForward size={14} />
            </IconButton>
            <IconButton
              size="sm"
              title={`${t("panels:simulator.reset", "Reset")} (R)`}
              aria-label={t("panels:simulator.reset", "Reset")}
              tooltipSide="top"
              onClick={replayFromFlat}
              disabled={loadState !== "ready"}
            >
              <RotateCcw size={14} />
            </IconButton>
          </div>
          <label className="simulator-slider">
            <span>
              {simulatorMode === "step"
                ? t("panels:simulator.step", "Step")
                : t("panels:simulator.fold", "Fold")}
            </span>
            <input
              aria-label={
                simulatorMode === "step"
                  ? t("panels:simulator.stepPercent", "Step percent")
                  : t("panels:simulator.foldPercent", "Fold percent")
              }
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(foldPercent)}
              onChange={(event) =>
                setFoldTarget(Number(event.currentTarget.value))
              }
              disabled={loadState !== "ready"}
            />
            <output>
              {t("panels:simulator.percent", "{{value}}%", {
                value: Math.round(foldPercent),
              })}
            </output>
          </label>
          <div className="simulator-readout">
            <span>{statusLabel}</span>
            <span>
              {t("panels:simulator.stepReadout", "Step {{n}}", { n: step })}
            </span>
            <span>
              {t("panels:simulator.strain", "Strain {{value}}", {
                value: strain.toFixed(4),
              })}
            </span>
            {backend && (
              <span
                title={
                  backend === "webgl2"
                    ? t(
                        "panels:simulator.backendGpuTitle",
                        "Solving on the GPU (WebGL2)",
                      )
                    : t(
                        "panels:simulator.backendCpuTitle",
                        "Solving on the CPU (WebGL2 unavailable)",
                      )
                }
              >
                {backend === "webgl2"
                  ? t("panels:simulator.backendGpu", "GPU")
                  : t("panels:simulator.backendCpu", "CPU")}
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
  if (!trimmed)
    return t("panels:simulator.unavailable", "Simulator unavailable");
  const sentence = trimmed.split(/[.;]\s+/u)[0] ?? trimmed;
  return sentence.length > 54 ? `${sentence.slice(0, 51)}...` : sentence;
}

function formatKind(kind: string): string {
  return kind.replaceAll("_", " ");
}

