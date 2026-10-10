import type { OristudioCpDocumentSnapshot } from '../../engine/oristudioCpTypes';
import type { FoldDocument } from '../../engine/types';
import type { Point } from '../../lib/geometry';
import type { PaperStyleOverrides } from '../../lib/paper/paperStyle';
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
import {
  CANVAS_OBJECT_GAP,
  aabbInFrame,
  firstFreeSlotBeside,
  pointFromFrame,
} from '../canvasObjects/placeBesideCp';
import type { TransformableCanvasObject } from '../canvasObjects/transformableObject';
import { resolveRegion } from '../regions/regionReference';
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
  /**
   * The paper-style fields the user pinned on this window; everything not here
   * follows the app's display style. Absent when nothing is pinned, and left
   * off the file then.
   */
  appearance?: PaperStyleOverrides;
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
  /** Blockers already measured along the frame's axes (see `frameAngle`). */
  blockers?: readonly Aabb[];
  /**
   * The angle at which a window is upright on screen. The window is created at
   * this rotation and packed along the view's axes, so a row of windows reads as
   * a row however the canvas is turned. 0 is the old model-space behaviour.
   */
  frameAngle?: number;
}): InlineSimulation {
  const {
    id,
    segment,
    document,
    cpLineIds,
    z,
    view,
    blockers = [],
    frameAngle = 0,
  } = options;
  const bounds = foldedSourceBounds(cpLinesByIds(document, cpLineIds));
  // Sized and anchored from the crease bounds, which are the document's own
  // coordinates by construction, rather than from the segment's — those come
  // from the fold, and a fold that did not originate in this document is in a
  // different space.
  const source = bounds ?? segment.bounds;
  // Square, at the region's larger side: the fold is three-dimensional and can
  // stand taller or wider than the flat footprint it came from.
  const edge = Math.max(source.maxX - source.minX, source.maxY - source.minY);
  // "Beside" is measured along the view's axes, so the anchor is the source
  // region's frame-space right/top edge rather than its model-space one.
  const sourceInFrame = aabbInFrame(source, frameAngle);
  const { left, top } = firstFreeSlotBeside({
    anchor: { right: sourceInFrame.maxX, top: sourceInFrame.minY },
    width: edge,
    height: edge,
    gap: INLINE_SIMULATION_GAP,
    blockers,
  });
  const centre = pointFromFrame({ x: left + edge / 2, y: top + edge / 2 }, frameAngle);
  return {
    id,
    box: {
      center: centre,
      width: edge,
      height: edge,
      rotation: frameAngle,
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


/**
 * Find the segment a window refers to, in a freshly computed segmentation:
 * `resolveRegion` over the window's boundary and hint. Null means the region
 * genuinely stopped existing, which the caller should say rather than paper
 * over.
 */
export function resolveInlineSimulationSegment(
  simulation: InlineSimulation,
  segments: readonly CpSegment[]
): CpSegment | null {
  const boundary = simulation.sourceBoundary;
  if (!boundary) return null;
  return resolveRegion({ boundary, segmentIdHint: simulation.segmentIdHint }, segments);
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
    // A window is its own DOM layer above the canvas, so it keeps its press.
    yieldsPressToCreases: false,
  };
}

/** The highest z across the windows, or 0 when there are none. */
export function topInlineSimulationZ(simulations: readonly InlineSimulation[]): number {
  return simulations.reduce((max, simulation) => Math.max(max, simulation.z), 0);
}
