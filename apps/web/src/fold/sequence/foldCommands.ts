/**
 * The Fold sequence's verbs (`fold/foldActions`' catalog) as the app's
 * commands: what the menu bar, the step cards' context menus, the header and
 * the keys run, through `handleMenuAction` so the chokepoint counts each.
 *
 * - **Ids are the catalog's**, under `fold.`: a command's own id
 *   (`fold.turn-over`, `fold.delete-step`, …) and each fold kind's
 *   (`fold.valley`, …). The import, Send to Edit and export verbs are
 *   dispatched by the same rule, through fold/io's bindings
 *   (`FOLD_IO_ACTION_DEPS`); their handlers live with Import CP and the
 *   exports.
 * - **Gating is the catalog's.** A command runs only while the catalog offers
 *   it enabled, built from the session and the store as they are when it
 *   runs, so the menu bar, a context menu and a key cannot disagree with the
 *   header about what is possible.
 * - **The fold kind belongs to the tools.** The kind armed lives with the tool
 *   in hand; the canvas hands it over with {@link registerFoldKindControl},
 *   and until it does the kind is not offered.
 */
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { trackFoldStepAdded } from '../../analytics/trackFold';
import { foldSession } from '../../store/workspaceStore/foldSession';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { TurnKind } from '../../lib/steps/turn';
import type { FoldOp, FoldSequenceDocument } from '../document/foldSequenceDocument';
import {
  buildFoldActions,
  type FoldAction,
  type FoldActionContext,
  type FoldChoice,
  type FoldCommand,
  type FoldCommandId,
  type FoldKind,
  type FoldStateStatus,
} from '../foldActions';
import { FOLD_IO_ACTION_DEPS } from '../io/foldIoActions';
import { FOLD_BLANK_SEQUENCE, FOLD_PENDING_NODE, type FoldSessionSnapshot } from '../session/foldSessionState';
import { foldTools } from '../tools/foldToolState';
import { rotationBucket } from '../tools/rotate/rotateTool';
import { cursorIndex, foldPathEntries, followerCount, type FoldEntryStatus, type FoldPathEntry } from './foldSequencePath';

/**
 * A catalog command, or one of the fold kinds: what `menuActions`' table maps
 * this module's command ids to (`fold.turn-over` → `turn-over`). The table is
 * there, beside every other, so this module — which dispatches through
 * `handleMenuAction` — is never needed while that one initialises.
 */
export type FoldMenuVerb = { kind: 'command'; id: FoldCommandId } | { kind: 'fold-kind'; id: FoldKind };

/** The command id a catalog command is dispatched under. */
export function foldCommandActionId(id: FoldCommandId): string {
  return `fold.${id}`;
}

/** The fold kind the tools have armed — none while another tool is in hand — and the way to arm another. */
export interface FoldKindControl {
  kind(): FoldKind | null;
  arm(kind: FoldKind): void;
}

let kindControl: FoldKindControl | null = null;

/** Hand the commands the tools' fold kind; returns the release, for the tools' unmount. */
export function registerFoldKindControl(control: FoldKindControl): () => void {
  kindControl = control;
  return () => {
    if (kindControl === control) kindControl = null;
  };
}

/** A path entry's standing as the catalog gates on it. */
export function actionStatus(status: FoldEntryStatus): FoldStateStatus {
  switch (status) {
    case 'ok':
    case 'changed':
      return 'ready';
    case 'pending':
      return 'replaying';
    case 'broken':
    case 'brokenAbove':
      return 'broken';
    case 'locked':
      return 'locked';
  }
}

/** What the catalog needs to know about the sequence, at the entry `at` (the cursor's, by default). */
export function foldActionContext(
  document: FoldSequenceDocument,
  entries: readonly FoldPathEntry[],
  at: number,
  readOnly: boolean,
  foldKind: FoldKind | null
): FoldActionContext {
  const here = entries[at];
  const tip = entries[entries.length - 1];
  return {
    step: here?.id ? { id: here.id, followers: followerCount(document, here.id) } : null,
    state: actionStatus(here?.status ?? 'pending'),
    path: actionStatus(tip?.status ?? 'pending'),
    atTip: at === entries.length - 1,
    readOnly,
    foldKind,
    sheet: document.paper.shape.kind,
    stepCount: document.steps.length,
  };
}

/** A turn as the step that makes it. */
export function turnOp(turn: TurnKind): FoldOp {
  return turn.kind === 'turn-over' ? { kind: 'turn', axis: turn.axis } : { kind: 'rotate', rotate: turn.rotate };
}

/**
 * The sequence on screen and its path, as the session holds them now: what a
 * verb or a key acts on. The session follows the store as it changes, so this
 * is never a change behind it.
 */
export function currentFoldPath(
  snapshot: FoldSessionSnapshot = foldSession().store.getState()
): { document: FoldSequenceDocument; entries: FoldPathEntry[]; cursor: number } {
  const document = snapshot.sequence ?? FOLD_BLANK_SEQUENCE;
  const entries = foldPathEntries(document, snapshot.activePath, snapshot.sheet, snapshot.nodes, FOLD_PENDING_NODE);
  return { document, entries, cursor: cursorIndex(entries, snapshot.cursor) };
}

/**
 * The catalog for the step on screen — or for `stepId`, a card's — as the
 * session and the store hold them now, with every call bound.
 */
export function currentFoldActions(t: TFunction, stepId?: string | null): FoldAction[] {
  const snapshot = foldSession().store.getState();
  const { document, entries, cursor } = currentFoldPath(snapshot);
  return foldActionsAt(t, document, entries, stepId === undefined ? cursor : cursorIndex(entries, stepId), snapshot.readOnly);
}

/** The catalog at the path entry `at`, with every call bound: what a surface holding the path renders. */
export function foldActionsAt(
  t: TFunction,
  document: FoldSequenceDocument,
  entries: readonly FoldPathEntry[],
  at: number,
  readOnly: boolean
): FoldAction[] {
  const session = foldSession();
  const control = kindControl;
  const context = foldActionContext(document, entries, at, readOnly, control ? control.kind() : null);
  // A turn at a step that is not the one on screen folds from it: put the reader there first.
  const fromHere = () => {
    const id = entries[at]?.id ?? null;
    if (id !== session.store.getState().cursor) useWorkspaceStore.getState().moveFoldCursor(id);
  };
  return buildFoldActions(context, {
    t,
    setFoldKind: (kind) => control?.arm(kind),
    turn: (turn) => {
      fromHere();
      const op = turnOp(turn);
      // Counted as the step it adds, as the rail's and T's turn is: `command invoked` counted only the press.
      void session.commitStep(op).then((outcome) => {
        if (outcome.status !== 'committed') return;
        if (op.kind === 'rotate') trackFoldStepAdded('rotate', { amount: rotationBucket(op.rotate) });
        else trackFoldStepAdded('turn');
      });
    },
    // Rotate is a tool: taken in hand on the canvas, at the step it is asked for there.
    rotate: () => {
      fromHere();
      foldTools().selectTool('rotate');
    },
    // Unfold to step and Repeat are tools too, taken in hand where they are asked for. Unfold last
    // step is Unfold to step at the step before this one: the target the tool takes by default.
    repeat: () => {
      fromHere();
      foldTools().selectTool('repeat');
    },
    unfold: (last) => {
      fromHere();
      foldTools().selectTool('unfold-to');
      // Taken up again while in hand, the tool keeps its target: the last step is asked for by name.
      if (last) foldTools().setUnfoldTarget(entries[at - 1]?.id ?? null);
    },
    deleteStep: (id) => {
      useWorkspaceStore.getState().deleteFoldStep(id);
    },
    // Import CP, Send to Edit and the exports: fold/io's bindings, each its menu row through the chokepoint.
    ...FOLD_IO_ACTION_DEPS,
  }).map((action) =>
    // No tools, no kind to arm: said, rather than offering rows that do nothing.
    action.kind === 'choice' && !control
      ? {
          ...action,
          disabled: true,
          hint: t('panels:fold.sequence.noTools', 'Take a fold tool on the canvas to choose its kind.'),
        }
      : action
  );
}

/**
 * Rebuild a saved Unfold to step or Repeat step in place (the Step pane's
 * Rebuild unfold, and Update from source steps): its tool taken in hand at
 * the step's parent, set as the step was made — its target, or its range and
 * axis — so the preview is reviewed before it replaces the step. Escape, or
 * the commit, brings the reader back to the step.
 */
export function rebuildFoldStep(stepId: string): void {
  const node = foldSession().store.getState().sequence?.steps.find((step) => step.id === stepId);
  const op = node?.op;
  if (!node || !op || (op.kind !== 'unfold-to' && op.kind !== 'repeat')) return;
  useWorkspaceStore.getState().moveFoldCursor(node.parent);
  if (foldSession().store.getState().cursor !== node.parent) return;
  foldTools().rebuildStep(
    op.kind === 'unfold-to'
      ? { tool: 'unfold-to', id: node.id, parent: node.parent, expected: op }
      : { tool: 'repeat', id: node.id, parent: node.parent, expected: op }
  );
}

/**
 * Run one of this module's verbs, as the catalog offers it now. Whether it ran.
 *
 * The menu bar's row and a key are enabled by the store's coarser gate (the
 * capability knows nothing of a step still folding, a broken one, or the
 * tools being off screen), so the catalog can turn one down after it was
 * pressed. It says why, in the words the step card's menu shows beside the
 * same row, rather than doing nothing.
 */
export function runFoldMenuVerb(t: TFunction, verb: FoldMenuVerb, refused: (why: string) => void = toast.info): boolean {
  const actions = currentFoldActions(t);
  if (verb.kind === 'fold-kind') {
    const choice = actions.find((action): action is FoldChoice => action.kind === 'choice');
    if (choice?.disabled) {
      if (choice.hint) refused(choice.hint);
      return false;
    }
    const option = choice?.options.find((each) => each.id === verb.id);
    if (!option) return false;
    option.run();
    return true;
  }
  const command = actions.find((action): action is FoldCommand => action.kind === 'command' && action.id === verb.id);
  if (!command) return false;
  if (command.disabled) {
    if (command.hint) refused(command.hint);
    return false;
  }
  command.run();
  return true;
}
