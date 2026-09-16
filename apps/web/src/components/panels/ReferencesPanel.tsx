import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { Button } from '../ui/Button';
import { ContextMenu } from '../ui/ContextMenu';
import { useContextMenuController } from '../../menus/context/useContextMenuController';
import type { ReferencesShortcutId } from '../../keyboard/shortcuts';
import { useLayoutStore } from '../../store/layoutStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useShortcutStore } from '../../store/shortcutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  ReferencesCpView,
  type ReferencesCpViewHandle,
  type ReferencesDiagramView,
} from '../../cp-workspace/references/ReferencesCpView';
import type { ReferencesPick } from '../../cp-workspace/references/referencesViewGeometry';
import { ReferencesLead } from '../../cp-workspace/references/ReferencesLead';
import { ReferencesModeSwitch } from '../../cp-workspace/references/ReferencesModeSwitch';
import { referencesSurfaces } from '../../cp-workspace/references/referencesMode';
import { rfSheetOfFrame } from '../../cp-workspace/references/referenceFinderStepInModel';
import {
  creasesAtVertices,
  stepIndexOfLine,
  stepIndexOfVertex,
} from '../../cp-workspace/references/referencesStepIndex';
import { useReferencesMode } from '../../cp-workspace/references/useReferencesMode';
import { ANALYTICS_EVENTS, track } from '../../analytics';
import { ReferencesDiagramLayer } from '../../cp-workspace/references/ReferencesDiagramLayer';
import { useReferencesDiagramScene } from '../../cp-workspace/references/useReferencesDiagramScene';
import { ReferencesSheetsSidebar } from '../../cp-workspace/references/ReferencesSheetsSidebar';
import { ReferencesStepFilmstrip } from '../../cp-workspace/references/ReferencesStepFilmstrip';
import { ReferencesTargetControls } from '../../cp-workspace/references/ReferencesTargetControls';
import { ReferencesViewportToolbar } from '../../cp-workspace/references/ReferencesViewportToolbar';
import {
  buildReferencesActions,
  referencesCommands,
  type ReferencesActionIcon,
} from '../../cp-workspace/references/referencesActions';
import { referencesMenuItems } from '../../cp-workspace/references/referencesContextMenu';
import {
  planVisibility,
  targetVisibility,
  unreadVisibility,
  REFERENCES_ALL_CREASES,
} from '../../cp-workspace/references/referencesCreaseVisibility';
import {
  candidateFilmstrip,
  planFilmstrip,
} from '../../cp-workspace/references/referencesFilmstrip';
import {
  referencesSheets,
  resolveSelectedSheet,
  sheetBorderLineIds,
  sheetLineIds,
} from '../../cp-workspace/references/referencesSheets';
import { sideAt } from '../../cp-workspace/references/referencesSequenceView';
import {
  runReferencesShortcut,
  type ReferencesShortcutActions,
} from '../../cp-workspace/references/referencesShortcuts';
import { foldCardKind } from '../../cp-workspace/references/fold/foldScene';
import { useFoldPlayback } from '../../cp-workspace/references/fold/useFoldPlayback';
import { useReferencesAutoPlan } from '../../cp-workspace/references/useReferencesAutoPlan';
import { useReferencesBreakdown } from '../../cp-workspace/references/useReferencesBreakdown';
import { useReferencesPhoneFlow } from '../../cp-workspace/references/useReferencesPhoneFlow';
import { useReferencesRun, useReferencesRunToast } from '../../cp-workspace/references/useReferencesRun';
import { useReferencesShortcuts } from '../../cp-workspace/references/useReferencesShortcuts';
import { useReferencesTarget } from '../../cp-workspace/references/useReferencesTarget';
import {
  useReferencesHighlights,
  useReferencesPlanHighlights,
  useReferencesView,
} from '../../cp-workspace/references/useReferencesView';
import { NextDocumentAction } from './NextDocumentAction';

/**
 * The References workspace's dock panel: a composition site. The sheet picker,
 * the step filmstrip, the crease-pattern view and the viewport bar are mounted
 * here and wired to each other; every behaviour lives in
 * `cp-workspace/references/` — the store bindings in `useReferencesView` /
 * `useReferencesTarget` / `useReferencesBreakdown`, the verbs in the action
 * catalog, the keys in the `references` shortcut scope. No keyboard handling
 * here (AGENTS.md > Panel components).
 *
 * The workspace reads top to bottom like a diagram: the steps as a strip of
 * numbered cards, the active step's sentence under it, and the crease pattern
 * below showing the sheet as it stands at that step. The left rail is the
 * document's patterns, one of which is being folded. The header is the mode
 * switch — two tabs, the Design workspace's — and no title: the tabs say what
 * the panel is. With a target picked, its controls take a row of their own
 * under the tabs, above the strip. The view verbs
 * float over the canvas on the Edit workspace's bar, and the settings are the
 * View pane beside the panel (`ReferencesViewControlsPanel`), which reads the
 * store on its own.
 *
 * A phone has no room for the rail beside the canvas, so it shows one of the
 * two at a time — the rail as a list screen, the rest as a detail screen with
 * a Back button — and `useReferencesPhoneFlow` says which. Every other layout
 * renders both, exactly as before.
 *
 * Two jobs share those surfaces, and the reader chooses between them with the
 * mode switch in the toolbar: *Find a reference* — the whole pattern to point
 * at, and ReferenceFinder's candidates for the vertex or crease picked — and
 * *Folding sequence* — the planner's breakdown, read step by step, the sheet
 * showing only what has been creased so far, a tap on one of those creases
 * jumping to its step. What each surface shows in each mode is
 * `referencesSurfaces`, decided once here and handed down.
 */

/** A tap that means nothing: no plan to jump in, or a sheet with nothing on it. */
const ignorePick = (): void => undefined;

export function ReferencesPanel() {
  const { t } = useTranslation();
  const setViewDrawerSlot = useLayoutStore((state) => state.setViewDrawerSlot);
  const view = useReferencesView();
  const controller = useReferencesTarget(view);
  const { mode, setMode } = useReferencesMode(
    view.framingKey,
    controller.target !== null,
    controller.clear
  );
  const storedSheet = useWorkspaceStore((state) => state.referencesSelectedSheet);
  const setSelectedSheet = useWorkspaceStore((state) => state.setReferencesSelectedSheet);

  // Which crease pattern the workspace is answering for. Resolved rather than
  // read: the frames analysis is recomputed on every revision, so a stored id
  // can name a component that no longer exists.
  const sheets = useMemo(() => referencesSheets(controller.frames), [controller.frames]);
  const selectedSheet = resolveSelectedSheet(sheets, storedSheet);
  // Against the *resolved* sheet, not the stored one. The store holds null until
  // the first press, so a press on the card the sidebar already draws as
  // selected would otherwise read as a change and wipe the plan and the pick.
  const selectSheet = useCallback(
    (component: number) => {
      if (component === selectedSheet) return;
      setSelectedSheet(component);
    },
    [selectedSheet, setSelectedSheet]
  );
  const component =
    controller.frames?.components.find((entry) => entry.id === selectedSheet) ?? null;
  const sheetIds = useMemo(() => (component ? sheetLineIds(component) : null), [component]);
  const borderIds = useMemo(() => (component ? sheetBorderLineIds(component) : null), [component]);

  const targeted = controller.target !== null && controller.target.kind !== 'whole';
  const breakdown = useReferencesBreakdown(
    view.geometry,
    view.revision,
    controller.frames,
    selectedSheet,
    targeted
  );
  const run = useWorkspaceStore((state) => state.referencesRun);
  const busy = run.status === 'running' || run.status === 'stopping';
  // A sheet that is only its border — a new document — has nothing to find
  // or to plan; unknown until the frames land, and not called empty before.
  const emptySheet = component !== null && component.segment_indices.length === 0;
  const surfaces = referencesSurfaces({
    mode,
    targeted,
    hasCreases: !emptySheet,
    planned: breakdown.record !== null,
    busy,
  });
  const readingPlan = surfaces.canvas === 'plan';
  const flow = useReferencesPhoneFlow(
    {
      hasDocument: view.hasDocument,
      revision: view.revision,
      sheets: sheets.length,
      failed: run.status === 'error',
    },
    { selectSheet, selectFinding: breakdown.selectFinding }
  );

  const targetHighlights = useReferencesHighlights(
    view.geometry,
    controller.results,
    !controller.stale,
    controller.picked,
    controller.activeCandidate,
    controller.activeStep
  );
  // The planner's folds, the turn-overs between them, and the finished pattern.
  const viewSteps = breakdown.viewSteps;
  // Only while the plan is being read: in Find a cached plan draws nothing.
  const planHighlights = useReferencesPlanHighlights(
    readingPlan ? breakdown.variants : [],
    viewSteps,
    breakdown.activeStep,
    breakdown.activeFinding
  );
  const highlights = targeted ? targetHighlights : planHighlights;
  // Which face the reader is on. Everything the picture says about direction is
  // said from it — a mountain seen from the front is a valley seen from the
  // back — so it reaches the card, the overlay and the pattern's own creases.
  const mirrored = readingPlan && sideAt(viewSteps, breakdown.activeStep) === 'back';
  // The step's picture, once: straight lines packed for the GPU, symbols for the
  // layer over it. Both off the same primitives the filmstrip card draws.
  const [diagramCamera, setDiagramCamera] = useState<ReferencesDiagramView | null>(null);
  const scene = useReferencesDiagramScene(
    highlights.diagram,
    view.lineWidth,
    mirrored,
    view.themeKey
  );

  const shortcutOverrides = useShortcutStore((store) => store.overrides);
  const indicator = useReferencesRun();
  useReferencesRunToast(indicator);

  const viewRef = useRef<ReferencesCpViewHandle | null>(null);
  const fitView = useCallback(() => viewRef.current?.fit(), []);
  const zoomIn = useCallback(() => viewRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => viewRef.current?.zoomOut(), []);
  // The bar's readout mirrors the canvas camera; the camera stays the truth.
  const [zoomPercent, setZoomPercent] = useState(100);
  const zoomTo = useCallback((percent: number) => viewRef.current?.setZoomPercent(percent), []);

  // The active card's fold — a plan step's, a turn-over's or a ReferenceFinder
  // step's, whichever strip is showing — and its transport.
  const foldScene = highlights.fold;
  const autoPlayFolds = useSettingsStore((state) => state.referencesAutoPlayFolds);
  const fold = useFoldPlayback({ view: viewRef, scene: foldScene, autoPlay: autoPlayFolds });

  // The CP-wide analysis is asked for from the Crease Pattern menu, which runs
  // before this panel exists; the request waits in the store until it mounts.
  const analysisRequest = useWorkspaceStore((state) => state.referencesAnalysisRequest);
  const consumeAnalysisRequest = useWorkspaceStore(
    (state) => state.consumeReferencesAnalysisRequest
  );
  const runAnalysisRef = useRef(breakdown.runAnalysis);
  useEffect(() => {
    runAnalysisRef.current = breakdown.runAnalysis;
  });
  useEffect(() => {
    if (analysisRequest === 0) return;
    if (!consumeAnalysisRequest()) return;
    runAnalysisRef.current();
  }, [analysisRequest, consumeAnalysisRequest]);

  // Transport and filmstrip address whichever strip is showing: the picked
  // target's candidates, or the plan. Neither, and there is nothing to step.
  const stepCount = targeted ? controller.stepCount : readingPlan ? viewSteps.length : 0;
  const activeStep = targeted ? controller.activeStep : readingPlan ? breakdown.activeStep : 0;
  const selectStep = targeted ? controller.selectStep : breakdown.selectStep;
  const nextStep = useCallback(() => selectStep(activeStep + 1), [selectStep, activeStep]);
  const previousStep = useCallback(() => selectStep(activeStep - 1), [selectStep, activeStep]);

  const active = controller.active;
  /**
   * What the caption says when the target's strip is empty. A solution with no
   * steps is the one worth telling apart: a corner or an edge midpoint is
   * already on the paper, so "no construction found" would be exactly wrong
   * about an answer that is both found and free. Without a target the strip
   * is not rendered at all — the lead stands in its place.
   */
  const filmstripPlaceholder = busy
    ? t('panels:references.searching', 'Finding references…')
    : active
      ? controller.target?.kind === 'crease'
        ? t(
            'panels:references.alreadyOnSheetLine',
            'This line is already on the paper — no folds needed.'
          )
        : t(
            'panels:references.alreadyOnSheet',
            'This point is already on the paper — no folds needed.'
          )
      : t(
          'panels:references.sidebar.none',
          'ReferenceFinder found no construction for this target at the current settings.'
        );
  // The diagonals an answer leans on are its first steps, from the empty
  // square, drawn on the paper in ReferenceFinder's units — no footnote.
  const rfSheet = useMemo(
    () => (controller.results ? rfSheetOfFrame(controller.results.frame) : { width: 1, height: 1 }),
    [controller.results]
  );
  const filmstrip = useMemo(
    () =>
      targeted
        ? candidateFilmstrip(t, active, rfSheet)
        : readingPlan
          ? planFilmstrip(t, breakdown.variants, viewSteps)
          : [],
    [targeted, readingPlan, t, active, rfSheet, breakdown.variants, viewSteps]
  );

  // The sheet as it stands — see `referencesCreaseVisibility`: whole in Find
  // and before a plan, the outline and the picked crease for a target, the
  // build-up so far while the plan is read.
  const { canvas } = surfaces;
  const creaseVisibility = useMemo(() => {
    if (!sheetIds) return REFERENCES_ALL_CREASES;
    const input = {
      sheetLineIds: sheetIds,
      borderLineIds: borderIds,
      activeLineIds: highlights.highlightLineIds,
      mirrored,
    };
    if (canvas === 'target') return targetVisibility(input);
    if (canvas === 'plan') {
      return planVisibility(breakdown.variants, viewSteps, breakdown.activeStep, input);
    }
    return unreadVisibility(input);
  }, [
    sheetIds,
    borderIds,
    canvas,
    mirrored,
    highlights.highlightLineIds,
    breakdown.variants,
    viewSteps,
    breakdown.activeStep,
  ]);

  // A tap on the sheet while the plan is read is navigation: to the step that
  // made the crease, or the last of the steps making the creases that meet
  // at the vertex. Nothing about which one leaves the browser.
  const creasesAt = useMemo(
    () => (view.geometry ? creasesAtVertices(view.geometry) : null),
    [view.geometry]
  );
  const jumpToPick = useCallback(
    (hit: ReferencesPick | null) => {
      if (!hit || !creasesAt) return;
      const index =
        hit.kind === 'line'
          ? stepIndexOfLine(breakdown.variants, viewSteps, hit.id)
          : stepIndexOfVertex(breakdown.variants, viewSteps, creasesAt, hit.point);
      if (index === null) return;
      breakdown.selectStep(index);
      track(ANALYTICS_EVENTS.referencesStepJumped, {
        target_kind: hit.kind === 'line' ? 'crease' : 'vertex',
      });
    },
    [creasesAt, breakdown, viewSteps]
  );
  const onPick =
    surfaces.pick === 'query' ? controller.pick : surfaces.pick === 'jump' ? jumpToPick : ignorePick;

  // The sequence is planned the moment the reader asks for it — on switching
  // to Sequence — and not before; see `useReferencesAutoPlan` for what stops
  // that becoming a loop.
  useReferencesAutoPlan(
    {
      hasDocument: view.hasDocument,
      revision: view.revision,
      sheet: selectedSheet,
      ready: controller.frames !== null,
      planned: breakdown.record !== null,
      busy,
      targeted,
      wanted: mode === 'sequence' && !emptySheet,
    },
    breakdown.run
  );
  const goToEdit = useCallback(() => useLayoutStore.getState().activateWorkspace('edit'), []);
  // The lead's second sentence: to the sequence, which plans on arrival there.
  const planSequenceFromLead = useCallback(() => setMode('sequence', 'lead'), [setMode]);

  /** Recompute re-runs whatever the workspace is showing. */
  const recompute = useCallback(() => {
    if (targeted) {
      controller.recompute();
      return;
    }
    if (!breakdown.record && breakdown.analysis) {
      breakdown.runAnalysis();
      return;
    }
    breakdown.run();
  }, [breakdown, controller, targeted]);

  // One set of verbs, three surfaces: the keymap, the chevrons and the context
  // menu all dispatch through `runReferencesShortcut` against these.
  const shortcutActions: ReferencesShortcutActions = {
    nextStep,
    previousStep,
    nextCandidate: controller.nextCandidate,
    previousCandidate: controller.previousCandidate,
    recompute,
    toggleLandmarksFirst: breakdown.toggleLandmarksFirst,
    resetView: fitView,
    zoomIn,
    zoomOut,
    clearTarget: controller.clear,
    playFold: fold.toggle,
  };
  useReferencesShortcuts(shortcutActions, view.hasDocument);
  // Read through a ref refreshed after each commit rather than closed over, so
  // building the descriptors during render passes no ref-holding closures.
  const shortcutActionsRef = useRef(shortcutActions);
  useEffect(() => {
    shortcutActionsRef.current = shortcutActions;
  });
  const runShortcut = useCallback(
    (id: ReferencesShortcutId) => runReferencesShortcut(id, shortcutActionsRef.current),
    []
  );

  // In Find, Recompute is the target's; without one there is nothing to run.
  const canRecompute =
    !busy && (targeted ? controller.target !== null : mode === 'sequence' && !emptySheet);
  const actions = buildReferencesActions(
    {
      stepCount,
      activeStep,
      candidateCount: controller.candidates?.length ?? 0,
      activeCandidate: controller.activeCandidate,
      canRecompute,
      hasView: view.geometry !== null,
      fold: {
        available: fold.available,
        playing: fold.playing,
        folded: fold.folded,
        pleat:
          readingPlan && foldCardKind(breakdown.variants, viewSteps, breakdown.activeStep) === 'pleat',
      },
    },
    { t }
  );
  const commands = referencesCommands(actions);
  const commandById = (id: ReferencesActionIcon) => commands.find((command) => command.id === id);

  // A *finding* frames itself, because it is the only way to see where an
  // unreached line is. A step deliberately does not: walking the sequence used
  // to walk the pattern around the viewport, which made it unreadable.
  // `activeFinding` is one store field shared by both modes, so it can still be
  // set from a breakdown when a vertex is picked — and without the `targeted`
  // half of this gate, framing came back for every step of a *target*, which is
  // the behaviour the gate exists to remove.
  // On a phone the finding is pressed on the list, where there is no canvas,
  // and framed on the detail that press opens: the screen is a dependency so
  // a finding still active from the last visit is framed again.
  const findingBounds =
    !targeted && breakdown.activeFinding !== null ? highlights.stepBounds : null;
  const screen = flow.screen;
  useEffect(() => {
    if (findingBounds) viewRef.current?.frameModelBounds(findingBounds);
  }, [findingBounds, screen]);

  const contextMenu = useContextMenuController('references');
  const onBodyContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!view.geometry) return;
    contextMenu.request({
      clientX: event.clientX,
      clientY: event.clientY,
      targetKind: controller.target ? 'selection' : 'empty',
      hasSelection: controller.target !== null,
      build: () => referencesMenuItems(actions, runShortcut, shortcutOverrides),
    });
  };

  const readoutState = !view.hasDocument
    ? 'empty'
    : busy
      ? 'running'
      : run.status === 'error'
        ? 'error'
        : controller.stale || (mode === 'sequence' && !targeted && breakdown.stale)
          ? 'stale'
          : 'ready';

  return (
    <div className="references-workspace">
      {flow.screen !== 'detail' && (
        <ReferencesSheetsSidebar
          sheets={sheets}
          components={controller.frames?.components ?? []}
          geometry={view.geometry}
          selected={selectedSheet}
          onSelect={flow.openSheet}
          breakdown={breakdown}
          analysis={breakdown.analysisRecord}
          busy={busy}
          hasDocument={view.hasDocument}
          targeted={targeted}
          // The list screen has no canvas to click a vertex on.
          hint={
            flow.screen === 'list'
              ? t('panels:references.hint.open', 'Open a pattern to see how to fold it.')
              : mode === 'sequence'
                ? t('panels:references.hint.jump', 'Tap a crease to jump to the step that makes it.')
                : controller.hint
          }
          warnings={controller.warnings}
          onSelectFinding={flow.openFinding}
        />
      )}
      {flow.screen !== 'list' && (
        <section className="panel-shell references-panel">
          <div className="panel-toolbar">
            <div className="panel-toolbar__group">
              {flow.back ? (
                <Button
                  size="sm"
                  variant="secondary"
                  className="references-panel__back"
                  onClick={flow.back}
                >
                  <ArrowLeft size={14} aria-hidden="true" />
                  {t('panels:references.backToPatterns', 'Patterns')}
                </Button>
              ) : null}
              <ReferencesModeSwitch
                mode={mode}
                onChange={setMode}
                disabled={!view.hasDocument || emptySheet}
              />
            </div>
            {/*
              Where the touch layer's Settings pill goes: the right end of the
              header's first row, beside Back on a phone. Registered with the
              layout store as an element, and cleared by the same callback when
              the header unmounts; empty under a fine pointer, where the
              settings are the docked pane.
            */}
            <div className="references-panel__pills" ref={setViewDrawerSlot} />
          </div>
          {targeted && controller.target && (
            <div className="references-target-row">
              <ReferencesTargetControls
                candidateCount={controller.candidates?.length ?? 0}
                activeCandidate={controller.activeCandidate}
                active={active}
                onPreviousCandidate={controller.previousCandidate}
                onNextCandidate={controller.nextCandidate}
                onClear={controller.clear}
                previousLabel={commandById('previous-candidate')?.label ?? ''}
                nextLabel={commandById('next-candidate')?.label ?? ''}
                previousDisabled={commandById('previous-candidate')?.disabled ?? true}
                nextDisabled={commandById('next-candidate')?.disabled ?? true}
                // One line on a phone: the readout as numbers, the way out an icon.
                compact={flow.screen !== null}
              />
            </div>
          )}

          {surfaces.strip === 'none' ? (
            <ReferencesLead
              lead={surfaces.lead}
              onPlan={breakdown.run}
              onPlanSequence={planSequenceFromLead}
            />
          ) : (
            <ReferencesStepFilmstrip
              steps={filmstrip}
              activeStep={activeStep}
              onSelectStep={selectStep}
              onPrevious={previousStep}
              onNext={nextStep}
              previousLabel={commandById('previous-step')?.label ?? ''}
              nextLabel={commandById('next-step')?.label ?? ''}
              previousDisabled={commandById('previous-step')?.disabled ?? true}
              nextDisabled={commandById('next-step')?.disabled ?? true}
              // Off on the phone, whose flow is the one that has a screen at all.
              navigation={flow.screen === null}
              placeholder={filmstripPlaceholder}
            />
          )}

          <div className="panel-body references-panel__body" onContextMenu={onBodyContextMenu}>
            {view.geometry && (
              <ReferencesCpView
                ref={viewRef}
                geometry={view.geometry}
                lineStyle={view.lineStyle}
                mode={view.mode}
                lineWidth={view.lineWidth}
                pointSize={view.pointSize}
                wheelGesture={view.wheelGesture}
                snapRadius={view.snapRadius}
                highlightVertexIdx={highlights.highlightVertexIdx}
                diagramStrokes={scene.strokes}
                selected={highlights.selected}
                onViewChange={setDiagramCamera}
                onZoomPercentChange={setZoomPercent}
                sheetLineIds={sheetIds}
                creaseVisibility={creaseVisibility}
                mirrored={mirrored}
                fold={foldScene}
                onPick={onPick}
                framingKey={`${view.framingKey}-sheet-${selectedSheet ?? 'none'}`}
                themeKey={view.themeKey}
                ariaLabel={t(
                  'panels:references.canvasAriaLabel',
                  'Crease pattern. Click a vertex or crease to find its references; drag to pan, scroll to zoom.'
                )}
              />
            )}
            <ReferencesDiagramLayer
              model={scene.symbols}
              camera={diagramCamera}
              lineWidth={view.lineWidth}
            />
            {view.geometry && (
              <ReferencesViewportToolbar
                zoomPercent={zoomPercent}
                setZoomPercent={zoomTo}
                commands={commands}
                run={runShortcut}
                shortcuts={shortcutOverrides}
              />
            )}
            <ContextMenu
              open={contextMenu.open}
              x={contextMenu.x}
              y={contextMenu.y}
              items={contextMenu.items}
              onOpenChange={contextMenu.onOpenChange}
              onCloseAutoFocus={contextMenu.onCloseAutoFocus}
            />
            {!view.hasDocument && (
              <div className="references-panel__overlay">
                <span>{t('panels:references.noCreasePattern', 'No crease pattern')}</span>
                <small>
                  {t(
                    'panels:references.empty',
                    'No crease pattern. Open or draw one in Edit, then come back.'
                  )}
                </small>
                <NextDocumentAction />
              </div>
            )}
            {view.hasDocument && surfaces.emptySheet && !busy && (
              <div className="references-panel__overlay" role="status">
                <span>{t('panels:references.emptySheet', 'No creases yet')}</span>
                <small>
                  {t(
                    'panels:references.emptySheetHint',
                    'This sheet has no creases yet. Draw the pattern in Edit, then come back.'
                  )}
                </small>
                <Button variant="primary" size="sm" onClick={goToEdit}>
                  {t('panels:references.goToEdit', 'Go to Edit')}
                </Button>
              </div>
            )}
            {view.hasDocument && readoutState === 'running' && (
              <div
                className="references-panel__overlay references-panel__overlay--loading"
                role="status"
              >
                <span>
                  {indicator.stopping
                    ? t('panels:references.stopping', 'Cancelling…')
                    : targeted
                      ? t('panels:references.searching', 'Finding references…')
                      : t('panels:references.planning', 'Working out the precreasing sequence…')}
                </span>
                {breakdown.progress && breakdown.progress.total > 0 && (
                  <small>
                    {breakdown.progress.phase === 'querying'
                      ? t(
                          'panels:references.progress.querying',
                          'Searching {{done}} of {{total}} lines',
                          { done: breakdown.progress.done, total: breakdown.progress.total }
                        )
                      : t(
                          'panels:references.progress.closing',
                          'Folded {{done}} of {{total}} lines',
                          { done: breakdown.progress.done, total: breakdown.progress.total }
                        )}
                  </small>
                )}
                {indicator.stoppable && !indicator.stopping && (
                  <Button variant="secondary" size="sm" onClick={() => indicator.stop()}>
                    {t('panels:references.stop', 'Stop')}
                  </Button>
                )}
              </div>
            )}
            {view.hasDocument && readoutState === 'stale' && (
              <div className="references-panel__overlay" role="status">
                <span>{t('panels:references.outOfDate', 'Out of date')}</span>
                <small>
                  {t(
                    'panels:references.outOfDateHint',
                    'The crease pattern changed since these references were found.'
                  )}
                </small>
                <Button variant="primary" size="sm" onClick={recompute}>
                  {t('panels:references.recompute', 'Recompute')}
                </Button>
              </div>
            )}
            {view.hasDocument && run.status === 'error' && (
              <div className="references-panel__overlay" role="alert">
                <span>{t('panels:references.errorTitle', 'References unavailable')}</span>
                <small>{run.message}</small>
                <div className="references-panel__overlay-actions">
                  {canRecompute && (
                    <Button variant="primary" size="sm" onClick={recompute}>
                      {t('panels:references.recompute', 'Recompute')}
                    </Button>
                  )}
                  <Button variant="secondary" size="sm" onClick={controller.clear}>
                    {t('panels:references.dismiss', 'Dismiss')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
