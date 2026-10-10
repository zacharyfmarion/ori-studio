import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { useSettingsStore } from '../../store/settingsStore';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import { IDENTITY_CP_MODEL_TO_FOLD, type CreaseExportFoldResult } from '../../lib/creaseExportFold';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { builtInPaperPreset } from '../../lib/paper/paperPresets';
import { ShareLinkModal } from './ShareLinkModal';
import type { FoldDocument } from '../../engine/types';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);
// Radix Select scrolls the selected option into view as it opens.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

function square(): FoldDocument {
  return {
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
    edges_assignment: ['B', 'B', 'B', 'B', 'M'],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

function draftFor(fold: FoldDocument) {
  return {
    segmentId: 0,
    payload: 'T0NTMQEB',
    fold,
    segments: segmentFoldDocument(fold),
    grid: null,
    url: null,
  };
}

/** One front-up face, so the card paints the figure's Front colour through the shared painter. */
function foldResult(): CreaseExportFoldResult {
  const outline = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
  ];
  return {
    snapshot: { schema_version: 1, fixture: null, pass: null, primitives: [] },
    scene: {
      schema_version: 2,
      sheet_points: [],
      flipped: false,
      sheet: 1,
      faces: [
        {
          outline,
          points: [0, 1, 2],
          front_up: true,
          edges: outline.map((from, index) => ({
            from,
            to: outline[(index + 1) % outline.length]!,
            kind: 'border' as const,
          })),
        },
      ],
      subfaces: [{ polygon: outline, faces_top_to_bottom: [0] }],
      aux_lines: [],
    },
    discoveredCases: 1,
    transform: IDENTITY_CP_MODEL_TO_FOLD,
  };
}

const store = useWorkspaceStore.getState();
const original = {
  publishOristudioCpShare: store.publishOristudioCpShare,
  foldOristudioCpShareFigure: store.foldOristudioCpShareFigure,
};

describe('the share card’s folded figure style', () => {
  const diagram = builtInPaperPreset('diagram').style;
  const publish = vi.fn<typeof store.publishOristudioCpShare>(async () => true);
  let host: HTMLElement;
  let root: Root;

  const styleTrigger = () => document.querySelector<HTMLButtonElement>('button[aria-label="Style"]');
  const colourField = (label: 'Front color' | 'Back color') =>
    document.querySelector<HTMLInputElement>(`input[type="color"][aria-label="${label}"]`);
  const preview = () =>
    decodeURIComponent(
      document.querySelector('.share-embed__image img')?.getAttribute('src') ?? ''
    );
  const button = (name: string) =>
    Array.from(document.querySelectorAll<HTMLButtonElement>('button')).find(
      (element) => element.textContent?.trim() === name
    );

  beforeEach(() => {
    publish.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    useWorkspaceStore.setState({
      oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
      publishOristudioCpShare: publish,
      foldOristudioCpShareFigure: vi.fn(async () => foldResult()),
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useWorkspaceStore.setState({
      ...original,
      oristudioCpShareDraft: null,
      oristudioCpDocument: null,
    });
    useSettingsStore.setState(useSettingsStore.getInitialState(), true);
  });

  /** Opens the card the way the app does: mounted first, then handed a draft. */
  async function open() {
    await act(async () => root.render(<ShareLinkModal />));
    useWorkspaceStore.setState({ oristudioCpShareDraft: draftFor(square()) });
    await act(async () => root.render(<ShareLinkModal />));
  }

  async function showFolded() {
    await act(async () => {
      document.querySelector<HTMLButtonElement>('[aria-label="Show folded figure"]')?.click();
    });
  }

  async function pickStyle(name: string) {
    // Enter opens the Select without a pointer, which jsdom cannot aim.
    await act(async () => {
      styleTrigger()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    const option = Array.from(document.querySelectorAll<HTMLElement>('[role="option"]')).find(
      (element) => element.textContent?.trim() === name
    );
    expect(option).toBeDefined();
    await act(async () => {
      option?.click();
    });
  }

  async function createLink() {
    await act(async () => {
      button('Create link')?.click();
    });
  }

  it('opens on the remembered style, with its paper colours', async () => {
    useSettingsStore.setState({ creasePatternFoldedFigureStyle: 'builtin:diagram' });
    await open();
    await showFolded();

    expect(styleTrigger()?.textContent).toBe('Diagram');
    expect(colourField('Front color')?.value).toBe(diagram.paper.front);
    expect(colourField('Back color')?.value).toBe(diagram.paper.back);
  });

  it('re-seeds Front and Back from a picked style, and paints them on the card', async () => {
    useSettingsStore.setState({ creasePatternFoldedFigureStyle: 'builtin:diagram' });
    await open();
    await showFolded();
    expect(preview()).not.toContain(`fill="${DEFAULT_PAPER_STYLE.paper.front}"`);

    await pickStyle('Default');

    expect(styleTrigger()?.textContent).toBe('Default');
    expect(colourField('Front color')?.value).toBe(DEFAULT_PAPER_STYLE.paper.front);
    expect(colourField('Back color')?.value).toBe(DEFAULT_PAPER_STYLE.paper.back);
    expect(preview()).toContain(`fill="${DEFAULT_PAPER_STYLE.paper.front}"`);
  });

  it('publishes the picked style when the card carries the figure', async () => {
    await open();
    await showFolded();
    await pickStyle('Diagram');
    await createLink();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ foldedFigureStyle: 'builtin:diagram' });
  });

  it('paints the card’s figure in the picked style, not only its paper', async () => {
    await open();
    await showFolded();
    expect(preview()).not.toContain(`stroke="${diagram.edges.color}"`);

    await pickStyle('Diagram');

    expect(preview()).toContain(`stroke="${diagram.edges.color}"`);
  });

  it('opens on the export style when the remembered preset is gone', async () => {
    useSettingsStore.setState({ creasePatternFoldedFigureStyle: 'user:Deleted since' });
    await open();
    await showFolded();
    await createLink();

    expect(styleTrigger()?.textContent).toBe('Export style · Default, from display');
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ foldedFigureStyle: 'export-style' });
  });

  it('reads the remembered style when it opens, not when it mounted', async () => {
    // The card stays mounted between shares: a style remembered since opens it.
    await act(async () => root.render(<ShareLinkModal />));
    useSettingsStore.setState({ creasePatternFoldedFigureStyle: 'builtin:diagram' });
    useWorkspaceStore.setState({ oristudioCpShareDraft: draftFor(square()) });
    await act(async () => root.render(<ShareLinkModal />));
    await showFolded();

    expect(styleTrigger()?.textContent).toBe('Diagram');
    expect(colourField('Front color')?.value).toBe(diagram.paper.front);
  });

  it('leaves Escape to the open style picker, and keys aimed inside it to the card', async () => {
    await open();
    await showFolded();
    expect(styleTrigger()!.closest('[role="dialog"]')?.hasAttribute('data-shortcut-barrier')).toBe(true);
    await act(async () => {
      styleTrigger()?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })
      );
    });
    const option = document.querySelector<HTMLElement>('[role="option"]')!;
    await act(async () => {
      option.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    expect(document.querySelector('[role="option"]')).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpShareDraft).not.toBeNull();
  });

  it('publishes no style when the card shows no figure', async () => {
    useSettingsStore.setState({ creasePatternFoldedFigureStyle: 'builtin:diagram' });
    await open();
    await createLink();

    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish.mock.calls[0]?.[0]).toMatchObject({ foldedFigureStyle: null });
  });
});
