import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PAPER_STYLE_POLICIES } from '../lib/paper/paperStyleResolve';
import { DEFAULT_PAPER_STYLE } from '../lib/paper/paperStyle';
import type { SpreadRasterRequest } from './rasterConnected';

const mocks = vi.hoisted(() => ({ setData: vi.fn(), draw: vi.fn(), geometry: vi.fn(() => ({})) }));
vi.mock('regl', () => ({ default: () => ({ clear: vi.fn(), destroy: vi.fn() }) }));
vi.mock('../cp-workspace/renderer/programs/spreadProgram', () => ({
  createSpreadProgram: () => ({ setData: mocks.setData, draw: mocks.draw }),
}));
vi.mock('./spreadGeometry', () => ({ spreadGeometry: mocks.geometry }));

let worker: { onmessage: (event: { data: SpreadRasterRequest }) => Promise<void>; postMessage: ReturnType<typeof vi.fn> };
const scene = { items: [], sheet: 10, bounds: { minX: 0, minY: 0, maxX: 10, maxY: 5 }, connected: {} } as unknown as
  SpreadRasterRequest['scene'];

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  worker = { onmessage: async () => {}, postMessage: vi.fn() };
  vi.stubGlobal('self', worker);
  vi.stubGlobal(
    'OffscreenCanvas',
    class {
      constructor(
        public width: number,
        public height: number
      ) {}
      getContext() {
        return {};
      }
      async convertToBlob() {
        return new Blob([new Uint8Array([137, 80, 78, 71])]);
      }
    }
  );
  await import('./raster.worker');
});
afterEach(() => vi.unstubAllGlobals());

it('reads the pens through Fold’s policy when the caller names none, as every bitmap was drawn before', async () => {
  await worker.onmessage({ data: { scene, style: DEFAULT_PAPER_STYLE, mm: 30 } });
  expect(mocks.geometry).toHaveBeenCalledWith(scene, DEFAULT_PAPER_STYLE, { policy: PAPER_STYLE_POLICIES.fold });
  expect(worker.postMessage.mock.lastCall?.[0]).toMatchObject({ kind: 'png' });
});

it('reads the pens through the policy the caller names, so a bitmap matches its vector', async () => {
  await worker.onmessage({ data: { scene, style: DEFAULT_PAPER_STYLE, mm: 30, policy: 'folded-flat' } });
  expect(mocks.geometry).toHaveBeenCalledWith(scene, DEFAULT_PAPER_STYLE, {
    policy: PAPER_STYLE_POLICIES['folded-flat'],
  });
});

it('asks the worker for Fold’s pens unless told otherwise', async () => {
  const posted: unknown[] = [];
  class FakeWorker {
    onmessage: ((event: { data: unknown }) => void) | null = null;
    onerror: (() => void) | null = null;
    postMessage(message: unknown) {
      posted.push(message);
      this.onmessage?.({ data: { kind: 'png', png: new ArrayBuffer(1), width: 1, height: 1, scale: 1, sceneFrame: [0, 0, 1, 1] } });
    }
    terminate() {}
  }
  vi.stubGlobal('Worker', FakeWorker);
  const { rasterConnected } = await import('./rasterConnected');
  await rasterConnected(scene, DEFAULT_PAPER_STYLE, 30);
  await rasterConnected(scene, DEFAULT_PAPER_STYLE, 30, undefined, 'folded-flat');
  expect(posted).toMatchObject([{ policy: 'fold' }, { policy: 'folded-flat' }]);
});
