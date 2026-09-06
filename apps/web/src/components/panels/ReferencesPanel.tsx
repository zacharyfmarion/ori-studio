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
import { useReferencesRun, useReferencesRunToast } from '../../cp-workspace/references/useReferencesRun';
import { useReferencesShortcuts } from '../../cp-workspace/references/useReferencesShortcuts';
import { useReferencesTarget } from '../../cp-workspace/references/useReferencesTarget';
import {
  useReferencesHighlights,
  useReferencesView,
} from '../../cp-workspace/references/useReferencesView';
import { NextDocumentAction } from './NextDocumentAction';

/**
 * The References workspace's dock panel: a composition site. The sidebar, the
 * crease-pattern view, the toolbar and the transport strip are mounted here and
 * wired to each other; every behaviour lives in `cp-workspace/references/` —
 * the store bindings in `useReferencesView` / `useReferencesTarget`, the verbs
 * in the action catalog, the keys in the `references` shortcut scope. No
 * keyboard handling here (AGENTS.md > Panel components).
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
  const highlights = useReferencesHighlights(
    view.geometry,
    controller.results,
    !controller.stale,
    controller.activeCandidate,
    controller.activeStep
  );
  const run = useWorkspaceStore((state) => state.referencesRun);
  const settings = useWorkspaceStore((state) => state.referencesSettings);
  const setReferencesSettings = useWorkspaceStore((state) => state.setReferencesSettings);
  const shortcutOverrides = useShortcutStore((store) => store.overrides);
  const indicator = useReferencesRun();
  useReferencesRunToast(indicator);

  const viewRef = useRef<ReferencesCpViewHandle | null>(null);
  const fitView = useCallback(() => viewRef.current?.fit(), []);
  const zoomIn = useCallback(() => viewRef.current?.zoomIn(), []);
  const zoomOut = useCallback(() => viewRef.current?.zoomOut(), []);

  // One set of verbs, three surfaces: the keymap, the transport strip and the
  // context menu all dispatch through `runReferencesShortcut` against these.
  const shortcutActions: ReferencesShortcutActions = {
    nextStep: controller.nextStep,
    previousStep: controller.previousStep,
    nextCandidate: controller.nextCandidate,
    previousCandidate: controller.previousCandidate,
    recompute: controller.recompute,
    // Phase 5: hoists the whole-pattern breakdown's auxiliary folds. There is no
    // breakdown yet, so the chord is registered and does nothing.
    toggleLandmarksFirst: () => undefined,
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

  const canRecompute =
    controller.target !== null && run.status !== 'running' && run.status !== 'stopping';
  const actions = buildReferencesActions(
    {
      stepCount: controller.stepCount,
      activeStep: controller.activeStep,
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
    : run.status === 'running' || run.status === 'stopping'
      ? 'running'
      : run.status === 'error'
        ? 'error'
        : controller.stale
          ? 'stale'
          : active
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
      />
      <section className="panel-shell references-panel">
        <div className="panel-toolbar">
          <div className="panel-toolbar__group">
            <Compass size={14} />
            <span className="panel-title">{t('panels:references.title', 'References')}</span>
            {controller.target && (
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
          </div>
          <div className="panel-toolbar__group">
            <ReferencesSettingsMenu
              settings={settings}
              onChange={setReferencesSettings}
              disabled={!view.hasDocument}
            />
            <IconButton
              size="sm"
              variant="toolbar"
              title={commandById('recompute')?.label ?? t('panels:references.recompute', 'Recompute')}
              disabled={!canRecompute}
              onClick={controller.recompute}
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
                  : t('panels:references.searching', 'Finding references…')}
              </span>
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
              <Button variant="primary" size="sm" onClick={controller.recompute}>
                {t('panels:references.recompute', 'Recompute')}
              </Button>
            </div>
          )}
          {view.hasDocument && run.status === 'error' && (
            <div className="references-panel__overlay" role="alert">
              <span>{t('panels:references.errorTitle', 'References unavailable')}</span>
              <small>{run.message}</small>
              <div className="references-panel__overlay-actions">
                {controller.target && (
                  <Button variant="primary" size="sm" onClick={controller.recompute}>
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
              max={Math.max(0, controller.stepCount - 1)}
              step="1"
              value={controller.activeStep}
              onChange={(event) => controller.selectStep(Number(event.currentTarget.value))}
              disabled={controller.stepCount === 0}
            />
            <output>
              {controller.stepCount > 0
                ? t('panels:references.stepReadout', '{{n}} / {{total}}', {
                    n: controller.activeStep + 1,
                    total: controller.stepCount,
                  })
                : t('panels:references.noSteps', '—')}
            </output>
          </label>
          <div className="references-readout" data-state={readoutState}>
            {active && (
              <Badge tone={active.solution.exact ? 'accent' : 'neutral'}>
                {active.solution.exact
                  ? t('panels:references.exact', 'Exact')
                  : t('panels:references.approximate', 'Approx.')}
              </Badge>
            )}
            {active && !active.solution.exact && (
              <span>
                {t('panels:references.readout.error', 'err {{value}}', {
                  value: active.solution.err.toExponential(1),
                })}
              </span>
            )}
            {active && controller.results && (
              <span>
                {t('panels:references.readout.duration', '{{ms}} ms', {
                  ms: Math.round(controller.results.durationMs),
                })}
              </span>
            )}
            {readoutState === 'idle' && (
              <span>{t('panels:references.readout.idle', 'Pick a vertex or crease')}</span>
            )}
            {readoutState === 'stale' && (
              <span>{t('panels:references.outOfDate', 'Out of date')}</span>
            )}
            {readoutState === 'running' && (
              <span>{t('panels:references.searching', 'Finding references…')}</span>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
