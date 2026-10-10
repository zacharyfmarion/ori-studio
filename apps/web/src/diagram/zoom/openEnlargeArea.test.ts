import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, insertSteps, type KnownDiagramAnnotation } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { openEnlargeArea } from './openEnlargeArea';

const analytics = vi.hoisted(() => ({ trackDiagramStepOpened: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const state = () => useWorkspaceStore.getState();

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  vi.clearAllMocks();
});

describe('openEnlargeArea (Revision 2)', () => {
  it('opens the area’s step in Annotate with the area selected, counted as opened from an enlarge arrow', () => {
    const area: KnownDiagramAnnotation = { id: 'area-1', kind: 'zoom', from: [0.5, 0.4], to: [0.5, 0.4], radius: 0.2 };
    const diagram = insertSteps(createDiagram({ title: 'Crane' }), [{ ...cpStep('step-area'), annotations: [area] }], 0);
    useWorkspaceStore.setState({ diagram });
    expect(openEnlargeArea('step-area', 'area-1')).toBe(true);
    expect(state().diagramDetail).toBe('annotate');
    expect(state().diagramSelectedStepId).toBe('step-area');
    expect(state().diagramSelectedAnnotationId).toBe('area-1');
    expect(analytics.trackDiagramStepOpened).toHaveBeenCalledExactlyOnceWith('enlarge_arrow', 'annotate');
    // A step no longer in the diagram opens nothing and counts nothing.
    expect(openEnlargeArea('step-gone', 'area-1')).toBe(false);
    expect(analytics.trackDiagramStepOpened).toHaveBeenCalledOnce();
  });
});
