import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramShortcutId } from '../keyboard/shortcuts';
import { useWorkspaceStore } from '../store/workspaceStore';
import { EDIT_PATH } from './annotate/annotateTools';
import { ARROW_BEND } from './annotate/annotationModel';
import type { KnownDiagramAnnotation } from './document/diagramDocument';
import { stepsIn } from './document/diagramSteps.fixtures';
import { useDiagramShortcuts } from './useDiagramShortcuts';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const runtime = vi.hoisted(() => ({ diagram: null as ((id: DiagramShortcutId) => boolean) | null }));
vi.mock('../keyboard/shortcutRuntime', () => ({
  registerDiagramShortcutExecutor: (executor: (id: DiagramShortcutId) => boolean) => {
    runtime.diagram = executor;
    return () => {
      runtime.diagram = null;
    };
  },
  registerViewportShortcutExecutor: () => () => {},
  setActiveShortcutViewportSurface: () => {},
  releaseShortcutViewportSurface: () => {},
}));

const state = () => useWorkspaceStore.getState();
const order = () => state().diagram!.steps.map((entry) => entry.id);
const OVER = { kind: 'turn-over', axis: 'vertical' } as const;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function Keys() {
  useDiagramShortcuts({ openStepMenu: () => false });
  return null;
}

beforeEach(() => {
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<Keys />));
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('moving a step with Alt+arrows past a turn (D22)', () => {
  it('in Pose, moves the step one step on or back, over the turn between', () => {
    const first = state().addDiagramStep()!;
    const turn = state().insertDiagramTurn(OVER)!;
    const second = state().addDiagramStep()!;
    expect(order()).toEqual([first, turn, second]);
    state().openDiagramStep(first, 'pose');
    expect(runtime.diagram!('diagram.moveStepLater')).toBe(true);
    // Step 1 is step 2 now; the turn stays before the step it came before.
    expect(order()).toEqual([turn, second, first]);
    expect(runtime.diagram!('diagram.moveStepEarlier')).toBe(true);
    expect(order()).toEqual([turn, first, second]);
  });

  it('in Pose, keeps a leading turn first', () => {
    const turn = state().insertDiagramTurn(OVER)!;
    const first = state().addDiagramStep()!;
    const second = state().addDiagramStep()!;
    expect(order()).toEqual([turn, first, second]);
    state().openDiagramStep(second, 'pose');
    runtime.diagram!('diagram.moveStepEarlier');
    expect(order()).toEqual([turn, second, first]);
  });

  it('in the grid, moves the selected entry among all of them, turns included', () => {
    const first = state().addDiagramStep()!;
    const turn = state().insertDiagramTurn(OVER)!;
    const second = state().addDiagramStep()!;
    state().selectDiagramStep(first);
    runtime.diagram!('diagram.moveStepLater');
    expect(order()).toEqual([turn, first, second]);
  });
});

describe('Edit Path’s arrow keys (decision 6)', () => {
  /** Two steps, the first with a picture, open in Annotate on a default valley arrow in Edit Path. */
  function shaping() {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
    state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
    const stepId = state().diagramSelectedStepId!;
    state().addDiagramStep();
    state().openDiagramStep(stepId, 'annotate');
    state().editDiagramAnnotations(stepId, 'Add annotation', () => [
      { id: 'v', kind: 'valley-arrow', from: [0.2, 0.5], to: [0.6, 0.5], bend: ARROW_BEND },
    ]);
    state().selectDiagramAnnotation('v');
    state().setDiagramAnnotateTool(EDIT_PATH);
    return stepId;
  }
  const arrow = () => stepsIn(state().diagram!)[0]!.annotations[0] as KnownDiagramAnnotation;

  it('nudge the selected node, one undo step a press, and leave the step where it is', () => {
    const stepId = shaping();
    state().selectDiagramPathNode(1);
    const past = state().diagramHistory.past.length;
    expect(runtime.diagram!('diagram.nudgeNodeRight')).toBe(true);
    expect(runtime.diagram!('diagram.nudgeNodeDownLarge')).toBe(true);
    expect(arrow().path![1]!.at[0]).toBeCloseTo(0.601, 12);
    expect(arrow().path![1]!.at[1]).toBeCloseTo(0.51, 12);
    expect(state().diagramHistory.past).toHaveLength(past + 2);
    expect(state().diagramSelectedStepId).toBe(stepId);
    // The node stays selected through its own nudges: the arc became a path of as many nodes.
    expect(state().diagramSelectedPathNode).toMatchObject({ node: 1, nodes: 2 });
    expect(runtime.diagram!('diagram.nudgeNodeLeft')).toBe(true);
  });

  it('decline with no node selected, so the same arrows walk the steps', () => {
    const stepId = shaping();
    expect(runtime.diagram!('diagram.nudgeNodeRight')).toBe(false);
    expect(arrow().path).toBeUndefined();
    expect(runtime.diagram!('diagram.nextStep')).toBe(true);
    expect(state().diagramSelectedStepId).not.toBe(stepId);
  });

  it('decline while a control that uses the arrows has focus', () => {
    shaping();
    state().selectDiagramPathNode(0);
    const tabs = document.createElement('div');
    tabs.setAttribute('role', 'tablist');
    const tab = document.createElement('button');
    tabs.append(tab);
    document.body.append(tabs);
    tab.focus();
    expect(runtime.diagram!('diagram.nudgeNodeRight')).toBe(false);
    tabs.remove();
    expect(runtime.diagram!('diagram.nudgeNodeRight')).toBe(true);
  });
});

describe('F, Flip Arc (review)', () => {
  /** A step open in Annotate on one white arrow, selected. */
  function selected(path: KnownDiagramAnnotation['path']) {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"/>';
    state().addDiagramPictures([{ id: 'asset-1', kind: 'svg', svg, widthPx: 400, heightPx: 300, bytes: svg.length }]);
    const stepId = state().diagramSelectedStepId!;
    state().openDiagramStep(stepId, 'annotate');
    state().editDiagramAnnotations(stepId, 'Add annotation', () => [
      { id: 'w', kind: 'white-arrow', from: [0.2, 0.5], to: [0.6, 0.5], path, width: 'regular', tail: 'pointed' },
    ]);
    state().selectDiagramAnnotation('w');
    return stepId;
  }
  const arrow = () => stepsIn(state().diagram!)[0]!.annotations[0] as KnownDiagramAnnotation;

  it('is no key of a straight white arrow’s, which a flip mirrors onto itself, and flips a bent one', () => {
    const stepId = selected([{ at: [0.2, 0.5] }, { at: [0.6, 0.5] }]);
    const past = state().diagramHistory.past.length;
    expect(runtime.diagram!('diagram.flipArc')).toBe(false);
    expect(state().diagramHistory.past).toHaveLength(past);
    state().editDiagramAnnotations(stepId, 'Shape', () => [
      { ...arrow(), path: [{ at: [0.2, 0.5], out: [0.3, 0.3] }, { at: [0.6, 0.5] }] },
    ]);
    state().selectDiagramAnnotation('w');
    expect(runtime.diagram!('diagram.flipArc')).toBe(true);
    expect(arrow().path![0]!.out![1]).toBeCloseTo(0.7, 12);
  });
});
