import { afterEach, describe, expect, it, vi } from 'vitest';
import { createExploriDocument, type ExploriDocument } from '../../../explori/document';

/**
 * What a failed ExplOri search reports, and where.
 *
 * An `ExploriError` is the service saying what happened: the user reads it and
 * `explori search failed` counts it by its code, and it is not a defect.
 * Anything else is one, and goes to Sentry as `explori:query`.
 */

const spies = vi.hoisted(() => ({ track: vi.fn(), reportError: vi.fn() }));

vi.mock('../../../analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../analytics')>();
  return { ...actual, track: spies.track };
});

vi.mock('../../../monitoring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../monitoring')>();
  return { ...actual, reportError: spies.reportError };
});

// The slice reads the document through a design handle; with none registered it
// falls back to the design's own document, which is all these need.
vi.mock('../../../engines/designHandles', () => ({
  acquireDesignHandle: vi.fn(async () => 1),
  adoptDesignHandle: vi.fn(async () => true),
  withDesignHandle: vi.fn(),
  serializeDesign: vi.fn(async () => 'serialized'),
  parkDesign: vi.fn(async () => undefined),
  forgetDesign: vi.fn(async () => undefined),
  adoptDesign: vi.fn(),
  isDesignHot: vi.fn(() => false),
  hotDesignIds: vi.fn(() => []),
  subscribeToDesignHandles: vi.fn(() => () => undefined),
}));

const { useWorkspaceStore } = await import('../store');
const { patchExploriDesign, selectExploriDesign, singleDesignTab } = await import('../designTabs');

/** Four branches off a root: the smallest tree the service will search. */
function star(): ExploriDocument {
  return {
    ...createExploriDocument(),
    nodes: [
      { id: 0, loc: { x: 0, y: 0 }, name: '' },
      { id: 1, loc: { x: 0, y: 2 }, name: '' },
      { id: 2, loc: { x: 1.5, y: -1 }, name: '' },
      { id: 3, loc: { x: -1.5, y: -1 }, name: '' },
      { id: 4, loc: { x: 0, y: -2 }, name: '' },
    ],
    edges: [
      { id: 1, vertices: [0, 1], length: 2 },
      { id: 2, vertices: [0, 2], length: 1.8 },
      { id: 3, vertices: [0, 3], length: 1.8 },
      { id: 4, vertices: [0, 4], length: 2 },
    ],
    nextNodeId: 5,
    nextEdgeId: 5,
  };
}

function setUp() {
  const seeded = singleDesignTab('explori', 'Search');
  useWorkspaceStore.setState({ ...useWorkspaceStore.getInitialState(), ...seeded }, true);
  useWorkspaceStore.setState(
    patchExploriDesign(useWorkspaceStore.getState(), seeded.activeDesignId, { document: star() })
  );
}

function searchError(): string | null {
  const state = useWorkspaceStore.getState();
  return selectExploriDesign(state, state.activeDesignId)?.error ?? null;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  spies.track.mockClear();
  spies.reportError.mockClear();
  useWorkspaceStore.setState(useWorkspaceStore.getInitialState(), true);
});

describe('runExploriQuery', () => {
  it('reports nothing when the timeout cuts the download off, and calls it a timeout', async () => {
    // ORI-STUDIO-G: the answer arrived, and the clock ran out while its body
    // was still downloading. The browser fails that read with a bare
    // `AbortError`, which reached Sentry as a defect and the user as a search
    // that failed for no reason it could name.
    const clock = new AbortController();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValue(clock.signal);
    const response = new Response('{"query_id":"q","results":[]}');
    vi.spyOn(response, 'text').mockImplementation(async () => {
      clock.abort();
      throw new DOMException('The user aborted a request.', 'AbortError');
    });
    vi.stubGlobal('fetch', vi.fn(async () => response));
    setUp();

    await expect(useWorkspaceStore.getState().runExploriQuery()).resolves.toBe(false);

    expect(spies.reportError).not.toHaveBeenCalled();
    expect(searchError()).toBe('The search timed out.');
    expect(spies.track).toHaveBeenCalledWith('explori search failed', { reason: 'timeout' });
  });

  it('still reports a failure the service did not name', async () => {
    // The defect this report exists for: a WebKit without `AbortSignal.timeout`
    // failed every search with a TypeError, and nothing said so.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation(() => {
      throw new TypeError('AbortSignal.timeout is not a function');
    });
    setUp();

    await expect(useWorkspaceStore.getState().runExploriQuery()).resolves.toBe(false);

    expect(spies.reportError).toHaveBeenCalledOnce();
    expect(spies.reportError).toHaveBeenCalledWith(expect.any(TypeError), { surface: 'explori:query' });
    expect(spies.track).toHaveBeenCalledWith('explori search failed', { reason: 'unknown' });
  });
});
