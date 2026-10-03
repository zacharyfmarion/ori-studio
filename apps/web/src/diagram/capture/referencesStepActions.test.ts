import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requestedSheet } from '../../cp-workspace/references/useReferencesSheetRequest';
import type { SheetAnalysis } from '../../cp-workspace/references/sheetFrames';
import { useLayoutStore } from '../../store/layoutStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, createStep, insertSteps } from '../document/diagramDocument';
import { referencesStep } from '../document/diagramSteps.fixtures';
import { askReferencesForStep, openDiagramStepInReferences } from './referencesStepActions';

const analytics = vi.hoisted(() => ({ trackDiagramSourceOpened: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(initialState, true);
  const diagram = insertSteps(
    createDiagram({ title: 'Sent' }),
    [referencesStep('step-find', { mode: 'find', settings: null }), createStep(() => 'step-empty')],
    0
  );
  useWorkspaceStore.setState({ diagram });
  useLayoutStore.getState().activatePanel = vi.fn();
});

describe('Open in References', () => {
  it('asks References for the step’s sheet, in the mode it came from, and counts it', () => {
    openDiagramStepInReferences('step-find');
    const step = state().diagram!.steps[0]!;
    if (step.source?.kind !== 'references-step') throw new Error('sent');
    expect(state().referencesSheetRequest).toEqual({ boundary: step.source.region.boundary, mode: 'find' });
    expect(useLayoutStore.getState().activatePanel).toHaveBeenCalledWith('references');
    expect(analytics.trackDiagramSourceOpened).toHaveBeenCalledWith('references');
    // Taken once.
    expect(state().takeReferencesSheetRequest()).not.toBeNull();
    expect(state().takeReferencesSheetRequest()).toBeNull();
  });

  it('does nothing for a step not sent from References', () => {
    openDiagramStepInReferences('step-empty');
    expect(state().referencesSheetRequest).toBeNull();
    expect(analytics.trackDiagramSourceOpened).not.toHaveBeenCalled();
  });

  it('finds the sheet by its rim, whichever corner its outline starts from', () => {
    const frames = {
      components: [
        { id: 4, outline: [[2, 0], [3, 0], [3, 1], [2, 1]] },
        { id: 7, outline: [[1, 1], [0, 1], [0, 0], [1, 0]] },
      ],
    } as unknown as SheetAnalysis;
    const step = state().diagram!.steps[0]!;
    if (step.source?.kind !== 'references-step') throw new Error('sent');
    expect(requestedSheet(frames, step.source.region.boundary)?.id).toBe(7);
    expect(requestedSheet(frames, [[{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 6, y: 6 }]])).toBeUndefined();
  });
});

describe('From References…', () => {
  it('waits for a step from References, and opens it', () => {
    askReferencesForStep('step-empty');
    expect(state().diagramReferencesTarget).toBe('step-empty');
    expect(state().diagramSelectedStepId).toBe('step-empty');
    expect(useLayoutStore.getState().activatePanel).toHaveBeenCalledWith('references');
    state().cancelDiagramReferencesTarget();
    expect(state().diagramReferencesTarget).toBeNull();
  });

  it('asks nothing on a read-only diagram', () => {
    useWorkspaceStore.setState({ diagramReadOnly: true });
    askReferencesForStep('step-empty');
    expect(state().diagramReferencesTarget).toBeNull();
    expect(useLayoutStore.getState().activatePanel).not.toHaveBeenCalled();
  });
});
