import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { resolveCpSegments } from '../../lib/creasePatternSegmentation';
import {
  cpLinesByIds,
  foldedSourceFingerprint,
  reselectFoldableLineIds,
} from '../../lib/foldedFigureStaleness';
import {
  isInlineSimulationStale,
  resolveInlineSimulationSegment,
} from './inlineSimulation';
import { getInlineSimulationSource } from './inlineSimulationRuntime';

/**
 * Dev-only console hook: `__inlineSimStaleDebug()`.
 *
 * A window that does not read as stale looks identical whatever the reason —
 * missing provenance, a bounding box that no longer covers the edited crease, a
 * fingerprint that genuinely still matches, or nothing on screen surfacing it.
 * This reports which, per window, against live state. The sibling
 * `__foldedStaleDebug()` exists for the same reason.
 *
 * It also reports whether each window can still find its region, since that is
 * the other way a refresh fails and is equally invisible from outside.
 */
declare global {
  var __inlineSimStaleDebug: (() => unknown) | undefined;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  globalThis.__inlineSimStaleDebug = () => {
    const state = useWorkspaceStore.getState();
    const document = state.oristudioCpDocument?.document ?? null;
    const segments = resolveCpSegments(state.foldArtifacts);
    return {
      hasDocument: document !== null,
      cpRevision: state.oristudioCpRevision,
      totalLines: document?.crease_pattern.line_segments.length ?? 0,
      segments: segments.length,
      focusedId: state.oristudioCpFocusedInlineSimulationId,
      windows: state.oristudioCpInlineSimulations.map((simulation) => {
        const reselected = reselectFoldableLineIds(document, simulation.sourceBounds ?? null);
        const now = foldedSourceFingerprint(cpLinesByIds(document, reselected));
        const segment = resolveInlineSimulationSegment(simulation, segments);
        return {
          id: simulation.id,
          hasBoundary: simulation.sourceBoundary !== null,
          boundaryRings: simulation.sourceBoundary?.length ?? 0,
          hasBounds: simulation.sourceBounds != null,
          bounds: simulation.sourceBounds ?? null,
          hasFingerprint: simulation.sourceFingerprint != null,
          reselectedLineCount: reselected.length,
          fingerprintMatches: now === simulation.sourceFingerprint,
          stale: isInlineSimulationStale(document, simulation),
          segmentIdHint: simulation.segmentIdHint,
          // Null here means a refresh would report the region as gone, which is
          // a different failure from being stale and reads the same on screen.
          resolvesToSegmentId: segment?.id ?? null,
          hasFold: getInlineSimulationSource(simulation.id) !== null,
          foldPercent: simulation.foldPercent,
        };
      }),
    };
  };
}

/** Imported for its side effect; see the hook above. */
export const inlineSimulationStalenessDebugInstalled = true;
