import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../store/workspaceStore/store';
import type { OristudioCpFoldedFigureEntry } from '../engine/oristudioCpTypes';
import { cpOverlayViewStore } from './cpOverlayViewStore';
import { emptyOristudioCpSelection } from '../lib/creasePatternViewport';
import { TooltipProvider } from '../components/ui/Tooltip';
import { CpSelectionToolbar } from './CpSelectionToolbar';
import { resolveInlineSimulationRegion } from './inlineSimulation/resolveSimulationRegion';
import { selectionCoversEntireCp } from './references/useOpenReferences';
import {
  LEFT_SHEET,
  twoSheetDocument,
  twoSheetFold,
  twoSheetIndex,
} from './sheets/twoSheetsTestFixture';

// The toolbar reads the sheet index from its module cache (built by the
// kernel); stub that source so the test drives the resolver with a fixed index,
// already "cached" so no async round trip is involved. One sheet's faces are
// stubbed the same way, for the actions that build them.
vi.mock('./sheets/cpSheetIndex', () => ({
  ensureCpSheetIndex: vi.fn(async () => twoSheetIndex()),
  peekCpSheetIndex: vi.fn(() => twoSheetIndex()),
}));
vi.mock('./sheets/cpSheetArtifacts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sheets/cpSheetArtifacts')>();
  const artifacts = async (_document: unknown, sheet: number) =>
    actual.sheetArtifactsFromFold(twoSheetFold(sheet), sheet);
  return {
    ...actual,
    ensureCpSheetArtifacts: vi.fn(artifacts),
    ensureCpSheetSimulationArtifacts: vi.fn(artifacts),
  };
});

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

function seedStore(lines: number[]): void {
  useWorkspaceStore.setState({
    // Only the fields the toolbar reads; cast the document-state wrapper.
    oristudioCpDocument: { document: twoSheetDocument() },
    oristudioCpSelection: { ...emptyOristudioCpSelection(), lines },
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

  it('renders nothing when the selection is not a whole sheet', async () => {
    seedStore([5]); // the left sheet's diagonal alone
    await act(async () => renderToolbar(root, container));
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('renders the action toolbar when the selection is one whole sheet', async () => {
    seedStore(LEFT_SHEET);
    await act(async () => renderToolbar(root, container));
    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar).not.toBeNull();
    // Fold, Export, Save to image, Simulate inline, Simulate, Create shareable link. A
    // diagram step is made in the Diagram (D21), so there is no Add to diagram here.
    expect(toolbar?.querySelectorAll('button').length).toBe(6);
    expect(document.querySelector('button[aria-label="Add to diagram"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Fold"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Simulate inline"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Simulate"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Export…"]')).not.toBeNull();
    expect(document.querySelector('button[aria-label="Create shareable link"]')).not.toBeNull();
  });

  it('shares the sheet the selection resolved to, not the whole document', async () => {
    seedStore(LEFT_SHEET);
    const shareSheet = vi.fn(async () => true);
    useWorkspaceStore.setState({ shareOristudioCpSheet: shareSheet } as unknown as Partial<
      ReturnType<typeof useWorkspaceStore.getState>
    >);
    await act(async () => renderToolbar(root, container));

    const share = document.querySelector<HTMLButtonElement>('button[aria-label="Create shareable link"]');
    expect(share).not.toBeNull();
    await act(async () => share!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    // The sheet, not line ids: a share link carries one bordered crease
    // pattern, the same unit Fold / Export / Simulate operate on.
    expect(shareSheet).toHaveBeenCalledWith(0);
    // And like every sibling action it dismisses, so the toolbar cannot linger
    // over the modal it just opened.
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('hides the share button where sharing is unavailable', async () => {
    // Desktop, and dev builds that have not opted in. Every sibling action still works;
    // only the share verb disappears.
    shareEnabled.value = false;
    seedStore(LEFT_SHEET);
    await act(async () => renderToolbar(root, container));
    const toolbar = document.querySelector('[role="toolbar"]');
    expect(toolbar?.querySelectorAll('button').length).toBe(5);
    expect(document.querySelector('button[aria-label="Create shareable link"]')).toBeNull();
    expect(document.querySelector('button[aria-label="Fold"]')).not.toBeNull();
  });

  it('dismisses itself when an action is invoked', async () => {
    seedStore(LEFT_SHEET);
    await act(async () => renderToolbar(root, container));
    const save = document.querySelector<HTMLButtonElement>('button[aria-label="Save to image"]');
    expect(save).not.toBeNull();
    await act(async () => save!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    // The action clears the selection, so the resolver no longer matches.
    expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });

  it('survives a remount without refetching the sheet index', async () => {
    // The panel may unmount and remount this component; holding the index in
    // component state meant it was discarded and refetched indefinitely, so the
    // toolbar never appeared.
    const { ensureCpSheetIndex } = await import('./sheets/cpSheetIndex');
    seedStore(LEFT_SHEET);
    await act(async () => renderToolbar(root, container));
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();

    act(() => root.unmount());
    vi.mocked(ensureCpSheetIndex).mockClear();
    root = createRoot(host);
    await act(async () => renderToolbar(root, container));
    // Reads straight from the cache on the very first render after remounting.
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    expect(vi.mocked(ensureCpSheetIndex)).not.toHaveBeenCalled();
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
      seedStore(LEFT_SHEET);
      await act(async () => renderToolbar(root, container));
      const button = document.querySelector<HTMLButtonElement>(
        'button[aria-label="Simulate inline"]'
      );
      await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      // The segment resolved from the selection as it was, despite the toolbar
      // clearing it in the same tick — the hook snapshots state before awaiting.
      expect(add).toHaveBeenCalledTimes(1);
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
    });

    it('is the store that deselects, so no caller has to remember to', async () => {
      // The real action, not the stub: the sheet's faces are stubbed above, which
      // is the only thing on its success path that needs the engine.
      seedStore(LEFT_SHEET);
      // The region itself, resolved the way the toolbar and the shortcut resolve
      // it — an id would name a different region in the store's own segmentation.
      const state = useWorkspaceStore.getState();
      const match = await resolveInlineSimulationRegion(
        state.oristudioCpDocument?.document,
        state.oristudioCpSelection.lines
      );
      expect(match).not.toBeNull();
      expect(
        await state.addOristudioCpInlineSimulation({
          segment: match!.segment,
          cpLineIds: match!.cpLineIds,
        })
      ).toBe('added');
      expect(useWorkspaceStore.getState().oristudioCpSelection.lines).toEqual([]);
      expect(
        useWorkspaceStore.getState().oristudioCpFocusedInlineSimulationId
      ).not.toBeNull();
    });

    it('leaves nothing selected when the shortcut runs it', async () => {
      // Shift+S dispatches straight to the shared hook, with no toolbar in the
      // loop to dismiss anything.
      const add = stubAdd();
      seedStore(LEFT_SHEET);
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

  // The viewport bar's Fold and `G` both fold through the layer's bracket, so a
  // fold is one undo step. This button called the store's fold directly, so its
  // fold recorded nothing: Undo then did nothing at all, or — with an earlier
  // step on the stack — undid that step and took the figure with it.
  describe('folding the selection', () => {
    const realFold = useWorkspaceStore.getState().foldOristudioCpDocument;
    afterEach(() => {
      useWorkspaceStore.setState({ foldOristudioCpDocument: realFold });
    });

    /** What the store's fold resolves to; the real one needs the fold engine. */
    function stubFold() {
      const fold = vi.fn(async () => {
        useWorkspaceStore.setState({
          oristudioCpFoldedFigures: [
            ...useWorkspaceStore.getState().oristudioCpFoldedFigures,
            {
              id: 'folded-1',
              title: 'Folded model 1',
              handle: 7,
              sourceKind: 'generated-from-current-cp',
              sourceCpRevision: 0,
              startingFaceId: 1,
              displayStyle: 'Paper5',
              status: 'ready',
              snapshot: null,
              renderSnapshot: null,
              placement: { offset: { x: 0, y: 0 }, scale: 1, rotation: 0 },
              error: null,
            } as OristudioCpFoldedFigureEntry,
          ],
        });
        return true;
      });
      useWorkspaceStore.setState({
        // The Edit canvas, which is what makes undo the crease pattern's.
        activePanelId: 'crease-pattern',
        foldOristudioCpDocument: fold,
        oristudioCpFoldedFigures: [],
        oristudioCpActiveFoldedFigureId: null,
        oristudioCpHistoryPast: [],
        oristudioCpHistoryFuture: [],
      });
      return fold;
    }

    it('is one undo step, and undo takes the figure away', async () => {
      seedStore(LEFT_SHEET);
      const fold = stubFold();
      await act(async () => renderToolbar(root, container));
      const button = document.querySelector<HTMLButtonElement>('button[aria-label="Fold"]');
      await act(async () => button!.dispatchEvent(new MouseEvent('click', { bubbles: true })));

      // The sheet's creases, captured before the toolbar cleared the selection.
      expect(fold).toHaveBeenCalledWith(expect.objectContaining({ lineIds: LEFT_SHEET }));
      const past = useWorkspaceStore.getState().oristudioCpHistoryPast;
      expect(past).toHaveLength(1);
      expect(past[0]?.label).toBe('Fold model');

      await act(async () => useWorkspaceStore.getState().undo());
      expect(useWorkspaceStore.getState().oristudioCpFoldedFigures).toEqual([]);
    });
  });

  describe('the References button', () => {
    it('is absent for a sheet that is not the whole pattern', async () => {
      // References opens on the whole pattern and carries nothing over, so a
      // button on a partial selection would promise a scope it does not deliver.
      // The fixture's left sheet is five of the document's ten lines.
      seedStore(LEFT_SHEET);
      await act(async () => renderToolbar(root, container));
      expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
      expect(document.querySelector('button[aria-label="Folding references"]')).toBeNull();
    });

    it('is offered exactly when the matched sheet covers every line', () => {
      // The predicate the toolbar renders on, driven directly: the fixture has no
      // single sheet that is the whole document, so the positive case is a shape
      // test rather than a render.
      const cpDocument = twoSheetDocument();
      const everyLine = cpDocument.crease_pattern.line_segments.map((_, index) => index + 1);
      expect(selectionCoversEntireCp({ cpLineIds: everyLine }, cpDocument)).toBe(true);
      expect(selectionCoversEntireCp({ cpLineIds: LEFT_SHEET }, cpDocument)).toBe(false);
      expect(selectionCoversEntireCp(null, cpDocument)).toBe(false);
      expect(selectionCoversEntireCp({ cpLineIds: everyLine }, null)).toBe(false);
    });

    it('opens the References workspace through the store action', async () => {
      const openReferencesWorkspace = vi.fn();
      useWorkspaceStore.setState({ openReferencesWorkspace } as unknown as Partial<
        ReturnType<typeof useWorkspaceStore.getState>
      >);
      const { useOpenReferences } = await import('./references/useOpenReferences');
      let open: (() => void) | null = null;
      function Probe() {
        open = useOpenReferences();
        return null;
      }
      await act(async () => root.render(<Probe />));
      act(() => open!());
      expect(openReferencesWorkspace).toHaveBeenCalledTimes(1);
    });
  });

  it('hides again when the selection is cleared', async () => {
    seedStore(LEFT_SHEET);
    await act(async () => renderToolbar(root, container));
    expect(document.querySelector('[role="toolbar"]')).not.toBeNull();
    await act(async () => {
      useWorkspaceStore.setState({ oristudioCpSelection: emptyOristudioCpSelection() });
      renderToolbar(root, container);
    });
    expect(document.querySelector('[role="toolbar"]')).toBeNull();
  });
});
