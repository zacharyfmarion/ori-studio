/**
 * The folded figures, as a list to pick from.
 *
 * What is left of the "Folded models" controls once their form moved to the
 * Properties pane: a list is navigation, not a property of the thing selected,
 * so it does not belong in the pane — and it still has two frames, the
 * viewport-bar dropdown and the phone's modal, which is why it is one body.
 *
 * Reads nothing and owns nothing: the figures, the active one, the stale set
 * and the verb arrive as props, which is what lets the same element tree sit
 * inside a `role="menu"` dropdown and inside a `role="dialog"` modal.
 */
import { useTranslation } from 'react-i18next';
import type { OristudioCpFoldedFigureEntry } from '../../engine/oristudioCpTypes';
import { foldedFigureSubtitle } from './foldedFigureNotice';

export interface FoldedFigurePickerProps {
  figures: OristudioCpFoldedFigureEntry[];
  activeFigure: OristudioCpFoldedFigureEntry | null;
  /**
   * Figures whose source creases have changed since they were folded. Derived
   * per document revision rather than stamped on the entry — see
   * `lib/foldedFigureStaleness.ts`.
   */
  staleFigureIds: ReadonlySet<string>;
  onSelectFigure: (id: string) => void;
}

export function FoldedFigurePicker({
  figures,
  activeFigure,
  staleFigureIds,
  onSelectFigure,
}: FoldedFigurePickerProps) {
  const { t } = useTranslation();
  return (
    <>
      <div className="folded-figure-menu__header">
        <span>{t('panels:creasePattern.foldedModels', 'Folded models')}</span>
        <span>{activeFigure ? activeFigure.title : t('panels:creasePattern.none', 'None')}</span>
      </div>
      {figures.length > 0 ? (
        <div className="folded-figure-menu__list">
          {figures.map((figure) => (
            <button
              key={figure.id}
              type="button"
              className="folded-figure-menu__figure"
              data-active={figure.id === activeFigure?.id ? true : undefined}
              data-status={figure.status}
              role="menuitemradio"
              aria-checked={figure.id === activeFigure?.id}
              onClick={() => onSelectFigure(figure.id)}
            >
              <span>{figure.title}</span>
              <small data-stale={staleFigureIds.has(figure.id) || undefined}>
                {foldedFigureSubtitle(t, figure, staleFigureIds.has(figure.id))}
              </small>
            </button>
          ))}
        </div>
      ) : (
        <p className="folded-figure-menu__empty">
          {t('panels:creasePattern.noFoldedModels', 'Fold the crease pattern to add a folded model.')}
        </p>
      )}
      {/* No appearance controls: a figure's display style, side, colours and
          shadow are its properties, in the Properties pane, which the pick
          reveals. Duplicate and Delete act on one figure and live on the
          figure's own toolbar and context menu. */}
    </>
  );
}
