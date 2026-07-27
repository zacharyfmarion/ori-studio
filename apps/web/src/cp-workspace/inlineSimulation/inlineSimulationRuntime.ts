import type { FoldDocument } from '../../engine/types';

/**
 * The heavy, unserializable half of an inline simulation window.
 *
 * Deliberately outside the store. The descriptor in the store is plain JSON and
 * is exactly what would be written to disk if these ever persist; a captured
 * `FoldDocument` is neither small nor something we would want to write, and
 * mixing it in is the change that would make persistence a rewrite rather than
 * an addition. Keeping the two apart costs one module.
 *
 * Also outside React state: nothing here drives a render, and a fold arriving
 * should not re-render the (very large) crease-pattern panel.
 */

export interface InlineSimulationSource {
  /** The captured segment fold the solver runs. */
  fold: FoldDocument;
  /**
   * Stable identity of that fold, so re-focusing a window can skip
   * `prepareFoldModel` in the worker. Changes whenever the fold is rebuilt.
   */
  modelKey: string;
}

const sources = new Map<string, InlineSimulationSource>();

export function setInlineSimulationSource(id: string, source: InlineSimulationSource): void {
  sources.set(id, source);
}

export function getInlineSimulationSource(id: string): InlineSimulationSource | null {
  return sources.get(id) ?? null;
}

export function clearInlineSimulationSource(id: string): void {
  sources.delete(id);
}

/** Drop every source — used when the document is replaced. */
export function clearAllInlineSimulationSources(): void {
  sources.clear();
}

/** Live source count, for tests and diagnostics. */
export function inlineSimulationSourceCount(): number {
  return sources.size;
}
