import { toast } from 'sonner';
import {
  trackDiagramPictureCaptured,
  trackDiagramSourceOpened,
  trackDiagramStepShownAs,
  type DiagramCaptureKind,
  type DiagramCaptureOutcome as TrackedOutcome,
  type DiagramCaptureVia,
  type DiagramShowAsName,
  type DiagramShowAsVia,
} from '../../analytics';
import { fold3dRefusalMessage } from '../../cp-workspace/folded/foldedFigureNotice';
import { requestCpRegionFocus } from '../../cp-workspace/regions/regionFocusRequest';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import i18n from '../../i18n';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import { humanizeError } from '../../lib/toastMessages';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCaptureOutcome } from '../../store/workspaceStore/diagramCapture';
import {
  isLockedStep,
  renderToShowAs,
  showAsOf,
  DEFAULT_LAYER_SPREAD,
  spreadStartsFor,
  type DiagramLayerSpread,
  type DiagramCpRender,
  type DiagramShowAs,
  type DiagramStep,
  stepById,
} from '../document/diagramDocument';
import { firstLinkPose } from '../zoom/zoomCapture';
import { knownCreasesOf } from './captureCreases';
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
 * offers the next new link (D19). A relink offers the way the step is shown.
 */
let lastLinkedAs: DiagramShowAs = 'crease-pattern';

/** What the picker offers a step to be shown as, until the reader picks another way. */
export function pickerShowAs(step: DiagramStep | null): DiagramShowAs {
  return step?.source?.kind === 'cp' ? showAsOf(step.source.render) : lastLinkedAs;
}

/**
 * Link a step to a pattern — or relink a linked one to another — shown as
 * `way`, and capture its picture (D19): the picker links and chooses the way
 * in one pick. A relink in the way the step is shown keeps its pose, except a
 * Simulated fold %, which starts again at 0%. A first link starts at no turn,
 * but an enlarged step's in its frame's source's turn (`firstLinkPose`).
 * Whether it was linked.
 */
export async function linkDiagramStep(stepId: string, segment: CpSegment, way?: DiagramShowAs): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram ? stepById(store.diagram, stepId) : null;
  if (!step || !store.diagram) return false;
  const linked = step.source?.kind === 'cp' ? step.source : null;
  const showAs = way ?? (linked ? showAsOf(linked.render) : 'crease-pattern');
  const spread = startingSpread(stepId);
  const asked = renderToShowAs(
    linked ?? { render: firstLinkPose(store.diagram, stepId, spread) ?? { mode: 'crease-pattern', rotationDeg: 0 } },
    showAs,
    spread
  );
  // A link chooses a region, and a fold % above 0 is only Pose's live solver's
  // to settle (D19): shown Simulated, it links at 0%, from the camera it had.
  const render: DiagramCpRender =
    asked.mode === 'simulated' && asked.foldPercent > 0 ? { ...asked, foldPercent: 0 } : asked;
  const outcome = await store.captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(segment) },
    render,
    kind: 'diagram-capture',
    label: linked ? 'Relink pattern' : 'Link pattern',
  });
  report(outcome, render, linked ? 'relink' : 'link');
  if (outcome.status !== 'captured') return false;
  lastLinkedAs = showAs;
  if (way !== undefined && (!linked || showAsOf(linked.render) !== showAs)) {
    trackDiagramStepShownAs(trackedShowAs(showAs), 'picker');
  }
  useWorkspaceStore.getState().closeDiagramPatternPicker();
  return true;
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
  if (showAsOf(step.source.render) === way && step.picture !== null) return true;
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
  if (showAsOf(source.render) === way) return copyId;
  const render = renderToShowAs(source, way, startingSpread(copyId));
  const duplicated = useWorkspaceStore.getState().diagramHistory.past.at(-1);
  const outcome = await useWorkspaceStore.getState().captureDiagramStep(copyId, {
    scope: source.scope,
    known: knownCreasesOf(source),
    render,
    kind: 'diagram-capture',
    label: 'Duplicate step',
    joinEntry: duplicated,
  });
  report(outcome, render, 'duplicate_as');
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
  });
  report(outcome, render, 'refresh');
  return outcome.status === 'captured';
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
  const tracked = trackedOutcome(outcome);
  if (!tracked) return;
  const render = outcome.status === 'captured' ? outcome.render : asked;
  trackDiagramPictureCaptured(captureKind(render), tracked, via);
}

/**
 * Tell the user what a capture came to, when there is something to tell: a
 * picture kept see-through or as a bitmap, or one that could not be taken and
 * why. A Stop, or a capture the user moved on from, says nothing.
 */
export function sayCaptureOutcome(outcome: DiagramCaptureOutcome): void {
  const t = i18n.t;
  switch (outcome.status) {
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
