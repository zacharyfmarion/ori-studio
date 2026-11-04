import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { DiagramFoldStepSource } from '../document/diagramDocument';
import { useFoldSpreadView } from './useFoldSpreadView';

const mocks = vi.hoisted(() => ({ read: vi.fn(), release: vi.fn(), prepared: {prepared:null as unknown, status:'idle'} }));
vi.mock('../../workspaces/foldGateway', () => ({loadFold: async () => ({
  foldSession: () => ({retain:()=>mocks.release}), readFoldStepCapture:mocks.read,
})}));
vi.mock('./foldStepPicture', () => ({foldScenePattern:()=>({faces:[]})}));
vi.mock('../../layer-spread/useConnectedSpread', () => ({useConnectedSpread:()=>mocks.prepared}));
const source = {sequence:'one',step:'one',render:{mode:'folded-flat',side:'front',spread:{kind:'connected'}}} as DiagramFoldStepSource;
let result: ReturnType<typeof useFoldSpreadView>;
const host = document.createElement('div');
let root: ReturnType<typeof createRoot>;
function Harness({input=source,live=true}:{input?:DiagramFoldStepSource;live?:boolean}) {
  const value = useFoldSpreadView(input, live);
  useLayoutEffect(() => { result = value; });
  return null;
}
afterEach(async()=>{await act(async()=>root?.unmount());vi.clearAllMocks();mocks.prepared={prepared:null,status:'idle'};});
it('covers scene reads and the solve, but releases loading for unavailable results',async()=>{
  let finish!: (x:unknown)=>void;
  mocks.read.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
  root=createRoot(host);await act(async()=>root.render(<Harness/>));
  expect(result.preparing).toBe(true);
  await act(async()=>finish({status:'ready',input:{picture:{shown:{}}}}));
  mocks.prepared={prepared:null,status:'preparing'};
  await act(async()=>root.render(<Harness/>));
  expect(result.preparing).toBe(true);
  mocks.prepared={prepared:null,status:'unavailable'};
  await act(async()=>root.render(<Harness/>));
  expect(result.preparing).toBe(false);expect(result.view).toBeNull();
  expect(mocks.release).toHaveBeenCalledOnce();
});
it('clears loading on failed reads and never prepares an inactive Pose',async()=>{
  mocks.read.mockRejectedValue(new Error('Read failed'));
  root=createRoot(host);await act(async()=>root.render(<Harness live={false}/>));
  expect(result.preparing).toBe(false);expect(mocks.read).not.toHaveBeenCalled();
  await act(async()=>root.render(<Harness/>));
  expect(result.preparing).toBe(false);expect(result.view).toBeNull();
});
it('ignores an old scene that arrives after navigation',async()=>{
  const done: ((x:unknown)=>void)[]=[];
  mocks.read.mockImplementation(()=>new Promise(resolve=>done.push(resolve)));
  root=createRoot(host);await act(async()=>root.render(<Harness/>));
  await act(async()=>root.render(<Harness input={{...source,step:'two'}}/>));
  await act(async()=>done[0]!({status:'ready',input:{picture:{shown:{}}}}));
  expect(result.preparing).toBe(true);expect(result.view).toBeNull();
  await act(async()=>done[1]!({status:'unavailable'}));
  expect(result.preparing).toBe(false);expect(mocks.release).toHaveBeenCalledTimes(2);
});
