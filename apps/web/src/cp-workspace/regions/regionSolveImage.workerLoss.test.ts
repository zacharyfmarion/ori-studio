// @vitest-environment jsdom
/**
 * A region solve measures its image in the detect worker. A worker lost under
 * that call used to leave the solve waiting for an answer that never comes; it
 * now solves without the image, as it does when the image is unavailable.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCpImage } from '../images/cpImage';
import { createCpSuppressionRegion } from '../annotations/suppressionRegion';

vi.mock('../../monitoring', () => ({ reportError: vi.fn() }));

class FakeWorker extends EventTarget {
  static instances: FakeWorker[] = [];
  constructor() {
    super();
    FakeWorker.instances.push(this);
  }
  terminate() {}
  postMessage() {}
}

const frame = { origin: { x: 0, y: 0 }, ux: [1, 0] as [number, number],
  uy: [0, 1] as [number, number], flip: 1, side: 400 };

beforeEach(() => {
  FakeWorker.instances = [];
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
    const { measureRegionSourceImage } = await import('./regionSolveImage');
    const image = createCpImage({ src: 'data:image/png;base64,AA==', naturalWidth: 1024,
      naturalHeight: 1024, center: { x: 200, y: 200 }, width: 400 * 1024 / 960,
      height: 400 * 1024 / 960 });
    const region = createCpSuppressionRegion({ center: { x: 200, y: 200 }, width: 410,
      height: 410, suppress: [], imageId: image.id });
    const input = { live: true };

    const measuring = measureRegionSourceImage(input, frame, region, [image]);
    await vi.waitFor(() => expect(FakeWorker.instances).toHaveLength(1));
    // The worker's `error` arrives as a task of its own, after the call has been posted.
    await new Promise((resolve) => setTimeout(resolve, 0));
    FakeWorker.instances[0].dispatchEvent(new Event('error'));

    await expect(measuring).resolves.toMatchObject({ input });
  });
});
