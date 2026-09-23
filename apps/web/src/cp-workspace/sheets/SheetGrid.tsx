import { memo } from 'react';
import { useTranslation } from 'react-i18next';
import { erodeSegment } from '../../lib/paper/paperSvg';
import type { SheetThumbnail, ThumbnailStroke } from './sheetThumbnail';
import type { SheetThumbnailInk } from './sheetThumbnailInk';

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
 * Each card draws its pattern the way the paper style draws it on paper: the
 * sheet in the paper's colour and every line in its role's pen, which the rail
 * hands over as one ink (`useSheetThumbnailInk`) — so the two rails agree with
 * each other and with Settings ▸ Paper.
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
  /** The paper and pens every card draws with. */
  ink: SheetThumbnailInk;
  selected: number | null;
  onSelect: (id: number) => void;
}

export const SheetGrid = memo(function SheetGrid({
  sheets,
  ink,
  selected,
  onSelect,
}: SheetGridProps) {
  const { t } = useTranslation();
  // A plain container, not a list: a `listbox` may own only `option` and
  // `group`, and wrapping each option in an `li` puts something between them.
  return (
    <div
      className="sheet-grid"
      role="listbox"
      aria-label={t('panels:sheets.label', 'Crease patterns')}
    >
      {sheets.map((sheet, index) => (
        <SheetCard
          key={sheet.id}
          sheet={sheet}
          index={index}
          ink={ink}
          selected={sheet.id === selected}
          onSelect={() => onSelect(sheet.id)}
        />
      ))}
    </div>
  );
});

interface SheetCardProps {
  sheet: SheetGridItem;
  index: number;
  ink: SheetThumbnailInk;
  selected: boolean;
  onSelect: () => void;
}

function SheetCard({ sheet, index, ink, selected, onSelect }: SheetCardProps) {
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
            {thumbnail.paper && (
              <path
                className="sheet-card__paper"
                d={thumbnail.paper}
                fill={ink.paper}
                fillRule="evenodd"
              />
            )}
            {thumbnail.strokes.map((stroke, i) => (
              <ThumbnailLine key={i} stroke={stroke} ink={ink} size={thumbnail.size} />
            ))}
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

/**
 * One line in its role's pen, or nothing when the style does not draw its
 * role. An aux line's ends on the paper's outline pull back by the style's
 * erode, a share of the sheet — the box's side (D8).
 */
function ThumbnailLine({
  stroke,
  ink,
  size,
}: {
  stroke: ThumbnailStroke;
  ink: SheetThumbnailInk;
  size: number;
}) {
  const pen = ink.pens[stroke.role];
  if (!pen) return null;
  const ends =
    stroke.role === 'aux'
      ? erodeSegment([stroke.x1, stroke.y1], [stroke.x2, stroke.y2], stroke.onBoundary, ink.erode * size)
      : ([
          [stroke.x1, stroke.y1],
          [stroke.x2, stroke.y2],
        ] as const);
  if (!ends) return null;
  return (
    <line
      className={`sheet-card__stroke sheet-card__stroke--${stroke.role}`}
      x1={ends[0][0]}
      y1={ends[0][1]}
      x2={ends[1][0]}
      y2={ends[1][1]}
      {...pen}
    />
  );
}
