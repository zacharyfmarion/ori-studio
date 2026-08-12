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
 */
import type { TFunction } from 'i18next';
import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { cpDiagnosticEntryMessage } from './foldabilityMessages';
import { isCpDiagnosticError, isCpDiagnosticWarning } from './severity';

const EMPTY_ENTRIES: OristudioCpDiagnosticEntry[] = [];

export interface CpDiagnosticHudStatus {
  label: string;
  detail: string | null;
  tone: 'ok' | 'warn' | 'error';
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
    options
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
  options: { issueOnly?: boolean } = {}
): CpDiagnosticHudStatus | null {
  const errorCount = entries.filter(isCpDiagnosticError).length;
  const warningCount = entries.filter(isCpDiagnosticWarning).length;
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

  if (options.issueOnly) return null;

  return {
    label: t('panels:creasePattern.diagnostic.ok', '{{label}} OK', { label }),
    detail,
    tone: 'ok',
  };
}
