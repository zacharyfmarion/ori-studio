import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { blankCpLineage } from '../../lib/oristudioCpLineage';
import { DEFAULT_CREASE_COLOR_MODE } from '../../lib/sampleProject';
import { discardCpDocumentState, type CpDocumentScopedState } from './cpDocumentState';
import { staleFoldArtifactResourceState } from './foldArtifactResource';
import type { WorkspaceState } from './types';

/**
 * The complete editor state for a freshly seeded blank editable crease pattern —
 * the single source of truth shared by `createNewCreasePattern` (File › New) and
 * the Edit surface's self-provision (`ensureEditCreasePattern`), so the two paths
 * can never drift. Divergence here is what broke undo on the self-provisioned
 * canvas: `ensureEditCreasePattern` used to omit `projectLoadId` /
 * `oristudioCpRevision` / `activePanelId` (and the image + tool fields), so the
 * interactive draw → history flow never re-baselined and recorded nothing.
 *
 * Scoped to the CP editor: it deliberately does NOT touch the tree/design fields
 * (`project`, `designMethod`), so a caller can seed a
 * canvas without discarding an authored design.
 */
export function freshEditableCpState(
  document: OristudioCpDocumentState,
  previous: Pick<WorkspaceState, 'projectLoadId' | 'foldArtifactRevision'>
): CpDocumentScopedState & Partial<WorkspaceState> {
  return {
    // Everything scoped to the document this replaces, discarded — then the
    // fields below say what the new one starts with. Returning the type in full
    // rather than a `Partial` is what makes a newly added per-document field a
    // compile error here instead of state that quietly outlives its document.
    ...discardCpDocumentState(),
    activePanelId: 'crease-pattern',
    // The CP editor is ready as soon as the document exists (it runs on the CP
    // worker, independent of the treemaker engine). Without this the status stays
    // 'loading_engine' on the self-provision path, so `isBusy` disables undo/redo
    // and every other engine-gated command even though the canvas is editable.
    status: 'crease_pattern_ready',
    // The three the new document brings; everything else scoped to it is at the
    // empty state the discard above returned.
    oristudioCpDocument: document,
    oristudioCpLineage: blankCpLineage(),
    oristudioCpOperationDescriptors: document.operationDescriptors,
    // An editable document exists again, so whatever refused the last file is
    // no longer the reason the canvas is empty. Cleared here rather than in
    // `discardCpDocumentState` because it describes the *absence* of a
    // document, not state belonging to one: a discard on its own must leave it
    // standing, which is exactly what stops the self-provision erasing it.
    cpLoadFailure: null,
    projectLoadId: previous.projectLoadId + 1,
    toolMode: 'select',
    symmetryAuthoringPairs: [],
    creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
    // This blank canvas is now what the Simulate workspace reads, so anything
    // derived from the document it replaces has to go with it.
    ...staleFoldArtifactResourceState(previous.foldArtifactRevision),
  };
}
