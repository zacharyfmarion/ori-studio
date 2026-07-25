import { useWorkspaceStore } from '../store/workspaceStore/store';
import { explainSelectedSegment } from '../lib/creasePatternSelectionSegment';
import { ensureCpSegmentationArtifacts } from './cpSegmentationArtifacts';
import { cpOverlayViewStore } from './cpOverlayViewStore';

/**
 * Last render state published by the toolbar. A correct match still renders
 * nothing if the component never mounts (the panel gates it) or if the floating
 * anchor cannot be computed, so matching alone does not explain visibility.
 * `renders === 0` means the component never mounted at all.
 */
export const toolbarRenderProbe = {
  renders: 0,
  hasMatch: false,
  hasContainer: false,
  hasBox: false,
  hasAnchorRect: false,
  hasSegmentation: false,
};

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
    const report = {
      ...diagnosis,
      segmentationMs: elapsedMs,
      render: { ...toolbarRenderProbe },
      overlayViews: cpOverlayViewStore.get() !== null,
      toolbarInDom: typeof globalThis.document !== 'undefined'
        ? globalThis.document.querySelector('.cp-selection-toolbar') !== null
        : false,
    };

    // The closest region is the actionable one; the rest are noise in a document
    // with many regions, so surface it separately from the full report.
    const closest = diagnosis.regions[0];
    console.log('[cp-toolbar]', report.reason, closest ? { closest } : '', report);
    return report;
  };
}

export {};
