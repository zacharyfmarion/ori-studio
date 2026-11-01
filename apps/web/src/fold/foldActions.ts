/**
 * The verbs a Fold sequence offers, in the order every surface presents them:
 * the bottom bar and header, the canvas and step-card context menus, and the
 * menu bar's Fold menu.
 *
 * As `cp-workspace/folded/foldedFigureActions.ts` does for a folded figure,
 * this exists so the surfaces cannot drift: gating, labels, order and the
 * calls live here, and each surface owns only how it draws a descriptor.
 * React-free and store-free: it takes what the caller knows about the
 * sequence and bound callbacks, and returns plain data.
 *
 * A verb that adds a step — a fold, a turn, Import CP — adds it after the
 * step it acts on. Anywhere but the tip of the active path that starts a
 * branch (plan D6), and the descriptor says so in `note` rather than the verb
 * changing its name.
 */
import type { TFunction } from 'i18next';
import { sendToEditPrimary, type SendToEditSurfaceSource } from '../designKinds/sendToEditActions';
import type { TurnKind } from '../lib/steps/turn';
import { turnName } from '../lib/steps/turnWords';
import type { FoldPaperShapeKind } from './document/foldSequenceDocument';

/** The plain fold tools: valley, mountain, and fold-and-unfold precrease. */
export type FoldKind = 'valley' | 'mountain' | 'precrease';

/**
 * Where a state stands: replayed and foldable, still replaying, broken (its
 * inputs no longer resolve, plan D6), or locked behind an operation a newer
 * build wrote.
 */
export type FoldStateStatus = 'ready' | 'replaying' | 'broken' | 'locked';

/** Icon names, resolved to components by each surface (this module stays JSX-free). */
export type FoldActionIcon =
  | 'valley'
  | 'mountain'
  | 'precrease'
  | 'turn-over'
  | 'rotate'
  | 'unfold-to'
  | 'unfold-last'
  | 'repeat'
  | 'import-cp'
  | 'send-to-edit'
  | 'send-to-diagram'
  | 'export-fold'
  | 'export-steps'
  | 'delete';

export type FoldCommandId =
  | 'repeat'
  | 'turn-over'
  | 'rotate'
  | 'unfold-to'
  | 'unfold-last'
  | 'import-cp'
  | 'send-to-edit'
  | 'send-to-diagram'
  | 'send-path-to-diagram'
  | 'export-fold'
  | 'export-steps'
  | 'delete-step';

export interface FoldCommand {
  kind: 'command';
  id: FoldCommandId;
  label: string;
  icon: FoldActionIcon;
  disabled: boolean;
  /** Why it is disabled, when it is. */
  hint?: string;
  /** What else it does, said beside the label: a verb that will start a branch. */
  note?: string;
  danger?: boolean;
  run: () => void;
}

export interface FoldChoiceOption {
  id: FoldKind;
  label: string;
  icon: FoldActionIcon;
  /** The armed kind. */
  checked: boolean;
  run: () => void;
}

/**
 * The fold kind, one control: a segmented control on the bar, a radio group
 * in a menu. Each option carries its own `run`, so the renderers never see
 * the value type.
 */
export interface FoldChoice {
  kind: 'choice';
  id: 'fold-kind';
  label: string;
  disabled: boolean;
  hint?: string;
  options: FoldChoiceOption[];
}

export interface FoldSeparator {
  kind: 'separator';
  id: string;
}

export type FoldAction = FoldCommand | FoldChoice | FoldSeparator;

/** A step the verbs act on. */
export interface FoldActionStep {
  id: string;
  /** How many steps follow it, on every branch: what deleting it also deletes. */
  followers: number;
}

/** What the caller knows about the sequence where the verbs act. */
export interface FoldActionContext {
  /** The cursor, or the step card whose menu opened; null is the flat sheet. */
  step: FoldActionStep | null;
  /** The state at that step. The flat sheet is always ready. */
  state: FoldStateStatus;
  /** The active path's last state: what the sequence exports carry (plan D6). */
  path: FoldStateStatus;
  /** At the tip of the active path, where a new step continues it rather than branching. */
  atTip: boolean;
  /** Written by a newer build: the sequence opens read-only (plan D7). */
  readOnly: boolean;
  /** The plain fold the tools hold, checked in the kind's choice; null while another tool is in hand, or none. */
  foldKind: FoldKind | null;
  /** The sheet, and how many steps the sequence has, for Import CP (plan D16). */
  sheet: FoldPaperShapeKind;
  stepCount: number;
}

/** The calls the verbs make. Each mutating one is one undo entry, as the store records it. */
export interface FoldActionDeps {
  t: TFunction;
  setFoldKind: (kind: FoldKind) => void;
  /** Add a turn step after the context's step. */
  turn: (turn: TurnKind) => void;
  /** Take the Rotate tool in hand at the context's step: its window sets how far and which way. */
  rotate: () => void;
  /** Take Unfold to step in hand at the context's step, to the step before it when `last`. */
  unfold: (last: boolean) => void;
  /** Take Repeat in hand at the context's step. */
  repeat?: () => void;
  /** Delete a step and its subtree, locked ones included (plan D6). */
  deleteStep: (stepId: string) => void;
  /** Open Import CP's dialog. */
  importCp: () => void;
  sendToEdit: () => void;
  /**
   * Add the step in context — or every step from the first to it — to the
   * end of the Diagram, linked to it (plan D17).
   */
  sendToDiagram: (scope: 'step' | 'path') => void;
  /** Open the FOLD export. */
  exportFold: () => void;
  /** Open the paper export on the steps (`surface: 'fold'`, one page per step). */
  exportSteps: () => void;
}

const TURN_OVER: TurnKind = { kind: 'turn-over', axis: 'vertical' };

/**
 * What Send to Edit says it sends from a Fold sequence: the same verb,
 * label and button every design kind offers, with Fold's own tooltip (plan
 * D10). No variant: precreases always go as auxiliary lines
 * (`foldSendToEditPayload`).
 */
export function foldSendToEditSource(t: TFunction): SendToEditSurfaceSource {
  return {
    title: t(
      'panels:fold.actions.sendToEditTitle',
      'Send the active step’s crease pattern to the Edit canvas'
    ),
  };
}

/** The fold kinds' names, as the tool's control and the menu say them. */
export function foldKindLabel(t: TFunction, kind: FoldKind): string {
  switch (kind) {
    case 'valley':
      return t('panels:fold.words.valleyFold', 'Valley fold');
    case 'mountain':
      return t('panels:fold.words.mountainFold', 'Mountain fold');
    case 'precrease':
      return t('panels:fold.actions.precrease', 'Precrease');
  }
}

/**
 * What Delete says it takes, given how many steps fold from the step: the step
 * alone, or the step and its subtree, branches and all. Every surface that
 * offers the verb says it in these words — the menus through the catalog, a
 * card's corner through this.
 */
export function foldDeleteStepLabel(t: TFunction, followers: number): string {
  return followers > 0
    ? t('panels:fold.actions.deleteStepAndFollowing', 'Delete this step and what follows')
    : t('panels:fold.actions.deleteStep', 'Delete this step');
}

/** Why nothing can be added after the step, or null when something can. */
function addStepBlock(t: TFunction, context: FoldActionContext): string | null {
  if (context.readOnly) {
    return t('panels:fold.actions.readOnlyHint', 'Made with a newer Ori Studio: this sequence opens read-only.');
  }
  return stateBlock(t, context.state);
}

/** Why the selected state is unavailable, or null when it can be used. */
function stateBlock(t: TFunction, state: FoldStateStatus): string | null {
  switch (state) {
    case 'ready':
      return null;
    case 'replaying':
      return t('panels:fold.actions.replayingHint', 'Still folding the steps before this one.');
    case 'broken':
      return t('panels:fold.actions.brokenHint', 'This step no longer folds.');
    case 'locked':
      return t('panels:fold.actions.lockedHint', 'This step was made with a newer Ori Studio.');
  }
}

/**
 * Why the active path cannot be exported, or null when it can. A
 * sequence with no step has nothing to carry: the menu's capability refuses
 * it in the same words (`common:capability.foldNoSteps`), so a button here
 * never looks pressable while the chokepoint would turn it down.
 */
function pathBlock(t: TFunction, path: FoldStateStatus, stepCount: number): string | null {
  if (stepCount === 0) return t('common:capability.foldNoSteps', 'Fold a step first');
  switch (path) {
    case 'ready':
      return null;
    case 'replaying':
      return t('panels:fold.actions.pathReplayingHint', 'Still folding the steps.');
    case 'broken':
      return t('panels:fold.actions.pathBrokenHint', 'A step on this path no longer folds.');
    case 'locked':
      return t('panels:fold.actions.pathLockedHint', 'A step on this path was made with a newer Ori Studio.');
  }
}

/**
 * Why the step in context cannot be sent to the Diagram, or null when it can:
 * the flat sheet is no step, and a step is drawn from its landed state.
 */
function diagramBlock(t: TFunction, context: FoldActionContext): string | null {
  if (context.step === null) {
    return t('panels:fold.toDiagram.sheetHint', 'The flat sheet is where the steps start: fold a step to send it.');
  }
  return stateBlock(t, context.state);
}

/** Why Import CP cannot start here, or null when it can. */
function importBlock(t: TFunction, context: FoldActionContext): string | null {
  const blocked = addStepBlock(t, context);
  if (blocked) return blocked;
  // A crease pattern brings a square or rectangle sheet. An empty sequence
  // takes its shape; one already folding a polygon cannot (plan D16).
  if (context.sheet === 'polygon' && context.stepCount > 0) {
    return t('panels:fold.actions.importPolygonHint', 'Import CP needs a square or rectangle sheet.');
  }
  return null;
}

/**
 * The ordered verbs for the step in `context`. Frequency first and grouped by
 * intent, destructive last, as every catalog here orders them: what to fold →
 * turning the model → bringing a pattern in → taking the sequence out →
 * deleting.
 */
export function buildFoldActions(context: FoldActionContext, deps: FoldActionDeps): FoldAction[] {
  const { t } = deps;
  const addBlock = addStepBlock(t, context);
  const branchNote = context.atTip ? undefined : t('panels:fold.actions.startsBranch', 'Starts a new branch');
  const outBlock = pathBlock(t, context.path, context.stepCount);
  const sendBlock = context.stepCount === 0 ? outBlock : stateBlock(t, context.state);
  const importHint = importBlock(t, context);
  const sendToEdit = sendToEditPrimary(t, foldSendToEditSource(t));
  const toDiagram = diagramBlock(t, context);
  const step = context.step;

  const turnCommand = (id: 'turn-over', turn: TurnKind): FoldCommand => ({
    kind: 'command',
    id,
    label: turnName(turn, t),
    icon: id,
    disabled: addBlock !== null,
    hint: addBlock ?? undefined,
    note: branchNote,
    run: () => deps.turn(turn),
  });

  const outCommand = (
    id: 'send-to-edit' | 'export-fold' | 'export-steps',
    label: string,
    run: () => void,
    blocked: string | null = outBlock
  ): FoldCommand => ({
    kind: 'command',
    id,
    label,
    icon: id,
    disabled: blocked !== null,
    hint: blocked ?? undefined,
    run,
  });

  return [
    {
      kind: 'choice',
      id: 'fold-kind',
      label: t('panels:fold.actions.foldKind', 'Fold'),
      disabled: addBlock !== null,
      hint: addBlock ?? undefined,
      options: (['valley', 'mountain', 'precrease'] as const).map((kind) => ({
        id: kind,
        label: foldKindLabel(t, kind),
        icon: kind,
        checked: kind === context.foldKind,
        run: () => deps.setFoldKind(kind),
      })),
    },
    { kind: 'separator', id: 'after-fold-kind' },
    turnCommand('turn-over', TURN_OVER),
    // Rotate takes its tool in hand, which previews the turn its window sets; applied, it adds the step.
    {
      kind: 'command',
      id: 'rotate',
      label: t('panels:fold.actions.rotate', 'Rotate…'),
      icon: 'rotate',
      disabled: addBlock !== null,
      hint: addBlock ?? undefined,
      note: branchNote,
      run: deps.rotate,
    },
    // Unfold to step and Repeat take their tools in hand, which preview what their windows set.
    ...(['unfold-last', 'unfold-to'] as const).map((id): FoldCommand => ({
      kind: 'command', id, icon: 'unfold-to',
      label: id === 'unfold-last'
        ? t('panels:fold.return.last', 'Unfold last step')
        : t('panels:fold.return.open', 'Unfold to step…'),
      disabled: addBlock !== null || step === null,
      hint: addBlock ?? (step === null ? t('panels:fold.return.empty', 'Fold a step first.') : undefined),
      note: branchNote,
      run: () => deps.unfold(id === 'unfold-last'),
    })),
    { kind: 'command', id: 'repeat', icon: 'repeat', label: t('panels:fold.repeat.open', 'Repeat…'),
      disabled: addBlock !== null || step === null || !deps.repeat, hint: addBlock ?? undefined, note: branchNote, run: () => deps.repeat?.() },
    { kind: 'separator', id: 'after-turns' },
    {
      kind: 'command',
      id: 'import-cp',
      label: t('panels:fold.actions.importCp', 'Import CP…'),
      icon: 'import-cp',
      disabled: importHint !== null,
      hint: importHint ?? undefined,
      note: branchNote,
      run: deps.importCp,
    },
    { kind: 'separator', id: 'after-import' },
    outCommand('send-to-edit', sendToEdit.label, deps.sendToEdit, sendBlock),
    // The step in context and the steps to it: the Diagram links each, so it follows them (plan D17).
    {
      kind: 'command',
      id: 'send-to-diagram',
      label: t('panels:fold.toDiagram.sendStep', 'Send Step to Diagram'),
      icon: 'send-to-diagram',
      disabled: toDiagram !== null,
      hint: toDiagram ?? undefined,
      run: () => deps.sendToDiagram('step'),
    },
    {
      kind: 'command',
      id: 'send-path-to-diagram',
      label: t('panels:fold.toDiagram.sendPath', 'Send Steps to Diagram'),
      icon: 'send-to-diagram',
      disabled: toDiagram !== null,
      hint: toDiagram ?? undefined,
      run: () => deps.sendToDiagram('path'),
    },
    outCommand('export-fold', t('panels:fold.actions.exportFold', 'Export FOLD…'), deps.exportFold),
    outCommand('export-steps', t('panels:fold.actions.exportSteps', 'Export steps…'), deps.exportSteps),
    { kind: 'separator', id: 'before-delete' },
    {
      kind: 'command',
      id: 'delete-step',
      // Says what it takes with it: the subtree goes too, branches and all.
      label: foldDeleteStepLabel(t, step?.followers ?? 0),
      icon: 'delete',
      disabled: step === null || context.readOnly,
      hint:
        step === null
          ? t('panels:fold.actions.sheetHint', 'The flat sheet is where the steps start: there is no step to delete.')
          : context.readOnly
            ? t('panels:fold.actions.readOnlyHint', 'Made with a newer Ori Studio: this sequence opens read-only.')
            : undefined,
      danger: true,
      run: () => {
        if (step) deps.deleteStep(step.id);
      },
    },
  ];
}

/** The command with `id`, for a surface that places one verb on its own. */
export function foldCommand(actions: readonly FoldAction[], id: FoldCommandId): FoldCommand | undefined {
  return actions.find((action): action is FoldCommand => action.kind === 'command' && action.id === id);
}
