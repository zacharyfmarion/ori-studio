import { designKind } from '../designKinds';
import type { DesignKindId } from '../designKinds';
import { createDocumentRegistry, type RegisteredDocument } from './documentRegistry';

/**
 * The bridge between design tabs and engine handles.
 *
 * The engine runtimes each kept a module-level "the current handle", which was
 * exactly right while one design could be open: loading replaced it, and freeing
 * the old one made a leak impossible. With tabs, "the current handle" stops being
 * a fact about the app and becomes a fact about *which tab you are looking at*.
 *
 * This module owns that mapping. It is deliberately not the store: the store
 * knows which tab is active, this knows which handle that tab has, and keeping
 * them apart is what lets a background optimize keep writing to a design the user
 * has switched away from.
 */

const registry = createDocumentRegistry();

/** A design as the handle layer sees it: an id and the kind that can codec it. */
function documentFor(designId: string, kind: DesignKindId): RegisteredDocument | null {
  const descriptor = designKind(kind);
  if (!descriptor) {
    if (import.meta.env.DEV) {
      console.error(`[ori-studio] no design kind registered for "${kind}"`);
    }
    return null;
  }
  return { id: designId, kind: descriptor };
}

/**
 * A live engine handle for a design, hydrating it if the registry had parked it.
 *
 * Returns null only when the kind is unregistered — a programming error, not a
 * state the caller has to design around.
 */
export async function acquireDesignHandle(
  designId: string,
  kind: DesignKindId,
): Promise<number | null> {
  const document = documentFor(designId, kind);
  return document ? registry.acquire(document) : null;
}

/**
 * Hold a design hot for the duration of `work`.
 *
 * Wrap anything long-running — an optimize, a fold, a build — so switching tabs
 * during it cannot evict the handle being written to.
 */
export async function withDesignHandle<T>(
  designId: string,
  kind: DesignKindId,
  work: (handle: number) => Promise<T>,
): Promise<T | null> {
  const document = documentFor(designId, kind);
  return document ? registry.pinned(document, work) : null;
}

/** Serialize a design, whether or not it currently holds a handle. */
export async function serializeDesign(
  designId: string,
  kind: DesignKindId,
): Promise<string | null> {
  const document = documentFor(designId, kind);
  if (!document) return null;
  try {
    return await registry.serialize(document);
  } catch {
    // Not registered: the design has never been materialized, so there is
    // nothing to serialize and the caller's `.osf` writer should skip it.
    return null;
  }
}

/** Give a design's handle back, keeping its text. Used on tab switch. */
export async function parkDesign(designId: string): Promise<void> {
  await registry.park(designId);
}

/** Drop a design entirely — closing its tab. */
export async function forgetDesign(designId: string): Promise<void> {
  await registry.forget(designId);
}

/** Seed a design from serialized text, e.g. when opening a file. */
export function adoptDesign(designId: string, text: string): void {
  registry.adopt(designId, text);
}

/**
 * Give a design a handle the caller already built.
 *
 * The engine runtimes create documents by calling the engine directly and get a
 * handle back — `newDesign` for a fresh design, `loadTmd` for one read from a
 * file. That handle has to become the design's, or the registry will build a
 * second, blank one the moment anything acquires the id.
 */
export async function adoptDesignHandle(
  designId: string,
  kind: DesignKindId,
  handle: number,
): Promise<boolean> {
  const document = documentFor(designId, kind);
  if (!document) return false;
  await registry.adoptHandle(document, handle);
  return true;
}

/** Whether a design currently holds a live handle. Diagnostics and tests. */
export function isDesignHot(designId: string): boolean {
  return registry.isHot(designId);
}

/** Ids holding live handles, least-recently-used first. Diagnostics and tests. */
export function hotDesignIds(): string[] {
  return registry.hotIds();
}

export function subscribeToDesignHandles(
  listener: Parameters<typeof registry.subscribe>[0],
): () => void {
  return registry.subscribe(listener);
}
