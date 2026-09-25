import type { TFunction } from 'i18next';
import { shortcutActionLabel } from '../../i18n/shortcutLabels';
import { getShortcutDefinition, type ReferencesShortcutId } from '../../keyboard/shortcuts';

/**
 * The verbs the References workspace offers, in the order both surfaces present
 * them — the transport strip's buttons and the view's context menu.
 *
 * `foldedFigureActions.ts`'s shape: React-free and store-free, taking the
 * current navigation state plus bound callbacks and returning plain data, so
 * the two surfaces cannot drift (a verb added here appears in both) and the
 * gating is testable on its own. Every verb is also a `references.*` shortcut,
 * and its label is the registry's, so a rebound key shows rebound in the menu.
 */

/** Icon names, resolved to components by each surface (this module stays JSX-free). */
export type ReferencesActionIcon =
  | 'previous-step'
  | 'next-step'
  | 'play-fold'
  | 'previous-candidate'
  | 'next-candidate'
  | 'previous-way'
  | 'next-way'
  | 'recompute'
  | 'reset-view'
  | 'zoom-in'
  | 'zoom-out';

/**
 * What a command draws: its own id, or, for the one verb whose picture
 * follows its state, what pressing it would do next.
 */
export type ReferencesIconName = ReferencesActionIcon | 'pause-fold' | 'unfold';

export interface ReferencesCommand {
  kind: 'command';
  id: ReferencesActionIcon;
  /**
   * The registry id the verb answers to. The surfaces show its chord and
   * dispatch it through the panel's one executor at event time — a descriptor
   * carries no bound callback, so building the list during render closes over
   * nothing.
   */
  shortcutId: ReferencesShortcutId;
  label: string;
  icon: ReferencesIconName;
  disabled: boolean;
  /** Why it is disabled, for a menu row's hint. */
  hint?: string;
}

export interface ReferencesSeparator {
  kind: 'separator';
  id: string;
}

export type ReferencesAction = ReferencesCommand | ReferencesSeparator;

/** What the verbs can be gated on. */
export interface ReferencesActionState {
  stepCount: number;
  activeStep: number;
  candidateCount: number;
  activeCandidate: number;
  /** How many ways the active card offers — 0 for a card with one — and which it shows. */
  wayCount: number;
  activeWay: number;
  /** A target exists and no query is in flight. */
  canRecompute: boolean;
  /** The view has a pattern to look at. */
  hasView: boolean;
  /** The active card's fold, as the transport has it. */
  fold: {
    /** The card has a fold to play. */
    available: boolean;
    playing: boolean;
    /** At rest, folded over: the verb is Unfold. */
    folded: boolean;
    /** The card is a pleat, which is many folds and not animated. */
    pleat: boolean;
  };
}

export interface ReferencesActionDeps {
  t: TFunction;
}

function labelFor(t: TFunction, id: ReferencesShortcutId, fallback: string): string {
  const definition = getShortcutDefinition(id);
  return definition ? shortcutActionLabel(t, definition) : fallback;
}

export function buildReferencesActions(
  state: ReferencesActionState,
  deps: ReferencesActionDeps
): ReferencesAction[] {
  const { t } = deps;
  const hasSteps = state.stepCount > 0;
  const hasCandidates = state.candidateCount > 0;
  const noTarget = t('panels:references.actions.noTargetHint', 'Pick a vertex or crease first');
  const oneWay = t('panels:references.actions.oneWayHint', 'This step folds only one way');
  const command = (
    id: ReferencesActionIcon,
    shortcutId: ReferencesShortcutId,
    fallback: string,
    disabled: boolean,
    hint?: string
  ): ReferencesCommand => ({
    kind: 'command',
    id,
    shortcutId,
    label: labelFor(t, shortcutId, fallback),
    icon: id,
    disabled,
    hint: disabled ? hint : undefined,
  });
  // One verb, three faces: Play from flat, Pause while it moves, Unfold from
  // folded. The registry names the first; the other two are what the same
  // key does next.
  const { fold } = state;
  const playFold: ReferencesCommand = {
    ...command(
      'play-fold',
      'references.playFold',
      'Play Fold',
      !fold.available,
      fold.pleat
        ? t('panels:references.actions.pleatHint', 'Pleats aren’t animated yet')
        : t('panels:references.actions.noFoldHint', 'Nothing to fold on this card')
    ),
    ...(fold.playing
      ? { label: t('panels:references.actions.pauseFold', 'Pause Fold'), icon: 'pause-fold' as const }
      : fold.folded
        ? { label: t('panels:references.actions.unfold', 'Unfold'), icon: 'unfold' as const }
        : {}),
  };

  return [
    command(
      'previous-step',
      'references.previousStep',
      'Previous Step',
      !hasSteps || state.activeStep <= 0,
      hasSteps ? undefined : noTarget
    ),
    command(
      'next-step',
      'references.nextStep',
      'Next Step',
      !hasSteps || state.activeStep >= state.stepCount - 1,
      hasSteps ? undefined : noTarget
    ),
    playFold,
    { kind: 'separator', id: 'after-steps' },
    command(
      'previous-way',
      'references.previousWay',
      'Previous Way',
      state.wayCount < 2 || state.activeWay <= 0,
      state.wayCount < 2 ? oneWay : undefined
    ),
    command(
      'next-way',
      'references.nextWay',
      'Next Way',
      state.wayCount < 2 || state.activeWay >= state.wayCount - 1,
      state.wayCount < 2 ? oneWay : undefined
    ),
    { kind: 'separator', id: 'after-ways' },
    command(
      'previous-candidate',
      'references.previousCandidate',
      'Previous Candidate',
      !hasCandidates || state.activeCandidate <= 0,
      hasCandidates ? undefined : noTarget
    ),
    command(
      'next-candidate',
      'references.nextCandidate',
      'Next Candidate',
      !hasCandidates || state.activeCandidate >= state.candidateCount - 1,
      hasCandidates ? undefined : noTarget
    ),
    { kind: 'separator', id: 'after-candidates' },
    command(
      'recompute',
      'references.recompute',
      'Recompute References',
      !state.canRecompute,
      state.canRecompute ? undefined : noTarget
    ),
    { kind: 'separator', id: 'after-recompute' },
    command('reset-view', 'references.resetView', 'Reset References View', !state.hasView),
    command('zoom-in', 'references.zoomIn', 'Zoom In References', !state.hasView),
    command('zoom-out', 'references.zoomOut', 'Zoom Out References', !state.hasView),
  ];
}

/** The commands only, for a surface that renders no separators. */
export function referencesCommands(actions: readonly ReferencesAction[]): ReferencesCommand[] {
  return actions.filter((action): action is ReferencesCommand => action.kind === 'command');
}
