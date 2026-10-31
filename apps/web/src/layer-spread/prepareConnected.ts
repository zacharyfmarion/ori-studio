import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { ConnectedSpreadSource } from '../cp-workspace/folded/connectedSpreadSource';
import type { PreparedConnectedSpread } from './connectedScene';
import { layerSpreadService, type SpreadLease } from './spreadService';

export interface ConnectedLease {
  promise: Promise<PreparedConnectedSpread>;
  release(): void;
}
interface SourceLease {
  promise: Promise<ConnectedSpreadSource>;
  release(): void;
}
interface Preparation {
  scene: OristudioCpFoldedPaperScene;
  yUp: boolean;
  priority: number;
  refs: number;
  worker: Worker | null;
  timer: ReturnType<typeof setTimeout> | null;
  promise: Promise<ConnectedSpreadSource>;
  resolve: (source: ConnectedSpreadSource) => void;
  reject: (error: Error) => void;
}
const sources = new WeakMap<OristudioCpFoldedPaperScene, Map<boolean, ConnectedSpreadSource>>();
const pending: Preparation[] = [];
// One active view and one windowed thumbnail can prepare concurrently. The
// numerical solve itself remains serialized by SpreadService.
const MAX_PREPARING = 2;
function finish(task: Preparation, error: Error | null, source?: ConnectedSpreadSource) {
  const index = pending.indexOf(task);
  if (index < 0) return;
  pending.splice(index, 1);
  task.worker?.terminate();
  if (task.timer) clearTimeout(task.timer);
  if (error) task.reject(error);
  else if (source) {
    const cached = sources.get(task.scene) ?? new Map();
    cached.set(task.yUp, source);
    sources.set(task.scene, cached);
    task.resolve(source);
  }
  pump();
}
function pump() {
  while (pending.filter((task) => task.worker).length < MAX_PREPARING) {
    const task = pending.filter((task) => !task.worker).sort((a, b) => b.priority - a.priority)[0];
    if (!task) return;
    try {
      const worker = new Worker(new URL('./prepare.worker.ts', import.meta.url), { type: 'module' });
      task.worker = worker;
      task.timer = setTimeout(() => finish(task, new Error('Spread preparation exceeded its time budget')), 12_000);
      worker.onmessage = ({
        data,
      }: {
        data: { kind: 'ready'; source: ConnectedSpreadSource } | { kind: 'unavailable'; message: string };
      }) => {
        if (data.kind === 'ready') finish(task, null, data.source);
        else finish(task, new Error(data.message));
      };
      worker.onerror = () => finish(task, new Error('Spread preparation worker failed'));
      worker.postMessage({ scene: task.scene, yUp: task.yUp });
    } catch (error) {
      finish(task, error instanceof Error ? error : new Error(String(error)));
    }
  }
}
function sourceLease(scene: OristudioCpFoldedPaperScene, yUp: boolean, priority: number): SourceLease {
  const cached = sources.get(scene)?.get(yUp);
  if (cached) return { promise: Promise.resolve(cached), release: () => {} };
  let task = pending.find((task) => task.scene === scene && task.yUp === yUp);
  if (!task) {
    let resolve!: Preparation['resolve'], reject!: Preparation['reject'];
    const promise = new Promise<ConnectedSpreadSource>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    void promise.catch(() => {});
    task = { scene, yUp, priority, refs: 0, worker: null, timer: null, promise, resolve, reject };
    pending.push(task);
  }
  task.refs++;
  task.priority = Math.max(priority, task.priority);
  pump();
  const held = task;
  let released = false;
  return {
    promise: task.promise,
    release: () => {
      if (released) return;
      released = true;
      if (--held.refs === 0) finish(held, new DOMException('Spread preparation released', 'AbortError'));
    },
  };
}

/** Both canonicalization and the solve are off-thread. Own this lease at the
 * model lifetime, never the amount, reveal, camera or style lifetime. */
export function prepareConnected(scene: OristudioCpFoldedPaperScene, yUp = false, priority = 1): ConnectedLease {
  const preparation = sourceLease(scene, yUp, priority);
  let solve: SpreadLease | undefined,
    released = false;
  const promise = preparation.promise.then(async (source) => {
    if (released) throw new DOMException('Layer spread released', 'AbortError');
    solve = layerSpreadService().acquire(source.input, priority);
    return { source, solution: await solve.promise };
  });
  void promise.catch(() => {});
  return {
    promise,
    release: () => {
      released = true;
      preparation.release();
      solve?.release();
    },
  };
}
