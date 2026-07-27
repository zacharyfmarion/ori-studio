import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import type { Point } from '../../lib/geometry';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  reselectFoldableLineIds,
  type FoldedSourceBounds,
} from '../../lib/foldedFigureStaleness';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { AnnotationBox } from '../annotations/annotationTransform';
import type { TransformableCanvasObject } from '../canvasObjects/transformableObject';
import type { SimulatorOrbitView } from '../../lib/simulatorOrbit';

/**
 * A live simulation of one crease-pattern region, placed on the Edit canvas.
 *
 * The model is split in two on purpose. {@link InlineSimulation} is plain JSON —
 * exactly, and only, what would be written to disk if these ever persist — while
 * everything expensive or unserializable (the fold, load status) lives in a
 * runtime side table keyed by id. Persistence is deliberately not implemented;
 * keeping the split means adding it later is additive rather than a rewrite.
 */
export interface InlineSimulation {
  id: string;
  /** Placement on the canvas, in crease-pattern model space. */
  box: AnnotationBox;
  z: number;
  /** Orbit camera, so a window keeps its viewing angle across a refresh. */
  view: SimulatorOrbitView;
  foldPercent: number;

  /**
   * The region's boundary rings — the durable identity of what is simulated.
   *
   * Not the segment id: `segmentFoldDocument` sorts regions into reading order
   * and reassigns `id = index` on every recompute, so ids renumber whenever an
   * edit adds or removes a region. Not the line ids either, for the same reason
   * — they are indices into `line_segments` and shift when a crease is deleted.
   * Not the bounding box alone either: a concave region's box can wholly contain
   * a separate region sitting in its notch, and concentric regions (a frame
   * around an inner square, routine in box pleating) have near-identical boxes.
   */
  sourceBoundary: Point[][] | null;
  /** Bounding box of the source creases; prefilter, and the reselection key. */
  sourceBounds: FoldedSourceBounds | null;
  /** Digest of that crease set, for the staleness comparison. */
  sourceFingerprint: string | null;
  /**
   * The segment id at creation time. A fast path while the segmentation is
   * unchanged, never the durable reference — see `sourceBoundary`.
   */
  segmentIdHint: number | null;
}

/** Per-window state that is never serialized and never enters the store. */
export interface InlineSimulationRuntime {
  /** The captured segment fold the solver runs. */
  fold: FoldDocument;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

/** Default on-canvas edge, as a fraction of the simulated region's larger side. */
const DEFAULT_SIZE_FACTOR = 0.9;

/**
 * Place a new window over the region it simulates, slightly inset, so it reads
 * as belonging to that part of the pattern rather than floating anywhere.
 */
export function createInlineSimulation(options: {
  id: string;
  segment: CpSegment;
  document: OristudioCpDocumentSnapshot;
  cpLineIds: readonly number[];
  z: number;
  view: SimulatorOrbitView;
}): InlineSimulation {
  const { id, segment, document, cpLineIds, z, view } = options;
  const bounds = foldedSourceBounds(cpLinesByIds(document, cpLineIds));
  // Place from the crease bounds, which are the document's own coordinates by
  // construction, rather than from the segment's — those come from the fold, and
  // a fold that did not originate in this document is in a different space.
  const placement = bounds ?? segment.bounds;
  const width = placement.maxX - placement.minX;
  const height = placement.maxY - placement.minY;
  const edge = Math.max(width, height) * DEFAULT_SIZE_FACTOR;
  return {
    id,
    box: {
      center: {
        x: (placement.minX + placement.maxX) / 2,
        y: (placement.minY + placement.maxY) / 2,
      },
      width: edge,
      height: edge,
      rotation: 0,
    },
    z,
    view,
    foldPercent: 0,
    sourceBoundary: segment.boundary.map((ring) => ring.map((point) => ({ ...point }))),
    sourceBounds: bounds,
    sourceFingerprint: sourceFingerprintFor(document, bounds),
    segmentIdHint: segment.id,
  };
}

/**
 * The fingerprint to record for a region with these bounds.
 *
 * Taken over the **reselected** crease set, not over the ids the window was
 * created from. Those are two differently-derived sets, so fingerprinting the
 * originating ids would make every window read as stale the moment it was
 * created. Mirrors what a folded figure records.
 */
export function sourceFingerprintFor(
  document: OristudioCpDocumentSnapshot | null | undefined,
  bounds: FoldedSourceBounds | null
): string | null {
  if (!document || !bounds) return null;
  return foldedSourceFingerprint(cpLinesByIds(document, reselectFoldableLineIds(document, bounds)));
}

/**
 * Whether the creases this window was built from have changed since.
 *
 * Derived on demand rather than stamped during an edit, so there is no
 * invalidation bookkeeping to get wrong — the same shape `isFoldedFigureStale`
 * uses, and the same primitives.
 *
 * A window with no recorded provenance reports **not** stale: we cannot tell,
 * and offering a refresh we cannot perform is worse than staying quiet.
 *
 * Note the foldable-colour filter is deliberate and shared with folded figures.
 * Aux-coloured creases do reach the simulation mesh — they split faces and
 * become facet creases — but a flat crease across a facet changes the mesh's
 * discretization, not the folded form, and marking a window stale because
 * someone drew a construction line would be pure noise.
 */
export function isInlineSimulationStale(
  document: OristudioCpDocumentSnapshot | null | undefined,
  simulation: InlineSimulation
): boolean {
  if (!document) return false;
  if (simulation.sourceBounds == null || simulation.sourceFingerprint == null) return false;
  const fingerprint = sourceFingerprintFor(document, simulation.sourceBounds);
  return fingerprint !== simulation.sourceFingerprint;
}

/** Squared distance between two points, for the boundary comparison below. */
function distanceSq(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Tolerance for calling two boundary rings the same, in model units. Regions are
 * re-derived from the same coordinates, so a match is normally exact; this only
 * absorbs float noise from the fold round trip.
 */
const BOUNDARY_EPSILON = 1e-6;

/**
 * Whether two rings describe the same closed loop, allowing for a different
 * starting vertex or winding — traversal order is an artifact of how the ring
 * was traced, not of the region.
 */
export function ringsMatch(a: readonly Point[], b: readonly Point[]): boolean {
  if (a.length !== b.length || a.length === 0) return a.length === b.length;
  const n = a.length;
  const epsilon = BOUNDARY_EPSILON * BOUNDARY_EPSILON;
  for (const reversed of [false, true]) {
    const candidate = reversed ? [...b].reverse() : b;
    for (let offset = 0; offset < n; offset += 1) {
      let matched = true;
      for (let i = 0; i < n; i += 1) {
        if (distanceSq(a[i]!, candidate[(i + offset) % n]!) > epsilon) {
          matched = false;
          break;
        }
      }
      if (matched) return true;
    }
  }
  return false;
}

/** Whether two boundaries describe the same region (outer ring plus any holes). */
export function boundariesMatch(a: readonly Point[][], b: readonly Point[][]): boolean {
  if (a.length !== b.length) return false;
  const unmatched = [...b];
  for (const ring of a) {
    const index = unmatched.findIndex((candidate) => ringsMatch(ring, candidate));
    if (index < 0) return false;
    unmatched.splice(index, 1);
  }
  return true;
}

/**
 * Find the segment a window refers to, in a freshly computed segmentation.
 *
 * Boundary match, not nearest-box: returning the closest region when the real
 * one is gone is how a window ends up silently simulating something else. Null
 * means the region genuinely stopped existing — merged, split, or its rim
 * stopped being all-border — which the caller should say rather than paper over.
 *
 * `segmentIdHint` is tried first only as a shortcut, and only when its boundary
 * still matches; it is never trusted on its own.
 */
export function resolveInlineSimulationSegment(
  simulation: InlineSimulation,
  segments: readonly CpSegment[]
): CpSegment | null {
  const boundary = simulation.sourceBoundary;
  if (!boundary) return null;

  const hinted =
    simulation.segmentIdHint === null
      ? undefined
      : segments.find((segment) => segment.id === simulation.segmentIdHint);
  if (hinted && boundariesMatch(boundary, hinted.boundary)) return hinted;

  return segments.find((segment) => boundariesMatch(boundary, segment.boundary)) ?? null;
}

/** A window as the shared selection overlay sees it: a model-space box. */
export function inlineSimulationAsTransformable(
  simulation: InlineSimulation
): TransformableCanvasObject {
  return {
    id: simulation.id,
    space: 'model',
    box: simulation.box,
    locked: false,
    hidden: false,
    // Free resize: a window is a viewport onto the fold, not a picture of it, so
    // there is no proportion to preserve. Shift locks it, as elsewhere.
    aspectLock: 'default-off',
  };
}

/** The highest z across the windows, or 0 when there are none. */
export function topInlineSimulationZ(simulations: readonly InlineSimulation[]): number {
  return simulations.reduce((max, simulation) => Math.max(max, simulation.z), 0);
}
