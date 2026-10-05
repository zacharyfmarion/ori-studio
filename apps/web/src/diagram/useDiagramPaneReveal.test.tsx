import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLayoutStore } from '../store/layoutStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { resetDiagramPaneRevealForTests, useDiagramPaneReveal } from './useDiagramPaneReveal';

vi.mock('../lib/pointerGesture', () => ({ runAfterPointerGesture: (run: () => void) => run() }));
const pointer = vi.hoisted(() => ({ coarse: false }));
vi.mock('../platform/pointerSurface', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/pointerSurface')>()),
  isCoarsePointerSurface: () => pointer.coarse,
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * A dock with the Step, Page and Layers tabs in one group; `shown` is the one
 * on top. A tab put on top — by a reveal, or by the user's press — is the
 * group's change, which it tells its listeners of, as dockview does.
 */
let shown = 'diagram-step';
const listeners = new Set<() => void>();
const group = {
  get activePanel() {
    return { id: shown };
  },
  api: {
    onDidActivePanelChange: (listener: () => void) => {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  },
};
function show(id: string) {
  if (shown === id) return;
  shown = id;
  for (const listener of [...listeners]) listener();
}
const activatePanel = vi.fn(show);
const panels = Object.fromEntries(
  ['diagram-step', 'diagram-page', 'diagram-layers'].map((id) => [
    id,
    {
      id,
      group,
      api: {
        get isVisible() {
          return shown === id;
        },
      },
    },
  ])
);

function Probe() {
  useDiagramPaneReveal();
  return null;
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  shown = 'diagram-step';
  listeners.clear();
  activatePanel.mockClear();
  pointer.coarse = false;
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useLayoutStore.setState({
    activatePanel,
    dockviewApi: { getPanel: (id: string) => panels[id] } as never,
  });
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<Probe />));
});
afterEach(() => {
  act(() => root.unmount());
  resetDiagramPaneRevealForTests();
});

const state = () => useWorkspaceStore.getState();

/** A step with a picture and two marks, open in Annotate. */
function annotating() {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"/>';
  act(() => {
    state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 40, heightPx: 30, bytes: svg.length }]);
  });
  const stepId = state().diagramSelectedStepId!;
  act(() => {
    state().editDiagramAnnotations(stepId, 'Add annotation', () => [
      { id: 'a-1', kind: 'valley-arrow', from: [0.1, 0.2], to: [0.5, 0.2], bend: 0.1 },
      { id: 'a-2', kind: 'circle', from: [0.5, 0.5], to: [0.5, 0.5] },
    ]);
    state().openDiagramStep(stepId, 'annotate');
  });
  activatePanel.mockClear();
  return stepId;
}

describe('useDiagramPaneReveal', () => {
  it('brings Page forward on switching to Pages, and Step back on switching to Steps', () => {
    act(() => state().setDiagramView('pages'));
    expect(shown).toBe('diagram-page');
    act(() => state().setDiagramView('steps'));
    expect(shown).toBe('diagram-step');
  });

  it('brings Step forward when a different step is selected, and leaves the user’s tab otherwise', () => {
    const [first, second] = [state().addDiagramStep()!, state().addDiagramStep()!];
    act(() => state().selectDiagramStep(null));
    shown = 'diagram-page';
    act(() => state().setDiagramStepText(first, 'An edit is not a selection.'));
    expect(shown).toBe('diagram-page');
    act(() => state().selectDiagramStep(second));
    expect(shown).toBe('diagram-step');
    // Deselecting brings nothing forward.
    shown = 'diagram-page';
    act(() => state().selectDiagramStep(null));
    expect(shown).toBe('diagram-page');
  });

  it('never brings a tab forward on touch, where the panes are a drawer', () => {
    pointer.coarse = true;
    act(() => state().setDiagramView('pages'));
    annotating();
    act(() => state().selectDiagramAnnotation('a-1'));
    expect(activatePanel).not.toHaveBeenCalled();
  });

  describe('Layers', () => {
    it('comes forward when a mark is selected, stays for the next, and gives Step back when it is let go', () => {
      annotating();
      act(() => state().selectDiagramAnnotation('a-1'));
      expect(shown).toBe('diagram-layers');
      act(() => state().selectDiagramAnnotation('a-2'));
      expect(shown).toBe('diagram-layers');
      expect(activatePanel).toHaveBeenCalledTimes(1);
      act(() => state().selectDiagramAnnotation(null));
      expect(shown).toBe('diagram-step');
    });

    it('gives back whichever tab it covered: Page, from where the reader was', () => {
      annotating();
      show('diagram-page');
      act(() => state().selectDiagramAnnotation('a-1'));
      expect(shown).toBe('diagram-layers');
      act(() => state().selectDiagramAnnotation(null));
      expect(shown).toBe('diagram-page');
    });

    it('leaves a tab the user chose: Layers picked by hand stays when the mark is let go', () => {
      annotating();
      show('diagram-layers');
      act(() => state().selectDiagramAnnotation('a-1'));
      act(() => state().selectDiagramAnnotation(null));
      expect(shown).toBe('diagram-layers');
      expect(activatePanel).not.toHaveBeenCalled();
    });

    it('leaves a tab the user changed to while a mark was selected', () => {
      annotating();
      act(() => state().selectDiagramAnnotation('a-1'));
      expect(shown).toBe('diagram-layers');
      show('diagram-page');
      act(() => state().selectDiagramAnnotation(null));
      expect(shown).toBe('diagram-page');
    });

    it('comes forward for a mark that is its subject only: one selected out of Annotate is not', () => {
      const stepId = annotating();
      act(() => state().closeDiagramStep());
      act(() => {
        state().selectDiagramStep(stepId);
        state().selectDiagramAnnotation('a-1');
      });
      expect(state().diagramSelectedAnnotationId).toBe('a-1');
      expect(shown).toBe('diagram-step');
    });
  });
});
