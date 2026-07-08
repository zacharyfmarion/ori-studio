import type { PreparedOrigamiModel } from '@treemaker/origami-simulator';

/**
 * A tiny LRU cache of prepared simulator models so re-selecting a crease-pattern
 * segment skips the (topology-heavy) `prepareFoldModel` step, keeping rapid
 * switching smooth.
 *
 * It caches immutable prepared models — NOT solver controllers — so simulation
 * state never bleeds between segments; a fresh `DynamicSolver` is still created
 * per selection (cheap typed-array allocation). Capacity bounds retained memory
 * to the last `capacity` segments' prepared arrays.
 */
export class PreparedModelCache {
  private readonly capacity: number;
  private readonly entries = new Map<string, PreparedOrigamiModel>();

  constructor(capacity = 4) {
    this.capacity = Math.max(1, capacity);
  }

  get(key: string, factory: () => PreparedOrigamiModel): PreparedOrigamiModel {
    const existing = this.entries.get(key);
    if (existing) {
      // Refresh recency: re-insert so Map iteration order tracks LRU.
      this.entries.delete(key);
      this.entries.set(key, existing);
      return existing;
    }
    const model = factory();
    this.entries.set(key, model);
    this.evict();
    return model;
  }

  clear(): void {
    this.entries.clear();
  }

  get size(): number {
    return this.entries.size;
  }

  private evict(): void {
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }
}
