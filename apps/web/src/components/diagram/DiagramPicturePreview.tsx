import { memo, useCallback, useEffect, useRef, useState } from 'react';
import {
  picturePreviewCache,
  picturePreviewSize,
  type PicturePreviewSize,
} from '../../diagram/pictures/picturePreviewCache';
import { PictureLoading } from '../ui/PictureLoading';
import styles from './DiagramPicturePreview.module.css';

/** The bitmap on the canvas: which source, and at what size. */
interface Painted extends PicturePreviewSize {
  src: string;
}

/**
 * Navigate a bitmap of the exact composed picture. Keep its previous resolution
 * during a gesture, then sharpen once zoom settles. Pages and cards skip
 * the extra SVG paint while loading and rasterize new sources immediately.
 *
 * A changed source keeps the previous bitmap on screen until its own is drawn,
 * as a double buffer: a page's picture changes as a drag lifts a part and again
 * as it lands, and hiding the old pixels blanked the page for each raster. A
 * source of another shape (new paper) would stretch the old pixels, so it hides
 * them; only a first paint shows the loading state. Late results never
 * overwrite a newer source, and both surfaces keep the vector fallback if
 * canvas fails. `onPaint` reports each source once its pixels are on screen.
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
  onPaint,
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
  onPaint?: (src: string) => void;
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
  const onPaintRef = useRef(onPaint);
  useEffect(() => {
    onPaintRef.current = onPaint;
  });
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastDraw = useRef<{ canvas: HTMLCanvasElement; bitmap: HTMLCanvasElement } | null>(null);
  const copy = useCallback((canvas: HTMLCanvasElement, bitmap: HTMLCanvasElement) => {
    if (lastDraw.current?.canvas === canvas && lastDraw.current.bitmap === bitmap) return true;
    const success = drawBitmap(canvas, bitmap);
    lastDraw.current = success ? { canvas, bitmap } : null;
    return success;
  }, []);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [painted, setPainted] = useState<Painted | null>(null);
  /** Record a copy's outcome: its pixels on screen, or the vector in their place. */
  const show = useCallback((source: string, bitmap: HTMLCanvasElement, success: boolean) => {
    if (!success) {
      setPainted(null);
      setFailedSrc(source);
      return;
    }
    setPainted({ src: source, width: bitmap.width, height: bitmap.height });
    onPaintRef.current?.(source);
  }, []);
  const ready = painted?.src === src;
  const size = picturePreviewSize(measured || width, measured || height, scale, window.devicePixelRatio || 1);
  // The previous source's pixels, held while this one rasterizes.
  const held = !ready && painted !== null && failedSrc !== src && sameShape(painted, size);
  // Already as sharp as this zoom asks: nothing to refine.
  const sharp = ready && painted !== null && painted.width >= size.width && painted.height >= size.height;
  const cached = picturePreviewCache.ready(src, size);
  const attachCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (canvas && cached) show(src, cached, copy(canvas, cached));
  }, [cached, src, copy, show]);
  useEffect(() => {
    // Wait for the card measurement rather than rasterizing a guessed size first.
    if ((autoSize && measured === 0) || sharp) return;
    let current = true;
    const timer = setTimeout(() => {
      void picturePreviewCache.get(src, { width: size.width, height: size.height })
        .then((bitmap) => {
          const canvas = canvasRef.current;
          if (!current || !canvas) return;
          show(src, bitmap, copy(canvas, bitmap));
        })
        .catch(() => {
          // A failed refinement may have cleared the canvas: show the vector.
          if (current) { setPainted(null); setFailedSrc(src); }
        });
    // A new picture has nothing to refine: start at once. Only a visible
    // bitmap's resolution upgrade waits for the zoom gesture to settle.
    }, ready ? settleMs : 0);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [src, size.width, size.height, settleMs, copy, show, autoSize, measured, ready, sharp]);
  const visible = ready || held;
  return (
    <span ref={hostRef} className={className} aria-hidden="true">
      <canvas data-picture-preview="" ref={attachCanvas} className={styles.surface} hidden={!visible} />
      {!visible && (vectorWhileLoading || failedSrc === src
        ? <img className={styles.surface} src={src} alt="" draggable={false} />
        : <PictureLoading />)}
    </span>
  );
});

/** The same proportions, so the held bitmap is not stretched into the new one's box. */
function sameShape(a: PicturePreviewSize, b: PicturePreviewSize): boolean {
  return Math.abs(a.width / a.height - b.width / b.height) < 0.01;
}

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
