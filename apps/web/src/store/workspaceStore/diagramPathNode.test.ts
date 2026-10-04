import { beforeEach, describe, expect, it } from 'vitest';
import { EDIT_PATH } from '../../diagram/annotate/annotateTools';
import { annotationActionEdit } from '../../diagram/annotate/annotationActions';
import { ARROW_BEND } from '../../diagram/annotate/annotationModel';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { useWorkspaceStore } from '../workspaceStore';
import { selectedDiagramPathNode } from './diagramState';

/**
 * Edit Path's selected node (`diagramSelectedPathNode`): taken against an
 * arrow and its count of nodes, and read through `selectedDiagramPathNode`,
 * which reads none once either has changed — so no edit has to clear it.
 */
const state = () => useWorkspaceStore.getState();
const node = () => selectedDiagramPathNode(state());
const arrow = () => stepsIn(state().diagram!)[0]!.annotations.find((a) => a.id === 'arrow') as KnownDiagramAnnotation;

/** A step with a picture, open in Annotate, carrying a half-circle valley arrow (three nodes) and a line. */
function annotatedStep(): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
  state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
  const stepId = state().diagramSelectedStepId!;
  state().openDiagramStep(stepId, 'annotate');
  state().editDiagramAnnotations(stepId, 'Add annotation', () => [
    { id: 'arrow', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: 0.5 },
    { id: 'line', kind: 'valley-line', from: [0.2, 0.7], to: [0.6, 0.7] },
  ]);
  state().selectDiagramAnnotation('arrow');
  state().setDiagramAnnotateTool(EDIT_PATH);
  return stepId;
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('the node Edit Path has selected', () => {
  it('is a node of the selected fold arrow — an arc’s too — and nothing past its last', () => {
    annotatedStep();
    state().selectDiagramPathNode(2);
    expect(state().diagramSelectedPathNode).toEqual({ annotationId: 'arrow', node: 2, nodes: 3 });
    expect(node()).toBe(2);
    // Selecting it was not an edit: the arc is still an arc.
    expect(arrow().bend).toBe(0.5);
    state().selectDiagramPathNode(3);
    expect(state().diagramSelectedPathNode).toBeNull();
    state().selectDiagramPathNode(1);
    state().selectDiagramPathNode(null);
    expect(node()).toBeNull();
  });

  it('is none for a line, with another tool in hand, or out of Annotate', () => {
    annotatedStep();
    state().selectDiagramPathNode(1);
    state().setDiagramAnnotateTool(null);
    expect(node()).toBeNull();
    // Picked up again, the same node.
    state().setDiagramAnnotateTool(EDIT_PATH);
    expect(node()).toBe(1);
    state().closeDiagramStep();
    expect(node()).toBeNull();
    state().openDiagramStep(state().diagramSelectedStepId!, 'annotate');
    state().selectDiagramAnnotation('arrow');
    state().setDiagramAnnotateTool(EDIT_PATH);
    state().selectDiagramAnnotation('line');
    state().selectDiagramPathNode(0);
    expect(state().diagramSelectedPathNode).toBeNull();
  });

  it('goes with its arrow selected away, and with a count of nodes changed under it', () => {
    const stepId = annotatedStep();
    state().selectDiagramPathNode(2);
    state().selectDiagramAnnotation('line');
    state().selectDiagramAnnotation('arrow');
    // Back on the same arrow with the same nodes, it is the same node again.
    expect(node()).toBe(2);
    // A node added under it: node 2 would mean another one now.
    state().editDiagramAnnotations(stepId, 'Add node', annotationActionEdit('add-node', 'arrow', { node: 0 }).edit);
    expect(arrow().path).toHaveLength(4);
    expect(node()).toBeNull();
  });

  it('follows the edit that says which node to select, and reads none after an undo that takes the node away', () => {
    const stepId = annotatedStep();
    const { label, edit, selectPathNode } = annotationActionEdit('add-node', 'arrow', { node: 1 });
    state().editDiagramAnnotations(stepId, label, edit, { selectPathNode });
    expect(arrow().path).toHaveLength(4);
    expect(node()).toBe(2);
    state().undoDiagram();
    expect(arrow().bend).toBe(0.5);
    expect(node()).toBeNull();
    state().redoDiagram();
    expect(node()).toBe(2);
    // A Reset back to the 60° arc's two nodes: none.
    state().editDiagramAnnotations(stepId, 'Reset', annotationActionEdit('reset-path', 'arrow').edit);
    expect(Math.abs(arrow().bend!)).toBeCloseTo(ARROW_BEND, 12);
    expect(node()).toBeNull();
  });
});
