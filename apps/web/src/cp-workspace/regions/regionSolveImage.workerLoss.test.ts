// @vitest-environment jsdom
/**
 * A region solve measures its image in the detect worker. A worker lost under
 * that call used to leave the solve waiting for an answer that never comes; it
 * now solves without the image, as it does when the image is unavailable.
 *
 * Through the real detect runtime and comlink, with only `Worker` faked. A
 * detector that did not load (its worker never ran, or its wasm download was
 * cut off) is the connection, not a defect: counted, never reported, and never
 * the app's error toast, since the solve goes on without the image either way.
 * A worker that crashed is still reported.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCpImage } from '../images/cpImage';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';

const reportError = vi.fn();
const track = vi.fn();
vi.mock('../../monitoring', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));
vi.mock('../../analytics', () => ({ track: (...args: unknown[]) => track(...args) }));

interface ComlinkCall {
  id: string;
  type: string;
  path?: string[];
}

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  /** What the worker throws for a call, as comlink hands a thrown Error back; null never answers. */
  static throws: { name: string; message: string } | null = null;
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  terminate() {}
  postMessage(message: ComlinkCall) {
    const thrown = FakeWorker.throws;
    if (!thrown || message.type !== 'APPLY') return;
    setTimeout(() => {
      this.dispatchEvent(
        new MessageEvent('message', {
          data: {
            id: message.id,
            type: 'HANDLER',
            name: 'throw',
            value: { isError: true, value: { ...thrown, stack: '' } },
          },
        })
      );
    }, 0);
  }
}

const frame = { origin: { x: 0, y: 0 }, ux: [1, 0] as [number, number],
  uy: [0, 1] as [number, number], flip: 1, side: 400 };

async function load() {
  vi.resetModules();
  const diagnostics = await import('../../lib/workerDiagnostics');
  // Stands in for the app's error toast, which App.tsx registers.
  const toast = vi.fn();
  diagnostics.registerWorkerFailureSink(toast);
  const { measureRegionSourceImage } = await import('./regionSolveImage');
  const image = createCpImage({ src: 'data:image/png;base64,AA==', naturalWidth: 1024,
    naturalHeight: 1024, center: { x: 200, y: 200 }, width: 400 * 1024 / 960,
    height: 400 * 1024 / 960 });
  const region = createCpSuppressionRegion({ center: { x: 200, y: 200 }, width: 410,
    height: 410, suppress: [], imageId: image.id });
  const input = { live: true };
  return { toast, input, measure: () => measureRegionSourceImage(input, frame, region, [image]) };
}

/** The worker's `error` arrives as a task of its own, after the call has been posted. */
const nextTask = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeWorker.instances = [];
  FakeWorker.throws = null;
  reportError.mockClear();
  track.mockClear();
  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);
  vi.stubGlobal('fetch', async () => ({ blob: async () => new Blob() }));
  vi.stubGlobal('createImageBitmap', async () => ({ width: 2, height: 2, close() {} }));
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage() {},
    getImageData: () => ({ width: 2, height: 2, data: new Uint8ClampedArray(16) }),
  } as unknown as CanvasRenderingContext2D);
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('measureRegionSourceImage', () => {
  it('solves without the image when the detect worker is lost under it', async () => {
    const { input, measure } = await load();
    const measuring = measure();
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    await nextTask();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    await expect(measuring).resolves.toMatchObject({ input });
  });

  it('counts a worker that never loaded, without a report or the app’s toast', async () => {
    const { toast, measure } = await load();
    const measuring = measure();
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    await nextTask();
    FakeWorker.instances[0].dispatchEvent(new Event('error'));
    await measuring;

    expect(reportError).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('cp detect load failed', { surface: 'region_solve', offline: 'no' });
  });

  it('counts a wasm download cut off in the worker, without a report', async () => {
    FakeWorker.throws = {
      name: 'TypeError',
      message: 'WebAssembly compilation aborted: Network error: Response body loading was aborted',
    };
    const { input, measure } = await load();

    await expect(measure()).resolves.toMatchObject({ input });
    expect(reportError).not.toHaveBeenCalled();
    expect(track).toHaveBeenCalledWith('cp detect load failed', { surface: 'region_solve', offline: 'no' });
  });

  it('still reports a worker that crashed under it, and a measurement that failed', async () => {
    const { measure } = await load();
    const crashed = measure();
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    await nextTask();
    FakeWorker.instances[0].dispatchEvent(new ErrorEvent('error', { message: 'Uncaught RuntimeError: unreachable' }));
    await crashed;
    expect(reportError).toHaveBeenLastCalledWith(
      { code: 'cp_detect_client_lost', message: 'Uncaught RuntimeError: unreachable' },
      { surface: 'cp_region_source_image' }
    );

    FakeWorker.throws = { name: 'RuntimeError', message: 'unreachable' };
    await measure();
    expect(reportError).toHaveBeenCalledTimes(2);
    expect(track).not.toHaveBeenCalled();
  });

  it('reports an image that could not be read, whatever its words', async () => {
    // The image is a data URL, so its fetch failing is not the connection.
    vi.stubGlobal('fetch', async () => Promise.reject(new TypeError('Failed to fetch')));
    const { measure } = await load();
    await measure();

    expect(reportError).toHaveBeenCalledWith(new TypeError('Failed to fetch'), { surface: 'cp_region_source_image' });
    expect(track).not.toHaveBeenCalled();
  });
});
