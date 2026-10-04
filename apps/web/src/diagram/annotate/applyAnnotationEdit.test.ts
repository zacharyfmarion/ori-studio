import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { KnownDiagramAnnotation } from '../document/diagramDocument';
import { stepsIn } from '../document/diagramSteps.fixtures';
import { annotationActionEdit, nudgePathNodeEdit } from './annotationActions';
import { ARROW_BEND } from './annotationModel';
import { applyAnnotationEdit } from './applyAnnotationEdit';

const tracked = vi.hoisted(() => ({ trackDiagramArrowShaped: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...tracked,
}));

/**
 * The one binding every surface makes the catalog's edits through: one undo
 * step each, and `diagram arrow shaped` counted once — when an arc becomes a
 * path — whichever surface or gesture did it.
 */
const state = () => useWorkspaceStore.getState();
const annotations = () => stepsIn(state().diagram!)[0]!.annotations as KnownDiagramAnnotation[];

function stepWith(list: KnownDiagramAnnotation[]): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
  state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
  const stepId = state().diagramSelectedStepId!;
  state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
  return stepId;
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  tracked.trackDiagramArrowShaped.mockClear();
});

describe('applyAnnotationEdit', () => {
  it('counts an arc shaped once, by the gesture that shaped it, and never the edits after', () => {
    const stepId = stepWith([{ id: 'm', kind: 'mountain-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: ARROW_BEND }]);
    const past = state().diagramHistory.past.length;
    expect(applyAnnotationEdit(state(), stepId, nudgePathNodeEdit('m', 1, [0.01, 0]))).toBe(true);
    expect(annotations()[0]!.path).toHaveLength(2);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['mountain_arrow', 'nudge']]);
    applyAnnotationEdit(state(), stepId, annotationActionEdit('add-node', 'm', { node: 0 }));
    expect(annotations()[0]!.path).toHaveLength(3);
    expect(tracked.trackDiagramArrowShaped).toHaveBeenCalledOnce();
  });

  it('counts an arc shaped again after a Reset, and not the Reset', () => {
    const stepId = stepWith([{ id: 'f', kind: 'fold-unfold-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: 0.5 }]);
    applyAnnotationEdit(state(), stepId, annotationActionEdit('corner-node', 'f', { node: 1 }));
    applyAnnotationEdit(state(), stepId, annotationActionEdit('reset-path', 'f'));
    expect(annotations()[0]!.path).toBeUndefined();
    applyAnnotationEdit(state(), stepId, annotationActionEdit('add-node', 'f', { node: 0 }));
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([
      ['fold_unfold_arrow', 'node_type'],
      ['fold_unfold_arrow', 'add_node'],
    ]);
  });

  it('counts nothing for an edit that changed nothing, deleted the arrow, or was not a shaping one', () => {
    const stepId = stepWith([{ id: 'v', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: ARROW_BEND }]);
    // A 60° arc has no node between its ends to make a corner of.
    expect(applyAnnotationEdit(state(), stepId, annotationActionEdit('corner-node', 'v', { node: 0 }))).toBe(false);
    applyAnnotationEdit(state(), stepId, annotationActionEdit('flip-arc', 'v'));
    expect(annotations()[0]!.bend).toBeCloseTo(-ARROW_BEND, 12);
    // Its last node out of two: the arrow goes, unshaped.
    applyAnnotationEdit(state(), stepId, annotationActionEdit('delete-node', 'v', { node: 1 }));
    expect(annotations()).toHaveLength(0);
    expect(tracked.trackDiagramArrowShaped).not.toHaveBeenCalled();
  });

  it('selects the node the edit names, on the arrow selected', () => {
    const stepId = stepWith([{ id: 'v', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: ARROW_BEND }]);
    state().selectDiagramAnnotation('v');
    applyAnnotationEdit(state(), stepId, annotationActionEdit('add-node', 'v', { node: 0 }));
    expect(state().diagramSelectedPathNode).toEqual({ annotationId: 'v', node: 1, nodes: 3 });
  });
});
