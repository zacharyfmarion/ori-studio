import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { FileService } from '../../platform/fileService';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { WorkspaceState } from '../../store/workspaceStore/types';
import { DIAGRAM_EXAMPLE_URL, openDiagramExample } from './diagramExample';

const analytics = vi.hoisted(() => ({ trackDiagramExampleOpened: vi.fn() }));
vi.mock('../../analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../analytics')>()),
  ...analytics,
}));

const routing = vi.hoisted(() => ({ showActiveWorkspace: vi.fn() }));
vi.mock('../../routing/workspaceUrlSync', () => routing);

/**
 * The empty Diagram's example: downloaded, then opened through `openProject`
 * as a dropped file is — never a loader of its own.
 */
const initialState = useWorkspaceStore.getInitialState();
const fetchMock = vi.fn<typeof fetch>();
let openProject: Mock<WorkspaceState['openProject']>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  fetchMock.mockImplementation(async () => new Response('{"format":"oristudio.project"}', { status: 200 }));
  openProject = vi.fn<WorkspaceState['openProject']>().mockResolvedValue(true);
  useWorkspaceStore.setState({ ...initialState, openProject }, true);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('openDiagramExample', () => {
  it('hands the downloaded file to openProject as a dropped file, landing on the Diagram', async () => {
    await expect(openDiagramExample()).resolves.toBe('opened');

    expect(fetchMock).toHaveBeenCalledWith(DIAGRAM_EXAMPLE_URL);
    expect(DIAGRAM_EXAMPLE_URL).toBe('/examples/Crane.osf');
    expect(openProject).toHaveBeenCalledOnce();
    const [fileService, options] = openProject.mock.calls[0] as [FileService, object];
    expect(options).toEqual({ landing: 'diagram', source: 'example' });
    // What `openProject` reads is the download, under the example's own name and no path:
    // Save asks where, as it does for a dropped file.
    await expect(fileService.openTextFile({ title: '', extensions: ['osf'] })).resolves.toEqual({
      text: '{"format":"oristudio.project"}',
      name: 'Crane.osf',
      path: null,
    });
    expect(routing.showActiveWorkspace).toHaveBeenCalledOnce();
    expect(analytics.trackDiagramExampleOpened).toHaveBeenCalledWith('opened');
  });

  it('says a declined unsaved-changes prompt was cancelled, and a refused file failed', async () => {
    openProject.mockResolvedValueOnce(false);
    await expect(openDiagramExample()).resolves.toBe('cancelled');

    openProject.mockImplementationOnce(async () => {
      useWorkspaceStore.setState({ error: { code: 'engine', message: 'unreadable' } });
      return false;
    });
    await expect(openDiagramExample()).resolves.toBe('failed');

    expect(routing.showActiveWorkspace).not.toHaveBeenCalled();
    expect(analytics.trackDiagramExampleOpened.mock.calls).toEqual([['cancelled'], ['failed']]);
  });

  it.each([
    ['offline', () => fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))],
    ['missing', () => fetchMock.mockImplementation(async () => new Response('', { status: 404 }))],
  ])('says so when the download fails (%s), and never asks about unsaved work', async (_, fail) => {
    fail();
    useWorkspaceStore.setState({ dirty: true });

    await expect(openDiagramExample()).resolves.toBe('unavailable');

    expect(openProject).not.toHaveBeenCalled();
    expect(useWorkspaceStore.getState().error).toEqual({
      code: 'invalid_operation',
      message: "Couldn't download the example crane. Check your connection and try again.",
    });
    expect(useWorkspaceStore.getState().dirty).toBe(true);
    expect(analytics.trackDiagramExampleOpened).toHaveBeenCalledWith('unavailable');
  });

  it('joins an open already under way rather than starting a second', async () => {
    const first = openDiagramExample();
    const second = openDiagramExample();

    expect(second).toBe(first);
    await first;
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(openProject).toHaveBeenCalledOnce();

    // And once it has settled, the next press opens again.
    await openDiagramExample();
    expect(openProject).toHaveBeenCalledTimes(2);
  });
});
