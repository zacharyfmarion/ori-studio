import { memo, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { CpGeometryTransport } from '../../engine/oristudioCpGeometry';
import { sheetThumbnail, type ReferencesSheet } from './referencesSheets';
import type { PrecreaseComponent } from './sheetFrames';

/**
 * The document's crease patterns as cards, one of them selected.
 *
 * One markup for two shapes. In the desktop rail it is a two-column strip under
 * the "Patterns" header; on a phone the rail *is* the list screen and this is a
 * full-width grid of larger cards, sized for a thumb. The stylesheet's phone
 * block draws the difference (`theme.css`, `.references-sheets`), because the
 * question the cards answer — which sheet is being folded — is the same on both,
 * and a second card component would be a second thing to keep in step.
 *
 * Presentation only: which sheets, which one is active, and a press reports
 * back. What a press *means* is the caller's — on the desktop it changes the
 * selection beside the canvas, on a phone it also opens the detail screen.
 */
export interface ReferencesSheetGridProps {
  sheets: readonly ReferencesSheet[];
  components: readonly PrecreaseComponent[];
  geometry: CpGeometryTransport;
  selected: number | null;
  onSelect: (component: number) => void;
}

export const ReferencesSheetGrid = memo(function ReferencesSheetGrid({
  sheets,
  components,
  geometry,
  selected,
  onSelect,
}: ReferencesSheetGridProps) {
  const { t } = useTranslation();
  // A plain container, not a list: a `listbox` may own only `option` and
  // `group`, and wrapping each option in an `li` puts something between them.
  return (
    <div
      className="references-sheets"
      role="listbox"
      aria-label={t('panels:references.sheets.label', 'Crease patterns')}
    >
      {sheets.map((sheet, index) => (
        <SheetCard
          key={sheet.id}
          sheet={sheet}
          index={index}
          component={components.find((entry) => entry.id === sheet.id) ?? null}
          geometry={geometry}
          selected={sheet.id === selected}
          onSelect={() => onSelect(sheet.id)}
        />
      ))}
    </div>
  );
});

interface SheetCardProps {
  sheet: ReferencesSheet;
  index: number;
  component: PrecreaseComponent | null;
  geometry: CpGeometryTransport;
  selected: boolean;
  onSelect: () => void;
}

function SheetCard({ sheet, index, component, geometry, selected, onSelect }: SheetCardProps) {
  const { t } = useTranslation();
  const thumbnail = useMemo(
    () => (component ? sheetThumbnail(geometry, component) : null),
    [component, geometry]
  );
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      className={`references-sheet${selected ? ' references-sheet--selected' : ''}${
        sheet.plannable ? '' : ' references-sheet--refused'
      }`}
      onClick={onSelect}
      title={t('panels:references.sheets.cardTitle', {
        defaultValue_one: 'Pattern {{n}}: {{count}} crease',
        defaultValue_other: 'Pattern {{n}}: {{count}} creases',
        n: index + 1,
        count: sheet.creaseCount,
      })}
    >
      <span className="references-sheet__thumb">
        {thumbnail && (
          <svg viewBox={thumbnail.viewBox} aria-hidden="true" className="references-sheet__svg">
            {thumbnail.strokes.map((stroke, i) => (
              <line
                key={i}
                className={`references-sheet__stroke references-sheet__stroke--${stroke.kind}`}
                x1={stroke.x1}
                y1={stroke.y1}
                x2={stroke.x2}
                y2={stroke.y2}
              />
            ))}
          </svg>
        )}
      </span>
      <span className="references-sheet__meta">
        <span className="references-sheet__index">{index + 1}</span>
        <span className="references-sheet__count">
          {t('panels:references.sheets.creases', {
            defaultValue_one: '{{count}} crease',
            defaultValue_other: '{{count}} creases',
            count: sheet.creaseCount,
          })}
        </span>
      </span>
    </button>
  );
}
