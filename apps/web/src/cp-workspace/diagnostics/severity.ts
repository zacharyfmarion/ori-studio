/**
 * The one place that asks "what kind of thing is this diagnostic entry?".
 *
 * `CheckCamv` used to emit nothing but `error` entries, so `entries.length > 0`
 * and "something is wrong" were the same question and callers wrote whichever
 * they meant. They stopped being the same question twice over:
 *
 * - `SpatialInteriorBorder` arrives at `warning` severity, which says the check
 *   declined to examine the vertices on a border with paper on both sides — a
 *   statement about coverage, and explicitly not a violation;
 * - the spatial check now also emits `info` entries for every vertex it has not
 *   *decided*, which are not findings at all.
 *
 * The `info` half splits again, and the split is the point of
 * `implementation-plans/never-report-silence.md`: **undecided** has an action —
 * here is the angle that closes it — and **unexamined** has an explanation. A
 * document mid-design is majority undecided, so mixing the two would give one
 * number that means nothing.
 *
 * A caller that gates on "should I warn the user before doing this" wants
 * {@link countCpDiagnosticErrors}. A caller that renders the list wants the list.
 * A caller writing a headline over the list wants {@link countCpDiagnostics},
 * because the headline has to account for every row beneath it.
 */
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';
import { isUndecidedRule } from './foldabilityMessages';

/** The severities the kernel writes. */
const ERROR_SEVERITY = 'error';
const WARNING_SEVERITY = 'warning';

/**
 * What an entry is, as one word.
 *
 * Total over every entry: anything the kernel emits that is neither an error nor
 * a warning is something it did not decide, and `unexamined` is the honest
 * default for a code this table has not met — an unrecognised entry has not been
 * shown to be a problem, and guessing `error` would raise the fold warning on it.
 */
export type CpDiagnosticClass = 'error' | 'warning' | 'undecided' | 'unexamined';

export function cpDiagnosticClass(entry: OristudioCpDiagnosticEntry): CpDiagnosticClass {
  if (entry.severity === ERROR_SEVERITY) return 'error';
  if (entry.severity === WARNING_SEVERITY) return 'warning';
  return isUndecidedRule(entry.rule) ? 'undecided' : 'unexamined';
}

export function isCpDiagnosticError(entry: OristudioCpDiagnosticEntry): boolean {
  return entry.severity === ERROR_SEVERITY;
}

export function isCpDiagnosticWarning(entry: OristudioCpDiagnosticEntry): boolean {
  return entry.severity === WARNING_SEVERITY;
}

export function countCpDiagnosticErrors(
  entries: readonly OristudioCpDiagnosticEntry[] | undefined | null
): number {
  return (entries ?? []).filter(isCpDiagnosticError).length;
}

export type CpDiagnosticCounts = Record<CpDiagnosticClass, number>;

/** How many entries of each class, in one pass. */
export function countCpDiagnostics(
  entries: readonly OristudioCpDiagnosticEntry[] | undefined | null
): CpDiagnosticCounts {
  const counts: CpDiagnosticCounts = { error: 0, warning: 0, undecided: 0, unexamined: 0 };
  for (const entry of entries ?? []) counts[cpDiagnosticClass(entry)] += 1;
  return counts;
}

/**
 * The order the list shows entries in: worst first, then the kernel's own order.
 *
 * Needed the moment informational rows exist in volume. The kernel emits flat
 * violations, then spatial reports in vertex order, so three errors on a pattern
 * with seven hundred undecided vertices would be scattered through a list nobody
 * can scroll — and the headline that names them would be pointing at rows the
 * user cannot find.
 *
 * Stable within a class, so the canvas markers and the rows still agree about
 * which entry is which, and `activeId` still finds its row after a recompute.
 */
const CLASS_RANK: Record<CpDiagnosticClass, number> = {
  error: 0,
  warning: 1,
  unexamined: 2,
  undecided: 3,
};

export function sortedCpDiagnosticEntries(
  entries: readonly OristudioCpDiagnosticEntry[]
): readonly OristudioCpDiagnosticEntry[] {
  // Sorting an already-ordered list allocates for nothing, and the common case
  // by far is a handful of errors or none at all.
  let sorted = false;
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (!previous || !current) continue;
    if (CLASS_RANK[cpDiagnosticClass(previous)] > CLASS_RANK[cpDiagnosticClass(current)]) {
      sorted = true;
      break;
    }
  }
  if (!sorted) return entries;
  return [...entries].sort(
    (a, b) => CLASS_RANK[cpDiagnosticClass(a)] - CLASS_RANK[cpDiagnosticClass(b)]
  );
}
