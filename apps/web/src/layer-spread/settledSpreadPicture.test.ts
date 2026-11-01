import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LayerSpreadOptions } from '../cp-workspace/folded/foldedLayerSpread';
import type { OristudioCpFoldedPaperScene } from '../engine/oristudioCpTypes';
import type { PaperScene } from '../lib/paper/paperScene';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';
import type { ConnectedPaperScene, PreparedConnectedSpread } from './connectedScene';
import type { SpreadRaster } from './rasterConnected';

const spread = vi.hoisted(() => ({
  prepare: vi.fn(),
  capture: vi.fn(),
  raster: vi.fn(),
}));
vi.mock('./prepareConnected', () => ({ prepareConnected: (...args: unknown[]) => spread.prepare(...args) }));
vi.mock('./captureConnected', () => ({ captureConnected: (...args: unknown[]) => spread.capture(...args) }));
vi.mock('./rasterConnected', () => ({ rasterConnected: (...args: unknown[]) => spread.raster(...args) }));

const { captureSpreadScene, rasterSpreadScene, settledSpreadPicture } = await import('./settledSpreadPicture');

const kernel = { faces: [] } as unknown as OristudioCpFoldedPaperScene;
const prepared = { source: {}, solution: {} } as unknown as PreparedConnectedSpread;
const CONNECTED: LayerSpreadOptions = { kind: 'connected', version: 1, amount: 0.5, reveal: [0.8, 0.6] };
const AFFINE: LayerSpreadOptions = { kind: 'affine', amount: 0.03, keep: 'top', skew: 1, axisDeg: 81 };
const bounds = { minX: 0, minY: 0, maxX: 10, maxY: 5 };
const resolved: PaperScene = { items: [], sheet: 10, bounds };
const unresolved = { items: [], sheet: 10, bounds, connected: {} } as unknown as ConnectedPaperScene;
const raster: SpreadRaster = { png: new ArrayBuffer(4), width: 40, height: 20, scale: 4, sceneFrame: [-1, -1, 12, 7] };
const pens = { style: DEFAULT_PAPER_STYLE, policy: 'folded-flat', mm: 120 } as const;

function lease(promise: Promise<PreparedConnectedSpread> = Promise.resolve(prepared)) {
  return { promise, release: vi.fn() };
}

beforeEach(() => {
  spread.prepare.mockReset();
  spread.capture.mockReset();
  spread.raster.mockReset();
});

describe('a spread picture settled once', () => {
  it('is Affine or Depth at once, with no solve, capture or bitmap', async () => {
    const live = vi.fn(() => resolved);
    const settled = await settledSpreadPicture(kernel, AFFINE, { live, raster: pens });
    expect(settled).toEqual({ kind: 'scene', scene: resolved });
    expect(live).toHaveBeenCalledWith(null);
    expect(spread.prepare).not.toHaveBeenCalled();
    expect(spread.capture).not.toHaveBeenCalled();
  });

  it('prepares a Default spread, captures it, and lets the solve go', async () => {
    const held = lease();
    spread.prepare.mockReturnValue(held);
    spread.capture.mockResolvedValue(resolved);
    const live = vi.fn(() => unresolved);
    const settled = await settledSpreadPicture(kernel, CONNECTED, { live, raster: pens, priority: 1 });
    expect(settled).toEqual({ kind: 'scene', scene: resolved });
    expect(spread.prepare).toHaveBeenCalledWith(kernel, false, 1);
    expect(live).toHaveBeenCalledWith(prepared);
    expect(held.release).toHaveBeenCalled();
    expect(spread.raster).not.toHaveBeenCalled();
  });

  it('uses the solve a host already holds', async () => {
    spread.capture.mockResolvedValue(resolved);
    await settledSpreadPicture(kernel, CONNECTED, { live: () => unresolved, raster: pens, prepared });
    expect(spread.prepare).not.toHaveBeenCalled();
  });

  it('draws a bitmap, in the pens it is asked for, of a capture that did not resolve — never the unresolved scene', async () => {
    spread.prepare.mockReturnValue(lease());
    // The capture's time budget, or its complexity budget: the scene comes back as it went.
    spread.capture.mockResolvedValue(unresolved);
    spread.raster.mockResolvedValue(raster);
    const signal = new AbortController().signal;
    const settled = await settledSpreadPicture(kernel, CONNECTED, { live: () => unresolved, raster: pens, signal });
    expect(settled).toEqual({ kind: 'raster', raster, frame: raster.sceneFrame, scene: unresolved });
    expect(spread.raster).toHaveBeenCalledWith(unresolved, pens.style, pens.mm, signal, 'folded-flat');
  });

  it('settles flat, with why, when the solve, the capture or the bitmap fails', async () => {
    spread.prepare.mockReturnValue(lease(Promise.reject(new Error('Conflicting material layer order'))));
    expect(await settledSpreadPicture(kernel, CONNECTED, { live: () => unresolved, raster: pens })).toMatchObject({
      kind: 'flat',
      reason: 'Conflicting material layer order',
    });

    spread.prepare.mockReturnValue(lease());
    spread.capture.mockRejectedValue(new Error('Spread capture worker failed'));
    expect(await settledSpreadPicture(kernel, CONNECTED, { live: () => unresolved, raster: pens })).toMatchObject({
      kind: 'flat',
      reason: 'Spread capture worker failed',
    });

    spread.capture.mockResolvedValue(unresolved);
    const failure = new Error('Spread raster exceeded its time budget');
    spread.raster.mockRejectedValue(failure);
    const settled = await settledSpreadPicture(kernel, CONNECTED, { live: () => unresolved, raster: pens });
    expect(settled).toEqual({ kind: 'flat', reason: failure.message, cause: failure });
  });

  it('rejects as aborted, and lets the solve go, when it is no longer wanted', async () => {
    const controller = new AbortController();
    let fail!: (error: Error) => void;
    const held = lease(new Promise((_, reject) => (fail = reject)));
    held.release.mockImplementation(() => fail(new DOMException('Spread preparation released', 'AbortError')));
    spread.prepare.mockReturnValue(held);
    const settled = settledSpreadPicture(kernel, CONNECTED, {
      live: () => unresolved,
      raster: pens,
      signal: controller.signal,
    });
    controller.abort();
    await expect(settled).rejects.toMatchObject({ name: 'AbortError' });
    expect(held.release).toHaveBeenCalled();
    expect(spread.capture).not.toHaveBeenCalled();

    // Aborted before it starts, it asks nothing.
    spread.prepare.mockClear();
    await expect(
      settledSpreadPicture(kernel, CONNECTED, { live: () => unresolved, raster: pens, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(spread.prepare).not.toHaveBeenCalled();
  });
});

describe('the stages a split host calls', () => {
  it('passes a scene with nothing to clip through, and names an unresolved capture over the budget', async () => {
    expect(await captureSpreadScene(resolved)).toEqual({ kind: 'scene', scene: resolved });
    expect(spread.capture).not.toHaveBeenCalled();
    spread.capture.mockResolvedValue(unresolved);
    expect(await captureSpreadScene(unresolved)).toEqual({ kind: 'over-budget', scene: unresolved });
  });

  it('draws the bitmap of an unresolved scene in the policy it is asked for', async () => {
    spread.raster.mockResolvedValue(raster);
    expect(await rasterSpreadScene(unresolved, { ...pens, policy: 'fold' })).toEqual({
      kind: 'raster',
      raster,
      frame: raster.sceneFrame,
      scene: unresolved,
    });
    expect(spread.raster).toHaveBeenCalledWith(unresolved, pens.style, pens.mm, undefined, 'fold');
  });

  it('asks a host whose page depends on the layers’ reach how large the bitmap is drawn', async () => {
    spread.raster.mockResolvedValue(raster);
    const mm = vi.fn(() => 42);
    await rasterSpreadScene(unresolved, { ...pens, mm });
    expect(mm).toHaveBeenCalledWith(unresolved);
    expect(spread.raster).toHaveBeenCalledWith(unresolved, pens.style, 42, undefined, 'folded-flat');
  });
});
