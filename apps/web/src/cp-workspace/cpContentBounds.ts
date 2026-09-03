import type { UserBounds } from './renderer/camera';
import type { ModelPoint } from './renderer/types';
import type { CpImage } from './images/cpImage';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import { imageCornersModel } from './images/cpImagePlacement';
import { boxCornersModel } from './annotations/annotationTransform';
import { foldedFigureUserAabb } from './adapters/cpFoldedToScene';

/**
 * A placed box framing must include but that has no richer shape than its
 * extent — a text annotation, an inline simulation window, or a
 * check-suppression region.
 *
 * Not "a box the renderer does not draw", which is what this used to say: the
 * first two live on DOM layers and a region is drawn in GL, and framing does not
 * care which. What the kinds here share is that a rotated rectangle is the whole
 * of their geometry, where a {@link CpImage} additionally carries a crop and a
 * folded figure arrives already in user space.
 */
export interface CpOverlayBox {
  center: ModelPoint;
  width: number;
  height: number;
  rotation: number;
  hidden: boolean;
}

export interface CpContentBoundsInput {
  lineSegments: readonly { a: ModelPoint; b: ModelPoint }[];
  images?: readonly CpImage[];
  overlayBoxes?: readonly CpOverlayBox[];
  /**
   * Folded figures placed beside the pattern.
   *
   * Separate from {@link overlayBoxes} because they are already in **SVG user**
   * coordinates — the space their render primitives land in — while every other
   * input here is in model space and passes through `modelToSvg`. Putting them
   * through it as well would place them at the paper transform's scale, which is
   * the mistake `bf484295` was about.
   */
  foldedFigures?: readonly OristudioCpFoldedFigureEntry[];
  /** Model space to SVG user space, since the camera frames in user coords. */
  modelToSvg: (point: ModelPoint) => { x: number; y: number };
}

/**
 * What the camera frames against: everything placed on the canvas, in SVG user
 * coordinates. Null when there is nothing placed at all.
 *
 * The reason this is its own function rather than a memo inside the canvas is
 * that it is a list of *kinds*, and a kind left off it is invisible to framing —
 * fitting to view then leaves that content off screen with nothing to suggest
 * why. Inline simulation windows were missing exactly this way, and so were
 * folded figures. A list is easy to forget to extend and easy to enumerate in a
 * test, so it is enumerated.
 *
 * The kinds, as of now: creases, reference images, overlay boxes (text
 * annotations, inline simulation windows and check-suppression regions), and
 * folded figures.
 *
 * Hidden content is excluded because it is not drawn; framing to include
 * something invisible would just look like the camera was wrong.
 */
export function cpContentBounds(input: CpContentBoundsInput): UserBounds | null {
  const { lineSegments, images, overlayBoxes, foldedFigures, modelToSvg } = input;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let has = false;

  /**
   * Take in a point already in SVG user space.
   *
   * Non-finite coordinates are skipped rather than folded in. A NaN comparison
   * is false both ways so it would leave the running extent alone but still set
   * `has`, and an infinity would swallow the whole box — either way every
   * consumer of these bounds (the camera fit, and the stroke/marker sizing
   * reference through it) gets a meaningless answer. Note this only rejects what
   * cannot be *drawn*; a merely far-away point is real content and stays in, so
   * fitting to view still frames it. Bounding the damage a far-away point can do
   * to sizing is `cpSizingScales`' job, not this function's.
   */
  const extendUser = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    has = true;
  };

  const extend = (point: ModelPoint) => {
    const u = modelToSvg(point);
    extendUser(u.x, u.y);
  };

  for (const segment of lineSegments) {
    extend(segment.a);
    extend(segment.b);
  }
  for (const image of images ?? []) {
    if (image.hidden) continue;
    for (const corner of imageCornersModel(image)) extend(corner);
  }
  for (const box of overlayBoxes ?? []) {
    if (box.hidden) continue;
    for (const corner of boxCornersModel(box)) extend(corner);
  }
  for (const figure of foldedFigures ?? []) {
    // Already user space, so `extendUser` rather than `extend`. Null means the
    // figure draws nothing, which is the same as hidden for framing purposes.
    const aabb = foldedFigureUserAabb(figure);
    if (!aabb) continue;
    extendUser(aabb.minX, aabb.minY);
    extendUser(aabb.maxX, aabb.maxY);
  }

  return has ? { minX, minY, maxX, maxY } : null;
}

/**
 * Fraction of crease endpoints discarded from each end of each axis by
 * {@link cpTrimmedCreaseBounds}.
 *
 * 2% is chosen from measurement, with headroom on both sides. On a real dense CP
 * it is *exactly* a no-op — a crease pattern's paper edges carry many vertices
 * at the same extreme coordinate, so trimming a few percent does not move the
 * extreme at all (measured: 850 units at 0%, 0.5%, 1% and 2% alike, only moving
 * at 5%). And the failure it exists for is far below it: a stray endpoint is one
 * or two samples out of hundreds, ~0.2%.
 */
const SIZING_TRIM_FRACTION = 0.02;

function swap(values: Float64Array, i: number, j: number): void {
  const t = values[i];
  values[i] = values[j];
  values[j] = t;
}

/**
 * The `k`-th smallest of `values[lo..hi]`, reordering that range in place.
 *
 * Quickselect rather than a sort, because only two order statistics per axis are
 * wanted and a total order is not. That is not a micro-optimisation: sorting
 * here was ~1.9s of a 6.4s zoom profile — about 45% of all JavaScript on the
 * main thread — on a document whose sizing reference had not changed at all.
 *
 * Median-of-three pivoting is what keeps that honest. Quickselect's O(n²) case
 * is sorted and reverse-sorted input, and crease endpoints arrive close to it
 * routinely: they are grouped by the order creases were drawn, and a pattern
 * built by repeated grid subdivision hands over long ascending runs.
 *
 * Callers filter non-finite coordinates out beforehand, so no NaN reaches the
 * comparisons here — a NaN would make both partition scans fall through.
 */
function selectNth(values: Float64Array, k: number, lo: number, hi: number): number {
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    // Order the three so `values[mid]` is their median, then pivot on it.
    if (values[mid] < values[lo]) swap(values, lo, mid);
    if (values[hi] < values[lo]) swap(values, lo, hi);
    if (values[hi] < values[mid]) swap(values, mid, hi);
    const pivot = values[mid];

    let i = lo;
    let j = hi;
    while (i <= j) {
      // Both scans stop at the pivot's own slot at the latest, so neither can
      // run past the range.
      while (values[i] < pivot) i += 1;
      while (values[j] > pivot) j -= 1;
      if (i <= j) {
        swap(values, i, j);
        i += 1;
        j -= 1;
      }
    }

    if (k <= j) hi = j;
    else if (k >= i) lo = i;
    else return values[k];
  }
  return values[lo];
}

/**
 * The trimmed extent of the crease endpoints alone, in SVG user coordinates.
 * Null when no crease offers a usable coordinate.
 *
 * Split out of {@link cpSizingBounds} because it is the expensive half and the
 * only half that depends on the document's geometry. The canvas memoises it on
 * `lineSegments` alone for that reason; folding it in with the placed-object
 * kinds, whose arrays are rebuilt every render, is what put a full pass over
 * every crease endpoint on every camera frame.
 *
 * **`modelToSvg` must map each axis independently and monotonically.** That is
 * what lets this select in model space and project two corners, rather than
 * projecting 2N points and selecting on those — the mapping cannot change which
 * endpoint is `k`-th along an axis. `cpModelToSvg`, the only mapping this is
 * called with, is a positive per-axis affine onto the paper rect. A decreasing
 * axis is still fine, because the two projected corners are recombined with
 * min/max rather than assumed to arrive in order; a rotation is not, and would
 * need the old project-then-select path back.
 */
export function cpTrimmedCreaseBounds(
  lineSegments: CpContentBoundsInput['lineSegments'],
  modelToSvg: CpContentBoundsInput['modelToSvg']
): UserBounds | null {
  if (lineSegments.length === 0) return null;

  const xs = new Float64Array(lineSegments.length * 2);
  const ys = new Float64Array(lineSegments.length * 2);
  let n = 0;
  for (const segment of lineSegments) {
    // Unrolled rather than iterating `[segment.a, segment.b]`: that allocates a
    // two-element array per crease, and this walks the whole document.
    const { a, b } = segment;
    if (Number.isFinite(a.x) && Number.isFinite(a.y)) {
      xs[n] = a.x;
      ys[n] = a.y;
      n += 1;
    }
    if (Number.isFinite(b.x) && Number.isFinite(b.y)) {
      xs[n] = b.x;
      ys[n] = b.y;
      n += 1;
    }
  }
  if (n === 0) return null;

  const drop = Math.floor(n * SIZING_TRIM_FRACTION);
  // The upper select runs over `[drop, n-1]` only: the lower one already
  // partitioned everything below `drop` to the left of it.
  const low = modelToSvg({
    x: selectNth(xs, drop, 0, n - 1),
    y: selectNth(ys, drop, 0, n - 1),
  });
  const high = modelToSvg({
    x: selectNth(xs, n - 1 - drop, drop, n - 1),
    y: selectNth(ys, n - 1 - drop, drop, n - 1),
  });

  // Each axis was selected on its own, so these two are corners of the trimmed
  // box rather than endpoints that ever existed. That is what is wanted — the
  // caller asked for an extent, not for a pair of creases.
  if (
    !Number.isFinite(low.x) ||
    !Number.isFinite(low.y) ||
    !Number.isFinite(high.x) ||
    !Number.isFinite(high.y)
  ) {
    // Finite model coordinates can only land here by overflowing the mapping.
    // Reporting nothing lets the placed-object kinds answer instead, which is
    // what this did before when every endpoint was unusable.
    return null;
  }

  return {
    minX: Math.min(low.x, high.x),
    minY: Math.min(low.y, high.y),
    maxX: Math.max(low.x, high.x),
    maxY: Math.max(low.y, high.y),
  };
}

/** {@link cpContentBounds} over every placed kind *except* creases. */
export function cpPlacedObjectBounds(
  input: Omit<CpContentBoundsInput, 'lineSegments'>
): UserBounds | null {
  return cpContentBounds({ ...input, lineSegments: [] });
}

/** The box containing both, or whichever one is not null. */
export function unionBounds(
  a: UserBounds | null,
  b: UserBounds | null
): UserBounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

/**
 * What the *stroke and marker sizing* reference scale is measured against.
 *
 * Deliberately not {@link cpContentBounds}. Those bounds answer "what must stay
 * on screen", so they include every placed thing however far out it sits — that
 * is the right answer for framing and the wrong one for sizing, because it lets
 * a single bad coordinate set the scale for every stroke, marker and dot on the
 * canvas. That is not hypothetical: Angle Bisector on two parallel lines divided
 * by a ~1e-9 determinant and committed a crease ending at ~3.4e14, which drove
 * the sizing reference to ~63x and buried the pattern under its own creases.
 *
 * So this answers a different question — "what scale is the *bulk* of the
 * drawing at" — and is built to be unmoved by a few outlying points:
 *
 * - **Crease endpoints are trimmed** by {@link SIZING_TRIM_FRACTION}. They are
 *   numerous, so a percentile is meaningful, and no individual one matters.
 * - **Images, overlay boxes and folded figures are not.** There are a handful,
 *   each deliberately placed, and each is a large piece of the picture; trimming
 *   would let a document's only reference image drop out of its own scale.
 *
 * Falls back to {@link cpContentBounds} when there are no creases to trim.
 */
export function cpSizingBounds(input: CpContentBoundsInput): UserBounds | null {
  // The non-crease kinds ride along untrimmed, via the shared enumeration so
  // they cannot drift apart from the framing bounds' idea of what is placed.
  //
  // The canvas calls the two halves separately so it can memoise them on
  // different things; this composition is what the tests pin and what any other
  // caller should reach for.
  return unionBounds(
    cpTrimmedCreaseBounds(input.lineSegments, input.modelToSvg),
    cpPlacedObjectBounds(input)
  );
}
