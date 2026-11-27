import styles from './CpDetectGridLines.module.css';

/**
 * Below this many cells each line is drawn at full strength; above it the
 * lines fade so that ink per area stays the same, and a 128-grid reads as a
 * light tint behind the creases instead of a gray field.
 */
const FULL_STRENGTH_CELLS = 32;
/** The faintest a fine grid is drawn, so it is still there. */
const MIN_OPACITY = 0.3;

/**
 * The grid a box-pleated detection is snapped to, behind its creases in the
 * dialog's preview: the unit square in `cells` cells, interior lines only (the
 * paper edge is the pattern's own border crease). It is what lets the reading
 * be checked by eye — every crease the snap moved now runs along one of these
 * lines or across their cells' diagonals.
 *
 * An SVG group for the preview's `viewBox="0 0 1 1"`; it draws first, so the
 * creases paint over it.
 */
export function CpDetectGridLines({ cells }: { cells: number }) {
  const offsets = Array.from({ length: Math.max(0, cells - 1) }, (_, index) => (index + 1) / cells);
  const opacity = Math.max(MIN_OPACITY, Math.min(1, FULL_STRENGTH_CELLS / cells));
  return (
    <g className={styles.grid} opacity={opacity} data-cp-detect-grid-cells={cells} aria-hidden="true">
      {offsets.map((offset) => (
        <line key={`x${offset}`} x1={offset} y1={0} x2={offset} y2={1} />
      ))}
      {offsets.map((offset) => (
        <line key={`y${offset}`} x1={0} y1={offset} x2={1} y2={offset} />
      ))}
    </g>
  );
}
