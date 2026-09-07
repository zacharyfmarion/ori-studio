import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  useReferencesAutoPlan,
  type ReferencesAutoPlanState,
} from './useReferencesAutoPlan';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

function state(overrides: Partial<ReferencesAutoPlanState> = {}): ReferencesAutoPlanState {
  return {
    hasDocument: true,
    revision: 'r1',
    sheet: 0,
    ready: true,
    planned: false,
    busy: false,
    targeted: false,
    ...overrides,
  };
}

/**
 * Declared once, outside `render`: a component type declared per call is a
 * different type each time, so React would unmount and remount — and the hook's
 * memory of what it has attempted lives in a ref on that instance.
 */
function Probe({ value, run }: { value: ReferencesAutoPlanState; run: () => void }) {
  useReferencesAutoPlan(value, run);
  return null;
}

function render(next: ReferencesAutoPlanState, run: () => void) {
  act(() => root?.render(<Probe value={next} run={run} />));
}

describe('useReferencesAutoPlan', () => {
  it('works out the sequence on arrival, without a gesture', () => {
    const run = vi.fn();
    render(state(), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('waits for the frames analysis, then runs once', () => {
    const run = vi.fn();
    render(state({ ready: false, sheet: null }), run);
    expect(run).not.toHaveBeenCalled();
    render(state(), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  // The three ways an automatic run turns into a loop. All three leave the pair
  // attempted with no plan behind, and none should be retried unasked.
  it('never starts the same sheet and revision twice', () => {
    const run = vi.fn();
    render(state(), run);
    render(state(), run);
    render(state({ busy: true }), run);
    render(state(), run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again for a different sheet, and for a different revision', () => {
    const run = vi.fn();
    render(state(), run);
    render(state({ sheet: 3 }), run);
    expect(run).toHaveBeenCalledTimes(2);
    render(state({ revision: 'r2' }), run);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it('does not run while something is already computing', () => {
    const run = vi.fn();
    render(state({ busy: true }), run);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not run while a vertex or crease is picked', () => {
    const run = vi.fn();
    render(state({ targeted: true }), run);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not run when a plan for this sheet already exists', () => {
    const run = vi.fn();
    render(state({ planned: true }), run);
    expect(run).not.toHaveBeenCalled();
  });

  it('does not run without a crease pattern', () => {
    const run = vi.fn();
    render(state({ hasDocument: false }), run);
    expect(run).not.toHaveBeenCalled();
  });
});
