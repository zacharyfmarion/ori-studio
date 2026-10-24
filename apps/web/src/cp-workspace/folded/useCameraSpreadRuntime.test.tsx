import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { OristudioCpFoldedPaperScene } from '../../engine/oristudioCpTypes';
import { DEFAULT_CAMERA_SPREAD } from '../../diagram/document/diagramDocument';
import { useCameraSpreadRuntime } from './useCameraSpreadRuntime';

const worker = vi.hoisted(() => ({ render: vi.fn(), load: vi.fn(async () => {}), release: vi.fn(async () => {}) }));
vi.mock('./cameraSpreadClients', () => ({
  cameraSpreadGeometryKey: () => 1,
  cameraSpreadRenderClient: { retain: () => worker, release: vi.fn(), call: (work: () => unknown) => work() },
  cameraSpreadCaptureClient: {
    retain: vi.fn(),
    release: vi.fn(),
    call: async (work: (api: typeof worker) => unknown) => work(worker),
  },
}));
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const kernel = {} as OristudioCpFoldedPaperScene;
const present = vi.fn();
let runtime: ReturnType<typeof useCameraSpreadRuntime>;
let root: Root;
let host: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
function Harness() {
  const value = useCameraSpreadRuntime(kernel, present);
  useLayoutEffect(() => {
    runtime = value;
  });
  return null;
}
function draw(amount: number) {
  runtime.draw({
    spread: { ...DEFAULT_CAMERA_SPREAD, amount },
    rotationDeg: 0,
    surface: { width: 400, height: 300, dpr: 1 },
  });
}
async function frame() {
  await act(async () => {
    const ready = [...frames.values()];
    frames.clear();
    for (const tick of ready) tick(0);
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  frames = new Map();
  let serial = 0;
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => {
    frames.set(++serial, fn);
    return serial;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div');
  root = createRoot(host);
  act(() => root.render(<Harness />));
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
});

it('coalesces input to the newest request once per display frame, with one RPC in flight', async () => {
  let finish!: (bitmap: ImageBitmap) => void;
  worker.render.mockImplementationOnce(
    () =>
      new Promise<ImageBitmap>((resolve) => {
        finish = resolve;
      })
  );
  draw(0.1);
  draw(0.2);
  draw(0.3);
  expect(worker.render).not.toHaveBeenCalled();
  await frame();
  expect(worker.render).toHaveBeenCalledOnce();
  expect(worker.render.mock.lastCall?.[0].spread.amount).toBe(0.3);
  draw(0.4);
  draw(0.5);
  expect(frames.size).toBe(0);
  const first = { close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => finish(first));
  expect(worker.render).toHaveBeenCalledOnce();
  const second = { close: vi.fn() } as unknown as ImageBitmap;
  worker.render.mockResolvedValueOnce(second);
  await frame();
  expect(worker.render.mock.lastCall?.[0].spread.amount).toBe(0.5);
  expect(present.mock.calls.map(([bitmap]) => bitmap)).toEqual([first, second]);
});

it('closes a bitmap returned after the view leaves instead of presenting it', async () => {
  let finish!: (bitmap: ImageBitmap) => void;
  worker.render.mockImplementationOnce(
    () =>
      new Promise<ImageBitmap>((resolve) => {
        finish = resolve;
      })
  );
  draw(0.2);
  await frame();
  act(() => root.render(null));
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  await act(async () => finish(bitmap));
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(present).not.toHaveBeenCalled();
  expect(frames.size).toBe(0);
});
