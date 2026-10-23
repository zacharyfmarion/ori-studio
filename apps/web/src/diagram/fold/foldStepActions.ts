/**
 * The verbs of a Diagram step linked to a Fold step (plan D17), bound to the
 * store: Refresh, Show as, its pose — turned, turned over, to an angle, its
 * layers spread (Phase 13) — its crease pattern's paper side, and the way
 * back to its step in Fold. Each capture goes through the store's
 * `captureDiagramFoldStep`, one undo step, and says what the user needs told;
 * a pose that changed the picture is counted as a linked pattern's is
 * (`trackPose`). A pose is not an upstream edit: the link's status is
 * unchanged by one.
 *
 * Store-bound, React-free.
 */
import { toast } from 'sonner';
import { trackDiagramSourceOpened } from '../../analytics';
import type { LayerSpreadOptions, SpreadKind } from '../../cp-workspace/folded/foldedLayerSpread';
import {
  DEFAULT_SPREAD_STARTS,
  withSpreadField,
  type LayerSpreadEdit,
  type LayerSpreadStarts,
} from '../../cp-workspace/folded/layerSpreadSettings';
import { foldStateSpread } from '../../fold/document/foldStepSpread';
import { foldStepTree } from '../../fold/document/foldStepTree';
import i18n from '../../i18n';
import { humanizeError } from '../../lib/toastMessages';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramFoldCaptureOutcome } from '../../store/workspaceStore/diagramFoldCapture';
import { turnedOverFrom, type LinkedPoseRequest } from '../capture/linkedPose';
import { trackPose } from '../capture/poseController';
import {
  creasePatternSide,
  isLockedStep,
  lastFoldStepOf,
  renderToShowAs,
  showAsOf,
  spreadStartsFor,
  stepById,
  withCreasePatternSide,
  withCreasesFlipped,
  type DiagramCpRender,
  type DiagramFoldStepSource,
  type DiagramShowAs,
} from '../document/diagramDocument';
import { replacedEdited, undoNewest } from '../references/cardMarksToast';
import { linkedFoldSequence } from './foldStepLink';

/** The Fold step a step is linked to, while it is one this build may change; null otherwise. */
function foldSourceOf(stepId: string): DiagramFoldStepSource | null {
  const { diagram, diagramReadOnly } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  if (!step || isLockedStep(step) || diagramReadOnly || step.source?.kind !== 'fold-step') return null;
  return step.source;
}

/** Capture the step again from its Fold step in `render`, and say what came of it. Whether it was captured. */
async function captureAs(
  stepId: string,
  source: DiagramFoldStepSource,
  render: DiagramCpRender,
  label: string,
  joinEntry?: object
): Promise<DiagramFoldCaptureOutcome> {
  const { sequence, step, through, moment } = source;
  const outcome = await useWorkspaceStore.getState().captureDiagramFoldStep(stepId, {
    sequence,
    step,
    // A run of steps drawn as one is captured again as one.
    ...(through !== undefined ? { through } : {}),
    moment,
    render,
    label,
    ...(joinEntry ? { joinEntry } : {}),
  });
  sayFoldCaptureOutcome(outcome);
  return outcome;
}

/**
 * Capture a Fold step's picture again from its step as it is now, in its
 * pose — after the sequence changed upstream, or to anchor its faces.
 * `joinEntry` folds it into Refresh all's one undo entry.
 */
export function refreshDiagramFoldStep(
  stepId: string,
  { label = 'Refresh picture', joinEntry }: { label?: string; joinEntry?: object } = {}
): Promise<DiagramFoldCaptureOutcome> | null {
  const source = foldSourceOf(stepId);
  return source ? captureAs(stepId, source, source.render, label, joinEntry) : null;
}

/**
 * The spread Fold shows the state a step's picture is of, as it is now
 * (`foldStateSpread`); undefined when Fold shows it unspread, or the
 * sequence is gone.
 */
function foldSpreadOf(source: DiagramFoldStepSource): LayerSpreadOptions | undefined {
  const document = linkedFoldSequence({ sequence: source.sequence }, useWorkspaceStore.getState().foldSequences);
  return (document && foldStateSpread(document, source.step, source.moment)) ?? undefined;
}

/** Show a Fold step's step another way (D19): its crease pattern, or folded, in the pose that way last had. */
export async function showFoldStepAs(stepId: string, way: DiagramShowAs): Promise<boolean> {
  const source = foldSourceOf(stepId);
  if (!source || way === 'simulated') return false;
  if (showAsOf(source.render) === way) return true;
  // A Fold step's fold starts as Fold shows it: spread as Fold spreads it, its layer order the sequence's.
  const outcome = await captureAs(stepId, source, renderToShowAs(source, way, foldSpreadOf(source)), showAsLabel(way));
  return outcome.status === 'captured';
}

/**
 * A copy of a Fold step's step after it, shown the other way (D19): its
 * crease pattern, then its folded form, in two presses. One undo step: the
 * capture folds into the duplicate's, and a capture that does not land takes
 * the copy with it. The copy's id, or null.
 */
export async function duplicateFoldStepAs(stepId: string, way: DiagramShowAs): Promise<string | null> {
  const source = foldSourceOf(stepId);
  if (!source || way === 'simulated') return null;
  const copyId = useWorkspaceStore.getState().duplicateDiagramStep(stepId);
  if (copyId === null || showAsOf(source.render) === way) return copyId;
  const duplicated = useWorkspaceStore.getState().diagramHistory.past.at(-1);
  const outcome = await captureAs(copyId, source, renderToShowAs(source, way, foldSpreadOf(source)), 'Duplicate step', duplicated);
  if (outcome.status !== 'captured') {
    const now = useWorkspaceStore.getState();
    if (duplicated !== undefined && now.diagramHistory.past.at(-1) === duplicated) now.undoDiagram();
    return null;
  }
  return copyId;
}

function showAsLabel(way: DiagramShowAs): string {
  return way === 'crease-pattern' ? 'Show as Crease Pattern' : 'Show as Folded';
}

/** The pose verbs a Fold step takes: the picture turned a quarter, turned over, or back as it was linked. */
export type FoldStepPoseVerb = 'rotate-left' | 'rotate-right' | 'turn-over' | 'reset';

/**
 * A render posed by `verb`: a quarter turn either way; a flat fold turned
 * over — its front at the opposite turn, mirrored (Turn Over, 12d) — or a
 * crease pattern's paper on its other side's colour; and reset upright, a
 * flat fold from the front. A crease pattern keeps the colour of the side its
 * paper is on, as a linked pattern's does: that is the Step pane's Front | Back.
 */
export function posedFoldRender(render: DiagramCpRender, verb: FoldStepPoseVerb): DiagramCpRender {
  const quarter = (degrees: number) => (((degrees + (verb === 'rotate-left' ? -90 : 90)) % 360) + 360) % 360;
  switch (render.mode) {
    case 'crease-pattern':
      if (verb === 'reset') return { ...render, rotationDeg: 0 };
      if (verb === 'turn-over') {
        return turnedOverFrom(render, withCreasePatternSide(render, creasePatternSide(render) === 'back' ? 'front' : 'back'));
      }
      return { ...render, rotationDeg: quarter(render.rotationDeg) };
    case 'folded-flat':
      if (verb === 'reset') {
        const { spread } = render;
        return { mode: 'folded-flat', side: 'front', rotationDeg: 0, foldCase: 1, ...(spread ? { spread } : {}) };
      }
      if (verb === 'turn-over') {
        return { ...render, side: render.side === 'back' ? 'front' : 'back', rotationDeg: (360 - render.rotationDeg) % 360 };
      }
      return { ...render, rotationDeg: quarter(render.rotationDeg) };
    default:
      return render;
  }
}

/** A crease pattern or a flat fold turned to an angle, in degrees clockwise (D5's angle field); any other as it is. */
export function rotatedFoldRender(render: DiagramCpRender, degrees: number): DiagramCpRender {
  if (render.mode !== 'crease-pattern' && render.mode !== 'folded-flat') return render;
  return { ...render, rotationDeg: ((degrees % 360) + 360) % 360 };
}

/**
 * A flat fold's spread changed (Phase 13, on a Fold step): Spread Layers on
 * or off, a kind, or one of its values. On — and a kind — start from the
 * diagram's own rule (`spreadStartsFor`): the nearest earlier step's spread,
 * else the default, as a linked pattern's do. A value is a no-op on a fold
 * with none, or of the other kind; a crease pattern has no layers to spread.
 */
export type FoldStepSpreadRequest = { verb: 'spread-layers' } | { verb: 'spread-kind'; kind: SpreadKind } | LayerSpreadEdit;

export function spreadFoldRender(
  render: DiagramCpRender,
  request: FoldStepSpreadRequest,
  starts: LayerSpreadStarts = DEFAULT_SPREAD_STARTS
): DiagramCpRender {
  if (render.mode !== 'folded-flat') return render;
  const { spread, ...unspread } = render;
  switch (request.verb) {
    case 'spread-layers':
      return spread ? unspread : { ...unspread, spread: starts.any };
    case 'spread-kind':
      return !spread || spread.kind === request.kind ? render : { ...render, spread: starts[request.kind] };
    default:
      return spread ? { ...render, spread: withSpreadField(spread, request) } : render;
  }
}

/**
 * Capture a Fold step again in `render`, as one undo step labelled as a pose,
 * and count it as `verb` when it changed the picture. Whether it now shows
 * that pose.
 */
async function poseAs(
  stepId: string,
  source: DiagramFoldStepSource,
  render: DiagramCpRender,
  verb: LinkedPoseRequest['verb']
): Promise<boolean> {
  if (JSON.stringify(render) === JSON.stringify(source.render)) return true;
  const outcome = await captureAs(stepId, source, render, 'Adjust pose');
  if (outcome.status === 'captured' && outcome.changed) trackPose(verb, outcome.render);
  return outcome.status === 'captured';
}

/** Pose a Fold step's picture by `verb`, as one undo step. Whether it now shows that pose. */
export async function poseDiagramFoldStep(stepId: string, verb: FoldStepPoseVerb): Promise<boolean> {
  const source = foldSourceOf(stepId);
  return source ? poseAs(stepId, source, posedFoldRender(source.render, verb), verb) : false;
}

/** Turn a Fold step's crease pattern or flat fold to an angle, in degrees clockwise, as one undo step. */
export async function rotateDiagramFoldStepTo(stepId: string, degrees: number): Promise<boolean> {
  const source = foldSourceOf(stepId);
  return source ? poseAs(stepId, source, rotatedFoldRender(source.render, degrees), 'rotate-to') : false;
}

/** Spread a Fold step's flat fold, or change its spread (`spreadFoldRender`), as one undo step. */
export async function spreadDiagramFoldStep(stepId: string, request: FoldStepSpreadRequest): Promise<boolean> {
  const source = foldSourceOf(stepId);
  if (!source) return false;
  const { diagram } = useWorkspaceStore.getState();
  const starts = diagram ? spreadStartsFor(diagram, stepId) : DEFAULT_SPREAD_STARTS;
  return poseAs(stepId, source, spreadFoldRender(source.render, request, starts), request.verb);
}

/**
 * A Fold step shown as its crease pattern, drawn on the colour of `side`: its
 * paper, nothing else — but for Flip creases, which draws only on the back,
 * so a side change turns a flipped paper over or back, its turn with it, as a
 * linked pattern's does (`turnedOverFrom`).
 */
export async function showFoldStepPaperSide(stepId: string, side: 'front' | 'back'): Promise<boolean> {
  const source = foldSourceOf(stepId);
  if (!source || source.render.mode !== 'crease-pattern') return false;
  if (creasePatternSide(source.render) === side) return true;
  return poseAs(stepId, source, turnedOverFrom(source.render, withCreasePatternSide(source.render, side)), 'paper-side');
}

/**
 * Turn Flip creases on or off for a Fold step shown as its crease pattern on
 * its back, as a linked pattern's is (`flipCreasePatternCreases`): the paper
 * turned over side to side, its turn run the other way (`turnedOverFrom`),
 * captured again from its state as one undo step; nothing on its front,
 * where it draws nothing. Whether it is on or off as asked now.
 */
export async function flipFoldStepCreases(stepId: string, on: boolean): Promise<boolean> {
  const source = foldSourceOf(stepId);
  if (!source || source.render.mode !== 'crease-pattern' || creasePatternSide(source.render) !== 'back') return false;
  return poseAs(stepId, source, turnedOverFrom(source.render, withCreasesFlipped(source.render, on)), 'flip-creases');
}

/**
 * Open a step's Fold step in Fold: the sequence's cursor on it — the active
 * path through it — and Fold on screen; for a run of steps drawn as one, its
 * last, the state the instruction leaves. Says why not when the sequence is
 * not the one Fold shows, or the step is gone.
 */
export function openDiagramStepInFold(stepId: string): void {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (!step || isLockedStep(step) || step.source?.kind !== 'fold-step') return;
  const { sequence } = step.source;
  const foldStepId = lastFoldStepOf(step.source);
  const t = i18n.t.bind(i18n);
  const document = linkedFoldSequence({ sequence }, store.foldSequences);
  // One sequence is shown (plan D7): the first.
  if (!document || store.foldSequences[0]?.document.id !== sequence) {
    toast.error(t('toasts:diagram.fold.sequenceGone', 'That Fold sequence isn’t in this project any more.'));
    return;
  }
  if (!foldStepTree(document.steps).byId.has(foldStepId)) {
    toast.error(t('toasts:diagram.fold.stepGone', 'That step isn’t in the Fold sequence any more.'));
    return;
  }
  store.moveFoldCursor(foldStepId);
  useLayoutStore.getState().activateWorkspace('fold');
  trackDiagramSourceOpened('fold');
}

/**
 * Tell the user what a Fold step's capture came to, when there is something
 * to tell: a picture kept as a bitmap, marks the author had edited that the
 * fold's own replaced (with Undo), or a capture that could not be made and
 * why. One the user moved on from says nothing.
 */
export function sayFoldCaptureOutcome(outcome: DiagramFoldCaptureOutcome): void {
  const t = i18n.t.bind(i18n);
  switch (outcome.status) {
    case 'captured':
      if (outcome.replaced > 0) toast.message(replacedEdited(outcome.replaced), { action: undoNewest() });
      else if (outcome.tooDetailed) {
        toast.message(
          t('toasts:diagram.capture.tooDetailed', 'Too detailed to keep as a drawing, so the step keeps it as an image.')
        );
      }
      return;
    case 'missing':
      toast.error(t('toasts:diagram.fold.missing', 'That step isn’t in the Fold sequence any more, or no longer folds.'));
      return;
    case 'unknown':
      toast.error(
        outcome.why === 'not-shown'
          ? t('toasts:diagram.fold.notShown', 'Fold shows another sequence, so this step can’t be captured now.')
          : outcome.why === 'locked'
            ? t('toasts:diagram.fold.locked', 'That step was made with a newer Ori Studio.')
            : t('toasts:foldIo.unavailable', 'The fold engine stopped before it finished. Try again.')
      );
      return;
    case 'failed':
      toast.error(t('toasts:diagram.capture.failed', 'The picture couldn’t be captured'), {
        description: humanizeError(outcome, t),
      });
      return;
    case 'read-only':
      toast.error(
        t('toasts:diagram.capture.readOnly', 'This diagram was made with a newer Ori Studio and opens read-only.')
      );
      return;
    case 'discarded':
    case 'busy':
      return;
  }
}
