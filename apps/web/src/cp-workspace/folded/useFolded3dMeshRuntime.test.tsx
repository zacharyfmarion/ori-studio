import { act } from 'react';
import { createRoot } from 'react-dom/client';
import type { Folded3dMeshRuntime } from './useFolded3dMeshRuntime';
import { beforeEach, expect, it, vi } from 'vitest';
import type { RenderSettings } from '@treemaker/origami-simulator';
import type { Folded3dMesh } from './folded3dMesh';
import { useFolded3dMeshRuntime } from './useFolded3dMeshRuntime';
const mock = vi.hoisted(() => ({
  token: 0,
  frames: [] as ((frame: { bitmap: ImageBitmap | null } | null) => void)[],
  failures: [] as ((error: Error) => void)[],
  client: {
    attachBitmapOutput: vi.fn(async () => {}),
    loadFolded3dMesh: vi.fn(async () => ({
      token: ++mock.token,
      shallowDepthBuffer: false,
    })),
    releaseFolded3dMesh: vi.fn(async () => {}),
    setFolded3dMeshRenderSettings: vi.fn(
      () =>
        new Promise<{ bitmap: ImageBitmap | null } | null>(
          (resolve, reject) => {
            mock.frames.push(resolve);
            mock.failures.push(reject);
          }
        )
    ),
    setFolded3dMeshCamera: vi.fn(
      () =>
        new Promise<{ bitmap: ImageBitmap | null } | null>(
          (resolve, reject) => {
            mock.frames.push(resolve);
            mock.failures.push(reject);
          }
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

beforeEach(() => {
  mock.frames.length = 0;
  mock.failures.length = 0;
  mock.token = 0;
  vi.clearAllMocks();
});

const camera = (yaw: number) => ({ yaw, pitch: 0, zoom: 1 });
const bitmap = () => ({ close: vi.fn() }) as unknown as ImageBitmap;
async function mount() {
  const present = vi.fn();
  let current: Folded3dMeshRuntime;
  const root = createRoot(document.createElement('div'));
  function Harness({ mesh }: { mesh: Folded3dMesh | null }) {
    current = useFolded3dMeshRuntime({ mesh, onFrame: present });
    return null;
  }
  const render = (mesh: Folded3dMesh | null) =>
    act(async () => root.render(<Harness mesh={mesh} />));
  await render({} as Folded3dMesh);
  return {
    present,
    get runtime() {
      return current!;
    },
    render,
    unmount: () => act(async () => root.unmount()),
  };
}

it('presents slow completed frames during input and sends only the newest waiting camera', async () => {
  const h = await mount();
  act(() => {
    for (let yaw = 0; yaw < 100; yaw++)
      h.runtime.setCamera(camera(yaw), 100 + yaw, 100);
  });
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenCalledTimes(1);
  const first = bitmap();
  await act(async () => mock.frames[0]!({ bitmap: first }));
  expect(h.present).toHaveBeenCalledExactlyOnceWith(first);
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenLastCalledWith(
    1,
    { view: camera(99), width: 199, height: 100 },
    undefined
  );
  act(() => {
    for (let yaw = 100; yaw < 200; yaw++)
      h.runtime.setCamera(camera(yaw), 300, 200);
  });
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenCalledTimes(2);
  await act(async () => mock.frames[1]!({ bitmap: bitmap() }));
  expect(h.present).toHaveBeenCalledTimes(2);
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenLastCalledWith(
    1,
    { view: camera(199), width: 300, height: 200 },
    undefined
  );
  await act(async () => mock.frames[2]!({ bitmap: bitmap() }));
  expect(h.present).toHaveBeenCalledTimes(3);
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenCalledTimes(3);
  await h.unmount();
});

it.each(['bitmap', 'eviction'] as const)(
  'ignores a late %s from a replaced mesh without releasing its new queue',
  async (reply) => {
    const h = await mount();
    act(() => h.runtime.setCamera(camera(0), 100, 100));
    await h.render({} as Folded3dMesh);
    act(() => h.runtime.setCamera(camera(1), 100, 100));
    const late = bitmap();
    await act(async () =>
      mock.frames[0]!(reply === 'bitmap' ? { bitmap: late } : null)
    );
    expect(late.close).toHaveBeenCalledTimes(reply === 'bitmap' ? 1 : 0);
    expect(h.present).not.toHaveBeenCalled();
    expect(mock.client.loadFolded3dMesh).toHaveBeenCalledTimes(2);
    expect(mock.client.setFolded3dMeshCamera).toHaveBeenCalledTimes(2);
    await act(async () => mock.frames[1]!({ bitmap: bitmap() }));
    expect(mock.client.setFolded3dMeshCamera).toHaveBeenLastCalledWith(
      2,
      { view: camera(1), width: 100, height: 100 },
      undefined
    );
    await h.unmount();
    const afterUnmount = bitmap();
    await act(async () => mock.frames[2]!({ bitmap: afterUnmount }));
    expect(afterUnmount.close).toHaveBeenCalledOnce();
  }
);

it('coalesces settings and camera together, including settings-only initialization', async () => {
  const h = await mount();
  const initial = { displacementScale: 0.5 } as RenderSettings;
  const latest = { displacementScale: 2 } as RenderSettings;
  act(() => {
    h.runtime.setRenderSettings(initial);
    h.runtime.setCamera(camera(1), 200, 300);
    h.runtime.setRenderSettings(latest);
  });
  expect(
    mock.client.setFolded3dMeshRenderSettings
  ).toHaveBeenCalledExactlyOnceWith(1, initial);
  expect(mock.client.setFolded3dMeshCamera).not.toHaveBeenCalled();
  await act(async () => mock.frames[0]!({ bitmap: null }));
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenCalledExactlyOnceWith(
    1,
    { view: camera(1), width: 200, height: 300 },
    latest
  );
  await act(async () => mock.frames[1]!({ bitmap: bitmap() }));
  act(() => h.runtime.setRenderSettings(initial));
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenLastCalledWith(
    1,
    { view: camera(1), width: 200, height: 300 },
    initial
  );
  await h.unmount();
});

it('recovers an evicted mesh with the latest camera and settings', async () => {
  const h = await mount();
  const settings = { displacementScale: 2 } as RenderSettings;
  act(() => {
    h.runtime.setCamera(camera(0), 100, 100);
    h.runtime.setCamera(camera(2), 200, 200);
    h.runtime.setRenderSettings(settings);
  });
  await act(async () => mock.frames[0]!(null));
  expect(mock.client.loadFolded3dMesh).toHaveBeenCalledTimes(2);
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenLastCalledWith(
    2,
    { view: camera(2), width: 200, height: 200 },
    settings
  );
  expect(h.runtime.status).toBe('ready');
  await h.unmount();
});

it('releases the queue on failure and still sends the trailing view', async () => {
  const h = await mount();
  act(() => {
    h.runtime.setCamera(camera(0), 100, 100);
    h.runtime.setCamera(camera(1), 100, 100);
  });
  await act(async () => mock.failures[0]!(new Error('snapshot failed')));
  expect(mock.client.setFolded3dMeshCamera).toHaveBeenCalledTimes(2);
  await act(async () => mock.frames[1]!({ bitmap: bitmap() }));
  expect(h.present).toHaveBeenCalledOnce();
  await h.unmount();
});
