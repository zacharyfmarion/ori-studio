import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';
import { emptyOristudioCpSelection } from '../../lib/creasePatternViewport';
import { blankCpLineage } from '../../lib/oristudioCpLineage';
import { DEFAULT_CREASE_COLOR_MODE } from '../../lib/sampleProject';
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
 * (`project`, `workflowTarget`, `pendingDesignChoice`), so a caller can seed a
 * canvas without discarding an authored design.
 */
export function freshEditableCpState(
  document: OristudioCpDocumentState,
  previousProjectLoadId: number
): Partial<WorkspaceState> {
  return {
    activePanelId: 'crease-pattern',
    // The CP editor is ready as soon as the document exists (it runs on the CP
    // worker, independent of the treemaker engine). Without this the status stays
    // 'loading_engine' on the self-provision path, so `isBusy` disables undo/redo
    // and every other engine-gated command even though the canvas is editable.
    status: 'crease_pattern_ready',
    oristudioCpDocument: document,
    oristudioCpLineage: blankCpLineage(),
    oristudioCpOperationDescriptors: document.operationDescriptors,
    oristudioCpError: null,
    oristudioCpCamvResult: null,
    oristudioCpHistoryPast: [],
    oristudioCpHistoryFuture: [],
    oristudioCpSelection: emptyOristudioCpSelection(),
    oristudioCpActiveDiagnosticId: null,
    oristudioCpRevision: 0,
    oristudioCpFoldedFigures: [],
    oristudioCpActiveFoldedFigureId: null,
    oristudioCpImages: [],
    oristudioCpImageEditMode: false,
    oristudioCpSelectedImageId: null,
    oristudioCpDocumentExtensions: {},
    projectLoadId: previousProjectLoadId + 1,
    toolMode: 'select',
    symmetryAuthoringPairs: [],
    creaseColorMode: DEFAULT_CREASE_COLOR_MODE,
  };
}
