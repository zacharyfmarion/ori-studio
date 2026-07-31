import type { OristudioCpDiagnosticFocusRequest } from './types';

/**
 * Activating a diagnostic: the durable highlight, plus the one-shot request that
 * frames it on the canvas.
 *
 * Both writers of the active id — the HUD row click and a check command adopting
 * its first issue — go through here, so "activated" means the same thing however
 * it happened, and framing is raised exactly once per activation. Deselecting
 * (`null`) frames nothing, and drops any request that has not been consumed.
 */
export function activateCpDiagnostic(
  diagnosticId: string | null,
  previousRequest: OristudioCpDiagnosticFocusRequest | null
): {
  oristudioCpActiveDiagnosticId: string | null;
  oristudioCpDiagnosticFocusRequest: OristudioCpDiagnosticFocusRequest | null;
} {
  return {
    oristudioCpActiveDiagnosticId: diagnosticId,
    oristudioCpDiagnosticFocusRequest: diagnosticId
      ? { id: (previousRequest?.id ?? 0) + 1, diagnosticId }
      : null,
  };
}
