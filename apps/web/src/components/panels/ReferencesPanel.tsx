import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Compass,
  Maximize,
  RefreshCw,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { ContextMenu } from '../ui/ContextMenu';
import { IconButton } from '../ui/IconButton';
import { useContextMenuController } from '../../menus/context/useContextMenuController';
import type { ReferencesShortcutId } from '../../keyboard/shortcuts';
import { useShortcutStore } from '../../store/shortcutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import {
  ReferencesCpView,
  type ReferencesCpViewHandle,
} from '../../cp-workspace/references/ReferencesCpView';
import { ReferencesSettingsMenu } from '../../cp-workspace/references/ReferencesSettingsMenu';
import { ReferencesStepsSidebar } from '../../cp-workspace/references/ReferencesStepsSidebar';
import { ReferencesSummaryStrip } from '../../cp-workspace/references/ReferencesSummaryStrip';
import {
  buildReferencesActions,
  referencesCommands,
  type ReferencesActionIcon,
} from '../../cp-workspace/references/referencesActions';
import { referencesMenuItems } from '../../cp-workspace/references/referencesContextMenu';
import {
  runReferencesShortcut,
  type ReferencesShortcutActions,
} from '../../cp-workspace/references/referencesShortcuts';
import { useReferencesBreakdown } from '../../cp-workspace/references/useReferencesBreakdown';
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
 * The References workspace's dock panel: a composition site. The sidebar, the
 * crease-pattern view, the toolbar and the transport strip are mounted here and
 * wired to each other; every behaviour lives in `cp-workspace/references/` —
 * the store bindings in `useReferencesView` / `useReferencesTarget` /
 * `useReferencesBreakdown`, the verbs in the action catalog, the keys in the
 * `references` shortcut scope. No keyboard handling here (AGENTS.md > Panel
 * components).
 *
 * Two modes share one set of surfaces: with a vertex or crease picked the
 * sidebar, transport and view describe ReferenceFinder's candidates; with
 * nothing picked they describe the whole-pattern breakdown. Choosing between
 * the two is this file's only real decision, and it is one `targeted` flag.
 */

const ACTION_ICONS: Record<ReferencesActionIcon, typeof ChevronLeft> = {
  'previous-step': ChevronLeft,
  'next-step': ChevronRight,
  'previous-candidate': ChevronsLeft,
  'next-candidate': ChevronsRight,
  recompute: RefreshCw,
  'reset-view': Maximize,
  'zoom-in': ZoomIn,
  'zoom-out': ZoomOut,
};

const TRANSPORT_ACTIONS: readonly ReferencesActionIcon[] = [
  'previous-candidate',
  'previous-step',
  'next-step',
  'next-candidate',
];

export function ReferencesPanel() {
  const { t } = useTranslation();
  const view = useReferencesView();
  const controller = useReferencesTarget(view);
  const settings = useWorkspaceStore((state) => state.referencesSettings);
  const setReferencesSettings = useWorkspaceStore((state) => state.setReferencesSettings);
  const breakdown = useReferencesBreakdown(view.geometry, view.revision, controller.frames);
  const targeted = controller.target !== null && controller.target.kind !== 'whole';

  const targetHighlights = useReferencesHighlights(
    view.geometry,
    controller.results,
    !controller.stale,
    controller.activeCandidate,
    controller.activeStep
  );
  const planHighlights = useReferencesPlanHighlights(
    breakdown.variants,
    breakdown.flatSteps,
    breakdown.activeStep,
    breakdown.activeFinding,
    settings.showPinches
  );
  const highlights = targeted ? targetHighlights : planHighlights;

  const run = useWorkspaceStore((state) => state.referencesRun);
  const shortcutOverrides = useShortcutStore((store) => store.overrides);
  const indicator = useReferencesRun();
  useReferencesRunToast(indicator);

  const viewRef = useRef<ReferencesCpViewHandle | null>(null);
  const fitView = useCallback(() => viewRef.current?.fit(), []);
  const zoomIn = useCallback(() => viewRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => viewRef.current?.zoomOut(), []);

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

  // Transport and scrubber address whichever mode is showing.
  const stepCount = targeted ? controller.stepCount : breakdown.flatSteps.length;
  const activeStep = targeted ? controller.activeStep : breakdown.activeStep;
  const selectStep = targeted ? controller.selectStep : breakdown.selectStep;
  const nextStep = useCallback(() => selectStep(activeStep + 1), [selectStep, activeStep]);
  const previousStep = useCallback(() => selectStep(activeStep - 1), [selectStep, activeStep]);

  /** Recompute re-runs whatever the sidebar is showing. */
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

  // One set of verbs, three surfaces: the keymap, the transport strip and the
  // context menu all dispatch through `runReferencesShortcut` against these.
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
  };
  useReferencesShortcuts(shortcutActions, view.hasDocument);
  // The strip and the menu run verbs through the same executor the keys do.
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

  const busy = run.status === 'running' || run.status === 'stopping';
  const canRecompute = !busy && (targeted ? controller.target !== null : view.hasDocument);
  const actions = buildReferencesActions(
    {
      stepCount,
      activeStep,
      candidateCount: controller.candidates?.length ?? 0,
      activeCandidate: controller.activeCandidate,
      canRecompute,
      hasView: view.geometry !== null,
    },
    { t }
  );
  const commands = referencesCommands(actions);
  const commandById = (id: ReferencesActionIcon) => commands.find((command) => command.id === id);

  // Selecting a step frames it: a jump toward its references, never a zoom out.
  const stepBounds = highlights.stepBounds;
  useEffect(() => {
    if (stepBounds) viewRef.current?.frameModelBounds(stepBounds);
  }, [stepBounds]);

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

  const active = controller.active;
  const readoutState = !view.hasDocument
    ? 'empty'
    : busy
      ? 'running'
      : run.status === 'error'
        ? 'error'
        : controller.stale || (!targeted && breakdown.stale)
          ? 'stale'
          : targeted
            ? active
              ? 'ready'
              : 'idle'
            : breakdown.record || breakdown.analysisRecord
              ? 'ready'
              : 'idle';

  return (
    <div className="references-workspace">
      <ReferencesStepsSidebar
        target={controller.target}
        candidates={controller.candidates}
        results={controller.results}
        activeCandidate={controller.activeCandidate}
        activeStep={controller.activeStep}
        status={run.status}
        hint={controller.hint}
        warnings={controller.warnings}
        onSelectCandidate={controller.selectCandidate}
        onSelectStep={controller.selectStep}
        breakdown={breakdown}
        analysis={breakdown.analysisRecord}
      />
      <section className="panel-shell references-panel">
        <div className="panel-toolbar">
          <div className="panel-toolbar__group">
            <Compass size={14} />
            <span className="panel-title">{t('panels:references.title', 'References')}</span>
            {targeted && controller.target && (
              <span className="panel-toolbar__meta">
                {controller.target.kind === 'vertex'
                  ? t('panels:references.meta.vertex', 'Vertex')
                  : t('panels:references.meta.crease', 'Crease')}
                {controller.candidates &&
                  ` · ${t('panels:references.meta.candidates', '{{n}} candidates', {
                    n: controller.candidates.length,
                  })}`}
              </span>
            )}
            {!targeted && <ReferencesSummaryStrip summary={breakdown.summary} />}
          </div>
          <div className="panel-toolbar__group">
            <ReferencesSettingsMenu
              settings={settings}
              onChange={setReferencesSettings}
              disabled={!view.hasDocument}
              landmarksFirst={breakdown.landmarksFirst}
              onToggleLandmarksFirst={breakdown.toggleLandmarksFirst}
              hasPlan={breakdown.record !== null}
            />
            <IconButton
              size="sm"
              variant="toolbar"
              title={commandById('recompute')?.label ?? t('panels:references.recompute', 'Recompute')}
              disabled={!canRecompute}
              onClick={recompute}
            >
              <RefreshCw size={14} />
            </IconButton>
          </div>
        </div>

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
              highlightLineIds={highlights.highlightLineIds}
              highlightVertexIdx={highlights.highlightVertexIdx}
              ghostSegments={highlights.ghostSegments}
              markers={highlights.markers}
              selected={highlights.selected}
              onPick={controller.pick}
              framingKey={view.framingKey}
              themeKey={view.themeKey}
              ariaLabel={t(
                'panels:references.canvasAriaLabel',
                'Crease pattern. Click a vertex or crease to find its references; drag to pan, scroll to zoom.'
              )}
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
          {view.hasDocument && readoutState === 'running' && (
            <div className="references-panel__overlay references-panel__overlay--loading" role="status">
              <span>
                {indicator.stopping
                  ? t('panels:references.stopping', 'Cancelling…')
                  : targeted
                    ? t('panels:references.searching', 'Finding references…')
                    : t('panels:references.planning', 'Working out the folding sequence…')}
              </span>
              {breakdown.progress && breakdown.progress.total > 0 && (
                <small>
                  {breakdown.progress.phase === 'querying'
                    ? t('panels:references.progress.querying', 'Searching {{done}} of {{total}} lines', {
                        done: breakdown.progress.done,
                        total: breakdown.progress.total,
                      })
                    : t('panels:references.progress.closing', 'Folded {{done}} of {{total}} lines', {
                        done: breakdown.progress.done,
                        total: breakdown.progress.total,
                      })}
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

        <div className="references-controls">
          <div
            className="references-transport"
            aria-label={t('panels:references.controls', 'Step controls')}
          >
            {TRANSPORT_ACTIONS.map((id) => {
              const command = commandById(id);
              if (!command) return null;
              const Icon = ACTION_ICONS[id];
              return (
                <IconButton
                  key={id}
                  size="sm"
                  title={command.label}
                  tooltipSide="top"
                  disabled={command.disabled}
                  onClick={() => runShortcut(command.shortcutId)}
                >
                  <Icon size={14} />
                </IconButton>
              );
            })}
          </div>
          <label className="references-scrubber">
            <span>{t('panels:references.stepLabel', 'Step')}</span>
            <input
              aria-label={t('panels:references.stepScrubber', 'Step')}
              type="range"
              min="0"
              max={Math.max(0, stepCount - 1)}
              step="1"
              value={activeStep}
              onChange={(event) => selectStep(Number(event.currentTarget.value))}
              disabled={stepCount === 0}
            />
            <output>
              {stepCount > 0
                ? t('panels:references.stepReadout', '{{n}} / {{total}}', {
                    n: activeStep + 1,
                    total: stepCount,
                  })
                : t('panels:references.noSteps', '—')}
            </output>
          </label>
          <div className="references-readout" data-state={readoutState}>
            {targeted && active && (
              <Badge tone={active.solution.exact ? 'accent' : 'neutral'}>
                {active.solution.exact
                  ? t('panels:references.exact', 'Exact')
                  : t('panels:references.approximate', 'Approx.')}
              </Badge>
            )}
            {targeted && active && !active.solution.exact && (
              <span>
                {t('panels:references.readout.error', 'err {{value}}', {
                  value: active.solution.err.toExponential(1),
                })}
              </span>
            )}
            {targeted && active && controller.results && (
              <span>
                {t('panels:references.readout.duration', '{{ms}} ms', {
                  ms: Math.round(controller.results.durationMs),
                })}
              </span>
            )}
            {!targeted && breakdown.summary && (
              <span>
                {t('panels:references.readout.duration', '{{ms}} ms', {
                  ms: Math.round(breakdown.summary.durationMs),
                })}
              </span>
            )}
            {readoutState === 'idle' && (
              <span>
                {targeted
                  ? t('panels:references.readout.idle', 'Pick a vertex or crease')
                  : t('panels:references.readout.noPlan', 'No folding sequence yet')}
              </span>
            )}
            {readoutState === 'stale' && (
              <span>{t('panels:references.outOfDate', 'Out of date')}</span>
            )}
            {readoutState === 'running' && (
              <span>
                {targeted
                  ? t('panels:references.searching', 'Finding references…')
                  : t('panels:references.planning', 'Working out the folding sequence…')}
              </span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
