import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../store';
import type { OristudioCpDocumentState } from '../../../engine/oristudioCpTypes';

/**
 * What `ensureEditCreasePattern` does when a document is *already* open.
 *
 * This used to return early unconditionally, on the reasoning that a share link is always a
 * full page load. `/s/:shareId` is a real route now, so anything navigating to it client-side
 * hit that return and the link did nothing at all — no error, no document, no clue.
 *
 * `requestConfirmation` resolves false with no dialog host mounted, which is exactly the
 * declined branch, so the regression is testable without a wasm harness.
 */
const OPEN_DOCUMENT = { document: {}, summary: null } as unknown as OristudioCpDocumentState;

describe('ensureEditCreasePattern with a document already open', () => {
  let initial: ReturnType<typeof useWorkspaceStore.getState>;

  beforeEach(() => {
    initial = useWorkspaceStore.getState();
  });

  afterEach(() => {
    useWorkspaceStore.setState({
      oristudioCpDocument: initial.oristudioCpDocument,
      pendingSharedCp: null,
      dirty: false,
    });
  });

  it('leaves an open document alone when no share is pending', async () => {
    useWorkspaceStore.setState({ oristudioCpDocument: OPEN_DOCUMENT, pendingSharedCp: null });
    await useWorkspaceStore.getState().ensureEditCreasePattern();
    expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(OPEN_DOCUMENT);
  });

  it('clears the pending share when the discard prompt is declined', async () => {
    // The regression: before this branch existed the share stayed pending forever and the
    // link produced nothing. Declining must be a decision, not a silent drop-through.
    useWorkspaceStore.setState({
      oristudioCpDocument: OPEN_DOCUMENT,
      pendingSharedCp: { kind: 'payload', payload: 'T0NTMQEB' },
      dirty: true,
    });

    await useWorkspaceStore.getState().ensureEditCreasePattern();

    expect(useWorkspaceStore.getState().pendingSharedCp).toBeNull();
    expect(useWorkspaceStore.getState().oristudioCpDocument).toBe(OPEN_DOCUMENT);
  });
});
