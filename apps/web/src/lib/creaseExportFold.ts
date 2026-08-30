import type {
  OristudioCpDocumentSnapshot,
  OristudioCpFoldedFigureDisplayStyle,
  OristudioCpFoldedFigureModel,
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
  free: (handle: number) => Promise<void>;
}

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
}

export interface CreaseExportFoldResult {
  snapshot: OristudioCpFoldedRenderSnapshot;
  /** How many layer-ordering solutions the kernel has found so far. */
  discoveredCases: number;
  /** Places the figure's kernel coordinates in the exported fold's space. */
  transform: CpModelToFoldTransform;
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

/**
 * Fold one crease pattern and return its drawing primitives.
 *
 * Deliberately ephemeral: the figure never becomes a canvas entry, so exporting
 * adds nothing to the document, the undo stack, or the dirty flag — and the
 * kernel handle is freed whether or not the render succeeds.
 */
export async function foldSegmentForExport(
  runtime: CreaseExportFoldRuntime,
  document: OristudioCpDocumentSnapshot,
  segment: CpSegment | null,
  model?: OristudioCpFoldedFigureModel,
  foldCase = 1,
  transform: CpModelToFoldTransform = IDENTITY_CP_MODEL_TO_FOLD
): Promise<CreaseExportFoldResult> {
  const lineIds = foldableLineIdsForSegment(document, segment, transform);
  if (lineIds.length === 0) {
    throw new Error('This crease pattern has no foldable creases');
  }

  const folded = await runtime.fold(1, 'Order5', model, lineIds);
  const handle = folded.handle;
  try {
    // Case 1 is what the fold already produced; later cases are reached by
    // asking the kernel to keep searching from the same handle.
    let { discoveredCases, displayStyle } = folded;
    if (foldCase > 1) {
      ({ discoveredCases, displayStyle } = await runtime.foldToCase(handle, foldCase));
    }
    const snapshot = await runtime.renderSnapshot(handle, displayStyle);
    if (!snapshot?.primitives.length) {
      throw new Error('The folded figure produced nothing to draw');
    }
    return { snapshot, discoveredCases: Math.max(1, discoveredCases), transform };
  } finally {
    await runtime.free(handle);
  }
}
