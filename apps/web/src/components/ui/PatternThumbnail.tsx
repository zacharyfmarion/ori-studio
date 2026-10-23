import { memo, useEffect, useRef } from 'react';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { paintSheetThumbnail } from '../../cp-workspace/sheets/paintSheetThumbnail';
import { useThemeStore } from '../../store/themeStore';
import styles from './PatternThumbnail.module.css';

/**
 * A pattern drawn small, as the pattern pickers draw one: hairlines in the
 * theme's crease inks (the `--sheet-thumb-*` tokens), never the paper style's
 * dashes, which at this size are a field of dots. The Diagram's pattern picker
 * and a linked card's corner draw one, and Fold's step strip, Steps grid and
 * Import CP's samples; the rails' `SheetGrid` keeps its cards. On a canvas,
 * which keeps thousands of tiny strokes out of the DOM.
 *
 * An aux line is the unassigned grey, as a sheet card draws it, unless
 * `auxInk` is `aux`: then it is in Edit's own auxiliary-line ink, as Edit's
 * canvas draws one — Fold's precreases, which its crease-pattern pane draws
 * as aux lines.
 *
 * Decorative: what it shows is said in words beside it.
 */
export const PatternThumbnail = memo(function PatternThumbnail({
  thumbnail,
  className,
  auxInk = 'unassigned',
}: {
  thumbnail: SheetThumbnail;
  className?: string;
  /** The ink an aux line is drawn in: the unassigned grey, or Edit's aux-line ink. */
  auxInk?: 'unassigned' | 'aux';
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.currentTheme);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const css = getComputedStyle(canvas);
    const unassigned = css.getPropertyValue('--sheet-thumb-unassigned');
    const colors = {
      edge: css.getPropertyValue('--sheet-thumb-border'),
      mountain: css.getPropertyValue('--sheet-thumb-mountain'),
      valley: css.getPropertyValue('--sheet-thumb-valley'),
      unassigned,
      aux: auxInk === 'aux' ? css.getPropertyValue('--fold-flat') : unassigned,
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
  }, [thumbnail, theme, auxInk]);
  return (
    <canvas
      data-sheet-thumbnail=""
      data-aux-ink={auxInk === 'aux' ? 'aux' : undefined}
      ref={ref}
      aria-hidden="true"
      className={className ? `${styles.thumbnail} ${className}` : styles.thumbnail}
    />
  );
});
