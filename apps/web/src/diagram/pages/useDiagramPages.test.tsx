import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { createDiagram, insertSteps, setPageSetup, type DiagramDocument } from '../document/diagramDocument';
import { cpStep } from '../document/diagramSteps.fixtures';
import { DiagramFontDownloadError } from '../fonts/diagramFonts';
import type { PreparedDiagramPages } from './diagramPages';
import { cellSlots } from './stepPlaces';
import { useDiagramPages, type DiagramPagesBinding } from './useDiagramPages';

const prepare = vi.hoisted(() => vi.fn());
vi.mock('./diagramPages', () => ({ prepareDiagramPages: prepare }));
const report = vi.hoisted(() => vi.fn());
vi.mock('../../monitoring', async (importOriginal) => ({ ...(await importOriginal<object>()), reportError: report }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let seen: DiagramPagesBinding | null = null;

function Pages({ document }: { document: DiagramDocument }) {
  const state = useDiagramPages(document);
  useEffect(() => {
    seen = state;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  report.mockReset();
  prepare.mockReset();
  prepare.mockImplementation(
    async (document: DiagramDocument) => ({ of: document, layout: { pages: [] }, unavailableFonts: [] }) as unknown as PreparedDiagramPages
  );
  host = document.createElement('div');
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('useDiagramPages', () => {
  it('lays out the last diagram of a burst of edits, not each', async () => {
    let document = createDiagram({ title: 'Heart' });
    act(() => root.render(<Pages document={document} />));
    // Arrow Up held in the path's width: a new diagram per repeat, each before the last laid out.
    const widths: DiagramDocument[] = [];
    for (const mm of [27, 28, 29, 30]) {
      document = setPageSetup(document, { pathWidthMm: mm });
      widths.push(document);
      act(() => root.render(<Pages document={document} />));
    }
    expect(prepare).not.toHaveBeenCalled();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(prepare.mock.calls[0]![0]).toBe(widths.at(-1));
    expect(seen?.of).toBe(widths.at(-1));
  });

  /** A diagram of one page installed in the store, and what a layout of it packed: that page, as it is. */
  function installedWithPacking() {
    useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
    const document = insertSteps(createDiagram({ title: 'Heart' }), [cpStep('s0'), cpStep('s1')], 0);
    useWorkspaceStore.getState().installDiagram({ document, readOnly: false, raw: {} });
    const installed = useWorkspaceStore.getState().diagram!;
    const packed = {
      s0: {
        signature: cellSlots(installed).signatures[0]!,
        k: 1,
        steps: {
          s0: { box: [12, 30, 40, 50] as [number, number, number, number], scale: { mmPerUnit: 0.2 }, band: 0 },
          s1: { box: [60, 30, 40, 50] as [number, number, number, number], scale: { mmPerUnit: 0.2 }, band: 0 },
        },
      },
    };
    return { installed, packed };
  }

  it('adopts the flow pages a layout packed into the diagram it laid out, and takes the same pages for it, laid out once', async () => {
    const { installed, packed } = installedWithPacking();
    const adoptedAs = vi.fn((of: DiagramDocument) => ({ of, layout: { pages: [] }, unavailableFonts: [] }) as unknown as PreparedDiagramPages);
    prepare.mockImplementation(
      async (of: DiagramDocument) => ({ of, layout: { pages: [], packed }, adoptedAs, unavailableFonts: [] }) as unknown as PreparedDiagramPages
    );
    act(() => root.render(<Pages document={installed} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // Taken in, with no edit: the store's diagram is the one laid out, its page held.
    const adopted = useWorkspaceStore.getState().diagram!;
    expect(adopted).not.toBe(installed);
    expect(Object.keys(adopted.pageArrangements!)).toEqual(['s0']);
    expect(useWorkspaceStore.getState().dirty).toBe(false);
    // The adopted diagram takes these pages: not laid out again.
    act(() => root.render(<Pages document={adopted} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(prepare).toHaveBeenCalledTimes(1);
    expect(adoptedAs).toHaveBeenCalledWith(adopted);
    expect(seen?.of).toBe(adopted);
    expect(seen?.pages).toBe(adoptedAs.mock.results[0]!.value);
  });

  it('draws, but never adopts, the packing of a layout that went without a CJK face its text needs', async () => {
    const { installed, packed } = installedWithPacking();
    const pages = { of: installed, layout: { pages: [], packed }, adoptedAs: vi.fn(), unavailableFonts: [{ key: 'sc', weight: 400 }] };
    prepare.mockImplementation(async () => pages as unknown as PreparedDiagramPages);
    act(() => root.render(<Pages document={installed} />));
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    // Drawn as packed; the store's diagram as it was, its pages to be packed again once the face is had.
    expect(seen?.pages).toBe(pages);
    expect(useWorkspaceStore.getState().diagram).toBe(installed);
    expect(installed.pageArrangements).toBeUndefined();
    expect(pages.adoptedAs).not.toHaveBeenCalled();
  });

  /** `happen`, rendered, then the layout it starts, once the timers have run. */
  async function settled(happen: () => void) {
    act(happen);
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  }

  it('reports nothing for a font the network would not give, and lays out again once back online (ORI-STUDIO-16)', async () => {
    const document = createDiagram({ title: 'Heart' });
    prepare.mockRejectedValueOnce(new DiagramFontDownloadError('/assets/NotoSans-Regular.ttf could not be downloaded'));
    await settled(() => root.render(<Pages document={document} />));
    expect(seen?.failed).toBe(true);
    expect(report).not.toHaveBeenCalled();
    await settled(() => window.dispatchEvent(new Event('online')));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(seen).toMatchObject({ failed: false, of: document });
    // Laid out, it no longer listens.
    await settled(() => window.dispatchEvent(new Event('online')));
    expect(prepare).toHaveBeenCalledTimes(2);
  });

  it('lays out again once back online after a layout went without a CJK face, and has it', async () => {
    const document = createDiagram({ title: 'Heart' });
    const without = { of: document, layout: { pages: [] }, unavailableFonts: [{ key: 'jp', weight: 400 }] };
    prepare.mockResolvedValueOnce(without as unknown as PreparedDiagramPages);
    await settled(() => root.render(<Pages document={document} />));
    expect(seen?.pages).toBe(without);
    await settled(() => window.dispatchEvent(new Event('online')));
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(seen?.pages?.unavailableFonts).toEqual([]);
  });

  it('lays the diagram out again on Try again, and reports a layout that failed for anything else', async () => {
    const document = createDiagram({ title: 'Heart' });
    const broken = new Error('a font that does not read');
    prepare.mockRejectedValueOnce(broken);
    await settled(() => root.render(<Pages document={document} />));
    expect(seen?.failed).toBe(true);
    expect(report).toHaveBeenCalledWith(broken, { surface: 'diagram:pages' });
    await settled(() => seen!.retry());
    expect(prepare).toHaveBeenCalledTimes(2);
    expect(seen?.failed).toBe(false);
  });
});
