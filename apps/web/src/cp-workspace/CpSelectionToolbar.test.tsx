import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpLineSegment } from '../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { emptyOristudioCpSelection } from '../lib/creasePatternViewport';
import { TooltipProvider } from '../components/ui/Tooltip';
import { CpSelectionToolbar } from './CpSelectionToolbar';

// The toolbar reads segments-only artifacts from the module cache (populated via
// the kernel export); stub that source so the test drives the resolver with a
// fixed fold, already "cached" so no async round trip is involved.
vi.mock('./cpSegmentationArtifacts', () => ({
  ensureCpSegmentationArtifacts: vi.fn(async () => ({ fold: makeFold(), simulation_model: null })),
  peekCpSegmentationArtifacts: vi.fn(() => ({ fold: makeFold(), simulation_model: null })),
}));

function renderToolbar(root: Root, container: HTMLElement): void {
  root.render(
    <TooltipProvider>
      <CpSelectionToolbar container={container} />
    </TooltipProvider>
  );
}

// FloatingToolbar's autoUpdate attaches a ResizeObserver, absent in jsdom.
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

// Two bordered squares sharing a middle wall; left region = line ids [1,3,5,7,8].
function makeFold(): FoldDocument {
  return {
    vertices_coords: [
      [0, 0],
      [1, 0],
      [2, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
    edges_vertices: [
      [0, 1],
      [1, 2],
      [0, 3],
      [2, 5],
      [3, 4],
      [4, 5],
      [1, 4],
      [0, 4],
      [1, 5],
    ],
    edges_assignment: ['B', 'B', 'B', 'B', 'B', 'B', 'B', 'M', 'V'],
    faces_vertices: [
      [0, 1, 4],
      [0, 4, 3],
      [1, 2, 5],
      [1, 5, 4],
    ],
  };
}

const LINES: Array<[number, number, number, number, string]> = [
  [0, 0, 1, 0, 'Black0'],
  [1, 0, 2, 0, 'Black0'],
  [0, 0, 0, 1, 'Black0'],
  [2, 0, 2, 1, 'Black0'],
  [0, 1, 1, 1, 'Black0'],
  [1, 1, 2, 1, 'Black0'],
  [1, 0, 1, 1, 'Black0'],
  [0, 0, 1, 1, 'Red1'],
  [1, 0, 2, 1, 'Blue2'],
];

function makeLine(ax: number, ay: number, bx: number, by: number, color: string): OristudioCpLineSegment {
  return {
    a: { x: ax, y: ay },
    b: { x: bx, y: by },
    active: '',
    color,
    selected: 0,
    customized: 0,
    customized_color: { red: 0, green: 0, blue: 0 },
  };
}

function seedStore(lines: number[]): void {
  const artifacts: FoldArtifacts = { fold: makeFold(), simulation_model: null };
  useWorkspaceStore.setState({
    // Only the fields the toolbar reads; cast the document-state wrapper.
    oristudioCpDocument: {
      document: {
        crease_pattern: {
          line_segments: LINES.map((line) => makeLine(...line)),
          circles: [],
          points: [],
          aux_line_segments: [],
          texts: [],
          grid: {},
        },
        metadata: {},
      },
    },
    oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
    foldArtifacts: artifacts,
  } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
}

describe('CpSelectionToolbar', () => {
  let host: HTMLDivElement;
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    cpOverlayViewStore.set({
      model: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
      user: { origin: [0, 0], ex: [1, 0], ey: [0, 1] },
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    container.remove();
  });

  it('renders nothing when the selection is not a complete enclosed segment', async () => {
    seedStore([7, 8]); // interior-only, partial
    await act(async () => renderToolbar(root, container));
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('renders the action toolbar when the selection matches one segment', async () => {
    seedStore([1, 3, 5, 7, 8]); // the complete left region
    await act(async () => renderToolbar(root, container));
    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    // Fold, Export, Save to image, Simulate here, Simulate.
    expect(toolbar?.querySelectorAll('button').length).toBe(5);
    expect(document.querySelector('button[aria-label="Fold"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Simulate here"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Simulate"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Export…"]')).not.toBeNull();
  });

  it('dismisses itself when an action is invoked', async () => {
    seedStore([1, 3, 5, 7, 8]);
    await act(async () => renderToolbar(root, container));
    const save = document.querySelector<HTMLButtonElement>('button[aria-label="Save to image"]');
    expect(save).not.toBeNull();
    await act(async () => save!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // The action clears the selection, so the resolver no longer matches.
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('survives a remount without refetching segmentation', async () => {
    // Segmentation takes ~1s on a large document while the panel may unmount and
    // remount this component; holding the result in component state meant it was
    // discarded and refetched indefinitely, so the toolbar never appeared.
    const { ensureCpSegmentationArtifacts } = await import('./cpSegmentationArtifacts');
    seedStore([1, 3, 5, 7, 8]);
    await act(async () => renderToolbar(root, container));
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();

    act(() => root.unmount());
    vi.mocked(ensureCpSegmentationArtifacts).mockClear();
    root = createRoot(host);
    await act(async () => renderToolbar(root, container));
    // Reads straight from the cache on the very first render after remounting.
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(vi.mocked(ensureCpSegmentationArtifacts)).not.toHaveBeenCalled();
  });

  it('hides again when the selection is cleared', async () => {
    seedStore([1, 3, 5, 7, 8]);
    await act(async () => renderToolbar(root, container));
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    await act(async () => {
      useWorkspaceStore.setState({ oristudioCpSelection: emptyOristudioCpSelection() });
      renderToolbar(root, container);
    });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});
