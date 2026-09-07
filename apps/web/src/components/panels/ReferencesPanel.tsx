import { useCallback, useEffect, useMemo, useRef, type MouseEvent as ReactMouseEvent } from 'react';
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
import { ReferencesSheetsSidebar } from '../../cp-workspace/references/ReferencesSheetsSidebar';
import { ReferencesStepFilmstrip } from '../../cp-workspace/references/ReferencesStepFilmstrip';
import { ReferencesSummaryStrip } from '../../cp-workspace/references/ReferencesSummaryStrip';
import { ReferencesTargetControls } from '../../cp-workspace/references/ReferencesTargetControls';
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
import {
  runReferencesShortcut,
  type ReferencesShortcutActions,
} from '../../cp-workspace/references/referencesShortcuts';
import { useReferencesAutoPlan } from '../../cp-workspace/references/useReferencesAutoPlan';
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
 * The References workspace's dock panel: a composition site. The sheet picker,
 * the step filmstrip, the crease-pattern view and the toolbar are mounted here
 * and wired to each other; every behaviour lives in `cp-workspace/references/`
 * — the store bindings in `useReferencesView` / `useReferencesTarget` /
 * `useReferencesBreakdown`, the verbs in the action catalog, the keys in the
 * `references` shortcut scope. No keyboard handling here (AGENTS.md > Panel
 * components).
 *
 * The workspace reads top to bottom like a diagram: the steps as a strip of
 * numbered cards, the active step's sentence under it, and the crease pattern
 * below showing the sheet as it stands at that step. The left rail is the
 * document's patterns, one of which is being folded.
 *
 * Two modes share those surfaces: with a vertex or crease picked they describe
 * ReferenceFinder's candidates; with nothing picked they describe the
 * whole-pattern breakdown. Choosing between the two is this file's only real
 * decision, and it is one `targeted` flag.
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

const VIEW_ACTIONS: readonly ReferencesActionIcon[] = ['zoom-out', 'zoom-in', 'reset-view'];

export function ReferencesPanel() {
  const { t } = useTranslation();
  const view = useReferencesView();
  const controller = useReferencesTarget(view);
  const settings = useWorkspaceStore((state) => state.referencesSettings);
  const setReferencesSettings = useWorkspaceStore((state) => state.setReferencesSettings);
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

  const breakdown = useReferencesBreakdown(
    view.geometry,
    view.revision,
    controller.frames,
    selectedSheet
  );
  const targeted = controller.target !== null && controller.target.kind !== 'whole';

  const targetHighlights = useReferencesHighlights(
    view.geometry,
    controller.results,
    !controller.stale,
    controller.picked,
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

  // Transport and filmstrip address whichever mode is showing.
  const stepCount = targeted ? controller.stepCount : breakdown.flatSteps.length;
  const activeStep = targeted ? controller.activeStep : breakdown.activeStep;
  const selectStep = targeted ? controller.selectStep : breakdown.selectStep;
  const nextStep = useCallback(() => selectStep(activeStep + 1), [selectStep, activeStep]);
  const previousStep = useCallback(() => selectStep(activeStep - 1), [selectStep, activeStep]);

  const busy = run.status === 'running' || run.status === 'stopping';
  const active = controller.active;
  /**
   * What the caption says when the strip is empty, which is three different
   * things. A solution with no steps is the one worth telling apart: a corner
   * or an edge midpoint is already on the paper, so "no construction found"
   * would be exactly wrong about an answer that is both found and free.
   */
  const filmstripPlaceholder = busy
    ? targeted
      ? t('panels:references.searching', 'Finding references…')
      : t('panels:references.planning', 'Working out the folding sequence…')
    : targeted
      ? active
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
          )
      : t(
          'panels:references.sheets.noPlan',
          'Work out how to fold this pattern, or click a vertex or crease for one reference.'
        );
  /**
   * The free sheet diagonals a solution leans on.
   *
   * ReferenceFinder treats both as rank-1 originals, so they never appear as a
   * step — but they are creases the folder still has to make, and a sequence
   * that does not mention them undercounts its own folds.
   */
  const filmstripNote = useMemo(() => {
    const free = targeted ? (active?.solution.freeDiagonals ?? []) : [];
    if (free.length === 0) return '';
    return t('panels:references.freeDiagonals', 'Also needs the sheet diagonal(s): {{names}}.', {
      names: free
        .map((name) =>
          name === 'sw_ne'
            ? t('panels:references.ref.diagonalSwNe', 'the bottom-left to top-right diagonal')
            : t('panels:references.ref.diagonalNwSe', 'the top-left to bottom-right diagonal')
        )
        .join(', '),
    });
  }, [targeted, active, t]);
  const filmstrip = useMemo(
    () =>
      targeted
        ? candidateFilmstrip(t, active)
        : planFilmstrip(t, breakdown.variants, breakdown.flatSteps),
    [targeted, t, active, breakdown.variants, breakdown.flatSteps]
  );

  // The sheet as it stands at the active step — see `referencesCreaseVisibility`.
  const creaseVisibility = useMemo(() => {
    if (!sheetIds) return REFERENCES_ALL_CREASES;
    const input = {
      sheetLineIds: sheetIds,
      borderLineIds: borderIds,
      activeLineIds: highlights.highlightLineIds,
    };
    if (targeted) return targetVisibility(input);
    if (breakdown.variants.length === 0) return unreadVisibility(input);
    return planVisibility(breakdown.variants, breakdown.flatSteps, breakdown.activeStep, input);
  }, [
    sheetIds,
    borderIds,
    targeted,
    highlights.highlightLineIds,
    breakdown.variants,
    breakdown.flatSteps,
    breakdown.activeStep,
  ]);

  // The sequence is what the workspace is for, so it runs on arrival rather
  // than behind a button — see `useReferencesAutoPlan` for what stops that
  // becoming a loop.
  useReferencesAutoPlan(
    {
      hasDocument: view.hasDocument,
      revision: view.revision,
      sheet: selectedSheet,
      ready: controller.frames !== null,
      planned: breakdown.record !== null,
      busy,
      targeted,
    },
    breakdown.run
  );

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

  // A *finding* frames itself, because it is the only way to see where an
  // unreached line is. A step deliberately does not: walking the sequence used
  // to walk the pattern around the viewport, which made it unreadable.
  // `activeFinding` is one store field shared by both modes, so it can still be
  // set from a breakdown when a vertex is picked — and without the `targeted`
  // half of this gate, framing came back for every step of a *target*, which is
  // the behaviour the gate exists to remove.
  const findingBounds =
    !targeted && breakdown.activeFinding !== null ? highlights.stepBounds : null;
  useEffect(() => {
    if (findingBounds) viewRef.current?.frameModelBounds(findingBounds);
  }, [findingBounds]);

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
        : controller.stale || (!targeted && breakdown.stale)
          ? 'stale'
          : 'ready';

  return (
    <div className="references-workspace">
      <ReferencesSheetsSidebar
        sheets={sheets}
        components={controller.frames?.components ?? []}
        geometry={view.geometry}
        selected={selectedSheet}
        onSelect={selectSheet}
        breakdown={breakdown}
        analysis={breakdown.analysisRecord}
        busy={busy}
        hasDocument={view.hasDocument}
        targeted={targeted}
        hint={controller.hint}
        warnings={controller.warnings}
      />
      <section className="panel-shell references-panel">
        <div className="panel-toolbar">
          <div className="panel-toolbar__group">
            <Compass size={14} />
            <span className="panel-title">{t('panels:references.title', 'References')}</span>
            {targeted && controller.target && (
              <ReferencesTargetControls
                target={controller.target}
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
              />
            )}
            {!targeted && <ReferencesSummaryStrip summary={breakdown.summary} />}
          </div>
          <div className="panel-toolbar__group">
            {VIEW_ACTIONS.map((id) => {
              const command = commandById(id);
              if (!command) return null;
              const Icon = ACTION_ICONS[id];
              return (
                <IconButton
                  key={id}
                  size="sm"
                  variant="toolbar"
                  title={command.label}
                  disabled={command.disabled}
                  onClick={() => runShortcut(command.shortcutId)}
                >
                  <Icon size={14} />
                </IconButton>
              );
            })}
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
          placeholder={filmstripPlaceholder}
          note={filmstripNote}
        />

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
              ghostSegments={highlights.ghostSegments}
              markers={highlights.markers}
              selected={highlights.selected}
              sheetLineIds={sheetIds}
              creaseVisibility={creaseVisibility}
              onPick={controller.pick}
              framingKey={`${view.framingKey}-sheet-${selectedSheet ?? 'none'}`}
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
      </section>
    </div>
  );
}
