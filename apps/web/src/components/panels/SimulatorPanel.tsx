import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import {
  ArrowLeft,
  Pause,
  Play,
  RotateCcw,
  StepForward,
  Waves,
} from "lucide-react";
import type { FoldDocument as SimulatorFoldDocument } from "@treemaker/origami-simulator";
import {
  useSimulatorRuntime,
  type SimulatorFrameView,
  type SimulatorModelView,
} from "../../simulator/useSimulatorRuntime";
import { SimulatorSegmentsSidebar } from "./SimulatorSegmentsPanel";
import { useSimulateSource } from "../../simulator/useSimulateSource";
import { simulatorRunConfig } from "../../lib/simulatorRunConfig";
import {
  SimulatorViewport,
  type SimulatorViewportHandle,
} from "../../simulator/SimulatorViewport";
import { announceUprightSet } from "../../lib/uprightFeedback";
import { useSimulatorShortcuts } from "../../simulator/useSimulatorShortcuts";
import {
  runSimulatorShortcut,
  type SimulatorShortcutHandlers,
} from "../../simulator/useSimulatorShortcuts";
import { simulatorMenuItems } from "../../simulator/simulatorContextMenu";
import { ContextMenu } from "../ui/ContextMenu";
import { useContextMenuController } from "../../menus/context/useContextMenuController";
import { useShortcutStore } from "../../store/shortcutStore";
import { FoldPlayhead } from "../../simulator/foldPlayhead";
import { useSimulatorExport } from "../../simulator/useSimulatorExport";
import { useSimulatorPhoneFlow } from "../../simulator/useSimulatorPhoneFlow";
import { foldNeedsTriangulation } from "../../simulator/canvas2dFrame";
import { simulatorMaterialOptions } from "../../lib/simulatorSettings";
import { useLayoutStore } from "../../store/layoutStore";
import { useSimulatorPaperStyle } from "../../simulator/useSimulatorPaperStyle";
import { useWorkspaceStore } from "../../store/workspaceStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useSimulatorRate } from "../../simulator/useSimulatorRate";
import { Button } from "../ui/Button";
import { IconButton } from "../ui/IconButton";
import { NextDocumentAction } from "./NextDocumentAction";
import {
  simulatorToolsRuntime,
  useSimulatorTools,
  useViewportToolHooks,
} from "../../simulator/useSimulatorTools";
import { useSimulatorToolActions } from "../../simulator/useSimulatorToolActions";
import { simulatorCanvasLabels } from "../../simulator/tools/actions";
import { SimulatorToolRail } from "../../simulator/SimulatorToolRail";
import { SimulatorToolWindow } from "../../simulator/SimulatorToolWindow";
import { SimulatorToolsTrigger } from "../../simulator/SimulatorToolsTrigger";
import { useIsPhoneLayout } from "../../platform/phoneLayout";
import styles from "./SimulatorPanel.module.css";
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
  // simulate from the document, and drives playback. A document with several
  // patterns gets a rail to pick one from (SimulatorSegmentsSidebar); on a
  // phone the rail and the simulator are two screens, and
  // `useSimulatorPhoneFlow` says which is showing.
  const viewportRef = useRef<SimulatorViewportHandle | null>(null);
  const playRafRef = useRef<number | null>(null);
  const playheadRef = useRef(new FoldPlayhead(INITIAL_FOLD_PERCENT));
  const sourceKeyRef = useRef<string | null>(null);
  const lastReadoutRef = useRef(0);
  // The mounted canvas element, as state (not just a ref) so the runtime hook
  // re-runs once it exists and can transfer it to the worker.
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null);
  // The viewport's cell, which the tool window anchors to.
  const [viewportCell, setViewportCell] = useState<HTMLDivElement | null>(null);
  // Frames reach the tools' notices through this; the tools are bound after
  // the runtime that delivers the frames.
  const observeFrameRef = useRef<(frame: SimulatorFrameView) => void>(() => {});
  const phoneLayout = useIsPhoneLayout();

  // What to simulate: the rail's patterns, the one shown, and its fold — one
  // sheet's mesh for an editable pattern, the whole canvas's artifacts for a
  // design (`useSimulateSource`).
  const source = useSimulateSource();
  const foldArtifactRevision = useWorkspaceStore(
    (state) => state.foldArtifactRevision,
  );
  const setViewDrawerSlot = useLayoutStore((state) => state.setViewDrawerSlot);

  const [foldPercent, setFoldPercent] = useState(INITIAL_FOLD_PERCENT);
  const [loadState, setLoadState] = useState<LoadState>("idle");
  const [modelError, setModelError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [strain, setStrain] = useState(0);
  const [modelStats, setModelStats] = useState({ vertices: 0, triangles: 0 });
  const [backend, setBackend] = useState<SimulatorModelView["backend"] | null>(null);
  // Render/material/solver settings live in the store: the options pane is a
  // sibling panel, so this panel applies them but does not own them.
  const viewSettings = useWorkspaceStore((state) => state.simulatorSettings);
  // How the paper is drawn is the app-wide style, not a simulator setting;
  // the same binding the options pane edits it through.
  const paper = useSimulatorPaperStyle("simulator");
  const paperStyle = paper.style;
  const shortcutOverrides = useShortcutStore((store) => store.overrides);
  const setSimulatorSetting = useWorkspaceStore((state) => state.setSimulatorSetting);
  const runConfig = simulatorRunConfig();
  // A phone shows the rail and the simulator one at a time; every other layout
  // shows both, and the flow is inert there.
  const flow = useSimulatorPhoneFlow(
    { segments: source.patterns.length, revision: foldArtifactRevision },
    source.select,
  );
  const simulationFold = source.fold;
  const simulationSourceKey = source.sourceKey;

  const showRate = useSettingsStore((state) => state.simulatorShowRate);
  const { rate, observe: observeRate } = useSimulatorRate(showRate);

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
      observeFrameRef.current(frame);
      observeRate(frame.stepsThisTick);

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
    [observeRate],
  );

  // The run profile sets the work budget (steps per frame and so on); the user's
  // material and stability choices layer on top. Memoized so a new options object
  // does not re-trigger the runtime's load effect on every render.
  const solverOptions = useMemo(
    () => ({ ...runConfig.solverOptions, ...simulatorMaterialOptions(viewSettings) }),
    [runConfig.solverOptions, viewSettings],
  );

  const runtime = useSimulatorRuntime({
    fold: simulationFold as SimulatorFoldDocument | null,
    solverOptions,
    triangulate: simulationFold ? foldNeedsTriangulation(simulationFold) : true,
    canvas: canvasEl,
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

  const exportView = useSimulatorExport(runtime.beginExport, { surface: "simulator" });

  const viewportTools = useViewportToolHooks(viewportRef);
  const tools = useSimulatorTools({
    runtime: simulatorToolsRuntime(runtime),
    ready: loadState === "ready",
    revision: foldArtifactRevision,
    sourceKey: simulationSourceKey,
    ...viewportTools,
  });
  const toolActions = useSimulatorToolActions(tools);
  const canvasLabels = simulatorCanvasLabels(t, tools.tool.id);
  useEffect(() => {
    observeFrameRef.current = tools.observeFrame;
  }, [tools.observeFrame]);

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

  // Reset the fold target when the source model genuinely changes, so switching
  // segment does not inherit the previous scrub position.
  useEffect(() => {
    if (sourceKeyRef.current === simulationSourceKey) return;
    sourceKeyRef.current = simulationSourceKey;
    playheadRef.current.set(INITIAL_FOLD_PERCENT);
    setFoldPercent(INITIAL_FOLD_PERCENT);
    setPlaying(false);
  }, [simulationSourceKey, setPlaying]);

  // Load/error state is derived from the runtime plus the source; there is no
  // separate solver lifecycle to track any more.
  useEffect(() => {
    if (source.status === "empty") {
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
    if (source.status === "error") {
      setModelError(source.error);
      setLoadState("error");
      return;
    }
    setModelError(null);
    setLoadState(source.status === "ready" && runtimeStatus === "ready" ? "ready" : "loading");
  }, [source.status, source.error, runtimeStatus, runtime.error, setPlaying]);

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

  // Back to the beginning of the fold, camera untouched: stop, put the paper
  // flat with the solver at rest, and report zero. Cmd+Left, and half of Restart.
  const rewindFold = useCallback(() => {
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

  // One verb for "start over", whatever state the simulation is in: the fold
  // back at the beginning *and* the view back to its opening transform -- as if
  // the simulation had just been opened. A healthy session rewinds in place; a
  // broken one (a solver that threw, a lost context, artifacts the engine could
  // not build) is rebuilt from the crease pattern, the only way back from
  // those. Formerly two buttons, Refresh and Reset, exposing that split to
  // users who only ever wanted the fold started over.
  const canRestart = loadState === "ready" || loadState === "error";
  const restartSimulation = useCallback(() => {
    if (!canRestart) return;
    // First, so a rebuild opens on the opening view: the runtime hands a new
    // session whatever camera it was last given.
    resetView();
    if (loadState === "ready") {
      rewindFold();
      return;
    }
    setPlaying(false);
    playheadRef.current.set(0);
    setFoldPercent(0);
    source.rebuild();
  }, [canRestart, loadState, resetView, rewindFold, setPlaying, source]);

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
  // One set of verbs, two surfaces. The keymap below and the viewport's context
  // menu both dispatch through `runSimulatorShortcut` against *these* handlers,
  // so a menu row and its own key binding cannot come to mean different things.
  const simulatorHandlers: SimulatorShortcutHandlers = {
    playPause: () => setPlaying(!playing),
    nudgeFold,
    setFoldPercent: setFoldTarget,
    rewind: rewindFold,
    restart: restartSimulation,
    resetView,
    zoomBy,
    toggleSetting: (key) => {
      if (key === 'lighting') {
        paper.setLighting(!paperStyle.light.enabled);
        return;
      }
      setSimulatorSetting(key, !viewSettings[key]);
    },
    // The options rail's two buttons. The rail is a sibling panel, so it runs
    // these through the executor rather than holding the viewport itself.
    exportView: () => void exportView(),
    setUpright: () => {
      viewportRef.current?.setUpright();
      announceUprightSet(t);
    },
    tools: tools.shortcuts,
  };

  useSimulatorShortcuts({
    active: loadState === "ready",
    foldStepPercent: runConfig.foldStepPercent,
    handlers: simulatorHandlers,
  });

  const contextMenu = useContextMenuController("simulator");
  const onViewportContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (loadState !== "ready") return;
    contextMenu.request({
      clientX: event.clientX,
      clientY: event.clientY,
      targetKind: "empty",
      hasSelection: false,
      build: () =>
        simulatorMenuItems({
          t,
          shortcuts: shortcutOverrides,
          run: (id) =>
            runSimulatorShortcut(id, simulatorHandlers, runConfig.foldStepPercent, "context-menu"),
          playing,
          settings: { ...viewSettings, lighting: paperStyle.light.enabled },
          toolVerbs: toolActions.menu,
        }),
    });
  };

  const errorDetail =
    modelError ??
    source.error ??
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
      {/* A single pattern needs no picker; the rail hides to reclaim the space. */}
      {flow.screen !== "detail" && source.patterns.length > 1 && (
        <SimulatorSegmentsSidebar
          patterns={source.patterns}
          selected={source.activeId}
          onSelect={flow.openSegment}
        />
      )}
      {flow.screen !== "list" && (
        <section className="panel-shell simulator-panel">
          <div className="panel-toolbar">
            <div className="panel-toolbar__group">
              {/* On a phone the way back to the list stands where the title was. */}
              {flow.back ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="simulator-panel__back"
                  onClick={flow.back}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  {t("panels:simulator.backToPatterns", "Patterns")}
                </Button>
              ) : (
                <>
                  <Waves size={14} />
                  <span className="panel-title">
                    {t("panels:simulator.title", "Simulator")}
                  </span>
                </>
              )}
            </div>
            <div className="panel-toolbar__group">
              {/*
                Where the touch layer's Settings pill goes: the right end of the
                toolbar. Seated here rather than floated over the canvas so the
                phone's list screen, which has no simulator for the settings to
                be about, carries no pill (`WorkspaceViewDrawer`). Empty under a
                fine pointer, where the settings are the docked pane.
              */}
              {/* The rail's tools on a phone, left of the Settings pill. */}
              {phoneLayout && (
                <SimulatorToolsTrigger
                  buttons={toolActions.picker}
                  disabled={!tools.enabled}
                  surface="simulate"
                />
              )}
              <div className="panel-toolbar__pills" ref={setViewDrawerSlot} />
            </div>
          </div>
          <div className="panel-body simulator-panel__body">
            {/* Rail and viewport side by side. On a phone there is no rail: the
                Tools pill in the toolbar above switches tools instead. */}
            <div className={styles.stage}>
              {!phoneLayout && (
                <SimulatorToolRail buttons={toolActions.rail} disabled={!tools.enabled} />
              )}
              <div
                ref={setViewportCell}
                className={styles.viewport}
                onContextMenu={onViewportContextMenu}
              >
                <SimulatorViewport
                  ref={viewportRef}
                  canvasKey={`gl:${runtime.canvasGeneration}`}
                  onCanvasChange={setCanvasEl}
                  interactive={loadState === "ready"}
                  gpuActive={gpuActive}
                  viewSettings={viewSettings}
                  paperStyle={paperStyle}
                  // This is the surface with room for one. The viewport cell is
                  // the positioned container it anchors to; see the prop.
                  viewCube={viewSettings.showViewCube}
                  highlights={tools.highlights}
                  toolInput={tools.toolInput}
                  pushCamera={pushCamera}
                  pushRenderSettings={pushRenderSettings}
                  perfSurface="simulate-panel"
                  className="simulator-canvas"
                  ariaLabel={canvasLabels.ariaLabel}
                  title={canvasLabels.title}
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
            </div>
            <ContextMenu
              open={contextMenu.open}
              x={contextMenu.x}
              y={contextMenu.y}
              items={contextMenu.items}
              onOpenChange={contextMenu.onOpenChange}
              onCloseAutoFocus={contextMenu.onCloseAutoFocus}
            />
          </div>
          {/* Outside the body, which carries no handler the window should hear;
              see the component. */}
          <SimulatorToolWindow container={viewportCell} model={toolActions.window} />
          <div className="simulator-controls">
            <div
              className="simulator-transport"
              aria-label={t("panels:simulator.controls", "Simulation controls")}
            >
              <IconButton
                size="sm"
                title={`${t("panels:simulator.restart", "Restart")} (R)`}
                aria-label={t("panels:simulator.restart", "Restart")}
                tooltipSide="top"
                onClick={restartSimulation}
                disabled={!canRestart}
              >
                <RotateCcw size={14} />
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
            </div>
            <label className="simulator-slider">
              <span>{t("panels:simulator.fold", "Fold")}</span>
              <input
                aria-label={t("panels:simulator.foldPercent", "Fold percent")}
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
            {/*
              `data-state` so the touch layout can hide the *stats* without hiding
              the *errors*. `statusLabel` is both: on `ready` it is the vertex and
              triangle count, and on `empty` or `error` it is the only place the
              reason surfaces. A blanket `display: none` under a coarse pointer
              would have made a failed simulator look like an idle one.
            */}
            <div className="simulator-readout" data-state={loadState}>
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
                    backend === "webgpu"
                      ? t(
                          "panels:simulator.backendWebgpuTitle",
                          "Solving on the GPU (WebGPU)",
                        )
                      : backend === "webgl2"
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
                  {backend === "webgpu"
                    ? t("panels:simulator.backendWebgpu", "WebGPU")
                    : backend === "webgl2"
                    ? t("panels:simulator.backendWebgl", "WebGL2")
                    : t("panels:simulator.backendCpu", "CPU")}
                </span>
              )}
              {rate && (
                <span data-readout="rate">
                  {t("panels:simulator.rateReadout", "{{steps}} steps/s · {{fps}} fps", {
                    steps: Math.round(rate.stepsPerSecond).toLocaleString(),
                    fps: Math.round(rate.framesPerSecond),
                  })}
                </span>
              )}
            </div>
          </div>
        </section>
      )}
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


