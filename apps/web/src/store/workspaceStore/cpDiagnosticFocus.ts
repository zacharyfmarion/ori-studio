import { boundsFromPoints, diagnosticEntryBounds } from '../../cp-workspace/diagnostics/geometry';
import type { Point } from '../../lib/geometry';
import {
  visibleCpDiagnosticEntries,
  visibleCpDiagnosticEntry,
} from '../../cp-workspace/diagnostics/visibleEntries';
import { cpCheckSuppressionRules } from '../../cp-workspace/diagnostics/checkSuppression';
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
 *
 * "Hidden" includes hidden by a check-class filter, which is why the suppression
 * rules are built here too. Without them this is the one surface where a
 * suppressed finding still moves the camera — the marker is not drawn, the HUD
 * row is not listed, and the canvas jumps to a place with nothing on it.
 */
export function frameActiveCpDiagnostic(state: WorkspaceState): void {
  const entry = visibleCpDiagnosticEntry(
    visibleCpDiagnosticEntries(
      state.oristudioCpCamvResult,
      state.oristudioCpDocument?.lastCommandResult ?? null,
      state.oristudioCpViewport.camvIssuesVisible !== false,
      cpCheckSuppressionRules(
        state.oristudioCpViewport.suppressedCheckClasses,
        state.oristudioCpAnnotations
      )
    ),
    state.oristudioCpActiveDiagnosticId
  );
  if (!entry) return;
  const bounds = diagnosticEntryBounds(entry);
  if (bounds) cpCamera()?.frameModelBounds(bounds);
}

/**
 * Jump the canvas to a place the kernel named, with no diagnostic behind it.
 *
 * The 3D fold's refusal is the caller: it names a point, and on a scoped fold the
 * whole-document overlay usually has no row there to activate (measured — see
 * `foldedFigureNotice.ts`). Framing the point directly is the difference between
 * answering "which vertex?" and not.
 *
 * Here rather than in the slice so that `cpCamera` has exactly one consumer, and
 * so both ways of moving the canvas frame identically: a diagnostic carrying only
 * a `point` already reduces to this same degenerate box through
 * {@link boundsFromPoints}, and `frameUserCameraOnBounds` clamps the zoom of one
 * against the document fit.
 */
export function frameCpModelPoint(point: Point): void {
  const bounds = boundsFromPoints([point]);
  if (bounds) cpCamera()?.frameModelBounds(bounds);
}
