import { useWorkspaceStore } from '../store/workspaceStore/store';
import { explainSelectedSegment } from '../lib/creasePatternSelectionSegment';
import { ensureCpSegmentationArtifacts } from './cpSegmentationArtifacts';

/**
 * Dev-only console hook: `await __cpToolbarDebug()`.
 *
 * The selection toolbar renders nothing whenever the selection does not resolve
 * to exactly one border-enclosed crease pattern, and every distinct rejection
 * reason looks the same from the outside. This reports which precondition failed
 * and how far each region was from matching, against the live selection.
 */
declare global {
  var __cpToolbarDebug: (() => Promise<unknown>) | undefined;
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  globalThis.__cpToolbarDebug = async () => {
    const state = useWorkspaceStore.getState();
    const document = state.oristudioCpDocument?.document ?? null;
    const started = performance.now();
    const artifacts = await ensureCpSegmentationArtifacts(document);
    const elapsedMs = Math.round(performance.now() - started);
    const diagnosis = explainSelectedSegment(document, state.oristudioCpSelection, artifacts);
    const report = { ...diagnosis, segmentationMs: elapsedMs };

    console.log('[cp-toolbar]', report.reason, report);
    return report;
  };
}

export {};
