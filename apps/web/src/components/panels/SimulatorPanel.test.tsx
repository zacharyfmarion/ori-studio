import { singleTreemakerDesignTab } from '../../store/workspaceStore/designTabs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument, SequencePlan, SequenceStateSnapshot } from '../../engine/types';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { SimulatorPanel } from './SimulatorPanel';
import { createSimulatorSession } from '../../simulator/simulatorSession';
import { handleShortcutRuntimeKeyDown } from '../../keyboard/shortcutRuntime';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The solver runs in a Worker, which jsdom does not provide. Rather than stub
// out the simulator (which would stop these tests exercising triangulation and
// the render path at all), run the real session in-process -- simulatorWorker
// is only a comlink wrapper around it, so this is the same code the app runs.
// comlink makes every session method async in production; the runtime relies on
// that (client.tick(...).then, mutate(client).catch). Wrap the in-process
// session so its methods return promises too, otherwise unsettling the model
// (e.g. scrubbing the fold) would call .then/.catch on a sync return value.
function asPromiseClient<T extends object>(session: T): T {
  return new Proxy(session, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function') return value;
      return (...args: unknown[]) => Promise.resolve(value.apply(target, args));
    },
  });
}

vi.mock('../../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => asPromiseClient(createSimulatorSession()),
  releaseSimulatorClient: () => {},
  simulatorClientRefCount: () => 1,
}));

/**
 * Let the runtime's load -> settle -> first frame chain resolve. The worker API
 * is async, so a rendered panel has no geometry until these microtasks flush.
 */
async function flushSimulator(): Promise<void> {
  for (let i = 0; i < 12; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let canvasContext: CanvasRenderingContext2D;
let putImageDataMock: ReturnType<typeof vi.fn>;
let fillMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  canvasContext = mockCanvasContext();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(canvasContext);
  vi.spyOn(HTMLCanvasElement.prototype, 'getBoundingClientRect').mockReturnValue({
    width: 420,
    height: 320,
    x: 0,
    y: 0,
    top: 0,
    right: 420,
    bottom: 320,
    left: 0,
    toJSON: () => ({}),
  });
});

afterEach(() => {
  if (root) {
    act(() => {
      root?.unmount();
    });
  }
  container?.remove();
  root = null;
  container = null;
  vi.restoreAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('SimulatorPanel', () => {
  it('renders whole-mode labels by default', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    expect(rendered.querySelector('[aria-label="Fold percent"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Simulator scope"]')?.textContent).toContain('Whole');
    expect(rendered.querySelector('[aria-label="Step simulation accuracy"]')).toBeNull();
    expect(rendered.querySelector('.simulator-canvas')?.getAttribute('data-lighting')).toBe(
      'true'
    );
    expect(rendered.textContent).not.toContain('Manual preview');
    expect(putImageDataMock).toHaveBeenCalled();
    expect(fillMock).toHaveBeenCalledTimes(putImageDataMock.mock.calls.length);

    // The render toggles now live in the options pane (a sibling panel), so the
    // canvas follows the shared store setting rather than a local button.
    act(() => {
      useWorkspaceStore.getState().setSimulatorSetting('lighting', false);
    });

    expect(rendered.querySelector('.simulator-canvas')?.getAttribute('data-lighting')).toBeNull();
  });

  it('offers the current view for export once a model is loaded', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    const trigger = rendered.querySelector<HTMLButtonElement>('[aria-label="Export view"]');
    expect(trigger).not.toBeNull();
    expect(trigger?.disabled).toBe(false);
  });

  it('does not offer an export with nothing to draw', () => {
    // Rendered with no fold artifacts, so the panel never reaches "ready". An
    // enabled control here would open a dialog and then fail.
    const rendered = renderPanel({});

    const trigger = rendered.querySelector<HTMLButtonElement>('[aria-label="Export view"]');
    expect(trigger?.disabled).toBe(true);
  });

  it('triangulates polygonal fold faces before rendering', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: quadFold() } });
    await flushSimulator();

    expect(rendered.textContent).toContain('4 vertices | 2 triangles');
  });

  it('renders step-mode labels and manual-collapse warning copy when focused', () => {
    const plan = manualCollapsePlan();
    const rendered = renderPanel({
      foldArtifacts: { fold: simpleFold() },
      sequencePlan: plan,
      sequenceSimulationFocus: { kind: 'sequence_step', stepId: 'manual' },
    });

    expect(rendered.querySelector('[aria-label="Step percent"]')).not.toBeNull();
    expect(rendered.textContent).toContain('Step 1: manual collapse');
    expect(rendered.textContent).toContain('Manual preview');
    expect(rendered.querySelector('[aria-label="Step simulation accuracy"]')?.textContent).toContain(
      'Fast'
    );
    expect(activeAccuracyButton(rendered)?.textContent).toBe('Fast');
  });

  it('lets step simulation switch between accurate and fast solver work', () => {
    const plan = manualCollapsePlan();
    const rendered = renderPanel({
      foldArtifacts: { fold: simpleFold() },
      sequencePlan: plan,
      sequenceSimulationFocus: { kind: 'sequence_step', stepId: 'manual' },
    });
    const accuracyControl = rendered.querySelector('[aria-label="Step simulation accuracy"]');
    const accurateButton = Array.from(accuracyControl?.querySelectorAll('button') ?? []).find(
      (button) => button.textContent === 'Accurate'
    );

    expect(activeAccuracyButton(rendered)?.textContent).toBe('Fast');
    act(() => {
      accurateButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(activeAccuracyButton(rendered)?.textContent).toBe('Accurate');
  });

  it('drives the transport from the keyboard', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    // Space toggles play/pause (observed via the button's accessible name).
    expect(rendered.querySelector('[aria-label="Play"]')).not.toBeNull();
    act(() => pressKey(' '));
    expect(rendered.querySelector('[aria-label="Pause"]')).not.toBeNull();
    act(() => pressKey(' '));
    expect(rendered.querySelector('[aria-label="Play"]')).not.toBeNull();

    // Shift+Arrow jumps the fold to the ends of the timeline.
    act(() => pressKey('ArrowRight', { shiftKey: true }));
    expect(rendered.querySelector('output')?.textContent).toBe('100%');
    act(() => pressKey('ArrowLeft', { shiftKey: true }));
    expect(rendered.querySelector('output')?.textContent).toBe('0%');

    // A plain arrow scrubs by a step, so 0 -> right lands above 0.
    act(() => pressKey('ArrowRight'));
    const scrubbed = Number(rendered.querySelector('output')?.textContent?.replace('%', ''));
    expect(scrubbed).toBeGreaterThan(0);

    // Let the async settle the scrubs kicked off resolve before teardown, so the
    // in-flight worker mutation is not rejected by unmount.
    await flushSimulator();
  });

  it('ignores shortcuts while typing in a field', async () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });
    await flushSimulator();

    const foldInput = rendered.querySelector<HTMLInputElement>('[aria-label="Fold percent"]');
    expect(foldInput).not.toBeNull();

    // A Space keydown originating from the range input must not toggle play.
    act(() => {
      foldInput?.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    });
    expect(rendered.querySelector('[aria-label="Play"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Pause"]')).toBeNull();
  });
});

/**
 * Drive a chord through the real shortcut dispatcher.
 *
 * The panel no longer owns a `window` keydown listener — its bindings are
 * registered with the dispatcher, which the app shell installs on `document` in
 * the capture phase and which this unit test does not mount. Going through
 * `handleShortcutRuntimeKeyDown` exercises the registration and the scope stack,
 * which is the part that can actually regress.
 */
function pressKey(key: string, init: KeyboardEventInit = {}): void {
  handleShortcutRuntimeKeyDown(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }),
    {
      context: { activeEditingContext: 'crease-pattern' },
      menu: () => {},
    }
  );
}

function renderPanel(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      ...singleTreemakerDesignTab({ project: createSampleProject() }),
      status: 'crease_pattern_ready',
      engineReady: true,
      ...state,
    },
    true
  );

  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root?.render(
      <TooltipProvider>
        <SimulatorPanel />
      </TooltipProvider>
    );
  });
  return container;
}

function activeAccuracyButton(rendered: HTMLDivElement): HTMLButtonElement | null {
  const accuracyControl = rendered.querySelector('[aria-label="Step simulation accuracy"]');
  return (
    Array.from(accuracyControl?.querySelectorAll('button') ?? []).find(
      (button) => button.getAttribute('aria-pressed') === 'true'
    ) ?? null
  );
}

function manualCollapsePlan(): SequencePlan {
  const before = sequenceState('before', simpleFold(['B', 'B', 'B', 'B', 'F'], [null, null, null, null, 0]));
  const after = sequenceState('after', simpleFold());
  return {
    status: 'partial',
    steps: [
      {
        kind: 'manual_collapse',
        id: 'manual',
        label: 'Collapse up until this point',
        affected_creases: [4],
        affected_faces: [0, 1],
        before_state: before.id,
        after_state: after.id,
      },
    ],
    states: [before, after],
    diagnostics: [],
    unresolved_regions: [],
    search: {
      states_explored: 2,
      branches_pruned: 0,
      repeated_states: 0,
      timed_out: false,
      budget_exhausted: false,
      best_unresolved_creases: 0,
      target_solves: 0,
      target_solve_cache_hits: 0,
      duplicate_candidates_pruned: 0,
    },
  };
}

function sequenceState(id: string, document: FoldDocument): SequenceStateSnapshot {
  return {
    id,
    document,
    active_creases: [],
    face_orders: [],
    folded_vertices: document.vertices_coords.map((coord) => [coord[0] ?? 0, coord[1] ?? 0]),
    unresolved_regions: [],
    diagnostics: [],
  };
}

function simpleFold(
  assignments: FoldDocument['edges_assignment'] = ['B', 'B', 'B', 'B', 'V'],
  foldAngles: FoldDocument['edges_foldAngle'] = [null, null, null, null, 180]
): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
      [0, 2],
    ],
    edges_assignment: assignments,
    edges_foldAngle: foldAngles,
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

function quadFold(): FoldDocument {
  return {
    file_spec: 1.2,
    frame_classes: ['creasePattern'],
    vertices_coords: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [2, 3],
      [3, 0],
    ],
    edges_assignment: ['B', 'B', 'B', 'B'],
    edges_foldAngle: [null, null, null, null],
    faces_vertices: [[0, 1, 2, 3]],
  };
}

function mockCanvasContext(): CanvasRenderingContext2D {
  const imageData = {
    data: new Uint8ClampedArray(420 * 360 * 4),
    width: 420,
    height: 360,
    colorSpace: 'srgb',
  } as ImageData;
  putImageDataMock = vi.fn();
  fillMock = vi.fn();
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    closePath: vi.fn(),
    fill: fillMock,
    stroke: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    getImageData: vi.fn(() => imageData),
    putImageData: putImageDataMock,
    setLineDash: vi.fn(),
    getLineDash: vi.fn(() => []),
    globalAlpha: 1,
    fillStyle: '',
    shadowBlur: 0,
    shadowColor: '',
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
}
