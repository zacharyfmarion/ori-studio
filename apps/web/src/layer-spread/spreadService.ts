import type { SpreadInput, SpreadSolution } from '@oristudio/layer-spread';
type Request<I> = { generation: number; input: I };
type Response<S> = { generation: number; kind: 'ready'; solution: S } | { generation: number; kind: 'unavailable'; message: string };
import { validSolution } from './protocol';

export interface SpreadWorker<I = SpreadInput, S = SpreadSolution> {
  postMessage(request: Request<I>): void;
  terminate(): void;
  onmessage: ((event: MessageEvent<Response<S>>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
}
export interface SpreadLease<S = SpreadSolution> {
  promise: Promise<S>;
  release(): void;
}
interface Pending<I, S> {
  input: I;
  key: string;
  refs: number;
  priority: number;
  promise: Promise<S>;
  resolve: (value: S) => void;
  reject: (reason: Error) => void;
}
interface Cached<S> {
  solution: S;
  bytes: number;
}

/** One cancellable worker and a byte-bounded cache shared by Fold and Diagram.
 * Releasing a lease never cancels another consumer. Termination interrupts
 * synchronous WASM, rather than merely ignoring its eventual answer.
 */
export class SpreadService<I = SpreadInput, S = SpreadSolution> {
  private worker: SpreadWorker<I, S> | null = null;
  private generation = 0;
  private active: Pending<I, S> | null = null;
  private pending = new Map<string, Pending<I, S>>();
  private cache = new Map<string, Cached<S>>();
  private bytes = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  constructor(
    private factory: () => SpreadWorker<I, S>,
    private budget = 32 * 1024 * 1024,
    private timeoutMs = 15_000,
    private validate: (solution: S, input: I) => boolean = validSolution as unknown as (solution: S, input: I) => boolean,
    private solutionBytes: (solution: S) => number = solution => 2 * JSON.stringify(solution).length,
    private workerLifetime: 'reuse' | 'recycle' = 'reuse',
  ) {}

  acquire(input: I, priority = 1): SpreadLease<S> {
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
      let resolve!: Pending<I, S>['resolve'], reject!: Pending<I, S>['reject'];
      const promise = new Promise<S>((yes, no) => {
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

  peek(input: I): S | null {
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
        else if (!this.validate(data.solution, next.input)) this.finish(next, new Error('Invalid layer spread result'));
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
  private finish(request: Pending<I, S>, error: Error | null, solution?: S): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.active = null;
    this.pending.delete(request.key);
    if (error || !solution) {
      this.stopWorker();
      request.reject(error ?? new Error('Missing layer spread result'));
    } else {
      const bytes = 2 * request.key.length + this.solutionBytes(solution) + 2048;
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
      // Free the worker's WASM high-water memory, retaining only the small
      // solution cache. Pump starts a fresh worker if another lease is queued.
      if (this.workerLifetime === 'recycle') this.stopWorker();
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
