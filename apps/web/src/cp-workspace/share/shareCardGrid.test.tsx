import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import { ShareLinkModal } from './ShareLinkModal';
import type { FoldDocument } from '../../engine/types';
import type { CreaseExportGridSource } from '../../lib/creaseExport';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';

/**
 * The share card is the published artefact, so what the grid toggle changes has to
 * be the *preview* — not just an option the modal is holding. A toggle that flips
 * state without redrawing would look identical in every DOM assertion short of this.
 */
const FOLD: FoldDocument = {
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
  edges_foldAngle: [0, 0, 0, 0, -180],
  faces_vertices: [
    [0, 1, 2],
    [0, 2, 3],
  ],
};

const GRID: CreaseExportGridSource = {
  metadata: {
    interval_grid_size: 4,
    grid_size: 8,
    grid_xa: 1,
    grid_xb: 0,
    grid_xc: 1,
    grid_ya: 1,
    grid_yb: 0,
    grid_yc: 1,
    grid_angle: 90,
    base_state: 'WithinPaper',
    vertical_scale_position: 0,
    horizontal_scale_position: 0,
    draw_diagonal_gridlines: false,
  },
  transform: { scale: 1 / 400, offsetX: 0.5, offsetY: 0.5 },
};

function draftWith(grid: CreaseExportGridSource | null) {
  return {
    segmentId: 0,
    payload: 'T0NTMQEB',
    fold: FOLD,
    segments: segmentFoldDocument(FOLD),
    grid,
    url: null,
  };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

describe('grid lines on the share card', () => {
  let host: HTMLElement;
  let root: Root;

  beforeEach(() => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    useWorkspaceStore.setState({
      oristudioCpDocument: { document: {}, summary: null } as unknown as OristudioCpDocumentState,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    useWorkspaceStore.setState({ oristudioCpShareDraft: null, oristudioCpDocument: null });
  });

  function gridToggle(): HTMLButtonElement | null {
    return document.querySelector('[aria-label="Show grid lines"]');
  }

  function previewSrc(): string | null | undefined {
    return document.querySelector('.share-embed__image img')?.getAttribute('src');
  }

  it('redraws the card when the grid is turned on', async () => {
    useWorkspaceStore.setState({ oristudioCpShareDraft: draftWith(GRID) });
    await act(async () => root.render(<ShareLinkModal />));

    const toggle = gridToggle();
    expect(toggle?.hasAttribute('disabled')).toBe(false);

    const before = previewSrc();
    await act(async () => toggle?.click());
    expect(previewSrc()).not.toBe(before);
    expect(decodeURIComponent(previewSrc() ?? '')).toContain('clipPath');
  });

  it('disables it, and says why, with no crease pattern to take a grid from', async () => {
    useWorkspaceStore.setState({ oristudioCpShareDraft: draftWith(null) });
    await act(async () => root.render(<ShareLinkModal />));

    expect(gridToggle()?.hasAttribute('disabled')).toBe(true);
    expect(document.body.textContent).toContain('Open an editable crease pattern to draw its grid');
  });
});
