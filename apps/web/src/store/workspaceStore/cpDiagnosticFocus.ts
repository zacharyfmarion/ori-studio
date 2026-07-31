import { diagnosticEntryBounds } from '../../cp-workspace/diagnostics/geometry';
import {
  visibleCpDiagnosticEntries,
  visibleCpDiagnosticEntry,
} from '../../cp-workspace/diagnostics/visibleEntries';
import { cpCamera } from '../../cp-workspace/renderer/cpCameraRegistry';
import type { WorkspaceState } from './types';

/**
 * Jump the canvas to whichever diagnostic is now active.
 *
 * Call this from a store action, immediately after the `set` that activated one —
 * it reads the committed state, so every caller frames the same way without
 * having to pass the entry, the visibility, or the camera around.
 *
 * It lives here rather than in the panel because the panel is not on every path.
 * A check command adopts its first issue, and it can be dispatched from the tool
 * rail, from the menu (which never touches the panel), or from the CP-detect
 * import loop. The store action is the only point all three share.
 *
 * The rule is: **activating a diagnostic frames it, unless it is hidden.** Nothing
 * else moves the camera. Framing used to be derived from the active id instead —
 * a memo turned the active entry into a `bounds` object and an effect keyed on
 * that object's identity — so merely re-deriving the entry list replayed the
 * jump, and toggling "Foldability issues" off and on threw the user back to an
 * issue they had zoomed away from.
 */
export function frameActiveCpDiagnostic(state: WorkspaceState): void {
  const entry = visibleCpDiagnosticEntry(
    visibleCpDiagnosticEntries(
      state.oristudioCpCamvResult,
      state.oristudioCpDocument?.lastCommandResult ?? null,
      state.oristudioCpViewport.camvIssuesVisible !== false
    ),
    state.oristudioCpActiveDiagnosticId
  );
  if (!entry) return;
  const bounds = diagnosticEntryBounds(entry);
  if (bounds) cpCamera()?.frameModelBounds(bounds);
}
