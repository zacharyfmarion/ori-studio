import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramAnnotateCanvas } from './DiagramAnnotateCanvas';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';

const tracked = vi.hoisted(() => ({ trackDiagramAnnotationAdded: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...tracked,
}));

/**
 * The Annotate canvas's presses, through the store: what a drag, a click, a
 * second finger and a cancel each commit, and what they count. The overlay's
 * screen matrix is the identity, so a client point is a world point.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const initialState = useWorkspaceStore.getInitialState();
const state = () => useWorkspaceStore.getState();
let host: HTMLDivElement;
let root: Root;

const identity = {
  a: 1,
  b: 0,
  c: 0,
  d: 1,
  e: 0,
  f: 0,
  inverse() {
    return identity;
  },
};

beforeEach(() => {
  useWorkspaceStore.setState(initialState, true);
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  );
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal(
    'DOMPoint',
    class {
      constructor(
        public x: number,
        public y: number
      ) {}
      matrixTransform() {
        return { x: this.x, y: this.y };
      }
    }
  );
  (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => identity;
  Element.prototype.setPointerCapture = () => undefined;
  tracked.trackDiagramAnnotationAdded.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** A step with a 400 × 300 picture, open in Annotate, and the canvas on it. */
function mount({ readOnly = false } = {}) {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
  act(() => {
    state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
  });
  const stepId = state().diagramSelectedStepId!;
  act(() => {
    state().openDiagramStep(stepId, 'annotate');
  });
  rerender(readOnly);
  return stepId;
}

function rerender(readOnly = false) {
  const { diagram } = state();
  const step = stepsIn(diagram!).find((candidate) => candidate.id === state().diagramSelectedStepId)!;
  act(() =>
    root.render(
      <TooltipProvider>
        <DiagramAnnotateCanvas step={step} assets={diagram!.assets} style={diagram!.style} readOnly={readOnly} />
      </TooltipProvider>
    )
  );
}

const overlay = () => host.querySelector('svg[data-annotate-overlay]') as SVGSVGElement;
/** The camera's surface, the stage: the library's wrapper, which the view holds with the zoom pill over it. */
const stage = () => overlay().closest('.react-transform-wrapper') as HTMLDivElement;
const view = () => host.querySelector('[data-tool]') as HTMLDivElement;

/** Picture units to the client: the frame's group is translated, one unit 1000 world px. */
function at(u: number, v: number): [number, number] {
  const [, x, y] = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(overlay().querySelector(':scope > g')!.getAttribute('transform')!)!.map(Number);
  return [x! + u * 1000, y! + v * 1000];
}

function pointer(
  type: string,
  [clientX, clientY]: [number, number],
  pointerId = 1,
  pointerType = 'mouse',
  target: Element = overlay()
) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0 });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  act(() => {
    target.dispatchEvent(event);
  });
}

function drag(
  from: [number, number],
  to: [number, number],
  pointerId = 1,
  pointerType = 'mouse',
  target: Element = overlay()
) {
  pointer('pointerdown', from, pointerId, pointerType, target);
  for (let i = 1; i <= 4; i += 1) {
    pointer(
      'pointermove',
      [from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4],
      pointerId,
      pointerType,
      target
    );
  }
  pointer('pointerup', to, pointerId, pointerType, target);
}

/** A `touchstart` with `fingers` touches down, as a browser sends one. */
function touchStart(target: Element, fingers: number) {
  const event = new Event('touchstart', { bubbles: true, cancelable: true });
  const touches = Array.from({ length: fingers }, (_, index) => {
    const at = { clientX: 100 + 50 * index, clientY: 100, pageX: 100 + 50 * index, pageY: 100 };
    return { ...at, identifier: index, target };
  });
  Object.defineProperty(event, 'touches', { value: touches });
  act(() => {
    target.dispatchEvent(event);
  });
}

const annotations = () => stepsIn(state().diagram!)[0]!.annotations as KnownDiagramAnnotation[];
const tool = (kind: Parameters<ReturnType<typeof state>['setDiagramAnnotateTool']>[0]) =>
  act(() => state().setDiagramAnnotateTool(kind));

describe('DiagramAnnotateCanvas', () => {
  it('draws an arrow with a drag, as one undo step, and counts it once by its tool', () => {
    mount();
    tool('valley-arrow');
    const past = state().diagramHistory.past.length;
    drag(at(0.2, 0.3), at(0.6, 0.3));
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]).toMatchObject({ kind: 'valley-arrow' });
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.2, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['valley_arrow']]);
  });

  it('puts a sign down with a click, and draws nothing for a click with a line tool', () => {
    mount();
    tool('valley-line');
    pointer('pointerdown', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()).toHaveLength(0);
    tool('turn-over');
    pointer('pointerdown', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations().map((annotation) => annotation.kind)).toEqual(['turn-over']);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['turn_over']]);
  });

  it('puts Select back in hand once a label is placed, and keeps a drawing tool after a stroke', () => {
    mount();
    tool('valley-line');
    drag(at(0.2, 0.5), at(0.6, 0.5));
    expect(state().diagramAnnotateTool).toBe('valley-line');
    tool('label');
    pointer('pointerdown', at(0.5, 0.2));
    pointer('pointerup', at(0.5, 0.2));
    expect(annotations().map((annotation) => annotation.kind)).toEqual(['valley-line', 'label']);
    expect(state().diagramAnnotateTool).toBeNull();
  });

  it('drops the stroke in hand for a second finger, a cancel or a lost capture', () => {
    mount();
    tool('valley-line');
    pointer('pointerdown', at(0.2, 0.5), 1, 'touch');
    pointer('pointermove', at(0.4, 0.5), 1, 'touch');
    pointer('pointerdown', at(0.6, 0.5), 2, 'touch');
    pointer('pointermove', at(0.7, 0.6), 2, 'touch');
    pointer('pointerup', at(0.7, 0.6), 2, 'touch');
    pointer('pointerup', at(0.4, 0.5), 1, 'touch');
    expect(annotations()).toHaveLength(0);
    pointer('pointerdown', at(0.2, 0.5));
    pointer('pointermove', at(0.5, 0.5));
    pointer('lostpointercapture', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()).toHaveLength(0);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('moves an annotation it takes hold of, as one undo step, and counts nothing', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] },
      ]);
    });
    rerender();
    const past = state().diagramHistory.past.length;
    drag(at(0.4, 0.5), at(0.4, 0.7));
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.7, 3);
    expect(state().diagramHistory.past).toHaveLength(past + 1);
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('keeps a move when an edit lands during it, and the edit with it', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'label', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A' },
      ]);
    });
    rerender();
    pointer('pointerdown', at(0.3, 0.3));
    pointer('pointermove', at(0.4, 0.4));
    // The label's field commits mid-drag, and the step is a new object.
    act(() => {
      state().editDiagramAnnotations(stepId, 'Edit label', (list) => list.map((a) => ({ ...a, text: 'B' })));
      state().setDiagramStepText(stepId, 'Fold.');
    });
    rerender();
    pointer('pointermove', at(0.5, 0.5));
    pointer('pointerup', at(0.5, 0.5));
    expect(annotations()[0]).toMatchObject({ text: 'B' });
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.5, 3);
  });

  it('selects without moving for a finger that drifts as it lifts', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] },
      ]);
    });
    rerender();
    const past = state().diagramHistory.past.length;
    const [x, y] = at(0.4, 0.5);
    pointer('pointerdown', [x, y], 1, 'touch');
    pointer('pointermove', [x + 6, y], 1, 'touch');
    pointer('pointerup', [x + 6, y], 1, 'touch');
    expect(state().diagramSelectedAnnotationId).toBe('line');
    expect(state().diagramHistory.past).toHaveLength(past);
  });

  it('on a diagram that cannot change, selects but neither draws nor moves', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] },
      ]);
    });
    rerender(true);
    drag(at(0.4, 0.5), at(0.4, 0.8));
    expect(state().diagramSelectedAnnotationId).toBe('line');
    expect(annotations()[0]!.from[1]).toBe(0.5);
    // Its ends are not offered to take hold of.
    expect(host.querySelector('[data-handle]')).toBeNull();
    tool('valley-arrow');
    drag(at(0.1, 0.1), at(0.5, 0.1));
    expect(annotations()).toHaveLength(1);
  });

  it('takes the keyboard to the canvas on a press, away from a field', () => {
    mount();
    const field = document.createElement('textarea');
    document.body.append(field);
    field.focus();
    pointer('pointerdown', at(0.5, 0.5));
    expect(document.activeElement).not.toBe(field);
    expect((document.activeElement as HTMLElement).contains(overlay())).toBe(true);
    field.remove();
  });

  it('drops a label’s waiting request for its field once another annotation is selected', async () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'label', kind: 'label', from: [0.3, 0.3], to: [0.3, 0.3], text: 'A' },
        { id: 'line', kind: 'valley-line', from: [0.2, 0.6], to: [0.6, 0.6] },
      ]);
    });
    rerender();
    const { requestLabelFocus, pendingLabelFocus } = await import('../../diagram/annotate/labelFocus');
    act(() => {
      state().selectDiagramAnnotation('label');
      requestLabelFocus('label');
    });
    expect(pendingLabelFocus()).toBe('label');
    act(() => state().selectDiagramAnnotation('line'));
    expect(pendingLabelFocus()).toBeNull();
  });

  it('draws from a press anywhere on the stage, past the picture’s margin, no further out than reach', () => {
    mount();
    tool('valley-arrow');
    // Past the quarter frame the camera frames round the picture: the stage, not the overlay.
    drag(at(-0.8, 0.5), at(0.3, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]!.from[0]).toBeCloseTo(-0.8, 3);
    // Six frames out is past where an annotation may reach: it starts at the edge of reach.
    drag(at(-6, 0.2), at(0.3, 0.2), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(2);
    expect(annotations()[1]!.from).toEqual([-4, expect.closeTo(0.2, 3)]);
  });

  it('leaves a press on the zoom pill to the pill, with a tool in hand', () => {
    mount();
    tool('valley-arrow');
    const pill = host.querySelector('[data-viewport-toolbar]')!;
    drag(at(0.2, 0.5), at(0.6, 0.5), 1, 'mouse', pill);
    expect(annotations()).toHaveLength(0);
    // The press after it, on the stage, draws as ever.
    drag(at(0.2, 0.5), at(0.6, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
  });

  it('keeps one finger from the camera anywhere on the stage, and lets a second through to pinch', () => {
    mount();
    const seen: number[] = [];
    // Where the camera listens for its pans and pinches.
    stage().addEventListener('touchstart', (event) => seen.push((event as TouchEvent).touches.length));
    touchStart(stage(), 1);
    touchStart(overlay(), 1);
    touchStart(stage(), 2);
    expect(seen).toEqual([2]);
  });

  it('pinches on the stage past the margin without drawing, and pans with Space held', () => {
    mount();
    tool('valley-line');
    pointer('pointerdown', at(-0.8, 0.5), 1, 'touch', stage());
    pointer('pointermove', at(-0.6, 0.5), 1, 'touch', stage());
    pointer('pointerdown', at(1.6, 0.5), 2, 'touch', stage());
    pointer('pointermove', at(1.4, 0.6), 2, 'touch', stage());
    pointer('pointerup', at(1.4, 0.6), 2, 'touch', stage());
    pointer('pointerup', at(-0.6, 0.5), 1, 'touch', stage());
    expect(annotations()).toHaveLength(0);
    // Space held: the press is the camera's (it pans on a left drag), not a stroke.
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(view().hasAttribute('data-space-pan')).toBe(true);
    drag(at(-0.8, 0.5), at(0.3, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(0);
    act(() => {
      view().dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true }));
    });
    drag(at(-0.8, 0.5), at(0.3, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
  });
});
