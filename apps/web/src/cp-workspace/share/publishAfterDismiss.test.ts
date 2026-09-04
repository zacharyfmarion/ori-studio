import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore/store';
import type { FoldDocument } from '../../engine/types';

/**
 * Closing the share dialog while its link is still being created must not bring it back.
 *
 * `publishOristudioCpShare` writes the returned URL onto the draft, and the write lands
 * one round trip after the read. It used to re-read the store and spread whatever it found
 * — so a dismiss that landed in that window produced `{...null, url}`, an object with a URL
 * and nothing else. That is truthy, and `open` is `draft !== null`, so the dialog reopened
 * holding a draft with no `fold` and no `segments`, and threw on the first
 * `draft.segments.find` (Sentry ORI-STUDIO-9).
 *
 * The share is created either way — this is only about what the store is left holding.
 */
const FOLD = {
  vertices_coords: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  edges_vertices: [
    [0, 1],
    [1, 2],
    [2, 0],
  ],
  edges_assignment: ['B', 'B', 'B'],
  edges_foldAngle: [0, 0, 0],
  faces_vertices: [[0, 1, 2]],
} as unknown as FoldDocument;

function draft() {
  return { segmentId: 0, payload: 'T0NTMQEB', fold: FOLD, segments: [], grid: null, url: null };
}

afterEach(() => {
  vi.restoreAllMocks();
  useWorkspaceStore.setState({ oristudioCpShareDraft: null });
});

describe('publishing a share that is dismissed mid-flight', () => {
  it('leaves the draft cleared rather than resurrecting a partial one', async () => {
    let release: (response: Response) => void = () => {};
    vi.spyOn(globalThis, 'fetch').mockReturnValue(
      new Promise<Response>((resolve) => {
        release = resolve;
      })
    );

    const store = useWorkspaceStore.getState();
    useWorkspaceStore.setState({ oristudioCpShareDraft: draft() });

    const publishing = store.publishOristudioCpShare({
      title: 'Bird base',
      author: '',
      renderCard: async () => null,
    });

    // The user closes the dialog while the request is still open.
    store.dismissOristudioCpShare();
    expect(useWorkspaceStore.getState().oristudioCpShareDraft).toBeNull();

    release(
      new Response(
        JSON.stringify({ id: 'a3bK9xmQ', url: 'https://ori.studio/s/a3bK9xmQ', thumbnailUploadToken: 'tok' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    await expect(publishing).resolves.toBe(true);

    expect(useWorkspaceStore.getState().oristudioCpShareDraft).toBeNull();
  });

  it('still records the URL on a draft that is left open', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ id: 'a3bK9xmQ', url: 'https://ori.studio/s/a3bK9xmQ', thumbnailUploadToken: 'tok' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );

    useWorkspaceStore.setState({ oristudioCpShareDraft: draft() });
    await useWorkspaceStore.getState().publishOristudioCpShare({
      title: 'Bird base',
      author: '',
      renderCard: async () => null,
    });

    const after = useWorkspaceStore.getState().oristudioCpShareDraft;
    expect(after?.url).toBe('https://ori.studio/s/a3bK9xmQ');
    expect(after?.segmentId).toBe(0);
    expect(after?.fold).toBe(FOLD);
  });
});
