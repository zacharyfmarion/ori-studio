/**
 * Check-suppression regions — the `'suppressionRegion'` variant of the shared
 * {@link AnnotationBase} substrate. A region is a placed box that says "do not
 * report these check classes inside me", and nothing else: suppression is
 * **positional**, so a crease inside the box is suppressed and the same crease
 * dragged out is checked again. Nothing is tracked by identity, so there is
 * nothing to invalidate when the geometry underneath changes — which is the
 * whole point, since the geometry underneath is exactly what repair changes.
 *
 * Its reason to exist is topology repair (`implementation-plans/crease-topology-repair.md`):
 * a detected candidate carries ~4° of Kawasaki residual at essentially every
 * interior vertex, so the always-on CAMV overlay fires everywhere and is
 * unusable as a worklist until the angle-dependent classes are hidden. What is
 * left — odd degree and Maekawa — is measured to flag every repair site. Beyond
 * repair the same box serves a library of CP fragments beside a working pattern,
 * a work-in-progress area, and a reference CP that will never be folded.
 *
 * This is a **leaf** module: pure types and helpers, no DOM/GPU/store
 * dependencies, so the persistence layer, the renderer, the diagnostics filter
 * and the store can all import it without a cycle, and it unit-tests headlessly.
 * {@link CpCheckClass} lives here for that reason — the filter needs the
 * vocabulary and the region carries it, and there is no third party to own it.
 *
 * Regions live in a web-side layer, never in the `oristudio-cp` kernel, so every
 * Oriedita-format export omits them automatically (see `lib/supersetFeatures`).
 */

import type { AnnotationBase } from './annotationBase';

/**
 * A class of foldability check a region can silence.
 *
 * A *class*, not a kernel `rule` code, and the two are deliberately not the same
 * vocabulary. `find_flat_foldability_violation` emits **one violation per
 * vertex** with the rule overwritten by priority, so a vertex failing both
 * Kawasaki and Maekawa reports as `Angles` — a filter keyed on `rule` alone
 * would hide a real parity fault under the angle class. Translating a class to
 * the predicate that recognises it (for `maekawa`, the `violation_color` test
 * inside the `|M − V| ≠ 2` arm) is the filter's job, not this module's.
 *
 * - `kawasaki` — the angle-sum condition, CAMV's `Angles` rule. The noisy one on
 *   a pre-solve candidate, and the reason regions exist.
 * - `bigLittleBig` — angles cannot nest, CAMV's `BigLittleBig`. Angle-dependent,
 *   and unmasked rather than introduced when Kawasaki clears.
 * - `maekawa` — the |M − V| = 2 parity condition. **Combinatorial**: it holds or
 *   fails on the assignment alone, so it survives an inexact candidate and is
 *   the class a repair worklist most wants kept.
 * - `vertexClosure` — the spatial half of CAMV (closure, rigidity, and the rest
 *   of `SPATIAL_RULES`). Angle-dependent.
 */
export type CpCheckClass = 'kawasaki' | 'bigLittleBig' | 'maekawa' | 'vertexClosure';

/** Every check class, in the order the region inspector lists them. */
export const CP_CHECK_CLASSES: readonly CpCheckClass[] = [
  'kawasaki',
  'bigLittleBig',
  'maekawa',
  'vertexClosure',
];

/**
 * What a region created by hand suppresses: every class.
 *
 * A hand-drawn region is a "not now" over a part of the pattern the user is
 * still working on, and a region suppressing nothing is indistinguishable
 * from no region — so it starts with everything off, and the chip's toggles
 * bring classes back one at a time. It used to start with the two angle
 * classes, detection's preset, which left the combinatorial markers showing
 * inside a region drawn to quiet them.
 */
export const DEFAULT_SUPPRESSED_CHECK_CLASSES: readonly CpCheckClass[] = CP_CHECK_CLASSES;

/**
 * What a region created by a detection import suppresses: the two angle
 * classes only. Those are what an inexact candidate trips at every vertex
 * before its solve, while the combinatorial ones — odd degree, Maekawa — stay
 * meaningful and are the repair worklist the solve waits on.
 */
export const DETECT_SUPPRESSED_CHECK_CLASSES: readonly CpCheckClass[] = [
  'kawasaki',
  'bigLittleBig',
];

/**
 * A placed box that suppresses check classes inside itself.
 *
 * `hidden` is narrowed to `false`, which is not decoration: a region that
 * suppresses invisibly is the one state this design must not allow, so the type
 * refuses it, {@link createCpSuppressionRegion} has no input for it, and
 * {@link validateCpSuppressionRegion} drops a stored region that claims it. The
 * hidden-findings count on the region's chip is the safety affordance, and it
 * only works if the chip is there to read.
 */
export interface CpSuppressionRegion extends Omit<AnnotationBase, 'hidden'> {
  /** Discriminant marking this annotation as a check-suppression region. */
  kind: 'suppressionRegion';
  /** Never hidden — see the note above. */
  hidden: false;
  /** The check classes silenced inside this box. */
  suppress: CpCheckClass[];
  /** User-visible name, shown on the region's chip. */
  label?: string;
  /**
   * An `ExactSolveInput` attached by CP detection, opaque here.
   *
   * Deliberately `unknown`: nothing on the web side reads its contents, it is
   * produced by the compiler and handed straight back to `cp_detect_solve_exact`,
   * and giving it a structural type here would be a second, drifting copy of a
   * Rust struct. **Its presence is the discriminator** for whether a region
   * offers Solve — data, not a geometric "does this box contain a solvable
   * pattern" test, which would run continuously and could flicker mid-edit,
   * exactly when it must not.
   */
  solveInput?: unknown;
  /**
   * A reference image this region owns — the `id` of a {@link CpImage} in the
   * same annotation array.
   *
   * **A link, not an embedded image.** The two are deliberately different
   * rectangles (the image is the rectified frame, the region is the paper plus a
   * margin), so an inline copy would have to re-declare most of `AnnotationBase`
   * anyway; and four pipelines are keyed on `isImageAnnotation` — the GPU image
   * channel, the save-size warning, the export-loss warning and the panel's
   * framing list — which an image hidden inside a region would silently drop out
   * of. A multi-megabyte underlay that stops being counted by the save-size
   * warning is the specific regression that decided this.
   *
   * What "owned" buys is lifecycle, and that is the part the user sees: the chip
   * is the only thing that can show, hide or fade it while the repair is going
   * on, deleting the region deletes it, and accepting a solve *unlocks* it so it
   * becomes an ordinary image with an ordinary inspector.
   *
   * A dangling id is tolerated, not repaired. `validateCpImage` drops an image
   * with a bad `src` while the region survives, and the honest response to that
   * is a chip with no image control — not a region deleted for its underlay.
   */
  imageId?: string;
}

/** A partial update to a region (its `id` and `kind` never change). */
export type CpSuppressionRegionUpdate = Partial<Omit<CpSuppressionRegion, 'id' | 'kind'>>;

function generateCpSuppressionRegionId(): string {
  const cryptoObj =
    typeof globalThis !== 'undefined' ? (globalThis.crypto as Crypto | undefined) : undefined;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `region-${cryptoObj.randomUUID()}`;
  }
  return `region-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Everything a region can be created with. There is no `hidden` here on purpose
 * — that is what "the factory forbids it" means, and an excess-property check
 * turns a caller that tries into a compile error rather than a silent drop.
 */
export interface CreateCpSuppressionRegionInput {
  center: { x: number; y: number };
  width: number;
  height: number;
  id?: string;
  rotation?: number;
  /** Defaults to {@link DEFAULT_SUPPRESSED_CHECK_CLASSES}. */
  suppress?: readonly CpCheckClass[];
  label?: string;
  solveInput?: unknown;
  /** The id of a `CpImage` this region owns — see {@link CpSuppressionRegion.imageId}. */
  imageId?: string;
  opacity?: number;
  locked?: boolean;
  z?: number;
}

export function createCpSuppressionRegion(
  input: CreateCpSuppressionRegionInput
): CpSuppressionRegion {
  return {
    kind: 'suppressionRegion',
    id: input.id ?? generateCpSuppressionRegionId(),
    center: { x: input.center.x, y: input.center.y },
    width: input.width,
    height: input.height,
    rotation: input.rotation ?? 0,
    z: input.z ?? 0,
    opacity: input.opacity ?? 1,
    locked: input.locked ?? false,
    hidden: false,
    suppress: normalizeCheckClasses(input.suppress ?? DEFAULT_SUPPRESSED_CHECK_CLASSES),
    ...(input.label === undefined ? {} : { label: input.label }),
    ...(input.solveInput === undefined ? {} : { solveInput: input.solveInput }),
    ...(input.imageId === undefined ? {} : { imageId: input.imageId }),
  };
}

/** Whether this region carries an attached solve input, i.e. offers Solve. */
export function hasAttachedSolveInput(region: CpSuppressionRegion): boolean {
  return region.solveInput !== undefined && region.solveInput !== null;
}

/** Whether `region` silences `checkClass` — the filter's per-region predicate. */
export function suppressesCheckClass(
  region: CpSuppressionRegion,
  checkClass: CpCheckClass
): boolean {
  return region.suppress.includes(checkClass);
}

/**
 * De-duplicate and re-order a class list into {@link CP_CHECK_CLASSES} order,
 * dropping anything unrecognised. Applied on both create and load so the stored
 * list is canonical and two regions suppressing the same set compare equal.
 */
function normalizeCheckClasses(value: readonly unknown[]): CpCheckClass[] {
  return CP_CHECK_CLASSES.filter((checkClass) => value.includes(checkClass));
}

/** Validate an array of regions from `.osf`, dropping invalid entries. */
export function validateCpSuppressionRegions(value: unknown): CpSuppressionRegion[] {
  if (!Array.isArray(value)) return [];
  const out: CpSuppressionRegion[] = [];
  for (const entry of value) {
    const region = validateCpSuppressionRegion(entry);
    if (region) out.push(region);
  }
  return out;
}

/**
 * Defensively validate/normalize a region read from `.osf`. Mirrors the lenient
 * `nativeProjectFile` style: an invalid entry returns null (dropped) rather than
 * throwing, so a malformed region never blocks opening a project.
 *
 * `hidden: true` is one of those invalid entries. Coercing it to `false` would
 * also satisfy the invariant, but a file claiming it was written by nothing this
 * app ships, and dropping fails in the safe direction: the checks the region
 * would have silenced come back, which is visible, rather than a suppressor
 * appearing somewhere the user never put one.
 */
export function validateCpSuppressionRegion(value: unknown): CpSuppressionRegion | null {
  if (!isRecord(value) || value.kind !== 'suppressionRegion') return null;
  if (value.hidden === true) return null;
  const center = validatePoint(value.center);
  if (!center) return null;
  const width = positiveNumber(value.width);
  const height = positiveNumber(value.height);
  if (width === null || height === null) return null;
  const label = typeof value.label === 'string' ? value.label : undefined;
  return {
    kind: 'suppressionRegion',
    id:
      typeof value.id === 'string' && value.id.length > 0
        ? value.id
        : generateCpSuppressionRegionId(),
    center,
    width,
    height,
    rotation: finiteNumber(value.rotation) ?? 0,
    z: finiteNumber(value.z) ?? 0,
    opacity: clamp01(finiteNumber(value.opacity) ?? 1),
    locked: value.locked === true,
    hidden: false,
    // A region whose stored list is missing or garbage falls back to the
    // default rather than to empty: empty is a region that does nothing, and a
    // no-op suppressor is harder to notice than a wrong one.
    suppress: Array.isArray(value.suppress)
      ? normalizeCheckClasses(value.suppress)
      : [...DEFAULT_SUPPRESSED_CHECK_CLASSES],
    ...(label === undefined ? {} : { label }),
    // Carried through verbatim, unread. This module has no opinion on the shape
    // of a compiler struct, and the solver refuses a malformed one itself with
    // a reason worth showing.
    ...(value.solveInput === undefined ? {} : { solveInput: value.solveInput }),
    // Named here or it is deleted on load: this validator rebuilds an explicit
    // literal, so a field it forgets is written out and lost on the way back in
    // with no type error anywhere. Not resolved against the image array — that
    // needs both arrays and this sees one region — so a dangling id survives the
    // read and the chip simply offers no image control.
    ...(typeof value.imageId === 'string' && value.imageId.length > 0
      ? { imageId: value.imageId }
      : {}),
  };
}

function validatePoint(value: unknown): { x: number; y: number } | null {
  if (!isRecord(value)) return null;
  const x = finiteNumber(value.x);
  const y = finiteNumber(value.y);
  return x === null || y === null ? null : { x, y };
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function positiveNumber(value: unknown): number | null {
  const n = finiteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
