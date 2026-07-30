import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import type { Point } from '../../lib/geometry';
import {
  cpLinesByIds,
  foldedSourceBounds,
  foldedSourceFingerprint,
  reselectFoldableLineIds,
  type FoldedSourceBounds,
} from '../folded/foldedFigureStaleness';
import type { CpSegment } from '../../lib/creasePatternSegmentation';
import type { AnnotationBox } from '../annotations/annotationTransform';
import type { Aabb } from '../picking/lineHitIndex';
import { CANVAS_OBJECT_GAP, firstFreeSlotBeside } from '../canvasObjects/placeBesideCp';
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
/**
 * Why opening a window did or did not happen.
 *
 * A boolean was not enough: refusing at the cap is a normal outcome the user
 * should be told about, and it needs to be told apart from "this region cannot
 * be simulated", which is not worth interrupting anyone for.
 */
export type AddInlineSimulationResult = 'added' | 'at-capacity' | 'unavailable';

export interface InlineSimulation {
  id: string;
  /** Placement on the canvas, in crease-pattern model space. */
  box: AnnotationBox;
  z: number;
  /**
   * The orbit camera a window opens at.
   *
   * Live orbit is held by the viewport component, which stays mounted across
   * focus changes, so this is the starting value rather than a running mirror of
   * it. Windows do persist now, so a saved file remembers the camera a window
   * *opened* at and not where the user last orbited it — the write-back that
   * would fix that is still missing. Which is also why orbiting takes no undo
   * checkpoint: there is nothing in the descriptor for it to change.
   */
  view: SimulatorOrbitView;
  /*
   * Note what is NOT here: where the fold currently is.
   *
   * This descriptor is document-shaped — it changes when the user acts, and much
   * of the crease-pattern panel is keyed on the array that holds it. A fold
   * percentage changes ~15 times a second, so putting it here made every one of
   * those consumers recompute at 15Hz; the staleness walk alone cost 901ms of a
   * 7.2s profile. It lives in `inlineSimulationRuntime` instead, which is where
   * per-frame state belongs and which has the same lifetime.
   */

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

/**
 * The region to open a window on, carried across the toolbar -> store boundary.
 *
 * The whole region, not its `id`. Segment ids are positional — `segmentFoldDocument`
 * sorts regions into reading order and reassigns `id = index` on every recompute —
 * so an integer only means anything to the exact segmentation that produced it.
 * Passing one to a store that had segmented separately is how "simulate this
 * pattern" ended up opening a 14-unit sliver from somewhere else on the sheet.
 *
 * The caller has already resolved the region and its creases; handing both over
 * also spares the store recomputing containment it cannot do better.
 */
export interface InlineSimulationRegion {
  /** The region as its caller resolved it; `boundary` is the durable identity. */
  segment: CpSegment;
  /** 1-based `line_segments` ids inside or on the region. */
  cpLineIds: readonly number[];
}

/** Per-window state that is never serialized and never enters the store. */
export interface InlineSimulationRuntime {
  /** The captured segment fold the solver runs. */
  fold: FoldDocument;
  status: 'loading' | 'ready' | 'error';
  error: string | null;
}

/**
 * Gap between the crease pattern and a window parked beside it, in crease-pattern
 * model units.
 *
 * {@link CANVAS_OBJECT_GAP} is in SVG user units, where the paper square is 400
 * wide; the model square is 400 wide too under the default Oriedita bounds, so
 * the two are the same number. Kept as its own constant rather than reused
 * directly, because they are quantities in different spaces that happen to
 * coincide.
 */
const INLINE_SIMULATION_GAP = CANVAS_OBJECT_GAP;

/**
 * Park a new window beside the region it simulates, rather than on top of it.
 *
 * Written on top of the pattern it came from, a window hides exactly the thing
 * you wanted to compare it against. Folded figures had this problem first and
 * solved it by parking to the right of their source creases, aligned to the top,
 * in the first slot wide enough; {@link firstFreeSlotBeside} is that rule, shared
 * so the two cannot drift.
 *
 * `blockers` is whatever is already on the canvas, in model coordinates — other
 * windows, annotations, and folded figures — so a new window lands clear of all
 * of them, not just of its own kind.
 */
export function createInlineSimulation(options: {
  id: string;
  segment: CpSegment;
  document: OristudioCpDocumentSnapshot;
  cpLineIds: readonly number[];
  z: number;
  view: SimulatorOrbitView;
  blockers?: readonly Aabb[];
}): InlineSimulation {
  const { id, segment, document, cpLineIds, z, view, blockers = [] } = options;
  const bounds = foldedSourceBounds(cpLinesByIds(document, cpLineIds));
  // Sized and anchored from the crease bounds, which are the document's own
  // coordinates by construction, rather than from the segment's — those come
  // from the fold, and a fold that did not originate in this document is in a
  // different space.
  const source = bounds ?? segment.bounds;
  // Square, at the region's larger side: the fold is three-dimensional and can
  // stand taller or wider than the flat footprint it came from.
  const edge = Math.max(source.maxX - source.minX, source.maxY - source.minY);
  const { left, top } = firstFreeSlotBeside({
    anchor: { right: source.maxX, top: source.minY },
    width: edge,
    height: edge,
    gap: INLINE_SIMULATION_GAP,
    blockers,
  });
  return {
    id,
    box: {
      center: { x: left + edge / 2, y: top + edge / 2 },
      width: edge,
      height: edge,
      rotation: 0,
    },
    z,
    view,
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

/** Twice the signed area of a ring; sign is winding, magnitude is size. */
function ringArea2(ring: readonly Point[]): number {
  let total = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    total += (ring[j]!.x - ring[i]!.x) * (ring[j]!.y + ring[i]!.y);
  }
  return total;
}

/**
 * The ring that encloses the region: the largest by absolute area.
 *
 * Chosen by area rather than by position, because the tracing order of rings is
 * an implementation detail of how the region's rim was walked.
 */
export function outerRing(rings: readonly Point[][]): Point[] | null {
  let best: Point[] | null = null;
  let bestArea = -1;
  for (const ring of rings) {
    const area = Math.abs(ringArea2(ring));
    if (area > bestArea) {
      bestArea = area;
      best = ring as Point[];
    }
  }
  return best;
}

/**
 * Whether two boundaries describe the same region.
 *
 * Compares **outer rings only**. A region's holes are not part of its identity:
 * drawing any interior crease re-infers the faces and can open new untriangulated
 * pockets, so a region that had one ring before an edit routinely has several
 * after. Requiring every ring to match would make a region unrecognisable after
 * exactly the edit that refreshing exists to absorb.
 *
 * The outer ring still separates the cases a bounding box cannot: an L from the
 * region in its notch, a frame from the square inside it, and one tessellation
 * unit from the next.
 */
export function boundariesMatch(a: readonly Point[][], b: readonly Point[][]): boolean {
  const outerA = outerRing(a);
  const outerB = outerRing(b);
  if (!outerA || !outerB) return false;
  return ringsMatch(outerA, outerB);
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
