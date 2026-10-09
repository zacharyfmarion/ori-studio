import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { stepById } from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { DiagramAnchorPickBar } from './DiagramAnchorPickBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const store = useWorkspaceStore.getState;
const initial = useWorkspaceStore.getInitialState();
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function pointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query === '(pointer: coarse)',
    addEventListener() {},
    removeEventListener() {},
  }));
}

/** A step open in Annotate with an enlarge area and an x-ray on it, the one `target` names selected. */
function annotating(target: 'area' | 'xray'): string {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"/>';
  store().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 40, heightPx: 30, bytes: svg.length }]);
  const stepId = store().diagramSelectedStepId!;
  store().editDiagramAnnotations(stepId, 'Add annotation', () => [
    { id: 'area', kind: 'zoom', from: [0.5, 0.5], to: [0.5, 0.5], radius: 0.1 },
    { id: 'xray', kind: 'x-ray', from: [0.3, 0.3], to: [0.3, 0.3], radius: 0.1, depth: 1 },
  ]);
  store().openDiagramStep(stepId, 'annotate');
  store().selectDiagramAnnotation(target);
  return stepId;
}

function render() {
  const step = stepById(store().diagram!, store().diagramSelectedStepId!)!;
  act(() => root!.render(<DiagramAnchorPickBar step={step} />));
}

const bar = () => host!.querySelector<HTMLElement>('[data-anchor-pick-bar]');

beforeEach(() => {
  useWorkspaceStore.setState(initial, true);
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe('the anchor pick’s bar on a touch screen (review of 18f)', () => {
  it('says what the canvas waits for while a pick is armed, and Cancel puts it down', () => {
    pointer(true);
    let stepId = '';
    act(() => {
      stepId = annotating('xray');
    });
    render();
    expect(bar()).toBeNull();
    act(() => store().setDiagramAnchorPick({ stepId, target: 'xray' }));
    render();
    expect(bar()!.getAttribute('role')).toBe('group');
    expect(bar()!.textContent).toContain('Tap the point where the layers are counted');
    const cancel = [...bar()!.querySelectorAll('button')].find((button) => button.textContent === 'Cancel')!;
    act(() => cancel.click());
    expect(store().diagramAnchorPick).toBeNull();
    render();
    expect(bar()).toBeNull();
  });

  it('asks for a face for an enlarge area’s anchor', () => {
    pointer(true);
    let stepId = '';
    act(() => {
      stepId = annotating('area');
      store().setDiagramAnchorPick({ stepId, target: 'area' });
    });
    render();
    expect(bar()!.textContent).toContain('Tap a face to anchor to it');
  });

  it('shows nothing under a fine pointer, where the Layers pane stays in view with Pick pressed and Escape', () => {
    pointer(false);
    act(() => {
      const stepId = annotating('xray');
      store().setDiagramAnchorPick({ stepId, target: 'xray' });
    });
    render();
    expect(bar()).toBeNull();
  });
});
