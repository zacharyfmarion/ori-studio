import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The runtime module must bind its slot *before* it awaits.
 *
 * `activeSlot` is module-level, so a function that re-reads it after an await
 * acts on whichever slot is in the foreground when the promise resolves rather
 * than the one the work was started for. `replaceHandle` both frees the old
 * handle and installs the new one, so getting this wrong frees the user's
 * document and hands its slot the tutorial's practice pattern — reachable by
 * navigating `/edit → /learn → /edit` faster than a target file parses, because
 * `enterCpDocumentSlot` runs synchronously from a route effect.
 *
 * The store-side `cpSlotGeneration` guard cannot cover this: it gates writes
 * *into the store*, which happen only after this module has already acted.
 *
 * The kernel client is faked (via the desktop path, so no Worker is needed) and
 * its load is held open, which is what makes the interleaving deterministic.
 */

const freed: number[] = [];
let nextHandle = 100;
let releaseLoad: (() => void) | null = null;

vi.mock('../../platform/runtime', () => ({
  isDesktopRuntime: () => true,
  getRuntimeSurface: () => 'desktop',
}));

vi.mock('../../engine/oristudioCpNativeClient', () => ({
  createOristudioCpNativeClient: () => ({
    loadCp: async () => {
      await new Promise<void>((resolve) => {
        releaseLoad = resolve;
      });
      return (nextHandle += 1);
    },
    documentGeometry: async () => ({}),
    summary: async () => ({}),
    operationDescriptors: async () => [],
    freeDocument: async (handle: number) => {
      freed.push(handle);
    },
  }),
}));

vi.mock('../../engine/oristudioCpGeometry', () => ({
  decodeCpGeometryToSnapshot: () => ({ title: 'x' }),
}));

/**
 * Start a load and wait until it is parked inside the fake client.
 *
 * The pending promise is returned wrapped: an `async` function *adopts* a
 * promise it returns, so handing it back bare would make this helper wait for
 * the very load it is deliberately holding open.
 */
async function startPendingLoad(
  runtime: typeof import('./oristudioCpRuntime'),
  filename: string
): Promise<{ pending: Promise<unknown> }> {
  releaseLoad = null;
  const pending = runtime.loadOristudioCpDocumentFromText('1 0 0 1 1', {
    format: 'cp',
    filename,
  });
  await vi.waitFor(() => expect(releaseLoad).toBeTruthy());
  return { pending };
}

describe('slot binding across awaits', () => {
  beforeEach(() => {
    freed.length = 0;
    releaseLoad = null;
  });

  it('lands a load in the slot it was started for, not the foreground one', async () => {
    const runtime = await import('./oristudioCpRuntime');

    // The edit slot holds the user's document.
    runtime.switchCpDocumentSlot('edit');
    const { pending: editLoad } = await startPendingLoad(runtime, 'user.cp');
    releaseLoad?.();
    await editLoad;
    const editHandle = runtime.cpDocumentSlotHandle('edit');
    expect(editHandle).not.toBeNull();

    // A practice load starts on the learn slot...
    runtime.switchCpDocumentSlot('learn');
    const { pending: practiceLoad } = await startPendingLoad(runtime, 'practice.cp');

    // ...and the user navigates back to /edit before it resolves.
    runtime.switchCpDocumentSlot('edit');
    releaseLoad?.();
    await practiceLoad;

    expect(freed, "freed the edit slot's handle").not.toContain(editHandle);
    expect(runtime.cpDocumentSlotHandle('edit'), 'edit slot was taken over').toBe(editHandle);
    expect(runtime.cpDocumentSlotHandle('learn'), 'practice document went missing').not.toBeNull();
    expect(runtime.cpDocumentSlotHandle('learn')).not.toBe(editHandle);
  });
});
