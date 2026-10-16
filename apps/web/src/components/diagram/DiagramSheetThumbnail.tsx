import { memo, useEffect, useRef } from 'react';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { paintSheetThumbnail } from '../../cp-workspace/sheets/paintSheetThumbnail';
import { useThemeStore } from '../../store/themeStore';
import styles from './DiagramSheetThumbnail.module.css';

/** Decorative CP badge. A canvas keeps thousands of tiny strokes out of the DOM. */
export const DiagramSheetThumbnail = memo(function DiagramSheetThumbnail({ thumbnail, className }: {
  thumbnail: SheetThumbnail;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.currentTheme);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const css = getComputedStyle(canvas);
    const colors = {
      edge: css.getPropertyValue('--sheet-thumb-border'),
      mountain: css.getPropertyValue('--sheet-thumb-mountain'),
      valley: css.getPropertyValue('--sheet-thumb-valley'),
      unassigned: css.getPropertyValue('--sheet-thumb-unassigned'),
      aux: css.getPropertyValue('--sheet-thumb-unassigned'),
    };
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return;
      const { width, height } = entry.contentRect;
      if (width <= 0 || height <= 0) return;
      const context = canvas.getContext('2d');
      if (!context) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.ceil(width * dpr);
      canvas.height = Math.ceil(height * dpr);
      context.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintSheetThumbnail(context, thumbnail, width, height, colors);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [thumbnail, theme]);
  return <canvas data-sheet-thumbnail="" ref={ref} aria-hidden="true" className={className ? `${styles.thumbnail} ${className}` : styles.thumbnail} />;
});
