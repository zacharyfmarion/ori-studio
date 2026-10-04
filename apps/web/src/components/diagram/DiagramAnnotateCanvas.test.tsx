import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathCubics } from '../../diagram/annotate/annotationModel';
import { nearestPathPoint, pathNodesOf } from '../../diagram/annotate/annotationPath';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { cubicPoint } from '../../lib/cubicBezier';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import { TooltipProvider } from '../ui/Tooltip';
import { DiagramAnnotateCanvas } from './DiagramAnnotateCanvas';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';

const tracked = vi.hoisted(() => ({ trackDiagramAnnotationAdded: vi.fn(), trackDiagramArrowShaped: vi.fn() }));
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
  tracked.trackDiagramArrowShaped.mockClear();
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

/** Modifier keys held, and how long after the last press this one comes (a second apart unless said). */
interface PressInit {
  shiftKey?: boolean;
  altKey?: boolean;
  gapMs?: number;
}

/** The events' clock: presses a second apart are never a double-click. */
let clock = 0;

function pointer(
  type: string,
  [clientX, clientY]: [number, number],
  pointerId = 1,
  pointerType = 'mouse',
  target: Element = overlay(),
  { shiftKey = false, altKey = false, gapMs = 1000 }: PressInit = {}
) {
  if (type === 'pointerdown') clock += gapMs;
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY, button: 0, shiftKey, altKey });
  Object.defineProperty(event, 'pointerId', { value: pointerId });
  Object.defineProperty(event, 'pointerType', { value: pointerType });
  Object.defineProperty(event, 'timeStamp', { value: clock });
  act(() => {
    target.dispatchEvent(event);
  });
}

function drag(
  from: [number, number],
  to: [number, number],
  pointerId = 1,
  pointerType = 'mouse',
  target: Element = overlay(),
  init: PressInit = {}
) {
  pointer('pointerdown', from, pointerId, pointerType, target, init);
  for (let i = 1; i <= 4; i += 1) {
    pointer(
      'pointermove',
      [from[0] + ((to[0] - from[0]) * i) / 4, from[1] + ((to[1] - from[1]) * i) / 4],
      pointerId,
      pointerType,
      target,
      init
    );
  }
  pointer('pointerup', to, pointerId, pointerType, target, init);
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

  it('hits nothing with a press past reach, beside a mark left on the edge of reach', () => {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [
        { id: 'edge', kind: 'valley-arrow', from: [-4, 0.2], to: [0.3, 0.2], bend: 0.2 },
      ]);
    });
    rerender();
    // Two frames past the arrow's tail, on its row: empty stage.
    pointer('pointerdown', at(-6, 0.2), 1, 'mouse', stage());
    pointer('pointerup', at(-6, 0.2), 1, 'mouse', stage());
    expect(state().diagramSelectedAnnotationId).toBeNull();
    // Selected, its tail is not taken from there either.
    act(() => state().selectDiagramAnnotation('edge'));
    drag(at(-6, 0.2), at(-6, 0.6), 1, 'mouse', stage());
    expect(annotations()[0]!.from).toEqual([-4, 0.2]);
    // Its tail, pressed where it is, still is.
    act(() => state().selectDiagramAnnotation('edge'));
    drag(at(-4, 0.2), at(-4, 0.6), 1, 'mouse', stage());
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.6, 3);
  });

  it('holds a stroke’s pointer on the stage, whose cursor is the tool’s', () => {
    mount();
    tool('valley-line');
    const holders: Element[] = [];
    Element.prototype.setPointerCapture = function capture(this: Element) {
      holders.push(this);
    };
    drag(at(0.2, 0.5), at(0.6, 0.5), 1, 'mouse', stage());
    expect(annotations()).toHaveLength(1);
    expect(holders).toEqual([stage()]);
  });

  it('sets its zoom pill on a solid ground, the stage being white in every theme', () => {
    mount();
    expect(host.querySelector('[data-viewport-toolbar]')?.getAttribute('data-tone')).toBe('raised');
  });
});

describe('DiagramAnnotateCanvas in Edit Path', () => {
  /** A half circle: three nodes when Edit Path shows it. */
  const HALF: KnownDiagramAnnotation = { id: 'v', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: 0.5 };

  /** The step with `annotation` selected and a tool in hand (Edit Path unless said). */
  function shaping(annotation: KnownDiagramAnnotation = HALF, toolInHand: Parameters<typeof tool>[0] = 'edit-path') {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => [annotation]);
      state().selectDiagramAnnotation(annotation.id);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  /** A gesture, and the canvas drawn again with the step it left — as the panel does. */
  const then = (gesture: () => void) => {
    gesture();
    rerender();
  };
  const click = (point: [number, number], init: PressInit = {}) =>
    then(() => {
      pointer('pointerdown', point, 1, 'mouse', overlay(), init);
      pointer('pointerup', point, 1, 'mouse', overlay(), init);
    });
  const doubleClick = (point: [number, number]) =>
    then(() => {
      pointer('pointerdown', point);
      pointer('pointerup', point);
      rerender();
      pointer('pointerdown', point, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', point);
    });
  const shown = () => pathNodesOf(annotations()[0]!)!;
  const nodeAt = (index: number) => at(shown()[index]!.at[0], shown()[index]!.at[1]);
  const curveAt = (segment: number, t: number) => {
    const [x, y] = cubicPoint(pathCubics(shown())[segment]!, t);
    return at(x, y);
  };
  const past = () => state().diagramHistory.past.length;
  const selectedNode = () => state().diagramSelectedPathNode?.node ?? null;
  const angle = (from: readonly number[], to: readonly number[]) => Math.atan2(to[1]! - from[1]!, to[0]! - from[0]!);

  it('shows an arc’s nodes without shaping it, and its handles once a node is selected', () => {
    shaping();
    expect(host.querySelectorAll('[data-path-node]')).toHaveLength(3);
    expect(host.querySelector('[data-handle]')).toBeNull();
    expect(host.querySelector('[data-path-handle]')).toBeNull();
    click(nodeAt(1));
    expect(selectedNode()).toBe(1);
    expect(annotations()[0]).toEqual(HALF);
    expect(host.querySelector('[data-path-node="1"]')?.hasAttribute('data-selected')).toBe(true);
    // The middle node's two handles, and each end's facing one.
    expect([...host.querySelectorAll('[data-path-handle]')].map((handle) => handle.getAttribute('data-path-handle'))).toEqual([
      '0-out',
      '1-in',
      '1-out',
      '2-in',
    ]);
    // With Select, its ends' dots again.
    tool(null);
    expect(host.querySelector('[data-path-node]')).toBeNull();
    expect(host.querySelectorAll('[data-handle]')).toHaveLength(2);
  });

  it('drags a node as one undo step, shaping the arc and counting it once', () => {
    shaping();
    const before = past();
    then(() => drag(nodeAt(2), at(0.6, 0.6)));
    expect(annotations()[0]!.bend).toBeUndefined();
    expect(annotations()[0]!.to[1]).toBeCloseTo(0.6, 3);
    expect(annotations()[0]!.path).toHaveLength(3);
    expect(past()).toBe(before + 1);
    expect(selectedNode()).toBe(2);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'drag_node']]);
    then(() => drag(nodeAt(0), at(0.2, 0.45)));
    expect(annotations()[0]!.from[1]).toBeCloseTo(0.45, 3);
    expect(tracked.trackDiagramArrowShaped).toHaveBeenCalledOnce();
    expect(tracked.trackDiagramAnnotationAdded).not.toHaveBeenCalled();
  });

  it('keeps a node to 0, 45 or 90° from where it started with Shift', () => {
    shaping();
    const [x, y] = nodeAt(2);
    then(() => drag([x, y], [x + 50, y + 34], 1, 'mouse', overlay(), { shiftKey: true }));
    const tip = annotations()[0]!.to;
    expect(tip[0] - 0.6).toBeCloseTo(0.042, 3);
    expect(tip[1] - 0.5).toBeCloseTo(tip[0] - 0.6, 9);
  });

  it('drags a handle: a smooth node’s other turns with it; with Alt the node is a corner and the other stays', () => {
    shaping();
    click(nodeAt(1));
    const middle = shown()[1]!;
    then(() => drag(at(middle.out![0], middle.out![1]), at(middle.out![0], middle.out![1] + 0.05)));
    let node = shown()[1]!;
    expect(node.type).toBeUndefined();
    expect(Math.abs(angle(node.at, node.in!) - angle(node.out!, node.at))).toBeLessThan(1e-9);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'drag_handle']]);
    const before = node;
    then(() =>
      drag(at(node.out![0], node.out![1]), at(node.out![0] + 0.03, node.out![1]), 1, 'mouse', overlay(), { altKey: true })
    );
    node = shown()[1]!;
    expect(node.type).toBe('corner');
    expect(node.in).toEqual(before.in);
    expect(node.out![0]).toBeCloseTo(before.out![0] + 0.03, 3);
  });

  it('bends the curve where it is dragged, the point pressed following the pointer', () => {
    shaping();
    const start = curveAt(0, 0.5);
    const before = past();
    then(() => drag(start, [start[0], start[1] + 40]));
    const [x, y] = cubicPoint(pathCubics(annotations()[0]!.path!)[0]!, 0.5);
    expect(at(x, y)[0]).toBeCloseTo(start[0], 0);
    expect(at(x, y)[1]).toBeCloseTo(start[1] + 40, 0);
    expect(past()).toBe(before + 1);
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'bend']]);
  });

  it('adds a node with a click on the curve, the curve unchanged, and selects it', () => {
    shaping();
    const before = past();
    const outline = pathCubics(shown()).flatMap((cubic) => [0.1, 0.3, 0.5, 0.7, 0.9].map((t) => cubicPoint(cubic, t)));
    click(curveAt(1, 0.4));
    expect(annotations()[0]!.path).toHaveLength(4);
    expect(past()).toBe(before + 1);
    expect(selectedNode()).toBe(2);
    const arrow = annotations()[0]!;
    for (const point of outline) {
      expect(nearestPathPoint(arrow, [point[0], point[1]])!.distance).toBeLessThan(1e-6);
    }
    expect(tracked.trackDiagramArrowShaped.mock.calls).toEqual([['valley_arrow', 'add_node']]);
  });

  it('turns a node corner and smooth with a double-click, its first click adding nothing', () => {
    shaping();
    const before = past();
    doubleClick(nodeAt(1));
    expect(shown()).toHaveLength(3);
    expect(shown()[1]!.type).toBe('corner');
    expect(past()).toBe(before + 1);
    doubleClick(nodeAt(1));
    expect(shown()[1]!.type).toBeUndefined();
    expect(past()).toBe(before + 2);
    // Beside the node, on the curve but within the node's reach: still the node, no node added.
    const [x, y] = nodeAt(1);
    doubleClick([x + 5, y]);
    expect(shown()).toHaveLength(3);
    expect(shown()[1]!.type).toBe('corner');
  });

  it('adds one smooth node for a double-click on the curve: the second click neither adds nor turns it', () => {
    shaping();
    const before = past();
    doubleClick(curveAt(0, 0.5));
    expect(shown()).toHaveLength(4);
    expect(shown().map((node) => node.type ?? 'smooth')).toEqual(['smooth', 'smooth', 'smooth', 'smooth']);
    expect(past()).toBe(before + 1);
  });

  it('lets a drag go when an undo changes the arrow under it, and lands nothing', () => {
    shaping();
    click(curveAt(0, 0.5));
    expect(shown()).toHaveLength(4);
    pointer('pointerdown', nodeAt(0));
    pointer('pointermove', at(0.25, 0.4));
    act(() => {
      state().undoDiagram();
    });
    rerender();
    const undone = annotations()[0]!;
    expect(undone).toEqual(HALF);
    const after = past();
    pointer('pointermove', at(0.3, 0.35));
    pointer('pointerup', at(0.3, 0.35));
    rerender();
    expect(annotations()[0]).toBe(undone);
    expect(past()).toBe(after);
    // The node selected against four nodes reads as none against three.
    expect(selectedDiagramPathNode(state())).toBeNull();
  });

  it('with a kind that is not shaped selected, shows no nodes and moves nothing', () => {
    shaping({ id: 'p', kind: 'push-arrow', from: [0.2, 0.5], to: [0.6, 0.5] });
    expect(host.querySelector('[data-path-node]')).toBeNull();
    // Its wash, but no end dots: Edit Path would not move them.
    expect(host.querySelector('[data-selection]')).not.toBeNull();
    expect(host.querySelector('[data-handle]')).toBeNull();
    const before = past();
    then(() => drag(at(0.4, 0.5), at(0.4, 0.7)));
    expect(annotations()[0]!.from).toEqual([0.2, 0.5]);
    expect(past()).toBe(before);
    expect(state().diagramSelectedAnnotationId).toBe('p');
  });

  it('deselects the node first, then the arrow, for presses on the empty stage', () => {
    shaping();
    click(nodeAt(1));
    click(at(0.4, 0.9));
    expect(selectedNode()).toBeNull();
    expect(state().diagramSelectedAnnotationId).toBe('v');
    click(at(0.4, 0.9));
    expect(state().diagramSelectedAnnotationId).toBeNull();
  });

  it('picks Edit Path up for a double-click on a fold arrow with Select, moving nothing', () => {
    shaping(HALF, null);
    const before = past();
    doubleClick(nodeAt(2));
    expect(state().diagramAnnotateTool).toBe('edit-path');
    expect(state().diagramSelectedAnnotationId).toBe('v');
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
    // A line is not shaped: a double-click on one keeps Select.
    tool(null);
    act(() => {
      state().editDiagramAnnotations(state().diagramSelectedStepId!, 'Add annotation', (list) => [
        ...list,
        { id: 'l', kind: 'valley-line', from: [0.2, 0.8], to: [0.6, 0.8] },
      ]);
    });
    rerender();
    doubleClick(at(0.4, 0.8));
    expect(state().diagramAnnotateTool).toBeNull();
    expect(state().diagramSelectedAnnotationId).toBe('l');
  });

  it('counts a third quick click as a click, and two double-clicks in a row as two', () => {
    shaping();
    const before = past();
    const node = nodeAt(1);
    then(() => {
      pointer('pointerdown', node);
      pointer('pointerup', node);
      rerender();
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', node);
      rerender();
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', node);
    });
    // One double-click and a click: a corner, once.
    expect(shown()[1]!.type).toBe('corner');
    expect(past()).toBe(before + 1);
    // Another double-click straight after, turning it back.
    then(() => {
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 300 });
      pointer('pointerup', node);
      rerender();
      pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
      pointer('pointerup', node);
    });
    expect(shown()[1]!.type).toBeUndefined();
    expect(past()).toBe(before + 2);
  });

  it('picks a node with the click that follows a Select double-click, shaping nothing', () => {
    shaping(HALF, null);
    const before = past();
    // On the arc's middle, where Edit Path's middle node will be.
    doubleClick(nodeAt(1));
    expect(state().diagramAnnotateTool).toBe('edit-path');
    click(nodeAt(1), { gapMs: 250 });
    expect(selectedNode()).toBe(1);
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
  });

  it('only picks an arrow it is double-clicked onto in Edit Path, as Select does', () => {
    shaping();
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    const before = past();
    doubleClick(curveAt(0, 0.5));
    expect(state().diagramSelectedAnnotationId).toBe('v');
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    doubleClick(nodeAt(1));
    expect(state().diagramSelectedAnnotationId).toBe('v');
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
    expect(tracked.trackDiagramArrowShaped).not.toHaveBeenCalled();
  });

  it('lands a drag where its preview showed it, a modifier let go after the last move', () => {
    shaping();
    const [x, y] = nodeAt(2);
    const to: [number, number] = [x + 50, y + 34];
    then(() => {
      pointer('pointerdown', [x, y], 1, 'mouse', overlay(), { shiftKey: true });
      for (let i = 1; i <= 4; i += 1) {
        pointer('pointermove', [x + (50 * i) / 4, y + (34 * i) / 4], 1, 'mouse', overlay(), { shiftKey: true });
      }
      // Shift let go, then the button: the 45° the preview showed lands.
      pointer('pointerup', to, 1, 'mouse', overlay(), { shiftKey: false });
    });
    const tip = annotations()[0]!.to;
    expect(tip[1] - 0.5).toBeCloseTo(tip[0] - 0.6, 9);
  });

  it('shows no drawing crosshair with Edit Path, which draws nothing', () => {
    shaping();
    expect(view().hasAttribute('data-draws')).toBe(false);
    tool('valley-arrow');
    expect(view().hasAttribute('data-draws')).toBe(true);
  });

  it('on a diagram that cannot change, selects a node but shapes nothing', () => {
    shaping();
    rerender(true);
    const before = past();
    // Each press drawn again read-only, as the panel would: the helpers above draw a writable canvas.
    drag(nodeAt(1), at(0.4, 0.2));
    rerender(true);
    const onCurve = curveAt(0, 0.5);
    pointer('pointerdown', onCurve);
    pointer('pointerup', onCurve);
    rerender(true);
    const node = nodeAt(1);
    pointer('pointerdown', node);
    pointer('pointerup', node);
    rerender(true);
    pointer('pointerdown', node, 1, 'mouse', overlay(), { gapMs: 120 });
    pointer('pointerup', node);
    rerender(true);
    expect(annotations()[0]).toEqual(HALF);
    expect(past()).toBe(before);
    expect(selectedNode()).toBe(1);
  });
});
