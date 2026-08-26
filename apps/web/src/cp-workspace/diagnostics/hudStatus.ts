/**
 * What the collapsed diagnostic HUD says.
 *
 * A pure derivation from a command result: the headline count, an optional
 * subtitle, and the tone. Lives here rather than in `CreasePatternPanel` so the
 * subtitle rule below can be tested — it is a presentation decision that has
 * been got wrong twice.
 *
 * # The subtitle rule
 *
 * A subtitle appears **only when there is exactly one issue to name**. With
 * several, any one of them reads as *the* problem rather than as a sample; the
 * count in the headline says it better alone, and expanding the HUD is how you
 * see the rest. With none, the headline is already the whole message.
 *
 * The kernel's own summary string is never shown. It is a count — "Check CAMV
 * found 0 issue(s)" — so it only ever restates the headline, in raw English that
 * never passed through i18n, under a name the UI stopped using. An earlier
 * version kept it as a fallback for the no-entries case; that case is exactly
 * the clean result, where it was pure noise.
 *
 * # Four states, because a check has four things it can say
 *
 * Errors and warnings are findings and read loud. **Undecided** and
 * **unexamined** are not findings, and they share the fourth tone: a pattern
 * mid-design is majority undecided, so an amber badge over it would be a
 * permanent false alarm, and green would be the lie this whole plan exists to
 * remove. They are counted apart from each other because one has an action and
 * the other an explanation.
 *
 * And a check that examined nothing says so. `Foldability OK` is a claim about
 * vertices, and `known-good/airplane.fold` — twenty vertices, every one on the
 * paper edge — has always made it having evaluated no condition at all.
 */
import type { TFunction } from 'i18next';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { cpDiagnosticEntryMessage } from './foldabilityMessages';
import { countCpDiagnostics } from './severity';

const EMPTY_ENTRIES: OristudioCpDiagnosticEntry[] = [];

export interface CpDiagnosticHudStatus {
  label: string;
  detail: string | null;
  tone: 'ok' | 'info' | 'warn' | 'error';
}

/** What the kernel said about coverage, when it said anything. */
export interface CpDiagnosticCoverage {
  /** `CommandResult.checked_vertices`; `null` when the command does not check vertices. */
  checkedVertices?: number | null;
}

/** Commands whose results the HUD is willing to summarise. */
export function isDiagnosticResultOperation(operation: string): boolean {
  return (
    operation === 'Check1' ||
    operation === 'Check2' ||
    operation === 'Check3' ||
    operation === 'Check4' ||
    operation === 'CheckCamv' ||
    operation === 'FlatFoldableCheck'
  );
}

export function diagnosticOperationLabel(t: TFunction, operation: string): string {
  switch (operation) {
    case 'CheckCamv':
      return t('panels:creasePattern.diagnostic.camv', 'Foldability');
    case 'Check1':
      return t('panels:creasePattern.diagnostic.overlap', 'Overlap');
    case 'Check2':
      return t('panels:creasePattern.diagnostic.tJunction', 'T-junction');
    case 'Check3':
      return t('panels:creasePattern.diagnostic.vertexFoldability', 'Vertex foldability');
    case 'Check4':
      return t('panels:creasePattern.diagnostic.maekawaBlb', 'Maekawa/BLB');
    case 'FlatFoldableCheck':
      return t('panels:creasePattern.diagnostic.boundary', 'Boundary');
    default:
      return operation;
  }
}

export function diagnosticHudStatus(
  t: TFunction,
  result: OristudioCpCommandResult | null | undefined,
  options: { issueOnly?: boolean } = {}
): CpDiagnosticHudStatus | null {
  if (!result || !isDiagnosticResultOperation(result.operation)) return null;
  if (!result.diagnostics.length) return null;
  return diagnosticHudStatusForEntries(
    t,
    diagnosticOperationLabel(t, result.operation),
    result.diagnostic_entries ?? EMPTY_ENTRIES,
    { ...options, checkedVertices: result.checked_vertices }
  );
}

/**
 * The headline for a set of entries, under a check's name.
 *
 * Split out from {@link diagnosticHudStatus} because the HUD summarises the
 * entries it *lists*, and those are the union of the CAMV overlay and any check
 * command's findings (see `visibleEntries.ts`) — not one result's. Counting from
 * a single result while listing the union is how "21 Foldability Errors" came to
 * sit above 22 rows.
 *
 * The check name still comes from one result: whichever is naming the headline.
 * A union has no single operation, and the alternative — "Foldability and
 * Boundary" — names a check the user did not run.
 */
export function diagnosticHudStatusForEntries(
  t: TFunction,
  label: string,
  entries: readonly OristudioCpDiagnosticEntry[],
  options: { issueOnly?: boolean } & CpDiagnosticCoverage = {}
): CpDiagnosticHudStatus | null {
  const {
    error: errorCount,
    warning: warningCount,
    undecided: undecidedCount,
    unexamined: unexaminedCount,
  } = countCpDiagnostics(entries);
  const detail = entries.length === 1 && entries[0] ? cpDiagnosticEntryMessage(t, entries[0]) : null;

  if (errorCount > 0) {
    const errors =
      errorCount === 1
        ? t('panels:creasePattern.diagnostic.errorOne', '{{count}} {{label}} Error', {
            count: errorCount,
            label,
          })
        : t('panels:creasePattern.diagnostic.errorOther', '{{count}} {{label}} Errors', {
            count: errorCount,
            label,
          });
    // Warnings alongside errors get named too. The headline used to report the
    // error count alone, which read as the whole account of a list that also
    // held warnings — the row count did not match the number above it.
    //
    // Composed from two separately pluralised clauses rather than one string
    // with two counts: i18next pluralises on a single `count`, and locales with
    // more than two plural forms cannot be served by picking one of them.
    if (warningCount > 0) {
      const warnings =
        warningCount === 1
          ? t('panels:creasePattern.diagnostic.warningCountOne', '{{count}} Warning', {
              count: warningCount,
            })
          : t('panels:creasePattern.diagnostic.warningCountOther', '{{count}} Warnings', {
              count: warningCount,
            });
      return {
        label: t('panels:creasePattern.diagnostic.errorAndWarning', '{{errors}}, {{warnings}}', {
          errors,
          warnings,
        }),
        detail,
        tone: 'error',
      };
    }
    return { label: errors, detail, tone: 'error' };
  }

  if (warningCount > 0) {
    return {
      label:
        warningCount === 1
          ? t('panels:creasePattern.diagnostic.warningOne', '{{count}} {{label}} Warning', {
              count: warningCount,
              label,
            })
          : t('panels:creasePattern.diagnostic.warningOther', '{{count}} {{label}} Warnings', {
              count: warningCount,
              label,
            }),
      detail,
      tone: 'warn',
    };
  }

  // Nothing is wrong, and the check is still not finished with this document.
  //
  // This one *does* survive `issueOnly`, which is what keeps the overlay from
  // going quiet on the state the plan is named after. A silent HUD is how "not
  // decided" came to look like "decided and fine"; here it counts down as the
  // user commits creases and disappears when it reaches zero.
  const undecided = undecidedCount > 0 ? undecidedClause(t, undecidedCount) : null;
  const unexamined = unexaminedCount > 0 ? unexaminedClause(t, unexaminedCount) : null;
  if (undecided || unexamined) {
    // Composed from two separately pluralised clauses for the same reason the
    // error/warning pair is: i18next pluralises on one `count`.
    const label =
      undecided && unexamined
        ? t('panels:creasePattern.diagnostic.undecidedAndUnexamined', '{{first}}, {{second}}', {
            first: undecided,
            second: unexamined,
          })
        : (undecided ?? unexamined ?? '');
    return { label, detail, tone: 'info' };
  }

  if (options.issueOnly) return null;

  // "OK" is a claim about vertices. When the check answered for none of them
  // there is nothing to affirm, and saying so is the whole of case 8 — a pattern
  // whose every vertex sits on the paper edge is not clean, it is unexamined.
  //
  // Only under an explicit check: the always-on overlay stays silent, or an
  // empty document would wear a permanent badge.
  if (options.checkedVertices === 0) {
    return {
      label: t('panels:creasePattern.diagnostic.nothingToCheck', '{{label}}: nothing to check', {
        label,
      }),
      detail: t(
        'panels:creasePattern.diagnostic.nothingToCheckDetail',
        'No vertex here has a foldability condition'
      ),
      tone: 'info',
    };
  }

  return {
    label: t('panels:creasePattern.diagnostic.ok', '{{label}} OK', { label }),
    detail,
    tone: 'ok',
  };
}

/** "3 vertices undecided" — a count of answers waiting to be applied. */
function undecidedClause(t: TFunction, count: number): string {
  return count === 1
    ? t('panels:creasePattern.diagnostic.undecidedOne', '{{count}} vertex undecided', { count })
    : t('panels:creasePattern.diagnostic.undecidedOther', '{{count}} vertices undecided', {
        count,
      });
}

/** "2 not checked" — a count of vertices nothing can be said about. */
function unexaminedClause(t: TFunction, count: number): string {
  return count === 1
    ? t('panels:creasePattern.diagnostic.unexaminedOne', '{{count}} vertex not checked', { count })
    : t('panels:creasePattern.diagnostic.unexaminedOther', '{{count}} vertices not checked', {
        count,
      });
}
