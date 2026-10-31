import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SpreadFrame, SpreadRenderMessage } from './renderProtocol';

const mocks = vi.hoisted(() => ({
  setData: vi.fn(), draw: vi.fn(), poll: vi.fn(), clear: vi.fn(),
  project: vi.fn(() => ({ connected: {} })), geometry: vi.fn(() => ({})),
}));
vi.mock('regl', () => ({ default: () => ({ poll: mocks.poll, clear: mocks.clear }) }));
vi.mock('../cp-workspace/renderer/programs/spreadProgram', () => ({
  createSpreadProgram: () => ({ setData: mocks.setData, draw: mocks.draw }),
}));
vi.mock('./posedScene', () => ({ posedSpreadScene: mocks.project }));
vi.mock('./spreadGeometry', () => ({ spreadGeometry: mocks.geometry }));
vi.mock('./spreadFrame', () => ({
  spreadFrame: (_view: unknown, _turn: number, _spatial: boolean, width: number, height: number, zoom: number) =>
    ({ x: width / 2, y: height / 2, scale: zoom }),
}));
let worker: { onmessage: (event: { data: SpreadRenderMessage }) => void; postMessage: ReturnType<typeof vi.fn> };
const frame = (): SpreadFrame => ({
  spread: { kind: 'connected', version: 1, amount: 1, reveal: [0.8, 0.6] },
  rotationDeg: 0, width: 800, height: 600, zoom: 1, style: {} as SpreadFrame['style'],
});
const send = (f: SpreadFrame) => worker.onmessage({ data: { kind: 'frame', frame: f } });
const source = () => worker.onmessage({ data: { kind: 'source', view: {} as never } });
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  worker = { onmessage: () => {}, postMessage: vi.fn() };
  vi.stubGlobal('self', worker);
  vi.stubGlobal('OffscreenCanvas', class {
    constructor(public width: number, public height: number) {}
    getContext() { return {}; }
    transferToImageBitmap() { return {}; }
  });
  await import('./render.worker');
  source();
});
afterEach(() => vi.unstubAllGlobals());

it('redraws zoom/resize with resident geometry and the latest frame dimensions', () => {
  send(frame());
  send({ ...frame(), zoom: 2 });
  send({ ...frame(), zoom: 3, width: 1000, height: 700 });
  expect(mocks.project).toHaveBeenCalledTimes(1);
  expect(mocks.geometry).toHaveBeenCalledTimes(1);
  expect(mocks.setData).toHaveBeenCalledTimes(1);
  expect(mocks.draw).toHaveBeenCalledTimes(3);
  expect(mocks.draw.mock.lastCall?.[0]).toMatchObject({ view: { origin: [500, 350], ex: [3, 0] }, viewport: { width: 1000, height: 700 } });
  expect(worker.postMessage).toHaveBeenCalledTimes(3);
});

it('invalidates resident geometry for every pose/style edit and source replacement', () => {
  let f = frame();
  send(f);
  const edit = (patch: Partial<SpreadFrame>) => {
    const count = mocks.setData.mock.calls.length;
    f = { ...f, ...patch }; send(f);
    expect(mocks.setData).toHaveBeenCalledTimes(count + 1);
  };
  edit({ spread: { ...f.spread, amount: 2 } });
  edit({ spread: { ...f.spread, reveal: [-0.8, 0.6] } });
  edit({ rotationDeg: 90 });
  edit({ style: { ...f.style, erode: 0.1 } });
  edit({ presentation: { kind: 'perspective', orderSide: 'front', camera: { yaw: 0, pitch: 0, zoom: 1 } } });
  edit({ presentation: { ...f.presentation!, camera: { yaw: 0, pitch: 0, zoom: 2 } } });
  edit({ presentation: { ...f.presentation!, orderSide: 'back' } });
  const count = mocks.setData.mock.calls.length;
  source(); send(f);
  expect(mocks.setData).toHaveBeenCalledTimes(count + 1);
});
