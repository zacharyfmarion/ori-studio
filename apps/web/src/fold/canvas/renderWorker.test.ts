import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import type { FoldRenderFrame, FoldRenderMessage } from './foldRenderProtocol';
const mocks = vi.hoisted(() => ({ prepare: vi.fn(), build: vi.fn(() => ({ geometry: {}, payload: { positions: [] } })), upload: vi.fn(), draw: vi.fn(() => ({})) }));
vi.mock('./foldRenderGeometry', () => ({ prepareFoldRender: mocks.prepare }));
vi.mock('../../layer-spread/bitmapRenderer', () => ({ createSpreadBitmapRenderer: () => ({ setData: mocks.upload, draw: mocks.draw }) }));
let worker: { onmessage: (event: {data: FoldRenderMessage}) => void; postMessage: ReturnType<typeof vi.fn> };
const frame: FoldRenderFrame = { spread: { kind: 'connected', version: 1, amount: .5, reveal: [1, 0] }, display: { precreases: true, stepCreases: true }, offset: {x: 1,y: 2}, style: DEFAULT_PAPER_STYLE, ink: {}, width: 800, height: 600, view: { origin: [0,0],ex:[1,0],ey:[0,1] }, widthPx: 2 };
const send = (f = frame) => worker.onmessage({data: {kind:'frame', id:7, frame:f}});
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); mocks.prepare.mockReturnValue(mocks.build);
  worker = { onmessage: () => {}, postMessage: vi.fn() }; vi.stubGlobal('self', worker);
  await import('./render.worker'); worker.onmessage({data:{kind:'source',source:{} as never}});
});
afterEach(() => vi.unstubAllGlobals());
it('camera frames keep both picking and GPU geometry resident', () => {
  send(); send({...frame, width:1000, view:{...frame.view,origin:[3,4]}});
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.build).toHaveBeenCalledOnce(); expect(mocks.upload).toHaveBeenCalledOnce();
  expect(mocks.draw).toHaveBeenCalledTimes(2);
  expect(worker.postMessage.mock.calls[0]![0]).toMatchObject({kind:'frame',id:7,payload:{positions:[]}});
  expect(worker.postMessage.mock.calls[1]![0].payload).toBeUndefined();
});
it('invalidates for reveal, display and face ink changes without redoing static preparation', () => {
  send(); send({...frame,spread:{...frame.spread,reveal:[1,2]}}); send({...frame,display:{...frame.display,precreases:false}});
  send({...frame,ink:{faces:new Map([[0,{alpha:.5}]])}});
  send({...frame,ink:{faces:new Map([[0,{alpha:.8}]])}});
  expect(mocks.prepare).toHaveBeenCalledOnce(); expect(mocks.build).toHaveBeenCalledTimes(5);
});
