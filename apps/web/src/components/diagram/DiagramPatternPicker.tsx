import { useTranslation } from 'react-i18next';
import type {
  DiagramPatternSheet,
  DiagramPatternSheets,
} from '../../diagram/capture/useDiagramPatternSheets';
import { Button } from '../ui/Button';
import { DiagramSheetThumbnail } from './DiagramSheetThumbnail';
import styles from './DiagramPatternPicker.module.css';

/**
 * The open crease pattern's patterns, to link a step to one (D3): in the Step
 * pane's Picture section, while a step's pattern is being chosen.
 *
 * Several to a row, each a small drawing and its number, as the pattern rails
 * number them; the one the step shows is marked. A press links the step (or
 * relinks it) and the picker closes when the picture is in.
 */
export function DiagramPatternPicker({
  sheets,
  selectedId,
  busy,
  onPick,
  onCancel,
}: {
  sheets: DiagramPatternSheets;
  /** The pattern the step shows now, by segment id. */
  selectedId: number | null;
  /** A capture is running: the patterns wait for it. */
  busy: boolean;
  onPick: (sheet: DiagramPatternSheet) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={styles.picker}>
      <div className={styles.header}>
        <span className={styles.title}>{t('panels:diagram.picker.title', 'Choose a pattern')}</span>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          {t('panels:diagram.picker.cancel', 'Cancel')}
        </Button>
      </div>
      {sheets.status === 'ready' && sheets.sheets.length > 0 ? (
        <div
          role="listbox"
          aria-label={t('panels:diagram.picker.label', 'Patterns')}
          aria-busy={busy || undefined}
          className={styles.grid}
        >
          {sheets.sheets.map((sheet, index) => {
            const selected = sheet.segment.id === selectedId;
            const name = t('panels:diagram.picker.pattern', 'Pattern {{number}}', { number: index + 1 });
            return (
              <button
                key={sheet.segment.id}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={name}
                title={name}
                className={styles.option}
                data-selected={selected || undefined}
                disabled={busy}
                onClick={() => onPick(sheet)}
              >
                <span className={styles.thumb}>
                  {sheet.thumbnail && <DiagramSheetThumbnail thumbnail={sheet.thumbnail} />}
                </span>
                <span className={styles.number} aria-hidden="true">
                  {index + 1}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className={styles.note}>{statusNote(sheets, t)}</p>
      )}
    </div>
  );
}

function statusNote(sheets: DiagramPatternSheets, t: (key: string, fallback: string) => string): string {
  switch (sheets.status) {
    case 'no-pattern':
      return t('panels:diagram.picker.noPattern', 'Open a crease pattern in Edit to link one.');
    case 'pending':
      return t('panels:diagram.picker.pending', 'Finding the patterns…');
    case 'failed':
      return t('panels:diagram.picker.failed', 'The crease pattern’s patterns couldn’t be found.');
    case 'ready':
      return t('panels:diagram.picker.none', 'This crease pattern has no patterns to link yet.');
  }
}
