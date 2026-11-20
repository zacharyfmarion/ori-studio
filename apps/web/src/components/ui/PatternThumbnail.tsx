import { memo, useEffect, useRef } from 'react';
import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import { paintSheetThumbnail } from '../../cp-workspace/sheets/paintSheetThumbnail';
import { readSheetThumbnailInks, type SheetAuxInk } from '../../cp-workspace/sheets/sheetStrokeInk';
import { useFoldAngleDisplay } from '../../cp-workspace/foldAngle/useFoldAngleDisplay';
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
 * A crease folded short of 180° is shaded as Edit's canvas shades it, in the
 * View panel's Fold angle style (`sheetStrokeInk`), so a 3D pattern can be
 * told from a flat one in the list.
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
  auxInk?: SheetAuxInk;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const theme = useThemeStore((s) => s.currentTheme);
  const display = useFoldAngleDisplay();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const inks = readSheetThumbnailInks(canvas, { auxInk, display });
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
      paintSheetThumbnail(context, thumbnail, width, height, inks);
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [thumbnail, theme, auxInk, display]);
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
