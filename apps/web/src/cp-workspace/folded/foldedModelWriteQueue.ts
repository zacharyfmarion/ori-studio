import type { OristudioCpFoldedFigureModel } from '../../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { FoldedModelWriteOptions } from '../../store/workspaceStore/types';

/**
 * A flat folded figure's model lives in the kernel, and every colour tick is a
 * round trip — ~200 ms native on a 2,000-crease figure. A colour drag fires
 * forty of them, and the store's own guard (only the newest request writes)
 * still issued forty uncancellable calls that the kernel worked through in
 * order. This is the single-flight queue in front of that: at most one write
 * in flight per figure, and every patch that arrives meanwhile coalesces into
 * one, issued when the in-flight write lands. A burst of forty ticks becomes
 * at most two round trips; the drag lags by one and is correct.
 *
 * A 3D figure re-projects synchronously in the store, so the same call is a
 * pass-through for it: each write resolves in a microtask and the next issues.
 *
 * Store-aware, React-free. The store keeps its own bookkeeping (the issued
 * merge base, the pending count, the superseded set) because a discrete verb
 * writes without this queue; this only orders the continuous writes.
 */
interface QueuedWrite {
  patch: Partial<OristudioCpFoldedFigureModel>;
  /**
   * A write is a mirror only while every patch folded into it is one: a
   * user's edit coalesced with the store's mirror is still the user's edit.
   */
  mirror: boolean;
}

interface FigureQueue {
  inFlight: Promise<void> | null;
  queued: QueuedWrite | null;
  /** Resolved once nothing is in flight and nothing is queued. */
  waiters: Array<() => void>;
}

const queues = new Map<string, FigureQueue>();

function queueFor(id: string): FigureQueue {
  const existing = queues.get(id);
  if (existing) return existing;
  const created: FigureQueue = { inFlight: null, queued: null, waiters: [] };
  queues.set(id, created);
  return created;
}

function issue(id: string, queue: FigureQueue, write: QueuedWrite): void {
  const issued = useWorkspaceStore
    .getState()
    .updateOristudioCpFoldedFigureModel(id, write.patch, { mirror: write.mirror });
  queue.inFlight = Promise.resolve(issued)
    // A refused or failed write has still landed, as far as ordering goes.
    .then(
      () => undefined,
      () => undefined
    )
    .then(() => {
      queue.inFlight = null;
      const next = queue.queued;
      queue.queued = null;
      if (next) {
        issue(id, queue, next);
        return;
      }
      const waiters = queue.waiters;
      queue.waiters = [];
      queues.delete(id);
      for (const resolve of waiters) resolve();
    });
}

/** Issue `patch`, or fold it into the patch waiting behind the write in flight. */
export function queueFoldedModelWrite(
  id: string,
  patch: Partial<OristudioCpFoldedFigureModel>,
  options: FoldedModelWriteOptions = {}
): void {
  const queue = queueFor(id);
  const mirror = options.mirror === true;
  if (queue.inFlight) {
    queue.queued = {
      patch: { ...(queue.queued?.patch ?? {}), ...patch },
      mirror: (queue.queued?.mirror ?? true) && mirror,
    };
    return;
  }
  issue(id, queue, { patch, mirror });
}

/** Whether a continuous write for `id` is in flight or waiting to be. */
export function foldedModelWriteInFlight(id: string): boolean {
  return queues.has(id);
}

/**
 * Resolves when nothing is in flight and nothing is queued — for `id`, or for
 * every figure. Immediately when that is already so.
 */
export function drainFoldedModelWrites(id?: string): Promise<void> {
  return pendingFoldedModelWrites(id) ?? Promise.resolve();
}

/**
 * The drain as a bracket's `beforeCommit` wants it: a promise while a write is
 * in flight or waiting, and null when there is nothing to wait for — so a
 * commit with nothing in flight stays synchronous and opens no drain window.
 */
export function pendingFoldedModelWrites(id?: string): Promise<void> | null {
  const targets =
    id === undefined ? [...queues.values()] : [queues.get(id)].flatMap((q) => (q ? [q] : []));
  if (targets.length === 0) return null;
  return Promise.all(
    targets.map(
      (queue) =>
        new Promise<void>((resolve) => {
          queue.waiters.push(resolve);
        })
    )
  ).then(() => undefined);
}

/**
 * An undo landed mid-drag: drop what is waiting and make every in-flight
 * result stale. The store then reconciles each figure once its stale write
 * has answered, so the kernel ends on the restored model.
 */
export function supersedeFoldedModelWrites(): void {
  for (const queue of queues.values()) queue.queued = null;
  useWorkspaceStore.getState().supersedeOristudioCpFoldedFigureModelWrites();
}

/** Tests only: forget every queue, as between two test cases. */
export function resetFoldedModelWriteQueueForTests(): void {
  queues.clear();
}
