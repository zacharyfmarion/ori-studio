import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { flatSquareLandmarks, flatSquareScene } from './foldCanvas.fixtures';
import { foldPickData, foldPickIndex } from './foldPicking';
import { useFoldPickPreparation } from './useFoldPickPreparation';
import type { FoldScene } from '../engine/foldEngineWire';
vi.mock('../../monitoring', () => ({ reportError: vi.fn() }));
const workers: FakeWorker[] = [];
class FakeWorker {
  onmessage: ((event: {data: unknown}) => void) | null = null;
  onerror: ((event: {message: string}) => void) | null = null;
  postMessage = vi.fn(); terminate = vi.fn();
  constructor() { workers.push(this); }
}
const scene = flatSquareScene(), landmarks = flatSquareLandmarks(), marks: [] = [];
const data = {kind:'ready',index:foldPickData(foldPickIndex(scene,landmarks,marks)),bindings:new Map()};
let result: ReturnType<typeof useFoldPickPreparation>;
function Harness({source=scene}:{source?:FoldScene}) { const value=useFoldPickPreparation(source,landmarks,marks); useLayoutEffect(()=>{result=value;}); return null; }
let root: ReturnType<typeof createRoot>;
afterEach(async()=>{await act(async()=>root?.unmount());workers.length=0;vi.unstubAllGlobals();vi.useRealTimers();});
it('prepares once, keeps scene identity, and drops obsolete model replies', async()=>{
  vi.stubGlobal('Worker',FakeWorker); root=createRoot(document.createElement('div'));
  await act(async()=>root.render(<Harness/>)); expect(result.status).toBe('preparing'); expect(result.prepared).toBeNull();
  await act(async()=>workers[0]!.onmessage!({data})); expect(result.prepared?.index.scene).toBe(scene);
  await act(async()=>root.render(<Harness/>)); expect(workers).toHaveLength(1);
  await act(async()=>root.render(<Harness source={flatSquareScene()}/>)); expect(result.prepared).toBeNull();
  await act(async()=>workers[0]!.onmessage!({data})); expect(result.prepared).toBeNull();
});
it('a failed preparation cannot be revived by a late reply', async()=>{
  vi.stubGlobal('Worker',FakeWorker); vi.useFakeTimers(); root=createRoot(document.createElement('div'));
  await act(async()=>root.render(<Harness/>));
  await act(async()=>vi.advanceTimersByTimeAsync(30_000)); expect(result.status).toBe('error');
  await act(async()=>workers[0]!.onmessage!({data})); expect(result.status).toBe('error');
});
