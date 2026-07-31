import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Play, Sparkles, X } from 'lucide-react';
import {
  MAX_BP_RANDOM_CANDIDATES,
  MIN_BP_RANDOM_CANDIDATES,
  useBpOptimizerUiStore,
} from '../store/bpOptimizerUiStore';
import { cancelActiveOristudioBpOptimizer } from '../store/workspaceStore/oristudioBpRuntime';
import { useWorkspaceStore } from '../store/workspaceStore';
import { resolveOptimizerSymmetry, type SymmetryFold } from '../lib/bpOptimizerSymmetry';
import { SYMMETRY_FOLDS, symmetryFoldLabel } from '../lib/bpSymmetryLabels';
import { Button } from './ui/Button';
import { IconButton } from './ui/IconButton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/Select';
import { Toggle } from './ui/Toggle';
import type {
  OristudioBpOptimizerLayoutMode,
  OristudioBpOptimizerProgress,
  OristudioBpOptimizerStage,
} from '../engine/oristudioBpTypes';

/**
 * Box Pleating Studio's own stage wording (`plugin.optimizer` in its locale
 * files, plus the modal's inline strings). The optimizer runs a continuous
 * pre-solve and then fits the result onto the grid, and those are the two
 * phases users are told about.
 */
function stageLabel(t: TFunction, stage: OristudioBpOptimizerStage): string {
  switch (stage) {
    case 'initializing':
      return t('dialogs:bpOptimizer.stage.initializing', 'Initializing...');
    case 'start':
      return t('dialogs:bpOptimizer.stage.start', 'Processing problem...');
    case 'candidate-generation':
      return t('dialogs:bpOptimizer.stage.candidates', 'Generating candidate layouts...');
    case 'continuous-solving':
    case 'pre-solving':
    case 'packing':
      return t('dialogs:bpOptimizer.stage.preSolving', 'Pre-solving...');
    case 'integral-grid-fitting':
      return t('dialogs:bpOptimizer.stage.fitting', 'Fitting to the grid...');
    default:
      return t('dialogs:bpOptimizer.stage.running', 'Running...');
  }
}

function layoutModeLabel(t: TFunction, mode: OristudioBpOptimizerLayoutMode): string {
  return mode === 'view'
    ? t('dialogs:bpOptimizer.layout.view', 'Use current layout as reference')
    : t('dialogs:bpOptimizer.layout.random', 'Try random layouts');
}

function ProgressRow({ progress }: { progress: OristudioBpOptimizerProgress | null }) {
  const { t } = useTranslation();
  // Only the stages that report a denominator get a determinate bar; the rest
  // stay indeterminate rather than inventing a percentage.
  const determinate =
    progress != null &&
    progress.total != null &&
    progress.total > 0 &&
    progress.current != null;
  const ratio = determinate
    ? Math.min(1, Math.max(0, progress.current! / progress.total!))
    : 0;

  return (
    <div className="bp-optimizer__progress">
      <div className="bp-optimizer__progress-label">
        {progress ? stageLabel(t, progress.stage) : t('dialogs:bpOptimizer.stage.start', 'Processing problem...')}
      </div>
      <div
        className="bp-optimizer__progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={determinate ? progress.total! : undefined}
        aria-valuenow={determinate ? progress.current! : undefined}
      >
        <div
          className={`bp-optimizer__progress-fill${determinate ? '' : ' bp-optimizer__progress-fill--indeterminate'}`}
          style={determinate ? { width: `${ratio * 100}%` } : undefined}
        />
      </div>
    </div>
  );
}

export function BpOptimizerModal() {
  const { t } = useTranslation();
  const isOpen = useBpOptimizerUiStore((state) => state.isOpen);
  const close = useBpOptimizerUiStore((state) => state.close);
  const options = useBpOptimizerUiStore((state) => state.options);
  const setOptions = useBpOptimizerUiStore((state) => state.setOptions);
  const running = useBpOptimizerUiStore((state) => state.running);
  const progress = useBpOptimizerUiStore((state) => state.progress);
  const error = useBpOptimizerUiStore((state) => state.error);
  const optimize = useWorkspaceStore((state) => state.optimizeOristudioBpLayout);
  const symmetryState = useWorkspaceStore((state) => state.oristudioBpSymmetry);
  const tree = useWorkspaceStore((state) => state.oristudioBpDocument?.snapshot.tree ?? null);
  // The fold lives here rather than in the tree view: a tree is not drawn on the
  // paper, so it has no book or diagonal fold of its own. The tree's mirror line
  // stays vertical whatever is chosen here.
  const foldOptions = useMemo(
    () => SYMMETRY_FOLDS.map((fold) => ({ fold, label: symmetryFoldLabel(t, fold) })),
    [t]
  );

  /** What the dialog can say about symmetry right now. */
  const symmetry = useMemo(() => {
    if (!symmetryState.enabled || !tree) return { mode: 'off' as const };
    const resolved = resolveOptimizerSymmetry(tree, symmetryState, {
      fold: options.symmetryFold,
    });
    if (!resolved.ok) {
      return { mode: 'unusable' as const, reason: resolved.reason };
    }
    return { mode: 'ready' as const, inconsistent: resolved.inconsistentPairs.length };
  }, [options.symmetryFold, symmetryState, tree]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Escape closes an idle dialog. While running it aborts instead, so a long
      // run is never left going with no visible way back to it.
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      if (running) cancelActiveOristudioBpOptimizer();
      else close();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [close, isOpen, running]);

  if (!isOpen) return null;

  const run = async () => {
    const store = useBpOptimizerUiStore.getState();
    store.beginRun();
    // The stored preference is left alone when symmetry cannot apply; the row
    // explains why rather than silently rewriting what the user chose.
    const effective = { ...options, respectSymmetry: options.respectSymmetry && symmetry.mode === 'ready' };
    const outcome = await optimize(effective, (next) => {
      useBpOptimizerUiStore.getState().reportProgress(next);
    });
    if (outcome === 'applied') {
      store.finishRun();
      close();
      return;
    }
    if (outcome === 'cancelled') {
      store.finishRun();
      return;
    }
    store.finishRun(
      useWorkspaceStore.getState().oristudioBpError ??
        t('dialogs:bpOptimizer.failed', 'The optimizer could not find a layout.')
    );
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('dialogs:bpOptimizer.title', 'Optimize layout')}
      className="simple-modal"
      onMouseDown={() => {
        if (!running) close();
      }}
    >
      <div
        role="document"
        className="simple-modal__document simple-modal__document--bp-optimizer"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="simple-modal__header">
          <span>
            <Sparkles size={15} aria-hidden="true" />
            {t('dialogs:bpOptimizer.title', 'Optimize layout')}
          </span>
          <IconButton
            size="sm"
            aria-label={t('dialogs:bpOptimizer.close', 'Close optimize layout')}
            disabled={running}
            onClick={close}
          >
            <X size={15} />
          </IconButton>
        </header>

        <div className="simple-modal__body">
          {running ? (
            <ProgressRow progress={progress} />
          ) : (
            <>
              <div className="bp-optimizer__row">
                <span className="bp-optimizer__row-label">
                  {t('dialogs:bpOptimizer.options', 'Options')}
                </span>
                <label className="bp-optimizer__check">
                  <Toggle
                    checked={options.useDimension}
                    onChange={(checked) => setOptions({ useDimension: checked })}
                  />
                  <span>
                    {t('dialogs:bpOptimizer.useDimension', 'Keep widths and heights of flaps')}
                  </span>
                </label>
              </div>

              <div className="bp-optimizer__row">
                <span className="bp-optimizer__row-label">
                  {t('dialogs:bpOptimizer.layoutMethod', 'Layout method')}
                </span>
                <div className="bp-optimizer__control">
                  <Select
                    value={options.layoutMode}
                    onValueChange={(value) =>
                      setOptions({ layoutMode: value as OristudioBpOptimizerLayoutMode })
                    }
                  >
                    <SelectTrigger aria-label={t('dialogs:bpOptimizer.layoutMethod', 'Layout method')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(['view', 'random'] as const).map((mode) => (
                        <SelectItem key={mode} value={mode}>
                          {layoutModeLabel(t, mode)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {options.layoutMode === 'view' ? (
                    <label className="bp-optimizer__check">
                      <Toggle
                        checked={options.useBasinHopping}
                        onChange={(checked) => setOptions({ useBasinHopping: checked })}
                      />
                      <span>
                        {t(
                          'dialogs:bpOptimizer.useBasinHopping',
                          'Try variations of the current layouts'
                        )}
                      </span>
                    </label>
                  ) : (
                    <label className="bp-optimizer__count">
                      <span>
                        {t('dialogs:bpOptimizer.toTry', 'Number of layouts to try:')}
                      </span>
                      <input
                        type="number"
                        min={MIN_BP_RANDOM_CANDIDATES}
                        max={MAX_BP_RANDOM_CANDIDATES}
                        step={1}
                        value={options.randomCandidateCount}
                        onChange={(event) =>
                          setOptions({ randomCandidateCount: event.currentTarget.valueAsNumber })
                        }
                      />
                    </label>
                  )}
                </div>
              </div>

              <div className="bp-optimizer__row">
                <span className="bp-optimizer__row-label">
                  {t('dialogs:bpOptimizer.symmetry', 'Symmetry')}
                </span>
                <div className="bp-optimizer__control">
                  {symmetry.mode === 'off' ? (
                    <p className="bp-optimizer__hint">
                      {t(
                        'dialogs:bpOptimizer.symmetryOff',
                        'Symmetry is off. Turn it on in the tree view to mirror the layout.'
                      )}
                    </p>
                  ) : (
                    <>
                      <label className="bp-optimizer__check">
                        <Toggle
                          checked={options.respectSymmetry && symmetry.mode === 'ready'}
                          disabled={symmetry.mode !== 'ready'}
                          onChange={(checked) => setOptions({ respectSymmetry: checked })}
                        />
                        <span>{t('dialogs:bpOptimizer.enable', 'Enable symmetry')}</span>
                      </label>
                      <Select
                        value={options.symmetryFold}
                        onValueChange={(value) =>
                          setOptions({ symmetryFold: value as SymmetryFold })
                        }
                      >
                        <SelectTrigger
                          aria-label={t('dialogs:bpOptimizer.mirrorAxis', 'Fold to mirror about')}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {foldOptions.map((option) => (
                            <SelectItem key={option.fold} value={option.fold}>
                              {option.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {symmetry.mode === 'unusable' && (
                        <p className="bp-optimizer__hint bp-optimizer__hint--warn">
                          {symmetry.reason}
                        </p>
                      )}
                      {symmetry.mode === 'ready' && symmetry.inconsistent > 0 && (
                        <p className="bp-optimizer__hint bp-optimizer__hint--warn">
                          {t(
                            'dialogs:bpOptimizer.symmetryInconsistent',
                            'Some paired flaps are not interchangeable in the tree, so mirroring them will use more paper.'
                          )}
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>

              {error && <div className="bp-optimizer__error">{error}</div>}
            </>
          )}

          {/* Inside the body, as every other modal does it: `.simple-modal__footer`
              carries no padding of its own and relies on the body's. */}
          <footer className="simple-modal__footer">
            {running ? (
              <>
                <Button size="sm" variant="ghost" disabled>
                  {t('dialogs:bpOptimizer.running', 'Running...')}
                </Button>
                <Button size="sm" variant="danger" onClick={() => cancelActiveOristudioBpOptimizer()}>
                  {t('dialogs:bpOptimizer.abort', 'Abort')}
                </Button>
              </>
            ) : (
              <>
                <Button size="sm" variant="ghost" onClick={close}>
                  {t('dialogs:bpOptimizer.closeAction', 'Close')}
                </Button>
                <Button size="sm" variant="primary" onClick={() => void run()}>
                  {t('dialogs:bpOptimizer.run', 'Run!')}
                  <Play size={14} />
                </Button>
              </>
            )}
          </footer>
        </div>
      </div>
    </div>
  );
}
