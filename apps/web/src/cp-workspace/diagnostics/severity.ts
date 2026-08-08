/**
 * The one place that asks "is this diagnostic entry a violation?".
 *
 * `CheckCamv` used to emit nothing but `error` entries, so `entries.length > 0`
 * and "something is wrong" were the same question and callers wrote whichever
 * they meant. They are no longer the same question: the spatial check also emits
 * `SpatialInteriorBorder` at `warning` severity, which says the check declined
 * to examine the vertices on a border with paper on both sides — a statement
 * about coverage, and explicitly not a violation.
 *
 * A caller that gates on "should I warn the user before doing this" wants
 * {@link countCpDiagnosticErrors}. A caller that renders the list wants the list.
 */
import type { OristudioCpDiagnosticEntry } from '../../engine/oristudioCpTypes';

/** The two severities the kernel writes. */
const ERROR_SEVERITY = 'error';
const WARNING_SEVERITY = 'warning';

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
