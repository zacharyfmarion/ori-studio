import { act, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { FoldLiveRenderer, FoldRenderFrame, FoldRenderPayload } from './foldRenderProtocol';
import type { CpSurfacePaperFrame } from '../../cp-workspace/surface/useCpSurface';
import { FOLD_PANE_DISPLAY_DEFAULT } from './foldPaneScenes';
import { DEFAULT_PAPER_STYLE } from '../../lib/paper/paperStyle';
import { PAPER_STYLE_POLICIES } from '../../lib/paper/paperStyleResolve';
const mock = vi.hoisted(() => ({ request: vi.fn(), paint: null as null | ((bitmap: ImageBitmap, frame: FoldRenderFrame, payload?: FoldRenderPayload) => void) }));
vi.mock('../../layer-spread/useBitmapRenderer', () => ({ useBitmapRenderer: (_source: unknown, _make: unknown, paint: typeof mock.paint) => {
  mock.paint = paint; return { request: mock.request, status: 'ready' };
} }));
import { useFoldPaperRenderer } from './useFoldPaperRenderer';
let result: ReturnType<typeof useFoldPaperRenderer>;
const afterPaint = vi.fn();
const live = { source: {}, spread: {kind:'connected',version:1,amount:.5,reveal:[1,0]}, present: vi.fn() } as unknown as FoldLiveRenderer;
function Harness() {
  const value = useFoldPaperRenderer(live, FOLD_PANE_DISPLAY_DEFAULT, {x:0,y:0}, DEFAULT_PAPER_STYLE, {policy:PAPER_STYLE_POLICIES.fold}, afterPaint);
  useLayoutEffect(() => { result = value; });
  // This passes the ref object to React; it does not read its current value.
  // eslint-disable-next-line react-hooks/refs
  return <canvas ref={value.bitmapRef} />;
}
let root: ReturnType<typeof createRoot>;
afterEach(async () => { await act(async()=>root?.unmount());vi.restoreAllMocks();vi.clearAllMocks(); });
const camera = (zoom: number): CpSurfacePaperFrame => ({view:{origin:[0,0],ex:[zoom,0],ey:[0,zoom]},userView:{origin:[0,0],ex:[zoom,0],ey:[0,zoom]},viewport:{width:800,height:600,dpr:1},widthPx:1.333});
it('publishes bitmap, picking and displayed camera together, without resending identical views', async () => {
  const draw = vi.fn();
  vi.spyOn(HTMLCanvasElement.prototype,'getContext').mockReturnValue({clearRect:vi.fn(),drawImage:draw} as unknown as RenderingContext);
  root = createRoot(document.createElement('div'));
  await act(async()=>root.render(<Harness/>));
  const first = camera(1), second = camera(2);
  act(()=>result.onFrame(first)); const frame = mock.request.mock.lastCall![0];
  expect(result.canPick()).toBe(false);
  act(()=>result.onFrame(first));expect(mock.request).toHaveBeenCalledTimes(1);
  const bitmap = {width:800,height:600,close:vi.fn()} as unknown as ImageBitmap;
  const payload = {} as FoldRenderPayload;
  await act(async()=>mock.paint!(bitmap,frame,payload));
  expect(live.present).toHaveBeenCalledWith(payload);
  expect(draw).toHaveBeenCalledWith(bitmap,0,0);
  expect(bitmap.close).toHaveBeenCalledOnce();
  expect(result.presentedFrame()).toBe(first);expect(result.canPick()).toBe(true);
  act(()=>result.onFrame(second));expect(result.canPick()).toBe(false);
  expect(result.presentedFrame()).toBe(first);
  await act(async()=>mock.paint!(bitmap,mock.request.mock.lastCall![0]));
  expect(result.presentedFrame()).toBe(second);expect(result.canPick()).toBe(true);
  expect(live.present).toHaveBeenCalledTimes(1);expect(afterPaint).toHaveBeenCalledTimes(2);
});
