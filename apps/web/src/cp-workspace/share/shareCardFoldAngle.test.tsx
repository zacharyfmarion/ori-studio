import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import { CREASE_EXPORT_PALETTES } from '../../lib/creaseExport';
import {
  DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
  type OristudioCpFoldAngleDisplay,
} from '../../lib/creasePatternViewport';
import { ShareLinkModal } from './ShareLinkModal';
import type { FoldDocument } from '../../engine/types';

/**
 * A share card is the published artefact, and for a 3D design the fold angles are the
 * thing it is about. So these assert the *preview*: an option the modal is merely
 * holding would look identical in every DOM assertion short of this one.
 */
function fold(diagonalAngle: number): FoldDocument {
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
    edges_foldAngle: [0, 0, 0, 0, diagonalAngle],
    faces_vertices: [
      [0, 1, 2],
      [0, 2, 3],
    ],
  };
}

function draftFor(document: FoldDocument) {
  return {
    segmentId: 0,
    payload: 'T0NTMQEB',
    fold: document,
    segments: segmentFoldDocument(document),
    grid: null,
    url: null,
  };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

describe('fold angles on the share card', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useWorkspaceStore.setState({
      oristudioCpShareDraft: null,
      oristudioCpViewport: DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS,
    });
  });

  function control(): HTMLButtonElement | null {
    return document.querySelector('[aria-label="Fold angle style"]');
  }

  function preview(): string {
    return decodeURIComponent(
      document.querySelector('.share-embed__image img')?.getAttribute('src') ?? ''
    );
  }

  /**
   * Dismiss and re-open, rather than re-render.
   *
   * The mode is synced when the dialog *opens*, not initialized: the component stays
   * mounted between shares, so a `useState` initial value would freeze at whatever the
   * app started with. Re-rendering in place would never exercise that, and would let a
   * test pass over a mode that never actually changed.
   */
  async function open(document: FoldDocument, display: OristudioCpFoldAngleDisplay) {
    useWorkspaceStore.setState({ oristudioCpShareDraft: null });
    await act(async () => root.render(<ShareLinkModal />));
    useWorkspaceStore.setState({
      oristudioCpShareDraft: draftFor(document),
      oristudioCpViewport: { ...DEFAULT_ORISTUDIO_CP_VIEWPORT_OPTIONS, foldAngleDisplay: display },
    });
    await act(async () => root.render(<ShareLinkModal />));
  }

  it('offers the control only when the pattern has creases that are not full folds', async () => {
    await open(fold(-180), 'color');
    // The modal is deliberately spare; a flat pattern's share gains no decision.
    expect(control()).toBeNull();

    await open(fold(-90), 'color');
    expect(control()).not.toBeNull();
  });

  it('opens showing what the editor was showing', async () => {
    await open(fold(-90), 'opacity');

    // Seeded from the viewport, so the card matches the canvas the user is looking at
    // rather than asking a question they already answered in the View panel.
    expect(preview()).toContain('stroke-opacity');
    // Opacity leaves the ink alone: a 90-degree mountain is still mountain red.
    expect(preview()).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.mountain}"`);
  });

  it('spends hue instead, in the color mode', async () => {
    await open(fold(-90), 'color');

    expect(preview()).not.toContain('stroke-opacity');
    expect(preview()).not.toContain(`stroke="${CREASE_EXPORT_PALETTES.light.mountain}"`);
  });

  it('draws a classic pattern the same way whatever the mode', async () => {
    await open(fold(-180), 'color');
    const asColor = preview();
    await open(fold(-180), 'opacity');

    expect(preview()).toEqual(asColor);
    expect(asColor).toContain(`stroke="${CREASE_EXPORT_PALETTES.light.mountain}"`);
  });

  it('re-syncs to the editor on each open, rather than keeping the last choice', async () => {
    await open(fold(-90), 'color');
    expect(preview()).not.toContain('stroke-opacity');

    await open(fold(-90), 'opacity');
    expect(preview()).toContain('stroke-opacity');
  });
});
