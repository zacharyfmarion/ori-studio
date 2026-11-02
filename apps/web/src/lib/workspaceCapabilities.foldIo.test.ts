import { describe, expect, it } from 'vitest';
import { getWorkspaceCapabilities, type WorkspaceCapabilityId, type WorkspaceCapabilityInput } from './workspaceCapabilities';

/** Fold's imports and hand-offs, by the menu ids they are dispatched as. */
const FOLD_IO: WorkspaceCapabilityId[] = [
  'fold.import-cp',
  'fold.import-sample-preliminary-base',
  'fold.import-sample-waterbomb-base',
  'fold.import-sample-pleat-in-eighths',
  'fold.start-from-edit-folded-figure',
  'fold.send-to-edit',
  'fold.export-fold',
  'fold.export-step',
  'fold.export-steps',
];

const IMPORTS = FOLD_IO.filter((id) => id.startsWith('fold.import'));
const OUT = FOLD_IO.filter((id) => id.startsWith('fold.send') || id.startsWith('fold.export'));

function capabilities(input: Partial<WorkspaceCapabilityInput>) {
  return getWorkspaceCapabilities({
    activeEditingContext: 'fold',
    engineReady: true,
    status: 'ready',
    edgeCount: 0,
    creaseCount: 0,
    facetCount: 0,
    hasEditableCreasePattern: false,
    hasImportedCreasePattern: false,
    hasBoxPleatDocument: false,
    boxPleatTreeEdgeCount: 0,
    boxPleatBusy: false,
    boxPleatCanSubdivide: false,
    boxPleatCanUnsubdivide: false,
    hasSimulationModel: false,
    oristudioCpSelectedLineCount: 0,
    oristudioCpSelectedPointCount: 0,
    oristudioCpSelectedCircleCount: 0,
    hasDeletableDesignSelection: false,
    canSaveDesign: false,
    hasProjectDocument: false,
    diagramStepCount: 0,
    hasDeletableDiagramSelection: false,
    diagramDeleteTarget: 'step',
    canCopyDiagramAnnotation: false,
    canPasteDiagramAnnotations: false,
    historyPastCount: 0,
    historyFutureCount: 0,
    clipboard: null,
    selection: { kind: 'tree' },
    ...input,
  });
}

describe('Fold’s imports and hand-offs as capabilities', () => {
  it('are shown only while folding', () => {
    for (const activeEditingContext of ['treemaker-tree', 'crease-pattern', 'diagram', 'references'] as const) {
      const elsewhere = capabilities({ activeEditingContext, foldSequence: { stepCount: 3, readOnly: false, pageAtCursor: true } });
      for (const id of FOLD_IO) expect(elsewhere[id], `${activeEditingContext} ${id}`).toMatchObject({ visible: false, enabled: false });
    }
  });

  it('import into an empty sequence, and send nothing until a step is folded', () => {
    const empty = capabilities({});
    for (const id of IMPORTS) expect(empty[id], id).toMatchObject({ visible: true, enabled: true });
    for (const id of OUT) expect(empty[id], id).toMatchObject({ visible: true, enabled: false, reason: 'Fold a step first' });
    const folded = capabilities({ foldSequence: { stepCount: 1, readOnly: false, pageAtCursor: true } });
    for (const id of OUT) expect(folded[id].enabled, id).toBe(true);
  });

  it('export the step on screen only from a step: not the sheet, nor a turn before the first step', () => {
    const onSheet = capabilities({ foldSequence: { stepCount: 2, readOnly: false, pageAtCursor: false } });
    expect(onSheet['fold.export-step']).toMatchObject({ visible: true, enabled: false, reason: 'Go to a step to export it' });
    // The rest of the sequence still leaves it.
    for (const id of OUT.filter((each) => each !== 'fold.export-step')) expect(onSheet[id].enabled, id).toBe(true);
  });

  it('import nothing into a newer build’s sequence, and into any other after a step', () => {
    const readOnly = capabilities({ foldSequence: { stepCount: 1, readOnly: true, pageAtCursor: true }, hasFoldStartingFigure: true });
    for (const id of IMPORTS) expect(readOnly[id].reason, id).toMatch(/read-only/);
    expect(readOnly['fold.start-from-edit-folded-figure'].enabled).toBe(false);
    // What leaves a read-only sequence is still there to take.
    expect(readOnly['fold.export-fold'].enabled).toBe(true);
    // Whatever its sheet: a polygon takes a pattern of its own shape, as a square does.
    const folded = capabilities({ foldSequence: { stepCount: 2, readOnly: false, pageAtCursor: true } });
    expect(folded['fold.import-cp'].enabled).toBe(true);
  });

  it('start from Edit’s folded figure only when Edit has one', () => {
    expect(capabilities({})['fold.start-from-edit-folded-figure']).toMatchObject({
      enabled: false,
      reason: 'Fold the crease pattern flat in Edit first',
    });
    expect(capabilities({ hasFoldStartingFigure: true })['fold.start-from-edit-folded-figure'].enabled).toBe(true);
  });
});
