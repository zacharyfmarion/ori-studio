import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDiagram, setPageSetup, type DiagramDocument } from '../document/diagramDocument';
import type { PreparedDiagramPages } from './diagramPages';
import { useDiagramPages, type DiagramPagesState } from './useDiagramPages';

const prepare = vi.hoisted(() => vi.fn());
vi.mock('./diagramPages', () => ({ prepareDiagramPages: prepare }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let seen: DiagramPagesState | null = null;

function Pages({ document }: { document: DiagramDocument }) {
  const state = useDiagramPages(document);
  useEffect(() => {
    seen = state;
  });
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  prepare.mockReset();
  prepare.mockImplementation(async (document: DiagramDocument) => ({ of: document }) as unknown as PreparedDiagramPages);
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
});
