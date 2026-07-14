import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldDocument, SequencePlan, SequenceStateSnapshot } from '../../engine/types';
import { createSampleProject } from '../../lib/sampleProject';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { TooltipProvider } from '../ui/Tooltip';
import { SimulatorPanel } from './SimulatorPanel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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
  it('renders whole-mode labels by default', () => {
    const rendered = renderPanel({ foldArtifacts: { fold: simpleFold() } });

    expect(rendered.querySelector('[aria-label="Fold percent"]')).not.toBeNull();
    expect(rendered.querySelector('[aria-label="Simulator scope"]')?.textContent).toContain('Whole');
    expect(rendered.querySelector('[aria-label="Step simulation accuracy"]')).toBeNull();
    expect(rendered.querySelector('[aria-label="Lighting"]')?.getAttribute('data-active')).toBe(
      'true'
    );
    expect(rendered.querySelector('.simulator-canvas')?.getAttribute('data-lighting')).toBe(
      'true'
    );
    expect(rendered.textContent).not.toContain('Manual preview');
    expect(putImageDataMock).toHaveBeenCalled();
    expect(fillMock).toHaveBeenCalledTimes(putImageDataMock.mock.calls.length);

    act(() => {
      rendered.querySelector<HTMLButtonElement>('[aria-label="Lighting"]')?.click();
    });

    expect(rendered.querySelector('[aria-label="Lighting"]')?.hasAttribute('data-active')).toBe(
      false
    );
    expect(rendered.querySelector('.simulator-canvas')?.getAttribute('data-lighting')).toBeNull();
  });

  it('triangulates polygonal fold faces before rendering', () => {
    const rendered = renderPanel({ foldArtifacts: { fold: quadFold() } });

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
});

function renderPanel(state: Partial<ReturnType<typeof useWorkspaceStore.getState>>) {
  useWorkspaceStore.setState(
    {
      ...useWorkspaceStore.getInitialState(),
      project: createSampleProject(),
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
