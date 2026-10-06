import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useDiagramPrintUiStore } from '../../store/diagramPrintUiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { PreparedDiagramPages } from '../pages/diagramPages';
import { printDiagram, type DiagramPrintDependencies } from './printDiagram';

const mocks = vi.hoisted(() => ({ reportError: vi.fn(), toastError: vi.fn() }));
vi.mock('../../monitoring', () => ({ reportError: mocks.reportError }));
vi.mock('sonner', () => ({ toast: { error: mocks.toastError } }));

/** Pages as the layout makes them: A5 landscape, three of them, each its own SVG. */
function prepared(): PreparedDiagramPages {
  return {
    layout: { paper: { widthMm: 210, heightMm: 148 }, pages: [{}, {}, {}] },
    compose: (index: number) => ({ svg: `<svg xmlns="http://www.w3.org/2000/svg" id="page-${index}"/>`, widthPt: 1, heightPt: 1 }),
  } as unknown as PreparedDiagramPages;
}

beforeEach(() => {
  vi.clearAllMocks();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
  useDiagramPrintUiStore.setState({ preparing: false });
});

const withSteps = () => useWorkspaceStore.getState().addDiagramStep();

describe('printDiagram', () => {
  it('hands the print dialog every page, as composed, at the paper’s size', async () => {
    withSteps();
    const print = vi.fn<DiagramPrintDependencies['print']>().mockResolvedValue(undefined);
    const prepare = vi.fn().mockResolvedValue(prepared());
    await expect(printDiagram({ prepare, print })).resolves.toBe(true);
    // The diagram as it is now.
    expect(prepare).toHaveBeenCalledWith(useWorkspaceStore.getState().diagram);
    const request = print.mock.calls[0]![0];
    expect(request).toMatchObject({ widthMm: 210, heightMm: 148 });
    expect(request.pages).toHaveLength(3);
    const svg = (url: string) => new TextDecoder().decode(Uint8Array.from(atob(url.split(',')[1]!), (c) => c.charCodeAt(0)));
    expect(request.pages.map(svg)).toEqual([0, 1, 2].map((index) => prepared().compose(index).svg));
  });

  it('says it is preparing while the pages are laid out, and prints once at a time', async () => {
    withSteps();
    let ready: (pages: PreparedDiagramPages) => void = () => undefined;
    const prepare = () => new Promise<PreparedDiagramPages>((resolve) => (ready = resolve));
    const print = vi.fn().mockResolvedValue(undefined);
    const first = printDiagram({ prepare, print });
    expect(useDiagramPrintUiStore.getState().preparing).toBe(true);
    await expect(printDiagram({ prepare, print })).resolves.toBe(false);
    ready(prepared());
    await expect(first).resolves.toBe(true);
    expect(print).toHaveBeenCalledOnce();
    expect(useDiagramPrintUiStore.getState().preparing).toBe(false);
  });

  it('prints nothing for a diagram with no steps', async () => {
    const prepare = vi.fn();
    await expect(printDiagram({ prepare, print: vi.fn() })).resolves.toBe(false);
    expect(prepare).not.toHaveBeenCalled();
  });

  it('reports a failure and says it, as the export does', async () => {
    withSteps();
    const print = vi.fn().mockRejectedValue(new Error('webview.print not allowed'));
    await expect(printDiagram({ prepare: () => Promise.resolve(prepared()), print })).resolves.toBe(false);
    expect(mocks.reportError).toHaveBeenCalledWith(expect.any(Error), { surface: 'diagram:print' });
    expect(mocks.toastError).toHaveBeenCalledWith('The diagram couldn’t be printed', {
      description: 'webview.print not allowed',
    });
    expect(useDiagramPrintUiStore.getState().preparing).toBe(false);
  });
});
