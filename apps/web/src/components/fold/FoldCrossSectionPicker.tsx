import { useRef, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { FoldSectionPickerModel, FoldSectionRow } from '../../fold/tools/crossSection';
import styles from './FoldCrossSectionPicker.module.css';

/** How far a bracket bulges past the point it joins, in hundredths of the track. */
const BRACKET_BULGE = 4;

/**
 * The layers at the fold line (plan D14), as a listbox: a row per display
 * layer on the moving side, top to bottom, each a bar where it meets the
 * line, with brackets where a bend joins two rows and its flap's name at the
 * side. Picking a row picks its flap — every row of that flap with it — which
 * is what the seed names (D6).
 *
 * Keyboard: ↑ / ↓ move between the rows, Home and End to the ends, Space
 * picks or unpicks the row's flap. The listbox owns those keys while it has
 * focus (`data-own-arrows`, the Diagram's marker for a control that keeps its
 * arrows); Enter is the workspace's, which commits the fold
 * (`data-fold-layer-pick`, `focusLeavesEnterToFold`). Hovering a row names
 * its flap to the canvas, which lights it.
 */
export function FoldCrossSectionPicker({
  model,
  disabled = false,
  onToggle,
  onHover,
}: {
  model: FoldSectionPickerModel;
  disabled?: boolean;
  onToggle: (flap: number) => void;
  onHover?: (flap: number | null) => void;
}) {
  const { t } = useTranslation();
  const rowRefs = useRef<(HTMLDivElement | null)[]>([]);
  const firstPicked = model.rows.findIndex((row) => row.state === 'picked');
  const [focused, setFocused] = useState<number | null>(null);
  // The tab stop: the row last moved to, else the first picked, else the top.
  const stop = focused !== null && focused < model.rows.length ? focused : Math.max(0, firstPicked);

  const toggle = (row: FoldSectionRow | undefined) => {
    if (row && !disabled) onToggle(row.flap);
  };

  const moveTo = (index: number) => {
    setFocused(index);
    rowRefs.current[index]?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
    // A key the workspace's keyboard already acted on is not the row's too.
    if (event.defaultPrevented) return;
    const last = model.rows.length - 1;
    switch (event.key) {
      case 'ArrowDown':
        moveTo(Math.min(last, index + 1));
        break;
      case 'ArrowUp':
        moveTo(Math.max(0, index - 1));
        break;
      case 'Home':
        moveTo(0);
        break;
      case 'End':
        moveTo(last);
        break;
      case ' ':
        toggle(model.rows[index]);
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className={styles.section} data-woven={model.woven || undefined}>
      <div className={styles.top} aria-hidden="true">
        {t('tools:fold.section.top', 'Top')}
      </div>
      <div className={styles.stack}>
        <div
          role="listbox"
          aria-label={model.label}
          aria-multiselectable={model.multiple || undefined}
          aria-disabled={disabled || undefined}
          aria-orientation="vertical"
          className={styles.rows}
          data-own-arrows=""
          data-fold-layer-pick=""
          onMouseLeave={() => onHover?.(null)}
        >
          {model.rows.map((row, index) => (
            <div
              key={row.key}
              ref={(element) => {
                rowRefs.current[index] = element;
              }}
              role="option"
              aria-label={row.label}
              aria-selected={row.state === 'picked'}
              aria-disabled={disabled || undefined}
              tabIndex={index === stop ? 0 : -1}
              className={styles.row}
              data-state={row.state}
              data-needed={row.needed || undefined}
              data-unordered={row.unordered || undefined}
              onClick={() => {
                setFocused(index);
                toggle(row);
              }}
              onKeyDown={(event) => onKeyDown(event, index)}
              onMouseEnter={() => onHover?.(row.flap)}
            >
              <span className={styles.track}>
                <span
                  className={styles.bar}
                  style={{ left: `${row.from * 100}%`, width: `${Math.max(0, row.to - row.from) * 100}%` }}
                />
              </span>
              <span className={styles.tag} aria-hidden="true">
                {row.tag}
              </span>
            </div>
          ))}
        </div>
        {model.brackets.length > 0 && (
          <svg
            className={styles.brackets}
            viewBox={`0 0 100 ${model.rows.length}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {model.brackets.map((bracket) => {
              const x = bracket.at * 100;
              const bulge = bracket.side === 'end' ? BRACKET_BULGE : -BRACKET_BULGE;
              const y1 = bracket.upper + 0.5;
              const y2 = bracket.lower + 0.5;
              const state = model.rows[bracket.upper]?.state ?? 'excluded';
              return (
                <path
                  key={`${bracket.upper}-${bracket.lower}-${bracket.at}`}
                  d={`M${x} ${y1}C${x + bulge} ${y1} ${x + bulge} ${y2} ${x} ${y2}`}
                  data-state={state}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
}
