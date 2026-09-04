/**
 * The scoped check filter: which foldability findings the document is currently
 * asking to be told about, and where.
 *
 * # Why this exists
 *
 * A crease pattern that has been *detected* rather than drawn carries angle
 * residuals around 4°, and `checks.rs` compares against `Epsilon::FLAT = 1e-6°`.
 * So `Angles` (Kawasaki) fires at essentially every interior vertex of a
 * pre-solve candidate, and `BigLittleBig` fires alongside it. The always-on CAMV
 * overlay is then a solid field of markers and useless as a worklist — while the
 * two classes that *do* localise the real defect, odd fan degree
 * (`NumberOfFolds`) and Maekawa, are buried in it.
 *
 * Suppressing the angle classes is therefore not a way of ignoring problems, it
 * is what makes the remaining markers a procedure. Measured over the 169
 * easy+medium detection failures with missing edges, **every** missing-edge
 * repair site carries at least one surviving marker (0 of 282 sites go silent),
 * so "work the markers until they are gone" is complete.
 *
 * # The shape: a list of scoped rules
 *
 * A rule is `{ scope, suppress }`. `scope` is either the whole document or one
 * region's rotated box, and rules **override** rather than union: the last rule
 * whose scope contains a finding decides, so a region can both add suppression
 * the document does not have and take suppression away that it does. Document
 * rules are emitted first by {@link cpCheckSuppressionRules}, which is what makes
 * "document default, regional override" fall out of plain list order. Two
 * overlapping regions resolve the same way — later wins.
 *
 * # The predicate must not be `rule`-based
 *
 * `find_flat_foldability_violation` emits **one** violation per vertex, with the
 * rule overwritten by priority (`crates/oristudio-cp/src/checks.rs:334-346`): a
 * vertex failing both Kawasaki and Maekawa is reported as `Angles`. So
 * `rule !== 'Angles'` would hide a real parity fault — the exact bug that makes
 * the post-solve big-little-big residuals look "introduced" when they were
 * merely masked.
 *
 * The surviving evidence is the **colour**. `maekawa_color()` is called from one
 * place only, the `red.abs_diff(blue) != 2` arm (`checks.rs:334-346`), and the
 * three colours it can return are `NotEnoughMountain`, `NotEnoughValley` and
 * `Equal`. Every other producer writes `Unknown` or `Correct`:
 * `find_flat_foldability_violation_inside` (`:849-891`) and
 * `find_big_little_big_violation_on_sides` (`:982-1022`) write `Unknown`
 * throughout, and the one other `Equal` return (`:352`) sits behind
 * `red.abs_diff(blue) == 2`, where `blue == red` is arithmetically impossible.
 *
 * So the colour is a sound Maekawa test, and it is the only one available on a
 * per-vertex violation that has already had its rule overwritten.
 */
import type { TFunction } from 'i18next';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { isSuppressionRegionAnnotation, type CanvasAnnotation } from '../annotations/annotation';
import { boxContainsModelPoint, type AnnotationBox } from '../annotations/annotationTransform';
import type { CpCheckClass } from '../annotations/suppressionRegion';

/**
 * The vocabulary is the region's, not this module's.
 *
 * `suppressionRegion.ts` owns {@link CpCheckClass} because the region carries the
 * list and persists it; this module owns the *predicate* that decides which
 * classes a given finding is evidence for. Keeping the two apart is the point:
 * a class is a user-facing theorem name, a kernel `rule` is not, and the
 * translation between them is exactly what must not be a `rule ===` test.
 *
 * Four classes and not five: `NumberOfFolds` — an odd fan, which is what a
 * missing crease makes of its endpoint — is deliberately **not** suppressible.
 * It is 74% of the repair worklist and is combinatorial, so no angle residual
 * can produce it and there is no state in which hiding it is the right answer.
 */
export type { CpCheckClass };

/** Where a rule applies. */
export type CpCheckScope = { kind: 'document' } | { kind: 'region'; box: AnnotationBox };

export interface CpCheckSuppressionRule {
  scope: CpCheckScope;
  suppress: readonly CpCheckClass[];
}

/** Shared so an unfiltered document keeps one array identity across renders. */
export const NO_CP_CHECK_SUPPRESSION: readonly CpCheckSuppressionRule[] = [];

const NO_CLASSES: readonly CpCheckClass[] = [];
const NO_ENTRIES: readonly OristudioCpDiagnosticEntry[] = [];
const NO_ANNOTATIONS: readonly CanvasAnnotation[] = [];

/**
 * The rules in force, document default first and regions in paint order.
 *
 * An empty document rule is not emitted at all, so a document with nothing
 * suppressed and no regions returns {@link NO_CP_CHECK_SUPPRESSION} — the
 * identity every consumer's fast path keys on. An *empty region* rule **is**
 * emitted, because "check everything inside this box" is a meaningful override
 * of a document that suppresses something.
 *
 * Regions are ordered by `z`, ties by array position, which is
 * `annotationAtModelPoint`'s order (`annotations/annotation.ts:71`). Where two
 * regions overlap, the one drawn on top is the one that decides — the same
 * answer the user gets by clicking there.
 */
export function cpCheckSuppressionRules(
  documentSuppress: readonly CpCheckClass[] | null | undefined,
  annotations: readonly CanvasAnnotation[] = NO_ANNOTATIONS
): readonly CpCheckSuppressionRule[] {
  const rules: CpCheckSuppressionRule[] = [];
  if (documentSuppress && documentSuppress.length > 0) {
    rules.push({ scope: { kind: 'document' }, suppress: documentSuppress });
  }
  const regions = annotations.filter(isSuppressionRegionAnnotation);
  if (regions.length > 1) {
    regions.sort((a, b) => a.z - b.z);
  }
  for (const region of regions) {
    rules.push({
      scope: {
        kind: 'region',
        box: {
          center: region.center,
          width: region.width,
          height: region.height,
          rotation: region.rotation,
        },
      },
      suppress: region.suppress,
    });
  }
  return rules.length > 0 ? rules : NO_CP_CHECK_SUPPRESSION;
}

/** `maekawa_color()`'s three returns — see the module note. */
const MAEKAWA_COLORS: ReadonlySet<string> = new Set([
  'NotEnoughMountain',
  'NotEnoughValley',
  'Equal',
]);

/**
 * The spatial checker's angle-dependent errors, all four of them.
 *
 * `Closure` and `ClosureUnreachable` are residual tests; `Rigid` fires on a
 * developable degree-3 vertex, which is an angle condition; `SelfIntersection`
 * is only reachable once closure holds, so it inherits closure's dependence on
 * the coordinates being right. The spatial checker's *informational* rules
 * (`Undecided`, `UnsplitJunction`, …) are not here: they are not findings, so
 * there is nothing for a rule to silence.
 */
const VERTEX_CLOSURE_RULES: ReadonlySet<string> = new Set([
  'Closure',
  'ClosureUnreachable',
  'Rigid',
  'SelfIntersection',
]);

const KAWASAKI_ONLY: readonly CpCheckClass[] = ['kawasaki'];
const BIG_LITTLE_BIG_ONLY: readonly CpCheckClass[] = ['bigLittleBig'];
const MAEKAWA_ONLY: readonly CpCheckClass[] = ['maekawa'];
const VERTEX_CLOSURE_ONLY: readonly CpCheckClass[] = ['vertexClosure'];
const KAWASAKI_AND_MAEKAWA: readonly CpCheckClass[] = ['kawasaki', 'maekawa'];
const BIG_LITTLE_BIG_AND_MAEKAWA: readonly CpCheckClass[] = ['bigLittleBig', 'maekawa'];

/**
 * Every class this entry is evidence for. Empty means nothing can suppress it.
 *
 * More than one class comes back exactly when the kernel collapsed two failures
 * into one violation: an `Angles` entry wearing a Maekawa colour is a vertex that
 * failed Kawasaki *and* parity, and it may only be hidden by a rule that
 * suppresses both.
 */
export function cpDiagnosticCheckClasses(
  entry: OristudioCpDiagnosticEntry
): readonly CpCheckClass[] {
  const rule = entry.rule;
  if (!rule) return NO_CLASSES;
  if (rule === 'Maekawa') return MAEKAWA_ONLY;
  if (VERTEX_CLOSURE_RULES.has(rule)) return VERTEX_CLOSURE_ONLY;
  if (rule !== 'Angles' && rule !== 'BigLittleBig') return NO_CLASSES;

  const maskedMaekawa = MAEKAWA_COLORS.has(entry.violation_color ?? '');
  if (rule === 'Angles') return maskedMaekawa ? KAWASAKI_AND_MAEKAWA : KAWASAKI_ONLY;
  return maskedMaekawa ? BIG_LITTLE_BIG_AND_MAEKAWA : BIG_LITTLE_BIG_ONLY;
}

/**
 * The classes suppressed at a model point: the last rule whose scope contains it.
 *
 * A finding with no point of its own — a `Check1` line pair, say — can only be
 * reached by a document rule, because there is no position to test a region
 * against. That costs nothing today: no rule-less-entry class is suppressible.
 */
export function cpSuppressedClassesAt(
  rules: readonly CpCheckSuppressionRule[],
  point: { x: number; y: number } | null | undefined
): readonly CpCheckClass[] {
  let active: readonly CpCheckClass[] = NO_CLASSES;
  for (const rule of rules) {
    if (rule.scope.kind === 'document') {
      active = rule.suppress;
      continue;
    }
    if (!point) continue;
    if (boxContainsModelPoint(rule.scope.box, point)) active = rule.suppress;
  }
  return active;
}

/**
 * Whether the rules hide this finding.
 *
 * Suppressed only when **every** class it evidences is suppressed where it sits,
 * which is what keeps the masking case honest: `Angles` + `NotEnoughValley` is
 * also a Maekawa fault, so a rule that silences Kawasaki alone leaves it on the
 * canvas.
 */
export function isCpDiagnosticSuppressed(
  entry: OristudioCpDiagnosticEntry,
  rules: readonly CpCheckSuppressionRule[]
): boolean {
  if (rules.length === 0) return false;
  const classes = cpDiagnosticCheckClasses(entry);
  if (classes.length === 0) return false;
  const suppressed = cpSuppressedClassesAt(rules, entry.point);
  if (suppressed.length === 0) return false;
  return classes.every((cpCheckClass) => suppressed.includes(cpCheckClass));
}

export interface CpCheckSuppressionPartition {
  visible: readonly OristudioCpDiagnosticEntry[];
  /**
   * What was removed. The HUD reports its length, and that count is the safety
   * affordance the whole design rests on — a filter you cannot see the cost of
   * is how "no errors" starts meaning "no errors we told you about".
   */
  hidden: readonly OristudioCpDiagnosticEntry[];
}

/**
 * Split entries into what the rules show and what they hide.
 *
 * Returns the input array **by identity** when nothing is hidden, so an
 * unfiltered document costs no allocation and every downstream `useMemo` that
 * depended on referential stability before the filter existed still gets it.
 */
export function partitionCpDiagnosticsBySuppression(
  entries: readonly OristudioCpDiagnosticEntry[],
  rules: readonly CpCheckSuppressionRule[]
): CpCheckSuppressionPartition {
  if (rules.length === 0 || entries.length === 0) return { visible: entries, hidden: NO_ENTRIES };
  const visible: OristudioCpDiagnosticEntry[] = [];
  const hidden: OristudioCpDiagnosticEntry[] = [];
  for (const entry of entries) {
    if (isCpDiagnosticSuppressed(entry, rules)) hidden.push(entry);
    else visible.push(entry);
  }
  if (hidden.length === 0) return { visible: entries, hidden: NO_ENTRIES };
  return { visible, hidden };
}

/**
 * A command result with its suppressed findings removed, for a caller that has to
 * hand a whole result to something that reads its entries — the HUD's headline
 * naming, which asks `diagnosticHudStatus` whether a check has anything to say.
 *
 * Returned unchanged when nothing is hidden, identity included.
 */
export function cpCommandResultWithSuppression<T extends OristudioCpCommandResult>(
  result: T | null,
  rules: readonly CpCheckSuppressionRule[]
): T | null {
  if (!result || rules.length === 0) return result;
  const entries = result.diagnostic_entries;
  if (!entries || entries.length === 0) return result;
  const { visible } = partitionCpDiagnosticsBySuppression(entries, rules);
  if (visible === entries) return result;
  return { ...result, diagnostic_entries: [...visible] };
}

/**
 * The theorem behind a class, as the user reads it.
 *
 * Named after the theorem rather than after the kernel's rule code, because the
 * point of the control is to let someone decide whether a condition *applies to
 * what they are doing* — and "Angles" does not say "Kawasaki" to anyone who has
 * not read `checks.rs`.
 *
 * Lives beside the vocabulary rather than in `i18n/enumLabels.ts` so the View
 * panel and the region chip share one table; move it there if a third surface
 * appears.
 */
export function cpCheckClassLabel(t: TFunction, cpCheckClass: CpCheckClass): string {
  switch (cpCheckClass) {
    case 'kawasaki':
      return t('panels:cpChecks.kawasaki', 'Kawasaki (angles)');
    case 'bigLittleBig':
      return t('panels:cpChecks.bigLittleBig', 'Big-little-big');
    case 'maekawa':
      return t('panels:cpChecks.maekawa', 'Maekawa (parity)');
    case 'vertexClosure':
      return t('panels:cpChecks.vertexClosure', 'Vertex closure');
  }
}
