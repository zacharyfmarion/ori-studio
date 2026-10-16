import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { picturePreviewCache, picturePreviewSize } from '../../diagram/pictures/picturePreviewCache';
import styles from './DiagramPicturePreview.module.css';

/**
 * Navigate a bitmap of the exact composed picture. Keep its previous resolution
 * during a gesture, then sharpen once zoom settles. Pages and cards skip
 * the extra SVG paint while loading and rasterize new sources immediately.
 * Changed sources hide old pixels, and late results cannot overwrite them.
 * Both surfaces retain the vector fallback if canvas fails.
 */
export const DiagramPicturePreview = memo(function DiagramPicturePreview({
  src,
  width,
  height,
  scale,
  className,
  autoSize = false,
  settleMs = 150,
  vectorWhileLoading = true,
}: {
  src: string;
  width: number;
  height: number;
  scale: number;
  className?: string;
  /** Measure a square step well; Pages supply their paper dimensions directly. */
  autoSize?: boolean;
  settleMs?: number;
  vectorWhileLoading?: boolean;
}) {
  const hostRef = useRef<HTMLSpanElement>(null);
  const [measured, setMeasured] = useState(0);
  useEffect(() => {
    if (!autoSize || !hostRef.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setMeasured(Math.ceil(entry.contentRect.width / 64) * 64);
    });
    observer.observe(hostRef.current);
    return () => observer.disconnect();
  }, [autoSize]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDraw = useRef<{ canvas: HTMLCanvasElement; bitmap: HTMLCanvasElement } | null>(null);
  const copy = useCallback((canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement) => {
    if (lastDraw.current?.canvas === canvas && lastDraw.current.bitmap === bitmap) return true;
    const success = drawBitmap(canvas, bitmap);
    lastDraw.current = success ? { canvas, bitmap } : null;
    return success;
  }, []);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [paintedSrc, setPaintedSrc] = useState<string | null>(null);
  const ready = paintedSrc === src;
  const size = picturePreviewSize(measured || width, measured || height, scale, window.devicePixelRatio || 1);
  const cached = picturePreviewCache.ready(src, size);
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas && cached) {
      const ready = copy(canvas, cached);
      setPaintedSrc(ready ? src : null);
      if (!ready) setFailedSrc(src);
    }
  }, [cached, src, copy]);
  useEffect(() => {
    // Wait for the card measurement rather than rasterizing a guessed size first.
    if (autoSize && measured === 0) return;
    let current = true;
    const timer = setTimeout(() => {
      void picturePreviewCache.get(src, { width: size.width, height: size.height })
        .then((bitmap) => {
          const canvas = canvasRef.current;
          if (!current || !canvas) return;
          const ready = copy(canvas, bitmap);
          setPaintedSrc(ready ? src : null);
          if (!ready) setFailedSrc(src);
        })
        .catch(() => {
          // A failed refinement may have cleared the canvas: show the vector.
          if (current) { setPaintedSrc(null); setFailedSrc(src); }
        });
    // A new picture has nothing to refine: start at once. Only a visible
    // bitmap's resolution upgrade waits for the zoom gesture to settle.
    }, ready ? settleMs : 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [src, size.width, size.height, settleMs, copy, autoSize, measured, ready]);
  return (
    <span ref={hostRef} className={className} aria-hidden="true">
      <canvas data-picture-preview="" ref={attachCanvas} className={styles.surface} hidden={!ready} />
      {!ready && (vectorWhileLoading || failedSrc === src
        ? <img className={styles.surface} src={src} alt="" draggable={false} />
        : <span className={styles.pending}><LoaderCircle size={16} className={styles.loading} /></span>)}
    </span>
  );
});

function drawBitmap(canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement): boolean {
  try {
    const context = canvas.getContext('2d');
    if (!context) return false;
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    context.drawImage(bitmap, 0, 0);
    return true;
  } catch {
    return false;
  }
}
