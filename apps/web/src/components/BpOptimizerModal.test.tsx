import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BpOptimizerModal } from './BpOptimizerModal';
import { TooltipProvider } from './ui/Tooltip';
import { DEFAULT_BP_OPTIMIZER_OPTIONS, useBpOptimizerUiStore } from '../store/bpOptimizerUiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import type { BpOptimizerDialogOptions } from '../store/bpOptimizerUiStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const cancelMock = vi.hoisted(() => vi.fn());
vi.mock('../store/workspaceStore/oristudioBpRuntime', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../store/workspaceStore/oristudioBpRuntime')
  >();
  return { ...actual, cancelActiveOristudioBpOptimizer: cancelMock };
});

let root: Root | null = null;
let container: HTMLDivElement | null = null;

function renderModal() {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider delayDuration={0}>
        <BpOptimizerModal />
      </TooltipProvider>
    );
  });
  return container;
}

function text(): string {
  return container?.textContent ?? '';
}

function findButton(label: string): HTMLButtonElement {
  const button = Array.from(container?.querySelectorAll('button') ?? []).find(
    (element) => element.textContent?.trim() === label
  );
  expect(button, `button "${label}"`).toBeDefined();
  return button as HTMLButtonElement;
}

function countInput(): HTMLInputElement {
  const input = container?.querySelector('input[type="number"]');
  expect(input).toBeTruthy();
  return input as HTMLInputElement;
}

// React tracks the input's value internally, so assigning `.value` directly is
// swallowed. Go through the native setter first, as the other panel tests do.
function setValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function openWith(options: Partial<BpOptimizerDialogOptions> = {}) {
  useBpOptimizerUiStore.setState({
    isOpen: true,
    options: { ...DEFAULT_BP_OPTIMIZER_OPTIONS, ...options },
    running: false,
    progress: null,
    error: null,
  });
}

function optimizeSpy(outcome: 'applied' | 'cancelled' | 'failed' = 'applied') {
  const spy = vi.fn().mockResolvedValue(outcome);
  useWorkspaceStore.setState({ optimizeOristudioBpLayout: spy });
  return spy;
}

beforeEach(() => {
  localStorage.clear();
  cancelMock.mockReset();
  openWith();
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe('BpOptimizerModal', () => {
  it('renders nothing while closed', () => {
    useBpOptimizerUiStore.setState({ isOpen: false });
    expect(renderModal().textContent).toBe('');
  });

  it('opens on upstream defaults: current layout, no variations, dimensions kept', () => {
    renderModal();

    expect(text()).toContain('Optimize layout');
    expect(text()).toContain('Keep widths and heights of flaps');
    // View mode offers the variations toggle, not the candidate count.
    expect(text()).toContain('Try variations of the current layouts');
    expect(text()).not.toContain('Number of layouts to try:');

    const toggles = Array.from(container?.querySelectorAll('[role="switch"]') ?? []);
    expect(toggles).toHaveLength(2);
    expect(toggles[0].getAttribute('aria-checked')).toBe('true'); // useDimension
    expect(toggles[1].getAttribute('aria-checked')).toBe('false'); // useBasinHopping
  });

  it('swaps the variations toggle for the candidate count in random mode', () => {
    openWith({ layoutMode: 'random' });
    renderModal();

    expect(text()).toContain('Number of layouts to try:');
    expect(text()).not.toContain('Try variations of the current layouts');

    const input = countInput();
    expect(input.value).toBe('1');
    expect(input.min).toBe('1');
    // Upstream's range; do not narrow it to paper over a slow run.
    expect(input.max).toBe('100');
  });

  it('clamps the candidate count to upstream range', () => {
    openWith({ layoutMode: 'random' });
    renderModal();
    const input = countInput();

    setValue(input, '500');
    expect(useBpOptimizerUiStore.getState().options.randomCandidateCount).toBe(100);

    setValue(input, '0');
    expect(useBpOptimizerUiStore.getState().options.randomCandidateCount).toBe(1);
  });

  it('runs with the chosen options and closes on success', async () => {
    const spy = optimizeSpy('applied');
    openWith({
      useDimension: false,
      layoutMode: 'random',
      randomCandidateCount: 8,
    });
    renderModal();

    await act(async () => {
      findButton('Run!').click();
    });

    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toEqual({
      useDimension: false,
      layoutMode: 'random',
      useBasinHopping: false,
      randomCandidateCount: 8,
      // No BP document in this test, so symmetry cannot resolve and the run
      // does not ask the solver to mirror.
      respectSymmetry: false,
      symmetryFold: 'book',
    });
    expect(useBpOptimizerUiStore.getState().isOpen).toBe(false);
  });

  it('stays open without an error when the run is cancelled', async () => {
    optimizeSpy('cancelled');
    renderModal();

    await act(async () => {
      findButton('Run!').click();
    });

    const state = useBpOptimizerUiStore.getState();
    expect(state.running).toBe(false);
    expect(state.isOpen).toBe(true);
    expect(state.error).toBeNull();
  });

  it('surfaces a failed run and keeps the dialog open', async () => {
    optimizeSpy('failed');
    useWorkspaceStore.setState({ oristudioBpError: 'Solution exceeds maximal sheet size.' });
    renderModal();

    await act(async () => {
      findButton('Run!').click();
    });

    expect(useBpOptimizerUiStore.getState().isOpen).toBe(true);
    expect(useBpOptimizerUiStore.getState().error).toBe('Solution exceeds maximal sheet size.');
  });

  it('shows Abort and a determinate bar while a solve is in flight', () => {
    useBpOptimizerUiStore.setState({
      running: true,
      progress: {
        stage: 'integral-grid-fitting',
        label: 'Fitting',
        current: 3,
        total: 10,
        canSkip: false,
        canCancel: true,
        message: null,
      },
    });
    renderModal();

    expect(text()).toContain('Fitting to the grid...');
    expect(
      Array.from(container?.querySelectorAll('button') ?? []).some(
        (element) => element.textContent?.trim() === 'Run!'
      )
    ).toBe(false);

    const bar = container?.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBe('3');
    expect(bar?.getAttribute('aria-valuemax')).toBe('10');

    act(() => findButton('Abort').click());
    expect(cancelMock).toHaveBeenCalledOnce();
  });

  it('leaves the bar indeterminate for stages with no denominator', () => {
    useBpOptimizerUiStore.setState({
      running: true,
      progress: {
        stage: 'pre-solving',
        label: 'Pre-solving',
        current: 12,
        total: null,
        canSkip: false,
        canCancel: true,
        message: null,
      },
    });
    renderModal();

    const bar = container?.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute('aria-valuenow')).toBeNull();
    expect(container?.querySelector('.bp-optimizer__progress-fill--indeterminate')).toBeTruthy();
  });
});

describe('symmetry row', () => {
  function withTree(
    symmetry: Partial<{
      enabled: boolean;
      angle: number;
      loc: { x: number; y: number };
      pairs: { v1: number; v2: number }[];
    }> = {},
    sheetKind: 'rectangular' | 'diagonal' = 'rectangular',
    // A leaf that is neither on the mirror line nor opposite another one.
    stray = false
  ) {
    const sheet = { kind: sheetKind, width: 20, height: 20, grid: {} };
    useWorkspaceStore.setState({
      oristudioBpSymmetry: {
        enabled: true,
        angle: 90,
        loc: { x: 10, y: 10 },
        pairs: [],
        ...symmetry,
      },
      oristudioBpDocument: {
        snapshot: {
          tree: {
            sheet,
            vertices: [
              { id: 0, name: 'root', loc: { x: 10, y: 10 }, isLeaf: false },
              { id: 1, name: 'a', loc: { x: 6, y: 12 }, isLeaf: true },
              { id: 2, name: 'b', loc: { x: 14, y: 12 }, isLeaf: true },
              ...(stray ? [{ id: 3, name: 'c', loc: { x: 3, y: 4 }, isLeaf: true }] : []),
            ],
            edges: [
              { id: 0, vertices: [0, 1], length: 4 },
              { id: 1, vertices: [0, 2], length: 4 },
            ],
          },
        },
      },
    } as never);
  }

  it('says so when symmetry is off', () => {
    withTree({ enabled: false });
    renderModal();
    expect(text()).toContain('Symmetry is off');
  });

  it('says plainly that the toggle turns symmetry on', () => {
    // "Mirror the layout" read as a description of what the run does rather
    // than as the switch that enables it.
    withTree();
    renderModal();
    expect(text()).toContain('Enable symmetry');
  });

  it('names the fold, which belongs here rather than in the tree view', () => {
    // A tree is not drawn on the paper, so it has no book or diagonal fold of
    // its own; naming one only makes sense once there is paper.
    withTree();
    renderModal();
    expect(text()).toContain('Book fold');
  });

  it('names the fold the same way whatever the sheet', () => {
    // The name is paper-relative. Which grid axis it lands on does depend on the
    // sheet, but that is the optimizer's problem, not a label.
    withTree({}, 'diagonal');
    renderModal();
    expect(text()).toContain('Book fold');
  });

  it('does not touch the tree mirror line when the fold changes', () => {
    withTree();
    renderModal();
    const before = useWorkspaceStore.getState().oristudioBpSymmetry.angle;
    act(() => {
      useBpOptimizerUiStore.getState().setOptions({ symmetryFold: 'diagonal' });
    });
    expect(useWorkspaceStore.getState().oristudioBpSymmetry.angle).toBe(before);
  });

  it('explains why it cannot mirror instead of blocking the run', () => {
    // A flap with no mirror drawn and not on the line cannot be accounted for.
    withTree({}, 'rectangular', true);
    openWith({ layoutMode: 'view' });
    renderModal();
    expect(text()).toMatch(/mirrors/i);
    const run = findButton('Run!');
    expect(run.disabled).toBe(false);
  });

  it('does not ask the solver to mirror when it cannot be resolved', async () => {
    withTree({}, 'rectangular', true);
    openWith({ layoutMode: 'view', respectSymmetry: true });
    const spy = optimizeSpy();
    renderModal();
    await act(async () => {
      findButton('Run!').click();
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ respectSymmetry: false }),
      expect.anything()
    );
  });

  it('asks the solver to mirror when the pairing resolves', async () => {
    withTree();
    openWith({ layoutMode: 'view', respectSymmetry: true });
    const spy = optimizeSpy();
    renderModal();
    await act(async () => {
      findButton('Run!').click();
    });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({ respectSymmetry: true }),
      expect.anything()
    );
  });
});
