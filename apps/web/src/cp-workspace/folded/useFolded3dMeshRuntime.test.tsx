import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Folded3dMeshRuntime } from './useFolded3dMeshRuntime';
import { expect, it, vi } from 'vitest';
import type { Folded3dMesh } from './folded3dMesh';
import { useFolded3dMeshRuntime } from './useFolded3dMeshRuntime';
const mock = vi.hoisted(() => ({
  token: 0,
  frames: [] as ((frame: { bitmap: ImageBitmap } | null) => void)[],
  client: {
    attachBitmapOutput: vi.fn(async () => {}),
    loadFolded3dMesh: vi.fn(async () => ({
      token: ++mock.token,
      shallowDepthBuffer: false,
    })),
    releaseFolded3dMesh: vi.fn(async () => {}),
    setFolded3dMeshCamera: vi.fn(
      () =>
        new Promise<{ bitmap: ImageBitmap } | null>((resolve) =>
          mock.frames.push(resolve)
        )
    ),
  },
}));
vi.mock('../../store/workspaceStore/simulatorRuntime', () => ({
  retainSimulatorClient: () => mock.client,
  releaseSimulatorClient: () => {},
}));
vi.mock('../../simulator/useSimulatorPerfLog', () => ({
  useSimulatorPerfLog: () => {},
}));
vi.mock('./folded3dWindow', () => ({
  folded3dMeshPayload: () => ({ payload: {}, transferables: [] }),
}));

it('closes a late bitmap and ignores an old eviction after the mesh has changed', async () => {
  const present = vi.fn();
  const first = {} as Folded3dMesh;
  let current: Folded3dMeshRuntime;
  const container = document.createElement('div'),
    root = createRoot(container);
  function Harness({ mesh }: { mesh: Folded3dMesh }) {
    current = useFolded3dMeshRuntime({ mesh, onFrame: present });
    return null;
  }
  await act(async () => root.render(<Harness mesh={first} />));
  expect(current!.status).toBe('ready');
  act(() => current!.setCamera({ yaw: 0, pitch: 0, zoom: 1 }, 100, 100));
  act(() => current!.setCamera({ yaw: 1, pitch: 0, zoom: 1 }, 100, 100));
  const old = mock.frames.splice(0);
  await act(async () => root.render(<Harness mesh={{} as Folded3dMesh} />));
  expect(mock.client.loadFolded3dMesh).toHaveBeenCalledTimes(2);
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => {
    old[0]!({ bitmap });
    old[1]!(null);
  });
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(present).not.toHaveBeenCalled();
  expect(mock.client.loadFolded3dMesh).toHaveBeenCalledTimes(2);
  await act(async () => root.unmount());
});

it('keeps the newest camera frame when bitmap replies complete out of order', async () => {
  mock.frames.length = 0;
  vi.clearAllMocks();
  const present = vi.fn();
  let current: Folded3dMeshRuntime;
  const root = createRoot(document.createElement('div'));
  const mesh = {} as Folded3dMesh;
  function Harness() {
    current = useFolded3dMeshRuntime({ mesh, onFrame: present });
    return null;
  }
  await act(async () => root.render(<Harness />));
  act(() => current!.setCamera({ yaw: 0, pitch: 0, zoom: 1 }, 100, 100));
  act(() => current!.setCamera({ yaw: 1, pitch: 0, zoom: 1 }, 100, 100));
  const old = { close: vi.fn() } as unknown as ImageBitmap,
    newest = { close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => {
    mock.frames[1]!({ bitmap: newest });
    mock.frames[0]!({ bitmap: old });
  });
  expect(present).toHaveBeenCalledExactlyOnceWith(newest);
  expect(old.close).toHaveBeenCalledOnce();
  await act(async () => root.unmount());
});
