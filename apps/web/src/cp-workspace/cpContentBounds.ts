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
 * {@link cpSizingBounds}.
 *
 * 2% is chosen from measurement, with headroom on both sides. On a real dense CP
 * it is *exactly* a no-op — a crease pattern's paper edges carry many vertices
 * at the same extreme coordinate, so trimming a few percent does not move the
 * extreme at all (measured: 850 units at 0%, 0.5%, 1% and 2% alike, only moving
 * at 5%). And the failure it exists for is far below it: a stray endpoint is one
 * or two samples out of hundreds, ~0.2%.
 */
const SIZING_TRIM_FRACTION = 0.02;

/** Span between the trimmed extremes of `values`, which this sorts in place. */
function trimmedExtent(values: number[], fraction: number): { min: number; max: number } {
  values.sort((a, b) => a - b);
  const drop = Math.floor(values.length * fraction);
  return { min: values[drop], max: values[values.length - 1 - drop] };
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
  const { lineSegments, modelToSvg } = input;
  if (lineSegments.length === 0) return cpContentBounds(input);

  const xs: number[] = [];
  const ys: number[] = [];
  for (const segment of lineSegments) {
    for (const point of [segment.a, segment.b]) {
      const u = modelToSvg(point);
      if (!Number.isFinite(u.x) || !Number.isFinite(u.y)) continue;
      xs.push(u.x);
      ys.push(u.y);
    }
  }
  if (xs.length === 0) return cpContentBounds(input);

  const x = trimmedExtent(xs, SIZING_TRIM_FRACTION);
  const y = trimmedExtent(ys, SIZING_TRIM_FRACTION);

  // The non-crease kinds ride along untrimmed, via the shared enumeration so
  // they cannot drift apart from the framing bounds' idea of what is placed.
  const rest = cpContentBounds({ ...input, lineSegments: [] });

  return {
    minX: Math.min(x.min, rest?.minX ?? Infinity),
    minY: Math.min(y.min, rest?.minY ?? Infinity),
    maxX: Math.max(x.max, rest?.maxX ?? -Infinity),
    maxY: Math.max(y.max, rest?.maxY ?? -Infinity),
  };
}
