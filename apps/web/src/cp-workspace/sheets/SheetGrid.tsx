import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { useThemeStore } from '../../store/themeStore';
import { useFoldAngleDisplay } from '../foldAngle/useFoldAngleDisplay';
import { readSheetThumbnailInks, sheetStrokeInk, type SheetThumbnailInks } from './sheetStrokeInk';
import { isPartialFoldStroke, type SheetStroke, type SheetThumbnail } from './sheetThumbnail';

/**
 * A crease folded short of 180°, shaded as Edit's canvas shades it: its ink
 * and opacity on the line itself, over the role's ink the stylesheet gives
 * every other line. Per line, because it is the line's own angle.
 */
function partialFoldStyle(stroke: SheetStroke, inks: SheetThumbnailInks): CSSProperties {
  const ink = sheetStrokeInk(stroke, inks);
  return { stroke: ink.stroke, strokeOpacity: ink.opacity };
}

/**
 * The document's crease patterns as cards, one of them selected.
 *
 * One component for both rails that pick a pattern — References and Simulate —
 * because the question the cards answer is the same on both: a document can
 * hold several disjoint patterns, and which one is the workspace on. Each rail
 * builds its items from its own reading of the document (a precrease component,
 * a FOLD segment) and this only draws them.
 *
 * One markup for two shapes. In a desktop rail it is a column of cards, one
 * per row, under the "Patterns" header; on a phone the rail *is* the list
 * screen and this is a full-width grid of larger cards, two to a row, sized
 * for a thumb. The stylesheet's phone block draws the difference (`theme.css`,
 * `.sheet-grid`), because a second card component would be a second thing to
 * keep in step.
 *
 * Each card draws its pattern as main's rails did, not as the paper style
 * draws paper: solid lines in the theme's crease inks at main's widths, classed
 * by role for the stylesheet (`.sheet-card__stroke--*`) — the edge in
 * `--text-tertiary`, aux and unassigned lines in the unassigned grey. A card
 * is read, not admired, and at this size a dashed fold is a field of dots. The
 * References rail sits inside the workspace where the style re-sets the fold
 * inks, so the stylesheet reaches the theme's through aliases declared on
 * `:root`. A crease folded short of 180° is the one line that carries its own
 * ink: its angle shades it as Edit's canvas does (`sheetStrokeInk`, the
 * pattern pickers' rule too), so a 3D pattern's card reads as 3D.
 *
 * Presentation only: which sheets, which one is active, and a press reports
 * back. What a press *means* is the caller's — on the desktop it changes the
 * selection beside the canvas, on a phone it also opens the detail screen.
 */
export interface SheetGridItem {
  /** What a press reports. */
  id: number;
  thumbnail: SheetThumbnail | null;
  /**
   * How big the sheet is, in the rail's own words — "9 creases", "16 faces".
   * Worded by the rail rather than counted here because the two rails read
   * different things: References counts the document's lines, Simulate the
   * faces of a planarized fold, and one "creases" over both would give the
   * same pattern two different numbers.
   */
  size: string;
  /**
   * Drawn greyed: a sheet the workspace will not take. It still gets a card —
   * it is a pattern the user can see on the canvas, and a card that quietly
   * vanished would read as a bug.
   */
  refused?: boolean;
}

export interface SheetGridProps {
  sheets: readonly SheetGridItem[];
  /**
   * Whether the aux lines are drawn: each rail's own answer — References
   * follows its view's option, Simulate always draws them.
   */
  showAux: boolean;
  selected: number | null;
  onSelect: (id: number) => void;
}

export const SheetGrid = memo(function SheetGrid({
  sheets,
  showAux,
  selected,
  onSelect,
}: SheetGridProps) {
  const { t } = useTranslation();
  const grid = useRef<HTMLDivElement>(null);
  const inks = usePartialFoldInks(grid, sheets);
  // A plain container, not a list: a `listbox` may own only `option` and
  // `group`, and wrapping each option in an `li` puts something between them.
  return (
    <div
      ref={grid}
      className="sheet-grid"
      role="listbox"
      aria-label={t('panels:sheets.label', 'Crease patterns')}
    >
      {sheets.map((sheet, index) => (
        <SheetCard
          key={sheet.id}
          sheet={sheet}
          index={index}
          showAux={showAux}
          inks={inks}
          selected={sheet.id === selected}
          onSelect={() => onSelect(sheet.id)}
        />
      ))}
    </div>
  );
});

/**
 * The inks a crease folded short of 180° is shaded from (`sheetStrokeInk`),
 * read off the grid before it paints — or null while no card has one, so a
 * flat pattern's cards leave every ink to the stylesheet, as they always did.
 */
function usePartialFoldInks(
  grid: RefObject<HTMLDivElement | null>,
  sheets: readonly SheetGridItem[]
): SheetThumbnailInks | null {
  const display = useFoldAngleDisplay();
  const theme = useThemeStore((s) => s.currentTheme);
  const wanted = useMemo(
    () => sheets.some((sheet) => sheet.thumbnail?.strokes.some(isPartialFoldStroke) ?? false),
    [sheets]
  );
  const [inks, setInks] = useState<SheetThumbnailInks | null>(null);
  useLayoutEffect(() => {
    const element = grid.current;
    setInks(wanted && element ? readSheetThumbnailInks(element, { auxInk: 'unassigned', display }) : null);
  }, [grid, wanted, display, theme]);
  return wanted ? inks : null;
}

interface SheetCardProps {
  sheet: SheetGridItem;
  index: number;
  showAux: boolean;
  /** What a crease folded short of 180° is shaded from; null while none is drawn. */
  inks: SheetThumbnailInks | null;
  selected: boolean;
  onSelect: () => void;
}

function SheetCard({ sheet, index, showAux, inks, selected, onSelect }: SheetCardProps) {
  const { t } = useTranslation();
  const { thumbnail } = sheet;
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`sheet-card${selected ? ' sheet-card--selected' : ''}${
        sheet.refused ? ' sheet-card--refused' : ''
      }`}
      onClick={onSelect}
      title={t('panels:sheets.cardTitle', 'Pattern {{n}}: {{size}}', {
        n: index + 1,
        size: sheet.size,
      })}
    >
      <span className="sheet-card__thumb">
        {thumbnail && (
          <svg viewBox={thumbnail.viewBox} aria-hidden="true" className="sheet-card__svg">
            {thumbnail.strokes.map((stroke, i) =>
              stroke.role === 'aux' && !showAux ? null : (
                <line
                  key={i}
                  className={`sheet-card__stroke sheet-card__stroke--${stroke.role}`}
                  x1={stroke.x1}
                  y1={stroke.y1}
                  x2={stroke.x2}
                  y2={stroke.y2}
                  style={inks && isPartialFoldStroke(stroke) ? partialFoldStyle(stroke, inks) : undefined}
                />
              )
            )}
          </svg>
        )}
      </span>
      <span className="sheet-card__meta">
        <span className="sheet-card__index">{index + 1}</span>
        <span className="sheet-card__count">{sheet.size}</span>
      </span>
    </button>
  );
}
