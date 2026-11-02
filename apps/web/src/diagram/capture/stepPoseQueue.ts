import { toast } from 'sonner';
import i18n from '../../i18n';
import { registerCanvasSessionEnder } from '../../cp-workspace/canvasObjects/canvasSessions';
import { reportError } from '../../monitoring';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { stepById } from '../document/diagramDocument';

interface Edit {
  key: string | symbol;
  write: (current: () => boolean) => Promise<unknown>;
  finish: () => void;
}

interface Queue {
  offer: (edit: Edit) => void;
}

const queues = new Map<string, Queue>();

/** Serialize inexpensive pose requests behind expensive captures. A newer edit
 * of the same field replaces an older pending one and invalidates its in-flight
 * result. History/document changes cancel the entire queue, including idle waits.
 * Shared by inspector and canvas, for both CP-linked and Fold-derived steps. */
export function queueStepPoseEdit(
  stepId: string,
  key: string | null,
  write: Edit['write'],
): Promise<void> {
  let queue = queues.get(stepId);
  if (!queue) {
    const loadId = useWorkspaceStore.getState().diagramLoadId;
    const pending = new Map<string | symbol, Edit>();
    const latest = new Map<string | symbol, Edit>();
    let cancelled = false;
    let running = false;
    let wake: (() => void) | null = null;
    const valid = () => {
      const state = useWorkspaceStore.getState();
      const step = state.diagram && stepById(state.diagram, stepId);
      return !cancelled && state.diagramLoadId === loadId && !state.diagramReadOnly && !!step && !step.unknown;
    };
    const unregister = registerCanvasSessionEnder(() => {
      cancelled = true;
      for (const edit of latest.values()) edit.finish();
      pending.clear();
      latest.clear();
      wake?.();
      // An edit after Undo belongs to a new queue even while the old worker finishes.
      if (queues.get(stepId) === owner) queues.delete(stepId);
    });
    const idle = () => new Promise<void>((resolve) => {
      const check = () => {
        if (valid() && useWorkspaceStore.getState().diagramCaptures[stepId]) return;
        off();
        wake = null;
        resolve();
      };
      const off = useWorkspaceStore.subscribe(check);
      wake = check;
      check();
    });
    const drain = async () => {
      if (running) return;
      running = true;
      try {
        // Collect same-turn requests before starting the first capture.
        await Promise.resolve();
        while (pending.size && valid()) {
          while (valid() && useWorkspaceStore.getState().diagramCaptures[stepId]) await idle();
          if (!valid()) break;
          const edit = pending.values().next().value!;
          pending.delete(edit.key);
          try {
            await edit.write(() => valid() && latest.get(edit.key) === edit);
          } catch (error) {
            // Capture actions report expected failures themselves. Unexpected
            // failures must not poison the queue or become unhandled rejections.
            reportError(error, { surface: 'diagram-pose', handled: true });
            if (valid()) toast.error(i18n.t('toasts:diagram.capture.failed', 'The picture couldn’t be captured'));
          } finally {
            edit.finish();
          }
        }
      } finally {
        for (const edit of pending.values()) edit.finish();
        pending.clear();
        latest.clear();
        unregister();
        if (queues.get(stepId) === owner) queues.delete(stepId);
      }
    };
    const owner: Queue = {
      offer(edit) {
        if (edit.key === 'presentation') {
          pending.get('orbit')?.finish();
          pending.delete('orbit');
          latest.delete('orbit');
        }
        pending.get(edit.key)?.finish();
        pending.set(edit.key, edit);
        latest.set(edit.key, edit);
        void drain();
      },
    };
    queues.set(stepId, owner);
    queue = owner;
  }
  return new Promise<void>((finish) => queue.offer({ key: key ?? Symbol(), write, finish }));
}
