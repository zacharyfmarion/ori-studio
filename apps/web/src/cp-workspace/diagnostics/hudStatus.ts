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
      return t('panels:creasePattern.diagnostic.maekawaLbl', 'Maekawa/LBL');
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
  const entries = result.diagnostic_entries ?? EMPTY_ENTRIES;
  const label = diagnosticOperationLabel(t, result.operation);
  const errorCount = entries.filter((entry) => entry.severity === 'error').length;
  const warningCount = entries.filter((entry) => entry.severity === 'warning').length;
  const detail = entries.length === 1 && entries[0] ? cpDiagnosticEntryMessage(t, entries[0]) : null;

  if (errorCount > 0) {
    return {
      label:
        errorCount === 1
          ? t('panels:creasePattern.diagnostic.errorOne', '{{count}} {{label}} Error', {
              count: errorCount,
              label,
            })
          : t('panels:creasePattern.diagnostic.errorOther', '{{count}} {{label}} Errors', {
              count: errorCount,
              label,
            }),
      detail,
      tone: 'error',
    };
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
