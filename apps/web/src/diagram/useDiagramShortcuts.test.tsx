import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiagramShortcutId } from '../keyboard/shortcuts';
import { useWorkspaceStore } from '../store/workspaceStore';
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
