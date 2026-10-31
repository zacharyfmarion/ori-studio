import type { SpreadInput, SpreadSolution } from '@oristudio/layer-spread';
import type { SpreadRequest, SpreadResponse } from './protocol';
import { validSolution } from './protocol';

export interface SpreadWorker {
  postMessage(request: SpreadRequest): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<SpreadResponse>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface SpreadLease {
  promise: Promise<SpreadSolution>;
  release(): void;
}
interface Pending {
  input: SpreadInput;
  key: string;
  refs: number;
  priority: number;
  promise: Promise<SpreadSolution>;
  resolve: (value: SpreadSolution) => void;
  reject: (reason: Error) => void;
}
interface Cached {
  solution: SpreadSolution;
  bytes: number;
}

/** One cancellable worker and a byte-bounded cache shared by Fold and Diagram.
 * Releasing a lease never cancels another consumer. Termination interrupts
 * synchronous WASM, rather than merely ignoring its eventual answer.
 */
export class SpreadService {
  private worker: SpreadWorker | null = null;
  private generation = 0;
  private active: Pending | null = null;
  private pending = new Map<string, Pending>();
  private cache = new Map<string, Cached>();
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private factory: () => SpreadWorker,
    private budget = 32 * 1024 * 1024,
    private timeoutMs = 15_000,
  ) {}

  acquire(input: SpreadInput, priority = 1): SpreadLease {
    // An exact content key, not a lossy hash. View/style are absent by contract.
    const key = JSON.stringify(input);
    const cached = this.cache.get(key);
    if (cached) {
      this.cache.delete(key);
      this.cache.set(key, cached);
      return { promise: Promise.resolve(cached.solution), release: () => {} };
    }
    let request = this.pending.get(key);
    if (!request) {
      let resolve!: Pending['resolve'], reject!: Pending['reject'];
      const promise = new Promise<SpreadSolution>((yes, no) => {
        resolve = yes;
        reject = no;
      });
      // A cancelled component may no longer await its lease. Keep cancellation
      // from becoming a global unhandled rejection; callers still receive it.
      void promise.catch(() => {});
      request = { input, key, refs: 0, priority, promise, resolve, reject };
      this.pending.set(key, request);
    }
    request.refs++;
    request.priority = Math.max(request.priority, priority);
    // Visible interaction preempts a thumbnail solve. Its lease stays queued
    // and resumes later; terminating WASM is the only way to interrupt it.
    if (this.active && request.priority > this.active.priority) {
      this.stopWorker();
      this.active = null;
    }
    this.pump();
    let released = false;
    return {
      promise: request.promise,
      release: () => {
        if (released) return;
        released = true;
        if (--request.refs > 0 || !this.pending.has(key)) return;
        this.pending.delete(key);
        request.reject(new DOMException('Layer spread request released', 'AbortError'));
        if (this.active === request) {
          this.stopWorker();
          this.active = null;
        }
        this.pump();
      },
    };
  }

  peek(input: SpreadInput): SpreadSolution | null {
    return this.cache.get(JSON.stringify(input))?.solution ?? null;
  }
  get retainedBytes(): number {
    return this.bytes;
  }
  dispose(): void {
    this.stopWorker();
    this.active = null;
    for (const request of this.pending.values())
      request.reject(new DOMException('Layer spread service disposed', 'AbortError'));
    this.pending.clear();
    this.cache.clear();
    this.bytes = 0;
  }
  private stopWorker(): void {
    this.generation++;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.worker?.terminate();
    this.worker = null;
  }
  private pump(): void {
    if (this.active) return;
    const next = [...this.pending.values()].sort((a, b) => b.priority - a.priority)[0];
    if (!next) return;
    this.active = next;
    const generation = ++this.generation;
    try {
      this.worker ??= this.factory();
      this.worker.onmessage = ({ data }) => {
        if (data.generation !== generation || this.active !== next) return;
        if (data.kind === 'unavailable') this.finish(next, new Error(data.message));
        else if (!validSolution(data.solution, next.input)) this.finish(next, new Error('Invalid layer spread result'));
        else this.finish(next, null, data.solution);
      };
      this.worker.onerror = () => {
        if (this.active === next) this.finish(next, new Error('Layer spread worker failed'));
      };
      this.timer = setTimeout(() => {
        if (this.active === next) this.finish(next, new Error('Layer spread exceeded its time budget'));
      }, this.timeoutMs);
      this.worker.postMessage({ generation, input: next.input });
    } catch (error) {
      this.finish(next, error instanceof Error ? error : new Error(String(error)));
    }
  }
  private finish(request: Pending, error: Error | null, solution?: SpreadSolution): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    this.pending.delete(request.key);
    if (error || !solution) {
      this.stopWorker();
      request.reject(error ?? new Error('Missing layer spread result'));
    } else {
      const bytes = 2 * request.key.length + 8 * solution.heights.length + 2048;
      if (bytes <= this.budget) {
        while (this.bytes + bytes > this.budget) {
          const oldest = this.cache.entries().next().value;
          if (!oldest) break;
          this.cache.delete(oldest[0]);
          this.bytes -= oldest[1].bytes;
        }
        this.cache.set(request.key, { solution, bytes });
        this.bytes += bytes;
      }
      request.resolve(solution);
    }
    this.pump();
  }
}

let shared: SpreadService | undefined;
export function layerSpreadService(): SpreadService {
  return (shared ??= new SpreadService(
    () => new Worker(new URL('./spread.worker.ts', import.meta.url), { type: 'module' }),
  ));
}
