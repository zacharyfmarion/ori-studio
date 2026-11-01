import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';
import type { FoldedSceneInk } from '../../cp-workspace/adapters/cpFoldedToScene';
import type { CpSurfacePaperFrame } from '../../cp-workspace/surface/useCpSurface';
import { useBitmapRenderer } from '../../layer-spread/useBitmapRenderer';
import type { Point } from '../../lib/geometry';
import type { PaperStyle } from '../../lib/paper/paperStyle';
import type { FoldPaneDisplay } from './foldPaneScenes';
import type { FoldLiveRenderer, FoldRenderFrame, FoldRenderPayload, FoldRenderSource } from './foldRenderProtocol';
const createWorker = () => new Worker(new URL('./render.worker.ts', import.meta.url), { type: 'module' });
const cameraKey = (f: Pick<FoldRenderFrame, 'view' | 'width' | 'height'>) => JSON.stringify([f.view, f.width, f.height]);

export function useFoldPaperRenderer(live: FoldLiveRenderer | null, display: FoldPaneDisplay, offset: Point,
  style: PaperStyle, ink: FoldedSceneInk, afterPaint: () => void) {
  const bitmapRef = useRef<HTMLCanvasElement | null>(null);
  const displayedFrame = useRef<CpSurfacePaperFrame | null>(null);
  const presentedFrame = useCallback(() => live ? displayedFrame.current : null, [live]);
  const camera = useRef<CpSurfacePaperFrame | null>(null);
  const shownCamera = useRef<string | null>(null), wantedCamera = useRef<string | null>(null);
  const lastRequest = useRef<string | null>(null);
  const paint = useCallback((bitmap: ImageBitmap, frame: FoldRenderFrame, payload?: FoldRenderPayload) => {
    const canvas = bitmapRef.current;
    if (!canvas || !live) { bitmap.close(); return; }
    // Commit the pick geometry in the same task as the pixels. No event can
    // observe a new bitmap with the previous pose's index.
    displayedFrame.current = frame.surfaceFrame ?? null;
    if (payload) flushSync(() => live.present(payload));
    if (canvas.width !== bitmap.width) canvas.width = bitmap.width;
    if (canvas.height !== bitmap.height) canvas.height = bitmap.height;
    const context = canvas.getContext('2d');
    if (!context) { bitmap.close(); throw new Error('Fold bitmap presentation unavailable'); }
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    shownCamera.current = cameraKey(frame);
    flushSync(afterPaint);
  }, [live, afterPaint]);
  const { request, status } = useBitmapRenderer<FoldRenderSource, FoldRenderFrame, FoldRenderPayload>(live?.source ?? null, createWorker, paint);
  const onFrame = useCallback((frame: CpSurfacePaperFrame) => {
    camera.current = frame;
    if (!live) return;
    const next: FoldRenderFrame = { surfaceFrame: frame, spread: live.spread, display, offset, style, ink,
      width: frame.viewport.width, height: frame.viewport.height, view: frame.userView, widthPx: frame.widthPx };
    wantedCamera.current = cameraKey(next);
    const key = JSON.stringify([next, ink.faces ? [...ink.faces] : null]);
    if (key === lastRequest.current) return;
    lastRequest.current = key;
    request(next);
  }, [live, display, offset, style, ink, request]);
  useLayoutEffect(() => { lastRequest.current = null; shownCamera.current = null; displayedFrame.current = null; }, [live?.source]);
  useEffect(() => { if (camera.current) onFrame(camera.current); }, [onFrame]);
  const canPick = useCallback(() => !live || (shownCamera.current !== null && shownCamera.current === wantedCamera.current), [live]);
  return { bitmapRef, onFrame, canPick, status, presentedFrame };
}
