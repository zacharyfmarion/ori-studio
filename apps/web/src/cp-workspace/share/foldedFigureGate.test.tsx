import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import { segmentFoldDocument } from '../../lib/creasePatternSegmentation';
import { DEFAULT_CREASE_EXPORT_OPTIONS } from '../../lib/creaseExport';
import { CreaseExportDialog } from '../../components/CreaseExportDialog';
import { ShareLinkModal } from './ShareLinkModal';
import type { FoldDocument } from '../../engine/types';
import type { OristudioCpDocumentState } from '../../engine/oristudioCpTypes';

/**
 * The folded-figure option must be *unavailable*, not merely failing, on a pattern the
 * layer-order solver cannot represent.
 *
 * `isFlatFoldableFold` has its own unit tests. What those cannot show is that either dialog
 * actually consults it — the predicate could be perfect while a dialog ignores it and still
 * offers a toggle that ends in `WorkerOverlap(InitialHierarchy(SameParityAdjacentFaces))`,
 * a message about the solver's own data structures.
 */
function square(diagonalAngle: number): FoldDocument {
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
  } as FoldDocument;
}

/**
 * 180 is a full fold; 45 leaves faces out of plane, which the *flat* solver cannot order.
 *
 * `PARTIAL` is exactly the document `G` now folds in 3D, so these cases are also the
 * assertion that the gate did not quietly widen: the dialogs fold through the flat door on
 * their own ephemeral handle, and handing it a non-flat pattern is what
 * `isFlatFoldableFold` exists to prevent. What changed with the 3D fold is the *copy* —
 * a pattern with a 3D figure on the canvas beside it does have a folded form.
 */
const FLAT = square(-180);
const PARTIAL = square(-45);

function draftFor(fold: FoldDocument) {
  return {
    segmentId: 0,
    payload: 'T0NTMQEB',
    fold,
    segments: segmentFoldDocument(fold),
    url: null,
  };
}

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub);

describe('folded-figure gate on a pattern that cannot fold flat', () => {
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

  function toggleIn(container: ParentNode): HTMLInputElement | HTMLButtonElement | null {
    return container.querySelector('.share-link-modal__toggle-row input, .share-link-modal__toggle-row button');
  }

  it('share modal offers the toggle for a flat pattern', async () => {
    useWorkspaceStore.setState({ oristudioCpShareDraft: draftFor(FLAT) });
    await act(async () => root.render(<ShareLinkModal />));
    expect(toggleIn(document)).not.toBeNull();
    expect(toggleIn(document)?.hasAttribute('disabled')).toBe(false);
  });

  it('share modal disables it, and says why, for a partial fold', async () => {
    useWorkspaceStore.setState({ oristudioCpShareDraft: draftFor(PARTIAL) });
    await act(async () => root.render(<ShareLinkModal />));

    expect(toggleIn(document)?.hasAttribute('disabled')).toBe(true);
    // The reason has to be visible: a disabled control with no explanation is a dead end.
    // And it has to be a statement about the *preview*, not about the pattern: since `G`
    // folds a non-flat pattern in 3D, "it has no folded form" is now simply untrue, and a
    // user who is looking at one reads a contradiction.
    expect(document.body.textContent).toContain('folds flat only');
  });

  it('export dialog gates the same way, through the same predicate', async () => {
    const dialog = {
      id: 1,
      type: 'crease-export' as const,
      title: 'Export PNG',
      format: 'png' as const,
      fold: PARTIAL,
      segments: segmentFoldDocument(PARTIAL),
      initialOptions: { ...DEFAULT_CREASE_EXPORT_OPTIONS, segmentId: 0 },
      foldSegment: vi.fn(),
    };
    await act(async () => root.render(<CreaseExportDialog dialog={dialog} />));

    const toggles = Array.from(
      document.querySelectorAll<HTMLElement>('.export-modal__toggle-row')
    );
    const foldedRow = toggles.find((row) => row.textContent?.includes('folded figure'));
    expect(foldedRow).toBeDefined();
    expect(foldedRow?.querySelector('input,button')?.hasAttribute('disabled')).toBe(true);
    expect(foldedRow?.textContent).toContain('folds flat only');
  });
});
