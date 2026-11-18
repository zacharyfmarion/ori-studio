import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  captureSpatialScene,
  type SpatialCaptureRequest,
} from './spatialCapture';
import type { Folded3dMesh } from '../cp-workspace/folded/folded3dMesh';
import type { CameraUniforms, PaperScene } from '@treemaker/origami-simulator';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';

class WorkerMock {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  onerror: (() => void) | null = null;
  request?: SpatialCaptureRequest;
  terminated = false;
  postMessage(request: SpatialCaptureRequest) {
    this.request = request;
  }
  terminate() {
    this.terminated = true;
  }
  reply(data: unknown) {
    this.onmessage?.({ data });
  }
}
const workers: WorkerMock[] = [];
function install() {
  workers.length = 0;
  vi.stubGlobal(
    'Worker',
    class extends WorkerMock {
      constructor() {
        super();
        workers.push(this);
      }
    }
  );
}
const mesh = {} as Folded3dMesh,
  camera = {} as CameraUniforms,
  scene = {
    sheet: 1,
    bounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    items: [],
  } as PaperScene;
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('settled spatial capture', () => {
  it('retries vector complexity through the ordered GPU raster worker', async () => {
    install();
    const promise = captureSpatialScene(mesh, camera, DEFAULT_PAPER_STYLE);
    expect(workers[0]!.request?.raster).toBe(false);
    workers[0]!.reply({ kind: 'budget' });
    await Promise.resolve();
    await Promise.resolve();
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.request?.raster).toBe(true);
    workers[1]!.reply({ kind: 'scene', scene });
    expect(await promise).toEqual(scene);
    expect(workers[1]!.terminated).toBe(true);
  });
  it('terminates cancelled capture and ignores a late picture', async () => {
    install();
    const signal = new AbortController();
    const promise = captureSpatialScene(
      mesh,
      camera,
      DEFAULT_PAPER_STYLE,
      signal.signal
    );
    signal.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    expect(workers[0]!.terminated).toBe(true);
    workers[0]!.reply({ kind: 'scene', scene });
    expect(workers).toHaveLength(1);
  });
  it('falls back after a vector timeout and fails explicitly if raster also times out', async () => {
    install();
    vi.useFakeTimers();
    const promise = captureSpatialScene(mesh, camera, DEFAULT_PAPER_STYLE);
    const rejected = expect(promise).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(12_000);
    expect(workers[1]!.request?.raster).toBe(true);
    await vi.advanceTimersByTimeAsync(12_000);
    await rejected;
    expect(workers.every((w) => w.terminated)).toBe(true);
  });
});
