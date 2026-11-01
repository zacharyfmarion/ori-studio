import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureModel,
  OristudioCpFoldedPaperScene,
  OristudioCpFoldedRenderSnapshot,
} from '../engine/oristudioCpTypes';
import type { FoldDocument } from '../engine/types';
import type { Point } from './geometry';
import {
  isOrieditaFoldableLineColor,
  selectedFoldableCpLineIds,
} from './creasePatternClipboard';
import { emptyOristudioCpSelection } from './creasePatternViewport';
import {
  buildSegmentFold,
  flatPlaneReader,
  pointInSegment,
  pointOnSegmentBoundary,
  type CpSegment,
} from './creasePatternSegmentation';
import {
  hasFoldedLayerOrder,
  openFold,
  readFoldedPicture,
  type CpFoldRuntime,
  type CreaseExportFoldRuntime,
  type FoldedFigureState,
} from './cpFoldRuntime';
import { foldAppliedOrder } from './layerOrder/layerOrderFold';
import type { LayerOrderApplied, LayerOrderSource } from './layerOrder/layerOrderRequest';
import { layerOrderSourceOf } from './layerOrder/layerOrderSource';
import { EDIT_PAPER_FRAME } from './layerOrder/paperFrame';

// The kernel's fold calls, which lived here before the Layer order hosts
// shared them (`cpFoldRuntime.ts`); every importer still finds them here.
export {
  hasFoldedLayerOrder,
  openFold,
  readFoldedPicture,
  type CpFoldRuntime,
  type CreaseExportFoldRuntime,
  type FoldWithOrderOutcome,
  type FoldedFigureState,
  type FoldedPicture,
} from './cpFoldRuntime';

export interface CreaseExportFoldResult {
  snapshot: OristudioCpFoldedRenderSnapshot;
  /**
   * The same fold as the kernel's paper scene, which the export paints through
   * the shared painter with every layer in it; null when the fold did not
   * reach `Paper5` or the kernel has no paper picture for it, and the export
   * draws `snapshot` as it did before there was a scene.
   */
  scene: OristudioCpFoldedPaperScene | null;
  /** How many layer-ordering solutions the kernel has found so far. */
  discoveredCases: number;
  /** Places the figure's kernel coordinates in the exported fold's space. */
  transform: CpModelToFoldTransform;
  /**
   * What the fold was made from, read from it before its handle was freed:
   * the Layer order dialog's source (`LayerOrderRequest.source`), and the key
   * a chosen order is kept by (its digest). Absent from a runtime that cannot
   * say, or a fold made with no model.
   */
  source?: LayerOrderSource | null;
  /**
   * Where the fold stands among its layer orders, for the Layer order row's
   * readout (`layerOrderCount`): the solution shown, 1-based, and whether the
   * search may find another. Absent from a runtime that does not report them.
   */
  currentCase?: number;
  hasNext?: boolean;
  /**
   * Whether the fold put its layers in order (D3): false for a fold the
   * kernel left as its see-through development, which has no layer order to
   * step through or choose. Absent from a runtime that does not report it.
   */
  ordered?: boolean;
  /**
   * The fold is in a layer order chosen in the Layer order dialog
   * ({@link foldSegmentInOrderForExport}), not the kernel's own at a case.
   */
  chosenOrder?: boolean;
}

/**
 * Tolerance for calling a fold angle flat. Angles reach FOLD via degrees that have been
 * through the kernel's own unit conversion, so exact equality would misreport a 180°
 * crease that arrived as 179.9999999.
 */
const FLAT_ANGLE_EPSILON = 1e-6;

/**
 * Whether a FOLD fold angle is a full ±180 fold — the kernel's classic crease.
 *
 * The epsilon is the whole point. A classic crease reaches FOLD through the
 * kernel's unit conversion and can arrive as `179.9999999`; exact equality reads
 * that as a 179.9999999° partial fold, which is the difference between "draw
 * this crease normally" and "fade every crease in the document".
 */
export function isClassicFoldAngle(angle: number): boolean {
  return Math.abs(Math.abs(angle) - 180) < FLAT_ANGLE_EPSILON;
}

function isFlatAngle(angle: number): boolean {
  return Math.abs(angle) < FLAT_ANGLE_EPSILON || isClassicFoldAngle(angle);
}

/**
 * Whether every crease in `fold` is flat — 0° or ±180° — and the pattern can therefore
 * be folded into a figure at all.
 *
 * The layer-order solver assumes a flat-folded model: every face lands in a plane and
 * ordering them is the whole problem. A crease at any other angle puts faces in 3D, where
 * the solver's adjacency reasoning does not hold, and it fails with an internal
 * complaint — `WorkerOverlap(InitialHierarchy(SameParityAdjacentFaces { ... }))` — that
 * describes its own data structures rather than the user's document.
 *
 * So this gates the folded-figure controls rather than letting them fail: an option that
 * cannot work should not be offered, and "this pattern has partial folds" is a fact the
 * UI can state before anyone clicks.
 *
 * `segment` narrows the check to one pattern, matching what the dialogs actually fold —
 * a partial fold elsewhere in the document must not disable folding for a region that is
 * perfectly flat.
 */
export function isFlatFoldableFold(fold: FoldDocument, segment?: CpSegment | null): boolean {
  // Scoping goes through `buildSegmentFold` rather than a second face-to-edge derivation:
  // it is the same sub-fold the folder is handed, so the check cannot disagree with what
  // is actually folded.
  const scoped = segment ? buildSegmentFold(fold, segment) : fold;
  const angles = scoped.edges_foldAngle;
  if (!angles) return true;
  return angles.every((angle) => angle === null || angle === undefined || isFlatAngle(angle));
}

/**
 * Whether any crease in `fold` folds to something other than a full ±180 — the question
 * "is there a fold angle here worth encoding".
 *
 * **Not the negation of {@link isFlatFoldableFold}**, and the gap is deliberate. That one
 * asks whether the layer-order solver can run, so it counts 0° as flat: an unfolded crease
 * leaves every face in the plane. This one asks what the ink has to say, and a 0° mountain
 * is emphatically not a full fold — the canvas draws it at the ramp's anchor, or at the
 * opacity floor. Gating the export's fold-angle control on flat-foldability would hide it
 * for a document made entirely of 0° creases and then draw them faded anyway.
 *
 * Only `M` and `V` are asked. `B` and `F` carry an angle of 0 by construction (see
 * `defaultFoldAngle` in `creasePatternImport.ts`, and the kernel writes 0 for borders), so
 * reading the angle alone would call every bordered pattern non-classic.
 */
export function hasNonClassicCreases(fold: FoldDocument, segment?: CpSegment | null): boolean {
  const scoped = segment ? buildSegmentFold(fold, segment) : fold;
  const angles = scoped.edges_foldAngle;
  if (!angles) return false;
  const assignments = scoped.edges_assignment ?? [];
  return angles.some((angle, index) => {
    const assignment = assignments[index];
    if (assignment !== 'M' && assignment !== 'V') return false;
    // An absent angle is a classic crease, matching `foldAngleFromParts`, which reads an
    // absent magnitude as a full ±180 fold.
    if (typeof angle !== 'number' || !Number.isFinite(angle)) return false;
    return !isClassicFoldAngle(angle);
  });
}

/**
 * Similarity transform from the kernel's crease-pattern coordinates to the
 * coordinates of the fold an export is working from.
 *
 * The two are usually the same space — a fold exported from the kernel keeps
 * its coordinates. They are *not* the same when the fold came from the import
 * pipeline, which rescales every point into the unit square: opening a file and
 * exporting straight away hands the dialog that imported fold, so segment
 * bounds are in [0,1] while the document's creases are in file coordinates.
 * Comparing the two without this transform attributes no crease to any pattern.
 */
export interface CpModelToFoldTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export const IDENTITY_CP_MODEL_TO_FOLD: CpModelToFoldTransform = {
  scale: 1,
  offsetX: 0,
  offsetY: 0,
};

export function applyCpModelToFold(point: Point, transform: CpModelToFoldTransform): Point {
  return {
    x: point.x * transform.scale + transform.offsetX,
    y: point.y * transform.scale + transform.offsetY,
  };
}

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boundsOf(points: readonly Point[]): Bounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  return Number.isFinite(minX) ? { minX, minY, maxX, maxY } : null;
}

/**
 * Fit the document's creases onto the fold's vertices.
 *
 * The import pipeline's rescale is a uniform scale about the centre, so fitting
 * the larger span and aligning centres recovers it exactly — and returns the
 * identity when the fold already carries kernel coordinates. Only foldable
 * creases are measured: auxiliary lines never reach the exported fold, and
 * including them would stretch the fit.
 */
export function cpModelToFoldTransform(
  fold: FoldDocument,
  document: OristudioCpDocumentSnapshot
): CpModelToFoldTransform {
  const readPoint = flatPlaneReader(fold);
  const foldBounds = boundsOf((fold.vertices_coords ?? []).map(readPoint));
  const modelBounds = boundsOf(
    document.crease_pattern.line_segments
      .filter((line) => isOrieditaFoldableLineColor(line.color))
      .flatMap((line) => [line.a, line.b])
  );
  if (!foldBounds || !modelBounds) return IDENTITY_CP_MODEL_TO_FOLD;

  const modelSpan = Math.max(
    modelBounds.maxX - modelBounds.minX,
    modelBounds.maxY - modelBounds.minY
  );
  const foldSpan = Math.max(foldBounds.maxX - foldBounds.minX, foldBounds.maxY - foldBounds.minY);
  if (modelSpan <= 0 || foldSpan <= 0) return IDENTITY_CP_MODEL_TO_FOLD;

  const scale = foldSpan / modelSpan;
  const modelCenterX = (modelBounds.minX + modelBounds.maxX) / 2;
  const modelCenterY = (modelBounds.minY + modelBounds.maxY) / 2;
  const foldCenterX = (foldBounds.minX + foldBounds.maxX) / 2;
  const foldCenterY = (foldBounds.minY + foldBounds.maxY) / 2;
  return {
    scale,
    offsetX: foldCenterX - modelCenterX * scale,
    offsetY: foldCenterY - modelCenterY * scale,
  };
}

/**
 * Crease-pattern line ids belonging to `segment`, or every foldable line when
 * the whole document is exported.
 *
 * Segments are measured in the exported fold's space, so each crease midpoint
 * is mapped there before the containment test — see
 * {@link CpModelToFoldTransform} for why the two spaces can differ.
 */
export function foldableLineIdsForSegment(
  document: OristudioCpDocumentSnapshot,
  segment: CpSegment | null,
  transform: CpModelToFoldTransform = IDENTITY_CP_MODEL_TO_FOLD
): number[] {
  const lines = document.crease_pattern.line_segments;
  const candidates: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line) continue;
    if (segment) {
      const midpoint = applyCpModelToFold(
        { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 },
        transform
      );
      // A border crease lies *on* the boundary, where the inside test is
      // undefined — so it counts as belonging to the pattern it bounds.
      if (!pointInSegment(segment, midpoint) && !pointOnSegmentBoundary(segment, midpoint)) {
        continue;
      }
    }
    // Crease ids are 1-based.
    candidates.push(index + 1);
  }
  return selectedFoldableCpLineIds(document, {
    ...emptyOristudioCpSelection(),
    lines: candidates,
  });
}

/** The runtime an export folds with: the kernel's flat calls, and what a fold was made from when it can say. */
export type CreaseExportFoldWith = CreaseExportFoldRuntime & Pick<CpFoldRuntime, 'source'>;

/** Where a fold stands among its layer orders, as the export's result says it. */
function solutionsOf(state: Omit<FoldedFigureState, 'handle'>, foldCase: number) {
  return {
    discoveredCases: Math.max(1, state.discoveredCases),
    currentCase: state.currentCase ?? foldCase,
    hasNext: state.hasNext ?? false,
    ordered: hasFoldedLayerOrder(state),
  };
}

/**
 * Fold one crease pattern and return its drawing primitives and its paper
 * scene: {@link openFold}, then {@link readFoldedPicture}, then free. With a
 * runtime that can say what the fold was made from, its source too, read
 * before the free, for the Layer order dialog: the dialog's faces are then
 * this fold's (approach 2), and it is the source a chosen order folds again
 * ({@link foldSegmentInOrderForExport}).
 *
 * Deliberately ephemeral: the figure never becomes a canvas entry, so exporting
 * adds nothing to the document, the undo stack, or the dirty flag — and the
 * kernel handle is freed whether or not the render succeeds.
 */
export async function foldSegmentForExport(
  runtime: CreaseExportFoldWith,
  document: OristudioCpDocumentSnapshot,
  segment: CpSegment | null,
  model?: OristudioCpFoldedFigureModel,
  foldCase = 1,
  transform: CpModelToFoldTransform = IDENTITY_CP_MODEL_TO_FOLD
): Promise<CreaseExportFoldResult> {
  const folded = await openFold(runtime, foldableLineIdsForSegment(document, segment, transform), model);
  const handle = folded.handle;
  try {
    // Case 1 is what the fold already produced; later cases are reached by
    // asking the kernel to keep searching from the same handle.
    const state = foldCase > 1 ? await runtime.foldToCase(handle, foldCase) : folded;
    const { snapshot, scene } = await readFoldedPicture(runtime, handle, state.displayStyle);
    // A fold's source is the same at every case.
    const kernel = runtime.source && model ? await runtime.source(handle) : null;
    return {
      snapshot,
      scene,
      transform,
      ...solutionsOf(state, foldCase),
      source: kernel && model ? layerOrderSourceOf(kernel, model) : null,
    };
  } finally {
    await runtime.free(handle);
  }
}

/**
 * A fold in a chosen layer order: the export's figure in it, or why the
 * kernel would not draw it. A refusal leaves no figure, and the caller keeps
 * the picture it had.
 */
export type CreaseExportOrderedFold =
  | { readonly status: 'folded'; readonly result: CreaseExportFoldResult }
  | { readonly status: 'refused' };

/**
 * Fold an export's figure in an order chosen in the Layer order dialog:
 * `order.relations` on `order.source`, exactly the fold the dialog analysed
 * ({@link foldAppliedOrder}, the Diagram's too), into a new figure, then
 * {@link readFoldedPicture}, then free. `model` is the one the export folds
 * with now — the relations name faces from the starting face's front, so a
 * side or a colour changed since the Apply refolds with the same order.
 *
 * Ephemeral as {@link foldSegmentForExport} is. The record stays in the crease
 * pattern's coordinates (Edit's frame): it is only ever handed back to the
 * dialog.
 */
export async function foldSegmentInOrderForExport(
  runtime: CpFoldRuntime,
  order: LayerOrderApplied,
  model: OristudioCpFoldedFigureModel,
  transform: CpModelToFoldTransform = IDENTITY_CP_MODEL_TO_FOLD
): Promise<CreaseExportOrderedFold> {
  const shown = await foldAppliedOrder(runtime, order, model, EDIT_PAPER_FRAME);
  if (shown.kind === 'kept') return { status: 'refused' };
  const { state } = shown;
  try {
    const { snapshot, scene } = await readFoldedPicture(runtime, state.handle, state.displayStyle);
    return {
      status: 'folded',
      result: { snapshot, scene, transform, ...solutionsOf(state, 1), source: order.source, chosenOrder: true },
    };
  } finally {
    await runtime.free(state.handle);
  }
}
