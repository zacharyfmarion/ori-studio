import type { FoldDocument } from '../../engine/types';
import type { SimulatorViewExportFormat } from '../../simulator/simulatorViewExport';

/**
 * The heavy, unserializable half of an inline simulation window.
 *
 * Deliberately outside the store. The descriptor in the store is plain JSON and
 * is exactly what is written to disk when a window persists; a captured
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

/**
 * Woken when a window's fold appears or goes away.
 *
 * Creating a window sets its source *before* the store write that re-renders the
 * layer, so the fold is already there by the time anything looks. Loading a file
 * cannot do that: the descriptors have to be in the store first, and the folds
 * are rebuilt from the document afterwards — deliberately without touching the
 * store, since writing to it would mean recomputing provenance. Without this the
 * layer read `getInlineSimulationSource` once, found nothing, and never looked
 * again: a restored window was an empty frame forever.
 */
const sourceListeners = new Set<() => void>();

function notifySources(): void {
  for (const listener of sourceListeners) listener();
}

/** Subscribe to folds appearing or being dropped. For `useSyncExternalStore`. */
export function subscribeInlineSimulationSources(listener: () => void): () => void {
  sourceListeners.add(listener);
  return () => sourceListeners.delete(listener);
}

export function setInlineSimulationSource(id: string, source: InlineSimulationSource): void {
  sources.set(id, source);
  notifySources();
}

export function getInlineSimulationSource(id: string): InlineSimulationSource | null {
  return sources.get(id) ?? null;
}

/**
 * Drop a window's fold. Its *position* in that fold deliberately survives.
 *
 * Deleting a window is undoable, and the fold is rebuilt on restore rather than
 * held (see `restoreOristudioCpInlineSimulationSources` — a segment fold is
 * hundreds of KB to a few MB, too much to keep for a window the user threw
 * away). A fold percentage is one number, so keeping it is free and is what
 * makes undo bring the window back where it was rather than snapped to flat —
 * the same guarantee losing focus already gives.
 *
 * Ids are never reused, and a document replace clears the map wholesale, so the
 * only thing that can ever read a kept percentage is the same window returning.
 */
export function clearInlineSimulationSource(id: string): void {
  sources.delete(id);
  notifySources();
}

/** Drop every source — used when the document is replaced. */
export function clearAllInlineSimulationSources(): void {
  sources.clear();
  foldPercents.clear();
  notifySources();
}

/**
 * Where each window's fold is, and who last moved it.
 *
 * Here rather than in the store descriptor for the reason at the top of this
 * file: it changes ~15 times a second while a fold runs, and the descriptor is
 * document-shaped state that half the crease-pattern panel is keyed on. It used
 * to live there, and the result was a full staleness walk over every crease in
 * the document, 15 times a second, costing 901ms of a 7.2s profile with two
 * stalls over 180ms. See `implementation-plans/inline-simulation-performance.md`.
 *
 * Lifetime matches the source above: keyed by window id, dropped only on delete
 * or document replace. That outlives losing focus, which is what a window needs
 * — it gives up its solver session on blur, so refocusing reloads and reseeds
 * the fold from here rather than snapping back to flat.
 */
const foldPercents = new Map<string, number>();

/** Listeners split by what they care about — see {@link publishInlineSimulationFold}. */
const readoutListeners = new Set<() => void>();
const targetListeners = new Set<(id: string, percent: number) => void>();

export function getInlineSimulationFoldPercent(id: string): number {
  return foldPercents.get(id) ?? 0;
}

/**
 * Report where the solver actually is. Wakes the readout (the toolbar's
 * percentage and slider) and nothing else.
 *
 * Deliberately does not notify the target listeners: a window must not treat the
 * solver's own output as a new instruction. Separating the two is what replaced
 * a "is this value more than 0.5 away from what the solver last said" heuristic
 * that existed only to guess which of the two a store write had come from.
 */
export function publishInlineSimulationFold(id: string, percent: number): void {
  foldPercents.set(id, percent);
  for (const listener of readoutListeners) listener();
}

/** Ask a window to fold to a percentage — a scrub, a replay, or the play loop. */
export function requestInlineSimulationFold(id: string, percent: number): void {
  foldPercents.set(id, percent);
  for (const listener of targetListeners) listener(id, percent);
  for (const listener of readoutListeners) listener();
}

/** Subscribe to fold changes from any source. For `useSyncExternalStore`. */
export function subscribeInlineSimulationFold(listener: () => void): () => void {
  readoutListeners.add(listener);
  return () => readoutListeners.delete(listener);
}

/** Subscribe to fold *requests* only, so the solver's own frames do not echo back. */
export function subscribeInlineSimulationFoldTarget(
  listener: (id: string, percent: number) => void,
): () => void {
  targetListeners.add(listener);
  return () => targetListeners.delete(listener);
}

/** Live source count, for tests and diagnostics. */
export function inlineSimulationSourceCount(): number {
  return sources.size;
}

/**
 * How to export a window's current view.
 *
 * A window's simulator runtime lives inside its component, so the floating
 * toolbar — a sibling, not a parent — cannot reach it. The window registers its
 * exporter here while it is mounted and the toolbar asks by id, which keeps the
 * call out of the crease-pattern panel: per AGENTS.md the panel is a composition
 * site, and threading a store-bound export callback through it is exactly the
 * kind of behaviour that belongs beside this concern's own modules.
 *
 * The same reason the fold percentages above are here: this is the
 * unserializable half of a window, and none of it belongs in the store.
 */
type InlineSimulationExporter = (format: SimulatorViewExportFormat) => Promise<boolean>;

const exporters = new Map<string, InlineSimulationExporter>();

/** Register while mounted. Returns the matching unregister, for an effect. */
export function registerInlineSimulationExporter(
  id: string,
  exporter: InlineSimulationExporter,
): () => void {
  exporters.set(id, exporter);
  return () => {
    // Guarded so a late cleanup cannot remove a successor's registration.
    if (exporters.get(id) === exporter) exporters.delete(id);
  };
}

/**
 * Export a window's view. False when no window with that id is mounted, which is
 * the honest answer for a toolbar that outlived its window rather than a fault.
 */
export function exportInlineSimulation(
  id: string,
  format: SimulatorViewExportFormat,
): Promise<boolean> {
  const exporter = exporters.get(id);
  return exporter ? exporter(format) : Promise.resolve(false);
}
