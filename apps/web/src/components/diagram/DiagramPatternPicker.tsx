import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { DIAGRAM_OWN_ARROWS_ATTRIBUTE } from '../../diagram/actions/diagramShortcuts';
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
 *
 * One tab stop, as a listbox is: the arrows and Home and End move between the
 * patterns, and the Diagram's own step keys stand down while it has the focus.
 * While a link is captured the patterns refuse rather than disable, so the
 * one pressed keeps the focus.
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
  const list = useRef<HTMLDivElement | null>(null);
  const count = sheets.status === 'ready' ? sheets.sheets.length : 0;
  const selectedIndex =
    sheets.status === 'ready' ? sheets.sheets.findIndex((sheet) => sheet.segment.id === selectedId) : -1;
  // The tab stop: the pattern last moved to, else the one the step shows, else the first.
  const [moved, setMoved] = useState<number | null>(null);
  const active = Math.min(moved ?? Math.max(selectedIndex, 0), Math.max(count - 1, 0));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = nextIndex(event.key, active, count);
    if (next === null) return;
    event.preventDefault();
    setMoved(next);
    list.current?.querySelectorAll<HTMLElement>('[role="option"]')[next]?.focus();
  };

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
          ref={list}
          role="listbox"
          aria-label={t('panels:diagram.picker.label', 'Patterns')}
          aria-busy={busy || undefined}
          aria-orientation="horizontal"
          {...{ [DIAGRAM_OWN_ARROWS_ATTRIBUTE]: '' }}
          className={styles.grid}
          onKeyDown={onKeyDown}
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
                tabIndex={index === active ? 0 : -1}
                aria-disabled={busy || undefined}
                onFocus={() => setMoved(index)}
                onClick={() => {
                  if (!busy) onPick(sheet);
                }}
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

/** Where a key moves the picker's focus, or null for a key it leaves alone. */
function nextIndex(key: string, from: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return Math.min(from + 1, count - 1);
    case 'ArrowLeft':
    case 'ArrowUp':
      return Math.max(from - 1, 0);
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
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
