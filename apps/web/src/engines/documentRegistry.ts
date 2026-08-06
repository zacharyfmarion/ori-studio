import type { DesignKindDescriptor } from '../designKinds/types';
import { onEngineLost, type EngineId } from './engineHost';

/**
 * Owner of design-document engine handles.
 *
 * Today each engine module holds one handle in a module-level `let`, and
 * replacing it frees the old one — so leaks are structurally impossible and
 * memory is bounded by construction. N documents removes both guarantees at
 * once, which is why handle lifetime becomes an explicit thing with an owner
 * rather than a side effect of loading.
 *
 * Three jobs:
 *
 * - **Hydrate on demand.** A document's serialized text is the source of truth;
 *   a handle is a cache of it. `acquire()` materializes one, `park()` gives it back.
 * - **Bound the cache.** At most {@link DocumentRegistryOptions.hotLimit} handles
 *   live at once, least-recently-used evicted first.
 * - **Survive an engine dying.** A crashed worker takes every handle it held;
 *   the documents are fine, so they are parked rather than lost.
 *
 * It deliberately knows nothing about tabs, the store, or which document is
 * on screen. It maps document id -> handle, and that is all.
 */

/** A document as the registry sees it: an id, a kind, and its serialized form. */
export interface RegisteredDocument {
  id: string;
  kind: DesignKindDescriptor;
}

export interface DocumentRegistryOptions {
  /**
   * How many handles may be live at once. Three by default: enough that flipping
   * between a couple of designs never pays a hydration cost, small enough that
   * a set of large designs cannot multiply peak memory without bound.
   *
   * A **target**, not a hard cap — pinned documents are never evicted, so a
   * registry whose every hot slot is pinned will exceed it rather than free a
   * handle something is still writing to.
   */
  hotLimit?: number;
  /**
   * Where engine-loss notifications come from. Defaults to the real host.
   *
   * Injected for the same reason the codecs take their client that way: a
   * registry that reached for a module-level subscription could only be tested
   * by actually killing a worker, and every test would share one global listener
   * list — so a crash in one test would reach registries left over from another.
   */
  subscribeToEngineLoss?: typeof onEngineLost;
}

interface HotEntry {
  document: RegisteredDocument;
  handle: number;
  /** Monotonic counter; lowest is least-recently-used. */
  touched: number;
}

export const DEFAULT_HOT_LIMIT = 3;

export type DocumentRegistryEvent =
  | { type: 'hydrated'; documentId: string; handle: number }
  | {
      type: 'parked';
      documentId: string;
      reason: 'evicted' | 'released' | 'engine-lost';
      /**
       * Whether serialized text survives, so the document can be hydrated again.
       *
       * Always true for an ordinary park or eviction. False only when an engine
       * died holding a document that had never been parked — a design created and
       * never switched away from. Its content really is gone, and saying so is
       * better than hydrating a tab from an empty string.
       */
      recoverable: boolean;
    };

export function createDocumentRegistry(options: DocumentRegistryOptions = {}) {
  const hotLimit = options.hotLimit ?? DEFAULT_HOT_LIMIT;
  const hot = new Map<string, HotEntry>();
  /** Serialized text for every document the registry has parked. */
  const parked = new Map<string, string>();
  /**
   * Outstanding pins per document id.
   *
   * Keyed by id and held *outside* the hot entry on purpose: a pin has to exist
   * from the moment `pinned` is called, which is before the handle it protects
   * has finished hydrating. Storing the count on the entry meant a concurrent
   * `acquire()` could evict the document during that window — the exact thing pinning
   * is for.
   */
  const pins = new Map<string, number>();
  const isPinned = (documentId: string) => (pins.get(documentId) ?? 0) > 0;
  const listeners = new Set<(event: DocumentRegistryEvent) => void>();
  let clock = 0;

  const emit = (event: DocumentRegistryEvent) => {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch (error) {
        console.error('[ori-studio] document registry listener failed', error);
      }
    }
  };

  /**
   * Evict least-recently-used handles until the hot set is within budget.
   *
   * Parking serializes first, so an eviction never loses work. Pinned entries are
   * skipped: a document with an optimizer running is being written to, and both
   * freeing its handle and serializing it mid-run would be wrong.
   */
  const evictIfNeeded = async (protectId: string) => {
    while (hot.size > hotLimit) {
      const candidates = [...hot.values()]
        .filter((entry) => !isPinned(entry.document.id) && entry.document.id !== protectId)
        .sort((a, b) => a.touched - b.touched);
      const victim = candidates[0];
      // Everything else is pinned or is the document we just hydrated. Exceeding
      // the limit beats freeing a handle that is in use.
      if (!victim) return;
      await park(victim.document.id, 'evicted');
    }
  };

  /**
   * Serialize a document's handle, free it, and remember the text.
   *
   * Safe to call for a document that is already parked or was never hot.
   */
  async function park(
    documentId: string,
    reason: 'evicted' | 'released' = 'released'
  ): Promise<void> {
    const entry = hot.get(documentId);
    if (!entry) return;
    // Engine work is in flight. Serializing would capture a torn intermediate
    // state, and freeing would pull the handle out from under it. The caller
    // switching tabs mid-optimize simply keeps this document hot until it ends.
    if (isPinned(documentId)) return;
    // Removed before the awaits: a second `park` racing this one must not
    // serialize and free the same handle twice.
    hot.delete(documentId);
    try {
      parked.set(documentId, await entry.document.kind.codec.serialize(entry.handle));
    } catch (error) {
      // Serialization failed, so the last known text is all there is. Keeping it
      // loses the edits since, but dropping the entry entirely would lose the
      // document — and the handle still has to be freed either way.
      console.error(`[ori-studio] failed to serialize document ${documentId}`, error);
    }
    await entry.document.kind.codec.free(entry.handle);
    emit({ type: 'parked', documentId, reason, recoverable: parked.has(documentId) });
  }

  /**
   * A live handle for a document, hydrating from parked text if needed.
   *
   * Creates a fresh document the first time an id is seen, which is what makes
   * "open a new tab" and "restore a tab from a file" the same call.
   */
  async function acquire(document: RegisteredDocument): Promise<number> {
    const existing = hot.get(document.id);
    if (existing) {
      existing.touched = clock += 1;
      return existing.handle;
    }

    const text = parked.get(document.id);
    const handle =
      text === undefined
        ? await document.kind.codec.create()
        : await document.kind.codec.hydrate(text);

    hot.set(document.id, { document, handle, touched: (clock += 1) });
    // The parked text is deliberately *kept*, not consumed. It is the last known
    // good state, and it is the only thing standing between an engine crash and
    // losing the document outright — dropping it here would mean a document that
    // had been parked once could still become unrecoverable simply by being
    // looked at again. Cost is the text staying resident for at most `hotLimit`
    // documents; `park` overwrites it with something fresher.
    emit({ type: 'hydrated', documentId: document.id, handle });
    // After insertion, so the newly hydrated document counts toward the budget
    // and cannot itself be chosen as the victim.
    await evictIfNeeded(document.id);
    return handle;
  }

  /**
   * Hold a document hot for the duration of `work`.
   *
   * Wrap anything long-running — an optimize, a fold, a build — so a tab switch
   * during it cannot evict the handle being written to (see the plan's R14).
   */
  async function pinned<T>(document: RegisteredDocument, work: (handle: number) => Promise<T>): Promise<T> {
    // Pin *before* hydrating, not after: `acquire` suspends, and anything that runs
    // while it is suspended could otherwise evict the document this call exists
    // to protect.
    pins.set(document.id, (pins.get(document.id) ?? 0) + 1);
    try {
      const handle = await acquire(document);
      return await work(handle);
    } finally {
      const remaining = (pins.get(document.id) ?? 1) - 1;
      if (remaining > 0) pins.set(document.id, remaining);
      else pins.delete(document.id);
    }
  }

  /** Serialized text for a document, parking it first if it is hot. */
  async function serialize(document: RegisteredDocument): Promise<string> {
    const entry = hot.get(document.id);
    if (entry) return entry.document.kind.codec.serialize(entry.handle);
    const text = parked.get(document.id);
    if (text !== undefined) return text;
    throw new Error(`Document ${document.id} is not registered`);
  }

  /** Adopt a document the registry has not seen, from text (e.g. loading a file). */
  function adopt(documentId: string, text: string): void {
    parked.set(documentId, text);
  }

  /**
   * Take ownership of a handle the caller already created.
   *
   * The live-handle counterpart of {@link adopt}. Some engine calls build a
   * document and hand back a handle directly — `newDesign`, `loadTmd` — and a
   * caller holding one had nowhere to put it. Left outside, the registry would
   * create a *second*, blank document the first time anything acquired that id:
   * the real one leaks, the design is silently replaced by an empty one, and
   * `serialize` throws because nothing is registered under that id at all.
   *
   * Replaces whatever the document held, freeing the old handle. The parked text
   * goes with it — it describes the document being replaced, so keeping it would
   * make a later crash recover the wrong content rather than none.
   */
  async function adoptHandle(document: RegisteredDocument, handle: number): Promise<void> {
    const existing = hot.get(document.id);
    hot.set(document.id, { document, handle, touched: (clock += 1) });
    parked.delete(document.id);
    if (existing && existing.handle !== handle) {
      await existing.document.kind.codec.free(existing.handle);
    }
    emit({ type: 'hydrated', documentId: document.id, handle });
    await evictIfNeeded(document.id);
  }

  /** Drop a document entirely — closing its tab. Frees any live handle. */
  async function forget(documentId: string): Promise<void> {
    const entry = hot.get(documentId);
    if (entry) {
      hot.delete(documentId);
      await entry.document.kind.codec.free(entry.handle);
    }
    parked.delete(documentId);
  }

  /**
   * An engine died: every handle it held is invalid. Drop them without trying to
   * serialize or free — both would call the dead client and hang — and keep the
   * last parked text so the documents can be rehydrated once it respawns.
   */
  const handleEngineLost = (engine: EngineId) => {
    for (const entry of [...hot.values()]) {
      // A kind with no engine has no engine death to survive.
      if (entry.document.kind.engine === null || entry.document.kind.engine !== engine) continue;
      hot.delete(entry.document.id);
      // Whatever text was captured at the last park stands. A document that was
      // never parked has none, and `recoverable: false` says so rather than
      // inventing an empty document for the caller to hydrate from.
      emit({
        type: 'parked',
        documentId: entry.document.id,
        reason: 'engine-lost',
        recoverable: parked.has(entry.document.id),
      });
    }
  };

  const subscribe = options.subscribeToEngineLoss ?? onEngineLost;
  const stopListening = subscribe(({ engine }) => handleEngineLost(engine));

  return {
    acquire,
    park,
    pinned,
    serialize,
    adopt,
    adoptHandle,
    forget,
    /** Ids with a live handle, most-recently-used last. Diagnostics and tests. */
    hotIds: (): string[] =>
      [...hot.values()].sort((a, b) => a.touched - b.touched).map((entry) => entry.document.id),
    isHot: (documentId: string): boolean => hot.has(documentId),
    handleFor: (documentId: string): number | null => hot.get(documentId)?.handle ?? null,
    subscribe: (listener: (event: DocumentRegistryEvent) => void): (() => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    /** Stop reacting to engine loss. For tests and teardown. */
    dispose: stopListening,
  };
}

export type DocumentRegistry = ReturnType<typeof createDocumentRegistry>;
