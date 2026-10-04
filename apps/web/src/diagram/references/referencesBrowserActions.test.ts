import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, createStep, insertSteps } from '../document/diagramDocument';
import { referencesStep, stepsIn } from '../document/diagramSteps.fixtures';
import { fillStepFromReferences, openReferencesBrowser, replaceStepFromReferences } from './referencesBrowserActions';

const analytics = vi.hoisted(() => ({ trackDiagramReferencesBrowserOpened: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const state = () => useWorkspaceStore.getState();

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  const diagram = insertSteps(
    createDiagram({ title: 'D' }),
    [
      referencesStep('step-r', { plan: 'plan-a', mode: 'find', card: 3, line: { n: [0, 1], d: 0.25 } }),
      createStep(() => 'step-empty'),
    ],
    0
  );
  useWorkspaceStore.setState({ diagram });
});

describe('the ways into the References browser', () => {
  it('opens for the end with no step selected, and counts where', () => {
    openReferencesBrowser();
    expect(state().diagramReferencesBrowser?.anchor).toEqual({ kind: 'end' });
    expect(analytics.trackDiagramReferencesBrowserOpened).toHaveBeenCalledWith('end');
  });

  it('fills a selected empty step, and adds after any other (D2)', () => {
    state().selectDiagramStep('step-empty');
    openReferencesBrowser();
    expect(state().diagramReferencesBrowser?.anchor).toEqual({ kind: 'fill', stepId: 'step-empty' });
    state().selectDiagramStep('step-r');
    openReferencesBrowser();
    expect(state().diagramReferencesBrowser?.anchor).toEqual({ kind: 'after', stepId: 'step-r' });
  });

  it('fills the step it was asked from, and selects it', () => {
    fillStepFromReferences('step-empty');
    expect(state().diagramReferencesBrowser?.anchor).toEqual({ kind: 'fill', stepId: 'step-empty' });
    expect(state().diagramSelectedStepId).toBe('step-empty');
  });

  it('replaces a References step’s card, opened on the plan and mode it came from with its card marked', () => {
    replaceStepFromReferences('step-r');
    expect(state().diagramReferencesBrowser).toMatchObject({
      anchor: { kind: 'replace', stepId: 'step-r' },
      mode: 'find',
      pattern: 'plan-a',
      shown: { plan: 'plan-a', card: 3, line: { n: [0, 1], d: 0.25 } },
    });
    // No pattern open to find its sheet in: it opens on the sheet where it was.
    const step = stepsIn(state().diagram!)[0]!;
    if (step.source?.kind !== 'references-step') throw new Error('a References step');
    expect(state().diagramReferencesBrowser?.sheet).toEqual(step.source.region.boundary);
    expect(analytics.trackDiagramReferencesBrowserOpened).toHaveBeenCalledWith('replace');
    // Only a References step has a card to replace.
    state().closeDiagramReferencesBrowser();
    replaceStepFromReferences('step-empty');
    expect(state().diagramReferencesBrowser).toBeNull();
  });
});
