import { describe, expect, it, vi } from 'vitest';
import { PicturePreviewCache, picturePreviewSize, picturePreviewCache } from './picturePreviewCache';

const size = { width: 100, height: 100 };
const bitmap = () => document.createElement('canvas');

describe('page preview resolution', () => {
  it('uses screen density buckets, including Retina, and bounds high zoom and oversized paper', () => {
    expect(picturePreviewSize(800, 1100, 0.6, 2)).toEqual({ width: 1600, height: 2200 });
    expect(picturePreviewSize(800, 1100, 0.9, 2)).toEqual({ width: 1600, height: 2200 });
    for (const [width, height] of [[800, 1100], [20000, 10000], [10, 20000]]) {
      const result = picturePreviewSize(width!, height!, 8, 3);
      expect(result.width * result.height).toBeLessThanOrEqual(8 * 1024 * 1024);
      expect(Math.max(result.width, result.height)).toBeLessThanOrEqual(4096);
      expect(Math.min(result.width, result.height)).toBeGreaterThan(0);
    }
  });
});

describe('page preview cache', () => {
  it('shares in-flight work and reuses higher resolution previews after zooming out', async () => {
    const rasterize = vi.fn(async () => bitmap());
    const cache = new PicturePreviewCache(rasterize);
    const first = cache.get('page', size);
    expect(cache.get('page', size)).toBe(first);
    expect(cache.get('page', { width: 50, height: 50 })).toBe(first);
    await first;
    const larger = cache.get('page', { width: 200, height: 200 });
    expect(larger).not.toBe(first);
    expect(cache.get('page', size)).toBe(larger);
    expect(rasterize).toHaveBeenCalledTimes(2);
  });

  it('keys by the complete composed image, so style, paper, marks and omissions cannot reuse stale pixels', () => {
    const rasterize = vi.fn(async () => bitmap());
    const cache = new PicturePreviewCache(rasterize);
    for (const src of ['original', 'paper-size', 'paper-pen', 'paper-fill', 'annotation', 'drag-omission']) {
      cache.get(src, size);
    }
    expect(rasterize).toHaveBeenCalledTimes(6);
  });

  it('evicts least recently used previews by pixel AND source bytes', () => {
    const rasterize = vi.fn(async () => bitmap());
    const cache = new PicturePreviewCache(rasterize, 80004); // two 100×100 RGBA previews plus two one-letter sources
    const a = cache.get('a', size);
    const b = cache.get('b', size);
    expect(cache.get('a', size)).toBe(a);
    cache.get('c', size);
    expect(cache.get('a', size)).toBe(a);
    expect(cache.get('b', size)).not.toBe(b);
    // Pixels alone would fit, but this source crosses the budget.
    const huge = 'x'.repeat(30000);
    expect(cache.get(huge, size)).not.toBe(cache.get(huge, size));
  });

  it('retries failures without discarding a newer resolution which finishes first', async () => {
    let fail!: (error: Error) => void;
    const rasterize = vi.fn()
      .mockImplementationOnce(() => new Promise<HTMLCanvasElement>((_resolve, reject) => { fail = reject; }))
      .mockImplementation(async () => bitmap());
    const cache = new PicturePreviewCache(rasterize);
    const low = cache.get('page', size);
    const high = cache.get('page', { width: 200, height: 200 });
    await high;
    fail(new Error('cancelled'));
    await expect(low).rejects.toThrow('cancelled');
    expect(cache.get('page', size)).toBe(high);
    const broken = new PicturePreviewCache(vi.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue(bitmap()));
    await expect(broken.get('page', size)).rejects.toThrow();
    await expect(broken.get('page', size)).resolves.toBeInstanceOf(HTMLCanvasElement);
  });
});

it('contains a rectangular source in a square card without stretching it', async () => {
  class SourceImage {
    naturalWidth = 200;
    naturalHeight = 100;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) { if (value) queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal('Image', SourceImage);
  const drawImage = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
  try {
    await picturePreviewCache.get('rectangular-source', { width: 100, height: 100 });
    expect(drawImage).toHaveBeenCalledWith(expect.any(SourceImage), 0, 25, 100, 50);
    expect(picturePreviewCache.ready('rectangular-source', { width: 50, height: 50 })).not.toBeNull();
  } finally { vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
