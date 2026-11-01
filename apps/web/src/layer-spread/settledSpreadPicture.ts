/**
 * A one-shot spread picture, settled: what a surface that draws a spread once
 * and keeps it — a Fold card, a Diagram step's capture, the crease-pattern
 * export's folded figure, the share card, a folded figure's own Export… —
 * makes of a fold's paper scene and a spread
 * (`implementation-plans/spread-and-layer-order-in-edit-export-share.md`, §2).
 *
 * Its stages, in order, each one shared:
 *
 * 1. **The solve.** A Default spread needs its fold's heights: prepared here
 *    (`prepareConnected`, one lease, let go when the picture settles or the
 *    signal aborts), unless the host already holds them. Affine and Depth need
 *    none, and are a picture at once.
 * 2. **The live scene**, built by the host in its own frame (`live`): the frame
 *    is where the reveal points, so it stays the host's — the Fold pane's,
 *    a step's turned capture frame, the export's page.
 * 3. **The capture** ({@link captureSpreadScene}): the exact vector clip, in a
 *    worker. One too complex to clip, or not clipped in time, comes back as it
 *    went in, and is never painted in painter's order.
 * 4. **The bitmap** ({@link rasterSpreadScene}) of a capture that did not
 *    resolve: 300 dpi, through the live renderer's visibility, in the pens a
 *    policy reads (`raster.worker.ts`).
 *
 * A spread that cannot be prepared, solved, clipped or drawn settles flat,
 * with why ({@link SettledSpreadPicture}): the host shows its figure unspread
 * and says so, so its preview and its file agree. Only the signal aborting
 * rejects, with an `AbortError`.
 *
 * A host whose capture and bitmap happen in different places — the Diagram
 * captures a step headless and keeps a bitmap in the store's pens
 * (`keptPicture`) — calls the stages it needs.
 */
import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PaperScene } from '../lib/paper/paperScene';
import type { PaperStyle } from '../lib/paper/paperStyle';
import type { PaperSurface } from '../lib/paper/paperStyleResolve';
import { captureConnected } from './captureConnected';
import { hasConnectedDrawing, type ConnectedPaperScene, type PreparedConnectedSpread } from './connectedScene';
import { prepareConnected } from './prepareConnected';
import { rasterConnected, type SpreadRaster } from './rasterConnected';

/** The pens and size a bitmap of a spread is drawn in. */
export interface SpreadRasterPens {
  /** The style it is painted in, as the vector picture would be. */
  readonly style: PaperStyle;
  /** The surface whose policy reads the style's pens: the vector picture's, so the two agree. */
  readonly policy: PaperSurface;
  /**
   * The picture's longer side on the page, mm: at 300 dpi, how many pixels it
   * gets. Asked of the scene drawn, for a host whose page size depends on how
   * far the layers reach.
   */
  readonly mm: number | ((scene: ConnectedPaperScene) => number);
}

/** A live scene after its capture: clipped, or too complex to clip in time. */
export type SpreadCapture =
  | { readonly kind: 'scene'; readonly scene: PaperScene }
  | { readonly kind: 'over-budget'; readonly scene: ConnectedPaperScene };

/** A bitmap of a spread, and where it lies in the scene it was drawn from. */
export interface SpreadRasterPicture {
  readonly kind: 'raster';
  readonly raster: SpreadRaster;
  /** The image's rectangle in the scene's coordinates, `[x, y, width, height]`: `raster.sceneFrame`. */
  readonly frame: readonly [number, number, number, number];
  /** The scene it was drawn from, still unresolved: what another style draws again, with no new capture. */
  readonly scene: ConnectedPaperScene;
}

/**
 * A spread picture as it settled: a scene to paint, a bitmap to place, or no
 * spread at all — the figure is drawn flat — with the reason, and what was
 * thrown, for a host that reports it.
 */
export type SettledSpreadPicture =
  | { readonly kind: 'scene'; readonly scene: PaperScene }
  | SpreadRasterPicture
  | { readonly kind: 'flat'; readonly reason: string; readonly cause: unknown };

export interface SettledSpreadOptions {
  /**
   * The host's live scene: the fold's paper scene in the host's frame, spread
   * by the solve (null for Affine and Depth, which need none).
   */
  readonly live: (prepared: PreparedConnectedSpread | null) => PaperScene;
  /** The bitmap a capture that does not resolve falls back to. */
  readonly raster: SpreadRasterPens;
  readonly signal?: AbortSignal;
  /** The solve, when the host holds it already (its own lease); else it is prepared here. */
  readonly prepared?: PreparedConnectedSpread | null;
  /** The scene is the Fold engine's, y up (`prepareConnected`). */
  readonly yUp?: boolean;
  /** The solve's priority: 1 for a picture someone is waiting on, 0 for one in a queue. */
  readonly priority?: number;
}

function abortError(): DOMException {
  return new DOMException('The spread picture is no longer wanted', 'AbortError');
}

function flat(cause: unknown): SettledSpreadPicture {
  return { kind: 'flat', reason: cause instanceof Error ? cause.message : String(cause), cause };
}

/**
 * Stage 3: the exact vector clip of a live scene, in a worker; a scene with
 * nothing to clip comes back as it is. One the worker could not clip within
 * its budget or its time comes back unresolved, as `over-budget`.
 */
export async function captureSpreadScene(live: PaperScene, signal?: AbortSignal): Promise<SpreadCapture> {
  const resolved = hasConnectedDrawing(live) ? await captureConnected(live, signal) : live;
  return hasConnectedDrawing(resolved) ? { kind: 'over-budget', scene: resolved } : { kind: 'scene', scene: resolved };
}

/** Stage 4: a 300 dpi bitmap of an unresolved scene, drawn with the live renderer's visibility in `pens`. */
export async function rasterSpreadScene(
  scene: ConnectedPaperScene,
  pens: SpreadRasterPens,
  signal?: AbortSignal
): Promise<SpreadRasterPicture> {
  const mm = typeof pens.mm === 'function' ? pens.mm(scene) : pens.mm;
  const raster = await rasterConnected(scene, pens.style, mm, signal, pens.policy);
  return { kind: 'raster', raster, frame: raster.sceneFrame, scene };
}

/** Every stage, for a host that settles the whole picture at once. */
export async function settledSpreadPicture(
  kernel: OristudioCpFoldedPaperScene,
  spread: LayerSpreadOptions,
  options: SettledSpreadOptions
): Promise<SettledSpreadPicture> {
  const { signal } = options;
  if (signal?.aborted) throw abortError();
  if (spread.kind !== 'connected') {
    try {
      return { kind: 'scene', scene: options.live(null) };
    } catch (cause) {
      return flat(cause);
    }
  }
  const lease = options.prepared ? null : prepareConnected(kernel, options.yUp ?? false, options.priority ?? 1);
  const release = () => lease?.release();
  signal?.addEventListener('abort', release, { once: true });
  // A failure once the signal has aborted is the abort's, whatever it says.
  const settle = (cause: unknown): SettledSpreadPicture => {
    if (signal?.aborted) throw abortError();
    return flat(cause);
  };
  try {
    let prepared: PreparedConnectedSpread;
    try {
      prepared = options.prepared ?? (await lease!.promise);
    } catch (cause) {
      return settle(cause);
    }
    if (signal?.aborted) throw abortError();
    let captured: SpreadCapture;
    try {
      captured = await captureSpreadScene(options.live(prepared), signal);
    } catch (cause) {
      return settle(cause);
    }
    if (captured.kind === 'scene') return captured;
    try {
      return await rasterSpreadScene(captured.scene, options.raster, signal);
    } catch (cause) {
      return settle(cause);
    }
  } finally {
    signal?.removeEventListener('abort', release);
    release();
  }
}
