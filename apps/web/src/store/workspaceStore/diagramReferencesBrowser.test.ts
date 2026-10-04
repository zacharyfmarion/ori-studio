import { beforeEach, describe, expect, it } from 'vitest';
import type { SentReferencesStep } from '../../diagram/document/diagramDocument';
import { referencesSource, stepDiagramPicture, stepsIn } from '../../diagram/document/diagramSteps.fixtures';
import { useWorkspaceStore } from '../workspaceStore';

/** The References browser in the Diagram's centre (D20), through the store. */
const state = () => useWorkspaceStore.getState();
const card = (n: number): SentReferencesStep => ({
  source: referencesSource({ card: n }),
  picture: stepDiagramPicture(),
  text: `Fold ${n}.`,
});

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('the References browser', () => {
  it('opens over the Diagram, the step it is for selected and its detail left open behind it, and a step opened closes it', () => {
    const stepId = state().addDiagramStep()!;
    const other = state().addDiagramStep()!;
    state().openDiagramStep(other);
    expect(state().openDiagramReferencesBrowser({ kind: 'fill', stepId })).toBe(true);
    expect(state()).toMatchObject({
      diagramDetail: 'pose',
      diagramSelectedStepId: stepId,
      diagramReferencesBrowser: { anchor: { kind: 'fill', stepId }, mode: 'sequence', pattern: null, shown: null },
    });
    state().setDiagramReferencesBrowser({ mode: 'find' });
    expect(state().diagramReferencesBrowser?.mode).toBe('find');
    state().openDiagramStep(stepId);
    expect(state().diagramReferencesBrowser).toBeNull();
  });

  it('adds what it pulls as one undo step, the last selected, and closes', () => {
    const first = state().addDiagramStep()!;
    const last = state().addDiagramStep()!;
    state().openDiagramReferencesBrowser({ kind: 'after', stepId: first });
    const past = state().diagramHistory.past.length;
    const { stepIds } = state().pullReferencesDiagramSteps([card(1), card(2)], { kind: 'after', stepId: first }, {
      loadId: state().diagramLoadId,
      label: 'Add steps from References',
    })!;
    expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first, ...stepIds, last]);
    expect(state().diagramHistory.past.length).toBe(past + 1);
    expect(state().diagramSelectedStepId).toBe(stepIds[1]);
    expect(state().diagramReferencesBrowser).toBeNull();
    state().undoDiagram();
    expect(stepsIn(state().diagram!).map((step) => step.id)).toEqual([first, last]);
  });

  it('drops a pull pressed in a browser that has closed since: nothing added, the open one left open', () => {
    const stepId = state().addDiagramStep()!;
    state().openDiagramReferencesBrowser({ kind: 'after', stepId });
    const first = state().diagramReferencesBrowser!.opening;
    state().closeDiagramReferencesBrowser();
    state().openDiagramReferencesBrowser({ kind: 'after', stepId });
    const label = 'Add step from References';
    expect(state().pullReferencesDiagramSteps([card(1)], { kind: 'after', stepId }, { loadId: state().diagramLoadId, label, opening: first })).toBeNull();
    expect(state().diagram!.steps).toHaveLength(1);
    expect(state().diagramReferencesBrowser).not.toBeNull();
    // Pressed in the one open now, it lands.
    const now = state().diagramReferencesBrowser!.opening;
    expect(state().pullReferencesDiagramSteps([card(1)], { kind: 'after', stepId }, { loadId: state().diagramLoadId, label, opening: now })?.stepIds).toHaveLength(1);
  });

  it('drops a pull begun against a diagram that has since been replaced, and refuses on a read-only one', () => {
    state().addDiagramStep();
    const loadId = state().diagramLoadId;
    useWorkspaceStore.setState({ diagramLoadId: loadId + 1 });
    expect(state().pullReferencesDiagramSteps([card(1)], { kind: 'end' }, { loadId, label: 'Add' })).toBeNull();
    useWorkspaceStore.setState({ diagramReadOnly: true });
    expect(state().openDiagramReferencesBrowser({ kind: 'end' })).toBe(false);
  });
});
