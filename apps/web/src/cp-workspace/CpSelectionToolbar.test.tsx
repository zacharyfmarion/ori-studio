import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoldArtifacts, FoldDocument } from '../engine/types';
import type { OristudioCpLineSegment } from '../engine/oristudioCpTypes';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { emptyOristudioCpSelection } from '../lib/creasePatternViewport';
import { resolveSelectedSegment } from '../lib/creasePatternSelectionSegment';
import { TooltipProvider } from '../components/ui/Tooltip';
import { CpSelectionToolbar } from './CpSelectionToolbar';

// The toolbar reads segments-only artifacts from the module cache (populated via
// the kernel export); stub that source so the test drives the resolver with a
// fixed fold, already "cached" so no async round trip is involved.
vi.mock('./cpSegmentationArtifacts', () => ({
  ensureCpSegmentationArtifacts: vi.fn(async () => ({ fold: makeFold(), simulation_model: null })),
  peekCpSegmentationArtifacts: vi.fn(() => ({ fold: makeFold(), simulation_model: null })),
}));

// Sharing is gated: web-only, and off in dev builds unless VITE_SHARE_API_URL opts in,
// so a dev build cannot write into the production share namespace by accident. Under
// test neither holds, so the gate is driven explicitly rather than left to the ambient
// environment.
const shareEnabled = vi.hoisted(() => ({ value: true }));
vi.mock('./share/cpShareService', () => ({
  isShareEnabled: () => shareEnabled.value,
}));

function renderToolbar(root: Root, container: HTMLElement): void {
  root.render(
    <TooltipProvider>
      <CpSelectionToolbar container={container} />
    </TooltipProvider>,
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

function makeLine(
  ax: number,
  ay: number,
  bx: number,
  by: number,
  color: string,
): OristudioCpLineSegment {
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
    // Reset the gate so a test that turns it off cannot leak into later ones.
    shareEnabled.value = true;
    // Origin offset so the fixture's unit-square selection sits well inside the
    // pane below rather than straddling its edge — the toolbar now hides for an
    // anchor outside its boundary, and a selection pinned to 0,0 would be
    // deciding that on a one-pixel overlap.
    cpOverlayViewStore.set({
      model: { origin: [100, 100], ex: [1, 0], ey: [0, 1] },
      user: { origin: [100, 100], ex: [1, 0], ey: [0, 1] },
    });
    container = document.createElement('div');
    // jsdom lays nothing out, so the pane the toolbar is confined to has to be
    // stated. 1000x600 at the origin.
    container.getBoundingClientRect = () => new DOMRect(0, 0, 1000, 600);
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
    // Fold, Export, Save to image, Simulate inline, Simulate, Create shareable link.
    expect(toolbar?.querySelectorAll('button').length).toBe(6);
    expect(document.querySelector('button[aria-label="Fold"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Simulate inline"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Simulate"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Export…"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Create shareable link"]')).not.toBeNull();
  });

  it('shares the segment the selection resolved to, not the whole document', async () => {
    seedStore([1, 3, 5, 7, 8]);
    const shareSegment = vi.fn(async () => true);
    useWorkspaceStore.setState({ shareOristudioCpSegment: shareSegment } as unknown as Partial<
      ReturnType<typeof useWorkspaceStore.getState>
    >);
    await act(async () => renderToolbar(root, container));

    const share = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Create shareable link"]',
    );
    expect(share).not.toBeNull();
    await act(async () => share!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // Segment id, not line ids: a share link carries one bordered crease
    // pattern, the same unit Fold / Export / Simulate operate on.
    expect(shareSegment).toHaveBeenCalledWith(0);
    // And like every sibling action it dismisses, so the toolbar cannot linger
    // over the modal it just opened.
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('hides the share button where sharing is unavailable', async () => {
    // Desktop, and dev builds that have not opted in. Every sibling action still works;
    // only the share verb disappears.
    shareEnabled.value = false;
    seedStore([1, 3, 5, 7, 8]);
    await act(async () => renderToolbar(root, container));
    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar?.querySelectorAll('button').length).toBe(5);
    expect(document.querySelector('button[aria-label="Create shareable link"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Fold"]')).not.toBeNull();
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

  // Simulating a region deselects it, from the button *and* from Shift+S. The
  // hook exists so the two entry points cannot disagree about what counts as a
  // simulatable region, but the deselect used to live only in the toolbar's
  // dismiss-on-action wrapper, so the keyboard skipped it and left the creases
  // selected under the new window.
  describe('simulating a region deselects it', () => {
    // Stubbing a store action mutates the shared store, and nothing in this file
    // resets it between tests — so put the real one back, or a later test gets
    // the previous test's stub and passes on it.
    const realAdd = useWorkspaceStore.getState().addOristudioCpInlineSimulation;
    beforeEach(() => {
      useWorkspaceStore.setState({
        addOristudioCpInlineSimulation: realAdd,
        oristudioCpInlineSimulations: [],
        oristudioCpFocusedInlineSimulationId: null,
      } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
    });

    /** What the store's add resolves to; the real one needs the fold engine. */
    function stubAdd() {
      const add = vi.fn(async () => {
        // Stands in for `takeCanvasSelection('inline-simulation', …)`.
        useWorkspaceStore.setState({ oristudioCpSelection: emptyOristudioCpSelection() });
        return 'added' as const;
      });
      useWorkspaceStore.setState({
        addOristudioCpInlineSimulation: add,
      } as unknown as Partial<ReturnType<typeof useWorkspaceStore.getState>>);
      return add;
    }

    it('leaves nothing selected when the button runs it', async () => {
      const add = stubAdd();
      seedStore([1, 3, 5, 7, 8]);
      await act(async () => renderToolbar(root, container));
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Simulate inline"]',
      );
      await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      // The segment resolved from the selection as it was, despite the toolbar
      // clearing it in the same tick — the hook snapshots state before awaiting.
      expect(add).toHaveBeenCalledTimes(1);
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
    });

    it('is the store that deselects, so no caller has to remember to', async () => {
      // The real action, not the stub: `foldArtifacts` is already seeded, which
      // is the only thing on its success path that needs the engine.
      seedStore([1, 3, 5, 7, 8]);
      // The region itself, resolved the way the toolbar and the shortcut resolve
      // it — an id would name a different region in the store's own segmentation.
      const state = useWorkspaceStore.getState();
      const match = resolveSelectedSegment(
        state.oristudioCpDocument?.document,
        state.oristudioCpSelection,
        state.foldArtifacts,
      );
      expect(match).not.toBeNull();
      expect(
        await state.addOristudioCpInlineSimulation({
          segment: match!.segment,
          cpLineIds: match!.cpLineIds,
        }),
      ).toBe('added');
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
      expect(useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId).not.toBeNull();
    });

    it('leaves nothing selected when the shortcut runs it', async () => {
      // Shift+S dispatches straight to the shared hook, with no toolbar in the
      // loop to dismiss anything.
      const add = stubAdd();
      seedStore([1, 3, 5, 7, 8]);
      const { useSimulateSelection } = await import('./inlineSimulation/useSimulateSelection');
      let simulate: (() => Promise<void>) | null = null;
      function Probe() {
        simulate = useSimulateSelection();
        return null;
      }
      await act(async () => root.render(<Probe />));
      await act(async () => simulate!());

      expect(add).toHaveBeenCalledTimes(1);
      // The region, not an id — the shortcut hands over the same descriptor the
      // toolbar does, so neither can resolve against a second segmentation.
      expect(add).toHaveBeenCalledWith({
        segment: expect.objectContaining({ id: expect.any(Number) }),
        cpLineIds: expect.any(Array),
      });
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
    });
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
