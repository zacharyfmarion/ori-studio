import { toast } from 'sonner';
import {
  trackDiagramPictureCaptured,
  type DiagramCaptureKind,
  type DiagramCaptureOutcome as TrackedOutcome,
  type DiagramCaptureVia,
} from '../../analytics';
import { fold3dRefusalMessage } from '../../cp-workspace/folded/foldedFigureNotice';
import { regionReferenceFor } from '../../cp-workspace/regions/regionReference';
import i18n from '../../i18n';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { DiagramCaptureOutcome } from '../../store/workspaceStore/diagramCapture';
import { stepIndex, type DiagramCpRender } from '../document/diagramDocument';

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
 * Link a step to a pattern — or relink a linked one to another — and capture
 * its picture. A new link shows the crease pattern itself, to fold in Pose; a
 * relink keeps how the step shows its pattern. Whether it was linked.
 */
export async function linkDiagramStep(stepId: string, segment: CpSegment): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram?.steps[stepIndex(store.diagram, stepId)];
  if (!step) return false;
  const linked = step.source?.kind === 'cp' ? step.source : null;
  const render: DiagramCpRender = linked?.render ?? { mode: 'crease-pattern', rotationDeg: 0 };
  const outcome = await store.captureDiagramStep(stepId, {
    scope: { kind: 'segment', region: regionReferenceFor(segment) },
    render,
    kind: 'diagram-capture',
    label: linked ? 'Relink pattern' : 'Link pattern',
  });
  report(outcome, render, linked ? 'relink' : 'link');
  if (outcome.status !== 'captured') return false;
  useWorkspaceStore.getState().closeDiagramPatternPicker();
  return true;
}

/** Capture a linked step's picture again, from its pattern as it is now. Whether it was. */
export async function refreshDiagramStep(stepId: string): Promise<boolean> {
  const store = useWorkspaceStore.getState();
  const step = store.diagram?.steps[stepIndex(store.diagram, stepId)];
  if (step?.source?.kind !== 'cp') return false;
  const { scope, render } = step.source;
  const outcome = await store.captureDiagramStep(stepId, {
    scope,
    render,
    kind: 'diagram-refresh',
    label: 'Refresh picture',
  });
  report(outcome, render, 'refresh');
  return outcome.status === 'captured';
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
  }
}

/** Count what a capture came to, and say what the user needs told. */
function report(outcome: DiagramCaptureOutcome, asked: DiagramCpRender, via: DiagramCaptureVia): void {
  const t = i18n.t;
  const tracked = trackedOutcome(outcome);
  if (tracked) {
    const render = outcome.status === 'captured' ? outcome.render : asked;
    trackDiagramPictureCaptured(captureKind(render), tracked, via);
  }
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
    case 'failed':
      toast.error(t('toasts:diagram.capture.failed', 'The picture couldn’t be captured'), {
        description: outcome.message,
      });
      return;
    case 'missing':
      toast.error(
        t('toasts:diagram.capture.missing', 'That pattern isn’t in the crease pattern any more.')
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
    // Nothing to say: the user stopped it, asked twice, or moved on.
    case 'stopped':
    case 'discarded':
    case 'busy':
    case 'read-only':
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
