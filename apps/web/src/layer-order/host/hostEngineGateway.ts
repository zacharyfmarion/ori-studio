/**
 * The one door into the Layer order host engine
 * (`implementation-plans/layer-order-dialog.md`, row H2): what Edit's refold
 * and reopen, the Diagram's capture and Refresh, and Pose call when no dialog
 * is open, and what a constrained figure's Another solution steps with (H6,
 * {@link openLayerOrderSolutionCursor}). Hosts import this module, never
 * `layerOrderHostEngine.ts` or `layerOrderSolutionCursor.ts`.
 *
 * **Nothing loads with the page** (approach 5). This module is a few lines and
 * imports no engine: the host engine's code, the runtime and comlink come in
 * one `import()` the first time a host asks, as the Diagram's capture awaits
 * `loadFold()`, and the worker and its Fold wasm only when a resolve starts.
 * Never at file open, on render, on selection or in link status: what a host
 * shows at rest comes from saved data. {@link prefetchLayerOrderHostEngine}
 * loads code ahead of an intent and never spawns a worker. A dialog gateway
 * can share {@link loadLayerOrderHostEngine}, so the dialog and the hosts load
 * the runtime once between them.
 *
 * **Every call answers** a {@link LayerOrderResolution}, never a rejection: a
 * load that fails is a `lost` engine, forgotten, so the next ask loads again.
 * The browser failing to fetch it (offline, a stale deploy) is reported to no
 * one (`engine/layerOrderLoadFailure.ts`); any other failure once.
 *
 * **Stop.** A host runs a resolve inside the fold run it already shows
 * (`withFoldInFlight`'s or `runStepFold`'s work gets the run's stop signal)
 * and passes that signal here: the run's Stop then terminates the resolve's
 * worker too, and the resolve answers `cancelled`.
 */
import type { LayerOrderLimits } from '../engine/layerOrderEngine';
import { isLayerOrderLoadFailure } from '../engine/layerOrderLoadFailure';
import type { LayerOrderRecord } from '../../lib/layerOrder/layerOrderRecord';
import type { LayerOrderSource } from '../../lib/layerOrder/layerOrderRequest';
import { lazyModule } from '../../lib/lazyModule';
import { reportError } from '../../monitoring';
import type * as HostEngine from './layerOrderHostEngine';
import type {
  LayerOrderResolveBatch,
  LayerOrderResolveBatchOptions,
  LayerOrderResolveOptions,
  LayerOrderSolutionCursor,
  LayerOrderSolutionCursorOptions,
  LayerOrderSolutionPlace,
  LayerOrderSolutionStep,
  LayerOrderSolutionStepOptions,
  LayerOrderSolutionsUnrestored,
} from './layerOrderHostEngine';
import { LAYER_ORDER_CANCELLED, lostLayerOrder, type LayerOrderResolution } from './layerOrderResolution';

export type { LayerOrderResolveBatch, LayerOrderResolveBatchOptions, LayerOrderResolveOptions };
export type {
  LayerOrderSolutionCursor,
  LayerOrderSolutionCursorOptions,
  LayerOrderSolutionPlace,
  LayerOrderSolutionStep,
  LayerOrderSolutionStepOptions,
  LayerOrderSolutionsUnrestored,
};
export type {
  LayerOrderFound,
  LayerOrderKept,
  LayerOrderLossCause,
  LayerOrderResolution,
} from './layerOrderResolution';

export type LayerOrderHostEngine = typeof HostEngine;

// A plain `import()`: a press must not reload the page under the user's work,
// offline or not; its failure is a `lost` engine with the cause `load`, whose
// toast offers the user's own Reload (`layerOrderLoadFailure.ts`).
const hostEngine = lazyModule<LayerOrderHostEngine>(() => import('./layerOrderHostEngine'), { reload: false });

/**
 * Load the host engine's code, once, whoever asks; a failed load is forgotten,
 * though a browser that keeps a module's failure answers the next ask the same
 * (`layerOrderReloadAction`). Spawns nothing.
 */
export function loadLayerOrderHostEngine(): Promise<LayerOrderHostEngine> {
  return hostEngine.load();
}

/** Ask for the code ahead of a use (a menu opening, a hover), with nothing to report if it fails: the use does. */
export function prefetchLayerOrderHostEngine(): void {
  void hostEngine.load().catch(() => undefined);
}

/**
 * A batch of resolves on one worker: a Refresh All's. Opening it loads
 * nothing; its first resolve loads the code and spawns the worker. Close it
 * when the last resolve has answered.
 */
export function openLayerOrderResolveBatch(options: LayerOrderResolveBatchOptions = {}): LayerOrderResolveBatch {
  let closed = false;
  let batch: LayerOrderResolveBatch | null = null;
  let opening: Promise<LayerOrderResolveBatch | null> | null = null;

  const open = (): Promise<LayerOrderResolveBatch | null> => {
    opening ??= hostEngine.load().then((engine) => {
      if (closed) return null;
      batch = engine.createLayerOrderResolveBatch(options);
      return batch;
    });
    return opening;
  };

  return {
    async resolve(source, record, limits, more = {}) {
      const stopped = () => closed || !!options.signal?.aborted || !!more.signal?.aborted;
      if (stopped()) return LAYER_ORDER_CANCELLED;
      let opened: LayerOrderResolveBatch | null;
      try {
        opened = await open();
      } catch (error) {
        // Forgotten, so the next resolve loads again. A load the browser failed (offline) is
        // reported to no one (`engine/layerOrderLoadFailure.ts`); anything else once per resolve.
        opening = null;
        if (stopped()) return LAYER_ORDER_CANCELLED;
        if (isLayerOrderLoadFailure(error)) return lostLayerOrder('load', record);
        reportError(error, { surface: 'layer-order:host', tags: { cause: 'unavailable' } });
        return lostLayerOrder('unavailable', record);
      }
      if (!opened) return LAYER_ORDER_CANCELLED;
      return opened.resolve(source, record, limits, more);
    },
    close() {
      closed = true;
      batch?.close();
    },
  };
}

/**
 * Restore `record` (its points in the crease pattern's coordinates, through
 * the host's `PaperFrame`) onto `source`, the fold the host's kernel just
 * made, within `limits` (`LAYER_ORDER_LIMITS.restore` when left out), on a
 * worker spawned for this resolve and terminated when it answers.
 */
export async function resolveLayerOrder(
  source: LayerOrderSource,
  record: LayerOrderRecord,
  limits?: LayerOrderLimits,
  options: LayerOrderResolveOptions = {}
): Promise<LayerOrderResolution> {
  const batch = openLayerOrderResolveBatch();
  try {
    return await batch.resolve(source, record, limits, options);
  } finally {
    batch.close();
  }
}

/**
 * A cursor through the solutions that fit `record` on `source` (H6,
 * `layerOrderSolutionCursor.ts`), for a host's Another solution and its ‹ ›
 * on a constrained figure. Opening it loads nothing and spawns nothing: its
 * first step loads the code, spawns its worker and restores the record, and
 * the worker stays for the next press until the cursor is closed. A load that
 * fails is a `lost` step (`load` when the browser failed to fetch it), and
 * the next step loads again.
 */
export function openLayerOrderSolutionCursor(
  source: LayerOrderSource,
  record: LayerOrderRecord,
  options: LayerOrderSolutionCursorOptions = {}
): LayerOrderSolutionCursor {
  let closed = false;
  let cursor: LayerOrderSolutionCursor | null = null;
  let opening: Promise<LayerOrderSolutionCursor | null> | null = null;

  const open = (): Promise<LayerOrderSolutionCursor | null> => {
    opening ??= hostEngine.load().then((engine) => {
      if (closed) return null;
      cursor = engine.createLayerOrderSolutionCursor(source, record, options);
      return cursor;
    });
    return opening;
  };

  return {
    async step(direction, by, more = {}): Promise<LayerOrderSolutionStep> {
      const stopped = () => closed || !!more.signal?.aborted;
      if (stopped()) return { outcome: 'cancelled' };
      let opened: LayerOrderSolutionCursor | null;
      try {
        opened = await open();
      } catch (error) {
        // Forgotten, so the next step loads again; reported as a resolve's failed load is.
        opening = null;
        if (stopped()) return { outcome: 'cancelled' };
        if (isLayerOrderLoadFailure(error)) return { outcome: 'lost', cause: 'load' };
        reportError(error, { surface: 'layer-order:host', tags: { cause: 'unavailable' } });
        return { outcome: 'lost', cause: 'unavailable' };
      }
      if (!opened) return { outcome: 'cancelled' };
      return opened.step(direction, by, more);
    },
    place: async (by): Promise<LayerOrderSolutionPlace | null> => (cursor && !closed ? cursor.place(by) : null),
    alive: () => !closed && (cursor?.alive() ?? true),
    close() {
      closed = true;
      cursor?.close();
    },
  };
}

export function resetLayerOrderHostEngineForTest(): void {
  hostEngine.resetForTest();
}
