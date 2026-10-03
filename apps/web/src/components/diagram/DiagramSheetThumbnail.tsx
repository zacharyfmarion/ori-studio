import type { SheetThumbnail } from '../../cp-workspace/sheets/sheetThumbnail';
import styles from './DiagramSheetThumbnail.module.css';

/**
 * A pattern drawn small, as the pattern pickers draw one: hairlines in the
 * theme's crease inks (the `--sheet-thumb-*` tokens), never the paper style's
 * dashes, which at this size are a field of dots. The Diagram's own, for the
 * pattern picker and a linked card's corner; the rails' `SheetGrid` keeps its
 * cards.
 *
 * Decorative: what it shows is said in words beside it.
 */
export function DiagramSheetThumbnail({
  thumbnail,
  className,
}: {
  thumbnail: SheetThumbnail;
  /** The parent's placement: its size and position. */
  className?: string;
}) {
  return (
    <svg
      viewBox={thumbnail.viewBox}
      aria-hidden="true"
      focusable="false"
      className={className ? `${styles.thumbnail} ${className}` : styles.thumbnail}
    >
      {thumbnail.strokes.map((stroke, index) => (
        <line
          key={index}
          className={styles.stroke}
          data-role={stroke.role}
          x1={stroke.x1}
          y1={stroke.y1}
          x2={stroke.x2}
          y2={stroke.y2}
        />
      ))}
    </svg>
  );
}
