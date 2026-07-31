/**
 * Comparing the user's pattern against a lesson's target.
 *
 * Both sides are canonicalized first (see `canonicalize`), so this is a set
 * difference over stable keys. The interesting part is the reporting: a crease
 * in the right place with the wrong fold type is a different kind of mistake
 * from a missing crease, and the lesson should say so.
 */
import {
  canonicalizeCreasePattern,
  ANY_ASSIGNMENT,
  type CanonicalCrease,
  type CanonicalizeOptions,
} from './canonicalize';
import type { OristudioCpModel } from '../../engine/oristudioCpTypes';
import type { LessonCheckSpec } from '../types';
import { squareSymmetries } from './symmetry';

export interface ComparisonResult {
  /** True when the pattern satisfies the check's match mode. */
  satisfied: boolean;
  /** In the target, absent from the user's pattern. */
  missing: CanonicalCrease[];
  /** In the user's pattern, absent from the target. */
  extra: CanonicalCrease[];
  /** Right geometry, wrong fold type — reported instead of missing+extra. */
  wrongAssignment: CanonicalCrease[];
  /** Creases matched outright. */
  matched: CanonicalCrease[];
  /** How many creases the target expects. */
  expected: number;
}

function optionsFor(spec: LessonCheckSpec): CanonicalizeOptions {
  return {
    tolerance: spec.tolerance,
    includeAuxiliary: spec.includeAuxiliary,
    ignoreAssignment: spec.ignoreAssignment,
  };
}

function byKey(creases: CanonicalCrease[]): Map<string, CanonicalCrease> {
  return new Map(creases.map((crease) => [crease.key, crease]));
}

/**
 * Diff two canonical patterns.
 *
 * Creases present in both by geometry but differing in assignment are pulled out
 * of `missing`/`extra` into `wrongAssignment` — the same mistake reported once,
 * usefully, rather than twice, confusingly.
 */
function diff(user: CanonicalCrease[], target: CanonicalCrease[]): Omit<ComparisonResult, 'satisfied'> {
  const userByKey = byKey(user);
  const targetByKey = byKey(target);

  const matched: CanonicalCrease[] = [];
  const missing: CanonicalCrease[] = [];
  const extra: CanonicalCrease[] = [];
  const wrongAssignment: CanonicalCrease[] = [];

  const userGeometry = new Map<string, CanonicalCrease>();
  for (const crease of user) userGeometry.set(crease.geometryKey, crease);

  for (const wanted of target) {
    if (userByKey.has(wanted.key)) {
      matched.push(wanted);
      continue;
    }
    const sameGeometry = userGeometry.get(wanted.geometryKey);
    if (sameGeometry && wanted.assignment !== ANY_ASSIGNMENT) {
      wrongAssignment.push(wanted);
      continue;
    }
    missing.push(wanted);
  }

  const wrongGeometryKeys = new Set(wrongAssignment.map((crease) => crease.geometryKey));
  for (const drawn of user) {
    if (targetByKey.has(drawn.key)) continue;
    // Already accounted for as a wrong-assignment report; not also "extra".
    if (wrongGeometryKeys.has(drawn.geometryKey)) continue;
    extra.push(drawn);
  }

  return { matched, missing, extra, wrongAssignment, expected: target.length };
}

function isSatisfied(result: Omit<ComparisonResult, 'satisfied'>, spec: LessonCheckSpec): boolean {
  if (result.missing.length > 0 || result.wrongAssignment.length > 0) return false;
  return spec.mode === 'subset' ? true : result.extra.length === 0;
}

/** How close a candidate is to satisfying the check; lower is better. */
function distance(result: Omit<ComparisonResult, 'satisfied'>, spec: LessonCheckSpec): number {
  const extraWeight = spec.mode === 'subset' ? 0 : 1;
  return (
    result.missing.length + result.wrongAssignment.length + result.extra.length * extraWeight
  );
}

/**
 * Compare a drawn pattern against a target under a lesson's check spec.
 *
 * With `allowSymmetry`, the target is tried under all 8 symmetries of the square
 * and the best match wins — so a lesson that asks for "the diagonal" accepts
 * either one. The comparison is over the *target*, not the drawing, so the
 * feedback always describes creases the user can actually see in the preview.
 */
export function compareCreasePatterns(
  drawn: OristudioCpModel,
  target: OristudioCpModel,
  spec: LessonCheckSpec
): ComparisonResult {
  const options = optionsFor(spec);
  const user = canonicalizeCreasePattern(drawn, options);
  const baseTarget = canonicalizeCreasePattern(target, options);

  const candidates = spec.allowSymmetry ? squareSymmetries(baseTarget) : [baseTarget];

  let best: Omit<ComparisonResult, 'satisfied'> | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const result = diff(user, candidate);
    const score = distance(result, spec);
    if (score < bestDistance) {
      best = result;
      bestDistance = score;
      if (score === 0) break;
    }
  }

  const resolved = best ?? diff(user, baseTarget);
  return { ...resolved, satisfied: isSatisfied(resolved, spec) };
}
