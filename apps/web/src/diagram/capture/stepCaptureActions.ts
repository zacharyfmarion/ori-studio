import { toast } from 'sonner';
import {
  trackDiagramPictureCaptured,
  trackDiagramSourceOpened,
  trackDiagramStepShownAs,
  trackLayerConstraintsNeedAttention,
  type DiagramCaptureKind,
  type DiagramCaptureOutcome as TrackedOutcome,
  type DiagramCaptureVia,
  type DiagramShowAsName,
  type DiagramShowAsVia,
} from '../../analytics';
import { fold3dRefusalMessage } from '../../cp-workspace/folded/foldedFigureNotice';
import { requestCpRegionFocus } from '../../cp-workspace/regions/regionFocusRequest';
import { boundariesMatch, regionReferenceFor, type RegionLike } from '../../cp-workspace/regions/regionReference';
import i18n from '../../i18n';
import { layerOrderOffline, layerOrderReloadAction } from '../../layer-order/engine/layerOrderLoadFailure';
import { needsAttentionFact } from '../../layer-order/model/layerOrderAnalytics';
import type { LayerOrderSolutionPress } from '../../layer-order/host/solutionCursorTable';
import type { LayerOrderAttention } from '../../lib/layerOrder/layerOrderRecord';
import { humanizeError } from '../../lib/toastMessages';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCaptureOutcome } from '../../store/workspaceStore/diagramCapture';
import {
  isLockedStep,
  nearestEarlierShowAs,
  renderToShowAs,
  showAsOf,
  DEFAULT_LAYER_SPREAD,
  spreadStartsFor,
  type DiagramLayerSpread,
  type DiagramCpRender,
  type DiagramCpSource,
  type DiagramDocument,
  type DiagramShowAs,
  type DiagramStep,
  stepById,
} from '../document/diagramDocument';
import { firstLinkPose } from '../zoom/zoomCapture';
import { knownCreasesOf } from './captureCreases';
import { layerOrderSummaryOf } from './captureLayerOrder';
import { stepSheetNow } from './stepSheetNow';
import { openLinkedPoseOf } from './openLinkedPose';

/** The Step pane, where the pattern picker is. */
const STEP_PANE_ID = 'diagram-step';

/**
 * Choose the pattern a step shows: select it, open the picker in its Picture
 * section, and bring the Step pane forward (the dock's tab, or the touch
 * drawer).
 */
export function openDiagramPatternPicker(stepId: string): void {
  const store = useWorkspaceStore.getState();
  if (!store.openDiagramPatternPicker(stepId)) return;
  useLayoutStore.getState().activatePanel(STEP_PANE_ID);
}

/**
 * The way the pattern picker last linked a pattern, this session: what it
 * offers a new link with no linked step before it (D19). Folded until the
 * first link: a diagram's step shows the model as it folds (Zach, 2026-10-26).
 */
let lastLinkedAs: DiagramShowAs = 'folded';

/**
 * What the picker offers a step to be shown as, until the reader picks
 * another way: a relink, the way the step is shown; a new link, the way the
 * nearest linked step before it is (review fix 3, amending D19), so a step
 * after a folded run links folded and stays in the run; with none before it,
 * the way the picker last linked.
 */
export function pickerShowAs(document: DiagramDocument | null, step: DiagramStep | null): DiagramShowAs {
  if (step?.source?.kind === 'cp') return showAsOf(step.source.render);
  return (document && step && nearestEarlierShowAs(document, step.id)) ?? lastLinkedAs;
}

/**
 * Link a step to a pattern — or relink a linked one to another — shown as
 * `way`, and capture its picture (D19): the picker links and chooses the way
 * in one pick. A relink in the way the step is shown keeps its pose, except a
 * Simulated fold %, which starts again at 0%. A first link starts at no turn,
 * but an enlarged step's shown as its run is in its run source's turn
 * (`firstLinkPose`); shown another way, it starts whole (`landSeededFrame`).
 * A relink to the step's own sheet keeps its layer order and restores it; to
 * another, leaves it behind and says so, Undo bringing it back. Whether it
 * was linked.
 */
export async function linkDiagramStep(stepId: string, sheet: RegionLike, way?: DiagramShowAs): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (!step || !store.diagram) return false;
  const linked = step.source?.kind === 'cp' ? step.source : null;
  const showAs = way ?? (linked ? showAsOf(linked.render) : 'crease-pattern');
  const spread = startingSpread(stepId);
  const asked = renderToShowAs(
    linked ?? { render: firstLinkPose(store.diagram, stepId, showAs, spread) ?? { mode: 'crease-pattern', rotationDeg: 0 } },
    showAs,
    spread
  );
  // A link chooses a region, and a fold % above 0 is only Pose's live solver's
  // to settle (D19): shown Simulated, it links at 0%, from the camera it had.
  const render: DiagramCpRender =
    asked.mode === 'simulated' && asked.foldPercent > 0 ? { ...asked, foldPercent: 0 } : asked;
  // A layer order names its sheet's faces (H7): kept, and restored, through a relink to the same sheet;
  // a link to another leaves it behind. A first link starts without one.
  const record = linked?.layerOrder;
  const sameSheet = linked !== null && record !== undefined && sameSheetAs(linked, sheet);
  const outcome = await store.captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(sheet) },
    render,
    kind: 'diagram-capture',
    label: linked ? 'Relink pattern' : 'Link pattern',
    ...(sameSheet ? layerOrderOf(linked) : {}),
  });
  report(outcome, render, linked ? 'relink' : 'link');
  if (outcome.status !== 'captured') return false;
  if (linked && record !== undefined && !sameSheet && outcome.changed) sayLayerOrderLeftBehind(linked);
  lastLinkedAs = showAs;
  if (way !== undefined && (!linked || showAsOf(linked.render) !== showAs)) {
    trackDiagramStepShownAs(trackedShowAs(showAs), 'picker');
  }
  useWorkspaceStore.getState().closeDiagramPatternPicker();
  return true;
}

/** Whether `sheet` is the one a linked step's link names now: a relink to its own sheet. */
function sameSheetAs(linked: DiagramCpSource, sheet: RegionLike): boolean {
  const now = stepSheetNow(linked);
  return now !== null && boundariesMatch(now.boundary, sheet.boundary);
}

/** Duplicate as Folded found the step's layer order needing a look (D10): no copy was made. */
function sayCopyNotFolded(attention: LayerOrderAttention): void {
  const t = i18n.t;
  toast.message(
    attention.count === 0
      ? t(
          'toasts:diagram.layerOrder.copyNotFoldedChosenOrder',
          'The copy couldn’t be shown folded, because this step’s chosen layer order needs attention.'
        )
      : t(
          'toasts:diagram.layerOrder.copyNotFolded',
          'The copy couldn’t be shown folded, because this step’s layer constraints need attention.'
        )
  );
}

/** A relink to another sheet left the step's layer order behind: said, with the way back. */
function sayLayerOrderLeftBehind(was: DiagramCpSource): void {
  const t = i18n.t;
  const constraints = layerOrderSummaryOf(was)?.constraints ?? 0;
  toast.message(
    constraints === 0
      ? t(
          'toasts:diagram.layerOrder.chosenOrderRemoved',
          'The step’s chosen layer order was for its old pattern, so it was removed. Undo brings it back.'
        )
      : t('toasts:diagram.layerOrder.removed', {
          count: constraints,
          defaultValue_one: 'The step’s layer constraint was for its old pattern, so it was removed. Undo brings it back.',
          defaultValue_other:
            'The step’s {{count}} layer constraints were for its old pattern, so they were removed. Undo brings them back.',
        })
  );
}

/**
 * Show a linked step's pattern another way (D19), in the pose that way last
 * had, as one undo step. While the step is open in Pose, through its pose
 * controller, which holds the fold; otherwise captured here. Whether the step
 * now shows it that way.
 */
export async function showLinkedStepAs(
  stepId: string,
  way: DiagramShowAs,
  via: Exclude<DiagramShowAsVia, 'duplicate'>
): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (step?.source?.kind !== 'cp' || isLockedStep(step) || store.diagramReadOnly) return false;
  // A saved Defox view is none of the ways: choosing one replaces it, as Pose does.
  if (step.source.render.mode !== 'defox' && showAsOf(step.source.render) === way && step.picture !== null) return true;
  const open = openLinkedPoseOf(stepId);
  if (open) {
    // The open step's controller says why, if it could not; only a way shown is counted.
    if (!(await open.showAs(way))) return false;
    trackDiagramStepShownAs(trackedShowAs(way), via);
    return true;
  }
  const render = renderToShowAs(step.source, way, startingSpread(stepId));
  const outcome = await store.captureDiagramStep(stepId, {
    scope: step.source.scope,
    known: knownCreasesOf(step.source),
    render,
    kind: 'diagram-capture',
    label: showAsLabel(way),
    ...layerOrderOf(step.source),
  });
  report(outcome, render, 'show_as');
  if (outcome.status !== 'captured') return false;
  trackDiagramStepShownAs(trackedShowAs(way), via);
  return true;
}

/**
 * A copy of a linked step after it, linked to the same region and shown the
 * other way (D19): the pattern, then what it folds into, in two presses. One
 * undo step: the capture folds into the duplicate's. A capture that does not
 * land takes the copy with it — a copy shown the old way is not what was
 * asked for. The copy's id, or null.
 */
export async function duplicateLinkedStepAs(stepId: string, way: DiagramShowAs): Promise<string | null> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (step?.source?.kind !== 'cp' || isLockedStep(step) || store.diagramReadOnly) return null;
  const source = step.source;
  const copyId = store.duplicateDiagramStep(stepId);
  if (copyId === null) return null;
  // Shown the same way, it is a plain duplicate: no way chosen to count.
  if (source.render.mode !== 'defox' && showAsOf(source.render) === way) return copyId;
  const render = renderToShowAs(source, way, startingSpread(copyId));
  const duplicated = useWorkspaceStore.getState().diagramHistory.past.at(-1);
  const outcome = await useWorkspaceStore.getState().captureDiagramStep(copyId, {
    scope: source.scope,
    known: knownCreasesOf(source),
    render,
    kind: 'diagram-capture',
    label: 'Duplicate step',
    joinEntry: duplicated,
    // The copy's: its source is the original's, record and all.
    ...layerOrderOf(source),
  });
  // A copy whose layer order kept it from being drawn is undone below: nothing was kept, so
  // nothing is counted, and the toast is about the copy, not a picture it keeps.
  if (outcome.status === 'needs-attention') sayCopyNotFolded(outcome.attention);
  else report(outcome, render, 'duplicate_as');
  if (outcome.status !== 'captured') {
    const now = useWorkspaceStore.getState();
    if (duplicated !== undefined && now.diagramHistory.past.at(-1) === duplicated) now.undoDiagram();
    return null;
  }
  trackDiagramStepShownAs(trackedShowAs(way), 'duplicate');
  return copyId;
}

/**
 * The spread a flat fold this step starts takes (13g: on by default): the
 * nearest earlier step's, else the default, affine (`DEFAULT_LAYER_SPREAD`).
 * A fold the step remembers keeps its own (`renderToShowAs`).
 */
function startingSpread(stepId: string): DiagramLayerSpread {
  const { diagram } = useWorkspaceStore.getState();
  return diagram ? spreadStartsFor(diagram, stepId).any : DEFAULT_LAYER_SPREAD;
}

/** The undo step a Show as makes. */
function showAsLabel(way: DiagramShowAs): string {
  switch (way) {
    case 'crease-pattern':
      return 'Show as Crease Pattern';
    case 'folded':
      return 'Show as Folded';
    case 'simulated':
      return 'Show as Simulated';
  }
}

function trackedShowAs(way: DiagramShowAs): DiagramShowAsName {
  return way === 'crease-pattern' ? 'crease_pattern' : way;
}

/** Capture a linked step's picture again, from its pattern as it is now. Whether it was. */
export async function refreshDiagramStep(stepId: string): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (step?.source?.kind !== 'cp') return false;
  const { scope, render } = step.source;
  const outcome = await store.captureDiagramStep(stepId, {
    scope,
    known: knownCreasesOf(step.source),
    render,
    kind: 'diagram-refresh',
    label: 'Refresh picture',
    ...layerOrderOf(step.source),
  });
  report(outcome, render, 'refresh');
  return outcome.status === 'captured';
}

/**
 * A capture's layer order, from the step's source: the record it keeps, if
 * any, for the capture to carry and draw (layer order H7). A relink asks
 * with it only to the step's own sheet: another's faces are not the ones the
 * record names.
 */
export function layerOrderOf(source: DiagramCpSource): { layerOrder?: string } {
  return source.layerOrder === undefined ? {} : { layerOrder: source.layerOrder };
}

/**
 * Show a linked step's pattern in Edit: the region it is linked to, framed on
 * Edit's canvas when it next draws — where it is now, if it moved; where it
 * was, if it cannot be found.
 */
export function openDiagramStepInEdit(stepId: string): void {
  const { diagram } = useWorkspaceStore.getState();
  const step = diagram ? stepById(diagram, stepId) : null;
  if (step?.source?.kind !== 'cp') return;
  requestCpRegionFocus(stepSheetNow(step.source)?.bounds ?? step.source.scope.region.bounds);
  useLayoutStore.getState().activateWorkspace('edit');
  trackDiagramSourceOpened('edit');
}

/** How a captured picture shows its pattern, for analytics. */
export function captureKind(render: DiagramCpRender): DiagramCaptureKind {
  switch (render.mode) {
    case 'defox': return 'defox';
    case 'crease-pattern':
      return 'crease_pattern';
    case 'folded-flat':
      return 'flat';
    case 'folded-3d':
      return '3d';
    case 'simulated':
      return 'simulated';
  }
}

/** Count what a capture came to, and say what the user needs told. */
function report(outcome: DiagramCaptureOutcome, asked: DiagramCpRender, via: DiagramCaptureVia): void {
  trackCapture(outcome, asked, via);
  sayCaptureOutcome(outcome);
}

/**
 * Count what a capture came to, when it folded or drew anything: by how it
 * shows the pattern (the folder the creases needed, not the one asked for).
 */
export function trackCapture(
  outcome: DiagramCaptureOutcome,
  asked: DiagramCpRender,
  via: DiagramCaptureVia
): void {
  const attention = newAttentionOf(outcome);
  // Constraints that did not all hold (spec §10): once, as the stored summary changes to say so.
  if (attention) trackStepLayerOrderAttention(attention);
  const tracked = trackedOutcome(outcome);
  if (!tracked) return;
  const render = outcome.status === 'captured' ? outcome.render : asked;
  trackDiagramPictureCaptured(captureKind(render), tracked, via);
}

/**
 * The summary a capture newly stored on the step's record: kept back and
 * flagged anew, or drawn with some left out, or waiting for 3D creases. A
 * summary stored again as it was says nothing new.
 */
function newAttentionOf(outcome: DiagramCaptureOutcome): LayerOrderAttention | null {
  if (outcome.status === 'needs-attention') return outcome.changed ? outcome.attention : null;
  return outcome.status === 'captured' ? (outcome.flagged ?? null) : null;
}

/**
 * `layer constraints need attention` for a Diagram step (spec §10), through
 * the central layer, for a summary newly stored: never for a record whose
 * order was chosen with no constraint (D16), where nothing is broken.
 */
export function trackStepLayerOrderAttention(attention: LayerOrderAttention): void {
  if (attention.count === 0) return;
  trackLayerConstraintsNeedAttention(needsAttentionFact('diagram_step', attention.count).properties);
}

/**
 * Tell the user what a capture came to, when there is something to tell: a
 * picture kept see-through or as a bitmap, or one that could not be taken and
 * why. A Stop, or a capture the user moved on from, says nothing. A capture
 * that drew the step with some of its constraints left out says nothing
 * either: the Step pane's flag does (D10, D14).
 */
export function sayCaptureOutcome(outcome: DiagramCaptureOutcome): void {
  const t = i18n.t;
  switch (outcome.status) {
    case 'needs-attention':
      // The Step pane's Picture section says why, with Review… (D14).
      toast.message(
        outcome.attention.count === 0
          ? t(
              'toasts:diagram.capture.chosenOrderKept',
              'This step’s chosen layer order needs attention, so it keeps its picture.'
            )
          : t('toasts:diagram.capture.layerOrderKept', 'This step’s layer constraints need attention, so it keeps its picture.')
      );
      return;
    case 'order-refused':
      // D3: the dialog's order is drawn as it was chosen, or not at all.
      toast.error(t('toasts:diagram.layerOrder.refused', 'This layer order couldn’t be drawn, so nothing was changed.'));
      return;
    case 'layer-order-lost':
      sayLayerOrderLost(outcome.offline);
      return;
    case 'captured':
      if (outcome.noLayerOrder) {
        toast.message(
          t(
            'toasts:diagram.capture.noLayerOrder',
            'Its layers couldn’t be put in order, so the step shows the folded paper see-through.'
          )
        );
      } else if (outcome.tooDetailed) {
        toast.message(
          t(
            'toasts:diagram.capture.tooDetailed',
            'Too detailed to keep as a drawing, so the step keeps it as an image.'
          )
        );
      }
      return;
    case 'refused':
      toast.error(t('toasts:diagram.capture.refused', 'This pattern doesn’t fold'), {
        description: fold3dRefusalMessage(t, outcome.refusal),
      });
      return;
    // In Edit's words for the same fold (a pattern that does not fold flat,
    // a cut through the sheet…), not the kernel's Rust value.
    case 'failed':
      toast.error(t('toasts:diagram.capture.failed', 'The picture couldn’t be captured'), {
        description: humanizeError(outcome, t),
      });
      return;
    case 'missing':
      toast.error(
        t('toasts:diagram.capture.missing', 'That pattern isn’t in the crease pattern any more.')
      );
      return;
    case 'unavailable':
      toast.error(t('toasts:diagram.capture.unavailable', 'This pattern can’t be simulated.'));
      return;
    case 'needs-pose':
      toast.message(
        t(
          'toasts:diagram.capture.needsPose',
          'A step folded part way in the simulator is captured in Pose: open it with Adjust Pose.'
        )
      );
      return;
    case 'unknown':
      toast.error(
        t('toasts:diagram.capture.unknown', 'The crease pattern isn’t ready yet. Try again in a moment.')
      );
      return;
    case 'no-pattern':
      toast.error(t('toasts:diagram.capture.noPattern', 'Open a crease pattern in Edit first.'));
      return;
    // The Diagram disables its own verbs on a read-only diagram; this is
    // reached from Edit, where nothing else would say why nothing happened.
    case 'read-only':
      toast.error(
        t(
          'toasts:diagram.capture.readOnly',
          'This diagram was made with a newer Ori Studio and opens read-only.'
        )
      );
      return;
    // Nothing to say: the user stopped it, asked twice, or moved on.
    case 'stopped':
    case 'discarded':
    case 'busy':
      return;
  }
}

/**
 * The host engine was not there to restore a step's record, so nothing was
 * checked and nothing written. `loadFailed`: the browser did not load it (the
 * host engine's `load`, by `isLayerOrderLoadFailure`), which only a reload
 * retries — offered as Reload (`layerOrderReloadAction`), and offline, to
 * reconnect first; otherwise it stopped or did not start, said neutrally,
 * since that may be a defect.
 */
export function sayLayerOrderLost(loadFailed: boolean, id?: string): void {
  const t = i18n.t;
  // A step's ‹ › share a toast a try (`sayStepSolutionPress`); a capture's stands alone.
  const shared = id === undefined ? {} : { id };
  if (!loadFailed) {
    const said = t('toasts:diagram.layerOrder.lost', 'Layer order stopped unexpectedly, so this step wasn’t changed.');
    if (id === undefined) toast.error(said);
    else toast.error(said, shared);
    return;
  }
  toast.error(
    layerOrderOffline()
      ? t(
          'toasts:diagram.layerOrder.lostLoadOffline',
          'Layer order couldn’t load while offline, so this step wasn’t changed. Reconnect, then reload Ori Studio to try again.'
        )
      : t(
          'toasts:diagram.layerOrder.lostLoadReload',
          'Layer order couldn’t load, so this step wasn’t changed. Reload Ori Studio to try again.'
        ),
    { ...shared, action: layerOrderReloadAction(t) }
  );
}

/**
 * The toast ids of a step's ‹ › messages, by how many times the user has kept
 * trying, as Edit's are (`foldedFigureVerbs.ts`): presses at the same try
 * replace one another, and each Keep trying gets a fresh one, since clicking
 * it dismisses its toast and a toast shown again under that id while it
 * leaves is lost in its exit. A calm message and an error each have their
 * own, since sonner merges a toast into what its id last showed (an error's
 * look included); showing either dismisses the other.
 */
function stepSolutionToastIds(tries: number): { readonly error: string; readonly calm: string } {
  const error = `diagram-layer-order-step-${tries}`;
  return { error, calm: `${error}-timed-out` };
}

/**
 * What a constrained step's ‹ or › that moved nothing says, if anything
 * (layer order H9), by its cause, as Edit's figures say it
 * (`sayFoldedSolutionStep`) in the Diagram's words:
 *
 * - the engine didn't load, with Reload, the only retry there is (offline:
 *   reconnect first), or it stopped;
 * - the record couldn't be checked in time (D10), or the search for the next
 *   solution ran out (E9's `timed_out`): each a calm message, not an error,
 *   with Keep trying (`keepTrying`), which asks again that way on the same
 *   worker with longer limits, and the step goes on from what it proved;
 * - the next solution is too large to save with the step, or the engine
 *   refused the step's creases;
 * - its constraints clash with its pattern as it is now. Said so it reads
 *   without a flag: a step whose creases changed since it was last captured
 *   carries none until a Refresh, and a step flagged as needing attention
 *   never gets here (its ‹ › wait for Review…).
 *
 * An end (proved since E9: asking again gains nothing), a Stop, a step that
 * moved on, or one that can't step now says nothing: the pager waits at the
 * end and shows where it stands, and the rest the user did or already sees.
 * An order that can't be drawn said so through the capture. `tries` is how
 * many times the user has kept trying, for the toast's id.
 */
export function sayStepSolutionPress(press: LayerOrderSolutionPress, keepTrying: () => void, tries = 0): void {
  const t = i18n.t;
  const ids = stepSolutionToastIds(tries);
  const keepTryingAction = { label: t('dialogs:layerOrder.keepTrying', 'Keep trying'), onClick: keepTrying };
  // An error shows under the error id, and replaces a calm message of the same try.
  const id = ids.error;
  switch (press.status) {
    case 'lost':
      toast.dismiss(ids.calm);
      sayLayerOrderLost(press.cause === 'load', id);
      return;
    case 'timed_out':
      // Running out of time is an answer, not a fault: said calmly, as Edit's figures say it, under an id
      // no error has held.
      toast.dismiss(ids.error);
      toast.message(
        press.stage === 'step'
          ? t(
              'toasts:diagram.layerOrder.stepNotFoundInTime',
              'Couldn’t find another solution in time, so this step wasn’t changed.'
            )
          : t(
              'toasts:diagram.layerOrder.stepCheckTimedOut',
              'Couldn’t check this step’s layer constraints in time, so it wasn’t changed.'
            ),
        { id: ids.calm, action: keepTryingAction }
      );
      return;
    case 'too-large':
      toast.dismiss(ids.calm);
      toast.error(
        t(
          'toasts:diagram.layerOrder.stepTooLarge',
          'The next layer order is too large to save with this step, so it wasn’t changed.'
        ),
        { id }
      );
      return;
    case 'unrestored':
      toast.dismiss(ids.calm);
      toast.error(
        press.why === 'clash'
          ? t(
              'toasts:diagram.layerOrder.stepClash',
              'This step’s layer constraints clash with its pattern as it is now, so it can’t step through its solutions. Edit its layer order to review them.'
            )
          : t(
              'toasts:diagram.layerOrder.stepRefused',
              'Layer order can’t step through this step’s solutions, so it wasn’t changed.'
            ),
        { id }
      );
      return;
    case 'moved':
    case 'end':
    case 'not-drawn':
    case 'stopped':
    case 'blocked':
      return;
  }
}

function trackedOutcome(outcome: DiagramCaptureOutcome): TrackedOutcome | null {
  switch (outcome.status) {
    case 'captured':
      return outcome.noLayerOrder ? 'no_layer_order' : outcome.tooDetailed ? 'rasterized' : 'ok';
    case 'refused':
      return 'refused';
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'failed';
    default:
      // Not a capture: nothing was folded or drawn.
      return null;
  }
}
