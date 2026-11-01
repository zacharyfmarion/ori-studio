/**
 * The CP kernel's fold calls, as a host makes them: fold some creases, step
 * to a later solution, read the picture, say what a fold was made from, fold
 * again with a given layer order, free the figure. Injected wherever a fold
 * happens (an export preview, a Diagram capture, the Layer order dialog's
 * hosts), so those modules stay free of the wasm runtime — the store supplies
 * the real bindings (`cpFoldRuntimeBindings.ts`) and tests supply fakes.
 *
 * Moved here from `creaseExportFold.ts`, which re-exports it, so the shared
 * layer-order fold (`layerOrder/layerOrderFold.ts`) and the export can both
 * build on it.
 */
import type {
  OristudioCpFoldOrderRefusal,
  OristudioCpFoldOutcome,
  OristudioCpFoldSource,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';

/**
 * The kernel calls an export needs to fold a pattern. Injected so this module
 * stays free of the wasm runtime — the store supplies the real bindings and
 * tests supply fakes.
 */
export interface CreaseExportFoldRuntime {
  fold: (
    startingFaceId: number,
    order: 'Order5',
    model: OristudioCpFoldedFigureModel | undefined,
    lineIds: number[]
  ) => Promise<FoldedFigureState>;
  /** Advance the figure to a later layer-ordering solution. */
  foldToCase: (handle: number, objective: number) => Promise<Omit<FoldedFigureState, 'handle'>>;
  renderSnapshot: (
    handle: number,
    displayStyle: OristudioCpFoldedFigureDisplayStyle
  ) => Promise<OristudioCpFoldedRenderSnapshot | null>;
  /**
   * The kernel's paper scene for the figure — every face's folded outline and
   * every subface's stack — or null when it has no paper picture to give.
   */
  paperScene: (handle: number) => Promise<OristudioCpFoldedPaperScene | null>;
  free: (handle: number) => Promise<void>;
}

/**
 * A fold the caller holds on to and works with, rather than one read and freed
 * at once: the Diagram's capture session turns it over and steps through its
 * solutions on the same handle (D4).
 */
export interface CpFoldRuntime extends CreaseExportFoldRuntime {
  /** Put the figure in a new model (a side, a colour) without folding it again. */
  setModel: (
    handle: number,
    model: OristudioCpFoldedFigureModel
  ) => Promise<Omit<FoldedFigureState, 'handle'>>;
  /** The next layer-ordering solution, on the same handle. */
  foldAnother: (handle: number) => Promise<Omit<FoldedFigureState, 'handle'>>;
  /**
   * What the fold behind `handle` was made from, for the Layer order dialog.
   * Optional: only a runtime over the CP kernel has one.
   */
  source?: (handle: number) => Promise<OristudioCpFoldSource>;
  /**
   * Fold `source` again with `relations` given (flat `[upper, lower]` face
   * pairs), into a **new** handle; a refusal leaves none. How a host shows a
   * chosen layer order (the Diagram's capture, among others): never a change
   * to the handle it already holds.
   */
  foldWithOrder?: (
    source: OristudioCpFoldSource,
    relations: Uint32Array,
    model: OristudioCpFoldedFigureModel | undefined
  ) => Promise<FoldWithOrderOutcome>;
}

/** A fold with a given layer order: the new figure, or why there is none. */
export type FoldWithOrderOutcome =
  | ({ status: 'folded' } & FoldedFigureState)
  | { status: 'refused'; refusal: OristudioCpFoldOrderRefusal };

/** What a fold (or a jump to another case) leaves the figure in. */
export interface FoldedFigureState {
  handle: number;
  discoveredCases: number;
  /**
   * The style the estimate actually reached. The kernel downgrades this when it
   * cannot order the layers — a dense pattern often concludes at `Transparent3`
   * — and rendering the figure as `Paper5` regardless comes back empty, which
   * is how a real crease pattern ended up reported as "nothing to draw".
   */
  displayStyle: OristudioCpFoldedFigureDisplayStyle;
  /**
   * Whether the layers were ordered (`Solved`), shown to have no order
   * (`NoSolutions`, `Contradiction`), or not tried. Absent from a kernel that
   * predates it.
   */
  outcome?: OristudioCpFoldOutcome;
  /** The 1-based solution being shown, when the runtime reports it. */
  currentCase?: number;
  /** Whether another solution can be searched for without starting over. */
  hasNext?: boolean;
}

/** A fold's picture as the kernel draws it: its primitives, and its paper scene when it has one. */
export interface FoldedPicture {
  snapshot: OristudioCpFoldedRenderSnapshot;
  /** The `Paper5` paper scene; null for a fold that did not reach it. */
  scene: OristudioCpFoldedPaperScene | null;
}

/** A requested Order5 can stop at an earlier stage without throwing. */
export function hasFoldedLayerOrder(state: Omit<FoldedFigureState, 'handle'>): boolean {
  return state.displayStyle === 'Paper5' && state.discoveredCases > 0 &&
    (state.outcome === undefined || state.outcome === 'Solved');
}

/**
 * Fold a set of crease-pattern lines, and hand the figure to the caller, who
 * owns its handle from here and frees it (`runtime.free`).
 */
export async function openFold(
  runtime: CreaseExportFoldRuntime,
  lineIds: number[],
  model?: OristudioCpFoldedFigureModel
): Promise<FoldedFigureState> {
  if (lineIds.length === 0) {
    throw new Error('This crease pattern has no foldable creases');
  }
  return runtime.fold(1, 'Order5', model, lineIds);
}

/**
 * Read a held figure's picture at the style its fold reached: the drawing
 * primitives, and the paper scene when it is a `Paper5` figure. A fold the
 * kernel downgraded has no layer ordering, and its transparent development is
 * the snapshot alone.
 */
export async function readFoldedPicture(
  runtime: CreaseExportFoldRuntime,
  handle: number,
  displayStyle: OristudioCpFoldedFigureDisplayStyle
): Promise<FoldedPicture> {
  const snapshot = await runtime.renderSnapshot(handle, displayStyle);
  if (!snapshot?.primitives.length) {
    throw new Error('The folded figure produced nothing to draw');
  }
  const scene = displayStyle === 'Paper5' ? await runtime.paperScene(handle) : null;
  return { snapshot, scene };
}
