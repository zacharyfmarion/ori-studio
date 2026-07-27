import { useWorkspaceStore } from '../../store/workspaceStore/store';
import {
  cpLinesByIds,
  foldedSourceFingerprint,
  isFoldedFigureStale,
  reselectFoldableLineIds,
} from './foldedFigureStaleness';

/**
 * Dev-only console hook: `__foldedStaleDebug()`.
 *
 * A figure that does not read as stale looks identical whatever the reason —
 * missing provenance, a region that no longer selects the edited crease, a
 * fingerprint that genuinely still matches, or simply nothing on screen that
 * surfaces staleness. This reports which it is, per figure, against live state.
 */
declare global {
  var __foldedStaleDebug: (() => unknown) | undefined;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  globalThis.__foldedStaleDebug = () => {
    const state = useWorkspaceStore.getState();
    const document = state.oristudioCpDocument?.document ?? null;
    return {
      hasDocument: document !== null,
      cpRevision: state.oristudioCpRevision,
      totalLines: document?.crease_pattern.line_segments.length ?? 0,
      activeFoldedFigureId: state.oristudioCpActiveFoldedFigureId,
      figures: state.oristudioCpFoldedFigures.map((figure) => {
        const reselected = reselectFoldableLineIds(document, figure.sourceBounds ?? null);
        const nowFingerprint = foldedSourceFingerprint(cpLinesByIds(document, reselected));
        return {
          id: figure.id,
          title: figure.title,
          status: figure.status,
          sourceKind: figure.sourceKind,
          hasBounds: figure.sourceBounds != null,
          bounds: figure.sourceBounds ?? null,
          hasFingerprint: figure.sourceFingerprint != null,
          foldedLineCount: figure.sourceLineIds?.length ?? 0,
          reselectedLineCount: reselected.length,
          fingerprintMatches: nowFingerprint === figure.sourceFingerprint,
          stale: isFoldedFigureStale(document, figure),
        };
      }),
    };
  };
}

/** Imported for its side effect; see the hook above. */
export const foldedFigureStalenessDebugInstalled = true;
