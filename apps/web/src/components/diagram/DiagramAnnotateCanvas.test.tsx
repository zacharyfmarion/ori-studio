import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pathCubics } from '../../diagram/annotate/annotationModel';
import { nearestPathPoint, pathNodesOf } from '../../diagram/annotate/annotationPath';
import type { KnownDiagramAnnotation } from '../../diagram/document/diagramDocument';
import { CP_MODEL_TO_CSS } from '../../cp-workspace/snapRadius';
import { syncHeldModifiersFromEvent } from '../../keyboard/heldModifiers';
import { cubicPoint } from '../../lib/cubicBezier';
import { useSettingsStore } from '../../store/settingsStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { selectedDiagramPathNode } from '../../store/workspaceStore/diagramState';
import { TooltipProvider } from '../ui/Tooltip';
import { CIRCLE_RADIUS, INK_UNITS } from '../../diagram/annotate/useAnnotateCanvas';
import { rightAngleGrips } from '../../diagram/annotate/annotationHit';
import { rightAngleAt, rightAngleDiagonal } from '../../diagram/annotate/annotationModel';
import { DiagramAnnotateCanvas } from './DiagramAnnotateCanvas';
import { stepsIn } from '../../diagram/document/diagramSteps.fixtures';

const tracked = vi.hoisted(() => ({ trackDiagramAnnotationAdded: vi.fn(), trackDiagramArrowShaped: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...tracked,
}));

/** How many times the marks were drawn: `DiagramAnnotationLayer` draws them with `annotationMarks`. */
const marksDrawn = vi.hoisted(() => ({ count: 0 }));
vi.mock('../../diagram/annotate/annotationPrimitives', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../diagram/annotate/annotationPrimitives')>();
  return {
    ...actual,
    annotationMarks: (...args: Parameters<typeof actual.annotationMarks>) => {
      marksDrawn.count += 1;
      return actual.annotationMarks(...args);
    },
  };
});

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

/**
 * Modifier keys held — `free` is ⌘ or Ctrl, whichever the platform's accel
 * is — the buttons down, and how long after the last press this one comes (a
 * second apart unless said).
 */
interface PressInit {
  shiftKey?: boolean;
  altKey?: boolean;
  free?: boolean;
  buttons?: number;
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
  { shiftKey = false, altKey = false, free = false, buttons = 0, gapMs = 1000 }: PressInit = {}
) {
  if (type === 'pointerdown') clock += gapMs;
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    buttons,
    shiftKey,
    altKey,
    metaKey: free,
    ctrlKey: free,
  });
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
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['valley_arrow', 'nothing_near']]);
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
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['turn_over', 'none']]);
  });

  it('puts a circle down with a click, keeps the tool for the next, and washes its ring when selected', () => {
    mount();
    tool('circle');
    pointer('pointerdown', at(0.4, 0.3));
    pointer('pointerup', at(0.4, 0.3));
    expect(annotations()).toHaveLength(1);
    expect(annotations()[0]).toMatchObject({ kind: 'circle' });
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.4, 3);
    expect(annotations()[0]!.to).toEqual(annotations()[0]!.from);
    expect(state().diagramAnnotateTool).toBe('circle');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['circle', 'nothing_near']]);
    // Drawn as References' ring, and selected: a wash along the ring, no ends to take hold of.
    rerender();
    expect(overlay().querySelector(`[data-annotation-id="${annotations()[0]!.id}"] circle`)).not.toBeNull();
    const wash = overlay().querySelector('circle[data-selection]');
    expect(Number(wash?.getAttribute('r'))).toBeCloseTo(CIRCLE_RADIUS * 1000, 6);
    expect(host.querySelector('[data-handle]')).toBeNull();
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

  it('never snaps a node, an end included, onto a point (decision 9)', () => {
    const stepId = shaping();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', (list) => [
        ...list,
        { id: 'c', kind: 'circle', from: [0.65, 0.5], to: [0.65, 0.5] },
      ]);
      state().selectDiagramAnnotation('v');
    });
    rerender();
    // The tip, dragged to 0.006 from the circle's centre: well within the snap radius.
    then(() => drag(nodeAt(2), at(0.644, 0.504)));
    expect(annotations()[0]!.to[0]).toBeCloseTo(0.644, 4);
    expect(annotations()[0]!.to[1]).toBeCloseTo(0.504, 4);
  });
});

describe('DiagramAnnotateCanvas snapping (decision 9)', () => {
  /** Edit's default radius (10 model units) at 100%: 14.7 CSS px, a thousandth of a frame per px here. */
  const RADIUS = (10 * CP_MODEL_TO_CSS) / 1000;
  const line: KnownDiagramAnnotation = { id: 'line', kind: 'valley-line', from: [0.2, 0.5], to: [0.6, 0.5] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
    marksDrawn.count = 0;
  });

  /** The step with these annotations, and a tool in hand. */
  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}, pointerType = 'mouse') => {
    pointer('pointerdown', point, 1, pointerType, overlay(), init);
    pointer('pointerup', point, 1, pointerType, overlay(), init);
    rerender();
  };
  const last = () => annotations()[annotations().length - 1]!;
  const targets = () => [...overlay().querySelectorAll('[data-snap-target]')].map((each) => each.getAttribute('data-snap-target'));

  it('puts a circle on a point within Edit’s snap radius, and where it was put past it', () => {
    expect(RADIUS).toBeCloseTo(0.0147, 4);
    drawn([line], 'circle');
    click(at(0.61, 0.505));
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5], to: [0.6, 0.5] });
    // 0.017 from the line's other end: past the radius.
    click(at(0.212, 0.512));
    expect(last().from[0]).toBeCloseTo(0.212, 6);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['circle', 'snapped'],
      ['circle', 'nothing_near'],
    ]);
  });

  it('lands an arrow on two circles: its tail as it is pressed, its tip as it moves and where it is let go', () => {
    drawn(
      [
        { id: 'a', kind: 'circle', from: [0.3, 0.4], to: [0.3, 0.4] },
        { id: 'b', kind: 'circle', from: [0.6, 0.4], to: [0.6, 0.4] },
      ],
      'valley-arrow'
    );
    pointer('pointerdown', at(0.308, 0.394));
    // Shown at the press, before any move.
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.45, 0.42));
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.593, 0.405));
    // Both ends, each on its circle.
    expect(targets()).toEqual(['annotation', 'annotation']);
    const draft = overlay().querySelectorAll('[data-annotation-id="annotation-draft"]');
    expect(draft).toHaveLength(1);
    pointer('pointerup', at(0.594, 0.406));
    rerender();
    expect(last()).toMatchObject({ kind: 'valley-arrow', from: [0.3, 0.4], to: [0.6, 0.4] });
    expect(targets()).toEqual([]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['valley_arrow', 'snapped']]);
  });

  it('puts a mark down where the pointer is with ⌘ (Ctrl) held, and anywhere with the switch off', () => {
    drawn([line], 'valley-line');
    drag(at(0.605, 0.505), at(0.3, 0.7), 1, 'mouse', overlay(), { free: true });
    rerender();
    expect(last().from).toEqual([expect.closeTo(0.605, 6), expect.closeTo(0.505, 6)]);
    act(() => useSettingsStore.getState().setDiagramAnnotateSnap(false));
    rerender();
    tool('circle');
    click(at(0.605, 0.505));
    expect(last().from).toEqual([expect.closeTo(0.605, 6), expect.closeTo(0.505, 6)]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['valley_line', 'free'],
      ['circle', 'off'],
    ]);
  });

  it('drags a line’s end onto a point with Select, never onto the line itself', () => {
    drawn([line, { id: 'c', kind: 'circle', from: [0.7, 0.56], to: [0.7, 0.56] }]);
    act(() => state().selectDiagramAnnotation('line'));
    rerender();
    drag(at(0.6, 0.5), at(0.706, 0.553));
    rerender();
    expect(annotations()[0]!.to).toEqual([0.7, 0.56]);
    // A short drag from where the end is: its own old place is not a target.
    act(() => state().selectDiagramAnnotation('line'));
    rerender();
    drag(at(0.2, 0.5), at(0.208, 0.5));
    rerender();
    expect(annotations()[0]!.from[0]).toBeCloseTo(0.208, 6);
  });

  it('moves a circle whole onto a point: its centre snaps, wherever on its ring it was taken', () => {
    drawn([line, { id: 'c', kind: 'circle', from: [0.3, 0.3], to: [0.3, 0.3] }]);
    drag(at(0.3 + CIRCLE_RADIUS, 0.3), at(0.595 + CIRCLE_RADIUS, 0.494));
    rerender();
    expect(annotations()[1]!.from).toEqual([0.6, 0.5]);
  });

  it('reaches as far on screen at any zoom: fewer picture units zoomed in, more for a wider setting', () => {
    drawn([line], 'circle');
    // Zoomed in twice over: 0.012 from the end is 24 screen px, past 14.7.
    (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => ({ ...identity, a: 2, d: 2 });
    click(at(0.612, 0.5));
    expect(last().from[0]).toBeCloseTo(0.612, 6);
    // 0.0058 from the end: 11.7 screen px.
    click(at(0.605, 0.497));
    expect(last().from).toEqual([0.6, 0.5]);
    // Edit's setting doubled reaches as far again: 0.012 is within its 29.4 px.
    act(() => useSettingsStore.setState({ cpSnapRadius: 20 }));
    rerender();
    click(at(0.6, 0.512));
    expect(last().from).toEqual([0.6, 0.5]);
    expect(annotations()).toHaveLength(4);
  });

  it('shows where a press would land as the pointer hovers, and never draws the marks again for it', () => {
    drawn([line], 'circle');
    const drawnBefore = marksDrawn.count;
    pointer('pointermove', at(0.61, 0.505));
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.4, 0.3));
    expect(targets()).toEqual([]);
    pointer('pointermove', at(0.61, 0.505));
    expect(targets()).toEqual(['annotation']);
    // ⌘ pressed with the pointer still: nothing to land on; let go, there it is again.
    act(() => syncHeldModifiersFromEvent({ ctrlKey: true, metaKey: true, shiftKey: false, altKey: false }));
    expect(targets()).toEqual([]);
    act(() => syncHeldModifiersFromEvent({ ctrlKey: false, metaKey: false, shiftKey: false, altKey: false }));
    expect(targets()).toEqual(['annotation']);
    pointer('pointermove', at(0.611, 0.505), 1, 'mouse', overlay(), { free: true });
    expect(targets()).toEqual([]);
    expect(marksDrawn.count).toBe(drawnBefore);
    // With Select in hand a press lands nowhere: nothing shows.
    tool(null);
    pointer('pointermove', at(0.61, 0.505));
    expect(targets()).toEqual([]);
    expect(marksDrawn.count).toBe(drawnBefore);
    // A drag does draw them again, each move: what the count above would have seen.
    tool('valley-line');
    drag(at(0.3, 0.3), at(0.5, 0.3));
    expect(marksDrawn.count).toBeGreaterThan(drawnBefore);
  });

  it('shows what a still pointer would land on once the camera moves under it', () => {
    drawn([line], 'circle');
    // 12 px off the end at the zoom the picture opens at: the end shows.
    pointer('pointermove', at(0.612, 0.5));
    expect(targets()).toEqual(['annotation']);
    // The camera zooms in twice over under the pointer, which does not move: 24 px off, past the radius.
    (SVGElement.prototype as unknown as { getScreenCTM: () => typeof identity }).getScreenCTM = () => ({ ...identity, a: 2, d: 2 });
    act(() => {
      stage().dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: 612, clientY: 500, bubbles: true, cancelable: true }));
    });
    expect(targets()).toEqual([]);
  });

  it('shows a finger where its press landed before it moves, and puts the circle there', () => {
    drawn([line], 'circle');
    pointer('pointerdown', at(0.61, 0.505), 1, 'touch');
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.612, 0.505), 1, 'touch');
    rerender();
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5] });
    expect(targets()).toEqual([]);
  });

  it('puts a clicked circle where its press showed, though the pointer drifts within its slop before it lifts', () => {
    drawn([line], 'circle');
    // A finger 12 px off the end, which the press shows; it lifts 8 px further off, 20 px from it.
    pointer('pointerdown', at(0.612, 0.5), 1, 'touch');
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.62, 0.5), 1, 'touch');
    rerender();
    expect(last()).toMatchObject({ kind: 'circle', from: [0.6, 0.5] });
    // A press with nothing near, lifting nearer one: where it was pressed, as it showed.
    pointer('pointerdown', at(0.6195, 0.5), 2, 'touch');
    expect(targets()).toEqual([]);
    pointer('pointerup', at(0.611, 0.5), 2, 'touch');
    rerender();
    expect(last().from[0]).toBeCloseTo(0.6195, 6);
    // At the line's other end, a mouse's 3 px drift within its 4 px slop, past the radius.
    pointer('pointerdown', at(0.187, 0.5), 3, 'mouse');
    expect(targets()).toEqual(['annotation']);
    pointer('pointerup', at(0.184, 0.5), 3, 'mouse');
    rerender();
    expect(last().from).toEqual([0.2, 0.5]);
  });
});

describe('DiagramAnnotateCanvas right angles (decision 12)', () => {
  const R = Math.SQRT1_2;
  // Two lines drawn on the upload, meeting square at (0.3, 0.4): one right angle there, opening down and to the right.
  const across: KnownDiagramAnnotation = { id: 'across', kind: 'valley-line', from: [0.3, 0.4], to: [0.7, 0.4] };
  const down: KnownDiagramAnnotation = { id: 'down', kind: 'mountain-line', from: [0.3, 0.4], to: [0.3, 0.8] };

  beforeEach(() => {
    useSettingsStore.setState({ diagramAnnotateSnap: true, cpSnapRadius: 10 });
  });

  function drawn(list: KnownDiagramAnnotation[], toolInHand: Parameters<typeof tool>[0] = null) {
    const stepId = mount();
    act(() => {
      state().editDiagramAnnotations(stepId, 'Add annotation', () => list);
      state().selectDiagramAnnotation(null);
      state().setDiagramAnnotateTool(toolInHand);
    });
    rerender();
    return stepId;
  }
  const click = (point: [number, number], init: PressInit = {}) => {
    pointer('pointerdown', point, 1, 'mouse', overlay(), init);
    pointer('pointerup', point, 1, 'mouse', overlay(), init);
    rerender();
  };
  const last = () => annotations()[annotations().length - 1]!;
  const opens = (annotation: KnownDiagramAnnotation) => rightAngleDiagonal(annotation).map((v) => Math.round(v * 1e6) / 1e6 + 0);
  const ghost = () => overlay().querySelector('[data-right-angle-preview]');
  const targets = () => [...overlay().querySelectorAll('[data-snap-target]')].map((each) => each.getAttribute('data-snap-target'));
  const r = Math.round(R * 1e6) / 1e6;

  it('shows the mark a click would put in the corner it hovers, and puts it there, square into the angle', () => {
    drawn([across, down], 'right-angle');
    // 8 px off the corner, inside the angle: past the dead zone, within the radius.
    pointer('pointermove', at(0.306, 0.406));
    expect(ghost()).not.toBeNull();
    expect(targets()).toEqual(['annotation']);
    // Its legs along the lines, from the corner: the ghost's far corner on the diagonal.
    const points = ghost()!.querySelector('polyline')!.getAttribute('points')!.split(' ').map((pair) => pair.split(',').map(Number));
    const corner = at(0.3, 0.4);
    expect(points[1]![0]! - corner[0]).toBeCloseTo(points[1]![1]! - corner[1], 6);
    click(at(0.306, 0.406));
    expect(last()).toMatchObject({ kind: 'right-angle', from: [0.3, 0.4] });
    expect(opens(last())).toEqual([r, r]);
    expect(state().diagramAnnotateTool).toBe('right-angle');
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([['right_angle', 'snapped']]);
    // Gone once the click lands, and drawn as the mark itself.
    expect(ghost()).toBeNull();
    expect(overlay().querySelector(`[data-annotation-id="${last().id}"] path`)).not.toBeNull();
  });

  it('draws one from a corner into the angle, squared; Shift holds a drag where there is none to 45°', () => {
    drawn([across, down], 'right-angle');
    // From the corner itself — too near to say which way — into the angle, well off its diagonal.
    drag(at(0.301, 0.401), at(0.36, 0.42));
    rerender();
    expect(last().from).toEqual([0.3, 0.4]);
    expect(opens(last())).toEqual([r, r]);
    // Nothing square here: toward the pointer, and with Shift, the nearest 45°.
    drag(at(0.6, 0.2), at(0.65, 0.21));
    rerender();
    expect(opens(last())).toEqual(rightAngleDiagonal({ from: [0, 0], to: [0.05, 0.01] }).map((v) => Math.round(v * 1e6) / 1e6 + 0));
    // Away from the one just put down, whose corner is a point to snap to.
    drag(at(0.6, 0.25), at(0.65, 0.26), 1, 'mouse', overlay(), { shiftKey: true });
    rerender();
    expect(opens(last())).toEqual([1, 0]);
    expect(tracked.trackDiagramAnnotationAdded.mock.calls).toEqual([
      ['right_angle', 'snapped'],
      ['right_angle', 'nothing_near'],
      ['right_angle', 'nothing_near'],
    ]);
  });

  it('puts one down with a click where no right angle is found, opening toward the picture’s middle', () => {
    drawn([across, down], 'right-angle');
    pointer('pointermove', at(0.9, 0.7));
    expect(ghost()).not.toBeNull();
    click(at(0.9, 0.7));
    expect(last().from[0]).toBeCloseTo(0.9, 6);
    // The frame is 1 × 0.75: its middle is up and to the left of here.
    expect(opens(last())).toEqual([-r, -r]);
    // ⌘ held: where the pointer is, though it is near the corner.
    click(at(0.306, 0.406), { free: true });
    expect(last().from).toEqual([expect.closeTo(0.306, 6), expect.closeTo(0.406, 6)]);
  });

  it('shows no ghost with another tool, or once the pointer leaves', () => {
    drawn([across, down], 'circle');
    pointer('pointermove', at(0.306, 0.406));
    expect(ghost()).toBeNull();
    tool('right-angle');
    pointer('pointermove', at(0.306, 0.406));
    expect(ghost()).not.toBeNull();
    // Out of the view altogether (React reads a leave from the `pointerout` it bubbles).
    act(() => {
      overlay().dispatchEvent(new MouseEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    });
    expect(ghost()).toBeNull();
  });

  it('offers a selected one its corner and the way it opens; the far corner turns it, into a right angle where it finds one', () => {
    // In the corner, opening the wrong way: up and to the left, out of the angle.
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'right-angle', ...rightAngleAt([0.3, 0.4], [-1, -1]) };
    drawn([across, down, mark]);
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    expect([...host.querySelectorAll('[data-handle]')].map((each) => each.getAttribute('data-handle'))).toEqual([
      'corner',
      'direction',
    ]);
    const { direction } = rightAngleGrips(mark, INK_UNITS);
    // Turned toward a point inside the angle, off its diagonal: square into it.
    drag(at(direction[0], direction[1]), at(0.36, 0.42));
    rerender();
    expect(annotations()[2]!.from).toEqual([0.3, 0.4]);
    expect(opens(annotations()[2]!)).toEqual([r, r]);
    // Turned where there is no right angle, with Shift: the nearest 45°.
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    const turned = rightAngleGrips(annotations()[2]!, INK_UNITS).direction;
    drag(at(turned[0], turned[1]), at(0.28, 0.31), 1, 'mouse', overlay(), { shiftKey: true });
    rerender();
    expect(opens(annotations()[2]!)).toEqual([0, -1]);
  });

  it('moves a selected one by its corner onto another, square into the right angle there', () => {
    // A second corner, at the lines' other ends: (0.7, 0.4) has a right angle with a third line.
    const up: KnownDiagramAnnotation = { id: 'up', kind: 'hidden-line', from: [0.7, 0.4], to: [0.7, 0.1] };
    const mark: KnownDiagramAnnotation = { id: 'mark', kind: 'right-angle', ...rightAngleAt([0.3, 0.4], [1, 1]) };
    drawn([across, down, up, mark]);
    act(() => state().selectDiagramAnnotation('mark'));
    rerender();
    drag(at(0.3, 0.4), at(0.695, 0.404));
    rerender();
    const moved = annotations()[3]!;
    expect(moved.from).toEqual([0.7, 0.4]);
    // Up and to the left, between the lines that meet there.
    expect(opens(moved)).toEqual([-r, -r]);
    // A press on its legs moves it whole, as far as the pointer went.
    act(() => state().selectDiagramAnnotation(null));
    rerender();
    const leg = rightAngleGrips(moved, INK_UNITS).direction;
    drag(at(leg[0] - 0.001, leg[1] - 0.001), at(leg[0] - 0.101, leg[1] + 0.199));
    rerender();
    expect(annotations()[3]!.from[0]).toBeCloseTo(0.6, 6);
    expect(annotations()[3]!.from[1]).toBeCloseTo(0.6, 6);
    expect(opens(annotations()[3]!)).toEqual([-r, -r]);
  });
});
