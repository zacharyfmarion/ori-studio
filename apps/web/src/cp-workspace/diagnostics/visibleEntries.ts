import type {
  OristudioCpCommandResult,
  OristudioCpDiagnosticEntry,
} from '../../engine/oristudioCpTypes';
import { isDiagnosticResultOperation } from './hudStatus';

const NONE: readonly OristudioCpDiagnosticEntry[] = [];

/**
 * The diagnostic entries currently on the canvas.
 *
 * Two results can contribute. The always-on CAMV overlay re-runs after every edit
 * and is what the "Foldability issues" toggle hides. A check or repair command
 * leaves its own findings in `lastCommandResult`, which are shown whether or not
 * the overlay is on — except for `CheckCamv` itself, whose findings *are* the
 * overlay and so follow the toggle.
 *
 * Returned as one list because everything downstream — markers, the HUD list,
 * what a jump-to-diagnostic can reach — asks the same question: what can the user
 * see right now.
 */
export function visibleCpDiagnosticEntries(
  camvResult: OristudioCpCommandResult | null,
  lastCommandResult: OristudioCpCommandResult | null,
  camvIssuesVisible: boolean
): readonly OristudioCpDiagnosticEntry[] {
  const overlay = camvIssuesVisible ? (camvResult?.diagnostic_entries ?? NONE) : NONE;
  const isHiddenCamvCommand = !camvIssuesVisible && lastCommandResult?.operation === 'CheckCamv';
  const command =
    lastCommandResult &&
    isDiagnosticResultOperation(lastCommandResult.operation) &&
    !isHiddenCamvCommand
      ? (lastCommandResult.diagnostic_entries ?? NONE)
      : NONE;

  // A CheckCamv command result *is* the overlay recomputed, so showing both would
  // double every entry.
  if (lastCommandResult?.operation === 'CheckCamv') return command;
  if (overlay.length === 0) return command;
  if (command.length === 0) return overlay;
  return [...overlay, ...command];
}

/** The visible entry with this id, or null — including when it is currently hidden. */
export function visibleCpDiagnosticEntry(
  entries: readonly OristudioCpDiagnosticEntry[],
  id: string | null
): OristudioCpDiagnosticEntry | null {
  if (!id) return null;
  return entries.find((entry) => entry.id === id) ?? null;
}
