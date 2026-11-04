/**
 * The Diagram's ‹ › within a constrained step's layer constraints
 * (`implementation-plans/layer-order-dialog.md`, row H9, decision D9): the
 * one cursor the Diagram keeps through the solutions that fit a step's
 * record, on the host engine. The Diagram's binding of the hosts' shared
 * table (`layer-order/host/solutionCursorTable.ts`), as Edit's figures have
 * theirs (`cp-workspace/folded/foldedSolutionCursor.ts`): made on the first
 * press, one at a time, kept only while it is being used, let go once out of
 * step.
 *
 * - **What a step holds that the cursor shows:** its record as saved, while
 *   it is shown folded flat, in the diagram it was made in, folded from the
 *   creases the press folded as they were (their geometry and kind, not a
 *   custom colour: `creaseLinesFingerprint`). So the cursor goes, with its
 *   worker, when the step's record changes (an Apply, an undo or a redo of a
 *   step, a Relink), when it is shown another way (Show as), when it is
 *   deleted, or when the diagram closes or another opens
 *   ({@link settleStepSolutionCursor}, which the store calls on every change
 *   to the diagram, the selection or the pattern); and when its creases
 *   changed, as the next press finds them (a custom colour is no change).
 *   A capture of the step
 *   from outside Pose — Refresh, Refresh All, Show as from a card, a Relink —
 *   lets it go as it begins ({@link dropStepSolutionCursor}, from the store's
 *   capture), since it restores the record afresh; and so does Pose letting
 *   the step go.
 * - **While it is in hand:** selecting another step, leaving the Diagram for
 *   another workspace, opening the Layer order dialog, or a minute with no
 *   press closes it too (the shared table's rules). A minute with no press
 *   lets go of the worker only: where the step's order lies is kept for the
 *   readout, on the same terms as the cursor was.
 * - **Where it ends:** a way a step proved to end (E9) is kept with the
 *   place, and that way's verb waits there, whatever the count says.
 * - **What it steps by:** the distinct pictures of the side the step shows.
 *   The Diagram has no X-ray (D5's other way).
 * - **The step's paper frame** is kept with the cursor, from the fold it was
 *   opened on: a step's record keeps its points about the centre of its
 *   paper's box (`captureLayerOrder.ts`), and every order the cursor steps to
 *   is saved through it.
 *
 * Store-free: the store and Pose hand it the steps, the diagram's load, the
 * selection and the pattern.
 */
import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { LayerStepBy } from '../../layer-order/engine/layerOrderEngine';
import {
  createSolutionCursorTable,
  type SolutionCursorOpening,
  type SolutionPlace,
  type SolutionTurn,
} from '../../layer-order/host/solutionCursorTable';
import { creaseLinesFingerprint } from '../../lib/creaseFingerprint';
import type { PaperFrame } from '../../lib/layerOrder/paperFrame';
import { onWorkspaceSwitch } from '../../store/layoutStore';
import { stepById, type DiagramCpSource, type DiagramDocument } from '../document/diagramDocument';

/** A linked step, as its pager steps it. */
export interface StepSolutionTarget {
  readonly stepId: string;
  readonly source: DiagramCpSource;
}

/**
 * What else a step's cursor is checked against: the diagram's load, the
 * pattern its creases are in, and — as a press begins — the fold lines that
 * press chose (the kernel's ids), which the cursor's are compared with.
 */
export interface StepSolutionWorld {
  readonly loadId: number;
  readonly document: OristudioCpDocumentSnapshot | null;
  readonly lineIds?: readonly number[];
}

/** What a press opens a step's cursor with: the fold's source and the record, and the step's paper frame. */
export interface StepSolutionOpening extends SolutionCursorOpening {
  readonly frame: PaperFrame;
}

/** What the Diagram keeps of a step for its cursor. */
export interface StepSolutionMark {
  readonly loadId: number;
  /** The pattern when the cursor was made, and the lines its press folded, by the kernel's ids then. */
  readonly document: OristudioCpDocumentSnapshot | null;
  readonly lineIds: readonly number[];
  /** Those lines' geometry and kind (`creaseLinesFingerprint`): what an edit must change to let the cursor go. */
  readonly creases: string | null;
  /** The step's record as saved, whose order the cursor's session shows. */
  readonly json: string;
  /** The step's paper frame, which every order it steps to is saved through. */
  readonly frame: PaperFrame;
}

/** What a step's pager steps through: the distinct pictures of the side it shows. */
export function stepSolutionStepBy(source: DiagramCpSource): LayerStepBy {
  return { picture: source.render.mode === 'folded-flat' || source.render.mode === 'folded-3d' ? source.render.side : 'front' };
}

/**
 * Whether the creases the cursor's press folded are as they were, as a press
 * finds them (`world.lineIds`, the lines it chose): the same pattern, or the
 * same lines' geometry and kind, whatever their ids now. Asked as a press
 * begins, which has chosen its creases; between presses an edit to the
 * pattern is Edit's, and leaving the Diagram for it lets the cursor go.
 */
function creasesHeld(mark: StepSolutionMark, world: StepSolutionWorld): boolean {
  if (world.lineIds === undefined || world.document === mark.document) return true;
  if (!world.document || mark.creases === null) return false;
  return creaseLinesFingerprint(world.document, world.lineIds) === mark.creases;
}

const table = createSolutionCursorTable<StepSolutionTarget, StepSolutionWorld, StepSolutionMark, StepSolutionOpening>({
  idOf: (target) => target.stepId,
  markOf: (target, world, opened) => {
    const lineIds = world.lineIds ?? [];
    return {
      loadId: world.loadId,
      document: world.document,
      lineIds,
      creases: world.document ? creaseLinesFingerprint(world.document, lineIds) : null,
      json: target.source.layerOrder ?? '',
      frame: opened.frame,
    };
  },
  inStep: (mark, target) => target.source.render.mode === 'folded-flat' && target.source.layerOrder === mark.json,
  heldIn: (mark, _target, world) => world.loadId === mark.loadId && creasesHeld(mark, world),
  stepBy: (target) => stepSolutionStepBy(target.source),
  // The Diagram's to keep only while the Diagram is on screen.
  whileKept: onWorkspaceSwitch,
});

/** The steps of `diagram` as the table looks them up: linked ones, by id. */
function lookup(diagram: DiagramDocument | null) {
  return (stepId: string): StepSolutionTarget | undefined => {
    const step = diagram ? stepById(diagram, stepId) : null;
    return step && !step.unknown && step.source?.kind === 'cp' ? { stepId, source: step.source } : undefined;
  };
}

/** The store as the cursor reads it. */
export interface StepSolutionState {
  readonly diagram: DiagramDocument | null;
  readonly diagramLoadId: number;
  readonly diagramSelectedStepId: string | null;
  readonly oristudioCpDocument: { readonly document: OristudioCpDocumentSnapshot } | null;
}

function worldOf(state: StepSolutionState): StepSolutionWorld {
  return { loadId: state.diagramLoadId, document: state.oristudioCpDocument?.document ?? null };
}

/**
 * Where the order step `stepId` shows lies among the solutions that fit its
 * record, by the side it shows now, with a way a step proved to end: known
 * once a cursor in step with it has answered for that side, and still after
 * the cursor rested, while the step holds what it did. Null before the first
 * press, after an undo, once it turned over until asked again. Reads the
 * table only, so any render may ask.
 */
export function stepSolutionPlace(stepId: string, source: DiagramCpSource): SolutionPlace | null {
  return table.place({ stepId, source });
}

/**
 * Keep the cursor in step with the diagram, the selection and the pattern as
 * they are now: closed when its step holds another record, is shown another
 * way, has gone, is no longer the one selected, or the diagram or its
 * creases changed; asked where it stands again once the step turned over.
 * Nothing while a press runs. The store calls this on every change to any of
 * them.
 */
export function settleStepSolutionCursor(state: StepSolutionState): void {
  table.settle(lookup(state.diagram), worldOf(state), state.diagramSelectedStepId);
}

/** One press on a step, from its start to its end (`SolutionTurn`). */
export interface StepSolutionTurn {
  step: SolutionTurn<StepSolutionTarget, StepSolutionWorld, StepSolutionMark, StepSolutionOpening>['step'];
  /** The step's paper frame, kept with its cursor; null before one is made. */
  frame(): PaperFrame | null;
  /** The step's order is the step's now, saved as `json`: called as the commit lands. */
  landed(json: string): void;
  /**
   * The press is over, and the store is as it left it: a step that moved and
   * never landed takes the cursor with it, and anything that changed
   * meanwhile — another step selected included — is settled now.
   */
  end(state: StepSolutionState): void;
}

/**
 * A press of › or ‹ on step `stepId`, a constrained flat step, with the
 * diagram's load, the pattern and the fold lines the press chose as they
 * stand. A cursor out of step with it — its record, or its creases, changed
 * since — goes first; one in step is kept, and steps on from where it is.
 */
export function beginStepSolutionStep(stepId: string, source: DiagramCpSource, world: StepSolutionWorld): StepSolutionTurn {
  const turn = table.begin({ stepId, source }, world);
  return {
    step: (ask) => turn.step(ask),
    frame: () => turn.mark()?.frame ?? null,
    landed: (json) => turn.landed((mark) => ({ ...mark, json })),
    end: (state) => turn.end(lookup(state.diagram), worldOf(state), state.diagramSelectedStepId),
  };
}

/** Close the cursor, with its worker — only step `stepId`'s, when given. Idempotent. */
export function dropStepSolutionCursor(stepId?: string): void {
  table.drop(stepId);
}

/** For `useSyncExternalStore`: called whenever what {@link stepSolutionPlace} answers may have changed. */
export function subscribeStepSolutionCursor(listener: () => void): () => void {
  return table.subscribe(listener);
}

/** For `useSyncExternalStore`: moves whenever the table does. */
export function stepSolutionCursorVersion(): number {
  return table.version();
}

/** Which step a cursor is kept for: for tests and diagnostics. */
export function stepSolutionCursorStep(): string | null {
  return table.heldId();
}
